import { describe, expect, it } from 'vitest'
import type { AreaDef, ItemDef, SpeciesDef } from '@game/content'
import { createRng } from './rng.js'
import {
  attemptCatch, availableSpawns, ballMultiplier, catchProbability, catchReward,
  rollEncounter, MAX_CALM_STACKS, type CatchModifiers, type SpawnContext,
} from './encounter.js'

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

  it('liefert null, wenn nichts spawnen kann', () => {
    const empty = { id: 'leer', spawns: [{ speciesId: 'x', weight: 1, minLevel: 1, maxLevel: 1, weather: ['snow'] }] } as unknown as AreaDef
    expect(rollEncounter(empty, { timeOfDay: 'day', weather: 'clear' }, createRng('n'))).toBeNull()
  })

  it('erhoeht die Shiny-Chance mit der Fangserie', () => {
    const count = (chain: number) => {
      const rng = createRng(`shiny-${chain}`)
      let n = 0
      for (let i = 0; i < 40000; i++) {
        if (rollEncounter(area, { timeOfDay: 'day', weather: 'clear' }, rng, chain)!.shiny) n++
      }
      return n
    }
    expect(count(40)).toBeGreaterThan(count(0) * 3)
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

