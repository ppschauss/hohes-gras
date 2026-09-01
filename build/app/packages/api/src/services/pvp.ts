import { GameError, type Trainer } from '@game/shared'
import { von } from './ledger.js'
import { battleParty } from './party.js'
import {
  applyResult, chooseAction, createBattle, createRng, deriveSeed, makeSide, matchmakingRange,
  resolveTurn, tierOf, toFighter, type BattleEvent, type BattleState,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as pvp from '../repos/pvp.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import { findById } from '../repos/trainers.js'
import { logEvent } from '../repos/events.js'
import { worldClock, dayStart } from '../worldClock.js'
import { ENERGY_COSTS } from '@game/engine'
import { battleContent } from './battle.js'
import { contributeToGoal } from './guilds.js'
import { awardSeasonPoints, bumpMetric } from './progression.js'
import { capOf, duelCap } from './travel.js'
import * as energy from './energy.js'
import { assertPace, recordPace } from './pacing.js'

/** Duelle sind unbegrenzt; der Zaehler bleibt als Statistik im UI. */
export const DUELS_PER_DAY = null
export const WIN_GOLD = 250
export const LOSS_GOLD = 60

/**
 * Asynchronous duels.
 *
 * Both teams are frozen snapshots and both sides are played by the AI; the
 * challenger picks the opponent, not the moves. That is a deliberate trade: it
 * means a duel needs nobody online, works from a bot notification, and cannot
 * be won by having more time to think. What it rewards is team building.
 */
export function findMatches(ctx: AppContext, trainer: Trainer) {
  const rating = pvp.ratingOf(ctx.db, trainer.id)
  let candidates: ReturnType<typeof pvp.findOpponents> = []
  for (let attempt = 0; attempt < 4 && candidates.length === 0; attempt++) {
    const [low, high] = matchmakingRange(rating.rating, attempt)
    candidates = pvp.findOpponents(ctx.db, trainer.id, low, high, 5)
  }

  const sinceMidnight = dayStart()
  return {
    rating: rating.rating,
    tier: tierOf(rating.rating),
    wins: rating.wins,
    losses: rating.losses,
    streak: rating.streak,
    levelCap: capOf(ctx, trainer),
    duelsToday: pvp.duelsToday(ctx.db, trainer.id, sinceMidnight),
    duelsPerDay: DUELS_PER_DAY,
    energy: energy.state(ctx, trainer.id),
    energyCost: ENERGY_COSTS.duel,
    unseenDefences: pvp.unseenDefences(ctx.db, trainer.id),
    opponents: candidates.map((c) => ({
      trainerId: c.trainerId,
      displayName: c.displayName,
      rating: c.rating,
      tier: tierOf(c.rating),
      teamPreview: creatures.teamOf(ctx.db, c.trainerId).map((m) => {
        const species = ctx.registry.species(m.speciesId)
        return { sprite: m.shiny ? species.spriteShiny : species.sprite, level: m.level }
      }),
    })),
  }
}

export interface DuelResult {
  duelId: string
  won: boolean
  ratingBefore: number
  ratingAfter: number
  delta: number
  gold: number
  opponentName: string
  events: BattleEvent[]
  turns: number
}

export function duel(ctx: AppContext, trainer: Trainer, opponentId: string): DuelResult {
  /*
   * Erst der Takt, dann alles andere.
   *
   * Ausserhalb der Transaktion, damit die Zwangspause einen Abbruch
   * ueberlebt. Gemessen im Protokoll: 258 Duelle in 31 Sekunden — die
   * Ertraege sind seitdem gedeckelt, die Frequenz war es nicht.
   */
  assertPace(ctx, trainer, 'duel')
  return tx(ctx.db, () => {
    const opponent = findById(ctx.db, opponentId)
    if (!opponent || opponent.isBanned) throw new GameError('not_found', { opponentId }, 404)
    if (opponent.id === trainer.id) throw new GameError('validation_failed', { reason: 'self' })

    const myTeam = creatures.teamOf(ctx.db, trainer.id)
    const theirTeam = creatures.teamOf(ctx.db, opponent.id)
    if (myTeam.length === 0) throw new GameError('invalid_state', { reason: 'no_team' }, 409)
    if (theirTeam.length === 0) throw new GameError('invalid_state', { reason: 'opponent_no_team' }, 409)

    // Kein Tageslimit mehr: Duelle kosten Energie, und die begrenzt sich selbst.
    energy.spendFor(ctx, trainer.id, 'duel')
    recordPace(ctx, trainer, 'duel')

    /*
     * Beide Teams auf dieselbe Reisegrenze bringen.
     *
     * Ohne das gewinnt, wer mehr Regionen abgehakt hat: ein Trainer mit
     * Grenze 250 gegen einen mit 100 ist kein Duell, sondern eine Vorfuehrung.
     * Ein Duell soll ueber die Aufstellung entscheiden, nicht ueber
     * Reisekilometer — also gilt die niedrigere der beiden Grenzen.
     */
    const cap = duelCap(ctx, trainer, opponent)

    const ppOf = (id: string) => ctx.registry.tryMove(id)?.pp ?? 10
    // Die Regel gilt fuer beide Seiten. Ein Abbild mit drei Legendaeren waere
    // sonst genau die Aufstellung, gegen die sie sich richtet — nur eben auf
    // der Seite, gegen die man nichts machen kann.
    const build = (list: typeof myTeam, locale: string) =>
      battleParty(ctx, list).antreten.map((c) => {
        const species = ctx.registry.species(c.speciesId)
        // Snapshots always start at full health: a duel must not be decided by
        // whether the defender happened to be hurt when they logged off.
        return toFighter(
          { ...c, level: Math.min(c.level, cap), hpCurrent: Number.MAX_SAFE_INTEGER },
          species,
          ctx.registry.localized(species.name, locale),
          ppOf,
        )
      })

    const seed = deriveSeed(trainer.id, opponent.id, String(Date.now()))
    let state: BattleState = createBattle(
      seed, 'pvp', seed,
      makeSide(trainer.displayName, build(myTeam, trainer.locale)),
      makeSide(opponent.displayName, build(theirTeam, trainer.locale)),
      worldClock().weather,
    )

    const content = battleContent(ctx)
    const events: BattleEvent[] = []
    let guard = 0
    while (!state.outcome && guard++ < 300) {
      const mine = chooseAction(state, 0, 'skilled', content, createRng(deriveSeed(seed, 'p0', state.turn + 1)))
      const theirs = chooseAction(state, 1, 'skilled', content, createRng(deriveSeed(seed, 'p1', state.turn + 1)))
      const step = resolveTurn(state, mine, theirs, content)
      state = step.state
      events.push(...step.events)
    }

    const won = state.outcome?.winner === 0

    /*
     * Ein Gegner zahlt einmal am Tag.
     *
     * Derselbe Gegner liess sich beliebig oft herausfordern, und jeder Sieg
     * brachte Rang und Gold — wer einen schwaecheren Gegner in der Liste
     * hatte, konnte ihn den ganzen Abend abarbeiten. Der zweite Sieg am selben
     * Tag gegen dieselbe Person wird deshalb ausgetragen und aufgezeichnet,
     * aber nicht mehr bezahlt: kein Rang, kein Gold, keine Saisonpunkte.
     *
     * Niederlagen bleiben unangetastet. Sie sind kein Sieg, also greift die
     * Sperre nicht — und damit bleibt die Wiederholung ein Risiko statt einer
     * risikolosen Wette.
     */
    const repeat = won && pvp.wonAgainstSince(ctx.db, trainer.id, opponent.id, dayStart())

    const myRating = pvp.ratingOf(ctx.db, trainer.id)
    const theirRating = pvp.ratingOf(ctx.db, opponent.id)

    const mine = repeat
      ? { rating: myRating.rating, delta: 0 }
      : applyResult(myRating.rating, theirRating.rating, won, myRating.wins + myRating.losses)
    const theirs = applyResult(theirRating.rating, myRating.rating, !won, theirRating.wins + theirRating.losses)

    if (!repeat) {
      pvp.updateRating(ctx.db, trainer.id, mine.rating, won)
      pvp.updateRating(ctx.db, opponent.id, theirs.rating, !won)
    }

    /*
     * Auch die Wiederholung zahlt das Antrittsgeld.
     *
     * Bisher exakt nichts, und das war der Punkt, an dem sich die Sperre nach
     * Strafe anfuehlte statt nach Grenze. Sie bekommt jetzt, was eine
     * Niederlage bekommt: gekaempft wurde, gewonnen zaehlt nur einmal am Tag.
     */
    const gold = won && !repeat ? WIN_GOLD : LOSS_GOLD
    inventory.earnGold(ctx.db, trainer.id, gold, von(ctx, 'pvp.win'))
    if (won && !repeat) energy.reward(ctx, trainer.id, 'duelWon')
    // Das Gildenziel zaehlt Teilnahme, nicht Ertrag — es bleibt.
    contributeToGoal(ctx, trainer.id, 'battles', 1)
    if (won && !repeat) { awardSeasonPoints(ctx, trainer.id, 'duelWin'); bumpMetric(ctx, trainer.id, 'duelsWon') }

    const record = pvp.recordDuel(ctx.db, {
      challengerId: trainer.id,
      defenderId: opponent.id,
      seed,
      events,
      winner: state.outcome?.winner ?? null,
      ratingDelta: mine.delta,
      foughtAt: Date.now(),
    })

    logEvent(ctx.db, trainer.id, 'pvp.duel', { opponentId: opponent.id, won, delta: mine.delta, repeat })

    return {
      duelId: record.id,
      won,
      ratingBefore: myRating.rating,
      ratingAfter: mine.rating,
      delta: mine.delta,
      gold,
      /** Zweiter Sieg am selben Tag gegen denselben Gegner: ohne Ertrag. */
      repeat,
      opponentName: opponent.displayName,
      events,
      turns: state.turn,
    }
  })
}

export function history(ctx: AppContext, trainer: Trainer) {
  pvp.markDefencesSeen(ctx.db, trainer.id)
  return pvp.historyOf(ctx.db, trainer.id, 20).map((d) => {
    const asChallenger = d.challengerId === trainer.id
    const otherId = asChallenger ? d.defenderId : d.challengerId
    const other = findById(ctx.db, otherId)
    return {
      id: d.id,
      opponentName: other?.displayName ?? '?',
      asChallenger,
      won: asChallenger ? d.winner === 0 : d.winner === 1,
      delta: asChallenger ? d.ratingDelta : -d.ratingDelta,
      foughtAt: d.foughtAt,
    }
  })
}

export function ladderView(ctx: AppContext, trainer: Trainer) {
  const rows = pvp.ladder(ctx.db, 50)
  const mine = pvp.ratingOf(ctx.db, trainer.id)
  return {
    rows: rows.map((r, i) => ({
      rank: i + 1,
      trainerId: r.trainerId,
      displayName: r.displayName,
      rating: r.rating,
      tier: tierOf(r.rating),
      wins: r.wins,
      losses: r.losses,
      isSelf: r.trainerId === trainer.id,
    })),
    own: { rating: mine.rating, tier: tierOf(mine.rating), wins: mine.wins, losses: mine.losses, streak: mine.streak },
  }
}
