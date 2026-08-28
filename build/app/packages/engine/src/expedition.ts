import type { SpeciesDef } from '@game/content'
import type { Rng } from './rng.js'
import { clamp } from './stats.js'

/**
 * Expeditions: send creatures away, get loot back later.
 *
 * The idle half of the game. Nothing here needs the player present, which is
 * exactly the point — it gives someone who opens the app twice a day a reason
 * to have opened it the first time.
 */

export interface ExpeditionDuration {
  id: string
  minutes: number
  /** Multiplies both loot and XP. Longer trips pay better per minute, which
   *  rewards planning over compulsive checking. */
  yieldFactor: number
}

export const DURATIONS: ExpeditionDuration[] = [
  { id: 'short', minutes: 30, yieldFactor: 1 },
  { id: 'medium', minutes: 120, yieldFactor: 4.6 },
  { id: 'long', minutes: 480, yieldFactor: 20 },
]

export interface ExpeditionKind {
  id: string
  /** Types that feel at home here get a success bonus. */
  favouredTypes: string[]
  lootTable: Array<{ itemId: string; weight: number; min: number; max: number }>
  goldPerFactor: number
}

export const KINDS: ExpeditionKind[] = [
  {
    id: 'forage', favouredTypes: ['grass', 'bug', 'ground'],
    goldPerFactor: 26,
    lootTable: [
      { itemId: 'oran-berry', weight: 34, min: 1, max: 3 },
      { itemId: 'razz-berry', weight: 24, min: 1, max: 2 },
      { itemId: 'silk-thread', weight: 18, min: 1, max: 2 },
      { itemId: 'soft-sand', weight: 16, min: 1, max: 2 },
      { itemId: 'nanab-berry', weight: 8, min: 1, max: 2 },
    ],
  },
  {
    id: 'dig', favouredTypes: ['ground', 'rock', 'steel'],
    goldPerFactor: 34,
    lootTable: [
      { itemId: 'iron-shard', weight: 32, min: 1, max: 3 },
      { itemId: 'soft-sand', weight: 28, min: 1, max: 3 },
      { itemId: 'star-piece', weight: 6, min: 1, max: 1 },
      { itemId: 'potion', weight: 20, min: 1, max: 2 },
      { itemId: 'poke-ball', weight: 14, min: 2, max: 4 },
    ],
  },
  {
    id: 'dive', favouredTypes: ['water', 'ice', 'flying'],
    goldPerFactor: 30,
    lootTable: [
      { itemId: 'dew-drop', weight: 34, min: 1, max: 3 },
      { itemId: 'great-ball', weight: 20, min: 1, max: 2 },
      { itemId: 'pinap-berry', weight: 18, min: 1, max: 2 },
      { itemId: 'super-potion', weight: 18, min: 1, max: 1 },
      { itemId: 'star-piece', weight: 10, min: 1, max: 1 },
    ],
  },
  {
    id: 'patrol', favouredTypes: ['normal', 'fighting', 'electric', 'psychic'],
    goldPerFactor: 44,
    lootTable: [
      { itemId: 'potion', weight: 26, min: 1, max: 2 },
      { itemId: 'poke-ball', weight: 24, min: 2, max: 5 },
      { itemId: 'exp-candy-s', weight: 18, min: 1, max: 1 },
      { itemId: 'full-heal', weight: 16, min: 1, max: 1 },
      { itemId: 'star-piece', weight: 8, min: 1, max: 1 },
      { itemId: 'golden-razz', weight: 8, min: 1, max: 1 },
    ],
  },
]

export interface ExpeditionParty {
  creatureId: string
  speciesId: string
  level: number
  energy: number
}

export const MIN_PARTY = 1
/** Bis zu sechs Kreaturen pro Expedition. Mehr Koepfe heben die Bewertung und
 *  damit die Ausbeute — dafuer sind sie waehrenddessen anderswo nicht nutzbar,
 *  was die eigentliche Kostenseite ist. */
export const MAX_PARTY = 6
export const ENERGY_COST_PER_HOUR = 6

/** 0..1. Drives loot quantity, not success/failure — an expedition never comes
 *  back empty-handed, because a wasted eight-hour wait is not a fun outcome. */
export function partyRating(
  party: ExpeditionParty[],
  kind: ExpeditionKind,
  speciesOf: (id: string) => SpeciesDef,
): number {
  if (party.length === 0) return 0
  let score = 0
  for (const member of party) {
    const species = speciesOf(member.speciesId)
    const typeMatch = species.types.some((t) => kind.favouredTypes.includes(t)) ? 1.4 : 1
    const levelScore = clamp(member.level / 60, 0.1, 1)
    const energyScore = clamp(member.energy / 100, 0.2, 1)
    score += levelScore * typeMatch * energyScore
  }
  return clamp(score / MAX_PARTY, 0, 1)
}

export function energyCost(duration: ExpeditionDuration): number {
  return Math.round((duration.minutes / 60) * ENERGY_COST_PER_HOUR)
}

export interface ExpeditionOutcome {
  loot: Array<{ itemId: string; quantity: number }>
  gold: number
  xpPerMember: number
}

export function resolveExpedition(
  kind: ExpeditionKind,
  duration: ExpeditionDuration,
  rating: number,
  party: ExpeditionParty[],
  rng: Rng,
): ExpeditionOutcome {
  // A weak party still gets half; a strong one gets everything plus an extra
  // draw. The spread is deliberately narrow so sending anyone beats sending
  // nobody, which keeps the feature usable early.
  const quality = 0.5 + rating * 0.5
  const draws = Math.max(1, Math.round((1 + duration.yieldFactor / 6) * quality))

  const merged = new Map<string, number>()
  for (let i = 0; i < draws; i++) {
    const entry = rng.weighted(kind.lootTable, (e) => e.weight)
    const amount = rng.int(entry.min, entry.max)
    merged.set(entry.itemId, (merged.get(entry.itemId) ?? 0) + amount)
  }

  const gold = Math.round(kind.goldPerFactor * duration.yieldFactor * quality)
  const xpPerMember = Math.round(24 * duration.yieldFactor * quality / Math.max(1, party.length))

  return {
    loot: [...merged.entries()].map(([itemId, quantity]) => ({ itemId, quantity })),
    gold,
    xpPerMember,
  }
}

/**
 * Energie als Beschleuniger.
 *
 * Eine Expedition wartet — das ist ihr Wesen. Wer nicht warten will, zahlt mit
 * dem einzigen Vorrat, der sich von selbst füllt: **zehn Minuten je Punkt**.
 * Damit kostet die kurze Reise (30 min) drei Punkte, die lange (8 h) achtund-
 * vierzig — teuer genug, dass es eine Entscheidung bleibt, und billig genug,
 * dass es die letzte Viertelstunde vor dem Schlafengehen rettet.
 */
export const RUSH_MINUTES_PER_ENERGY = 10

/** Wie viel Energie es kostet, `remainingMs` zu überspringen. */
export function rushCost(remainingMs: number): number {
  if (remainingMs <= 0) return 0
  return Math.max(1, Math.ceil(remainingMs / 60_000 / RUSH_MINUTES_PER_ENERGY))
}

export const findDuration = (id: string): ExpeditionDuration | undefined => DURATIONS.find((d) => d.id === id)
export const findKind = (id: string): ExpeditionKind | undefined => KINDS.find((k) => k.id === id)
