import { describe, expect, it } from 'vitest'
import { GROWTH_RATES, type GrowthRate } from '@game/shared'
import {
  battleXpYield, grantXp, grantXpTo, levelForXp, levelProgress, reconcileXp, xpForLevel, MAX_LEVEL,
} from './leveling.js'

describe('xpForLevel', () => {
  it('startet fuer jede Kurve bei 0', () => {
    for (const rate of GROWTH_RATES) expect(xpForLevel(rate, 1)).toBe(0)
  })

  it('trifft die bekannten Endwerte auf Level 100', () => {
    expect(xpForLevel('fast', 100)).toBe(800_000)
    expect(xpForLevel('medium_fast', 100)).toBe(1_000_000)
    expect(xpForLevel('medium_slow', 100)).toBe(1_059_860)
    expect(xpForLevel('slow', 100)).toBe(1_250_000)
    expect(xpForLevel('erratic', 100)).toBe(600_000)
    expect(xpForLevel('fluctuating', 100)).toBe(1_640_000)
  })

  it('ist auf jeder Kurve streng monoton', () => {
    for (const rate of GROWTH_RATES) {
      for (let lvl = 2; lvl <= MAX_LEVEL; lvl++) {
        expect(xpForLevel(rate, lvl)).toBeGreaterThan(xpForLevel(rate, lvl - 1))
      }
    }
  })
})

describe('levelForXp', () => {
  it('ist die Umkehrung von xpForLevel', () => {
    for (const rate of GROWTH_RATES) {
      for (let lvl = 1; lvl <= MAX_LEVEL; lvl++) {
        expect(levelForXp(rate, xpForLevel(rate, lvl))).toBe(lvl)
      }
    }
  })

  it('rundet innerhalb eines Levels nach unten ab', () => {
    const rate: GrowthRate = 'medium_fast'
    const at50 = xpForLevel(rate, 50)
    const at51 = xpForLevel(rate, 51)
    expect(levelForXp(rate, at50 + 1)).toBe(50)
    expect(levelForXp(rate, at51 - 1)).toBe(50)
  })

  it('klemmt bei 1 und 100', () => {
    expect(levelForXp('slow', -999)).toBe(1)
    expect(levelForXp('slow', 99_999_999)).toBe(MAX_LEVEL)
  })
})

describe('grantXp', () => {
  it('meldet die Zahl der gewonnenen Level', () => {
    const r = grantXp('medium_fast', 0, xpForLevel('medium_fast', 12))
    expect(r.levelBefore).toBe(1)
    expect(r.levelAfter).toBe(12)
    expect(r.levelsGained).toBe(11)
  })

  it('deckelt bei Level 100 statt ins Leere zu wachsen', () => {
    const cap = xpForLevel('slow', MAX_LEVEL)
    const r = grantXp('slow', cap - 10, 5_000_000)
    expect(r.totalXp).toBe(cap)
    expect(r.levelAfter).toBe(MAX_LEVEL)
  })

  it('ignoriert negative Betraege', () => {
    const r = grantXp('fast', 5000, -1000)
    expect(r.totalXp).toBe(5000)
  })
})

describe('levelProgress', () => {
  it('meldet den Fortschritt innerhalb des Levels', () => {
    const rate: GrowthRate = 'fast'
    const base = xpForLevel(rate, 20)
    const span = xpForLevel(rate, 21) - base
    const p = levelProgress(rate, base + Math.floor(span / 2))
    expect(p.level).toBe(20)
    expect(p.xpForNextLevel).toBe(span)
    expect(p.xpIntoLevel).toBe(Math.floor(span / 2))
    expect(p.isMaxLevel).toBe(false)
  })

  it('markiert Level 100 als Maximum', () => {
    const p = levelProgress('fast', xpForLevel('fast', MAX_LEVEL))
    expect(p.isMaxLevel).toBe(true)
    expect(p.xpForNextLevel).toBe(0)
  })
})

describe('battleXpYield', () => {
  it('belohnt staerkere Gegner mehr', () => {
    expect(battleXpYield(100, 50, 50)).toBeGreaterThan(battleXpYield(100, 10, 50))
  })

  it('entwertet weit unterlegene Gegner, statt Grinding zu belohnen', () => {
    const fair = battleXpYield(100, 50, 50)
    const trivial = battleXpYield(100, 5, 50)
    expect(trivial).toBeLessThan(fair / 5)
  })

  it('gibt nie weniger als 1', () => {
    expect(battleXpYield(1, 1, 100)).toBeGreaterThanOrEqual(1)
  })
})


describe('reconcileXp', () => {
  it('laesst stimmige Werte unveraendert', () => {
    const xp = xpForLevel('medium_fast', 30) + 500
    expect(reconcileXp('medium_fast', xp, 30)).toBe(xp)
  })

  it('hebt zurueckgebliebene EP auf das Level an', () => {
    // Genau der Fall, der ein Level-50-Pokemon auf Level 1 zurueckwarf:
    // Level gesetzt, EP vergessen.
    expect(reconcileXp('medium_fast', 0, 50)).toBe(xpForLevel('medium_fast', 50))
  })

  it('nimmt niemals ein Level weg', () => {
    for (const level of [1, 10, 50, 100]) {
      const reconciled = reconcileXp('slow', 0, level)
      expect(levelForXp('slow', reconciled)).toBe(level)
    }
  })

  it('behandelt negative EP als null', () => {
    expect(reconcileXp('fast', -500, 1)).toBe(0)
  })
})

describe('grantXpTo', () => {
  it('stuft ein Pokemon mit fehlenden EP nicht zurueck', () => {
    const r = grantXpTo('medium_fast', 0, 50, 100)
    expect(r.levelBefore).toBe(50)
    expect(r.levelAfter).toBeGreaterThanOrEqual(50)
  })

  it('verhaelt sich bei stimmigen Werten wie grantXp', () => {
    const xp = xpForLevel('slow', 20)
    expect(grantXpTo('slow', xp, 20, 1000)).toEqual(grantXp('slow', xp, 1000))
  })
})
