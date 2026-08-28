import type { AreaDef } from '@game/content'
import { ABSOLUTE_MAX_LEVEL } from './leveling.js'
import { clamp } from './stats.js'

/**
 * Dynamische Levelskalierung.
 *
 * Ein Gebiet ist mit einem Levelband entworfen — Route 1 mit 2–6, der
 * Silberberg mit 84–94. Wer mit einem stärkeren Team hineingeht, hebt das Band
 * mit: die Wildnis und die Trainer dort steigen auf sein Niveau.
 *
 * Zwei Eigenschaften machen das ungefährlich:
 *
 *  - Es geht nur **nach oben**. Ein Gebiet wird nie leichter, als es entworfen
 *    wurde; wer unterlevelt ankommt, findet genau die Herausforderung vor, für
 *    die es gebaut ist.
 *  - Der Bezugswert ist der **Median** des Teams, nicht das stärkste Mitglied.
 *    Ein einzelnes getauschtes Pokémon auf Level 90 zieht damit nicht die
 *    ganze Welt hoch und macht dem Rest des Teams das Leben unmöglich.
 */

export const LEVEL_CAP = ABSOLUTE_MAX_LEVEL

export interface LevelBand {
  min: number
  max: number
}

/**
 * Der Median, nicht der Durchschnitt.
 *
 * Ein Team aus 5, 5, 5, 5 und 90 hat den Durchschnitt 22 — eine Zahl, die
 * keines dieser Pokémon beschreibt. Der Median sagt 5, und das ist die
 * Stärke, mit der man tatsächlich kämpft.
 */
export function referenceLevel(levels: number[]): number {
  const usable = levels.filter((l) => Number.isFinite(l) && l > 0).sort((a, b) => a - b)
  if (usable.length === 0) return 0
  const mid = Math.floor(usable.length / 2)
  return usable.length % 2 === 1
    ? usable[mid]!
    : Math.round((usable[mid - 1]! + usable[mid]!) / 2)
}

/** Das entworfene Levelband eines Gebiets über alle seine Spawns. */
export function areaBand(area: AreaDef): LevelBand {
  let min = Infinity
  let max = 0
  for (const spawn of area.spawns) {
    if (spawn.minLevel < min) min = spawn.minLevel
    if (spawn.maxLevel > max) max = spawn.maxLevel
  }
  return Number.isFinite(min) ? { min, max } : { min: 1, max: 1 }
}

/**
 * Um wie viele Level ein Band angehoben wird. 0 heißt: unverändert.
 *
 * Die Obergrenze des Bandes wandert auf den Bezugswert. Damit bleibt der
 * Abstand erhalten, den der Entwurf vorsieht — Route 1 liegt mit 2–6 knapp
 * über einem Starter auf Level 5, und genau dieses Verhältnis gilt dann auch
 * mit Level 90.
 *
 * Geht nur nach oben: ein einzelnes Gebiet wird nie leichter, als es entworfen
 * wurde. Für ganze Regionen gilt das nicht — siehe `regionOffset`.
 */
export function bandOffset(band: LevelBand, reference: number): number {
  if (reference <= band.max) return 0
  return Math.min(reference - band.max, LEVEL_CAP - band.max)
}

/**
 * Der Versatz einer ganzen Region, gemessen an ihrem Eingang.
 *
 * Das ist der Unterschied zwischen "die Regionen sind eine Kette" und "die
 * Regionen sind parallel". Solange jedes Gebiet für sich skaliert und nur nach
 * oben, ist Johto mit seinem Einstieg auf Level 58 für einen Anfänger
 * verschlossen — und eine frei wählbare Startregion wäre eine Lüge.
 *
 * Deshalb: der Versatz wird **einmal am ersten Gebiet der Region** bestimmt und
 * auf alle ihre Gebiete angewandt, nach oben wie nach unten. Die innere
 * Steigung bleibt dabei unangetastet — die erste Route bleibt die leichteste,
 * der Silberberg der härteste. Nur wandert die ganze Region auf das Niveau
 * dessen, der sie betritt.
 */
export function regionOffset(anchor: LevelBand, reference: number, cap = LEVEL_CAP): number {
  if (reference <= 0) return 0
  const raw = reference - anchor.max
  // Nach unten nur so weit, dass das schwächste Gebiet bei Level 2 endet:
  // eine Region voller Level-1-Gegner wäre keine Region mehr.
  const floor = 2 - anchor.min
  return clamp(raw, floor, cap - anchor.max)
}

export const shiftLevel = (level: number, offset: number): number =>
  clamp(level + offset, 1, LEVEL_CAP)

export const shiftBand = (band: LevelBand, offset: number): LevelBand => ({
  min: shiftLevel(band.min, offset),
  max: shiftLevel(band.max, offset),
})
