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

/**
 * Wie lange ein Spieltag dauert.
 *
 * Fuenf Stunden statt vierundzwanzig. Die Uhr lief bisher in Echtzeit, und
 * damit lag "Nacht" fuer die meisten im Schlaf: gemeldet als "weiss nicht, wie
 * ich den Tagesrhythmus in nem Game halten soll". Gemessen haengen 17 Prozent
 * aller Vorkommen an einer Tageszeit, davon zwei Drittel an der Nacht — wer
 * nachmittags spielt, sah dieses Drittel nie.
 *
 * Warum ausgerechnet fuenf: die Laenge darf **nicht** in vierundzwanzig
 * aufgehen. Bei vier Stunden saehe jemand, der immer um sieben spielt, jeden
 * Abend dieselbe Tageszeit — der Fehler waere derselbe wie vorher, nur
 * schneller. Fuenf verschiebt sich taeglich um vier Fuenftel eines Zyklus und
 * fuehrt damit ueber eine Woche jede Tageszeit an jede Uhrzeit.
 */
export const GAME_DAY_MINUTES = 300

/**
 * Die vier Abschnitte, in Minuten, in ihrer Reihenfolge.
 *
 * Die Anteile folgen dem, was vorher galt (3/10/3/8 von vierundzwanzig), mit
 * einem kleinen Zuschlag fuer Morgengrauen und Abenddaemmerung: an ihnen
 * haengen Latias, Latios und Celebi, und sie waren die knappsten.
 */
const PHASES: Array<{ time: TimeOfDay; minutes: number }> = [
  { time: 'dawn', minutes: 40 },
  { time: 'day', minutes: 120 },
  { time: 'dusk', minutes: 40 },
  { time: 'night', minutes: 100 },
]

/**
 * Minuten seit einem festen Punkt, aus der absoluten Zeit.
 *
 * Bewusst nicht ueber die Ortszeit: der Zyklus haengt nicht mehr an der
 * Wanduhr, und die Sommerzeit darf ihn nicht um eine Stunde springen lassen.
 * So sehen alle Spieler ueberall denselben Himmel — dieselbe Zusage wie
 * vorher, nur ohne Zeitzone.
 */
const minutesSince = (at: Date): number => Math.floor(at.getTime() / 60_000)

export function timeOfDayAt(at = new Date()): TimeOfDay {
  let rest = minutesSince(at) % GAME_DAY_MINUTES
  for (const phase of PHASES) {
    if (rest < phase.minutes) return phase.time
    rest -= phase.minutes
  }
  return PHASES[PHASES.length - 1]!.time
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
export const WEATHER_BLOCK_MINUTES = 45

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
  /*
   * Auch das Wetter haengt jetzt an der absoluten Zeit statt an der Wanduhr.
   *
   * Fuenfundvierzig Minuten je Block: ein Spieltag von fuenf Stunden hat damit
   * knapp sieben Wetterlagen, ungefaehr so viele wie vorher ein Tag von
   * vierundzwanzig. Schneller waere Flackern, langsamer haette ein Spieltag
   * oft nur ein einziges Wetter — und die Legendaeren haengen daran.
   */
  const block = Math.floor(minutesSince(at) / WEATHER_BLOCK_MINUTES)
  const rng = createRng(`weather:${block}`)
  const table: [Weather, number][] = [
    ['clear', 28], ['rain', 14], ['fog', 12], ['storm', 12],
    ['snow', 11], ['sandstorm', 11], ['heat', 12],
  ]
  return rng.weighted(table, ([, w]) => w)[0]
}

/**
 * Wann sich der naechste Wert aendert.
 *
 * Gesucht wird minutenweise, nicht mehr stuendlich: seit der Spieltag fuenf
 * Stunden dauert, sind seine Abschnitte vierzig bis hundert Minuten lang, und
 * eine Suche in Stundenschritten haette sie uebersprungen. Beides ist
 * berechenbar, also wird es berechnet, statt den Spieler raten zu lassen.
 */
function nextChange<T>(at: Date, valueAt: (d: Date) => T): { value: T; at: number } {
  const current = valueAt(at)
  // Auf die volle Minute, damit die Anzeige nicht bei Sekundenbruchteilen springt.
  const start = Math.floor(at.getTime() / 60_000) * 60_000
  for (let i = 1; i <= GAME_DAY_MINUTES; i++) {
    const probe = new Date(start + i * 60_000)
    const value = valueAt(probe)
    if (value !== current) return { value, at: probe.getTime() }
  }
  return { value: current, at: start + GAME_DAY_MINUTES * 60_000 }
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
