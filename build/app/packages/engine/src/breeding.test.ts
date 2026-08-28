import { describe, expect, it } from 'vitest'
import type { SpeciesDef } from '@game/content'
import { STATS } from '@game/shared'
import { createRng } from './rng.js'
import {
  canBreed, hatchProgress, isHatched, offspringSpecies, produceEgg,
  MINUTES_PER_CYCLE, MIN_BREEDING_LEVEL,
} from './breeding.js'
import { IV_MAX } from './stats.js'

const sp = (id: string, eggGroups: string[], hatchCycles = 20): SpeciesDef =>
  ({ id, eggGroups, hatchCycles } as SpeciesDef)

const flatIvs = (v: number) => Object.fromEntries(STATS.map((s) => [s, v])) as Record<string, number>

const parent = (over: Record<string, unknown> = {}) => ({
  speciesId: 'a', ivs: flatIvs(10) as never, nature: 'hardy' as const, shiny: false, ...over,
})

describe('canBreed', () => {
  it('erlaubt Paare mit gemeinsamer Eigruppe', () => {
    expect(canBreed(sp('a', ['field']), sp('b', ['field', 'monster']), 20, 20, false)).toEqual({ ok: true })
  })
  it('weist dasselbe Pokemon ab', () => {
    expect(canBreed(sp('a', ['field']), sp('a', ['field']), 20, 20, true).ok).toBe(false)
  })
  it('weist fehlende Ueberschneidung ab', () => {
    const r = canBreed(sp('a', ['field']), sp('b', ['water1']), 20, 20, false)
    expect(r).toEqual({ ok: false, reason: 'no_shared_group' })
  })
  it('weist nicht zuechtbare Gruppen ab', () => {
    const r = canBreed(sp('a', ['no-eggs']), sp('b', ['no-eggs']), 40, 40, false)
    expect(r).toEqual({ ok: false, reason: 'unbreedable' })
  })
  it('weist zu junge Pokemon ab', () => {
    const r = canBreed(sp('a', ['field']), sp('b', ['field']), MIN_BREEDING_LEVEL - 1, 30, false)
    expect(r).toEqual({ ok: false, reason: 'too_young' })
  })
})

describe('offspringSpecies', () => {
  it('nimmt die Basisform eines Elternteils', () => {
    const baseFormOf = (id: string) => (id === 'a' ? 'a-baby' : 'b-baby')
    const out = new Set<string>()
    const rng = createRng('offspring')
    for (let i = 0; i < 50; i++) out.add(offspringSpecies(sp('a', ['f']), sp('b', ['f']), baseFormOf, rng))
    expect(out).toEqual(new Set(['a-baby', 'b-baby']))
  })
})

describe('produceEgg', () => {
  const child = sp('child', ['field'], 20)

  it('vererbt die besseren Werte der Eltern', () => {
    const a = parent({ ivs: flatIvs(IV_MAX) })
    const b = parent({ ivs: flatIvs(0) })
    // Bei sechs Erbplaetzen muss jeder Wert vom besseren Elternteil kommen.
    const egg = produceEgg(a as never, b as never, child, createRng('inherit'), { inheritSlots: 6 })
    for (const stat of STATS) expect(egg.ivs[stat]).toBe(IV_MAX)
  })

  it('wuerfelt die nicht vererbten Werte neu', () => {
    const a = parent({ ivs: flatIvs(IV_MAX) })
    const b = parent({ ivs: flatIvs(IV_MAX) })
    const egg = produceEgg(a as never, b as never, child, createRng('roll'), { inheritSlots: 0 })
    const perfect = STATS.filter((s) => egg.ivs[s] === IV_MAX).length
    expect(perfect).toBeLessThan(STATS.length)
  })

  it('haelt alle Werte im gueltigen Bereich', () => {
    const rng = createRng('range')
    for (let i = 0; i < 300; i++) {
      const egg = produceEgg(parent() as never, parent() as never, child, rng)
      for (const stat of STATS) {
        expect(egg.ivs[stat]).toBeGreaterThanOrEqual(0)
        expect(egg.ivs[stat]).toBeLessThanOrEqual(IV_MAX)
      }
    }
  })

  it('uebernimmt das Wesen meistens von einem Elternteil', () => {
    const a = parent({ nature: 'adamant' })
    const b = parent({ nature: 'adamant' })
    const rng = createRng('nature')
    let fromParent = 0
    for (let i = 0; i < 1000; i++) {
      if (produceEgg(a as never, b as never, child, rng).nature === 'adamant') fromParent++
    }
    expect(fromParent / 1000).toBeGreaterThan(0.7)
  })

  it('erhoeht die Shiny-Chance bei unterschiedlichen Eltern', () => {
    const count = (differing: boolean) => {
      const rng = createRng(`shiny-${differing}`)
      let n = 0
      for (let i = 0; i < 30000; i++) {
        const egg = produceEgg(
          parent({ shiny: false }) as never,
          parent({ shiny: differing }) as never,
          child, rng,
        )
        if (egg.shiny) n++
      }
      return n
    }
    expect(count(true)).toBeGreaterThan(count(false) * 3)
  })

  it('leitet die Brutzeit aus den Zyklen ab', () => {
    const fast = produceEgg(parent() as never, parent() as never, sp('c', ['f'], 5), createRng('t'))
    const slow = produceEgg(parent() as never, parent() as never, sp('c', ['f'], 40), createRng('t'))
    expect(slow.hatchMinutes).toBe(40 * MINUTES_PER_CYCLE)
    expect(fast.hatchMinutes).toBeLessThan(slow.hatchMinutes)
  })

  it('ist bei gleichem Seed reproduzierbar', () => {
    const run = () => produceEgg(parent() as never, parent() as never, child, createRng('same'))
    expect(run()).toEqual(run())
  })
})

describe('hatchProgress', () => {
  const start = 1_000_000

  it('geht von 0 nach 1', () => {
    expect(hatchProgress(start, 60, start)).toBe(0)
    expect(hatchProgress(start, 60, start + 30 * 60_000)).toBeCloseTo(0.5)
    expect(hatchProgress(start, 60, start + 60 * 60_000)).toBe(1)
  })

  it('bleibt bei 1 stehen', () => {
    expect(hatchProgress(start, 60, start + 999 * 60_000)).toBe(1)
    expect(isHatched(start, 60, start + 61 * 60_000)).toBe(true)
    expect(isHatched(start, 60, start + 59 * 60_000)).toBe(false)
  })
})
