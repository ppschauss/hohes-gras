import { describe, expect, it } from 'vitest'
import type { SpeciesDef } from '@game/content'
import { createRng } from './rng.js'
import {
  bossHp, distributeRewards, raidAttack, raidProgress,
  DAMAGE_PER_TRAINER_ESTIMATE, TARGET_TRAINERS, TIER_SPECS, RAID_TIERS,
} from './raid.js'
import { npcFighter } from './battle-setup.js'
import {
  applyResult, expectedScore, kFactor, matchmakingRange, tierOf, START_RATING,
} from './elo.js'

const species = (id: string, types: string[], stat = 60): SpeciesDef =>
  ({ id, types, baseStats: { hp: stat, atk: stat, def: stat, spa: stat, spd: stat, spe: stat },
     sprite: '', spriteShiny: '' } as SpeciesDef)

const CHART: Record<string, Record<string, number>> = {
  water: { fire: 2, water: 0.5 }, fire: { water: 0.5, grass: 2 }, normal: {},
}
const eff = (atk: string, defs: readonly string[]) =>
  defs.reduce((m, d) => m * (CHART[atk]?.[d] ?? 1), 1)

const MOVE_TYPES: Record<string, string> = { 'water-gun': 'water', ember: 'fire', tackle: 'normal' }
const moveTypeOf = (id: string) => MOVE_TYPES[id] ?? null

const team = (moves: string[][], level = 30) =>
  moves.map((m, i) => npcFighter(`c${i}`, species(`s${i}`, ['normal']), `Mon${i}`, level, m, () => 20))

describe('bossHp', () => {
  it('waechst mit Stufe und Level', () => {
    const sp = species('boss', ['fire'])
    expect(bossHp(sp, 30, 5)).toBeGreaterThan(bossHp(sp, 30, 1))
    expect(bossHp(sp, 60, 3)).toBeGreaterThan(bossHp(sp, 20, 3))
  })

  it('bleibt fuer die angepeilte Gruppengroesse schaffbar', () => {
    // Die Absicht steht im Code: Stufe 1 fuer zwei Trainer, Stufe 3 fuer fuenf,
    // Stufe 5 fuer zehn — jeweils mit vollem Team. Wer die Multiplikatoren
    // aendert, muss diese Zusage bewusst neu formulieren.
    const averageSpecies = species('durchschnitt', ['normal'], 77)  // Summe hp+def+spd ~ 231
    for (const tier of RAID_TIERS) {
      const spec = TIER_SPECS[tier]
      const midLevel = Math.round((spec.levelRange[0] + spec.levelRange[1]) / 2)
      const hp = bossHp(averageSpecies, midLevel, tier)
      const trainersNeeded = hp / DAMAGE_PER_TRAINER_ESTIMATE
      const target = TARGET_TRAINERS[tier]
      expect(trainersNeeded).toBeGreaterThan(target * 0.6)
      expect(trainersNeeded).toBeLessThan(target * 1.5)
    }
  })

  it('haelt fuer jede Stufe eine Spezifikation vor', () => {
    for (const tier of RAID_TIERS) {
      const spec = TIER_SPECS[tier]
      expect(spec.durationHours).toBeGreaterThan(0)
      expect(spec.goldPool).toBeGreaterThan(0)
      expect(spec.levelRange[0]).toBeLessThan(spec.levelRange[1])
    }
  })
})

describe('raidAttack', () => {
  it('summiert den Schaden des ganzen Teams', () => {
    const rng = createRng('raid')
    const one = raidAttack(team([['tackle']]), ['fire'], 30, eff, moveTypeOf, rng)
    const three = raidAttack(team([['tackle'], ['tackle'], ['tackle']]), ['fire'], 30, eff, moveTypeOf, createRng('raid'))
    expect(three.damage).toBeGreaterThan(one.damage * 2)
    expect(three.contributions).toHaveLength(3)
  })

  it('belohnt die beste Typenwahl im Team', () => {
    const rng = createRng('types')
    const neutral = raidAttack(team([['tackle']]), ['fire'], 30, eff, moveTypeOf, rng)
    const strong = raidAttack(team([['water-gun']]), ['fire'], 30, eff, moveTypeOf, createRng('types'))
    expect(strong.damage).toBeGreaterThan(neutral.damage * 1.5)
    expect(strong.contributions[0]!.effectiveness).toBe(2)
  })

  it('nimmt die beste Attacke, nicht eine zufaellige', () => {
    const mixed = raidAttack(team([['tackle', 'water-gun']]), ['fire'], 30, eff, moveTypeOf, createRng('best'))
    expect(mixed.contributions[0]!.effectiveness).toBe(2)
  })

  it('ueberspringt besiegte Teammitglieder', () => {
    const t = team([['tackle'], ['tackle']])
    t[0]!.hp = 0
    const r = raidAttack(t, ['fire'], 30, eff, moveTypeOf, createRng('ko'))
    expect(r.contributions).toHaveLength(1)
  })

  it('bestraft ein zu schwaches Team, ohne es auszuschliessen', () => {
    const weak = raidAttack(team([['tackle']], 5), ['fire'], 60, eff, moveTypeOf, createRng('gap'))
    const strong = raidAttack(team([['tackle']], 60), ['fire'], 60, eff, moveTypeOf, createRng('gap'))
    expect(weak.damage).toBeGreaterThan(0)
    expect(weak.damage).toBeLessThan(strong.damage)
  })

  it('ist bei gleichem Seed reproduzierbar', () => {
    const run = () => raidAttack(team([['tackle'], ['water-gun']]), ['fire'], 30, eff, moveTypeOf, createRng('rep'))
    expect(run()).toEqual(run())
  })
})

describe('distributeRewards', () => {
  it('gibt jedem Teilnehmer etwas', () => {
    const rewards = distributeRewards([
      { trainerId: 'a', damage: 9000 },
      { trainerId: 'b', damage: 100 },
    ], 3)
    expect(rewards).toHaveLength(2)
    for (const r of rewards) expect(r.gold).toBeGreaterThan(0)
  })

  it('belohnt mehr Schaden staerker', () => {
    const [big, small] = distributeRewards([
      { trainerId: 'a', damage: 9000 },
      { trainerId: 'b', damage: 100 },
    ], 3)
    expect(big!.gold).toBeGreaterThan(small!.gold)
  })

  it('haelt die Haelfte des Topfs gleichmaessig, damit Mitmachen zaehlt', () => {
    const [, small] = distributeRewards([
      { trainerId: 'a', damage: 100000 },
      { trainerId: 'b', damage: 1 },
    ], 1)
    // Ein Viertel des Topfs bei zwei Teilnehmern ist die Untergrenze.
    expect(small!.gold).toBeGreaterThanOrEqual(TIER_SPECS[1].goldPool * 0.25 * 0.9)
  })

  it('ueberschreitet den Topf nicht', () => {
    const rewards = distributeRewards(
      Array.from({ length: 8 }, (_, i) => ({ trainerId: `t${i}`, damage: 1000 })), 5,
    )
    const total = rewards.reduce((s, r) => s + r.gold, 0)
    expect(total).toBeLessThanOrEqual(TIER_SPECS[5].goldPool + 8)
  })

  it('kommt mit leerer Teilnehmerliste klar', () => {
    expect(distributeRewards([], 1)).toEqual([])
  })

  it('gibt jedem eine Fangchance im erlaubten Bereich', () => {
    const rewards = distributeRewards([{ trainerId: 'a', damage: 5 }, { trainerId: 'b', damage: 5 }], 3)
    for (const r of rewards) {
      expect(r.catchChance).toBeGreaterThanOrEqual(0.35)
      expect(r.catchChance).toBeLessThanOrEqual(0.9)
    }
  })
})

describe('raidProgress', () => {
  it('geht von 0 nach 1', () => {
    expect(raidProgress(100, 100)).toBe(0)
    expect(raidProgress(50, 100)).toBe(0.5)
    expect(raidProgress(0, 100)).toBe(1)
  })
  it('kommt mit null KP klar', () => {
    expect(raidProgress(0, 0)).toBe(1)
  })
})

describe('Elo', () => {
  it('erwartet bei gleicher Wertung ein Remis', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5)
  })

  it('gibt fuer einen Sieg gegen Staerkere mehr Punkte', () => {
    const vsStrong = applyResult(1000, 1400, true, 50)
    const vsWeak = applyResult(1000, 600, true, 50)
    expect(vsStrong.delta).toBeGreaterThan(vsWeak.delta)
  })

  it('nimmt bei Niederlage gegen Schwaechere mehr weg', () => {
    const toWeak = applyResult(1400, 1000, false, 50)
    const toStrong = applyResult(1000, 1400, false, 50)
    expect(Math.abs(toWeak.delta)).toBeGreaterThan(Math.abs(toStrong.delta))
  })

  it('bewegt Neulinge schneller', () => {
    expect(kFactor(2, START_RATING)).toBeGreaterThan(kFactor(50, START_RATING))
  })

  it('bewegt Spitzenspieler langsamer', () => {
    expect(kFactor(50, 1900)).toBeLessThan(kFactor(50, 1200))
  })

  it('faellt nie unter die Untergrenze', () => {
    let rating = 120
    for (let i = 0; i < 40; i++) rating = applyResult(rating, 2000, false, 100).rating
    expect(rating).toBeGreaterThanOrEqual(100)
  })

  it('weitet den Suchbereich mit jedem Versuch', () => {
    const [lo0, hi0] = matchmakingRange(1000, 0)
    const [lo1, hi1] = matchmakingRange(1000, 1)
    expect(hi1 - lo1).toBeGreaterThan(hi0 - lo0)
  })

  it('staffelt die Ligen aufsteigend', () => {
    expect(tierOf(900)).toBe('bronze')
    expect(tierOf(1200)).toBe('silber')
    expect(tierOf(1400)).toBe('gold')
    expect(tierOf(1700)).toBe('platin')
    expect(tierOf(2000)).toBe('meister')
  })
})
