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

/**
 * Wie lange ein Wetter steht.
 *
 * Zwei Stunden, nicht sechs. Die Rechnung dahinter ist der Grund: bei sechs
 * Stunden und einem Gewicht von 6 von 100 kam Sandsturm im Schnitt alle
 * *hundert* Stunden — gut vier Tage —, und dann sechs Stunden lang, in denen
 * man auch wach und im Spiel sein musste. In Hoenn haengen 26 von 81 Arten
 * ausschliesslich an solchen Bedingungen, und wer die letzten zwei fuer eine
 * Freischaltung braucht, wartet auf einen Wuerfel, der zweimal die Woche
 * faellt. Genau so gemeldet.
 */
export const WEATHER_BLOCK_HOURS = 2

/**
 * Weather is deterministic from date + block, so every player in the world sees
 * the same sky and nobody can reroll it by reloading.
 *
 * Die Verteilung ist flacher als vorher. Sie war 45/16/12/8/7/6/6 — schoen
 * realistisch, aber sie machte drei der sieben Wetter zu Ereignissen statt zu
 * Wetter. Klar bleibt das haeufigste, weil ein Himmel, der staendig etwas
 * Besonderes tut, nichts Besonderes mehr hat; darunter liegt keines mehr unter
 * einem Zehntel.
 */
export function weatherAt(at = new Date()): Weather {
  const { date, hour } = berlinParts(at)
  const block = Math.floor(hour / WEATHER_BLOCK_HOURS)
  const rng = createRng(`weather:${date}:${block}`)
  const table: [Weather, number][] = [
    ['clear', 28], ['rain', 14], ['fog', 12], ['storm', 12],
    ['snow', 11], ['sandstorm', 11], ['heat', 12],
  ]
  return rng.weighted(table, ([, w]) => w)[0]
}

/**
 * Die naechste volle Stunde, zu der sich etwas aendert.
 *
 * Beides ist berechenbar, also wird es auch berechnet, statt den Spieler raten
 * zu lassen: die Tageszeit springt um 5, 8, 18 und 21 Uhr, das Wetter alle
 * zwei Stunden. Gesucht wird die naechste Stunde, in der der Wert ein anderer
 * ist — hoechstens vierundzwanzig Schritte, das ist billiger als jede
 * Sonderrechnung ueber Zeitzonen hinweg.
 */
function nextChange<T>(at: Date, valueAt: (d: Date) => T): { value: T; at: number } {
  const current = valueAt(at)
  for (let i = 1; i <= 24; i++) {
    // Auf die volle Stunde gehen: beide Werte haengen nur an ihr.
    const probe = new Date(at.getTime() + i * 3_600_000)
    probe.setMinutes(0, 0, 0)
    const value = valueAt(probe)
    if (value !== current) return { value, at: probe.getTime() }
  }
  return { value: current, at: at.getTime() + 24 * 3_600_000 }
}

export function worldClock(at = new Date()): WorldClock {
  const time = nextChange(at, timeOfDayAt)
  const sky = nextChange(at, weatherAt)
  return {
    timeOfDay: timeOfDayAt(at),
    weather: weatherAt(at),
    gameDate: gameDate(at),
    nextTimeOfDay: time.value,
    nextTimeOfDayAt: time.at,
    nextWeather: sky.value,
    nextWeatherAt: sky.at,
  }
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
