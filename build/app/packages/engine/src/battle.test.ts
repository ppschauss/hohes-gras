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
  // Vorrang 3, sicheres Zurueckschrecken — und nur direkt nach dem Wechsel.
  'fake-out': {
    ...mv('fake-out', 'normal', 'physical', 40, 100, 10, { kind: 'flinch' }, 100, 0, 3),
    firstTurnOnly: true,
  } as MoveDef,
  protect: mv('protect', 'normal', 'status', 0, 100, 10, { kind: 'protect', against: 'all' }, 100, 0, 4),
  'leech-seed': mv('leech-seed', 'grass', 'status', 0, 90, 10, { kind: 'lingering', effect: 'leech_seed' }, 100),
  'aqua-ring': mv('aqua-ring', 'water', 'status', 0, 100, 20, { kind: 'lingering', effect: 'aqua_ring' }, 100),
  curse: mv('curse', 'ghost', 'status', 0, 100, 10, { kind: 'lingering', effect: 'curse' }, 100),
  yawn: mv('yawn', 'normal', 'status', 0, 100, 10, { kind: 'lingering', effect: 'yawn', turns: 2 }, 100),
  reflect: mv('reflect', 'psychic', 'status', 0, 100, 20, { kind: 'side_condition', condition: 'reflect', turns: 5 }, 100),
  safeguard: mv('safeguard', 'normal', 'status', 0, 100, 25, { kind: 'side_condition', condition: 'safeguard', turns: 5 }, 100),
  'quick-guard': mv('quick-guard', 'steel', 'status', 0, 100, 15, { kind: 'protect', against: 'priority' }, 100, 0, 3),
  'destiny-bond': mv('destiny-bond', 'ghost', 'status', 0, 100, 5, { kind: 'destiny_bond' }, 100),
  endure: mv('endure', 'normal', 'status', 0, 100, 10, { kind: 'endure' }, 100, 0, 4),
  rest: mv('rest', 'psychic', 'status', 0, 100, 5, { kind: 'rest' }, 100),
  refresh: mv('refresh', 'normal', 'status', 0, 100, 20, { kind: 'cure', scope: 'self' }, 100),
  'heal-bell': mv('heal-bell', 'normal', 'status', 0, 100, 5, { kind: 'cure', scope: 'party' }, 100),
  'focus-energy': mv('focus-energy', 'normal', 'status', 0, 100, 30, { kind: 'crit_up', stages: 2, sure: false }, 100),
  'laser-focus': mv('laser-focus', 'normal', 'status', 0, 100, 30, { kind: 'crit_up', stages: 3, sure: true }, 100),
  haze: mv('haze', 'ice', 'status', 0, 100, 30, { kind: 'haze' }, 100),
  'psych-up': mv('psych-up', 'normal', 'status', 0, 100, 10, { kind: 'copy_stages' }, 100),
  // Regentanz: stellt das Wetter um, sonst nichts.
  'rain-dance': mv('rain-dance', 'water', 'status', 0, 100, 5, { kind: 'weather', weather: 'rain' }, 100),
  earthquake: mv('earthquake', 'ground', 'physical', 100, 100, 10),
  // Was auf dem Boden liegt, gehoert keiner Seite — daher `field`.
  'grassy-terrain': ziel(mv('grassy-terrain', 'grass', 'status', 0, 100, 10, { kind: 'terrain', terrain: 'grassy' }, 100), 'field'),
  'misty-terrain': ziel(mv('misty-terrain', 'fairy', 'status', 0, 100, 10, { kind: 'terrain', terrain: 'misty' }, 100), 'field'),
  'electric-terrain': ziel(mv('electric-terrain', 'electric', 'status', 0, 100, 10, { kind: 'terrain', terrain: 'electric' }, 100), 'field'),
  // Vorrang -6 wie im Vorbild: erst einstecken, dann hinausdraengen.
  whirlwind: mv('whirlwind', 'normal', 'status', 0, 100, 20, { kind: 'force_switch' }, 100, 0, -6),
  splash: ziel(mv('splash', 'normal', 'status', 0, 100, 40, { kind: 'nothing' }, 100)),
  'magnet-rise': ziel(mv('magnet-rise', 'electric', 'status', 0, 100, 10, { kind: 'lingering', effect: 'magnet_rise', turns: 5 }, 100)),
  'lucky-chant': ziel(mv('lucky-chant', 'normal', 'status', 0, 100, 30, { kind: 'side_condition', condition: 'lucky_chant', turns: 5 }, 100)),
  'lock-on': ziel(mv('lock-on', 'normal', 'status', 0, 100, 5, { kind: 'lingering', effect: 'sure_hit', turns: 2 }, 100)),
  foresight: mv('foresight', 'normal', 'status', 0, 100, 40, { kind: 'lingering', effect: 'vulnerable' }, 100),
  spikes: ziel(mv('spikes', 'ground', 'status', 0, 100, 20, { kind: 'hazard', hazard: 'spikes' }, 100), 'field'),
  'toxic-spikes': ziel(mv('toxic-spikes', 'poison', 'status', 0, 100, 20, { kind: 'hazard', hazard: 'toxic_spikes' }, 100), 'field'),
  'sticky-web': ziel(mv('sticky-web', 'bug', 'status', 0, 100, 20, { kind: 'hazard', hazard: 'sticky_web' }, 100), 'field'),
  'mean-look': mv('mean-look', 'normal', 'status', 0, 100, 5, { kind: 'lingering', effect: 'trapped' }, 100),
  taunt: mv('taunt', 'dark', 'status', 0, 100, 20, { kind: 'lingering', effect: 'taunt', turns: 3 }, 100),
  'heal-block': mv('heal-block', 'psychic', 'status', 0, 100, 15, { kind: 'lingering', effect: 'heal_block', turns: 5 }, 100),
  'perish-song': mv('perish-song', 'normal', 'status', 0, 100, 5, { kind: 'lingering', effect: 'perish', turns: 3 }, 100),
  wish: ziel(mv('wish', 'normal', 'status', 0, 100, 10, { kind: 'lingering', effect: 'wish', turns: 2 }, 100)),
  'pain-split': mv('pain-split', 'normal', 'status', 0, 100, 20, { kind: 'share', what: 'hp' }, 100),
  'guard-swap': mv('guard-swap', 'psychic', 'status', 0, 100, 10, { kind: 'share', what: 'guard_stages' }, 100),
  spite: mv('spite', 'ghost', 'status', 0, 100, 10, { kind: 'pp_drain', amount: 4 }, 100),
  'belly-drum': ziel(mv('belly-drum', 'normal', 'status', 0, 100, 10, { kind: 'belly_drum' }, 100)),
  'baton-pass': ziel(mv('baton-pass', 'normal', 'status', 0, 100, 40, { kind: 'baton_pass' }, 100)),
  'mud-sport': ziel(mv('mud-sport', 'ground', 'status', 0, 100, 15, { kind: 'side_condition', condition: 'mud_sport', turns: 5 }, 100)),
  'thunder-shock': mv('thunder-shock', 'electric', 'special', 60, 100, 30),
  harden: ziel(mv('harden', 'normal', 'status', 0, 100, 30, { kind: 'stat_stage', target: 'self', stat: 'def', stages: 2 }, 100)),
  'mirror-move': mv('mirror-move', 'flying', 'status', 0, 100, 20, { kind: 'call_move', source: 'foe_last' }, 100),
  metronome: ziel(mv('metronome', 'normal', 'status', 0, 100, 10, { kind: 'call_move', source: 'any_random' }, 100)),
  mimic: mv('mimic', 'normal', 'status', 0, 100, 10, { kind: 'copy_move' }, 100),
  soak: mv('soak', 'water', 'status', 0, 100, 20, { kind: 'type_change', to: 'water' }, 100),
  'reflect-type': ziel(mv('reflect-type', 'normal', 'status', 0, 100, 15, { kind: 'type_change', to: 'target' }, 100)),
  substitute: ziel(mv('substitute', 'normal', 'status', 0, 100, 10, { kind: 'substitute' }, 100)),
  transform: mv('transform', 'normal', 'status', 0, 100, 10, { kind: 'transform' }, 100),
  'magic-coat': ziel(mv('magic-coat', 'psychic', 'status', 0, 100, 15, { kind: 'magic_coat' }, 100, 0, 4)),
  gravity: ziel(mv('gravity', 'psychic', 'status', 0, 100, 5, { kind: 'field', field: 'gravity', turns: 5 }, 100), 'field'),
  'ion-deluge': ziel(mv('ion-deluge', 'electric', 'status', 0, 100, 25, { kind: 'field', field: 'ion_deluge', turns: 2 }, 100), 'field'),
  // Traumfresser: hohe Staerke, halbes Aussaugen — und nur gegen Schlafende.
  'dream-eater': {
    ...mv('dream-eater', 'normal', 'special', 100, 100, 15, { kind: 'drain', ratio: 0.5 }, 100),
    requiresTargetStatus: 'sleep',
  } as MoveDef,
}

/** Ein Zug, der nicht auf den Gegenueber zielt. Bewusst eine Funktion und
 *  keine Konstante: `MOVES` steht darueber und braucht sie schon. */
function ziel(m: MoveDef, target: 'self' | 'field' = 'self'): MoveDef {
  return { ...m, target }
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

describe('Wer besiegt wird, verliert seinen Zug', () => {
  it('laesst den Nachrueckenden nicht den Angriff des Gefallenen ausfuehren', () => {
    /*
     * Gemeldet von einem Spieler: "jedesmal wenn der Gegner ein Pokemon
     * eingewechselt hat, konnte es instant eine Attacke benutzen." Genau das
     * passierte — der Zug wurde beim Ausfuehren dem *aktuell* aktiven Pokemon
     * zugeordnet, nicht dem, das ihn angesagt hatte.
     */
    const stark = fighter('stark', ['normal'], 50, ['tackle'], 200)
    const schwach = fighter('schwach', ['normal'], 5, ['tackle'], 20)
    const ersatz = fighter('ersatz', ['normal'], 50, ['tackle'], 200)
    // Der Gegner faellt in dieser Runde; sein Ersatz darf nicht mehr schlagen.
    const state = battle([stark], [schwach, ersatz])

    const turn = resolveTurn(state, useMove(), useMove(), content)
    expect(turn.events.some((e) => e.type === 'faint' && e.side === 1)).toBe(true)
    expect(turn.events.some((e) => e.type === 'switch' && e.side === 1)).toBe(true)
    // Genau ein Schaden in dieser Runde: unserer.
    const treffer = turn.events.filter((e) => e.type === 'damage')
    expect(treffer).toHaveLength(1)
    expect(treffer[0]!.side).toBe(1)
  })
})

describe('Zuege, die etwas vorbereiten', () => {
  it('laesst am Schutzschild alles abprallen', () => {
    const a = fighter('schild', ['normal'], 20, ['protect'])
    const b = fighter('gegner', ['normal'], 20, ['tackle'])
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)

    expect(runde.events.some((e) => e.type === 'protected')).toBe(true)
    expect(runde.events.some((e) => e.type === 'damage' && e.side === 0)).toBe(false)
    expect(runde.state.sides[0]!.party[0]!.hp).toBe(a.hpMax)
  })

  it('haelt den Schutz nur eine Runde', () => {
    const a = fighter('schild', ['normal'], 20, ['protect'])
    const b = fighter('gegner', ['normal'], 20, ['tackle'])
    const erste = resolveTurn(battle([a], [b]), useMove(), useMove(), content)
    // Zweite Runde: der Schild wurde nicht erneuert.
    const zweite = resolveTurn(erste.state, { kind: 'move', moveIndex: 0 }, useMove(), content)
    // Er setzt ihn erneut, also prallt es wieder ab — aber der Merker traegt
    // die neue Runde, nicht die alte.
    expect(zweite.state.sides[0]!.party[0]!.protectedUntilTurn).toBe(zweite.state.turn)
  })

  it('laesst Ausdauer einen Kraftpunkt stehen', () => {
    const a = { ...fighter('zaeh', ['normal'], 20, ['endure']), hp: 3 }
    const b = fighter('gegner', ['normal'], 50, ['tackle'])
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)

    expect(runde.state.sides[0]!.party[0]!.hp).toBe(1)
    expect(runde.events.some((e) => e.type === 'endured')).toBe(true)
    expect(runde.events.some((e) => e.type === 'faint')).toBe(false)
  })

  it('heilt mit Erholung voll und schlaefert dafuer ein', () => {
    const a = { ...fighter('muede', ['psychic'], 20, ['rest']), hp: 5, status: 'burn' as const }
    // Ein Gegner mit Statuszug: sonst misst der Test seinen Treffer mit.
    const b = fighter('gegner', ['normal'], 5, ['growl'])
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)
    const nachher = runde.state.sides[0]!.party[0]!

    expect(nachher.hp).toBe(nachher.hpMax)
    expect(nachher.status).toBe('sleep')
  })

  it('heilt mit Vitalglocke das ganze Team', () => {
    const a = { ...fighter('glocke', ['normal'], 20, ['heal-bell']), status: 'poison' as const }
    const zweiter = { ...fighter('hinten', ['normal'], 20, ['tackle']), status: 'burn' as const }
    const b = fighter('gegner', ['normal'], 5, ['tackle'])
    const runde = resolveTurn(battle([a, zweiter], [b]), useMove(), useMove(), content)

    expect(runde.state.sides[0]!.party.every((f) => f.status === 'none')).toBe(true)
  })

  it('macht aus Konzentration genau einen sicheren Volltreffer', () => {
    const a = fighter('scharf', ['normal'], 20, ['laser-focus', 'tackle'])
    const b = fighter('gegner', ['normal'], 20, ['tackle'])
    const vorbereitet = resolveTurn(battle([a], [b]), useMove(0), useMove(), content)
    expect(vorbereitet.state.sides[0]!.party[0]!.sureCrit).toBe(true)

    const schlag = resolveTurn(vorbereitet.state, useMove(1), useMove(), content)
    expect(schlag.events.some((e) => e.type === 'damage' && e.side === 1 && e.critical)).toBe(true)
    // Und er ist verbraucht.
    expect(schlag.state.sides[0]!.party[0]!.sureCrit).toBe(false)
  })

  it('raeumt mit Dunkelnebel beide Seiten ab', () => {
    const a = fighter('nebel', ['ice'], 20, ['haze'])
    const b = fighter('gegner', ['normal'], 20, ['tackle'])
    const start = battle([a], [b])
    start.sides[0]!.party[0]!.stages.atk = 2
    start.sides[1]!.party[0]!.stages.def = -3

    const runde = resolveTurn(start, useMove(), useMove(), content)
    expect(runde.state.sides[0]!.party[0]!.stages.atk).toBe(0)
    expect(runde.state.sides[1]!.party[0]!.stages.def).toBe(0)
  })

  it('uebernimmt mit Psycho-Plus die Werteaenderungen des Ziels', () => {
    const a = fighter('kopie', ['normal'], 20, ['psych-up'])
    const b = fighter('gegner', ['normal'], 20, ['tackle'])
    const start = battle([a], [b])
    start.sides[1]!.party[0]!.stages.atk = 3

    const runde = resolveTurn(start, useMove(), useMove(), content)
    expect(runde.state.sides[0]!.party[0]!.stages.atk).toBe(3)
  })
})

describe('Effekte, die ueber Runden wirken', () => {
  it('zieht mit Egelsamen ab und speist den Setzer', () => {
    const a = { ...fighter('saeer', ['grass'], 20, ['leech-seed']), hp: 30 }
    const b = fighter('opfer', ['normal'], 20, ['growl'])
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)

    const opfer = runde.state.sides[1]!.party[0]!
    const saeer = runde.state.sides[0]!.party[0]!
    expect(opfer.lingering?.some((l) => l.kind === 'leech_seed')).toBe(true)
    expect(opfer.hp).toBeLessThan(opfer.hpMax)
    // Was drueben abgeht, kommt hier an — das ist der ganze Zug.
    expect(saeer.hp).toBeGreaterThan(30)
  })

  it('gibt mit dem Wasserring jede Runde etwas zurueck', () => {
    const a = { ...fighter('ring', ['water'], 20, ['aqua-ring']), hp: 10 }
    const b = fighter('gegner', ['normal'], 5, ['growl'])
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)
    expect(runde.state.sides[0]!.party[0]!.hp).toBeGreaterThan(10)
  })

  it('laesst einen Geist mit Fluch die Haelfte zahlen', () => {
    const a = fighter('geist', ['ghost'], 20, ['curse'])
    const b = fighter('ziel', ['normal'], 20, ['growl'])
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)

    const geist = runde.state.sides[0]!.party[0]!
    const ziel = runde.state.sides[1]!.party[0]!
    expect(geist.hp).toBeLessThanOrEqual(Math.ceil(geist.hpMax / 2))
    expect(ziel.lingering?.some((l) => l.kind === 'curse')).toBe(true)
  })

  it('schlaefert mit Gaehner erst eine Runde spaeter ein', () => {
    const a = fighter('muede', ['normal'], 20, ['yawn'])
    const b = fighter('ziel', ['normal'], 5, ['growl'])
    const erste = resolveTurn(battle([a], [b]), useMove(), useMove(), content)
    expect(erste.state.sides[1]!.party[0]!.status).toBe('none')

    const zweite = resolveTurn(erste.state, useMove(), useMove(), content)
    expect(zweite.state.sides[1]!.party[0]!.status).toBe('sleep')
  })

  it('halbiert mit dem Reflektor physischen Schaden', () => {
    /*
     * Der Setzer muss schneller sein, sonst steht der Schirm erst, nachdem
     * der Schlag gefallen ist — richtig so, aber dann misst der Test nichts.
     */
    const mit = fighter('schirm', ['psychic'], 40, ['reflect'])
    const gegner = fighter('gegner', ['normal'], 20, ['tackle'])
    const runde = resolveTurn(battle([mit], [gegner]), useMove(), useMove(), content)
    const nachSchirm = runde.state.sides[0]!.party[0]!.hpMax - runde.state.sides[0]!.party[0]!.hp

    // Dieselbe Aufstellung ohne Schirm, damit der Vergleich einer ist.
    const ohne = fighter('ohne', ['psychic'], 40, ['growl'])
    const blank = resolveTurn(battle([ohne], [gegner]), useMove(), useMove(), content)
    const roh = blank.state.sides[0]!.party[0]!.hpMax - blank.state.sides[0]!.party[0]!.hp

    expect(nachSchirm).toBeLessThan(roh)
    expect(runde.events.some((e) => e.type === 'blocked' && e.by === 'reflect')).toBe(true)
  })

  it('haelt mit Bodyguard Zustaende ab', () => {
    const a = fighter('wache', ['normal'], 40, ['safeguard'])
    const b = fighter('gegner', ['fire'], 20, ['ember'])
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)

    expect(runde.state.sides[0]!.party[0]!.status).toBe('none')
    expect(runde.events.some((e) => e.type === 'blocked' && e.by === 'safeguard')).toBe(true)
  })
})

describe('Rapidschutz und Abgangsbund', () => {
  it('haelt nur Vorrangzuege ab', () => {
    /*
     * Im Vorbild schuetzt Rapidschutz das ganze Team. Im Einzelkampf ist das
     * genau einer — der Zug bleibt also sinnvoll, und Doppelkaempfe braucht
     * es dafuer nicht.
     */
    const a = fighter('wache', ['steel'], 20, ['quick-guard'])
    const schnell = fighter('flink', ['normal'], 20, ['quick-attack'])
    const abgeprallt = resolveTurn(battle([a], [schnell]), useMove(), useMove(), content)
    expect(abgeprallt.events.some((e) => e.type === 'protected')).toBe(true)
    expect(abgeprallt.events.some((e) => e.type === 'damage' && e.side === 0)).toBe(false)
  })

  it('laesst gewoehnliche Angriffe durch', () => {
    const a = fighter('wache', ['steel'], 20, ['quick-guard'])
    const b = fighter('gegner', ['normal'], 20, ['tackle'])
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)
    expect(runde.events.some((e) => e.type === 'damage' && e.side === 0)).toBe(true)
  })

  it('reisst mit dem Abgangsbund den Angreifer mit', () => {
    const a = { ...fighter('geist', ['ghost'], 20, ['destiny-bond']), hp: 1 }
    /*
     * Zwei Feinheiten, die der Test erst nach zwei Fehlschlaegen gelernt hat:
     * Normal wirkt nicht auf Geist, der Gegner braucht also einen Zug, der
     * trifft. Und der Bund muss *vor* dem toedlichen Treffer stehen — ein
     * schnellerer Gegner faellt ihn, bevor es ihn gibt. Deshalb ein
     * langsamerer; ein Treffer reicht bei einem Kraftpunkt ohnehin.
     */
    const b = fighter('gegner', ['water'], 5, ['water-gun'])
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)

    expect(runde.state.sides[0]!.party[0]!.hp).toBe(0)
    expect(runde.state.sides[1]!.party[0]!.hp).toBe(0)
  })
})

describe('Wetter umstellen', () => {
  /*
   * Regentanz, Sonnentag, Sandsturm und Hagelsturm standen ohne Wirkung im
   * Pack — gemessen in 79 Attackenplaetzen, die damit jedes Mal einen Zug
   * verschenkten. Das Wetter aendert den Schaden laengst; es fehlte nur der
   * Weg, es absichtlich zu setzen.
   */
  it('setzt das Wetter und meldet es', () => {
    const a = fighter('quaxo', ['water'], 20, ['rain-dance'])
    const b = fighter('ziel', ['normal'], 20, ['tackle'])
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)

    expect(runde.state.weather).toBe('rain')
    expect(runde.events.some((e) => e.type === 'weather' && e.weather === 'rain')).toBe(true)
  })

  it('meldet nichts, wenn sich nichts aendert', () => {
    // Ein zweiter Regentanz bei Regen verschenkt den Zug — das ist die
    // Entscheidung des Spielers, aber kein Erfolg, den man feiern muesste.
    const a = fighter('quaxo', ['water'], 20, ['rain-dance'])
    const b = fighter('ziel', ['normal'], 20, ['tackle'])
    const erste = resolveTurn(battle([a], [b]), useMove(), useMove(), content)
    const zweite = resolveTurn(erste.state, useMove(), useMove(), content)

    expect(zweite.state.weather).toBe('rain')
    expect(zweite.events.some((e) => e.type === 'weather')).toBe(false)
  })

  it('laesst die KI es bei Regen liegen', () => {
    /*
     * Nur die Verneinung wird geprueft. Ob sie bei trockenem Wetter den Tanz
     * oder den Angriff waehlt, ist eine Abwaegung — dass sie ihn bei Regen
     * *nicht* waehlt, ist eine Regel.
     */
    const gegner = fighter('quaxo', ['water'], 20, ['rain-dance', 'tackle'])
    const spieler = fighter('ziel', ['normal'], 20, ['tackle'])
    const nass = { ...battle([spieler], [gegner]), weather: 'rain' as const }

    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      expect(chooseAction(nass, 1, 'expert', content, createRng(seed)))
        .toEqual({ kind: 'move', moveIndex: 1 })
    }
  })
})

describe('Zuege, die einen Zustand voraussetzen', () => {
  it('laesst Traumfresser gegen ein waches Ziel scheitern', () => {
    /*
     * Gemeldet: "Traumfresser macht einfach so dmg ohne dass das Pokemon
     * schlaeft". Im Pack stand die Bedingung nur im Beschreibungstext, also
     * war er eine Spezialattacke mit 100 Staerke und halbem Aussaugen ohne
     * jede Schranke.
     */
    const a = fighter('hypno', ['normal'], 20, ['dream-eater'])
    const b = fighter('ziel', ['normal'], 20, ['tackle'])
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)

    expect(runde.events.some((e) => e.type === 'move_failed')).toBe(true)
    // Kein Schaden auf der Gegenseite und keine Heilung fuer den Angreifer.
    expect(runde.events.some((e) => e.type === 'damage' && e.side === 1)).toBe(false)
    expect(runde.events.some((e) => e.type === 'heal' && e.side === 0)).toBe(false)
  })

  it('laesst ihn gegen ein schlafendes Ziel treffen', () => {
    const a = fighter('hypno', ['normal'], 20, ['dream-eater'])
    const b = { ...fighter('ziel', ['normal'], 20, ['tackle']), status: 'sleep' as const, statusCounter: 3 }
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)

    expect(runde.events.some((e) => e.type === 'move_failed')).toBe(false)
    expect(runde.events.some((e) => e.type === 'damage' && e.side === 1)).toBe(true)
  })

  it('kostet den Fehlversuch trotzdem einen PP', () => {
    // Sonst waere das blinde Draufhalten gratis.
    const a = fighter('hypno', ['normal'], 20, ['dream-eater'])
    const b = fighter('ziel', ['normal'], 20, ['tackle'])
    const vorher = a.moves[0]!.pp
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)

    expect(runde.state.sides[0]!.party[0]!.moves[0]!.pp).toBe(vorher - 1)
  })

  it('laesst die KI ihn gegen ein waches Ziel liegen', () => {
    // Ohne diese Wertung stuende er oben und ginge jede Runde ins Leere.
    const gegner = fighter('hypno', ['normal'], 20, ['dream-eater', 'tackle'])
    const wach = fighter('spieler', ['normal'], 20, ['tackle'])
    const state = battle([wach], [gegner])

    const zug = chooseAction(state, 1, 'expert', content, createRng('wach'))
    expect(zug).toEqual({ kind: 'move', moveIndex: 1 })
  })
})

describe('Zuege nur in der ersten Runde', () => {
  it('laesst Mogelhieb kein zweites Mal zu', () => {
    /*
     * Gemeldet: ein Mauzi setzte Mogelhieb jede Runde ein. Vorrang 3 und
     * hundert Prozent Zurueckschrecken heisst, der Gegenueber kommt nie zum
     * Zug — der Kampf sieht eingefroren aus.
     */
    const a = fighter('mauzi', ['normal'], 20, ['fake-out'])
    const b = fighter('ziel', ['normal'], 20, ['tackle'])
    let state = battle([a], [b])

    const first = resolveTurn(state, useMove(), useMove(), content)
    expect(first.events.some((e) => e.type === 'flinch')).toBe(true)
    expect(first.events.some((e) => e.type === 'move_failed')).toBe(false)
    state = first.state

    const second = resolveTurn(state, useMove(), useMove(), content)
    expect(second.events.some((e) => e.type === 'move_failed')).toBe(true)
    // Und der Gegenueber kommt endlich zum Zug: der Treffer landet bei uns.
    expect(second.events.some((e) => e.type === 'damage' && e.side === 0)).toBe(true)
  })

  it('erlaubt ihn dem Nachrueckenden nach einem besiegten Vorgaenger', () => {
    // Wer einspringt, hat seinen ersten Zug noch vor sich — auch wenn er
    // mitten in der Runde aufs Feld kommt.
    const schwach = fighter('schwach', ['normal'], 5, ['tackle'])
    const zweit = fighter('zweiter', ['normal'], 20, ['fake-out'])
    const gegner = fighter('gegner', ['normal'], 40, ['tackle'], 200)
    let state = battle([schwach, zweit], [gegner])

    // So lange kaempfen, bis der erste faellt und der zweite nachrueckt.
    for (let i = 0; i < 10 && state.sides[0]!.activeIndex === 0 && !state.outcome; i++) {
      state = resolveTurn(state, useMove(), useMove(), content).state
    }
    expect(state.sides[0]!.activeIndex).toBe(1)

    const after = resolveTurn(state, useMove(), useMove(), content)
    expect(after.events.some((e) => e.type === 'move_failed')).toBe(false)
  })

  it('erlaubt ihn nach einem Wechsel wieder', () => {
    const a = fighter('mauzi', ['normal'], 20, ['fake-out'])
    const zweit = fighter('zweiter', ['normal'], 20, ['fake-out'])
    const b = fighter('ziel', ['normal'], 20, ['tackle'])
    let state = battle([a, zweit], [b])

    state = resolveTurn(state, useMove(), useMove(), content).state
    // Wechseln und wieder einwechseln: die Zaehlung beginnt von vorn.
    state = resolveTurn(state, { kind: 'switch', partyIndex: 1 }, useMove(), content).state
    const after = resolveTurn(state, useMove(), useMove(), content)
    expect(after.events.some((e) => e.type === 'move_failed')).toBe(false)
  })
})

describe('Was auf dem Boden liegt', () => {
  /*
   * Grasfeld allein stand in 19 Attackenplaetzen und tat nichts — von allen
   * wirkungslosen Statuszuegen war es der meistgelernte. Ein Feld gehoert
   * keiner Seite: es heilt beide, es schuetzt beide, und genau das ist der
   * Unterschied zu einem Schirm.
   */
  it('heilt am Rundenende beide Seiten', () => {
    const a = fighter('gras', ['grass'], 20, ['grassy-terrain', 'splash'], 80)
    const b = fighter('ziel', ['normal'], 20, ['splash'], 60)
    const start = battle([a], [b])
    start.sides[0]!.party[0]!.hp = 10
    start.sides[1]!.party[0]!.hp = 10

    const runde = resolveTurn(start, useMove(), useMove(), content)

    expect(runde.state.terrain).toEqual({ kind: 'grassy', turns: 4 })
    expect(runde.events.filter((e) => e.type === 'heal')).toHaveLength(2)
  })

  it('verfliegt nach fuenf Runden', () => {
    const a = fighter('gras', ['grass'], 20, ['grassy-terrain', 'splash'], 80)
    const b = fighter('ziel', ['normal'], 20, ['splash'], 60)
    let lauf = resolveTurn(battle([a], [b]), useMove(0), useMove(), content)
    // Ab hier platschert er nur noch, sonst stellt er das Feld jede Runde neu.
    for (let i = 0; i < 4; i++) lauf = resolveTurn(lauf.state, useMove(1), useMove(), content)

    expect(lauf.state.terrain).toBeNull()
    expect(lauf.events.some((e) => e.type === 'terrain' && e.terrain === null)).toBe(true)
  })

  it('haelt im Nebel jeden Zustand ab', () => {
    const a = fighter('nebel', ['fairy'], 20, ['misty-terrain', 'sleep-powder'], 80)
    const b = fighter('ziel', ['normal'], 20, ['splash'], 60)
    const erste = resolveTurn(battle([a], [b]), useMove(0), useMove(), content)
    const zweite = resolveTurn(erste.state, useMove(1), useMove(), content)

    expect(zweite.state.sides[1]!.party[0]!.status).toBe('none')
    expect(zweite.events.some((e) => e.type === 'blocked' && e.by === 'terrain')).toBe(true)
  })

  it('haelt im Strom nur den Schlaf ab', () => {
    /*
     * Der Unterschied ist der Sinn der beiden Felder: Nebel nimmt alles,
     * Strom nur das Einschlafen. Ein Test, der nur das Blockieren prueft,
     * waere von einem zu strengen Feld nicht zu unterscheiden.
     */
    const a = fighter('strom', ['electric'], 20, ['electric-terrain', 'sleep-powder', 'ember'], 80)
    const b = fighter('ziel', ['normal'], 20, ['splash'], 60)
    const erste = resolveTurn(battle([a], [b]), useMove(0), useMove(), content)
    const schlaf = resolveTurn(erste.state, useMove(1), useMove(), content)
    expect(schlaf.state.sides[1]!.party[0]!.status).toBe('none')

    const brand = resolveTurn(schlaf.state, useMove(2), useMove(), content)
    expect(brand.state.sides[1]!.party[0]!.status).toBe('burn')
  })
})

describe('Jemanden aus dem Kampf draengen', () => {
  it('tauscht den Gegner gegen jemanden von der Bank', () => {
    const a = fighter('wind', ['normal'], 20, ['whirlwind'], 80)
    const erster = fighter('vorne', ['normal'], 20, ['splash'], 60)
    const zweiter = fighter('bank', ['normal'], 20, ['splash'], 60)
    const runde = resolveTurn(battle([a], [erster, zweiter]), useMove(), useMove(), content)

    expect(runde.state.sides[1]!.activeIndex).toBe(1)
    expect(runde.events.some((e) => e.type === 'forced_out' && e.fighter === 'vorne')).toBe(true)
  })

  it('scheitert, wenn niemand auf der Bank sitzt', () => {
    const a = fighter('wind', ['normal'], 20, ['whirlwind'], 80)
    const b = fighter('allein', ['normal'], 20, ['splash'], 60)
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)

    expect(runde.state.sides[1]!.activeIndex).toBe(0)
    expect(runde.events.some((e) => e.type === 'move_failed')).toBe(true)
  })
})

describe('Magnetflug, Beschwoerung, sichere Treffer', () => {
  it('laesst Bodenzuege ins Leere gehen', () => {
    const heben = (zug: number) => {
      const a = fighter('magnet', ['steel'], 20, ['magnet-rise', 'splash'], 80)
      const b = fighter('erde', ['ground'], 20, ['earthquake'], 60)
      return resolveTurn(battle([a], [b]), useMove(zug), useMove(), content)
    }
    // Zug 0 hebt ab, Zug 1 platschert — sonst waere nicht zu sehen, woran es lag.
    expect(heben(0).events.some((e) => e.type === 'damage' && e.amount > 0)).toBe(false)
    expect(heben(1).events.some((e) => e.type === 'damage' && e.amount > 0)).toBe(true)
  })

  it('nimmt der Gegenseite die Volltreffer', () => {
    const kritisch = (zug: number) => {
      const a = fighter('chor', ['normal'], 20, ['lucky-chant', 'splash'], 80)
      const b = fighter('scharf', ['normal'], 20, ['always-crit'], 60)
      const runde = resolveTurn(battle([a], [b]), useMove(zug), useMove(), content)
      return runde.events.some((e) => e.type === 'damage' && e.critical)
    }
    expect(kritisch(0)).toBe(false)
    expect(kritisch(1)).toBe(true)
  })

  it('laesst nach dem Zielschuss auch treffen, was nie trifft', () => {
    const a = fighter('peiler', ['normal'], 20, ['lock-on', 'never-hits'], 80)
    const b = fighter('ziel', ['normal'], 20, ['splash'], 60)
    const gepeilt = resolveTurn(
      resolveTurn(battle([a], [b]), useMove(0), useMove(), content).state,
      useMove(1), useMove(), content,
    )
    expect(gepeilt.events.some((e) => e.type === 'miss')).toBe(false)

    // Ohne Peilung geht derselbe Zug daneben — sonst pruefte der Test nichts.
    const blind = resolveTurn(battle([a], [b]), useMove(1), useMove(), content)
    expect(blind.events.some((e) => e.type === 'miss')).toBe(true)
  })

  it('macht ein durchschautes Ziel fuer jeden treffbar', () => {
    const a = fighter('blick', ['normal'], 20, ['foresight', 'never-hits'], 80)
    const b = fighter('ziel', ['normal'], 20, ['splash'], 60)
    const durchschaut = resolveTurn(
      resolveTurn(battle([a], [b]), useMove(0), useMove(), content).state,
      useMove(1), useMove(), content,
    )
    expect(durchschaut.events.some((e) => e.type === 'miss')).toBe(false)
  })

  it('laesst alles Anhaltende beim Wechsel zurueck', () => {
    /*
     * Ein Egelsamen beschreibt eine Lage auf dem Feld, kein Leiden am Pokemon
     * — anders als Gift, das genau darum bleibt. Wer sich zurueckzieht,
     * schuettelt ihn ab; das ist der Grund, sich zurueckzuziehen.
     */
    const a = fighter('opfer', ['normal'], 20, ['splash'], 60)
    const ersatz = fighter('ersatz', ['normal'], 20, ['splash'], 60)
    const b = fighter('saeer', ['grass'], 20, ['leech-seed'], 80)
    const gesaet = resolveTurn(battle([a, ersatz], [b]), useMove(), useMove(), content)
    expect(gesaet.state.sides[0]!.party[0]!.lingering).toHaveLength(1)

    const gewechselt = resolveTurn(gesaet.state, { kind: 'switch', partyIndex: 1 }, useMove(), content)
    expect(gewechselt.state.sides[0]!.party[0]!.lingering).toEqual([])
  })
})

describe('Fallen, Fesseln und geteilte Werte', () => {
  it('erwischt jeden, der nach den Stachlern hereinkommt', () => {
    const a = fighter('streuer', ['ground'], 20, ['spikes'], 80)
    const vorne = fighter('vorne', ['normal'], 20, ['splash'], 60)
    const bank = fighter('bank', ['normal'], 20, ['splash'], 60)
    const gelegt = resolveTurn(battle([vorne, bank], [a]), useMove(), useMove(), content)
    expect(gelegt.state.sides[0]!.conditions?.[0]).toMatchObject({ kind: 'spikes', turns: null, layers: 1 })

    const gewechselt = resolveTurn(gelegt.state, { kind: 'switch', partyIndex: 1 }, useMove(), content)
    expect(gewechselt.events.some((e) => e.type === 'hazard' && e.kind === 'spikes')).toBe(true)
    expect(gewechselt.state.sides[0]!.party[1]!.hp).toBeLessThan(gewechselt.state.sides[0]!.party[1]!.hpMax)
  })

  it('laesst Fliegende ueber die Stachler hinweg', () => {
    const a = fighter('streuer', ['ground'], 20, ['spikes'], 80)
    const vorne = fighter('vorne', ['normal'], 20, ['splash'], 60)
    const flieger = fighter('flieger', ['flying'], 20, ['splash'], 60)
    const gelegt = resolveTurn(battle([vorne, flieger], [a]), useMove(), useMove(), content)
    const gewechselt = resolveTurn(gelegt.state, { kind: 'switch', partyIndex: 1 }, useMove(), content)

    expect(gewechselt.events.some((e) => e.type === 'hazard')).toBe(false)
    expect(gewechselt.state.sides[0]!.party[1]!.hp).toBe(gewechselt.state.sides[0]!.party[1]!.hpMax)
  })

  it('laesst ein Giftpokemon die Giftspitzen aufraeumen', () => {
    /*
     * Der einzige Weg, sie wieder loszuwerden — ohne ihn waere die Falle
     * eine Einbahnstrasse. Geprueft wird beides: kein Gift und kein Rest.
     */
    const a = fighter('streuer', ['poison'], 20, ['toxic-spikes', 'splash'], 80)
    const vorne = fighter('vorne', ['normal'], 20, ['splash'], 60)
    const giftig = fighter('giftig', ['poison'], 20, ['splash'], 60)
    const gelegt = resolveTurn(battle([vorne, giftig], [a]), useMove(), useMove(0), content)
    // In Runde zwei platschert der Streuer, sonst legt er sie sofort neu —
    // Wechsel gehen den Zuegen voraus, und der Test saehe nur den Neuwurf.
    const gewechselt = resolveTurn(gelegt.state, { kind: 'switch', partyIndex: 1 }, useMove(1), content)

    expect(gewechselt.state.sides[0]!.party[1]!.status).toBe('none')
    expect(gewechselt.state.sides[0]!.conditions).toEqual([])
  })

  it('haelt fest, wer festgehalten wird', () => {
    const a = fighter('opfer', ['normal'], 20, ['splash'], 60)
    const bank = fighter('bank', ['normal'], 20, ['splash'], 60)
    const b = fighter('blick', ['ghost'], 20, ['mean-look'], 80)
    const gefesselt = resolveTurn(battle([a, bank], [b]), useMove(), useMove(), content)
    const versucht = resolveTurn(gefesselt.state, { kind: 'switch', partyIndex: 1 }, useMove(), content)

    expect(versucht.state.sides[0]!.activeIndex).toBe(0)
    expect(versucht.events.some((e) => e.type === 'trapped')).toBe(true)
  })

  it('nimmt dem Verhoehnten seine Statuszuege', () => {
    const a = fighter('opfer', ['normal'], 20, ['harden', 'tackle'], 60)
    const b = fighter('spott', ['dark'], 20, ['taunt'], 80)
    const verhoehnt = resolveTurn(battle([a], [b]), useMove(0), useMove(), content)
    expect(verhoehnt.events.some((e) => e.type === 'move_failed')).toBe(true)
    expect(verhoehnt.state.sides[0]!.party[0]!.stages.def).toBe(0)

    // Der Angriff geht weiter — sonst waere es keine Verhoehnung, sondern eine Sperre.
    const geschlagen = resolveTurn(verhoehnt.state, useMove(1), useMove(), content)
    expect(geschlagen.events.some((e) => e.type === 'damage' && e.amount > 0)).toBe(true)
  })

  it('nimmt der Heilblockade jede Form der Erholung', () => {
    const a = fighter('heiler', ['normal'], 20, ['recover'], 60)
    const b = fighter('blocker', ['psychic'], 20, ['heal-block'], 80)
    const start = battle([a], [b])
    start.sides[0]!.party[0]!.hp = 10
    const blockiert = resolveTurn(start, useMove(), useMove(), content)
    const versucht = resolveTurn(blockiert.state, useMove(), useMove(), content)

    expect(versucht.events.some((e) => e.type === 'blocked' && e.by === 'heal_block')).toBe(true)
    expect(versucht.events.some((e) => e.type === 'heal')).toBe(false)
  })

  it('faellt nach drei Runden Abgesang — auf beiden Seiten', () => {
    const a = fighter('saenger', ['normal'], 30, ['perish-song'], 80)
    const b = fighter('hoerer', ['normal'], 30, ['splash'], 60)
    let lauf = resolveTurn(battle([a], [b]), useMove(), useMove(), content)
    expect(lauf.state.sides[0]!.party[0]!.lingering).toHaveLength(1)
    expect(lauf.state.sides[1]!.party[0]!.lingering).toHaveLength(1)

    for (let i = 0; i < 2; i++) lauf = resolveTurn(lauf.state, useMove(), useMove(), content)
    expect(lauf.state.sides[0]!.party[0]!.hp).toBe(0)
    expect(lauf.state.sides[1]!.party[0]!.hp).toBe(0)
  })

  it('erfuellt den Wunsch erst eine Runde spaeter', () => {
    const a = fighter('wuenscher', ['normal'], 20, ['wish', 'splash'], 80)
    const b = fighter('ziel', ['normal'], 20, ['splash'], 60)
    const start = battle([a], [b])
    start.sides[0]!.party[0]!.hp = 10

    const gewuenscht = resolveTurn(start, useMove(0), useMove(), content)
    expect(gewuenscht.state.sides[0]!.party[0]!.hp).toBe(10)

    const erfuellt = resolveTurn(gewuenscht.state, useMove(1), useMove(), content)
    expect(erfuellt.state.sides[0]!.party[0]!.hp).toBeGreaterThan(10)
  })

  it('mittelt beim Leidteiler die Kraftpunkte', () => {
    const a = fighter('teiler', ['normal'], 20, ['pain-split'], 80)
    const b = fighter('ziel', ['normal'], 20, ['splash'], 60)
    const start = battle([a], [b])
    start.sides[0]!.party[0]!.hp = 10
    start.sides[1]!.party[0]!.hp = 50
    const geteilt = resolveTurn(start, useMove(), useMove(), content)

    expect(geteilt.state.sides[0]!.party[0]!.hp).toBe(30)
    expect(geteilt.state.sides[1]!.party[0]!.hp).toBe(30)
  })

  it('tauscht beim Schutztausch die Veraenderungen, nicht die Werte', () => {
    const a = fighter('tauscher', ['psychic'], 20, ['guard-swap'], 80)
    const b = fighter('gebufft', ['normal'], 20, ['harden'], 60)
    const start = battle([a], [b])
    start.sides[1]!.party[0]!.stages.def = 4
    const getauscht = resolveTurn(start, useMove(), useMove(), content)

    expect(getauscht.state.sides[0]!.party[0]!.stages.def).toBe(4)
    // Der Gegner hat in derselben Runde noch gehaertet — daher nicht 0.
    expect(getauscht.state.sides[1]!.party[0]!.stages.def).toBe(2)
  })

  it('nimmt mit Groll die Kraftpunkte des zuletzt benutzten Zuges', () => {
    const a = fighter('grollend', ['ghost'], 20, ['splash', 'spite'], 80)
    const b = fighter('ziel', ['normal'], 20, ['tackle'], 60)
    const geschlagen = resolveTurn(battle([a], [b]), useMove(0), useMove(), content)
    const gegrollt = resolveTurn(geschlagen.state, useMove(1), useMove(), content)

    const rest = gegrollt.state.sides[1]!.party[0]!.moves[0]!
    // 35 minus zwei eigene Einsaetze minus vier durch Groll.
    expect(rest.pp).toBe(29)
    expect(gegrollt.events.some((e) => e.type === 'pp_drain' && e.amount === 4)).toBe(true)
  })

  it('zahlt bei der Bauchtrommel die Haelfte fuer den vollen Angriff', () => {
    const a = fighter('trommler', ['normal'], 20, ['belly-drum'], 60)
    const b = fighter('ziel', ['normal'], 20, ['splash'], 60)
    const start = battle([a], [b])
    const voll = start.sides[0]!.party[0]!.hpMax
    const getrommelt = resolveTurn(start, useMove(), useMove(), content)

    expect(getrommelt.state.sides[0]!.party[0]!.stages.atk).toBe(6)
    expect(getrommelt.state.sides[0]!.party[0]!.hp).toBe(voll - Math.floor(voll / 2))
  })

  it('reicht mit der Stafette weiter, was aufgebaut wurde', () => {
    const a = fighter('gebufft', ['normal'], 20, ['baton-pass'], 80)
    const erbe = fighter('erbe', ['normal'], 20, ['splash'], 60)
    const b = fighter('ziel', ['normal'], 20, ['splash'], 60)
    const start = battle([a, erbe], [b])
    start.sides[0]!.party[0]!.stages.atk = 3
    const gereicht = resolveTurn(start, useMove(), useMove(), content)

    expect(gereicht.state.sides[0]!.activeIndex).toBe(1)
    expect(gereicht.state.sides[0]!.party[1]!.stages.atk).toBe(3)
    expect(gereicht.state.sides[0]!.party[0]!.stages.atk).toBe(0)
  })

  it('daempft mit Lehmsuhler den Strom auf der eigenen Seite', () => {
    const schaden = (zug: number) => {
      const a = fighter('suhler', ['ground'], 20, ['mud-sport', 'splash'], 80)
      const b = fighter('blitz', ['electric'], 20, ['thunder-shock'], 60)
      const runde = resolveTurn(battle([a], [b]), useMove(zug), useMove(), content)
      const treffer = runde.events.find((e) => e.type === 'damage')
      return treffer && treffer.type === 'damage' ? treffer.amount : 0
    }
    // Derselbe Zug, derselbe Seed — nur die Suhle unterscheidet die beiden.
    expect(schaden(0)).toBeLessThan(schaden(1))
  })
})

describe('Zuege, die andere Zuege benutzen', () => {
  it('spiegelt den letzten Zug des Gegenuebers', () => {
    const a = fighter('spiegel', ['flying'], 20, ['splash', 'mirror-move'], 80)
    const b = fighter('ziel', ['normal'], 20, ['growl'], 60)
    const erste = resolveTurn(battle([a], [b]), useMove(0), useMove(), content)
    const gespiegelt = resolveTurn(erste.state, useMove(1), useMove(), content)

    expect(gespiegelt.events.some((e) => e.type === 'called' && e.moveId === 'growl')).toBe(true)
    // Der gespiegelte Knurrer senkt den Angriff des Gegenuebers — die Wirkung
    // kommt also durch, nicht nur die Meldung.
    expect(gespiegelt.state.sides[1]!.party[0]!.stages.atk).toBeLessThan(0)
  })

  it('scheitert, wenn das Gegenueber noch nichts getan hat', () => {
    const a = fighter('spiegel', ['flying'], 20, ['mirror-move'], 80)
    const b = fighter('ziel', ['normal'], 20, ['splash'], 60)
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)
    expect(runde.events.some((e) => e.type === 'move_failed')).toBe(true)
  })

  it('wuerfelt beim Metronom aus dem Paket — aber nie einen Kopierer', () => {
    const a = fighter('takt', ['normal'], 20, ['metronome'], 80)
    const b = fighter('ziel', ['normal'], 20, ['splash'], 60)
    const alle = { ...content, moveIds: () => Object.keys(MOVES) }

    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const runde = resolveTurn(battle([a], [b], seed), useMove(), useMove(), alle)
      const ruf = runde.events.find((e) => e.type === 'called')
      expect(ruf).toBeDefined()
      if (ruf?.type !== 'called') continue
      expect(MOVES[ruf.moveId]?.effect.kind).not.toBe('call_move')
    }
  })

  it('ersetzt bei Mimikry den Platz, aus dem der Zug kam', () => {
    const a = fighter('nachahmer', ['normal'], 20, ['splash', 'mimic'], 80)
    const b = fighter('vorbild', ['normal'], 20, ['ember'], 60)
    const erste = resolveTurn(battle([a], [b]), useMove(0), useMove(), content)
    const kopiert = resolveTurn(erste.state, useMove(1), useMove(), content)

    expect(kopiert.state.sides[0]!.party[0]!.moves[1]!.id).toBe('ember')
    expect(kopiert.state.sides[0]!.party[0]!.moves[1]!.pp).toBe(5)
  })
})

describe('Typwechsel, Puppe und was ueber dem Feld liegt', () => {
  it('macht mit Ueberflutung ein Wasserpokemon aus dem Gegenueber', () => {
    const a = fighter('flut', ['water'], 20, ['soak'], 80)
    const b = fighter('ziel', ['fire'], 20, ['splash'], 60)
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)
    expect(runde.state.sides[1]!.party[0]!.types).toEqual(['water'])
  })

  it('nimmt beim Typenspiegel die Typen des Gegenuebers an', () => {
    const a = fighter('spiegel', ['normal'], 20, ['reflect-type'], 80)
    const b = fighter('ziel', ['fire'], 20, ['splash'], 60)
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)
    expect(runde.state.sides[0]!.party[0]!.types).toEqual(['fire'])
  })

  it('laesst die Puppe den Treffer und den Zustand schlucken', () => {
    const a = fighter('puppe', ['normal'], 20, ['substitute'], 80)
    const b = fighter('brenner', ['fire'], 20, ['ember'], 60)
    const gestellt = resolveTurn(battle([a], [b]), useMove(), useMove(), content)
    const traeger = gestellt.state.sides[0]!.party[0]!

    expect(traeger.substitute).toBeGreaterThan(0)
    // Der Glut-Treffer ging an die Puppe: die Verbrennung kam nicht durch.
    expect(traeger.status).toBe('none')
    expect(gestellt.events.some((e) => e.type === 'substitute' && e.what === 'hit')).toBe(true)
  })

  it('wird beim Wandler zur Kopie des Gegenuebers', () => {
    const a = fighter('wandler', ['normal'], 20, ['transform'], 80)
    const b = fighter('vorbild', ['fire'], 20, ['ember'], 60)
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)
    const kopie = runde.state.sides[0]!.party[0]!

    expect(kopie.types).toEqual(['fire'])
    expect(kopie.moves.map((m) => m.id)).toEqual(['ember'])
    // Die Kraftpunkte bleiben die eigenen — sonst waere der Zug je nach
    // Gegner eine Heilung oder ein Selbstmord.
    expect(kopie.hpMax).toBe(fighter('wandler', ['normal'], 20, ['transform'], 80).hpMax)
  })

  it('schickt mit dem Magiemantel den Statuszug zurueck', () => {
    const a = fighter('mantel', ['psychic'], 20, ['magic-coat'], 60)
    const b = fighter('knurrer', ['normal'], 20, ['growl'], 80)
    const runde = resolveTurn(battle([a], [b]), useMove(), useMove(), content)

    expect(runde.events.some((e) => e.type === 'reflected')).toBe(true)
    expect(runde.state.sides[1]!.party[0]!.stages.atk).toBe(-1)
    expect(runde.state.sides[0]!.party[0]!.stages.atk).toBe(0)
  })

  it('holt mit Erdanziehung den Flieger herunter', () => {
    const a = fighter('schwer', ['psychic'], 20, ['gravity', 'earthquake'], 80)
    const b = fighter('flieger', ['flying'], 20, ['splash'], 60)
    const erste = resolveTurn(battle([a], [b]), useMove(0), useMove(), content)
    expect(erste.state.fields).toEqual([{ kind: 'gravity', turns: 4 }])

    const getroffen = resolveTurn(erste.state, useMove(1), useMove(), content)
    expect(getroffen.events.some((e) => e.type === 'damage' && e.amount > 0)).toBe(true)
  })

  it('faerbt im Plasmaschauer alles Normale elektrisch', () => {
    /*
     * Geprueft am Typenvorteil und nicht am Schaden: Boden ist gegen Strom
     * immun, ein Tackle waere also wirkungslos. Ohne Schauer trifft er.
     */
    const a = fighter('schauer', ['electric'], 20, ['ion-deluge', 'tackle'], 80)
    const b = fighter('erde', ['ground'], 20, ['splash'], 60)
    const CHART_GROUND = { ...CHART, electric: { ground: 0 } }
    const strom: BattleContent = {
      ...content,
      effectiveness: (atk, defs) => defs.reduce((m, d) => m * (CHART_GROUND[atk]?.[d] ?? 1), 1),
    }
    const erste = resolveTurn(battle([a], [b]), useMove(0), useMove(), strom)
    const versucht = resolveTurn(erste.state, useMove(1), useMove(), strom)

    expect(versucht.events.some((e) => e.type === 'damage' && e.effectiveness === 0)).toBe(true)
  })
})
