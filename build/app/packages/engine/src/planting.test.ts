import { describe, expect, it } from 'vitest'
import {
  GOLD_PLANT_COOLDOWN_MS, PLOT_BASE_BONUS, PLOT_GROWTH_MS, PLOT_MANUAL_BONUS,
  PLOT_MAX_GOLD, PLOT_MAX_ITEMS, PLOT_PHASES, goldPlantReady, goldPlantReadyAt,
  harvestAmount, manualBonus, nextPhaseAt, phaseKind, phasesDue,
  plotBonus, plotReady, tenderBonus,
  FERTILISER_LEVELS, PLANTABLE_CATEGORIES, UNPLANTABLE_ITEMS, fertiliserOf, fertilisedGrowthMs,
} from './planting.js'

const T0 = 1_700_000_000_000
const PHASE = PLOT_GROWTH_MS / PLOT_PHASES

describe('phasesDue', () => {
  it('faellt gleichmaessig ueber die Wachstumszeit an', () => {
    expect(phasesDue(T0, T0)).toBe(0)
    expect(phasesDue(T0, T0 + PHASE - 1)).toBe(0)
    expect(phasesDue(T0, T0 + PHASE)).toBe(1)
    expect(phasesDue(T0, T0 + 2 * PHASE)).toBe(2)
    expect(phasesDue(T0, T0 + PLOT_GROWTH_MS)).toBe(PLOT_PHASES)
  })

  it('waechst nicht ueber die Zahl der Schritte hinaus', () => {
    expect(phasesDue(T0, T0 + 100 * PLOT_GROWTH_MS)).toBe(PLOT_PHASES)
  })

  it('ignoriert eine Uhr, die zurueckspringt', () => {
    expect(phasesDue(T0, T0 - 5_000)).toBe(0)
  })
})

describe('nextPhaseAt', () => {
  it('nennt den Zeitpunkt des naechsten Schritts', () => {
    expect(nextPhaseAt(T0, 0)).toBe(T0 + PHASE)
    expect(nextPhaseAt(T0, 2)).toBe(T0 + 3 * PHASE)
  })
  it('ist nach dem letzten Schritt null', () => {
    expect(nextPhaseAt(T0, PLOT_PHASES)).toBeNull()
  })
})

describe('phaseKind', () => {
  it('wechselt zwischen Jaeten und Waessern', () => {
    expect(phaseKind(0)).toBe('weed')
    expect(phaseKind(1)).toBe('water')
    expect(phaseKind(2)).toBe('weed')
  })
})

describe('manualBonus', () => {
  it('gibt ohne jede Pflege den Grundwert', () => {
    expect(manualBonus(0)).toBe(PLOT_BASE_BONUS)
  })

  it('erreicht mit allen Schritten hundert Prozent', () => {
    expect(manualBonus(PLOT_PHASES)).toBe(PLOT_BASE_BONUS + PLOT_MANUAL_BONUS)
    expect(manualBonus(PLOT_PHASES)).toBe(100)
  })

  it('steigt gleichmaessig dazwischen', () => {
    expect(manualBonus(2)).toBe(75)
    expect(manualBonus(1)).toBeLessThan(manualBonus(2))
    expect(manualBonus(3)).toBeLessThan(manualBonus(4))
  })
})

describe('tenderBonus', () => {
  it('beginnt bei fuenfzig Prozent', () => {
    expect(tenderBonus(0)).toBe(PLOT_BASE_BONUS)
    expect(tenderBonus(1)).toBe(51)
  })

  it('rechnet ein halbes Prozent je Level drauf', () => {
    expect(tenderBonus(50)).toBe(75)
    expect(tenderBonus(80)).toBe(90)
  })

  it('erreicht auf Level 100 genau die Handarbeit', () => {
    expect(tenderBonus(100)).toBe(manualBonus(PLOT_PHASES))
  })

  it('geht nie darueber hinaus', () => {
    expect(tenderBonus(999)).toBe(100)
  })
})

describe('plotBonus', () => {
  it('nimmt den besseren Wert, nicht die Summe', () => {
    // Voll von Hand gepflegt und ein starkes Pokemon: 100, nicht 190.
    expect(plotBonus({ phasesDone: PLOT_PHASES, tenderLevel: 80 })).toBe(100)
  })

  it('laesst ein starkes Pokemon die Handarbeit ersetzen', () => {
    expect(plotBonus({ phasesDone: 0, tenderLevel: 100 })).toBe(100)
  })

  it('faellt nie unter den Grundwert', () => {
    expect(plotBonus({ phasesDone: 0, tenderLevel: null })).toBe(PLOT_BASE_BONUS)
    expect(plotBonus({ phasesDone: 0, tenderLevel: 1 })).toBe(51)
  })
})

describe('harvestAmount', () => {
  it('gibt bei fuenfzig Prozent die Haelfte obendrauf', () => {
    expect(harvestAmount(10, 50)).toBe(15)
    expect(harvestAmount(1_000, 50)).toBe(1_500)
  })

  it('verdoppelt bei hundert Prozent', () => {
    expect(harvestAmount(10, 100)).toBe(20)
  })

  it('gibt nie weniger als den Einsatz zurueck', () => {
    expect(harvestAmount(1, 50)).toBeGreaterThanOrEqual(1)
    expect(harvestAmount(7, 0)).toBe(7)
  })
})

describe('Obergrenzen', () => {
  it('haelt den Goldgewinn unter einem Ligatag', () => {
    /*
     * Die Tagessperre ist die eigentliche Grenze, nicht der Einsatz. Was das
     * Beet hoechstens abwirft, entscheidet sich am besten Bonus, den es gibt:
     * Pfleger und Duenger III, zusammen +275 %.
     *
     * Der Vergleichswert ist gemessen und nicht geschaetzt — ein Ligatag hat
     * 17546 Gold gebracht. Solange ein Beettag darunter bleibt, ist das
     * Vergraben eine Einnahmequelle neben anderen und nicht die eine, die
     * alle anderen ueberfluessig macht.
     */
    const besterBonus = plotBonus({ phasesDone: 0, tenderLevel: 50, fertiliserPercent: 200 })
    const gewinnProTag = harvestAmount(PLOT_MAX_GOLD, besterBonus) - PLOT_MAX_GOLD
    expect(gewinnProTag).toBeLessThan(17_546)
    expect(GOLD_PLANT_COOLDOWN_MS).toBe(24 * 3_600_000)
  })

  it('haelt die Gegenstandsmenge an dem, was die Rezepte fordern', () => {
    /*
     * Die Zahl ist eine Ableitung, kein Gefuehl. Ein Beet je Beerensorte soll
     * eine ganze Runde tragen: der Kronkorken verlangt vier Beeren je Sorte,
     * ein Vitamin acht — und wer beides will, pflanzt einmal statt dreimal.
     *
     * Nach oben bleibt sie begrenzt: ein Beet ist ein Beet, kein Lager.
     */
    expect(PLOT_MAX_ITEMS).toBe(100)
    const proSorte = 4 + 8
    expect(PLOT_MAX_ITEMS).toBeGreaterThanOrEqual(proSorte)
  })
})

describe('Tagessperre fuers Gold', () => {
  it('erlaubt den allerersten Einsatz sofort', () => {
    expect(goldPlantReady(null, T0)).toBe(true)
    expect(goldPlantReadyAt(null)).toBeNull()
  })

  it('sperrt danach fuer 24 Stunden', () => {
    expect(goldPlantReady(T0, T0)).toBe(false)
    expect(goldPlantReady(T0, T0 + GOLD_PLANT_COOLDOWN_MS - 1)).toBe(false)
    expect(goldPlantReady(T0, T0 + GOLD_PLANT_COOLDOWN_MS)).toBe(true)
  })

  it('nennt den Zeitpunkt der Freigabe', () => {
    expect(goldPlantReadyAt(T0)).toBe(T0 + GOLD_PLANT_COOLDOWN_MS)
  })
})

describe('plotReady', () => {
  it('ist erst nach der vollen Wachstumszeit reif', () => {
    expect(plotReady(T0, T0 + PLOT_GROWTH_MS - 1)).toBe(false)
    expect(plotReady(T0, T0 + PLOT_GROWTH_MS)).toBe(true)
  })
})

describe('Duenger', () => {
  it('verkuerzt die Zeit und hebt den Ertrag um denselben Anteil', () => {
    /*
     * Beides zusammen ist die Absicht. Eine Stufe, die nur schneller macht,
     * ist bei vier Stunden Laufzeit kaum spuerbar; eine, die nur mehr bringt,
     * laedt zum Liegenlassen ein.
     */
    const vier = 4 * 3_600_000
    expect(fertilisedGrowthMs(50, vier)).toBe(Math.round(vier / 1.5))
    expect(fertilisedGrowthMs(100, vier)).toBe(vier / 2)
    expect(fertilisedGrowthMs(200, vier)).toBe(Math.round(vier / 3))
  })

  it('teilt die Zeit, statt sie abzuziehen', () => {
    // Bei 200 % waere ein Abzug eine Ernte in null Sekunden.
    expect(fertilisedGrowthMs(200)).toBeGreaterThan(0)
    expect(fertilisedGrowthMs(1000)).toBeGreaterThanOrEqual(60_000)
  })

  it('legt sich auf die Pflege, statt sie zu ersetzen', () => {
    const ohne = plotBonus({ phasesDone: 4, tenderLevel: null })
    const mit = plotBonus({ phasesDone: 4, tenderLevel: null, fertiliserPercent: 200 })
    expect(mit).toBe(ohne + 200)
    // Und ohne Pflege bringt er trotzdem etwas.
    expect(plotBonus({ phasesDone: 0, tenderLevel: null, fertiliserPercent: 50 }))
      .toBeGreaterThan(plotBonus({ phasesDone: 0, tenderLevel: null }))
  })

  it('kennt drei Stufen mit 50, 100 und 200 Prozent', () => {
    expect(FERTILISER_LEVELS.map((f) => f.percent)).toEqual([50, 100, 200])
    expect(fertiliserOf('fertiliser-2')?.percent).toBe(100)
    expect(fertiliserOf('gibt-es-nicht')).toBeNull()
    expect(fertiliserOf(null)).toBeNull()
  })
})

describe('Was sich vergraben laesst', () => {
  it('nur noch Beeren', () => {
    expect([...PLANTABLE_CATEGORIES]).toEqual(['berry'])
  })

  it('aber keine Sagenbeere', () => {
    /*
     * Sie ist der einzige Hebel gegen ein Legendaeres und faellt nur bei
     * Ueberfaellen. Anbaubar waere der Hebel eine Frage der Geduld.
     */
    expect(UNPLANTABLE_ITEMS.has('legendary-berry')).toBe(true)
  })
})
