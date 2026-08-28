import { describe, expect, it } from 'vitest'
import type { SpeciesDef } from '@game/content'
import { createRng } from './rng.js'
import {
  DURATIONS, KINDS, MAX_PARTY, energyCost, findDuration, findKind,
  partyRating, resolveExpedition, type ExpeditionParty,
} from './expedition.js'

const speciesOf = (id: string): SpeciesDef =>
  ({ id, types: id === 'grasmon' ? ['grass'] : ['fire'] } as SpeciesDef)

const member = (over: Partial<ExpeditionParty> = {}): ExpeditionParty => ({
  creatureId: 'c1', speciesId: 'grasmon', level: 30, energy: 100, ...over,
})

const forage = findKind('forage')!
const short = findDuration('short')!
const long = findDuration('long')!

describe('Aufbau', () => {
  it('kennt alle Dauern und Arten', () => {
    expect(DURATIONS).toHaveLength(3)
    expect(KINDS.length).toBeGreaterThanOrEqual(4)
    expect(findKind('gibtsnicht')).toBeUndefined()
  })

  it('haelt fuer jede Beutetabelle positive Gewichte vor', () => {
    for (const kind of KINDS) {
      expect(kind.lootTable.length).toBeGreaterThan(0)
      expect(kind.lootTable.every((e) => e.weight > 0 && e.min <= e.max)).toBe(true)
    }
  })

  it('laesst laengere Reisen pro Minute besser zahlen', () => {
    const perMinute = DURATIONS.map((d) => d.yieldFactor / d.minutes)
    for (let i = 1; i < perMinute.length; i++) {
      expect(perMinute[i]!).toBeGreaterThan(perMinute[i - 1]!)
    }
  })
})

describe('partyRating', () => {
  it('ist ohne Team null', () => {
    expect(partyRating([], forage, speciesOf)).toBe(0)
  })

  it('belohnt passende Typen', () => {
    const matching = partyRating([member({ speciesId: 'grasmon' })], forage, speciesOf)
    const mismatched = partyRating([member({ speciesId: 'feuermon' })], forage, speciesOf)
    expect(matching).toBeGreaterThan(mismatched)
  })

  it('belohnt Level und Energie', () => {
    expect(partyRating([member({ level: 60 })], forage, speciesOf))
      .toBeGreaterThan(partyRating([member({ level: 5 })], forage, speciesOf))
    expect(partyRating([member({ energy: 100 })], forage, speciesOf))
      .toBeGreaterThan(partyRating([member({ energy: 10 })], forage, speciesOf))
  })

  it('bleibt zwischen 0 und 1, auch bei vollem Team', () => {
    const full = Array.from({ length: MAX_PARTY }, (_, i) => member({ creatureId: `c${i}`, level: 100 }))
    const r = partyRating(full, forage, speciesOf)
    expect(r).toBeGreaterThan(0)
    expect(r).toBeLessThanOrEqual(1)
  })
})

describe('energyCost', () => {
  it('waechst mit der Dauer', () => {
    expect(energyCost(long)).toBeGreaterThan(energyCost(short))
  })
  it('bleibt fuer die laengste Reise unter der vollen Energie', () => {
    expect(energyCost(long)).toBeLessThanOrEqual(100)
  })
})

describe('resolveExpedition', () => {
  it('kommt nie mit leeren Haenden zurueck', () => {
    const rng = createRng('loot')
    for (let i = 0; i < 200; i++) {
      const out = resolveExpedition(forage, short, 0, [member({ level: 1, energy: 1 })], rng)
      expect(out.loot.length).toBeGreaterThan(0)
      expect(out.gold).toBeGreaterThan(0)
    }
  })

  it('belohnt starke Teams mehr als schwache', () => {
    const rng = createRng('rating')
    const weak = resolveExpedition(forage, long, 0, [member()], rng)
    const strong = resolveExpedition(forage, long, 1, [member()], createRng('rating'))
    expect(strong.gold).toBeGreaterThan(weak.gold)
  })

  it('belohnt lange Reisen deutlich mehr', () => {
    const a = resolveExpedition(forage, short, 0.8, [member()], createRng('d'))
    const b = resolveExpedition(forage, long, 0.8, [member()], createRng('d'))
    expect(b.gold).toBeGreaterThan(a.gold * 5)
  })

  it('teilt die EP unter den Mitgliedern auf', () => {
    const solo = resolveExpedition(forage, long, 0.8, [member()], createRng('xp'))
    const trio = resolveExpedition(forage, long, 0.8,
      [member({ creatureId: 'a' }), member({ creatureId: 'b' }), member({ creatureId: 'c' })], createRng('xp'))
    expect(trio.xpPerMember).toBeLessThan(solo.xpPerMember)
  })

  it('fasst gleiche Beute zusammen statt sie zu doppeln', () => {
    const out = resolveExpedition(forage, long, 1, [member()], createRng('merge'))
    const ids = out.loot.map((l) => l.itemId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('ist bei gleichem Seed reproduzierbar', () => {
    const run = () => resolveExpedition(forage, long, 0.7, [member()], createRng('same'))
    expect(run()).toEqual(run())
  })
})
