import { describe, expect, it } from 'vitest'
import type { SpeciesDef } from '@game/content'
import {
  applyCare, condition, currentHpRatio, friendshipTier, regenerateEnergy,
  CARE_RULES, ENERGY_MAX, FRIENDSHIP_MAX, type CareCreature,
} from './care.js'
import { xpForLevel } from './leveling.js'

const species = {
  id: 'testmon', growthRate: 'medium_fast',
  baseStats: { hp: 50, atk: 50, def: 50, spa: 50, spd: 50, spe: 50 },
} as unknown as SpeciesDef
const speciesOf = () => species

const creature = (over: Partial<CareCreature> = {}): CareCreature => ({
  id: 'c1', speciesId: 'testmon', xp: 1000, friendship: 70, energy: 60, level: 10, ...over,
})

describe('applyCare', () => {
  it('gibt jedem Teammitglied EP und Freundschaft', () => {
    const team = [creature({ id: 'a' }), creature({ id: 'b' })]
    const r = applyCare('play', team, speciesOf, 0)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.results).toHaveLength(2)
    for (const res of r.results) {
      expect(res.xpGained).toBeGreaterThan(0)
      expect(res.friendshipAfter).toBe(res.friendshipBefore + CARE_RULES.play.friendship)
    }
  })

  it('teilt den Ertrag mit der Teamgroesse, belohnt breite Teams aber insgesamt', () => {
    const solo = applyCare('feed', [creature()], speciesOf, 1)
    const full = applyCare('feed', Array.from({ length: 5 }, (_, i) => creature({ id: `c${i}` })), speciesOf, 1)
    expect(solo.ok && full.ok).toBe(true)
    if (!solo.ok || !full.ok) return
    const perHeadSolo = solo.results[0]!.xpGained
    const perHeadFull = full.results[0]!.xpGained
    expect(perHeadFull).toBeLessThan(perHeadSolo)
    const totalFull = full.results.reduce((s, r) => s + r.xpGained, 0)
    expect(totalFull).toBeGreaterThan(perHeadSolo)
  })

  it('belohnt hohe Freundschaft mit mehr EP', () => {
    const cold = applyCare('play', [creature({ friendship: 0 })], speciesOf, 0)
    const warm = applyCare('play', [creature({ friendship: FRIENDSHIP_MAX })], speciesOf, 0)
    expect(cold.ok && warm.ok).toBe(true)
    if (!cold.ok || !warm.ok) return
    expect(warm.results[0]!.xpGained).toBeGreaterThan(cold.results[0]!.xpGained)
  })

  it('weist ein leeres Team ab', () => {
    expect(applyCare('play', [], speciesOf, 0)).toEqual({ ok: false, reason: 'empty_team' })
  })

  it('kennt kein Tageslimit mehr — begrenzt wird ueber Trainer-Energie', () => {
    // Hundert Aufrufe hintereinander: frueher waeren die letzten 88 abgelehnt
    // worden. Die Schranke sitzt jetzt eine Ebene hoeher, im Energiekonto.
    for (let i = 0; i < 100; i++) {
      expect(applyCare('play', [creature()], speciesOf, 0).ok).toBe(true)
    }
  })

  it('verlangt eine Beere zum Fuettern', () => {
    const r = applyCare('feed', [creature()], speciesOf, 0)
    expect(r).toEqual({ ok: false, reason: 'needs_item', itemId: 'oran-berry', quantity: 1 })
  })

  it('verbraucht die Beere genau einmal, nicht pro Pokemon', () => {
    const team = Array.from({ length: 5 }, (_, i) => creature({ id: `c${i}` }))
    const r = applyCare('feed', team, speciesOf, 1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.consumed).toEqual({ itemId: 'oran-berry', quantity: 1 })
  })

  it('verhindert Spielen mit erschoepften Pokemon und nennt das betroffene', () => {
    const team = [creature({ id: 'fit', energy: 90 }), creature({ id: 'muede', energy: 2 })]
    const r = applyCare('play', team, speciesOf, 0)
    expect(r).toEqual({ ok: false, reason: 'too_tired', creatureId: 'muede' })
  })

  it('laesst Ausruhen immer zu, damit der Kreislauf nie blockiert', () => {
    const r = applyCare('rest', [creature({ energy: 0 })], speciesOf, 0)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.results[0]!.energyAfter).toBe(CARE_RULES.rest.energy)
  })

  it('deckelt Energie und Freundschaft an ihren Obergrenzen', () => {
    const r = applyCare('feed', [creature({ energy: ENERGY_MAX, friendship: FRIENDSHIP_MAX })], speciesOf, 1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.results[0]!.energyAfter).toBe(ENERGY_MAX)
    expect(r.results[0]!.friendshipAfter).toBe(FRIENDSHIP_MAX)
  })

  it('meldet Levelaufstiege', () => {
    // medium_fast: Level 10 beginnt bei 1000 EP. Level und EP muessen zueinander
    // passen — sonst repariert die Invariante die Zeile, und der Test misst
    // etwas anderes als er glaubt.
    const r = applyCare('feed', [creature({ xp: 999, level: 9 })], speciesOf, 1)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.results[0]!.leveledUp).toBe(true)
    expect(r.results[0]!.xp.levelBefore).toBe(9)
    expect(r.results[0]!.xp.levelAfter).toBe(10)
  })

  it('stuft ein Pokemon mit zurueckgebliebenen EP nicht zurueck', () => {
    // Level 40 mit EP-Stand von Level 1: die Pflege darf daraus kein Level-1-
    // Pokemon machen.
    const r = applyCare('play', [creature({ xp: 0, level: 40 })], speciesOf, 0)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.results[0]!.xp.levelBefore).toBe(40)
    expect(r.results[0]!.xp.levelAfter).toBeGreaterThanOrEqual(40)
  })

  it('bleibt ohne Nebenwirkung auf den Eingabedaten', () => {
    const c = creature()
    const before = { ...c }
    applyCare('feed', [c], speciesOf, 1)
    expect(c).toEqual(before)
  })
})

describe('regenerateEnergy', () => {
  it('fuellt ueber die Zeit auf', () => {
    expect(regenerateEnergy(0, 600)).toBe(60)
  })
  it('deckelt bei 100', () => {
    expect(regenerateEnergy(90, 10_000)).toBe(ENERGY_MAX)
  })
  it('bleibt bei null Minuten unveraendert', () => {
    expect(regenerateEnergy(42, 0)).toBe(42)
  })
})

describe('condition', () => {
  it('reicht von 0 bis 100', () => {
    expect(condition(0, 0, 0)).toBe(0)
    expect(condition(ENERGY_MAX, FRIENDSHIP_MAX, 1)).toBe(100)
  })
  it('gewichtet KP am staerksten', () => {
    expect(condition(0, 0, 1)).toBeGreaterThan(condition(ENERGY_MAX, 0, 0))
  })
})

describe('friendshipTier', () => {
  it('staffelt aufsteigend', () => {
    expect(friendshipTier(0)).toBe('fremd')
    expect(friendshipTier(70)).toBe('vertraut')
    expect(friendshipTier(150)).toBe('freundschaftlich')
    expect(friendshipTier(255)).toBe('unzertrennlich')
  })
})

describe('currentHpRatio', () => {
  const stats = { hp: 100, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }
  it('rechnet den Anteil', () => {
    expect(currentHpRatio(50, stats)).toBe(0.5)
  })
  it('klemmt ausserhalb des Bereichs', () => {
    expect(currentHpRatio(-10, stats)).toBe(0)
    expect(currentHpRatio(999, stats)).toBe(1)
  })
})


describe('applyCare mit EP-Bonus aus dem Trainingsdojo', () => {
  it('erhoeht die EP prozentual', () => {
    const plain = applyCare('play', [creature()], speciesOf, 0)
    const boosted = applyCare('play', [creature()], speciesOf, 0, 40)
    expect(plain.ok && boosted.ok).toBe(true)
    if (!plain.ok || !boosted.ok) return
    expect(boosted.results[0]!.xpGained).toBeGreaterThan(plain.results[0]!.xpGained)
  })

  it('bleibt ohne Bonus beim Grundwert', () => {
    const a = applyCare('play', [creature()], speciesOf, 0)
    const b = applyCare('play', [creature()], speciesOf, 0, 0)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    expect(b.results[0]!.xpGained).toBe(a.results[0]!.xpGained)
  })
})

describe('Pflege-EP wachsen mit dem Level', () => {
  const speciesOf = () => ({
    id: 'x', growthRate: 'medium_fast', baseStats: { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 },
  }) as never

  const feedOnce = (level: number) => {
    const xp = xpForLevel('medium_fast', level)
    const res = applyCare('feed', [{ id: 'a', speciesId: 'x', xp, level, friendship: 0, energy: 50 }], speciesOf, 9)
    if (!res.ok) throw new Error('Pflege abgelehnt')
    return res.results[0]!.xpGained
  }

  it('haelt die Zahl der Aktionen je Level konstant', () => {
    // Vorher waren es bei Level 5 drei Aktionen und bei Level 40 einhundert-
    // achtzig. Jetzt ueberall rund 25.
    for (const level of [20, 40, 80]) {
      const span = xpForLevel('medium_fast', level + 1) - xpForLevel('medium_fast', level)
      const actions = span / feedOnce(level)
      expect(actions).toBeGreaterThan(20)
      expect(actions).toBeLessThan(30)
    }
  })

  it('laesst die kleinen Level in Ruhe', () => {
    // Unter Level 17 ist eine Levelspanne kleiner als die Bezugsgroesse — dort
    // gilt weiter der flache Wert, sonst waere die Aenderung eine Bremse.
    expect(feedOnce(5)).toBe(32)
  })
})
