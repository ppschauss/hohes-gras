/**
 * Season pass and achievements.
 *
 * Both answer the same question — "what am I working towards this week?" — at
 * two different time scales. The season resets; achievements do not.
 */

export interface SeasonTier {
  tier: number
  pointsRequired: number
  reward: { kind: 'gold'; amount: number } | { kind: 'item'; itemId: string; quantity: number }
}

/**
 * Eine Saison ist eine Woche.
 *
 * Vier Wochen waren zu lang, um ein Ziel zu sein: wer in Woche eins zurueckfiel,
 * holte den Rest nicht mehr auf, und wer vorne lag, hatte drei Wochen nichts
 * mehr zu tun. Mit der Woche wird der Pass zu einer Sache, die man ueberblickt
 * — und die Leiter musste dafuer kuerzer werden, sonst waere sie nur noch ein
 * Viertel weit begehbar.
 */
export const SEASON_LENGTH_DAYS = 7
export const MAX_SEASON_TIER = 12

/** Das Fragment, das die letzte Stufe einer Saison abwirft. */
export const SHINY_SOUL_ID = 'soul-shiny'

/** Points needed to reach a tier. Slightly super-linear so the last tiers are
 *  a real target without becoming unreachable for a casual player. */
export function pointsForTier(tier: number): number {
  if (tier <= 1) return 0
  return Math.round(120 * (tier - 1) + 6 * (tier - 1) ** 1.6)
}

export function tierForPoints(points: number): number {
  let tier = 1
  while (tier < MAX_SEASON_TIER && pointsForTier(tier + 1) <= points) tier++
  return tier
}

/** Reward for reaching a tier. Every fifth tier is a bigger moment. */
export function rewardForTier(tier: number): SeasonTier['reward'] {
  // Die letzte Stufe ist der eigentliche Grund, die Woche durchzuspielen: ein
  // Schillerndes Seelenfragment. Fuenf davon — also fuenf Wochen — werden zu
  // einem schillernden Ei.
  if (tier >= MAX_SEASON_TIER) return { kind: 'item', itemId: SHINY_SOUL_ID, quantity: 1 }
  if (tier % 6 === 0) return { kind: 'item', itemId: 'golden-razz', quantity: 3 }
  if (tier % 4 === 0) return { kind: 'item', itemId: 'ultra-ball', quantity: 5 }
  if (tier % 3 === 0) return { kind: 'item', itemId: 'exp-candy-s', quantity: 2 }
  return { kind: 'gold', amount: 200 + tier * 40 }
}

export function seasonTiers(): SeasonTier[] {
  return Array.from({ length: MAX_SEASON_TIER }, (_, i) => {
    const tier = i + 1
    return { tier, pointsRequired: pointsForTier(tier), reward: rewardForTier(tier) }
  })
}

/** How much each activity contributes. Deliberately spread so no single
 *  activity is the "correct" way to farm the pass. */
export const SEASON_POINTS: Record<string, number> = {
  catch: 4,
  careAction: 2,
  battleWin: 10,
  gymWin: 60,
  raidAttack: 6,
  expeditionCollect: 8,
  eggHatch: 12,
  duelWin: 12,
  evolution: 15,
  newDexEntry: 20,
}

/* ------------------------------------------------------------------ Erfolge */

export interface AchievementSpec {
  id: string
  /** Counter this achievement watches. */
  metric: string
  target: number
  reward: { gold: number }
  /** Achievements in a chain show up one at a time. */
  chain?: string
}

/**
 * Die Ketten reichen über alle Regionen.
 *
 * Vorher endeten sie an Kanto: 151 Arten, 8 Orden, Level 100 — Zahlen, die mit
 * drei Regionen (386 Arten, 26 Orden, Reisegrenze bis 500) zu früh aufhörten.
 * Eine Kette, deren letztes Glied man auf halber Strecke erreicht, hört auf,
 * ein Ziel zu sein.
 *
 * Die Ordensstufen sind bewusst 9 / 17 / 26: das ist je eine vollständig
 * bezwungene Region, Krone eingerechnet.
 */
export const ACHIEVEMENTS: AchievementSpec[] = [
  { id: 'catch-10', metric: 'catches', target: 10, reward: { gold: 200 }, chain: 'catches' },
  { id: 'catch-50', metric: 'catches', target: 50, reward: { gold: 600 }, chain: 'catches' },
  { id: 'catch-200', metric: 'catches', target: 200, reward: { gold: 2000 }, chain: 'catches' },
  { id: 'catch-500', metric: 'catches', target: 500, reward: { gold: 6000 }, chain: 'catches' },
  { id: 'catch-1000', metric: 'catches', target: 1000, reward: { gold: 15000 }, chain: 'catches' },

  { id: 'dex-25', metric: 'dexCaught', target: 25, reward: { gold: 500 }, chain: 'dex' },
  { id: 'dex-75', metric: 'dexCaught', target: 75, reward: { gold: 1500 }, chain: 'dex' },
  { id: 'dex-151', metric: 'dexCaught', target: 151, reward: { gold: 6000 }, chain: 'dex' },
  { id: 'dex-251', metric: 'dexCaught', target: 251, reward: { gold: 14000 }, chain: 'dex' },
  { id: 'dex-386', metric: 'dexCaught', target: 386, reward: { gold: 40000 }, chain: 'dex' },

  { id: 'badges-1', metric: 'badges', target: 1, reward: { gold: 300 }, chain: 'badges' },
  { id: 'badges-4', metric: 'badges', target: 4, reward: { gold: 1200 }, chain: 'badges' },
  { id: 'badges-9', metric: 'badges', target: 9, reward: { gold: 5000 }, chain: 'badges' },
  { id: 'badges-17', metric: 'badges', target: 17, reward: { gold: 15000 }, chain: 'badges' },
  { id: 'badges-26', metric: 'badges', target: 26, reward: { gold: 45000 }, chain: 'badges' },

  { id: 'level-25', metric: 'highestLevel', target: 25, reward: { gold: 400 }, chain: 'level' },
  { id: 'level-50', metric: 'highestLevel', target: 50, reward: { gold: 1200 }, chain: 'level' },
  { id: 'level-100', metric: 'highestLevel', target: 100, reward: { gold: 8000 }, chain: 'level' },
  { id: 'level-150', metric: 'highestLevel', target: 150, reward: { gold: 20000 }, chain: 'level' },
  { id: 'level-200', metric: 'highestLevel', target: 200, reward: { gold: 50000 }, chain: 'level' },

  { id: 'shiny-1', metric: 'shinies', target: 1, reward: { gold: 1000 }, chain: 'shiny' },
  { id: 'shiny-5', metric: 'shinies', target: 5, reward: { gold: 4000 }, chain: 'shiny' },
  { id: 'shiny-15', metric: 'shinies', target: 15, reward: { gold: 15000 }, chain: 'shiny' },

  { id: 'evolutions-5', metric: 'evolutions', target: 5, reward: { gold: 300 }, chain: 'evolution' },
  { id: 'evolutions-25', metric: 'evolutions', target: 25, reward: { gold: 1500 }, chain: 'evolution' },
  { id: 'evolutions-75', metric: 'evolutions', target: 75, reward: { gold: 6000 }, chain: 'evolution' },

  { id: 'raids-3', metric: 'raidsWon', target: 3, reward: { gold: 800 }, chain: 'raids' },
  { id: 'raids-15', metric: 'raidsWon', target: 15, reward: { gold: 5000 }, chain: 'raids' },
  { id: 'duels-10', metric: 'duelsWon', target: 10, reward: { gold: 900 }, chain: 'duels' },
  { id: 'duels-50', metric: 'duelsWon', target: 50, reward: { gold: 6000 }, chain: 'duels' },
  { id: 'eggs-10', metric: 'eggsHatched', target: 10, reward: { gold: 700 }, chain: 'eggs' },
  { id: 'eggs-50', metric: 'eggsHatched', target: 50, reward: { gold: 5000 }, chain: 'eggs' },
  { id: 'friends-3', metric: 'friends', target: 3, reward: { gold: 400 }, chain: 'social' },
]

export const findAchievement = (id: string): AchievementSpec | undefined =>
  ACHIEVEMENTS.find((a) => a.id === id)

/**
 * Which achievement of each chain to show.
 *
 * Only one step per chain is visible — showing all three "catch N" tiers at
 * once turns a sense of progress into a wall of numbers.
 *
 * The step shown is the first that has *not been claimed*, not the first that
 * is unearned. Those differ exactly once per chain, and the difference matters:
 * the moment an achievement unlocks, its reward is still unclaimed, and moving
 * straight to the next tier would hide the reward before the player could take
 * it.
 */
export function visibleAchievements(claimed: Set<string>): AchievementSpec[] {
  const byChain = new Map<string, AchievementSpec[]>()
  for (const spec of ACHIEVEMENTS) {
    const key = spec.chain ?? spec.id
    byChain.set(key, [...(byChain.get(key) ?? []), spec])
  }

  const out: AchievementSpec[] = []
  for (const chain of byChain.values()) {
    const sorted = [...chain].sort((a, b) => a.target - b.target)
    const next = sorted.find((s) => !claimed.has(s.id))
    // A fully claimed chain still shows its final step, so the accomplishment
    // does not simply vanish from the list.
    out.push(next ?? sorted[sorted.length - 1]!)
  }
  return out
}

export function isUnlocked(spec: AchievementSpec, metrics: Record<string, number>): boolean {
  return (metrics[spec.metric] ?? 0) >= spec.target
}
