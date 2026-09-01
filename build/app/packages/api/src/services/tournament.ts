import { GameError, type Trainer } from '@game/shared'
import { von } from './ledger.js'
import { battleParty } from './party.js'
import {
  chooseAction, createBattle, createRng, deriveSeed, makeSide, resolveTurn, toFighter,
  type BattleState, type CreatureLike,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import { findById } from '../repos/trainers.js'
import { logEvent } from '../repos/events.js'
import { worldClock } from '../worldClock.js'
import { battleContent } from './battle.js'
import { weekKey } from './guilds.js'

/**
 * Weekly tournament.
 *
 * Entries close at the end of the week and the whole bracket is then resolved
 * server-side in one pass. Nobody has to be present for their match, which is
 * the only way a bracket works for a game people play in two-minute bursts.
 */

export const PRIZES = [5000, 2500, 1200, 600]
export const ENTRY_FEE = 500
export const MIN_ENTRIES = 2

interface BracketMatch {
  round: number
  a: string | null
  b: string | null
  winner: string | null
}

export function currentWeek(): string { return weekKey() }

function ensureTournament(ctx: AppContext, week: string) {
  const existing = ctx.db.prepare('SELECT * FROM tournaments WHERE week_key = ?').get(week) as
    | { week_key: string; state: string; created_at: number; closes_at: number; resolved_at: number | null; bracket: string }
    | undefined
  if (existing) return existing

  const now = Date.now()
  // Entries close a week after the row is created; the exact instant matters
  // less than that everyone in a given week faces the same deadline.
  const closesAt = now + 7 * 86_400_000
  ctx.db.prepare('INSERT OR IGNORE INTO tournaments (week_key, created_at, closes_at) VALUES (?, ?, ?)')
    .run(week, now, closesAt)
  return ctx.db.prepare('SELECT * FROM tournaments WHERE week_key = ?').get(week) as never
}

export function overview(ctx: AppContext, trainer: Trainer) {
  const week = currentWeek()
  const row = ensureTournament(ctx, week) as {
    week_key: string; state: string; closes_at: number; resolved_at: number | null; bracket: string
  }

  const entries = ctx.db
    .prepare(
      `SELECT e.trainer_id AS trainerId, t.display_name AS displayName, e.seed_score AS seedScore, e.placement
       FROM tournament_entries e JOIN trainers t ON t.id = e.trainer_id
       WHERE e.week_key = ? ORDER BY e.seed_score DESC`,
    )
    .all(week) as Array<{ trainerId: string; displayName: string; seedScore: number; placement: number | null }>

  const mine = entries.find((e) => e.trainerId === trainer.id) ?? null

  return {
    weekKey: week,
    state: row.state,
    closesAt: row.closes_at,
    resolvedAt: row.resolved_at,
    entryFee: ENTRY_FEE,
    prizes: PRIZES,
    entered: mine !== null,
    myPlacement: mine?.placement ?? null,
    entryCount: entries.length,
    minEntries: MIN_ENTRIES,
    entries: entries.map((e, i) => ({ ...e, seed: i + 1, isSelf: e.trainerId === trainer.id })),
    bracket: JSON.parse(row.bracket) as BracketMatch[],
  }
}

export function enter(ctx: AppContext, trainer: Trainer) {
  return tx(ctx.db, () => {
    const week = currentWeek()
    const row = ensureTournament(ctx, week) as { state: string; closes_at: number }
    if (row.state !== 'open') throw new GameError('invalid_state', { reason: 'entries_closed' }, 409)

    const already = ctx.db.prepare('SELECT 1 FROM tournament_entries WHERE week_key = ? AND trainer_id = ?')
      .get(week, trainer.id)
    if (already) throw new GameError('invalid_state', { reason: 'already_entered' }, 409)

    const team = creatures.teamOf(ctx.db, trainer.id)
    if (team.length === 0) throw new GameError('invalid_state', { reason: 'no_team' }, 409)

    inventory.spendGold(ctx.db, trainer.id, ENTRY_FEE)

    // The team is frozen at entry time, so improving afterwards does not help
    // and everyone is judged on what they brought.
    const snapshot = team.map((c) => ({
      id: c.id, speciesId: c.speciesId, nickname: c.nickname, level: c.level,
      nature: c.nature, ivs: c.ivs, evs: c.evs, moves: c.moves, shiny: c.shiny, friendship: c.friendship,
    }))
    const seedScore = team.reduce((sum, c) => sum + c.level, 0)

    ctx.db.prepare('INSERT INTO tournament_entries (week_key, trainer_id, team, seed_score) VALUES (?, ?, ?, ?)')
      .run(week, trainer.id, JSON.stringify(snapshot), seedScore)
    logEvent(ctx.db, trainer.id, 'tournament.entered', { week, seedScore })
    return overview(ctx, trainer)
  })
}

/**
 * Resolve the bracket.
 *
 * Called by the scheduler once the deadline passes. Single elimination, seeded
 * by team level so the two strongest entries do not meet in round one.
 */
export function resolve(ctx: AppContext, week: string): { resolved: boolean; placements: number } {
  return tx(ctx.db, () => {
    const row = ctx.db.prepare('SELECT * FROM tournaments WHERE week_key = ?').get(week) as
      | { state: string; closes_at: number } | undefined
    if (!row || row.state === 'finished') return { resolved: false, placements: 0 }
    if (Date.now() < row.closes_at) return { resolved: false, placements: 0 }

    const entries = ctx.db
      .prepare('SELECT trainer_id AS trainerId, team, seed_score AS seedScore FROM tournament_entries WHERE week_key = ? ORDER BY seed_score DESC')
      .all(week) as Array<{ trainerId: string; team: string; seedScore: number }>

    if (entries.length < MIN_ENTRIES) {
      // Not enough players: refund rather than crown a champion by default.
      for (const e of entries) inventory.earnGold(ctx.db, e.trainerId, ENTRY_FEE, von(ctx, 'tournament.refund'))
      ctx.db.prepare('UPDATE tournaments SET state = ?, resolved_at = ? WHERE week_key = ?')
        .run('finished', Date.now(), week)
      return { resolved: true, placements: 0 }
    }

    const content = battleContent(ctx)
    const ppOf = (id: string) => ctx.registry.tryMove(id)?.pp ?? 10
    // Die Momentaufnahme hat genau die Form, die toFighter erwartet — sie wird
    // beim Eintritt aus einer OwnedCreature gebaut.
    const teamOf = new Map(
      entries.map((e) => [e.trainerId, JSON.parse(e.team) as Array<Omit<CreatureLike, 'hpCurrent'>>]),
    )

    const buildSide = (trainerId: string) => {
      const t = findById(ctx.db, trainerId)
      const snapshot = teamOf.get(trainerId) ?? []
      // Auch im Turnier: ein Legendaeres tritt an, der Rest sieht zu.
      const fighters = battleParty(ctx, snapshot).antreten.map((c) => {
        const species = ctx.registry.species(c.speciesId)
        return toFighter(
          { ...c, hpCurrent: Number.MAX_SAFE_INTEGER },
          species,
          ctx.registry.localized(species.name, 'de'),
          ppOf,
        )
      })
      return makeSide(t?.displayName ?? '?', fighters)
    }

    const fight = (a: string, b: string, matchSeed: string): string => {
      let state: BattleState = createBattle(
        matchSeed, 'pvp', matchSeed, buildSide(a), buildSide(b), worldClock().weather,
      )
      let guard = 0
      while (!state.outcome && guard++ < 300) {
        const actionA = chooseAction(state, 0, 'expert', content, createRng(deriveSeed(matchSeed, 'a', state.turn + 1)))
        const actionB = chooseAction(state, 1, 'expert', content, createRng(deriveSeed(matchSeed, 'b', state.turn + 1)))
        state = resolveTurn(state, actionA, actionB, content).state
      }
      // A draw at the turn limit is decided by seeding, which is at least a
      // stated rule rather than a coin flip.
      if (state.outcome?.winner === undefined || state.outcome.winner === null) return a
      return state.outcome.winner === 0 ? a : b
    }

    const bracket: BracketMatch[] = []
    let round = 1
    let alive = entries.map((e) => e.trainerId)
    const eliminatedByRound = new Map<string, number>()

    while (alive.length > 1) {
      const next: string[] = []
      // Seed pairing: strongest against weakest inside the remaining field.
      for (let i = 0; i < Math.floor(alive.length / 2); i++) {
        const a = alive[i]!
        const b = alive[alive.length - 1 - i]!
        const winner = fight(a, b, deriveSeed(week, `r${round}`, a, b))
        bracket.push({ round, a, b, winner })
        next.push(winner)
        eliminatedByRound.set(winner === a ? b : a, round)
      }
      if (alive.length % 2 === 1) {
        const bye = alive[Math.floor(alive.length / 2)]!
        bracket.push({ round, a: bye, b: null, winner: bye })
        next.push(bye)
      }
      alive = next
      round++
    }

    const champion = alive[0]!
    // Placement: champion first, then by how late someone was eliminated.
    const ranked = [champion, ...entries
      .map((e) => e.trainerId)
      .filter((id) => id !== champion)
      .sort((x, y) => (eliminatedByRound.get(y) ?? 0) - (eliminatedByRound.get(x) ?? 0))]

    ranked.forEach((trainerId, index) => {
      const placement = index + 1
      ctx.db.prepare('UPDATE tournament_entries SET placement = ? WHERE week_key = ? AND trainer_id = ?')
        .run(placement, week, trainerId)
      const prize = PRIZES[index]
      if (prize) {
        inventory.earnGold(ctx.db, trainerId, prize, von(ctx, 'tournament.prize'))
        ctx.db.prepare('UPDATE tournament_entries SET reward_paid = 1 WHERE week_key = ? AND trainer_id = ?')
          .run(week, trainerId)
      }
    })

    ctx.db.prepare('UPDATE tournaments SET state = ?, resolved_at = ?, bracket = ? WHERE week_key = ?')
      .run('finished', Date.now(), JSON.stringify(bracket), week)
    logEvent(ctx.db, null, 'tournament.resolved', { week, entries: entries.length, champion })
    return { resolved: true, placements: ranked.length }
  })
}
