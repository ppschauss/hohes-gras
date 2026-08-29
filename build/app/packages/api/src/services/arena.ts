import { GameError, type Trainer } from '@game/shared'
import type { TrainerDef } from '@game/content'
import {
  ARENA_HEAL_PERCENT, ARENA_ROUNDS, ARENA_TIERS, arenaLevel, arenaTypeFor, ENERGY_COSTS,
  computeStats, createRng, findArenaTier, LEGENDARY_CATCH_RATE, type ArenaTier,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as battles from '../repos/battles.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import { logEvent } from '../repos/events.js'
import { gameDate } from '../worldClock.js'
import { beginBattle, forfeit } from './battle.js'
import * as energy from './energy.js'
import { capOf } from './travel.js'

interface RunRow {
  gameDate: string
  tier: string
  typeId: string
  round: number
  wins: number
  finished: number
  battleId: string | null
}

const runOf = (ctx: AppContext, trainerId: string): RunRow | null =>
  (ctx.db.prepare(
    `SELECT game_date AS gameDate, tier, type_id AS typeId, round, wins, finished, battle_id AS battleId
       FROM arena_runs WHERE trainer_id = ?`,
  ).get(trainerId) as RunRow | undefined) ?? null

/** Die Typen des Packs in fester Reihenfolge — der Kalender braucht eine. */
const typeIds = (ctx: AppContext): string[] =>
  ctx.registry.allTypes.map((t) => t.id).sort()

export const typeOfDay = (ctx: AppContext, date = gameDate()): string | null =>
  arenaTypeFor(date, typeIds(ctx))

/** Durchschnittslevel des aufgestellten Teams — die Bezugsgröße aller Stufen. */
function averageLevel(ctx: AppContext, trainerId: string): number {
  const team = creatures.teamOf(ctx.db, trainerId)
  if (team.length === 0) return 0
  return team.reduce((sum, c) => sum + c.level, 0) / team.length
}

/**
 * Die Gegner des Tages.
 *
 * Aus Datum, Typ, Stufe und Runde gewürfelt — nicht aus der Uhr: derselbe Tag
 * ergibt denselben Gegner, auch nach einem Neuladen. Legendäre und
 * Ereignis-Arten bleiben draußen; die Arena ist ein Übungsplatz, kein
 * Abkürzungsweg zu Arten, die man sonst jagen muss.
 */
function buildOpponent(
  ctx: AppContext, trainer: Trainer, tier: ArenaTier, typeId: string, round: number, date: string,
): TrainerDef {
  /*
   * Entwicklungsstufe begrenzen, nicht nur das Level.
   *
   * Gemeldet: ein Ibitak auf Level 3 nahm einem Level-8-Pokemon die halbe
   * Leiste. Das lag nicht am Level, sondern daran, dass die Wahl jede Art des
   * Typs zuliess — auch Endstufen. Auf "leicht" treten jetzt nur Grundformen
   * an, auf "ausgeglichen" hoechstens die erste Entwicklung.
   */
  const pool = ctx.registry.obtainableSpecies.filter(
    (s) => s.types.includes(typeId)
      && s.catchRate > LEGENDARY_CATCH_RATE
      && !s.event
      && evolutionStage(ctx, s.id) <= tier.maxStage
      && (tier.maxBst === 0 || baseStatTotal(s) <= tier.maxBst),
  )
  if (pool.length === 0) throw new GameError('invalid_state', { reason: 'no_species_for_tier', typeId }, 409)

  const rng = createRng(`arena:${date}:${typeId}:${tier.id}:${round}:${trainer.id}`)
  const level = arenaLevel(averageLevel(ctx, trainer.id), tier, round, capOf(ctx, trainer))
  /*
   * So viele Gegner, wie die Stufe zulässt.
   *
   * Gleich viele wie im eigenen Team klingt fair, ist es über vier Kämpfe aber
   * nicht: das eigene Team tritt viermal an, die Gegner je einmal frisch.
   * Auf „leicht" ist es die Hälfte, auf „ausgeglichen" drei Viertel.
   */
  const size = foeCount(ctx, trainer, tier)

  const type = ctx.registry.tryType(typeId)
  const typeName = type ? ctx.registry.localized(type.name, trainer.locale) : typeId

  return {
    id: `arena-${date}-${tier.id}-${round}`,
    name: { de: `${typeName}-Herausforderer ${round}` },
    title: { de: 'Trainingsarena' },
    kind: 'trainer',
    sprite: '/media/trainers/ace.png',
    team: Array.from({ length: size }, () => {
      const species = rng.pick(pool)
      return { speciesId: species.id, level }
    }),
    badgeId: null,
    rewardGold: tier.goldPerWin,
    xpMultiplier: tier.xpMultiplier,
    // Jeder Gegner tritt genau einmal an; eine Wiederholungsquote hätte hier
    // keine Bedeutung.
    repeatRewardRatio: 1,
    dialogue: {
      intro: { de: `Runde ${round} von ${ARENA_ROUNDS}.` },
      win: { de: 'Das war zu viel für dich.' },
      lose: { de: 'Sauber gekämpft.' },
    },
  }
}

/** Wie viele Gegner diese Stufe gegen das aktuelle Team aufstellt. */
function foeCount(ctx: AppContext, trainer: Trainer, tier: ArenaTier): number {
  const own = creatures.teamOf(ctx.db, trainer.id).length
  return Math.max(1, Math.min(5, Math.round(own * tier.foeShare)))
}

/** Anteil der KP, die das Team gerade noch hat — 0 bis 100. */
function teamHealthPercent(ctx: AppContext, trainerId: string): number {
  const team = creatures.teamOf(ctx.db, trainerId)
  if (team.length === 0) return 0
  let have = 0
  let max = 0
  for (const c of team) {
    const species = ctx.registry.species(c.speciesId)
    have += c.hpCurrent
    max += computeStats(species, c.level, c.ivs, c.evs, c.nature).hp
  }
  return max === 0 ? 0 : Math.round((have / max) * 100)
}

/** Summe der Grundwerte — das Mass dafuer, wie stark eine Art ueberhaupt ist. */
function baseStatTotal(species: { baseStats: Record<string, number> }): number {
  return Object.values(species.baseStats).reduce((sum, v) => sum + v, 0)
}

/**
 * Die wievielte Entwicklungsstufe eine Art ist — 0 für eine Grundform.
 *
 * Aus den Ketten des Packs gelesen statt gepflegt: eine Liste waere beim
 * naechsten Pack falsch.
 */
function evolutionStage(ctx: AppContext, speciesId: string, depth = 0): number {
  if (depth > 4) return depth
  const parent = ctx.registry.allSpecies.find((s) => s.evolutions.some((e) => e.to === speciesId))
  return parent ? evolutionStage(ctx, parent.id, depth + 1) : depth
}

/** Zehn Prozent der maximalen KP zurück — für jedes Mitglied, auch besiegte. */
function healTenPercent(ctx: AppContext, trainerId: string): number {
  let healed = 0
  for (const c of creatures.teamOf(ctx.db, trainerId)) {
    const species = ctx.registry.species(c.speciesId)
    const max = computeStats(species, c.level, c.ivs, c.evs, c.nature).hp
    const next = Math.min(max, c.hpCurrent + Math.max(1, Math.round((max * ARENA_HEAL_PERCENT) / 100)))
    if (next !== c.hpCurrent) { creatures.setHp(ctx.db, c.id, next); healed++ }
  }
  return healed
}

const clearedToday = (ctx: AppContext, trainerId: string, tier: string, date: string): boolean =>
  ctx.db.prepare('SELECT 1 AS hit FROM arena_clears WHERE trainer_id = ? AND game_date = ? AND tier = ?')
    .get(trainerId, date, tier) !== undefined

export function view(ctx: AppContext, trainer: Trainer) {
  const date = gameDate()
  const typeId = typeOfDay(ctx, date)
  const type = typeId ? ctx.registry.tryType(typeId) : null
  const run = runOf(ctx, trainer.id)
  const average = averageLevel(ctx, trainer.id)
  const cap = capOf(ctx, trainer)
  const active = run && run.finished === 0 && run.gameDate === date ? run : null

  return {
    date,
    typeId,
    typeName: type ? ctx.registry.localized(type.name, trainer.locale) : null,
    typeColor: type?.color ?? null,
    averageLevel: Math.round(average),
    /*
     * Wie fit das Team gerade ist, in Prozent.
     *
     * Vier Kaempfe mit zehn Prozent Erholung dazwischen sind mit einem
     * angeschlagenen Team nicht zu schaffen — und wer erst im Kampf merkt,
     * dass er haette heilen sollen, kommt aus ihm nur mit einer Niederlage
     * wieder heraus.
     */
    teamHealth: teamHealthPercent(ctx, trainer.id),
    rounds: ARENA_ROUNDS,
    /** Was ein ganzer Durchlauf kostet — einmal, nicht je Kampf. */
    energyCost: ENERGY_COSTS.arena,
    healPercent: ARENA_HEAL_PERCENT,
    tiers: ARENA_TIERS.map((t) => ({
      id: t.id,
      levelDelta: t.levelDelta,
      levels: [1, ARENA_ROUNDS].map((r) => arenaLevel(average, t, r, cap)),
      goldPerWin: t.goldPerWin,
      xpMultiplier: t.xpMultiplier,
      // Wie viele Gegner je Kampf antreten — und wie viele im ganzen
      // Durchlauf. Die zweite Zahl ist die, die man wirklich spuert.
      foesPerBattle: foeCount(ctx, trainer, t),
      foesTotal: foeCount(ctx, trainer, t) * ARENA_ROUNDS,
      bonusGold: t.bonusGold,
      bonus: t.bonus.map((b) => ({
        ...b,
        name: ctx.registry.tryItem(b.itemId)
          ? ctx.registry.localized(ctx.registry.item(b.itemId).name, trainer.locale)
          : b.itemId,
      })),
      clearedToday: clearedToday(ctx, trainer.id, t.id, date),
    })),
    run: active
      ? {
          tier: active.tier,
          round: active.round,
          wins: active.wins,
          battleOpen: Boolean(battles.activeOf(ctx.db, trainer.id)),
        }
      : null,
  }
}

/** Einen Durchlauf beginnen. Der erste Kampf startet sofort. */
export function start(ctx: AppContext, trainer: Trainer, tierId: string) {
  const tier = findArenaTier(tierId)
  if (!tier) throw new GameError('validation_failed', { field: 'tier' })

  const date = gameDate()
  const typeId = typeOfDay(ctx, date)
  if (!typeId) throw new GameError('invalid_state', { reason: 'no_species_for_tier' }, 409)

  const existing = runOf(ctx, trainer.id)
  if (existing && existing.finished === 0 && existing.gameDate === date) {
    throw new GameError('invalid_state', { reason: 'already_active' }, 409)
  }

  /*
   * Die Energie fuer den ganzen Durchlauf, hier und nur hier.
   *
   * Reicht sie nicht, faellt der Durchlauf aus, bevor er anfaengt — das ist
   * die freundlichere Absage als ein Abbruch nach dem dritten Kampf.
   */
  energy.spendFor(ctx, trainer.id, 'arena')

  const def = buildOpponent(ctx, trainer, tier, typeId, 1, date)
  const area = ctx.registry.tryArea(trainer.currentAreaId ?? '') ?? ctx.registry.allAreas[0]!
  const battle = beginBattle(ctx, trainer, def, area,
    { exactLevels: true, storeDef: true, foeIv: tier.foeIv, freeEnergy: true })

  ctx.db.prepare(
    `INSERT INTO arena_runs (trainer_id, game_date, tier, type_id, round, wins, finished, battle_id, started_at)
     VALUES (?, ?, ?, ?, 1, 0, 0, ?, ?)
     ON CONFLICT(trainer_id) DO UPDATE SET game_date = excluded.game_date, tier = excluded.tier,
       type_id = excluded.type_id, round = 1, wins = 0, finished = 0,
       battle_id = excluded.battle_id, started_at = excluded.started_at`,
  ).run(trainer.id, date, tier.id, typeId, battle.id, Date.now())

  logEvent(ctx.db, trainer.id, 'arena.start', { tier: tier.id, typeId })
  return { battle, arena: view(ctx, trainer) }
}

/**
 * Nach einem Kampf weitergehen.
 *
 * Der Aufruf entscheidet nichts selbst: er liest das Ergebnis des letzten
 * Kampfes. Gewonnen heißt heilen und weiter — oder, nach der vierten Runde,
 * auszahlen. Verloren beendet den Durchlauf.
 */
export function next(ctx: AppContext, trainer: Trainer) {
  return tx(ctx.db, () => {
    const date = gameDate()
    const run = runOf(ctx, trainer.id)
    /*
     * Ein Klick auf einen Knopf, den es nicht mehr gibt, ist kein Fehler.
     *
     * Gemeldet: nach dem letzten Kampf stand unten noch "Nächster Gegner 2/4",
     * und ein Tipp darauf sagte "du bist in keinem Kampf". Der Durchlauf war
     * da längst abgerechnet — der Bildschirm hinkte nur hinterher. Statt einer
     * Absage kommt jetzt der aktuelle Stand zurück, und die Anzeige richtet
     * sich danach.
     */
    if (!run || run.finished === 1 || run.gameDate !== date) {
      return { done: true, won: false, payout: null, healed: 0, battle: null, arena: view(ctx, trainer) }
    }
    if (battles.activeOf(ctx.db, trainer.id)) {
      throw new GameError('invalid_state', { reason: 'battle_in_progress' }, 409)
    }

    const last = run.battleId ? battles.byId(ctx.db, run.battleId) : null
    const won = last?.winner === 0
    const finish = (payout: ReturnType<typeof pay> | null) => {
      ctx.db.prepare('UPDATE arena_runs SET finished = 1 WHERE trainer_id = ?').run(trainer.id)
      return { done: true, won, payout, healed: 0, battle: null, arena: view(ctx, trainer) }
    }

    if (!won) {
      logEvent(ctx.db, trainer.id, 'arena.lost', { tier: run.tier, round: run.round })
      return finish(null)
    }

    const wins = run.wins + 1
    if (wins >= ARENA_ROUNDS) {
      const tier = findArenaTier(run.tier)!
      const payout = clearedToday(ctx, trainer.id, tier.id, date) ? null : pay(ctx, trainer, tier, date)
      ctx.db.prepare('UPDATE arena_runs SET wins = ? WHERE trainer_id = ?').run(wins, trainer.id)
      logEvent(ctx.db, trainer.id, 'arena.cleared', { tier: tier.id, paid: payout !== null })
      return finish(payout)
    }

    const healed = healTenPercent(ctx, trainer.id)
    const tier = findArenaTier(run.tier)!
    const def = buildOpponent(ctx, trainer, tier, run.typeId, run.round + 1, date)
    const area = ctx.registry.tryArea(trainer.currentAreaId ?? '') ?? ctx.registry.allAreas[0]!
    const battle = beginBattle(ctx, trainer, def, area,
      { exactLevels: true, storeDef: true, foeIv: tier.foeIv, freeEnergy: true })

    ctx.db.prepare('UPDATE arena_runs SET round = ?, wins = ?, battle_id = ? WHERE trainer_id = ?')
      .run(run.round + 1, wins, battle.id, trainer.id)

    return { done: false, won: true, payout: null, healed, battle, arena: view(ctx, trainer) }
  })
}

/** Die Prämie eines vollständigen Durchlaufs — einmal am Tag je Stufe. */
function pay(ctx: AppContext, trainer: Trainer, tier: ArenaTier, date: string) {
  inventory.earnGold(ctx.db, trainer.id, tier.bonusGold)
  for (const item of tier.bonus) inventory.grant(ctx.db, trainer.id, item.itemId, item.quantity)
  ctx.db.prepare(
    'INSERT INTO arena_clears (trainer_id, game_date, tier, cleared_at) VALUES (?, ?, ?, ?)',
  ).run(trainer.id, date, tier.id, Date.now())

  return {
    gold: tier.bonusGold,
    items: tier.bonus.map((b) => ({
      ...b,
      name: ctx.registry.tryItem(b.itemId)
        ? ctx.registry.localized(ctx.registry.item(b.itemId).name, trainer.locale)
        : b.itemId,
    })),
  }
}

/**
 * Gehört der laufende oder gerade beendete Kampf zu einem Durchlauf?
 *
 * Der Kampfbildschirm braucht das, um nach dem Sieg weiterzuführen. Ohne diese
 * Auskunft blieb er auf dem beendeten Kampf stehen, zeigte die alten Gegner —
 * und ein Angriff darauf lief in "es läuft gerade kein Kampf".
 */
export function contextFor(ctx: AppContext, trainer: Trainer): {
  tier: string; round: number; rounds: number; wins: number
} | null {
  const run = runOf(ctx, trainer.id)
  if (!run || run.finished === 1 || run.gameDate !== gameDate()) return null
  return { tier: run.tier, round: run.round, rounds: ARENA_ROUNDS, wins: run.wins }
}

/**
 * Aufgeben — und dabei aufräumen.
 *
 * Der laufende Kampf muss mit. Gemeldet von einer Spielerin: sie trat mit
 * einem angeschlagenen Team an, brach den Durchlauf ab und galt danach
 * stundenlang als "in einem Kampf" — heilen ging nicht, ein neuer Kampf auch
 * nicht, weil der alte offen stand. Ein abgebrochener Durchlauf, der eine
 * offene Kampfzeile hinterlässt, ist kein Abbruch, sondern eine Sackgasse.
 */
export function abandon(ctx: AppContext, trainer: Trainer) {
  if (battles.activeOf(ctx.db, trainer.id)) forfeit(ctx, trainer)
  ctx.db.prepare('UPDATE arena_runs SET finished = 1 WHERE trainer_id = ?').run(trainer.id)
  logEvent(ctx.db, trainer.id, 'arena.abandoned', {})
  return view(ctx, trainer)
}
