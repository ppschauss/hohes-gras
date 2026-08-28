import { describe, expect, it } from 'vitest'
import { createRng } from './rng.js'
import {
  CENTER_COOLDOWN_MS, centerCooldown, CENTER_EVENT_CHANCES, GIFT_MAX, TRADE_MIN_CATCH_RATE,
  centerReady, centerReadyAt, foundGold, giftQuantity, giftWeight, itemValue,
  rollCenterEvent, tradeLevel,
} from './center.js'

describe('rollCenterEvent', () => {
  it('trifft die angegebenen Wahrscheinlichkeiten', () => {
    // 40.000 Wuerfe: die Abweichung liegt damit deutlich unter einem halben
    // Prozentpunkt, und der Test bleibt trotzdem in Millisekunden fertig.
    const counts: Record<string, number> = { none: 0, gold: 0, gift: 0, trade: 0 }
    const rng = createRng('center-verteilung')
    const runs = 40_000
    for (let i = 0; i < runs; i++) counts[rollCenterEvent(rng)]!++

    for (const [kind, chance] of Object.entries(CENTER_EVENT_CHANCES)) {
      expect(counts[kind]! / runs).toBeGreaterThan(chance - 0.01)
      expect(counts[kind]! / runs).toBeLessThan(chance + 0.01)
    }
    // Der ueberwiegende Teil der Besuche bleibt ereignislos.
    expect(counts.none! / runs).toBeGreaterThan(0.85)
  })

  it('haelt jede Einzelchance im gewuenschten Band von 1 bis 5 Prozent', () => {
    for (const chance of Object.values(CENTER_EVENT_CHANCES)) {
      expect(chance).toBeGreaterThanOrEqual(0.01)
      expect(chance).toBeLessThanOrEqual(0.05)
    }
  })

  it('ist bei gleichem Seed reproduzierbar', () => {
    const a = Array.from({ length: 50 }, (_, i) => rollCenterEvent(createRng(`seed-${i}`)))
    const b = Array.from({ length: 50 }, (_, i) => rollCenterEvent(createRng(`seed-${i}`)))
    expect(a).toEqual(b)
  })
})

describe('giftQuantity', () => {
  it('bleibt immer zwischen 1 und 15', () => {
    for (const value of [1, 10, 30, 90, 150, 450, 900, 1500, 99_999]) {
      const q = giftQuantity(value)
      expect(q).toBeGreaterThanOrEqual(1)
      expect(q).toBeLessThanOrEqual(GIFT_MAX)
    }
  })

  it('staffelt nach Wertigkeit: billig im Stapel, teuer einzeln', () => {
    expect(giftQuantity(30)).toBe(GIFT_MAX)      // Pokeball
    expect(giftQuantity(90)).toBe(5)             // Superball
    expect(giftQuantity(300)).toBe(2)            // Top-Genesung
    expect(giftQuantity(1500)).toBe(1)           // Entwicklungsstein
  })

  it('faellt monoton mit dem Preis', () => {
    const values = [30, 50, 90, 150, 300, 600, 1500]
    const quantities = values.map(giftQuantity)
    for (let i = 1; i < quantities.length; i++) {
      expect(quantities[i]!).toBeLessThanOrEqual(quantities[i - 1]!)
    }
  })
})

describe('giftWeight', () => {
  it('macht billige Gegenstaende deutlich haeufiger als teure', () => {
    expect(giftWeight(30)).toBeGreaterThan(giftWeight(1500) * 10)
    expect(giftWeight(99_999)).toBeGreaterThanOrEqual(1)
  })
})

describe('itemValue', () => {
  it('nimmt den Kaufpreis, wenn es einen gibt', () => {
    expect(itemValue(150, 75)).toBe(150)
  })
  it('rechnet Materialien ohne Kaufpreis aus dem Verkaufserloes hoch', () => {
    expect(itemValue(null, 70)).toBe(140)
  })
  it('faellt nie auf null', () => {
    expect(itemValue(0, 0)).toBeGreaterThan(0)
    expect(itemValue(undefined, undefined)).toBeGreaterThan(0)
  })
})

describe('foundGold', () => {
  it('waechst mit der Zahl der Orden', () => {
    const early = foundGold(createRng('gold'), 0)
    const late = foundGold(createRng('gold'), 8)
    expect(late).toBeGreaterThan(early)
  })
  it('bleibt in einem vernuenftigen Rahmen', () => {
    for (let i = 0; i < 200; i++) {
      const gold = foundGold(createRng(`g${i}`), 8)
      expect(gold).toBeGreaterThan(0)
      expect(gold).toBeLessThan(2000)
    }
  })
})

describe('Abklingzeit', () => {
  it('betraegt zehn Minuten', () => {
    expect(CENTER_COOLDOWN_MS).toBe(10 * 60_000)
  })

  it('sinkt mit der Schwesternstation, aber nie unter drei Minuten', () => {
    // Heilen ist Voraussetzung fuers Spielen, keine Belohnung — wer wartet,
    // spielt nicht. Ganz verschwinden darf die Wartezeit trotzdem nicht,
    // sonst kauft niemand mehr einen Trank.
    expect(centerCooldown(0)).toBe(10 * 60_000)
    expect(centerCooldown(1)).toBe(8.5 * 60_000)
    expect(centerCooldown(4)).toBe(4 * 60_000)
    expect(centerCooldown(99)).toBe(3 * 60_000)
  })
  it('gibt erst nach Ablauf wieder frei', () => {
    const used = 1_000_000
    expect(centerReady(used, used + CENTER_COOLDOWN_MS - 1)).toBe(false)
    expect(centerReady(used, used + CENTER_COOLDOWN_MS)).toBe(true)
    expect(centerReadyAt(used)).toBe(used + CENTER_COOLDOWN_MS)
  })
  it('ist beim allerersten Besuch sofort frei', () => {
    expect(centerReady(0, Date.now())).toBe(true)
  })
})

describe('tradeLevel', () => {
  it('liegt knapp ueber dem hergegebenen Level', () => {
    for (let i = 0; i < 100; i++) {
      const level = tradeLevel(30, createRng(`t${i}`))
      expect(level).toBeGreaterThanOrEqual(30)
      expect(level).toBeLessThanOrEqual(32)
    }
  })
  it('sprengt die Levelgrenze nicht', () => {
    expect(tradeLevel(100, createRng('max'))).toBe(100)
  })
})

describe('TRADE_MIN_CATCH_RATE', () => {
  it('schliesst legendaere Arten aus', () => {
    // Legendaere haben im Pack die Fangrate 3.
    expect(TRADE_MIN_CATCH_RATE).toBeGreaterThan(3)
  })
})
