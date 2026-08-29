import { describe, expect, it } from 'vitest'
import {
  BROOD_IV_BONUS, BROOD_PHASES, broodCare, broodIvBonus, broodMinutes,
  broodPhasesDue, broodShinyExtra, nextBroodPhaseAt,
} from './brooding.js'

const HOUR = 3_600_000

describe('Brut-Beet', () => {
  it('macht die Schritte ueber die Brutzeit faellig', () => {
    const total = 4 * HOUR
    expect(broodPhasesDue(0, 0, total)).toBe(0)
    expect(broodPhasesDue(0, HOUR, total)).toBe(1)
    expect(broodPhasesDue(0, 3 * HOUR, total)).toBe(3)
    // Und hoert bei vier auf, egal wie lange man wartet.
    expect(broodPhasesDue(0, 40 * HOUR, total)).toBe(BROOD_PHASES)
  })

  it('nennt den naechsten Schritt und schweigt am Ende', () => {
    expect(nextBroodPhaseAt(0, 0, 4 * HOUR)).toBe(HOUR)
    expect(nextBroodPhaseAt(0, 3, 4 * HOUR)).toBe(4 * HOUR)
    expect(nextBroodPhaseAt(0, BROOD_PHASES, 4 * HOUR)).toBeNull()
  })

  it('nimmt den besseren Weg, nie die Summe', () => {
    expect(broodCare(4, null)).toBe(1)
    expect(broodCare(0, 100)).toBe(1)
    expect(broodCare(2, 50)).toBe(0.5)
    // Beides halb ergibt halb — und nicht ganz.
    expect(broodCare(2, null)).toBe(0.5)
  })

  it('kuerzt die Brutzeit um hoechstens ein Viertel', () => {
    expect(broodMinutes(100, 0)).toBe(100)
    expect(broodMinutes(100, 0.5)).toBe(88)
    expect(broodMinutes(100, 1)).toBe(75)
    // Nie auf null: ein Ei braucht immer noch Zeit.
    expect(broodMinutes(1, 1)).toBe(1)
  })

  it('legt hoechstens drei Punkte auf jeden Wert', () => {
    expect(broodIvBonus(0)).toBe(0)
    expect(broodIvBonus(0.5)).toBe(2)
    expect(broodIvBonus(1)).toBe(BROOD_IV_BONUS)
  })

  it('hebt die Shiny-Chance um die Haelfte', () => {
    const base = 1 / 512
    expect(broodShinyExtra(base, 0)).toBe(0)
    expect(broodShinyExtra(base, 1)).toBeCloseTo(base * 0.5, 10)
    // Zusammen also anderthalbfach.
    expect(base + broodShinyExtra(base, 1)).toBeCloseTo(base * 1.5, 10)
  })
})
