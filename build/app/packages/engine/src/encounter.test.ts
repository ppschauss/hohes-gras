import { describe, expect, it } from 'vitest'
import type { AreaDef, ItemDef, SpeciesDef } from '@game/content'
import { createRng } from './rng.js'
import {
  attemptCatch, availableSpawns, ballMultiplier, catchProbability, catchReward,
  rollEncounter, shinyOdds, SHINY_BASE_ODDS, SHINY_CHAIN_GUARANTEE,
  SHINY_CHAIN_PLATEAU, SHINY_PLATEAU_ODDS,
  MAX_CALM_STACKS, CATCH_DROP_CHANCE, rollCatchDrop,
  type CatchModifiers, type SpawnContext,
} from './encounter.js'
import { RECIPES } from './crafting.js'
import {
  MAX_SEASON_TIER, rewardForTier, SEASON_LENGTH_DAYS, seasonTiers, SHINY_SOUL_ID,
} from './progression.js'

const area = {
  id: 'route-1',
  spawns: [
    { speciesId: 'tag-mon', weight: 60, minLevel: 2, maxLevel: 5 },
    { speciesId: 'nacht-mon', weight: 30, minLevel: 3, maxLevel: 6, timeOfDay: ['night'] },
    { speciesId: 'regen-mon', weight: 10, minLevel: 4, maxLevel: 7, weather: ['rain'] },
  ],
} as unknown as AreaDef

const species = (over: Partial<SpeciesDef> = {}): SpeciesDef => ({
  id: 'testmon', catchRate: 100, types: ['normal'], rarity: 'common', baseXpYield: 60,
  ...over,
} as SpeciesDef)

const ball = (params: Record<string, unknown> = {}): ItemDef =>
  ({ id: 'poke-ball', params: { catchMultiplier: 1, ...params } } as unknown as ItemDef)

const mods = (over: Partial<CatchModifiers> = {}): CatchModifiers => ({
  ball: ball(), berry: null, turn: 0, timeOfDay: 'day',
  weakenStacks: 0, calmStacks: 0, badgeCount: 0, ...over,
})

describe('availableSpawns', () => {
  it('zeigt tagsueber nur unbeschraenkte Eintraege', () => {
    const list = availableSpawns(area, { timeOfDay: 'day', weather: 'clear' })
    expect(list.map((s) => s.speciesId)).toEqual(['tag-mon'])
  })
  it('schaltet nachts den Nacht-Spawn frei', () => {
    const list = availableSpawns(area, { timeOfDay: 'night', weather: 'clear' })
    expect(list.map((s) => s.speciesId)).toContain('nacht-mon')
  })
  it('schaltet bei Regen den Wetter-Spawn frei', () => {
    const list = availableSpawns(area, { timeOfDay: 'day', weather: 'rain' })
    expect(list.map((s) => s.speciesId)).toContain('regen-mon')
  })
})

describe('rollEncounter', () => {
  it('haelt die Levelgrenzen des Eintrags ein', () => {
    const rng = createRng('levels')
    for (let i = 0; i < 300; i++) {
      const e = rollEncounter(area, { timeOfDay: 'day', weather: 'clear' }, rng)!
      expect(e.level).toBeGreaterThanOrEqual(2)
      expect(e.level).toBeLessThanOrEqual(5)
    }
  })

  it('ist bei gleichem Seed reproduzierbar', () => {
    const a = rollEncounter(area, { timeOfDay: 'night', weather: 'rain' }, createRng('x'))
    const b = rollEncounter(area, { timeOfDay: 'night', weather: 'rain' }, createRng('x'))
    expect(a).toEqual(b)
  })

  it('markiert bedingte Spawns', () => {
    const rng = createRng('gated')
    let sawGated = false
    for (let i = 0; i < 200; i++) {
      const e = rollEncounter(area, { timeOfDay: 'night', weather: 'clear' }, rng)!
      if (e.speciesId === 'nacht-mon') { expect(e.gatedByConditions).toBe(true); sawGated = true }
    }
    expect(sawGated).toBe(true)
  })

  it('greift auf alle Eintraege zurueck, statt leer auszugehen', () => {
    // Waeren alle Eintraege an Wetter oder Tageszeit gebunden, stuende hier
    // ein leerer Beutel und die Erkundung endete im Nichts. Gemeldet wurde
    // genau das als stoerend; im Pack kommt es zwar nicht vor, aber ein
    // Inhaltspaket, das es einmal tut, soll niemanden leer ausgehen lassen.
    const gatedOnly = {
      id: 'nur-schnee',
      spawns: [{ speciesId: 'x', weight: 1, minLevel: 1, maxLevel: 1, weather: ['snow'] }],
    } as unknown as AreaDef
    const out = rollEncounter(gatedOnly, { timeOfDay: 'day', weather: 'clear' }, createRng('n'))
    expect(out?.speciesId).toBe('x')
  })

  it('liefert null nur bei einem Gebiet ganz ohne Eintraege', () => {
    const empty = { id: 'leer', spawns: [] } as unknown as AreaDef
    expect(rollEncounter(empty, { timeOfDay: 'day', weather: 'clear' }, createRng('n'))).toBeNull()
  })

  it('erhoeht die Shiny-Chance mit der Fangserie', () => {
    const count = (chain: { speciesId: string; streak: number } | null, species: string) => {
      const rng = createRng(`shiny-${chain?.speciesId}-${chain?.streak}`)
      let n = 0
      for (let i = 0; i < 40000; i++) {
        const e = rollEncounter(area, { timeOfDay: 'day', weather: 'clear' }, rng, chain)!
        if (e.speciesId === species && e.shiny) n++
      }
      return n
    }
    /*
     * Die Serie hebt die Chance, aber sie verdreifacht sie nicht mehr.
     *
     * Das Plateau lag einmal bei zehn Prozent gegen 0,195 % Grundrate — ein
     * Faktor von fuenfzig. Jetzt sind es 0,35 % gegen 0,195 %, also knapp das
     * Doppelte. Der Vorteil der Serie liegt weniger in der Einzelchance als in
     * der Zusage bei 400, die es sonst nirgends gibt.
     */
    const jagd = { speciesId: 'tag-mon', streak: 40 }
    expect(count(jagd, 'tag-mon')).toBeGreaterThan(count(null, 'tag-mon') * 1.4)
  })

  it('laesst andere Arten unberuehrt', () => {
    /*
     * Der gemeldete Fall: eine Serie von 45 auf Abra, und daneben sieben, acht
     * Shinys anderer Arten, die man wegwerfen musste. Der Zuschlag galt fuer
     * jede Begegnung statt nur fuer die gejagte.
     */
    const others = (chain: { speciesId: string; streak: number } | null) => {
      const rng = createRng(`other-${chain?.streak ?? 0}`)
      let n = 0
      for (let i = 0; i < 40000; i++) {
        const e = rollEncounter(area, { timeOfDay: 'night', weather: 'clear' }, rng, chain)!
        if (e.speciesId !== 'tag-mon' && e.shiny) n++
      }
      return n
    }
    const mitJagd = others({ speciesId: 'tag-mon', streak: 40 })
    const ohne = others(null)
    // Gleiche Groessenordnung — die Serie faerbt nicht auf den Rest ab.
    expect(mitJagd).toBeLessThan(ohne * 2 + 5)
  })
})

describe('ballMultiplier', () => {
  it('nutzt den Grundwert ohne Bedingung', () => {
    expect(ballMultiplier(ball({ catchMultiplier: 2 }), species(), mods())).toBe(2)
  })

  it('wendet den Typbonus nur beim passenden Typ an', () => {
    const netz = ball({ catchMultiplier: 1, bonusVsTypes: 'bug,water', bonusMultiplier: 3.5 })
    expect(ballMultiplier(netz, species({ types: ['water'] }), mods())).toBe(3.5)
    expect(ballMultiplier(netz, species({ types: ['fire'] }), mods())).toBe(1)
  })

  it('wendet den Tageszeitbonus nur zur passenden Zeit an', () => {
    const finster = ball({ catchMultiplier: 1, bonusTimeOfDay: 'dusk,night', bonusMultiplier: 3 })
    expect(ballMultiplier(finster, species(), mods({ timeOfDay: 'night' }))).toBe(3)
    expect(ballMultiplier(finster, species(), mods({ timeOfDay: 'day' }))).toBe(1)
  })

  it('steigert den Timerball pro Runde und deckelt ihn', () => {
    const timer = ball({ catchMultiplier: 1, perTurnBonus: 0.3, maxMultiplier: 4 })
    expect(ballMultiplier(timer, species(), mods({ turn: 0 }))).toBeCloseTo(1)
    expect(ballMultiplier(timer, species(), mods({ turn: 5 }))).toBeCloseTo(2.5)
    expect(ballMultiplier(timer, species(), mods({ turn: 99 }))).toBe(4)
  })
})

describe('catchProbability', () => {
  it('bleibt immer zwischen 1 und 95 Prozent', () => {
    expect(catchProbability(species({ catchRate: 3 }), 100, mods())).toBeGreaterThanOrEqual(0.01)
    expect(catchProbability(species({ catchRate: 255 }), 1, mods({ ball: ball({ catchMultiplier: 99 }) }))).toBeLessThanOrEqual(0.95)
  })

  it('sinkt mit dem Level des wilden Pokemon', () => {
    const low = catchProbability(species(), 5, mods())
    const high = catchProbability(species(), 60, mods())
    expect(high).toBeLessThan(low)
  })

  it('steigt mit besserem Ball, Beere und Modifikatoren', () => {
    const plain = catchProbability(species(), 20, mods())
    const better = catchProbability(species(), 20, mods({
      ball: ball({ catchMultiplier: 2 }),
      berry: { id: 'razz-berry', params: { catchBonus: 1.5 } } as unknown as ItemDef,
      calmStacks: MAX_CALM_STACKS, weakenStacks: 2, badgeCount: 8,
    }))
    expect(better).toBeGreaterThan(plain)
  })

  it('ignoriert Modifikatoren jenseits ihrer Obergrenze', () => {
    const capped = catchProbability(species(), 20, mods({ calmStacks: 2 }))
    const over = catchProbability(species(), 20, mods({ calmStacks: 99 }))
    expect(over).toBeCloseTo(capped)
  })
})

describe('attemptCatch', () => {
  it('zeigt bei Erfolg immer vier Wackler', () => {
    const rng = createRng('catch')
    for (let i = 0; i < 500; i++) {
      const r = attemptCatch(species({ catchRate: 255 }), 2, mods({ ball: ball({ catchMultiplier: 3 }) }), rng)
      if (r.caught) expect(r.shakes).toBe(4)
      else expect(r.shakes).toBeLessThan(4)
    }
  })

  it('trifft die angezeigte Wahrscheinlichkeit statistisch', () => {
    const rng = createRng('stats')
    const sp = species({ catchRate: 120 })
    const m = mods()
    const p = catchProbability(sp, 10, m)
    let caught = 0
    const runs = 20000
    for (let i = 0; i < runs; i++) if (attemptCatch(sp, 10, m, rng).caught) caught++
    expect(caught / runs).toBeGreaterThan(p - 0.03)
    expect(caught / runs).toBeLessThan(p + 0.03)
  })

  it('ist bei gleichem Seed reproduzierbar', () => {
    const run = () => attemptCatch(species(), 10, mods(), createRng('rep'))
    expect(run()).toEqual(run())
  })
})

describe('catchReward', () => {
  it('belohnt seltene Arten staerker', () => {
    const common = catchReward(species({ rarity: 'common' }), 20, false).gold
    const legendary = catchReward(species({ rarity: 'legendary' }), 20, false).gold
    expect(legendary).toBeGreaterThan(common * 4)
  })
  it('belohnt Shinys deutlich', () => {
    expect(catchReward(species(), 20, true).gold).toBeGreaterThan(catchReward(species(), 20, false).gold * 3)
  })
})

describe('Lockduft', () => {
  const area = {
    id: 'a', regionId: 'r', order: 1,
    spawns: [
      { speciesId: 'feuermon', weight: 90, minLevel: 5, maxLevel: 5 },
      { speciesId: 'blattmon', weight: 10, minLevel: 5, maxLevel: 5 },
    ],
  } as unknown as AreaDef
  const clock = { timeOfDay: 'day', weather: 'clear' } as SpawnContext
  const typesOf = (id: string) => (id === 'blattmon' ? ['grass'] : ['fire'])

  const share = (lure: boolean): number => {
    let hits = 0
    for (let i = 0; i < 2000; i++) {
      const rng = createRng(`lure-${lure}-${i}`)
      const e = rollEncounter(area, clock, rng, 0, 0, lure ? { typeId: 'grass', typesOf } : null)
      if (e?.speciesId === 'blattmon') hits++
    }
    return hits / 2000
  }

  it('vervierfacht das Gewicht des gesuchten Typs', () => {
    // 10 von 100 ohne, 40 von 130 mit — die Formel, nicht das Gefuehl.
    expect(share(false)).toBeGreaterThan(0.06)
    expect(share(false)).toBeLessThan(0.14)
    expect(share(true)).toBeGreaterThan(0.24)
    expect(share(true)).toBeLessThan(0.38)
  })

  it('bleibt wirkungslos, wo der Typ nicht vorkommt', () => {
    let hits = 0
    for (let i = 0; i < 200; i++) {
      const rng = createRng(`none-${i}`)
      const e = rollEncounter(area, clock, rng, 0, 0, { typeId: 'ice', typesOf })
      if (e?.speciesId === 'blattmon') hits++
    }
    // Dieselbe Verteilung wie ohne Lockduft: er zaubert nichts herbei, was
    // hier nicht lebt.
    expect(hits / 200).toBeLessThan(0.2)
  })
})


describe('Shiny-Kurve der Fangserie', () => {
  it('erreicht bei zehn Faengen zehn Prozent und haelt sie', () => {
    // Die drei Punkte, auf die es ankommt.
    expect(shinyOdds(SHINY_CHAIN_PLATEAU)).toBeCloseTo(SHINY_PLATEAU_ODDS, 6)
    expect(shinyOdds(30)).toBeCloseTo(SHINY_PLATEAU_ODDS, 6)
    expect(shinyOdds(SHINY_CHAIN_GUARANTEE - 1)).toBeCloseTo(SHINY_PLATEAU_ODDS, 6)
    expect(shinyOdds(SHINY_CHAIN_GUARANTEE)).toBe(1)
  })

  it('steigt bis zum Plateau gleichmaessig und bleibt bescheiden', () => {
    /*
     * Die Serie ist ein Weg, kein Schalter.
     *
     * Vorher stand das Plateau bei zehn Prozent und war nach zehn Faengen
     * erreicht: gemessen ueber 200.000 Laeufe kam ein Schillerndes im Schnitt
     * nach **15 Begegnungen**, und in einem echten Spielstand glaenzten 18 %
     * einer Box. Jetzt sind es rund 54 Begegnungen.
     */
    expect(shinyOdds(0)).toBeCloseTo(SHINY_BASE_ODDS, 6)
    expect(shinyOdds(5)).toBeGreaterThan(SHINY_BASE_ODDS)
    expect(shinyOdds(5)).toBeLessThan(0.01)
    for (let s = 1; s <= 60; s++) {
      expect(shinyOdds(s)).toBeGreaterThanOrEqual(shinyOdds(s - 1))
      expect(shinyOdds(s)).toBeLessThanOrEqual(1)
    }
  })

  it('garantiert den Fang ab der Zusage und darueber hinaus', () => {
    expect(shinyOdds(SHINY_CHAIN_GUARANTEE)).toBe(1)
    expect(shinyOdds(SHINY_CHAIN_GUARANTEE + 500)).toBe(1)
    // Knapp davor gilt noch das Plateau — die Zusage ist ein Deckel gegen
    // Pech, keine Rampe.
    expect(shinyOdds(SHINY_CHAIN_GUARANTEE - 1)).toBe(SHINY_PLATEAU_ODDS)
  })

  it('hebt mit dem erforschten Zuschlag die ganze Kurve', () => {
    /*
     * Vorher wirkte er allein auf Serie 0. Mit dem alten Plateau von zehn
     * Prozent fiel das nicht auf; mit 0,35 % waere daraus eine Verkehrung
     * geworden — voll erforscht 0,295 % bei Serie 0, aber nur 0,20 % nach dem
     * ersten Fang. Der Fang haette die Chance gesenkt.
     */
    for (let s = 0; s < SHINY_CHAIN_GUARANTEE; s++) {
      expect(shinyOdds(s, 0.1)).toBeGreaterThan(shinyOdds(s))
      if (s > 0) expect(shinyOdds(s, 0.1)).toBeGreaterThanOrEqual(shinyOdds(s - 1, 0.1))
    }
  })
})

describe('Fundstuecke beim Fangen', () => {
  it('faellt in etwa jedem achten Fang', () => {
    const rng = createRng('drops')
    let hits = 0
    const runs = 4000
    for (let i = 0; i < runs; i++) if (rollCatchDrop(rng)) hits++
    const rate = (hits / runs) * 100
    expect(rate).toBeGreaterThan(CATCH_DROP_CHANCE - 2)
    expect(rate).toBeLessThan(CATCH_DROP_CHANCE + 2)
  })

  it('gibt nur Werkstoffe aus, die Rezepte auch verlangen', () => {
    // Sonst faende man etwas, mit dem sich nichts anfangen laesst.
    const wanted = new Set(RECIPES.flatMap((r) => r.inputs.map((i) => i.itemId)))
    const rng = createRng('drop-ids')
    const seen = new Set<string>()
    for (let i = 0; i < 2000; i++) {
      const id = rollCatchDrop(rng)
      if (id) seen.add(id)
    }
    expect(seen.size).toBeGreaterThan(3)
    for (const id of seen) expect(wanted.has(id)).toBe(true)
  })
})

describe('Saison', () => {
  it('dauert eine Woche', () => {
    expect(SEASON_LENGTH_DAYS).toBe(7)
  })

  it('haelt die ersten Stufen billig und die letzten teuer', () => {
    // Gemessen an echten Werten: ein gelegentlicher Spieler kommt auf rund 450
    // Punkte am Tag, die Leiter endet bei seiner Wochenleistung.
    const tiers = seasonTiers()
    expect(tiers).toHaveLength(25)
    expect(tiers[1]!.pointsRequired).toBeLessThan(60)
    expect(tiers[24]!.pointsRequired).toBeGreaterThan(3000)
    expect(tiers[24]!.pointsRequired).toBeLessThan(3600)
    // Die Abstaende wachsen, kein einziger schrumpft.
    for (let i = 2; i < tiers.length; i++) {
      const step = tiers[i]!.pointsRequired - tiers[i - 1]!.pointsRequired
      const before = tiers[i - 1]!.pointsRequired - tiers[i - 2]!.pointsRequired
      expect(step).toBeGreaterThan(before)
    }
  })

  it('verteilt Gegenstaende ueber die ganze Leiter', () => {
    // Zwoelf Stufen waren zu wenige Momente fuer eine Woche; jetzt soll auf
    // mindestens jeder dritten etwas Greifbares liegen.
    const items = seasonTiers().filter((t) => t.reward.kind === 'item')
    expect(items.length).toBeGreaterThanOrEqual(seasonTiers().length / 3)
  })

  it('legt auf die letzte Stufe das schillernde Fragment', () => {
    expect(rewardForTier(MAX_SEASON_TIER)).toEqual({ kind: 'item', itemId: SHINY_SOUL_ID, quantity: 1 })
    const shinyTiers = seasonTiers().filter(
      (t) => t.reward.kind === 'item' && t.reward.itemId === SHINY_SOUL_ID,
    )
    expect(shinyTiers).toHaveLength(1)
  })
})
