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
 * Der Versatz hat zwei Teile, die verschiedene Fragen beantworten:
 *
 *  - **Die Region nach unten** (`regionShift`): darf ein Anfänger in Johto
 *    anfangen? Einmal am Eingang der Region bestimmt, auf alle ihre Gebiete
 *    angewandt, nie nach oben.
 *  - **Das Gebiet nach oben** (`bandOffset`): lohnt es sich, die erste Route
 *    ewig abzugrasen? Je Gebiet einzeln, nie nach unten.
 *
 * Zwei Eigenschaften machen das ungefährlich:
 *
 *  - Ein Gebiet wird nie leichter, als die Region beim Betreten war; und die
 *    Region wird nie schwerer, als sie entworfen wurde.
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
 * Um wie viele Level ein einzelnes Band angehoben wird. 0 heißt: unverändert.
 *
 * Die Obergrenze des Bandes wandert auf den Bezugswert. Damit bleibt der
 * Abstand erhalten, den der Entwurf vorsieht — Route 1 liegt mit 2–6 knapp
 * über einem Starter auf Level 5, und genau dieses Verhältnis gilt dann auch
 * mit Level 90.
 *
 * Geht nur nach oben: ein einzelnes Gebiet wird nie leichter, als es entworfen
 * wurde. Nach unten bewegt sich nur die Region als Ganzes — siehe
 * `regionShift`.
 */
export function bandOffset(band: LevelBand, reference: number, cap = LEVEL_CAP): number {
  if (reference <= band.max) return 0
  return Math.max(0, Math.min(reference - band.max, cap - band.max))
}

/**
 * Wie weit eine ganze Region nach unten rutscht, damit ihr Eingang zu dem
 * passt, der sie betritt. Nie nach oben.
 *
 * Das ist der Unterschied zwischen "die Regionen sind eine Kette" und "die
 * Regionen sind parallel". Solange jedes Gebiet nur für sich und nur nach oben
 * skaliert, ist Johto mit seinem Einstieg auf Level 58 für einen Anfänger
 * verschlossen — und eine frei wählbare Startregion wäre eine Lüge.
 *
 * **Nur nach unten**, und das ist die entscheidende Einschränkung. Ein Versatz,
 * der auch nach oben ginge, würde die ganze Region mitziehen, sobald ihr
 * Besucher wächst: der Spieler steigt von 5 auf 40, und das Indigo-Plateau
 * steigt von 64 auf 98 mit. Die eigene Liga wäre dann nie erreichbar. Nach oben
 * bewegt sich deshalb jedes Gebiet einzeln — und ein Gebiet, das schon über dem
 * Spieler liegt, bewegt sich gar nicht.
 */
export function regionShift(anchor: LevelBand, reference: number): number {
  if (reference <= 0) return 0
  // Nach unten nur so weit, dass das schwächste Gebiet bei Level 2 anfängt:
  // eine Region voller Level-1-Gegner wäre keine Region mehr.
  return clamp(Math.min(0, reference - anchor.max), 2 - anchor.min, 0)
}

/**
 * Der gesamte Versatz eines Gebiets: Region nach unten, Gebiet nach oben.
 *
 * Beide Teile zusammen ergeben die Regel, die man dem Spieler erklären kann:
 * *eine Region empfängt dich auf deinem Niveau und wächst dann nicht mehr mit
 * dir — du wächst in sie hinein.*
 */
export function areaOffset(
  anchor: LevelBand, band: LevelBand, reference: number, cap = LEVEL_CAP,
  /** Niveau beim ersten Betreten der Region. Der Teil nach unten haengt daran
   *  und nur daran — sonst waechst die Region mit ihrem Besucher mit. */
  entryReference = reference,
): number {
  const down = regionShift(anchor, entryReference)
  return down + bandOffset(shiftBand(band, down), reference, cap)
}

export const shiftLevel = (level: number, offset: number): number =>
  clamp(level + offset, 1, LEVEL_CAP)

export const shiftBand = (band: LevelBand, offset: number): LevelBand => ({
  min: shiftLevel(band.min, offset),
  max: shiftLevel(band.max, offset),
})
