import { describe, expect, it } from 'vitest'
import { WEATHER_BLOCK_HOURS, weatherAt } from '../src/worldClock.js'
import { WEATHERS, type Weather } from '@game/shared'

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
  for (let h = 0; h < 365 * 24; h += WEATHER_BLOCK_HOURS) {
    out.push(weatherAt(new Date(start + h * 3_600_000)))
  }
  return out
}

describe('Weltwetter', () => {
  it('steht zwei Stunden, nicht sechs', () => {
    expect(WEATHER_BLOCK_HOURS).toBe(2)
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
})
