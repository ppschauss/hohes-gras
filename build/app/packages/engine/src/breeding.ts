import { STATS, type Nature, type StatBlock } from '@game/shared'
import type { SpeciesDef } from '@game/content'
import { NATURES } from '@game/shared'
import type { Rng } from './rng.js'
import { IV_MAX, clamp } from './stats.js'

/**
 * Eggs.
 *
 * Breeding is how a player turns a lucky catch into a *good* team member: the
 * offspring inherits the best of both parents rather than being a fresh roll.
 * Without inheritance, breeding would just be a slower way to catch.
 */

/** Two creatures can breed if they share an egg group. Groups that cannot
 *  breed at all are excluded, which is what keeps legendaries out. */
export const UNBREEDABLE_GROUPS = new Set(['no-eggs', 'ditto'])

export type PairCheck =
  | { ok: true }
  | { ok: false; reason: 'same_creature' | 'no_shared_group' | 'unbreedable' | 'too_young' }

export const MIN_BREEDING_LEVEL = 15

export function canBreed(a: SpeciesDef, b: SpeciesDef, levelA: number, levelB: number, sameCreature: boolean): PairCheck {
  if (sameCreature) return { ok: false, reason: 'same_creature' }
  if (levelA < MIN_BREEDING_LEVEL || levelB < MIN_BREEDING_LEVEL) return { ok: false, reason: 'too_young' }

  const groupsA = a.eggGroups.filter((g) => !UNBREEDABLE_GROUPS.has(g))
  const groupsB = b.eggGroups.filter((g) => !UNBREEDABLE_GROUPS.has(g))
  if (groupsA.length === 0 || groupsB.length === 0) return { ok: false, reason: 'unbreedable' }
  if (!groupsA.some((g) => groupsB.includes(g))) return { ok: false, reason: 'no_shared_group' }
  return { ok: true }
}

/** The egg hatches into the base form of one parent's evolution line. */
export function offspringSpecies(a: SpeciesDef, b: SpeciesDef, baseFormOf: (id: string) => string, rng: Rng): string {
  return baseFormOf(rng.next() < 0.5 ? a.id : b.id)
}

export interface EggResult {
  speciesId: string
  ivs: StatBlock
  nature: Nature
  shiny: boolean
  /** Real minutes until it hatches, derived from the species' hatch cycles. */
  hatchMinutes: number
  /** How many stats were inherited rather than rolled — shown to the player so
   *  the value of good parents is visible. */
  inheritedCount: number
}

/** Minutes per hatch cycle. Tuned so a common species takes about half an hour
 *  and a rare one a few hours. */
export const MINUTES_PER_CYCLE = 6

export function produceEgg(
  parentA: { speciesId: string; ivs: StatBlock; nature: Nature; shiny: boolean },
  parentB: { speciesId: string; ivs: StatBlock; nature: Nature; shiny: boolean },
  offspring: SpeciesDef,
  rng: Rng,
  options: { inheritSlots?: number; shinyBoost?: number } = {},
): EggResult {
  const inheritSlots = clamp(options.inheritSlots ?? 3, 0, STATS.length)

  // Pick which stats are inherited, then take the better parent's value for
  // each. Taking the better value rather than a random one is what makes
  // breeding converge on a good creature over a few generations.
  const order = [...STATS]
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i)
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  const inherited = new Set(order.slice(0, inheritSlots))

  const ivs = {} as StatBlock
  for (const stat of STATS) {
    ivs[stat] = inherited.has(stat)
      ? Math.max(parentA.ivs[stat], parentB.ivs[stat])
      : rng.int(0, IV_MAX)
  }

  // Nature comes from a parent most of the time, so a deliberate pairing is
  // worth doing; the rest of the time it rerolls, so it is never guaranteed.
  const nature = rng.next() < 0.7 ? rng.pick([parentA.nature, parentB.nature]) : rng.pick(NATURES)

  // The Masuda-style bonus: parents of differing shininess raise the odds.
  const shinyOdds = (1 / 512) * (options.shinyBoost ?? 1) * (parentA.shiny !== parentB.shiny ? 6 : 1)

  return {
    speciesId: offspring.id,
    ivs,
    nature,
    shiny: rng.chance(shinyOdds * 100),
    hatchMinutes: Math.max(10, offspring.hatchCycles * MINUTES_PER_CYCLE),
    inheritedCount: inheritSlots,
  }
}

/** Progress 0..1 for the hatching bar. */
export function hatchProgress(startedAt: number, hatchMinutes: number, now: number): number {
  const elapsed = (now - startedAt) / 60_000
  return clamp(elapsed / hatchMinutes, 0, 1)
}

export const isHatched = (startedAt: number, hatchMinutes: number, now: number): boolean =>
  hatchProgress(startedAt, hatchMinutes, now) >= 1
