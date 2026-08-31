import type { SpeciesDef } from '@game/content'
import type { Fighter } from './battle-types.js'
import type { Rng } from './rng.js'
import { clamp } from './stats.js'

/**
 * Raid bosses.
 *
 * A raid is not a normal battle: several trainers chip away at one large health
 * pool over hours, each contributing when they happen to open the app. Modelling
 * it as a full turn-based fight would require everyone online at once, which is
 * exactly what a Telegram group cannot guarantee.
 */

export const RAID_TIERS = [1, 3, 5] as const
export type RaidTier = (typeof RAID_TIERS)[number]

export interface RaidTierSpec {
  tier: RaidTier
  levelRange: [number, number]
  hpMultiplier: number
  /** Hours until the boss leaves if nobody finishes it. */
  durationHours: number
  goldPool: number
  minRarity: 'common' | 'uncommon' | 'rare' | 'legendary'
}

/**
 * Boss health is tuned to a target group size, not to a feeling.
 *
 * One trainer with a full team of five contributes roughly
 * `5 creatures × ~450 damage × 5 attacks ≈ 2200` over a raid.
 *
 * Die Zielgroessen waren zwei, fuenf und zehn Trainer — "eine Gruppe von
 * Freunden statt einer grossen Gilde", und trotzdem zu gross gedacht. Gespielt
 * wird hier zu viert; Stufe 3 verlangte fuenf und Stufe 5 zehn, also waren
 * zwei von drei Stufen unerreichbar, egal wie gut jemand spielt. Gemeldet als
 * "Raids sollen einfacher sein".
 *
 * Jetzt: einer, zwei, vier. Stufe 1 schafft man allein, Stufe 5 braucht die
 * ganze Runde — das ist dieselbe Staffelung, nur an der Gruppe gemessen, die
 * es wirklich gibt. `raid.test.ts` prueft die Zielgroessen, damit eine spaetere
 * Aenderung die Absicht neu formulieren muss, statt still zu verrutschen.
 */
export const DAMAGE_PER_TRAINER_ESTIMATE = 2200

export const TIER_SPECS: Record<RaidTier, RaidTierSpec> = {
  1: { tier: 1, levelRange: [12, 22], hpMultiplier: 8, durationHours: 6, goldPool: 1200, minRarity: 'common' },
  3: { tier: 3, levelRange: [28, 42], hpMultiplier: 15, durationHours: 12, goldPool: 4500, minRarity: 'uncommon' },
  5: { tier: 5, levelRange: [50, 68], hpMultiplier: 25, durationHours: 24, goldPool: 14000, minRarity: 'rare' },
}

/**
 * Was ein Raid an Werkstoffen abwirft, je Stufe.
 *
 * Bisher gab es **nur Gold** — und genau so kam es an: „474 Gold für den
 * Raid boss, ziemlich mau". Der Einwand lautete, die Bosse seien zu teuer;
 * das eigentliche Problem war, dass ein Raid nichts einbrachte, was man sonst
 * nirgends bekommt.
 *
 * Werkstoffe statt eines Preisnachlasses: der Raid wird damit zur schnellsten
 * Quelle für das, was die Werkbank frisst — ohne dass die Zahl auf dem
 * Beschwörungsknopf sinkt.
 *
 * Verteilt wird nach Anteil wie das Gold, aber mit einem garantierten Sockel:
 * wer mitschlägt, geht nie leer aus.
 */
export interface RaidDrop {
  itemId: string
  /** Wie viel es bei vollem Anteil gibt. Der Sockel ist ein Drittel davon. */
  quantity: number
}

export const RAID_DROPS: Record<RaidTier, RaidDrop[]> = {
  1: [
    { itemId: 'iron-shard', quantity: 6 },
    { itemId: 'silk-thread', quantity: 4 },
  ],
  3: [
    { itemId: 'iron-shard', quantity: 14 },
    { itemId: 'soft-sand', quantity: 10 },
    { itemId: 'star-piece', quantity: 2 },
  ],
  5: [
    { itemId: 'iron-shard', quantity: 30 },
    { itemId: 'dew-drop', quantity: 20 },
    { itemId: 'star-piece', quantity: 6 },
    { itemId: 'exp-candy-l', quantity: 2 },
  ],
}

/** Der Sockel: dieser Anteil fällt auch bei winzigem Beitrag. */
export const RAID_DROP_FLOOR = 1 / 3

/** Trainers with full teams needed to finish a boss. Used by the UI to set
 *  expectations before a guild summons something it cannot beat. */
export const TARGET_TRAINERS: Record<RaidTier, number> = { 1: 1, 3: 2, 5: 4 }

/** Boss health scales with tier and level, not with how many people joined:
 *  a raid nobody helps with should stay unfinished rather than shrink. */
export function bossHp(species: SpeciesDef, level: number, tier: RaidTier): number {
  const spec = TIER_SPECS[tier]
  const base = species.baseStats.hp + species.baseStats.def + species.baseStats.spd
  return Math.round(base * spec.hpMultiplier * (1 + level / 100))
}

export interface RaidAttackResult {
  damage: number
  /** Per-creature breakdown so the client can show who did what. */
  contributions: Array<{ creatureId: string; name: string; damage: number; effectiveness: number }>
  bossHpLeft: number
  defeated: boolean
}

export const ATTACKS_PER_TRAINER_PER_RAID = 5

/**
 * One trainer's attack round against the boss.
 *
 * Damage comes from the whole team at once rather than a single active
 * creature: a raid is a group effort in one tap, and asking for five separate
 * turns per visit would make it a chore.
 */
export function raidAttack(
  team: Fighter[],
  bossTypes: readonly string[],
  bossLevel: number,
  effectiveness: (attackingType: string, defTypes: readonly string[]) => number,
  moveTypeOf: (moveId: string) => string | null,
  rng: Rng,
): { damage: number; contributions: RaidAttackResult['contributions'] } {
  const contributions: RaidAttackResult['contributions'] = []
  let total = 0

  for (const fighter of team) {
    if (fighter.hp <= 0) continue

    // Best available type matchup from the creature's moves. Using the best
    // rather than a random one rewards building a team for the boss.
    let best = 1
    for (const slot of fighter.moves) {
      const type = moveTypeOf(slot.id)
      if (!type) continue
      best = Math.max(best, effectiveness(type, bossTypes))
    }

    const offence = Math.max(fighter.stats.atk, fighter.stats.spa)
    const levelGap = clamp(1 + (fighter.level - bossLevel) / 60, 0.55, 1.6)
    const spread = rng.int(88, 112) / 100
    const damage = Math.max(1, Math.round(offence * 0.9 * best * levelGap * spread))

    contributions.push({ creatureId: fighter.id, name: fighter.name, damage, effectiveness: best })
    total += damage
  }

  return { damage: total, contributions }
}

export interface RaidReward {
  trainerId: string
  damage: number
  share: number
  gold: number
  /** Everyone who took part gets a chance at the boss species; the top
   *  contributor gets a better one. */
  catchChance: number
  /** Werkstoffe: Sockel für alle, Rest nach Anteil. */
  items: Array<{ itemId: string; quantity: number }>
}

/**
 * Split the reward pool.
 *
 * Half is shared equally among everyone who showed up and half by damage. Pure
 * damage-share would make a low-level player's participation worthless; pure
 * equal share would make effort pointless.
 */
export function distributeRewards(
  participants: Array<{ trainerId: string; damage: number }>,
  tier: RaidTier,
): RaidReward[] {
  if (participants.length === 0) return []
  const spec = TIER_SPECS[tier]
  const totalDamage = participants.reduce((sum, p) => sum + p.damage, 0)
  const equalPart = spec.goldPool * 0.5 / participants.length

  return participants.map((p) => {
    const share = totalDamage > 0 ? p.damage / totalDamage : 1 / participants.length
    const gold = Math.round(equalPart + spec.goldPool * 0.5 * share)
    return {
      trainerId: p.trainerId,
      damage: p.damage,
      share,
      gold,
      catchChance: clamp(0.35 + share * 0.5, 0.35, 0.9),
      // Sockel plus Anteil, aufgerundet: ein halber Eisensplitter ist keine
      // Belohnung, sondern eine Rundungsfrage.
      items: RAID_DROPS[tier]
        .map((d) => ({
          itemId: d.itemId,
          quantity: Math.ceil(d.quantity * (RAID_DROP_FLOOR + (1 - RAID_DROP_FLOOR) * share)),
        }))
        .filter((d) => d.quantity > 0),
    }
  })
}

/** Progress bar value for the group chat message. */
export const raidProgress = (hpLeft: number, hpMax: number): number =>
  hpMax <= 0 ? 1 : clamp(1 - hpLeft / hpMax, 0, 1)
