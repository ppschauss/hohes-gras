import { describe, expect, it } from 'vitest'
import type { MoveDef, SpeciesDef } from '@game/content'
import { createRng } from './rng.js'
import { createBattle, resolveTurn, type BattleContent } from './battle.js'
import { npcFighter, makeSide } from './battle-setup.js'
import { emptyStages, MAX_TURNS, type BattleState, type Fighter, type PlayerAction } from './battle-types.js'
import { chooseAction } from './battle-ai.js'
import {
  accuracyCheck, applyStage, canApplyStatus, computeDamage, confusionDamage,
  effectiveStat, movesFirst, stageMultiplier, statusDamage, statusPreventsAction, weatherModifier,
} from './battle-math.js'

/* ------------------------------------------------------------------ Fixtures */

const MOVES: Record<string, MoveDef> = {
  tackle: mv('tackle', 'normal', 'physical', 40, 100, 35),
  ember: mv('ember', 'fire', 'special', 40, 100, 25, { kind: 'status', status: 'burn' }, 100),
  'vine-whip': mv('vine-whip', 'grass', 'physical', 45, 100, 25),
  'water-gun': mv('water-gun', 'water', 'special', 40, 100, 25),
  growl: mv('growl', 'normal', 'status', 0, 100, 40, { kind: 'stat_stage', target: 'foe', stat: 'atk', stages: -1 }, 100),
  'sleep-powder': mv('sleep-powder', 'grass', 'status', 0, 100, 15, { kind: 'status', status: 'sleep' }, 100),
  'never-hits': mv('never-hits', 'normal', 'physical', 100, 0, 10),
  'always-crit': mv('always-crit', 'normal', 'physical', 40, 100, 10, { kind: 'none' }, 0, 3),
  recover: mv('recover', 'normal', 'status', 0, 100, 10, { kind: 'heal', ratio: 0.5 }, 100),
  absorb: mv('absorb', 'grass', 'special', 40, 100, 25, { kind: 'drain', ratio: 0.5 }, 100),
  'take-down': mv('take-down', 'normal', 'physical', 90, 85, 20, { kind: 'recoil', ratio: 0.25 }, 100),
  'double-slap': mv('double-slap', 'normal', 'physical', 15, 85, 10, { kind: 'multi_hit', min: 2, max: 5 }, 100),
  bite: mv('bite', 'normal', 'physical', 60, 100, 25, { kind: 'flinch' }, 100),
  'quick-attack': mv('quick-attack', 'normal', 'physical', 40, 100, 30, { kind: 'none' }, 0, 0, 1),
}

function mv(
  id: string, type: string, category: 'physical' | 'special' | 'status',
  power: number, accuracy: number, pp: number,
  effect: MoveDef['effect'] = { kind: 'none' }, effectChance = 0, critRate = 0, priority = 0,
): MoveDef {
  return { id, name: { de: id }, type, category, power, accuracy, pp, priority, critRate, target: 'foe', effectChance, effect } as MoveDef
}

const CHART: Record<string, Record<string, number>> = {
  fire: { grass: 2, water: 0.5, fire: 0.5 },
  water: { fire: 2, grass: 0.5, water: 0.5 },
  grass: { water: 2, fire: 0.5, grass: 0.5 },
  normal: { ghost: 0 },
}

const content: BattleContent = {
  move: (id) => {
    const m = MOVES[id]
    if (!m) throw new Error(`unbekannte Attacke ${id}`)
    return m
  },
  effectiveness: (atk, defs) => defs.reduce((mult, d) => mult * (CHART[atk]?.[d] ?? 1), 1),
}

const species = (id: string, types: string[], stats = 60): SpeciesDef =>
  ({
    id, types,
    baseStats: { hp: stats, atk: stats, def: stats, spa: stats, spd: stats, spe: stats },
    growthRate: 'medium_fast', sprite: `/${id}.png`, spriteShiny: `/${id}-s.png`,
  } as SpeciesDef)

const ppOf = (id: string) => MOVES[id]?.pp ?? 10

function fighter(id: string, types: string[], level = 20, moves = ['tackle'], stats = 60): Fighter {
  return npcFighter(id, species(id, types, stats), id, level, moves, ppOf)
}

function battle(a: Fighter[], b: Fighter[], seed = 'test'): BattleState {
  return createBattle('b1', 'trainer', seed, makeSide('Spieler', a), makeSide('Gegner', b), 'clear')
}

const useMove = (i = 0): PlayerAction => ({ kind: 'move', moveIndex: i })

/* ------------------------------------------------------------------- Mathe */

describe('stageMultiplier', () => {
  it('ist bei Stufe 0 neutral', () => {
    expect(stageMultiplier(0, 'stat')).toBe(1)
    expect(stageMultiplier(0, 'accuracy')).toBe(1)
  })
  it('verdoppelt bei +2 und halbiert bei -2', () => {
    expect(stageMultiplier(2, 'stat')).toBe(2)
    expect(stageMultiplier(-2, 'stat')).toBe(0.5)
  })
  it('klemmt jenseits von ±6', () => {
    expect(stageMultiplier(99, 'stat')).toBe(stageMultiplier(6, 'stat'))
    expect(stageMultiplier(-99, 'stat')).toBe(stageMultiplier(-6, 'stat'))
  })
})

describe('effectiveStat', () => {
  it('beruecksichtigt Stufen', () => {
    const f = fighter('a', ['normal'])
    const boosted = { ...f, stages: { ...emptyStages(), atk: 2 } }
    expect(effectiveStat(boosted, 'atk')).toBeGreaterThan(effectiveStat(f, 'atk'))
  })
  it('halbiert Angriff bei Verbrennung', () => {
    const f = fighter('a', ['normal'])
    const burned = { ...f, status: 'burn' as const }
    expect(effectiveStat(burned, 'atk')).toBeLessThan(effectiveStat(f, 'atk'))
    expect(effectiveStat(burned, 'spa')).toBe(effectiveStat(f, 'spa'))
  })
  it('halbiert Initiative bei Paralyse', () => {
    const f = fighter('a', ['normal'])
    expect(effectiveStat({ ...f, status: 'paralysis' }, 'spe')).toBeLessThan(effectiveStat(f, 'spe'))
  })
  it('faellt nie unter 1', () => {
    const f = fighter('a', ['normal'], 1, ['tackle'], 1)
    expect(effectiveStat({ ...f, stages: { ...emptyStages(), atk: -6 } }, 'atk')).toBeGreaterThanOrEqual(1)
  })
})

describe('computeDamage', () => {
  const attacker = fighter('att', ['fire'], 50)
  const defender = fighter('def', ['grass'], 50)

  it('verursacht mehr Schaden bei guter Effektivitaet', () => {
    const rng = createRng('dmg')
    const strong = computeDamage(attacker, defender, MOVES['ember']!, 2, 'clear', rng)
    const weak = computeDamage(attacker, defender, MOVES['ember']!, 0.5, 'clear', createRng('dmg'))
    expect(strong.amount).toBeGreaterThan(weak.amount * 3)
  })

  it('meldet Immunitaet statt null Schaden', () => {
    const r = computeDamage(attacker, defender, MOVES['tackle']!, 0, 'clear', createRng('x'))
    expect(r.immune).toBe(true)
    expect(r.amount).toBe(0)
  })

  it('gibt Statusattacken keinen Schaden', () => {
    expect(computeDamage(attacker, defender, MOVES['growl']!, 1, 'clear', createRng('x')).amount).toBe(0)
  })

  it('belohnt den eigenen Typ (STAB)', () => {
    const fireMon = fighter('f', ['fire'], 50)
    const waterMon = fighter('w', ['water'], 50)
    const withStab = computeDamage(fireMon, defender, MOVES['ember']!, 1, 'clear', createRng('s'))
    const withoutStab = computeDamage(waterMon, defender, MOVES['ember']!, 1, 'clear', createRng('s'))
    expect(withStab.amount).toBeGreaterThan(withoutStab.amount)
  })

  it('erzeugt bei critRate 3 immer einen Volltreffer', () => {
    for (let i = 0; i < 30; i++) {
      const r = computeDamage(attacker, defender, MOVES['always-crit']!, 1, 'clear', createRng(`c${i}`))
      expect(r.critical).toBe(true)
    }
  })

  it('richtet immer mindestens 1 Schaden an', () => {
    const tiny = fighter('t', ['normal'], 1, ['tackle'], 1)
    const tank = fighter('k', ['normal'], 100, ['tackle'], 200)
    const r = computeDamage(tiny, tank, MOVES['tackle']!, 0.25, 'clear', createRng('min'))
    expect(r.amount).toBeGreaterThanOrEqual(1)
  })

  it('ist bei gleichem Seed reproduzierbar', () => {
    const a = computeDamage(attacker, defender, MOVES['ember']!, 2, 'rain', createRng('same'))
    const b = computeDamage(attacker, defender, MOVES['ember']!, 2, 'rain', createRng('same'))
    expect(a).toEqual(b)
  })
})

describe('weatherModifier', () => {
  it('staerkt Wasser im Regen und schwaecht Feuer', () => {
    expect(weatherModifier('water', 'rain')).toBeGreaterThan(1)
    expect(weatherModifier('fire', 'rain')).toBeLessThan(1)
  })
  it('laesst unbeteiligte Typen unberuehrt', () => {
    expect(weatherModifier('normal', 'rain')).toBe(1)
    expect(weatherModifier('fire', 'clear')).toBe(1)
  })
})

describe('Status', () => {
  it('verhindert einen zweiten Status', () => {
    const f = { ...fighter('a', ['normal']), status: 'burn' as const }
    expect(canApplyStatus(f, 'sleep')).toEqual({ applied: false, reason: 'already_has_status' })
  })
  it('macht Feuer immun gegen Verbrennung', () => {
    expect(canApplyStatus(fighter('a', ['fire']), 'burn').reason).toBe('type_immune')
  })
  it('macht Elektro immun gegen Paralyse', () => {
    expect(canApplyStatus(fighter('a', ['electric']), 'paralysis').reason).toBe('type_immune')
  })
  it('laesst Toxin mit der Zeit staerker werden', () => {
    const base = { ...fighter('a', ['normal']), status: 'toxic' as const, statusCounter: 1 }
    const later = { ...base, statusCounter: 6 }
    expect(statusDamage(later)).toBeGreaterThan(statusDamage(base))
  })
  it('taut Eis irgendwann auf', () => {
    const frozen = { ...fighter('a', ['normal']), status: 'freeze' as const }
    const rng = createRng('thaw')
    let cured = 0
    for (let i = 0; i < 200; i++) if (statusPreventsAction(frozen, rng).cured) cured++
    expect(cured).toBeGreaterThan(20)
  })
  it('weckt Schlafende nach Ablauf des Zaehlers', () => {
    const sleeping = { ...fighter('a', ['normal']), status: 'sleep' as const, statusCounter: 1 }
    expect(statusPreventsAction(sleeping, createRng('w'))).toEqual({ blocked: false, cured: true })
  })
})

describe('applyStage', () => {
  it('klemmt bei ±6 und meldet das', () => {
    const at6 = { ...emptyStages(), atk: 6 }
    const r = applyStage(at6, 'atk', 1)
    expect(r.applied).toBe(0)
    expect(r.capped).toBe(true)
  })
  it('gibt die tatsaechliche Aenderung zurueck', () => {
    const r = applyStage({ ...emptyStages(), atk: 5 }, 'atk', 2)
    expect(r.applied).toBe(1)
    expect(r.stages.atk).toBe(6)
  })
})

describe('movesFirst', () => {
  it('laesst Priorität gewinnen', () => {
    const slow = { fighter: fighter('s', ['normal'], 5, ['quick-attack'], 10), move: MOVES['quick-attack']! }
    const fast = { fighter: fighter('f', ['normal'], 90, ['tackle'], 200), move: MOVES['tackle']! }
    expect(movesFirst(slow, fast, createRng('p'))).toBe(true)
  })
  it('entscheidet sonst nach Initiative', () => {
    const slow = { fighter: fighter('s', ['normal'], 5, ['tackle'], 10), move: MOVES['tackle']! }
    const fast = { fighter: fighter('f', ['normal'], 90, ['tackle'], 200), move: MOVES['tackle']! }
    expect(movesFirst(fast, slow, createRng('p'))).toBe(true)
  })
})

describe('accuracyCheck', () => {
  it('trifft bei 100 Genauigkeit immer', () => {
    const rng = createRng('acc')
    for (let i = 0; i < 100; i++) {
      expect(accuracyCheck(MOVES['tackle']!, fighter('a', ['normal']), fighter('b', ['normal']), rng)).toBe(true)
    }
  })
  it('verfehlt bei 0 Genauigkeit immer', () => {
    const rng = createRng('miss')
    for (let i = 0; i < 50; i++) {
      expect(accuracyCheck(MOVES['never-hits']!, fighter('a', ['normal']), fighter('b', ['normal']), rng)).toBe(false)
    }
  })
})

describe('confusionDamage', () => {
  it('skaliert mit Level und Angriff', () => {
    expect(confusionDamage(fighter('a', ['normal'], 60))).toBeGreaterThan(confusionDamage(fighter('a', ['normal'], 5)))
  })
})

/* --------------------------------------------------------------- Kampfablauf */

describe('resolveTurn', () => {
  it('fuegt Schaden zu und protokolliert ihn', () => {
    const state = battle([fighter('a', ['normal'], 30)], [fighter('b', ['normal'], 30)])
    const { state: after, events } = resolveTurn(state, useMove(), useMove(), content)
    expect(events.some((e) => e.type === 'move')).toBe(true)
    const damaged = events.filter((e) => e.type === 'damage')
    expect(damaged.length).toBeGreaterThan(0)
    expect(after.sides[1]!.party[0]!.hp).toBeLessThan(after.sides[1]!.party[0]!.hpMax)
  })

  it('laesst den Ausgangszustand unveraendert', () => {
    const state = battle([fighter('a', ['normal'], 30)], [fighter('b', ['normal'], 30)])
    const snapshot = structuredClone(state)
    resolveTurn(state, useMove(), useMove(), content)
    expect(state).toEqual(snapshot)
  })

  it('liefert bei gleichem Seed identische Ereignisse', () => {
    const build = () => battle([fighter('a', ['fire'], 30, ['ember'])], [fighter('b', ['grass'], 30, ['vine-whip'])], 'fix')
    const one = resolveTurn(build(), useMove(), useMove(), content)
    const two = resolveTurn(build(), useMove(), useMove(), content)
    expect(one.events).toEqual(two.events)
    expect(one.state).toEqual(two.state)
  })

  it('erzeugt bei verschiedenen Seeds verschiedene Verlaeufe', () => {
    const run = (seed: string) => {
      let s = battle([fighter('a', ['normal'], 30, ['double-slap'])], [fighter('b', ['normal'], 30)], seed)
      const all: unknown[] = []
      for (let i = 0; i < 5 && !s.outcome; i++) {
        const r = resolveTurn(s, useMove(), useMove(), content)
        s = r.state; all.push(...r.events)
      }
      return JSON.stringify(all)
    }
    expect(run('seed-a')).not.toBe(run('seed-b'))
  })

  it('verbraucht AP', () => {
    const state = battle([fighter('a', ['normal'], 30)], [fighter('b', ['normal'], 30)])
    const { state: after } = resolveTurn(state, useMove(), useMove(), content)
    expect(after.sides[0]!.party[0]!.moves[0]!.pp).toBe(34)
  })

  it('meldet fehlende AP statt still nichts zu tun', () => {
    const state = battle([fighter('a', ['normal'], 30)], [fighter('b', ['normal'], 30)])
    state.sides[0]!.party[0]!.moves[0]!.pp = 0
    const { events } = resolveTurn(state, useMove(), useMove(), content)
    expect(events.some((e) => e.type === 'no_pp' && e.side === 0)).toBe(true)
  })

  it('wechselt vor allen Attacken', () => {
    const state = battle(
      [fighter('a', ['normal'], 30), fighter('a2', ['water'], 30)],
      [fighter('b', ['normal'], 30)],
    )
    const { state: after, events } = resolveTurn(state, { kind: 'switch', partyIndex: 1 }, useMove(), content)
    expect(after.sides[0]!.activeIndex).toBe(1)
    const switchIndex = events.findIndex((e) => e.type === 'switch')
    const moveIndex = events.findIndex((e) => e.type === 'move')
    expect(switchIndex).toBeLessThan(moveIndex)
  })

  it('setzt Stufen beim Wechsel zurueck, Status aber nicht', () => {
    const state = battle(
      [fighter('a', ['normal'], 30), fighter('a2', ['water'], 30)],
      [fighter('b', ['normal'], 30)],
    )
    state.sides[0]!.party[0]!.stages.atk = 4
    state.sides[0]!.party[0]!.status = 'poison'
    const { state: after } = resolveTurn(state, { kind: 'switch', partyIndex: 1 }, useMove(), content)
    expect(after.sides[0]!.party[0]!.stages.atk).toBe(0)
    expect(after.sides[0]!.party[0]!.status).toBe('poison')
  })

  it('setzt Statusattacken um', () => {
    const state = battle([fighter('a', ['normal'], 30, ['growl'])], [fighter('b', ['normal'], 30)])
    const { state: after, events } = resolveTurn(state, useMove(), useMove(), content)
    expect(after.sides[1]!.party[0]!.stages.atk).toBe(-1)
    expect(events.some((e) => e.type === 'stage' && e.delta === -1)).toBe(true)
  })

  it('bringt Gegner zum Schlafen und blockiert sie danach', () => {
    let state = battle([fighter('a', ['grass'], 40, ['sleep-powder'])], [fighter('b', ['normal'], 20)])
    const first = resolveTurn(state, useMove(), useMove(), content)
    expect(first.state.sides[1]!.party[0]!.status).toBe('sleep')
    state = first.state
    const second = resolveTurn(state, useMove(), useMove(), content)
    const blocked = second.events.some((e) => e.type === 'status_blocked' || e.type === 'status_cured')
    expect(blocked).toBe(true)
  })

  it('heilt mit Absorb einen Teil des Schadens', () => {
    const state = battle([fighter('a', ['grass'], 40, ['absorb'])], [fighter('b', ['water'], 40)])
    state.sides[0]!.party[0]!.hp = 10
    const { state: after, events } = resolveTurn(state, useMove(), { kind: 'move', moveIndex: 9 }, content)
    expect(events.some((e) => e.type === 'heal' && e.side === 0)).toBe(true)
    expect(after.sides[0]!.party[0]!.hp).toBeGreaterThan(10)
  })

  it('fuegt bei Rueckstoss auch dem Angreifer Schaden zu', () => {
    const state = battle([fighter('a', ['normal'], 40, ['take-down'])], [fighter('b', ['normal'], 40)])
    let attempts = 0
    let sawRecoil = false
    let s = state
    while (attempts++ < 10 && !sawRecoil && !s.outcome) {
      const r = resolveTurn(s, useMove(), { kind: 'move', moveIndex: 9 }, content)
      sawRecoil = r.events.some((e) => e.type === 'damage' && e.side === 0 && e.amount > 0)
      s = r.state
    }
    expect(sawRecoil).toBe(true)
  })

  it('trifft mit Mehrfachattacken mehrmals', () => {
    // double-slap hat 85 Genauigkeit; ein einzelner Versuch kann danebengehen.
    // Wiederholen statt den Test an den Zufall zu haengen.
    let s = battle([fighter('a', ['normal'], 40, ['double-slap'])], [fighter('b', ['normal'], 60, ['tackle'], 150)])
    let checked = false
    for (let i = 0; i < 12 && !checked && !s.outcome; i++) {
      const r = resolveTurn(s, useMove(), { kind: 'move', moveIndex: 9 }, content)
      const multi = r.events.find((e) => e.type === 'multi_hit')
      if (multi && multi.type === 'multi_hit') {
        const hits = r.events.filter((e) => e.type === 'damage' && e.side === 1).length
        expect(multi.hits).toBeGreaterThanOrEqual(2)
        expect(hits).toBe(multi.hits)
        checked = true
      }
      s = r.state
    }
    expect(checked).toBe(true)
  })

  it('schickt nach einem K.o. das naechste Pokemon', () => {
    const state = battle(
      [fighter('a', ['normal'], 60, ['tackle'], 150)],
      [fighter('b', ['normal'], 5, ['tackle'], 5), fighter('b2', ['normal'], 20)],
    )
    const { state: after, events } = resolveTurn(state, useMove(), useMove(), content)
    expect(events.some((e) => e.type === 'faint' && e.side === 1)).toBe(true)
    expect(after.sides[1]!.activeIndex).toBe(1)
    expect(after.outcome).toBeNull()
  })

  it('beendet den Kampf, wenn eine Seite leer ist', () => {
    const state = battle(
      [fighter('a', ['normal'], 60, ['tackle'], 150)],
      [fighter('b', ['normal'], 5, ['tackle'], 5)],
    )
    const { state: after, events } = resolveTurn(state, useMove(), useMove(), content)
    expect(after.outcome).toEqual({ winner: 0, reason: 'knockout' })
    expect(events.at(-1)?.type).toBe('end')
  })

  it('nimmt nach dem Ende keine weiteren Zuege an', () => {
    let state = battle([fighter('a', ['normal'], 60, ['tackle'], 150)], [fighter('b', ['normal'], 5, ['tackle'], 5)])
    state = resolveTurn(state, useMove(), useMove(), content).state
    const after = resolveTurn(state, useMove(), useMove(), content)
    expect(after.events).toHaveLength(0)
    expect(after.state).toBe(state)
  })

  it('behandelt Aufgeben als sofortige Niederlage', () => {
    const state = battle([fighter('a', ['normal'], 30)], [fighter('b', ['normal'], 30)])
    const { state: after } = resolveTurn(state, { kind: 'forfeit' }, useMove(), content)
    expect(after.outcome).toEqual({ winner: 1, reason: 'forfeit' })
  })

  it('richtet Giftschaden am Rundenende an', () => {
    const state = battle([fighter('a', ['normal'], 30)], [fighter('b', ['normal'], 30)])
    state.sides[0]!.party[0]!.status = 'poison'
    const { events } = resolveTurn(state, useMove(), useMove(), content)
    expect(events.some((e) => e.type === 'status_damage' && e.side === 0)).toBe(true)
  })

  it('ueberlebt eine unbekannte Attacken-Id', () => {
    const state = battle([fighter('a', ['normal'], 30, ['gibtsnicht'])], [fighter('b', ['normal'], 30)])
    const { events } = resolveTurn(state, useMove(), useMove(), content)
    expect(events.some((e) => e.type === 'no_pp' && e.side === 0)).toBe(true)
  })

  it('endet nach dem Rundenlimit unentschieden', () => {
    // Zwei Panzer, die einander praktisch nichts anhaben koennen.
    let state = battle(
      [fighter('a', ['normal'], 5, ['growl'], 200)],
      [fighter('b', ['normal'], 5, ['growl'], 200)],
    )
    state.turn = MAX_TURNS - 1
    const { state: after } = resolveTurn(state, useMove(), useMove(), content)
    expect(after.outcome).toEqual({ winner: null, reason: 'turn_limit' })
  })
})

/* -------------------------------------------------------------------- KI */

describe('chooseAction', () => {
  it('waehlt fuer wilde Pokemon nur Attacken', () => {
    const state = battle([fighter('a', ['normal'], 30)], [fighter('b', ['normal'], 30, ['tackle', 'growl'])])
    const rng = createRng('wild')
    for (let i = 0; i < 30; i++) {
      expect(chooseAction(state, 1, 'wild', content, rng).kind).toBe('move')
    }
  })

  it('bevorzugt als Experte die effektive Attacke', () => {
    const state = battle(
      [fighter('a', ['grass'], 30)],
      [fighter('b', ['fire'], 30, ['tackle', 'ember'])],
    )
    const rng = createRng('expert')
    let chosePreferred = 0
    for (let i = 0; i < 50; i++) {
      const action = chooseAction(state, 1, 'expert', content, rng)
      if (action.kind === 'move' && action.moveIndex === 1) chosePreferred++
    }
    expect(chosePreferred).toBeGreaterThan(40)
  })

  it('macht auf niedriger Stufe deutlich mehr Fehler', () => {
    const state = battle(
      [fighter('a', ['grass'], 30)],
      [fighter('b', ['fire'], 30, ['tackle', 'ember'])],
    )
    const count = (level: 'basic' | 'expert') => {
      const rng = createRng(`ai-${level}`)
      let best = 0
      for (let i = 0; i < 200; i++) {
        const a = chooseAction(state, 1, level, content, rng)
        if (a.kind === 'move' && a.moveIndex === 1) best++
      }
      return best
    }
    expect(count('basic')).toBeLessThan(count('expert'))
  })

  it('waehlt keine Attacke ohne AP', () => {
    const state = battle([fighter('a', ['normal'], 30)], [fighter('b', ['normal'], 30, ['tackle', 'growl'])])
    state.sides[1]!.party[0]!.moves[0]!.pp = 0
    const rng = createRng('pp')
    for (let i = 0; i < 30; i++) {
      const a = chooseAction(state, 1, 'skilled', content, rng)
      if (a.kind === 'move') expect(a.moveIndex).toBe(1)
    }
  })

  it('ist bei gleichem Seed reproduzierbar', () => {
    const state = battle([fighter('a', ['grass'], 30)], [fighter('b', ['fire'], 30, ['tackle', 'ember'])])
    const one = Array.from({ length: 20 }, () => chooseAction(state, 1, 'skilled', content, createRng('same')))
    const two = Array.from({ length: 20 }, () => chooseAction(state, 1, 'skilled', content, createRng('same')))
    expect(one).toEqual(two)
  })
})
