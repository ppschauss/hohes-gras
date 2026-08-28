import type { CareAction, StatBlock } from '@game/shared'
import type { SpeciesDef } from '@game/content'
import { ABSOLUTE_MAX_LEVEL, grantXpTo, xpForLevel, type XpGainResult } from './leveling.js'
import { clamp } from './stats.js'

/** Plaetze im aktiven Team. Auch die Obergrenze eines gespeicherten Teams. */
export const TEAM_CAPACITY = 5
export const FRIENDSHIP_MAX = 255
export const ENERGY_MAX = 100

export interface CareCreature {
  id: string
  speciesId: string
  xp: number
  friendship: number
  energy: number
  level: number
}

export interface CareRules {
  /** Base XP each team member gains. Scaled by team size so a full team is
   *  not strictly better than a small one for levelling a single creature. */
  xp: number
  friendship: number
  energy: number
  /** Item consumed once per action, not per creature. */
  costItemId: string | null
  costQuantity: number
}

/**
 * What each care action does.
 *
 * These are the numbers the whole idle loop rests on. Wie oft gepflegt wird,
 * begrenzt nicht mehr ein Tageszaehler, sondern die Trainer-Energie: eine
 * Pflegeaktion kostet einen Punkt. Die EP-Werte bleiben deshalb bewusst klein —
 * Pflege allein traegt ein Team nie bis zur Liga, dafuer gibt es die Weltkarte.
 */
/**
 * Bezugsgroesse fuer die levelabhaengige Pflege-EP.
 *
 * Die Zahlen in `CARE_RULES` sind flache EP — bei Level 5 grosszuegig, bei
 * Level 19 laecherlich: dort kostet ein Level ueber tausend EP, und 25 EP je
 * Pflegeaktion hiessen vierzig Klicks fuer einen Aufstieg. Ab hier zaehlt
 * deshalb nicht mehr die absolute Zahl, sondern ein *Anteil* der Levelspanne:
 * `xp / 800` ist der Anteil, den eine Aktion beitraegt. Fuettern (32) sind
 * damit 4 % eines Levels, also 25 Aktionen — unabhaengig davon, ob das
 * Pokemon Level 5 oder Level 200 ist.
 *
 * Der flache Wert bleibt als Untergrenze: unter Level 17 ist eine Levelspanne
 * kleiner als 800 EP, und dort waere der Anteil ein Rueckschritt.
 */
export const CARE_LEVEL_SPAN = 800

export const CARE_RULES: Record<CareAction, CareRules> = {
  feed: { xp: 32, friendship: 6, energy: 12, costItemId: 'oran-berry', costQuantity: 1 },
  play: { xp: 26, friendship: 9, energy: -8, costItemId: null, costQuantity: 0 },
  wash: { xp: 18, friendship: 5, energy: 4, costItemId: null, costQuantity: 0 },
  rest: { xp: 10, friendship: 2, energy: 34, costItemId: null, costQuantity: 0 },
}

export type CareRefusal =
  | { ok: false; reason: 'empty_team' }
  | { ok: false; reason: 'needs_item'; itemId: string; quantity: number }
  | { ok: false; reason: 'too_tired'; creatureId: string }

export interface CareOutcome {
  ok: true
  action: CareAction
  consumed: { itemId: string; quantity: number } | null
  results: Array<{
    creatureId: string
    xpGained: number
    xp: XpGainResult
    friendshipBefore: number
    friendshipAfter: number
    energyBefore: number
    energyAfter: number
    leveledUp: boolean
  }>
}

export type CareResult = CareOutcome | CareRefusal

/** Team size damping: a lone creature gets the full amount, a full team of
 *  five gets about 60% each. Wide teams still win on total progress. */
function teamShare(teamSize: number): number {
  return 1 / (1 + 0.1 * Math.max(0, teamSize - 1))
}

export function applyCare(
  action: CareAction,
  team: CareCreature[],
  speciesOf: (id: string) => SpeciesDef,
  itemQuantity: number,
  /** Prozentualer EP-Zuschlag aus dem Trainingsdojo. */
  xpBonusPercent = 0,
  /** Reisegrenze des Trainers. Ohne sie stiege ein Team ueber sein Cap. */
  levelCap = ABSOLUTE_MAX_LEVEL,
): CareResult {
  if (team.length === 0) return { ok: false, reason: 'empty_team' }

  const rules = CARE_RULES[action]
  if (rules.costItemId && itemQuantity < rules.costQuantity) {
    return { ok: false, reason: 'needs_item', itemId: rules.costItemId, quantity: rules.costQuantity }
  }
  // Playing costs energy; a creature that has none cannot play. Resting is
  // always available, which is what makes the loop recoverable.
  if (rules.energy < 0) {
    const exhausted = team.find((c) => c.energy + rules.energy < 0)
    if (exhausted) return { ok: false, reason: 'too_tired', creatureId: exhausted.id }
  }

  const share = teamShare(team.length)
  const results: CareOutcome['results'] = team.map((c) => {
    const species = speciesOf(c.speciesId)
    // Friendship raises XP gain by up to 20%: caring for a creature you have
    // cared for pays off, which is the point of the mechanic.
    const bond = 1 + (c.friendship / FRIENDSHIP_MAX) * 0.2
    const factor = share * bond * (1 + xpBonusPercent / 100)
    // Was ein Level auf dieser Stufe kostet — die Bezugsgroesse fuer den
    // Anteil, den eine Pflegeaktion beitraegt.
    const span = Math.max(
      1, xpForLevel(species.growthRate, c.level + 1) - xpForLevel(species.growthRate, c.level),
    )
    const gain = Math.max(
      1,
      Math.round(rules.xp * factor),
      Math.round((span * rules.xp / CARE_LEVEL_SPAN) * factor),
    )
    // Level mitgeben: eine Zeile mit abweichenden EP darf nie zu einer
    // Ruecksufung fuehren.
    const xp = grantXpTo(species.growthRate, c.xp, c.level, gain, levelCap)
    const friendshipAfter = clamp(c.friendship + rules.friendship, 0, FRIENDSHIP_MAX)
    const energyAfter = clamp(c.energy + rules.energy, 0, ENERGY_MAX)
    return {
      creatureId: c.id,
      xpGained: xp.totalXp - c.xp,
      xp,
      friendshipBefore: c.friendship,
      friendshipAfter,
      energyBefore: c.energy,
      energyAfter,
      leveledUp: xp.levelsGained > 0,
    }
  })

  return {
    ok: true,
    action,
    consumed: rules.costItemId ? { itemId: rules.costItemId, quantity: rules.costQuantity } : null,
    results,
  }
}

/** Energy recovers on its own so a player who steps away for a day comes back
 *  to a usable team rather than a punished one. */
export function regenerateEnergy(current: number, minutesElapsed: number): number {
  const perHour = 6
  return clamp(Math.floor(current + (minutesElapsed / 60) * perHour), 0, ENERGY_MAX)
}

/** A creature's readiness for battle, shown as a ring in the garden. */
export function condition(energy: number, friendship: number, hpRatio: number): number {
  return Math.round(
    clamp(hpRatio, 0, 1) * 50 + (energy / ENERGY_MAX) * 30 + (friendship / FRIENDSHIP_MAX) * 20,
  )
}

/** Friendship raises the chance of surviving a knockout blow with 1 HP and
 *  is one of the evolution triggers, so it is worth showing as a tier. */
export function friendshipTier(friendship: number): 'fremd' | 'vertraut' | 'freundschaftlich' | 'unzertrennlich' {
  if (friendship >= 220) return 'unzertrennlich'
  if (friendship >= 150) return 'freundschaftlich'
  if (friendship >= 70) return 'vertraut'
  return 'fremd'
}

export const currentHpRatio = (hpCurrent: number, stats: StatBlock): number =>
  stats.hp <= 0 ? 0 : clamp(hpCurrent / stats.hp, 0, 1)
