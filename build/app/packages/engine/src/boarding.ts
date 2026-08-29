import { clamp } from './stats.js'

/**
 * Die Pension.
 *
 * Man gibt bis zu fünf Pokémon ab, und sie werden einen Tag lang trainiert.
 * Erfahrung sammelt sich dabei kontinuierlich an — nicht in einem Klumpen am
 * Ende, sondern jede Minute ein Stück. Das ist der entscheidende Unterschied
 * zur Expedition: wer vorzeitig abholt, verliert nichts von dem, was schon
 * verdient ist.
 *
 * Der Preis dafür ist die Bindung: vierundzwanzig Stunden lang kämpft, reist
 * und forscht keines von ihnen. Wer sie früher braucht, holt sie ab — das
 * kostet Energie, aber nie den Fortschritt.
 */

/** Wie viele gleichzeitig in Pension gehen können. */
export const BOARDING_SLOTS = 5

/** Wie lange ein Aufenthalt dauert. */
export const BOARDING_MS = 24 * 3_600_000

/**
 * Wie viele Level ein voller Aufenthalt höchstens bringt.
 *
 * Zehn, und die Grenze ist der eigentliche Entwurf: ohne sie wäre die Pension
 * für ein frisch geschlüpftes Pokémon ein Sprung auf Kampfniveau und für ein
 * ausgewachsenes ein Rundungsfehler. Mit ihr ist sie für beide dasselbe — ein
 * Tag Arbeit, zehn Level.
 */
export const BOARDING_MAX_LEVELS = 10

/**
 * Der Anteil des Aufenthalts, der bis `now` verstrichen ist.
 *
 * Gedeckelt bei eins: wer sein Pokémon drei Tage stehen lässt, bekommt nicht
 * dreißig Level. Die Pension hört nach ihrem Tag auf zu arbeiten.
 */
export function boardingProgress(startedAt: number, now: number, durationMs = BOARDING_MS): number {
  if (durationMs <= 0) return 1
  return clamp((now - startedAt) / durationMs, 0, 1)
}

/**
 * Wie viele Level ein Aufenthalt bis jetzt eingebracht hat.
 *
 * Ganze Level, weil sich alles andere nicht anzeigen lässt: „2,7 Level" ist
 * keine Zahl, mit der jemand rechnet. Die Erfahrung dazwischen geht nicht
 * verloren — sie wird beim Abholen als EP bis zum erreichten Level gutgeschrieben.
 */
export function boardingLevels(
  progress: number, maxLevels = BOARDING_MAX_LEVELS,
): number {
  return Math.floor(clamp(progress, 0, 1) * maxLevels)
}

/** Wann der Aufenthalt vorbei ist. */
export const boardingReadyAt = (startedAt: number, durationMs = BOARDING_MS): number =>
  startedAt + durationMs
