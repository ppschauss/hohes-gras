import type { TimeOfDay, Weather } from '@game/shared'
import type { AreaDef, ItemDef, SpeciesDef, SpawnEntry } from '@game/content'
import type { Rng } from './rng.js'
import { clamp } from './stats.js'
import { shiftLevel } from './scaling.js'

export const SHINY_BASE_ODDS = 1 / 512

/**
 * Bei so vielen Fängen derselben Art ist der nächste sicher schillernd.
 *
 * Neunundvierzig gefangen, das fünfzigste glänzt. Die Zahl ist die Zusage, auf
 * die man hinarbeitet — und der Punkt, an dem die Kurve genau 1 erreicht,
 * nicht bloß fast.
 */
export const SHINY_CHAIN_GUARANTEE = 49

/**
 * Wohin die Serie faellt, nachdem ein Schillerndes gefangen wurde.
 *
 * Vorher fiel sie gar nicht: wer einmal bei 49 war, fing ab da *jedes*
 * Exemplar dieser Art schillernd — die Jagd war nach einem Treffer vorbei und
 * das Besondere zur Regel geworden. Auf null zurueckzusetzen waere das andere
 * Extrem; zwanzig ist die Stelle, an der die Chance bei zehn Prozent liegt.
 * Die Arbeit bleibt also belohnt, nur nicht ewig.
 */
export const SHINY_CHAIN_AFTER_CATCH = 20

/** Beibehalten unter altem Namen: die Serie zählt bis zur Zusage. */
export const SHINY_CHAIN_CAP = SHINY_CHAIN_GUARANTEE

/**
 * Ab hier steht die Chance auf zehn Prozent.
 *
 * Die Kurve stieg vorher spät und dann steil — 1,8 % bei zehn Fängen, 28 % bei
 * dreißig. Das war als Ziel gedacht und in der Praxis eine lange Durststrecke:
 * die ersten dreißig Fänge fühlten sich an wie gar keine Serie. Jetzt steigt
 * sie über die ersten zehn Fänge auf zehn Prozent und bleibt dort, bis die
 * Zusage greift.
 */
export const SHINY_CHAIN_PLATEAU = 10

/** Die Chance auf dem Plateau. */
export const SHINY_PLATEAU_ODDS = 0.10

/**
 * Die Shiny-Chance für eine bestimmte Art, gegeben die laufende Fangserie.
 *
 * Drei Abschnitte, und alle drei sind Absicht:
 *
 *  - **Bis zehn Fänge** steigt sie gleichmäßig von 0,2 % auf 10 %. Kein
 *    Exponent, keine Durststrecke: jeder Fang bringt sichtbar etwas.
 *  - **Von zehn bis achtundvierzig** bleibt sie bei 10 %. Wer die Serie hält,
 *    hat gute Chancen — aber sie werden nicht immer besser, sonst wäre die
 *    Zusage am Ende sinnlos.
 *  - **Ab neunundvierzig** ist der nächste Fang sicher schillernd.
 *
 * Die Serie zählt **nur für die Art, die man jagt**. Vorher galt der Zuschlag
 * für jede Begegnung: wer Abra vierzigmal hintereinander fing, traf auch
 * überall sonst häufiger auf Schillernde — und musste sie wegwerfen, weil es
 * die falsche Art war.
 */
export function shinyOdds(chainStreak: number): number {
  const streak = Math.max(0, Math.floor(chainStreak))
  if (streak >= SHINY_CHAIN_GUARANTEE) return 1
  if (streak >= SHINY_CHAIN_PLATEAU) return SHINY_PLATEAU_ODDS
  const progress = streak / SHINY_CHAIN_PLATEAU
  return SHINY_BASE_ODDS + (SHINY_PLATEAU_ODDS - SHINY_BASE_ODDS) * progress
}

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

/**
 * Lockduft: wie stark sich die Gewichte zugunsten eines Typs verschieben.
 *
 * Vier statt zehn, und das ist Absicht. Ein Lockduft soll die Suche lenken,
 * nicht ersetzen: in einem Gebiet, in dem ein Viertel der Tabelle den Typ
 * traegt, macht der Faktor daraus gut die Haelfte — spuerbar, aber kein
 * Bestellschein. Und in einem Gebiet ohne diesen Typ bleibt er wirkungslos,
 * statt heimlich etwas hineinzuzaubern, was dort nicht lebt.
 */
export const LURE_WEIGHT_FACTOR = 4

/** Wie viele Erkundungen eine Packung Lockduft traegt. */
export const LURE_USES = 5

export interface LureEffect {
  /** Typ, der bevorzugt wird. */
  typeId: string
  /** Typen einer Art — die Engine kennt kein Content-Pack. */
  typesOf: (speciesId: string) => readonly string[]
  factor?: number
}

export function rollEncounter(
  area: AreaDef,
  ctx: SpawnContext,
  rng: Rng,
  chain: { speciesId: string; streak: number } | null = null,
  /** Levelversatz aus der dynamischen Skalierung; siehe `scaling.ts`. */
  levelOffset = 0,
  lure: LureEffect | null = null,
): WildEncounter | null {
  const pool = availableSpawns(area, ctx)
  if (pool.length === 0) return null

  const factor = lure?.factor ?? LURE_WEIGHT_FACTOR
  const weightOf = (s: { speciesId: string; weight: number }): number =>
    lure && lure.typesOf(s.speciesId).includes(lure.typeId) ? s.weight * factor : s.weight

  const entry = rng.weighted(pool, weightOf)
  // Der Wurf passiert im entworfenen Band und wird danach verschoben: so
  // bleibt die relative Verteilung innerhalb des Gebiets erhalten.
  const level = shiftLevel(rng.int(entry.minLevel, entry.maxLevel), levelOffset)
  // Der Serienbonus gilt nur der gejagten Art.
  const streak = chain && chain.speciesId === entry.speciesId ? chain.streak : 0
  return {
    speciesId: entry.speciesId,
    level,
    shiny: rng.chance(shinyOdds(streak) * 100),
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

/**
 * Was beim Fangen sonst noch abfaellt.
 *
 * Erkunden zahlte bisher nur Gold und Erfahrung; Werkstoffe kamen
 * ausschliesslich von Expeditionen. Damit war die haeufigste Handlung des
 * Spiels von der Werkbank abgeschnitten — man erkundete *trotz* des Handwerks,
 * nicht dafuer. Jeder achte Fang bringt jetzt einen Werkstoff mit, gewichtet
 * so, dass Sternenstaub die Ausnahme bleibt.
 */
export const CATCH_DROP_CHANCE = 12.5

const CATCH_DROPS: Array<{ itemId: string; weight: number }> = [
  { itemId: 'silk-thread', weight: 30 },
  { itemId: 'soft-sand', weight: 30 },
  { itemId: 'dew-drop', weight: 24 },
  { itemId: 'iron-shard', weight: 12 },
  { itemId: 'star-piece', weight: 4 },
]

export function rollCatchDrop(rng: Rng): string | null {
  if (!rng.chance(CATCH_DROP_CHANCE)) return null
  return rng.weighted(CATCH_DROPS, (d) => d.weight).itemId
}
