import { STATS, type Nature, type StatBlock, type StatKey } from '@game/shared'
import type { SpeciesDef } from '@game/content'
import type { Rng } from './rng.js'

export const IV_MAX = 31

/**
 * Wie viele Kronkorken ein Pokemon annimmt.
 *
 * Ohne Grenze setzten sechs Stueck alle sechs Werte auf 31 — die Zucht war
 * damit nicht mehr der Weg zu guten Veranlagungen, sondern eine Abkuerzung,
 * die man auch ueberspringen konnte. Zwei retten die beiden schwaechsten
 * Werte; die uebrigen vier muss weiterhin die Zucht liefern.
 *
 * Zwei und nicht drei: bei drei waere die Haelfte gekauft, und "die Haelfte"
 * ist keine Nachhilfe mehr.
 */
export const IV_CAPS_PER_CREATURE = 2
export const EV_MAX_PER_STAT = 252
export const EV_MAX_TOTAL = 510

/** nature -> [raised, lowered]. Neutral natures map to null. */
const NATURE_EFFECTS: Record<Nature, readonly [Exclude<StatKey, 'hp'>, Exclude<StatKey, 'hp'>] | null> = {
  hardy: null, docile: null, serious: null, bashful: null, quirky: null,
  lonely: ['atk', 'def'], brave: ['atk', 'spe'], adamant: ['atk', 'spa'], naughty: ['atk', 'spd'],
  bold: ['def', 'atk'], relaxed: ['def', 'spe'], impish: ['def', 'spa'], lax: ['def', 'spd'],
  timid: ['spe', 'atk'], hasty: ['spe', 'def'], jolly: ['spe', 'spa'], naive: ['spe', 'spd'],
  modest: ['spa', 'atk'], mild: ['spa', 'def'], quiet: ['spa', 'spe'], rash: ['spa', 'spd'],
  calm: ['spd', 'atk'], gentle: ['spd', 'def'], sassy: ['spd', 'spe'], careful: ['spd', 'spa'],
}

export function natureMultiplier(nature: Nature, stat: StatKey): number {
  if (stat === 'hp') return 1
  const effect = NATURE_EFFECTS[nature]
  if (!effect) return 1
  const [up, down] = effect
  if (up === down) return 1
  if (stat === up) return 1.1
  if (stat === down) return 0.9
  return 1
}

export function randomIvs(rng: Rng, floor = 0): StatBlock {
  const min = Math.max(0, Math.min(IV_MAX, Math.floor(floor)))
  return Object.fromEntries(STATS.map((s) => [s, rng.int(min, IV_MAX)])) as StatBlock
}

export function zeroEvs(): StatBlock {
  return Object.fromEntries(STATS.map((s) => [s, 0])) as StatBlock
}

/** Final battle stats. HP uses a different formula than the other five, which
 *  is why it is special-cased rather than folded into one expression. */
export function computeStats(
  species: SpeciesDef,
  level: number,
  ivs: StatBlock,
  evs: StatBlock,
  nature: Nature,
): StatBlock {
  const out = {} as StatBlock
  for (const stat of STATS) {
    const base = species.baseStats[stat]
    const iv = clamp(ivs[stat], 0, IV_MAX)
    const ev = Math.floor(clamp(evs[stat], 0, EV_MAX_PER_STAT) / 4)
    if (stat === 'hp') {
      out.hp = Math.floor(((2 * base + iv + ev) * level) / 100) + level + 10
    } else {
      const raw = Math.floor(((2 * base + iv + ev) * level) / 100) + 5
      out[stat] = Math.floor(raw * natureMultiplier(nature, stat))
    }
  }
  return out
}

/** How strong a creature is at a glance — used for team power, matchmaking
 *  brackets and raid contribution scaling. Deliberately simple and monotonic. */
export function powerRating(stats: StatBlock, level: number): number {
  const total = STATS.reduce((sum, s) => sum + stats[s], 0)
  return Math.round(total * (1 + level / 100))
}

/** Percentage of perfect IVs, shown in the UI as a 0..100 quality bar. */
export function ivPercent(ivs: StatBlock): number {
  const total = STATS.reduce((sum, s) => sum + clamp(ivs[s], 0, IV_MAX), 0)
  return Math.round((total / (IV_MAX * STATS.length)) * 100)
}

export function addEvs(evs: StatBlock, gains: Partial<StatBlock>): StatBlock {
  const out = { ...evs }
  let total = STATS.reduce((sum, s) => sum + out[s], 0)
  for (const stat of STATS) {
    const want = gains[stat] ?? 0
    if (want <= 0) continue
    const room = Math.min(EV_MAX_PER_STAT - out[stat], EV_MAX_TOTAL - total, want)
    if (room <= 0) continue
    out[stat] += room
    total += room
  }
  return out
}

export const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v)
