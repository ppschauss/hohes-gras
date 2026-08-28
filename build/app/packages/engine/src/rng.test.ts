import { describe, expect, it } from 'vitest'
import { createRng, deriveSeed } from './rng.js'

describe('createRng', () => {
  it('gibt fuer denselben Seed dieselbe Folge zurueck', () => {
    const a = Array.from({ length: 50 }, () => createRng('battle-42').next())
    const b = Array.from({ length: 50 }, () => createRng('battle-42').next())
    expect(a).toEqual(b)
  })

  it('erzeugt fuer denselben Seed eine reproduzierbare Sequenz', () => {
    const one = createRng('seed-x')
    const two = createRng('seed-x')
    const seqOne = Array.from({ length: 100 }, () => one.int(0, 1000))
    const seqTwo = Array.from({ length: 100 }, () => two.int(0, 1000))
    expect(seqOne).toEqual(seqTwo)
  })

  it('trennt unterschiedliche Seeds', () => {
    const a = Array.from({ length: 20 }, () => 0).map(() => createRng('a').next())
    const b = createRng('b').next()
    expect(a[0]).not.toBe(b)
  })

  it('haelt next() im Intervall [0,1)', () => {
    const rng = createRng('range')
    for (let i = 0; i < 5000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('haelt int() inklusive beider Grenzen ein und trifft beide', () => {
    const rng = createRng('int')
    const seen = new Set<number>()
    for (let i = 0; i < 5000; i++) {
      const v = rng.int(1, 6)
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(6)
      seen.add(v)
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('behandelt chance(0) und chance(100) als absolut', () => {
    const rng = createRng('chance')
    for (let i = 0; i < 200; i++) {
      expect(rng.chance(0)).toBe(false)
      expect(rng.chance(100)).toBe(true)
    }
  })

  it('trifft chance(p) statistisch', () => {
    const rng = createRng('stat')
    let hits = 0
    for (let i = 0; i < 20000; i++) if (rng.chance(25)) hits++
    expect(hits / 20000).toBeGreaterThan(0.23)
    expect(hits / 20000).toBeLessThan(0.27)
  })

  it('gewichtet weighted() proportional', () => {
    const rng = createRng('weights')
    const items = [
      { id: 'haeufig', w: 90 },
      { id: 'selten', w: 10 },
      { id: 'nie', w: 0 },
    ]
    const counts: Record<string, number> = { haeufig: 0, selten: 0, nie: 0 }
    for (let i = 0; i < 20000; i++) counts[rng.weighted(items, (x) => x.w).id]!++
    expect(counts.nie).toBe(0)
    expect(counts.haeufig! / 20000).toBeGreaterThan(0.87)
    expect(counts.haeufig! / 20000).toBeLessThan(0.93)
  })

  it('wirft bei unmoeglichen Ziehungen statt still danebenzugreifen', () => {
    const rng = createRng('errors')
    expect(() => rng.pick([])).toThrow()
    expect(() => rng.weighted([{ w: 0 }], (x) => x.w)).toThrow()
    expect(() => rng.int(5, 1)).toThrow()
  })

  it('zaehlt Ziehungen mit', () => {
    const rng = createRng('draws')
    rng.next(); rng.int(1, 10); rng.chance(50)
    expect(rng.draws).toBe(3)
  })

  it('deriveSeed erzeugt stabile, verschiedene Kindseeds', () => {
    expect(deriveSeed('raid-1', 'turn', 3)).toBe('raid-1:turn:3')
    expect(createRng(deriveSeed('r', 1)).next()).not.toBe(createRng(deriveSeed('r', 2)).next())
  })
})
