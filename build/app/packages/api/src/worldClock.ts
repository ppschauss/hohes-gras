import { TIMES_OF_DAY, WEATHERS, type TimeOfDay, type Weather, type WorldClock } from '@game/shared'
import { createRng } from '@game/engine'

const TZ = 'Europe/Berlin'

/** Local wall-clock parts in the game's timezone, independent of the host TZ.
 *  Everything time-dependent goes through here so a container started with the
 *  wrong TZ cannot silently shift daily resets. */
export function berlinParts(at = new Date()): { date: string; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  })
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}

export function gameDate(at = new Date()): string {
  return berlinParts(at).date
}

export function timeOfDayAt(at = new Date()): TimeOfDay {
  const { hour } = berlinParts(at)
  if (hour >= 5 && hour < 8) return 'dawn'
  if (hour >= 8 && hour < 18) return 'day'
  if (hour >= 18 && hour < 21) return 'dusk'
  return 'night'
}

/** Weather is deterministic from date + 6-hour block, so every player in the
 *  world sees the same sky and nobody can reroll it by reloading. */
export function weatherAt(at = new Date()): Weather {
  const { date, hour } = berlinParts(at)
  const block = Math.floor(hour / 6)
  const rng = createRng(`weather:${date}:${block}`)
  const table: [Weather, number][] = [
    ['clear', 45], ['rain', 16], ['fog', 12], ['storm', 8],
    ['snow', 7], ['sandstorm', 6], ['heat', 6],
  ]
  return rng.weighted(table, ([, w]) => w)[0]
}

export function worldClock(at = new Date()): WorldClock {
  return { timeOfDay: timeOfDayAt(at), weather: weatherAt(at), gameDate: gameDate(at) }
}

export const ALL_TIMES_OF_DAY = TIMES_OF_DAY
export const ALL_WEATHERS = WEATHERS

/**
 * Mitternacht der Spielzeitzone in Millisekunden.
 *
 * Die Grenze, an der jedes Tageslimit umspringt — Duelle, Kaempfe, Zaehler.
 * Sie steht hier und nicht in den Diensten, damit "einmal am Tag" ueberall
 * denselben Tag meint.
 */
export function dayStart(at = new Date()): number {
  return new Date(`${gameDate(at)}T00:00:00`).getTime()
}
