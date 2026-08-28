import type { TimeOfDay, Weather } from '@game/shared'
import type { AreaDef, ItemDef, SpeciesDef, SpawnEntry } from '@game/content'
import type { Rng } from './rng.js'
import { clamp } from './stats.js'
import { shiftLevel } from './scaling.js'

export const SHINY_BASE_ODDS = 1 / 512
/** Consecutive catches of the same species raise shiny odds, capped so the
 *  hunt stays a hunt. Mirrors the "catch combo" idea, which rewards commitment
 *  without ever guaranteeing anything. */
export const SHINY_CHAIN_CAP = 40

export interface SpawnContext {
  timeOfDay: TimeOfDay
  weather: Weather
}

/** Spawns whose time/weather restrictions are satisfied right now. */
export function availableSpawns(area: AreaDef, ctx: SpawnContext): SpawnEntry[] {
  return area.spawns.filter((s) => {
    if (s.timeOfDay && !s.timeOfDay.includes(ctx.timeOfDay)) return false
    if (s.weather && !s.weather.includes(ctx.weather)) return false
    return true
  })
}

export interface WildEncounter {
  speciesId: string
  level: number
  shiny: boolean
  /** Non-restricted spawns are common; a spawn gated on weather or time is
   *  what makes going out at night feel different. */
  gatedByConditions: boolean
}

export function rollEncounter(
  area: AreaDef,
  ctx: SpawnContext,
  rng: Rng,
  shinyChain = 0,
  /** Levelversatz aus der dynamischen Skalierung; siehe `scaling.ts`. */
  levelOffset = 0,
): WildEncounter | null {
  const pool = availableSpawns(area, ctx)
  if (pool.length === 0) return null

  const entry = rng.weighted(pool, (s) => s.weight)
  // Der Wurf passiert im entworfenen Band und wird danach verschoben: so
  // bleibt die relative Verteilung innerhalb des Gebiets erhalten.
  const level = shiftLevel(rng.int(entry.minLevel, entry.maxLevel), levelOffset)
  const chainBonus = 1 + Math.min(shinyChain, SHINY_CHAIN_CAP) * 0.25
  return {
    speciesId: entry.speciesId,
    level,
    shiny: rng.chance(SHINY_BASE_ODDS * chainBonus * 100),
    gatedByConditions: Boolean(entry.timeOfDay || entry.weather),
  }
}

export interface CatchModifiers {
  ball: ItemDef
  berry: ItemDef | null
  /** How many turns the player has already spent on this encounter. */
  turn: number
  timeOfDay: TimeOfDay
  /** 0..2, raised by the "Schwächen" action. Each step helps a little. */
  weakenStacks: number
  /** 0..2, raised by "Beruhigen". */
  calmStacks: number
  /** Badges make wild creatures easier to catch — a small, visible reward for
   *  progress that applies everywhere. */
  badgeCount: number
}

export const MAX_WEAKEN_STACKS = 2
export const MAX_CALM_STACKS = 2

/**
 * Multiplier a ball contributes, including its conditional bonus.
 *
 * Conditional balls are the interesting ones: a Net Ball that is merely "a bit
 * better" is a worse design than one that is clearly the right tool against
 * water types and clearly the wrong one elsewhere.
 */
export function ballMultiplier(ball: ItemDef, species: SpeciesDef, mods: CatchModifiers): number {
  const base = Number(ball.params.catchMultiplier ?? 1)
  const bonus = Number(ball.params.bonusMultiplier ?? 0)

  const types = String(ball.params.bonusVsTypes ?? '')
  if (types && species.types.some((t) => types.split(',').includes(t))) return Math.max(base, bonus)

  const times = String(ball.params.bonusTimeOfDay ?? '')
  if (times && times.split(',').includes(mods.timeOfDay)) return Math.max(base, bonus)

  const perTurn = Number(ball.params.perTurnBonus ?? 0)
  if (perTurn > 0) {
    const max = Number(ball.params.maxMultiplier ?? 4)
    return clamp(base + perTurn * mods.turn, base, max)
  }
  return base
}

export interface CatchAttempt {
  /** 0..1 — what the UI shows before the throw. */
  probability: number
  caught: boolean
  /** How many times the ball wobbles before settling. 0-3, 4 = caught. */
  shakes: number
}

/**
 * Resolve one throw.
 *
 * The shake count is derived from the same probability as the outcome rather
 * than rolled separately, so the animation can never contradict the result —
 * a ball that wobbles three times and then fails is dramatic; one that wobbles
 * three times and fails *while the player was told it was a sure thing* is a
 * bug report.
 */
export function attemptCatch(
  species: SpeciesDef,
  level: number,
  mods: CatchModifiers,
  rng: Rng,
): CatchAttempt {
  const probability = catchProbability(species, level, mods)
  const caught = rng.next() < probability
  return { probability, caught, shakes: caught ? 4 : shakesFor(probability, rng) }
}

export function catchProbability(species: SpeciesDef, level: number, mods: CatchModifiers): number {
  // Classic shape: rarer species and higher levels resist more.
  const base = species.catchRate / 255
  const levelPenalty = clamp(1 - (level - 1) / 140, 0.35, 1)

  const ball = ballMultiplier(mods.ball, species, mods)
  const berry = mods.berry ? Number(mods.berry.params.catchBonus ?? 1) : 1
  const calm = 1 + clamp(mods.calmStacks, 0, MAX_CALM_STACKS) * 0.12
  const weaken = 1 + clamp(mods.weakenStacks, 0, MAX_WEAKEN_STACKS) * 0.08
  const badges = 1 + clamp(mods.badgeCount, 0, 9) * 0.02

  return clamp(base * levelPenalty * ball * berry * calm * weaken * badges, 0.01, 0.95)
}

/** Fewer shakes for a hopeless throw, three for a near miss. */
function shakesFor(probability: number, rng: Rng): number {
  let shakes = 0
  // Each shake is an independent check at the fourth root, which is what makes
  // a 0.8 throw usually reach three wobbles before failing.
  const per = Math.pow(probability, 0.25)
  while (shakes < 3 && rng.next() < per) shakes++
  return shakes
}

/** Gold and materials for a successful catch. */
export function catchReward(species: SpeciesDef, level: number, shiny: boolean): { gold: number; xp: number } {
  const rarityFactor = { common: 1, uncommon: 1.6, rare: 2.6, legendary: 6 }[species.rarity] ?? 1
  const gold = Math.round((12 + level * 2.4) * rarityFactor * (shiny ? 4 : 1))
  return { gold, xp: Math.round(species.baseXpYield * (level / 8)) }
}
