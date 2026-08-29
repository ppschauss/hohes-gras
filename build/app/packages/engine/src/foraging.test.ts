import { describe, expect, it } from 'vitest'
import { createRng } from './rng.js'
import {
  COIN_PURSE_MAX, COIN_PURSE_MIN, coinPurse, FIND_ODDS, findQuantity, findValueCap,
  rollFind, rollFindKind, rollWander, WANDER_ODDS,
} from './foraging.js'

describe('Zufallsereignisse beim Erkunden', () => {
  const rate = (fn: (rng: ReturnType<typeof createRng>) => boolean, seed: string) => {
    const rng = createRng(seed)
    let hits = 0
    for (let i = 0; i < 20_000; i++) if (fn(rng)) hits++
    return hits / 20_000
  }

  it('trifft den Streuner ungefaehr so oft wie angegeben', () => {
    expect(rate(rollWander, 'streuner')).toBeCloseTo(WANDER_ODDS, 2)
  })
  it('trifft das Fundstueck ungefaehr so oft wie angegeben', () => {
    expect(rate(rollFind, 'fund')).toBeCloseTo(FIND_ODDS, 2)
  })
})

describe('Fundstuecke', () => {
  it('haelt den Muenzbeutel in seiner Spanne', () => {
    const rng = createRng('muenzen')
    let lo = Infinity
    let hi = 0
    for (let i = 0; i < 5000; i++) {
      const gold = coinPurse(rng)
      lo = Math.min(lo, gold)
      hi = Math.max(hi, gold)
    }
    expect(lo).toBeGreaterThanOrEqual(COIN_PURSE_MIN)
    expect(hi).toBeLessThanOrEqual(COIN_PURSE_MAX)
    // Die Spanne wird auch wirklich ausgeschoepft.
    expect(lo).toBeLessThan(COIN_PURSE_MIN + 20)
    expect(hi).toBeGreaterThan(COIN_PURSE_MAX - 20)
  })

  it('graebt mit dem Detektor seltener Geld und oefter Fragmente aus', () => {
    const share = (detector: boolean, kind: string) => {
      const rng = createRng(`fund:${detector}`)
      let hits = 0
      for (let i = 0; i < 20_000; i++) if (rollFindKind(rng, detector) === kind) hits++
      return hits / 20_000
    }
    expect(share(true, 'coins')).toBeLessThan(share(false, 'coins'))
    expect(share(true, 'fragment')).toBeGreaterThan(share(false, 'fragment'))
    // Ware bleibt in beiden Faellen der Regelfall.
    expect(share(true, 'item')).toBeGreaterThan(0.5)
    expect(share(false, 'item')).toBeGreaterThan(0.5)
  })

  it('hebt die Wertgrenze mit jeder Region', () => {
    expect(findValueCap(0)).toBe(50)
    expect(findValueCap(1)).toBe(150)
    expect(findValueCap(2)).toBe(450)
    // Auch fuer eine Region, die es noch nicht gibt.
    expect(findValueCap(3)).toBe(1350)
  })

  it('gibt von billigen Sachen mehr und von teuren eines', () => {
    expect(findQuantity(15, 50)).toBe(3)
    expect(findQuantity(50, 50)).toBe(1)
    expect(findQuantity(300, 450)).toBe(1)
    expect(findQuantity(0, 50)).toBe(3)
  })
})
