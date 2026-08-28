import type { StatBlock, Weather } from '@game/shared'
import type { MoveDef } from '@game/content'
import type { Fighter, StageKey, Stages, Status } from './battle-types.js'
import type { Rng } from './rng.js'
import { clamp } from './stats.js'

/** Stage multipliers. Attack-like stats use (2+n)/2 upward and 2/(2-n)
 *  downward; accuracy and evasion use a gentler 3-based curve. */
export function stageMultiplier(stage: number, kind: 'stat' | 'accuracy'): number {
  const n = clamp(stage, -6, 6)
  const base = kind === 'stat' ? 2 : 3
  return n >= 0 ? (base + n) / base : base / (base - n)
}

export function effectiveStat(fighter: Fighter, key: Exclude<StageKey, 'accuracy' | 'evasion'>): number {
  const raw = fighter.stats[key]
  let value = raw * stageMultiplier(fighter.stages[key], 'stat')
  // Burn halves physical attack; paralysis halves speed. These are the two
  // status effects that change a fight's shape rather than just chipping HP.
  if (key === 'atk' && fighter.status === 'burn') value *= 0.5
  if (key === 'spe' && fighter.status === 'paralysis') value *= 0.5
  return Math.max(1, Math.floor(value))
}

/** Who acts first. Priority wins outright; speed breaks the tie; the rng
 *  breaks an exact tie so the order is still deterministic from the seed. */
export function movesFirst(
  a: { fighter: Fighter; move: MoveDef | null },
  b: { fighter: Fighter; move: MoveDef | null },
  rng: Rng,
): boolean {
  const pa = a.move?.priority ?? 0
  const pb = b.move?.priority ?? 0
  if (pa !== pb) return pa > pb
  const sa = effectiveStat(a.fighter, 'spe')
  const sb = effectiveStat(b.fighter, 'spe')
  if (sa !== sb) return sa > sb
  return rng.next() < 0.5
}

export function accuracyCheck(move: MoveDef, attacker: Fighter, defender: Fighter, rng: Rng): boolean {
  if (move.accuracy >= 100 && attacker.stages.accuracy >= 0 && defender.stages.evasion <= 0) return true
  const net = clamp(attacker.stages.accuracy - defender.stages.evasion, -6, 6)
  const chance = move.accuracy * stageMultiplier(net, 'accuracy')
  return rng.next() * 100 < chance
}

export interface DamageResult {
  amount: number
  effectiveness: number
  critical: boolean
  /** True when the type chart says the move cannot touch the defender. */
  immune: boolean
}

const CRIT_CHANCE = [1 / 24, 1 / 8, 1 / 2, 1]

/**
 * Damage for one hit.
 *
 * The shape follows the series formula closely — level, attack/defense ratio,
 * STAB, type effectiveness, a critical multiplier and a small random spread.
 * Following it matters: players who know the games have strong expectations
 * about which matchups should feel one-sided, and a bespoke formula would feel
 * subtly wrong in ways that are hard to name and easy to notice.
 */
export function computeDamage(
  attacker: Fighter,
  defender: Fighter,
  move: MoveDef,
  effectiveness: number,
  weather: Weather,
  rng: Rng,
): DamageResult {
  if (move.category === 'status' || move.power <= 0) {
    return { amount: 0, effectiveness: 1, critical: false, immune: false }
  }
  if (effectiveness === 0) {
    return { amount: 0, effectiveness: 0, critical: false, immune: true }
  }

  const physical = move.category === 'physical'
  const critical = rng.next() < (CRIT_CHANCE[clamp(move.critRate, 0, 3)] ?? CRIT_CHANCE[0]!)

  // A critical hit ignores the defender's positive defense stages and the
  // attacker's negative offense stages — otherwise a crit against a boosted
  // wall would still bounce off, which is the opposite of what a crit means.
  const atkStage = critical ? Math.max(0, attacker.stages[physical ? 'atk' : 'spa']) : attacker.stages[physical ? 'atk' : 'spa']
  const defStage = critical ? Math.min(0, defender.stages[physical ? 'def' : 'spd']) : defender.stages[physical ? 'def' : 'spd']

  const atkRaw = attacker.stats[physical ? 'atk' : 'spa'] * stageMultiplier(atkStage, 'stat')
  const atk = Math.max(1, Math.floor(physical && attacker.status === 'burn' ? atkRaw * 0.5 : atkRaw))
  const def = Math.max(1, Math.floor(defender.stats[physical ? 'def' : 'spd'] * stageMultiplier(defStage, 'stat')))

  const base = Math.floor(Math.floor((2 * attacker.level) / 5 + 2) * move.power * atk / def / 50) + 2

  const stab = attacker.types.includes(move.type) ? 1.5 : 1
  const critMult = critical ? 1.5 : 1
  const weatherMult = weatherModifier(move.type, weather)
  const spread = rng.int(85, 100) / 100

  const amount = Math.max(1, Math.floor(base * stab * effectiveness * critMult * weatherMult * spread))
  return { amount, effectiveness, critical, immune: false }
}

/** Weather nudges two type families. Small on purpose: it should reward
 *  reading the sky, not decide the fight. */
export function weatherModifier(moveType: string, weather: Weather): number {
  if (weather === 'rain' || weather === 'storm') {
    if (moveType === 'water') return 1.3
    if (moveType === 'fire') return 0.7
  }
  if (weather === 'heat') {
    if (moveType === 'fire') return 1.3
    if (moveType === 'water') return 0.7
  }
  if (weather === 'snow' && moveType === 'ice') return 1.2
  if (weather === 'sandstorm' && moveType === 'rock') return 1.2
  return 1
}

export interface StatusApplication {
  applied: boolean
  reason?: 'already_has_status' | 'type_immune' | 'chance_failed'
}

/** Types that shrug off a given status outright. */
const STATUS_IMMUNITY: Partial<Record<Status, string[]>> = {
  burn: ['fire'],
  freeze: ['ice'],
  poison: ['poison', 'steel'],
  toxic: ['poison', 'steel'],
  paralysis: ['electric'],
}

export function canApplyStatus(target: Fighter, status: Status): StatusApplication {
  if (status === 'none') return { applied: false }
  if (target.status !== 'none') return { applied: false, reason: 'already_has_status' }
  const immune = STATUS_IMMUNITY[status]
  if (immune && target.types.some((t) => immune.includes(t))) {
    return { applied: false, reason: 'type_immune' }
  }
  return { applied: true }
}

/** Damage a status inflicts at the end of a turn. */
export function statusDamage(fighter: Fighter): number {
  switch (fighter.status) {
    case 'burn':
    case 'poison':
      return Math.max(1, Math.floor(fighter.hpMax / 16))
    case 'toxic':
      // Ramps up, which is what makes toxic a clock rather than chip damage.
      return Math.max(1, Math.floor((fighter.hpMax * Math.min(fighter.statusCounter, 15)) / 16))
    default:
      return 0
  }
}

/** Whether a status stops the creature from acting this turn. */
export function statusPreventsAction(fighter: Fighter, rng: Rng): { blocked: boolean; cured: boolean } {
  switch (fighter.status) {
    case 'sleep':
      if (fighter.statusCounter <= 1) return { blocked: false, cured: true }
      return { blocked: true, cured: false }
    case 'freeze':
      // 20% thaw per turn: frozen is severe, but never a guaranteed loss.
      return rng.chance(20) ? { blocked: false, cured: true } : { blocked: true, cured: false }
    case 'paralysis':
      return { blocked: rng.chance(25), cured: false }
    default:
      return { blocked: false, cured: false }
  }
}

export function applyStage(stages: Stages, stat: StageKey, delta: number): { stages: Stages; applied: number; capped: boolean } {
  const before = stages[stat]
  const after = clamp(before + delta, -6, 6)
  return { stages: { ...stages, [stat]: after }, applied: after - before, capped: after === before }
}

/** Confusion self-hit uses a fixed 40-power typeless physical move. */
export function confusionDamage(fighter: Fighter): number {
  const base = Math.floor(Math.floor((2 * fighter.level) / 5 + 2) * 40 * fighter.stats.atk / fighter.stats.def / 50) + 2
  return Math.max(1, base)
}
