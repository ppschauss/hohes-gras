import { describe, expect, it } from 'vitest'
import type { SpeciesDef } from '@game/content'
import { createRng } from './rng.js'
import { addEvs, computeStats, ivPercent, natureMultiplier, powerRating, randomIvs, zeroEvs, IV_MAX, EV_MAX_TOTAL } from './stats.js'

/** Garchomp's real base stats — the canonical worked example for the stat
 *  formula, so the expected numbers below are externally verifiable. */
const garchomp = {
  id: 'garchomp', dexNumber: 445, name: { de: 'Knakrack' }, types: ['dragon', 'ground'],
  baseStats: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 },
  growthRate: 'slow', catchRate: 45, baseXpYield: 270, hatchCycles: 30, eggGroups: ['monster'],
  learnset: [{ moveId: 'tackle', level: 1 }], evolutions: [], sprite: '', spriteShiny: '',
} as unknown as SpeciesDef

const flat = (v: number) => ({ hp: v, atk: v, def: v, spa: v, spd: v, spe: v })

describe('computeStats', () => {
  it('trifft die bekannten Referenzwerte fuer Knakrack Lv78 (adamant)', () => {
    const ivs = { hp: 24, atk: 12, def: 30, spa: 16, spd: 23, spe: 5 }
    const evs = { hp: 74, atk: 190, def: 91, spa: 48, spd: 84, spe: 23 }
    const s = computeStats(garchomp, 78, ivs, evs, 'adamant')
    expect(s).toEqual({ hp: 289, atk: 278, def: 193, spa: 135, spd: 171, spe: 171 })
  })

  it('laesst hp von der Natur unberuehrt', () => {
    const a = computeStats(garchomp, 50, flat(31), zeroEvs(), 'adamant')
    const b = computeStats(garchomp, 50, flat(31), zeroEvs(), 'modest')
    expect(a.hp).toBe(b.hp)
    expect(a.atk).toBeGreaterThan(b.atk)
  })

  it('waechst monoton mit dem Level', () => {
    let prev = 0
    for (let lvl = 1; lvl <= 100; lvl++) {
      const s = computeStats(garchomp, lvl, flat(31), zeroEvs(), 'hardy')
      expect(s.hp).toBeGreaterThan(prev)
      prev = s.hp
    }
  })

  it('klemmt IVs und EVs auf ihre Obergrenzen', () => {
    const legal = computeStats(garchomp, 50, flat(31), flat(252), 'hardy')
    const cheated = computeStats(garchomp, 50, flat(999), flat(9999), 'hardy')
    expect(cheated).toEqual(legal)
  })
})

describe('natureMultiplier', () => {
  it('hebt und senkt je genau einen Wert', () => {
    expect(natureMultiplier('adamant', 'atk')).toBeCloseTo(1.1)
    expect(natureMultiplier('adamant', 'spa')).toBeCloseTo(0.9)
    expect(natureMultiplier('adamant', 'def')).toBe(1)
  })
  it('behandelt neutrale Naturen als 1', () => {
    for (const stat of ['atk', 'def', 'spa', 'spd', 'spe'] as const) {
      expect(natureMultiplier('hardy', stat)).toBe(1)
      expect(natureMultiplier('quirky', stat)).toBe(1)
    }
  })
})

describe('IVs und EVs', () => {
  it('randomIvs bleibt im gueltigen Bereich', () => {
    const rng = createRng('ivs')
    for (let i = 0; i < 500; i++) {
      for (const v of Object.values(randomIvs(rng))) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(IV_MAX)
      }
    }
  })

  it('ivPercent liefert 0 und 100 an den Raendern', () => {
    expect(ivPercent(flat(0))).toBe(0)
    expect(ivPercent(flat(IV_MAX))).toBe(100)
  })

  it('addEvs respektiert das Gesamtlimit', () => {
    let evs = zeroEvs()
    for (let i = 0; i < 20; i++) evs = addEvs(evs, flat(100))
    const total = Object.values(evs).reduce((a, b) => a + b, 0)
    expect(total).toBeLessThanOrEqual(EV_MAX_TOTAL)
  })

  it('addEvs respektiert das Einzellimit', () => {
    const evs = addEvs(zeroEvs(), { atk: 400 })
    expect(evs.atk).toBe(252)
  })

  it('addEvs ignoriert negative Gaben', () => {
    const evs = addEvs({ ...zeroEvs(), atk: 50 }, { atk: -30 })
    expect(evs.atk).toBe(50)
  })
})

describe('powerRating', () => {
  it('steigt mit Level und Werten', () => {
    const low = powerRating(computeStats(garchomp, 10, flat(0), zeroEvs(), 'hardy'), 10)
    const high = powerRating(computeStats(garchomp, 100, flat(31), flat(252), 'hardy'), 100)
    expect(high).toBeGreaterThan(low * 5)
  })
})
