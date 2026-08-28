import { clamp } from './stats.js'

/**
 * Poké-Beet.
 *
 * Man vergräbt etwas — Beeren, Bonbons, Material oder Gold — und bekommt nach
 * der Wachstumszeit mehr zurück. Wie viel mehr, entscheidet die Pflege:
 *
 *  - **gar nichts tun:** 50 %. Das Beet wächst auch allein.
 *  - **selbst pflegen:** bis 100 %. Über die Wachstumszeit werden vier
 *    Pflegeschritte fällig (jäten, wässern, jäten, wässern); jeder erledigte
 *    Schritt hebt den Ertrag.
 *  - **ein Pflanzen-Pokémon abstellen:** 50 % plus ein halbes Prozent je Level.
 *    Auf Level 100 ist es damit genauso gut wie Handarbeit — und man muss
 *    nicht vorbeischauen. Das ist der Lohn dafür, eines großgezogen zu haben.
 *
 * Wer beides macht, bekommt den besseren der beiden Werte, nie die Summe:
 * sonst wäre ein hochgezogenes Pflanzen-Pokémon eine Einladung, trotzdem noch
 * viermal zu klicken.
 */

export const PLOT_COUNT = 4
export const PLOT_GROWTH_MS = 4 * 3_600_000
export const PLOT_PHASES = 4

/** Obergrenze für Gegenstände je Beet. */
export const PLOT_MAX_ITEMS = 30

/**
 * Gold ist streng gedeckelt — und zwar zweifach.
 *
 * Der Ertrag ist ein Vielfaches des Einsatzes. Ohne Grenze wäre das Beet die
 * einzige Einnahmequelle, die noch zählt, und jede andere Beschäftigung im
 * Spiel wäre daneben Zeitverschwendung. Deshalb: 500 Gold, und das höchstens
 * einmal am Tag. Höchstens 500 Gold Gewinn je 24 Stunden.
 */
export const PLOT_MAX_GOLD = 500
export const GOLD_PLANT_COOLDOWN_MS = 24 * 3_600_000

/** Wann wieder Gold vergraben werden darf. `null` heißt: sofort. */
export function goldPlantReadyAt(lastPlantedAt: number | null): number | null {
  return lastPlantedAt === null ? null : lastPlantedAt + GOLD_PLANT_COOLDOWN_MS
}

export function goldPlantReady(lastPlantedAt: number | null, now: number): boolean {
  const readyAt = goldPlantReadyAt(lastPlantedAt)
  return readyAt === null || now >= readyAt
}

/** Grundertrag ohne jede Pflege, in Prozent Aufschlag. */
export const PLOT_BASE_BONUS = 50
/** Was volle Handpflege obendrauf legt. */
export const PLOT_MANUAL_BONUS = 50
/** Prozentpunkte je Level des abgestellten Pflanzen-Pokémon. */
export const TENDER_LEVEL_FACTOR = 0.5

/** Kategorien, die sich vergraben lassen. Ein Pokéball keimt nicht. */
export const PLANTABLE_CATEGORIES = ['berry', 'xp', 'material'] as const

/** Wie viele Pflegeschritte bis jetzt fällig geworden sind. */
export function phasesDue(plantedAt: number, now: number, growthMs = PLOT_GROWTH_MS, phases = PLOT_PHASES): number {
  if (now <= plantedAt) return 0
  const perPhase = growthMs / phases
  return clamp(Math.floor((now - plantedAt) / perPhase), 0, phases)
}

/** Wann der nächste Schritt fällig wird; null, wenn alle durch sind. */
export function nextPhaseAt(
  plantedAt: number, phasesDone: number, growthMs = PLOT_GROWTH_MS, phases = PLOT_PHASES,
): number | null {
  if (phasesDone >= phases) return null
  return Math.round(plantedAt + (growthMs / phases) * (phasesDone + 1))
}

/** Jäten und wässern im Wechsel — reine Farbe, aber sie macht aus vier
 *  gleichen Knöpfen eine Abfolge. */
export const phaseKind = (index: number): 'weed' | 'water' => (index % 2 === 0 ? 'weed' : 'water')

export function manualBonus(phasesDone: number, phases = PLOT_PHASES): number {
  const share = phases <= 0 ? 0 : clamp(phasesDone / phases, 0, 1)
  return PLOT_BASE_BONUS + Math.round(PLOT_MANUAL_BONUS * share)
}

export function tenderBonus(level: number): number {
  return clamp(Math.round(PLOT_BASE_BONUS + level * TENDER_LEVEL_FACTOR), PLOT_BASE_BONUS, 100)
}

/** Der Aufschlag in Prozent, den ein Beet gerade erreicht. */
export function plotBonus(input: {
  phasesDone: number
  phases?: number
  tenderLevel: number | null
}): number {
  const manual = manualBonus(input.phasesDone, input.phases ?? PLOT_PHASES)
  const tended = input.tenderLevel === null ? 0 : tenderBonus(input.tenderLevel)
  return Math.max(manual, tended)
}

/** Was am Ende herauskommt. Immer mindestens der Einsatz. */
export function harvestAmount(stake: number, bonusPercent: number): number {
  return Math.max(stake, Math.round(stake * (1 + bonusPercent / 100)))
}

export const plotReady = (plantedAt: number, now: number, growthMs = PLOT_GROWTH_MS): boolean =>
  now >= plantedAt + growthMs
