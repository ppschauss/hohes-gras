import { describe, expect, it } from 'vitest'
import { GAME_DAY_MINUTES, WEATHER_BLOCK_MINUTES, timeOfDayAt, weatherAt } from '../src/worldClock.js'
import { TIMES_OF_DAY, WEATHERS, type Weather } from '@game/shared'

/**
 * Wetter als Engpass.
 *
 * Gemeldet: die letzten Arten einer Region haengen an einem Wetter, und das
 * kam gut viermal die Woche. Gemessen war Sandsturm alle hundert Stunden fuer
 * je sechs zu haben. Diese Tests halten fest, dass daraus etwas Erreichbares
 * geworden ist — nicht durch Ansehen, sondern durch Auszaehlen eines Jahres.
 */
const blocksOfAYear = (): Weather[] => {
  const out: Weather[] = []
  const start = Date.UTC(2026, 0, 1)
  for (let m = 0; m < 365 * 24 * 60; m += WEATHER_BLOCK_MINUTES) {
    out.push(weatherAt(new Date(start + m * 60_000)))
  }
  return out
}

describe('Weltwetter', () => {
  it('steht dreiviertel Stunden — knapp sieben Lagen je Spieltag', () => {
    expect(WEATHER_BLOCK_MINUTES).toBe(45)
    expect(GAME_DAY_MINUTES / WEATHER_BLOCK_MINUTES).toBeGreaterThan(6)
  })

  it('bringt jedes Wetter oefter als alle 24 Stunden', () => {
    const blocks = blocksOfAYear()
    const perHour = blocks.length / (365 * 24)
    for (const w of WEATHERS) {
      const share = blocks.filter((x) => x === w).length / blocks.length
      const hoursBetween = 1 / (share * perHour)
      expect(share, `${w} kommt gar nicht vor`).toBeGreaterThan(0)
      // Vorher lagen Sandsturm und Hitze bei hundert Stunden.
      expect(hoursBetween, `${w} kommt nur alle ${hoursBetween.toFixed(0)} h`).toBeLessThan(24)
    }
  })

  it('laesst klares Wetter das haeufigste bleiben', () => {
    const blocks = blocksOfAYear()
    const count = (w: Weather) => blocks.filter((x) => x === w).length
    for (const w of WEATHERS) {
      if (w !== 'clear') expect(count('clear')).toBeGreaterThan(count(w))
    }
  })

  it('zeigt allen Spielern denselben Himmel', () => {
    const at = new Date('2026-08-31T13:37:00Z')
    expect(weatherAt(at)).toBe(weatherAt(at))
  })

  it('haengt nicht mehr an der Wanduhr', () => {
    /*
     * Der Zyklus rechnet aus der absoluten Zeit. Damit springt er nicht, wenn
     * die Sommerzeit umgestellt wird — und er ist ueberall auf der Welt
     * derselbe, ohne dass eine Zeitzone im Spiel waere.
     */
    const vorUmstellung = new Date('2026-03-29T00:30:00Z')
    const eineStundeSpaeter = new Date(vorUmstellung.getTime() + 3_600_000)
    expect(weatherAt(vorUmstellung)).toBe(weatherAt(vorUmstellung))
    expect(timeOfDayAt(eineStundeSpaeter)).toBe(timeOfDayAt(eineStundeSpaeter))
  })
})

describe('Der Spieltag', () => {
  /*
   * Gemeldet: "weiss nicht, wie ich den Tagesrhythmus in nem Game halten
   * soll". Die Uhr lief in Echtzeit, also lag die Nacht — an der zwei Drittel
   * aller zeitgebundenen Vorkommen haengen — fuer die meisten im Schlaf.
   */
  it('dauert fuenf Stunden und enthaelt alle vier Zeiten', () => {
    expect(GAME_DAY_MINUTES).toBe(300)
    const start = Date.UTC(2026, 5, 1)
    const gesehen = new Set<string>()
    for (let m = 0; m < GAME_DAY_MINUTES; m++) gesehen.add(timeOfDayAt(new Date(start + m * 60_000)))
    expect([...gesehen].sort()).toEqual([...TIMES_OF_DAY].sort())
  })

  it('geht nicht in vierundzwanzig Stunden auf', () => {
    /*
     * Der eigentliche Punkt. Bei vier Stunden saehe jemand, der immer um
     * sieben spielt, jeden Abend dieselbe Tageszeit — derselbe Fehler wie
     * vorher, nur schneller.
     */
    expect((24 * 60) % GAME_DAY_MINUTES).not.toBe(0)

    for (const stunde of [7, 12, 19, 22]) {
      const gesehen = new Set<string>()
      for (let tag = 0; tag < 7; tag++) {
        gesehen.add(timeOfDayAt(new Date(Date.UTC(2026, 5, 1 + tag, stunde))))
      }
      expect(gesehen.size, `wer immer um ${stunde} Uhr spielt, sieht nur ${[...gesehen]}`)
        .toBeGreaterThan(2)
    }
  })
})
