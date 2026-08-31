import { describe, expect, it } from 'vitest'
import { createRng } from './rng.js'
import {
  BERRY_DROP_CHANCE, EVENT_ODDS, EVENT_PERFECT_CHANCE, LEGENDARY_BASE_CATCH,
  LEGENDARY_MAX_BERRIES, LEGENDARY_ODDS, PERFECT_IV,
  checkLeagueGate, eventGold, eventLoot, isEventTrainer, isLegendarySpecies,
  legendaryCatchChance, regionCleared, rollBerryDrop, rollEvent, rollLegendary, rollPerfect,
  eventLevels, eventPartySize,
} from './league.js'

const ELITES = ['e1', 'e2', 'e3', 'e4'] as const
const set = (...ids: string[]) => new Set(ids)

describe('checkLeagueGate', () => {
  it('laesst den ersten der Top Vier sofort zu', () => {
    expect(checkLeagueGate('e1', ELITES, 'champ', set()).ok).toBe(true)
  })

  it('sperrt den zweiten, solange der erste steht', () => {
    const v = checkLeagueGate('e2', ELITES, 'champ', set())
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.reason).toBe('elite_locked')
    expect(v.requires).toBe('e1')
  })

  it('oeffnet der Reihe nach', () => {
    expect(checkLeagueGate('e2', ELITES, 'champ', set('e1')).ok).toBe(true)
    expect(checkLeagueGate('e4', ELITES, 'champ', set('e1', 'e2')).ok).toBe(false)
    expect(checkLeagueGate('e4', ELITES, 'champ', set('e1', 'e2', 'e3')).ok).toBe(true)
  })

  it('haelt den Meister zurueck, bis alle vier gefallen sind', () => {
    const v = checkLeagueGate('champ', ELITES, 'champ', set('e1', 'e2'))
    expect(v.ok).toBe(false)
    if (v.ok) return
    expect(v.reason).toBe('champion_locked')
    expect(v.missing).toBe(2)
    expect(checkLeagueGate('champ', ELITES, 'champ', set(...ELITES)).ok).toBe(true)
  })

  it('laesst jeden anderen Kampf in Ruhe', () => {
    expect(checkLeagueGate('gym-brock', ELITES, 'champ', set()).ok).toBe(true)
  })

  it('kommt mit einer Region ohne Top Vier zurecht', () => {
    expect(checkLeagueGate('champ', [], 'champ', set()).ok).toBe(true)
  })
})

describe('regionCleared', () => {
  const badges = ['b1', 'b2']

  it('verlangt alle Orden und den Meister', () => {
    expect(regionCleared(badges, set('b1', 'b2'), 'champ', set('champ'))).toBe(true)
  })

  it('faellt bei einem fehlenden Orden durch', () => {
    expect(regionCleared(badges, set('b1'), 'champ', set('champ'))).toBe(false)
  })

  it('faellt ohne Sieg ueber den Meister durch', () => {
    expect(regionCleared(badges, set('b1', 'b2'), 'champ', set())).toBe(false)
  })

  it('gilt fuer eine Region ohne Orden nie als bezwungen', () => {
    expect(regionCleared([], set(), 'champ', set('champ'))).toBe(false)
  })
})

describe('Wuerfe', () => {
  it('trifft die Legendaeren-Chance von einem Promille', () => {
    const rng = createRng('legendary')
    let hits = 0
    const runs = 200_000
    for (let i = 0; i < runs; i++) if (rollLegendary(rng)) hits++
    expect(hits / runs).toBeGreaterThan(LEGENDARY_ODDS * 0.7)
    expect(hits / runs).toBeLessThan(LEGENDARY_ODDS * 1.3)
  })

  it('trifft die Ereignis-Chance', () => {
    const rng = createRng('event')
    let hits = 0
    const runs = 50_000
    for (let i = 0; i < runs; i++) if (rollEvent(rng)) hits++
    expect(hits / runs).toBeGreaterThan(EVENT_ODDS - 0.01)
    expect(hits / runs).toBeLessThan(EVENT_ODDS + 0.01)
  })

  it('haelt das makellose Pokemon selten', () => {
    expect(EVENT_PERFECT_CHANCE).toBeLessThan(0.05)
    const rng = createRng('perfect')
    let hits = 0
    for (let i = 0; i < 20_000; i++) if (rollPerfect(rng)) hits++
    expect(hits / 20_000).toBeLessThan(0.05)
  })

  it('bleibt reproduzierbar', () => {
    const a = Array.from({ length: 30 }, (_, i) => rollEvent(createRng(`s${i}`)))
    const b = Array.from({ length: 30 }, (_, i) => rollEvent(createRng(`s${i}`)))
    expect(a).toEqual(b)
  })
})

describe('Beute', () => {
  it('waechst mit dem Niveau des Gebiets', () => {
    const low = eventGold(10, createRng('g'))
    const high = eventGold(90, createRng('g'))
    expect(high).toBeGreaterThan(low * 2)
  })

  it('bleibt in einem vernuenftigen Rahmen', () => {
    for (let i = 0; i < 200; i++) {
      const gold = eventGold(100, createRng(`g${i}`))
      expect(gold).toBeGreaterThan(0)
      expect(gold).toBeLessThan(5000)
    }
  })

  it('gibt zwischen zwei und sechs Stueck', () => {
    for (let i = 0; i < 200; i++) {
      const n = eventLoot(createRng(`l${i}`))
      expect(n).toBeGreaterThanOrEqual(2)
      expect(n).toBeLessThanOrEqual(6)
    }
  })
})

describe('Ereignis-Trainer', () => {
  it('erkennt sie am Praefix', () => {
    expect(isEventTrainer('event-rocket-kanto')).toBe(true)
    expect(isEventTrainer('gym-brock')).toBe(false)
  })
})

describe('PERFECT_IV', () => {
  it('ist der Hoechstwert', () => {
    expect(PERFECT_IV).toBe(31)
  })
})

describe('Legendäre fangen', () => {
  it('beginnt fast bei null', () => {
    expect(legendaryCatchChance(0)).toBeCloseTo(LEGENDARY_BASE_CATCH, 5)
    expect(legendaryCatchChance(0)).toBeLessThan(0.1)
  })

  it('hebt je Sagenbeere um ein Viertel', () => {
    expect(legendaryCatchChance(1)).toBeCloseTo(0.30, 5)
    expect(legendaryCatchChance(2)).toBeCloseTo(0.55, 5)
    expect(legendaryCatchChance(3)).toBeCloseTo(0.80, 5)
  })

  it('nimmt hoechstens drei Beeren an', () => {
    expect(legendaryCatchChance(4)).toBe(legendaryCatchChance(3))
    expect(legendaryCatchChance(99)).toBe(legendaryCatchChance(LEGENDARY_MAX_BERRIES))
  })

  it('bleibt auch mit allen Beeren unter Gewissheit', () => {
    expect(legendaryCatchChance(LEGENDARY_MAX_BERRIES)).toBeLessThan(1)
  })

  it('haelt negative Eingaben aus', () => {
    expect(legendaryCatchChance(-2)).toBe(LEGENDARY_BASE_CATCH)
  })

  it('erkennt Legendaere an der Fangrate', () => {
    expect(isLegendarySpecies({ rarity: 'legendary' })).toBe(true)
    expect(isLegendarySpecies({ rarity: 'rare' })).toBe(false)
    /*
     * Der eigentliche Grund fuer den Wechsel: Tanhel, Metang und Metagross
     * haben im Vorbild Fangwert 3 wie ein Legendaeres. Nach dem Fangwert
     * gefragt galten sie als legendaer — nur mit Sagenbeere zu fangen und aus
     * Arena und Kampfzone verbannt. Sie sind bloss selten.
     */
    expect(isLegendarySpecies({ rarity: 'rare' })).toBe(false)
  })
})

describe('Sagenbeeren-Drop', () => {
  it('faellt etwa bei jedem zweiten Sieg', () => {
    const rng = createRng('drop')
    let hits = 0
    const runs = 20_000
    for (let i = 0; i < runs; i++) if (rollBerryDrop(rng)) hits++
    expect(hits / runs).toBeGreaterThan(BERRY_DROP_CHANCE - 0.02)
    expect(hits / runs).toBeLessThan(BERRY_DROP_CHANCE + 0.02)
  })
})

describe('Ereignis-Haeufigkeit', () => {
  it('liegt im gewuenschten Band von zwei bis fuenf Prozent', () => {
    expect(EVENT_ODDS).toBeGreaterThanOrEqual(0.02)
    expect(EVENT_ODDS).toBeLessThanOrEqual(0.05)
  })
})

describe('Überfallteam', () => {
  it('liegt zwei Level unter dem eigenen Median', () => {
    // Gemessen an simulierten Kaempfen: exakt auf dem Median gewann ein Team
    // aus vieren nur 36 % der Ueberfaelle.
    expect(eventLevels(1, 40)).toEqual([38])
    expect(eventLevels(3, 40)).toEqual([35, 38, 41])
  })

  it('bietet nie mehr Gegner auf, als man selbst dabeihat', () => {
    expect(eventPartySize(3, 1)).toBe(1)
    expect(eventPartySize(3, 2)).toBe(2)
    expect(eventPartySize(3, 5)).toBe(3)
    // Auch mit leerem Team bleibt ein Gegner stehen — sonst gaebe es keinen
    // Kampf, und der Aufruf kaeme gar nicht erst so weit.
    expect(eventPartySize(3, 0)).toBe(1)
  })

  it('faellt nie unter Level 1', () => {
    expect(Math.min(...eventLevels(3, 2))).toBeGreaterThanOrEqual(1)
  })
})
