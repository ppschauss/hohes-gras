import { describe, expect, it } from 'vitest'
import {
  ENERGY_BASE_CAP, ENERGY_CAP_MAX_STEPS, ENERGY_COSTS, ENERGY_PACKS,
  ENERGY_FILL_MINUTES, ENERGY_PER_HOUR, ENERGY_REWARDS, EXPEDITION_ENERGY, clampEnergy, energyCapPrice,
  energyPerHour, findEnergyPack, fullAt, nextPointAt, regenerateTrainerEnergy,
} from './energy.js'

const HOUR = 3_600_000
const T0 = 1_700_000_000_000

describe('regenerateTrainerEnergy', () => {
  it('schreibt eine volle Stunde als perHour Punkte gut', () => {
    const r = regenerateTrainerEnergy(0, T0, T0 + HOUR)
    expect(r.energy).toBe(ENERGY_PER_HOUR)
  })

  it('deckelt an der Obergrenze', () => {
    const r = regenerateTrainerEnergy(0, T0, T0 + 100 * HOUR)
    expect(r.energy).toBe(ENERGY_BASE_CAP)
    expect(r.updatedAt).toBe(T0 + 100 * HOUR)
  })

  it('laesst einen vollen Vorrat unveraendert', () => {
    const r = regenerateTrainerEnergy(ENERGY_BASE_CAP, T0, T0 + HOUR)
    expect(r.energy).toBe(ENERGY_BASE_CAP)
  })

  it('haeuft nichts ueber die Obergrenze hinaus an', () => {
    // Ein Konto ueber der Grenze (aus Belohnungen) darf nicht weiter wachsen.
    const r = regenerateTrainerEnergy(ENERGY_BASE_CAP + 50, T0, T0 + 10 * HOUR)
    expect(r.energy).toBe(ENERGY_BASE_CAP + 50)
  })

  it('verliert angefangene Minuten nicht, wenn oft nachgerechnet wird', () => {
    // Der eigentliche Grund fuer den mitgefuehrten Zeitstempel: haeufiges
    // Nachrechnen darf nicht langsamer auffuellen als seltenes.
    const msPerPoint = HOUR / ENERGY_PER_HOUR
    let state = { energy: 0, updatedAt: T0 }
    const end = T0 + 10 * msPerPoint
    // Siebenmal je Punktintervall nachrechnen — und am Ende noch einmal genau
    // auf `end`, damit beide Wege denselben Zeitraum abdecken.
    for (let i = 0; T0 + Math.floor((i * msPerPoint) / 7) <= end; i++) {
      state = regenerateTrainerEnergy(state.energy, state.updatedAt, T0 + Math.floor((i * msPerPoint) / 7))
    }
    state = regenerateTrainerEnergy(state.energy, state.updatedAt, end)
    const once = regenerateTrainerEnergy(0, T0, end)
    expect(state.energy).toBe(once.energy)
  })

  it('liefert immer ganzzahlige Zeitstempel', () => {
    // 17 Punkte/Stunde teilt 3.600.000 nicht glatt. Ein gebrochener
    // Zeitstempel hat die STRICT-Tabelle beim Schreiben abgewiesen und damit
    // jeden Start der App mit einem Fehler beendet.
    for (const perHour of [7, 13, 17, 23]) {
      const r = regenerateTrainerEnergy(0, T0, T0 + 5 * HOUR, ENERGY_BASE_CAP, perHour)
      expect(Number.isInteger(r.updatedAt)).toBe(true)
      expect(Number.isInteger(r.energy)).toBe(true)
      expect(Number.isInteger(nextPointAt(r.energy, r.updatedAt, ENERGY_BASE_CAP, perHour)!)).toBe(true)
      expect(Number.isInteger(fullAt(r.energy, r.updatedAt, ENERGY_BASE_CAP, perHour)!)).toBe(true)
    }
  })

  it('verliert bei krummen Raten nichts ueber viele Aufrufe', () => {
    const perHour = 17
    let state = { energy: 0, updatedAt: T0 }
    const end = T0 + 3 * HOUR
    for (let i = 0; T0 + i * 60_000 <= end; i++) {
      state = regenerateTrainerEnergy(state.energy, state.updatedAt, T0 + i * 60_000, ENERGY_BASE_CAP, perHour)
    }
    state = regenerateTrainerEnergy(state.energy, state.updatedAt, end, ENERGY_BASE_CAP, perHour)
    const once = regenerateTrainerEnergy(0, T0, end, ENERGY_BASE_CAP, perHour)
    expect(state.energy).toBe(once.energy)
  })

  it('ignoriert eine Uhr, die zurueckspringt', () => {
    const r = regenerateTrainerEnergy(30, T0, T0 - HOUR)
    expect(r.energy).toBe(30)
    expect(r.updatedAt).toBeLessThanOrEqual(T0 - HOUR)
  })
})

describe('nextPointAt und fullAt', () => {
  it('nennen beide null, wenn der Vorrat voll ist', () => {
    expect(nextPointAt(ENERGY_BASE_CAP, T0)).toBeNull()
    expect(fullAt(ENERGY_BASE_CAP, T0)).toBeNull()
  })

  it('liegen in der Zukunft und in der richtigen Reihenfolge', () => {
    const next = nextPointAt(10, T0)!
    const full = fullAt(10, T0)!
    expect(next).toBeGreaterThan(T0)
    expect(full).toBeGreaterThan(next)
  })

  it('rechnen die Restdauer aus dem Abstand zur Obergrenze', () => {
    const missing = ENERGY_BASE_CAP - 10
    // Gerundet: Zeitstempel muessen ganzzahlig bleiben, sonst weist die
    // STRICT-Tabelle sie beim Speichern ab.
    expect(fullAt(10, T0)).toBe(Math.round(T0 + missing * (HOUR / ENERGY_PER_HOUR)))
  })
})

describe('Kosten und Belohnungen', () => {
  it('haelt jede Aktion bezahlbar und jede Belohnung positiv', () => {
    for (const cost of Object.values(ENERGY_COSTS)) {
      expect(cost).toBeGreaterThan(0)
      expect(cost).toBeLessThanOrEqual(ENERGY_BASE_CAP)
    }
    for (const value of Object.values(ENERGY_REWARDS)) expect(value).toBeGreaterThan(0)
  })

  it('staffelt die Expeditionskosten nach Dauer', () => {
    expect(EXPEDITION_ENERGY.short).toBeLessThan(EXPEDITION_ENERGY.medium!)
    expect(EXPEDITION_ENERGY.medium).toBeLessThan(EXPEDITION_ENERGY.long!)
  })

  it('gibt fuer einen gewonnenen Kampf mehr zurueck, als er gekostet hat', () => {
    // Sonst waere Kaempfen ein Verlustgeschaeft und niemand wuerde es tun.
    expect(ENERGY_REWARDS.battleWon).toBeGreaterThanOrEqual(ENERGY_COSTS.battle)
    expect(ENERGY_REWARDS.duelWon).toBeGreaterThanOrEqual(ENERGY_COSTS.duel)
  })
})

describe('Pakete', () => {
  it('werden je Punkt guenstiger, je groesser sie sind', () => {
    const perPoint = ENERGY_PACKS.map((p) => p.gold / p.energy)
    for (let i = 1; i < perPoint.length; i++) {
      expect(perPoint[i]!).toBeLessThan(perPoint[i - 1]!)
    }
  })

  it('findet Pakete nur unter ihrer eigenen Kennung', () => {
    expect(findEnergyPack('energy-small')?.energy).toBe(10)
    expect(findEnergyPack('gratis')).toBeUndefined()
  })
})

describe('clampEnergy', () => {
  it('haelt den Wert ganzzahlig und nicht negativ', () => {
    expect(clampEnergy(-5)).toBe(0)
    expect(clampEnergy(12.7)).toBe(12)
    expect(clampEnergy(1e9)).toBe(9999)
  })
})

describe('Vorrat und Nachschub haengen zusammen', () => {
  it('fuellt jeden Vorrat in etwa derselben Zeit', () => {
    for (const cap of [150, 200, 300, 450]) {
      const minutes = (cap / energyPerHour(cap)) * 60
      expect(minutes).toBeGreaterThan(ENERGY_FILL_MINUTES - 5)
      expect(minutes).toBeLessThanOrEqual(ENERGY_FILL_MINUTES)
    }
  })

  it('gibt auf den Grundvorrat glatt zwei Punkte je Minute', () => {
    expect(ENERGY_PER_HOUR).toBe(120)
    expect(energyPerHour(ENERGY_BASE_CAP) / 60).toBe(2)
  })

  it('gibt einem groesseren Vorrat mehr Nachschub', () => {
    expect(energyPerHour(300)).toBeGreaterThan(energyPerHour(150))
  })

  it('faellt nie auf null', () => {
    expect(energyPerHour(1)).toBeGreaterThanOrEqual(1)
    expect(energyPerHour(0)).toBeGreaterThanOrEqual(1)
  })
})

describe('energyCapPrice', () => {
  it('steigt mit jeder Stufe', () => {
    const prices = Array.from({ length: ENERGY_CAP_MAX_STEPS }, (_, i) => energyCapPrice(i)!)
    for (let i = 1; i < prices.length; i++) expect(prices[i]!).toBeGreaterThan(prices[i - 1]!)
  })

  it('endet nach der letzten Stufe', () => {
    expect(energyCapPrice(ENERGY_CAP_MAX_STEPS)).toBeNull()
    expect(energyCapPrice(ENERGY_CAP_MAX_STEPS + 5)).toBeNull()
  })

  it('bleibt insgesamt ein erreichbares Ziel', () => {
    const total = Array.from({ length: ENERGY_CAP_MAX_STEPS }, (_, i) => energyCapPrice(i)!)
      .reduce((a, b) => a + b, 0)
    expect(total).toBeLessThan(200_000)
    expect(total).toBeGreaterThan(50_000)
  })
})
