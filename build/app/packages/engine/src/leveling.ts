import type { GrowthRate } from '@game/shared'
import { clamp } from './stats.js'

export const MAX_LEVEL = 100

/** Total XP required to *be* at `level`. Level 1 is always 0. */
export function xpForLevel(rate: GrowthRate, level: number): number {
  const n = clamp(Math.floor(level), 1, MAX_LEVEL)
  if (n === 1) return 0
  switch (rate) {
    case 'fast': return Math.floor((4 * n ** 3) / 5)
    case 'medium_fast': return n ** 3
    case 'medium_slow': return Math.max(0, Math.floor((6 / 5) * n ** 3 - 15 * n ** 2 + 100 * n - 140))
    case 'slow': return Math.floor((5 * n ** 3) / 4)
    case 'erratic': return erratic(n)
    case 'fluctuating': return fluctuating(n)
  }
}

function erratic(n: number): number {
  if (n < 50) return Math.floor((n ** 3 * (100 - n)) / 50)
  if (n < 68) return Math.floor((n ** 3 * (150 - n)) / 100)
  if (n < 98) return Math.floor((n ** 3 * Math.floor((1911 - 10 * n) / 3)) / 500)
  return Math.floor((n ** 3 * (160 - n)) / 100)
}

function fluctuating(n: number): number {
  if (n < 15) return Math.floor((n ** 3 * (Math.floor((n + 1) / 3) + 24)) / 50)
  if (n < 36) return Math.floor((n ** 3 * (n + 14)) / 50)
  return Math.floor((n ** 3 * (Math.floor(n / 2) + 32)) / 50)
}

/** Level that `totalXp` corresponds to. Monotonic and clamped to 1..100. */
export function levelForXp(rate: GrowthRate, totalXp: number): number {
  let lo = 1
  let hi = MAX_LEVEL
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (xpForLevel(rate, mid) <= totalXp) lo = mid
    else hi = mid - 1
  }
  return lo
}

export interface LevelProgress {
  level: number
  xpIntoLevel: number
  xpForNextLevel: number
  isMaxLevel: boolean
}

export function levelProgress(rate: GrowthRate, totalXp: number): LevelProgress {
  const level = levelForXp(rate, totalXp)
  if (level >= MAX_LEVEL) {
    return { level: MAX_LEVEL, xpIntoLevel: 0, xpForNextLevel: 0, isMaxLevel: true }
  }
  const floor = xpForLevel(rate, level)
  const ceiling = xpForLevel(rate, level + 1)
  return { level, xpIntoLevel: totalXp - floor, xpForNextLevel: ceiling - floor, isMaxLevel: false }
}

export interface XpGainResult {
  totalXp: number
  levelBefore: number
  levelAfter: number
  levelsGained: number
}

export function grantXp(rate: GrowthRate, totalXp: number, amount: number): XpGainResult {
  const levelBefore = levelForXp(rate, totalXp)
  const capped = Math.min(totalXp + Math.max(0, Math.floor(amount)), xpForLevel(rate, MAX_LEVEL))
  const levelAfter = levelForXp(rate, capped)
  return { totalXp: capped, levelBefore, levelAfter, levelsGained: levelAfter - levelBefore }
}

/**
 * Reconcile a stored XP value with a stored level.
 *
 * XP and level live in two columns and can drift apart — a seeding script, an
 * admin fix or a migration writes one without the other. Since grantXp treats
 * XP as the truth, a row whose XP lags behind its level would be silently
 * *demoted* on the next XP gain: a level-50 creature dropping to level 1 while
 * keeping its old HP. Raising the XP to the floor of the recorded level makes
 * the two agree without ever taking a level away.
 */
export function reconcileXp(rate: GrowthRate, totalXp: number, level: number): number {
  return Math.max(Math.max(0, Math.floor(totalXp)), xpForLevel(rate, level))
}

/** grantXp on a possibly-inconsistent row. Prefer this wherever the level and
 *  XP both come from storage. */
export function grantXpTo(rate: GrowthRate, totalXp: number, level: number, amount: number): XpGainResult {
  return grantXp(rate, reconcileXp(rate, totalXp, level), amount)
}

/** XP a defeated opponent yields. Scales with the level gap so that grinding
 *  low-level areas stops paying off once the team has outgrown them. */
export function battleXpYield(baseYield: number, foeLevel: number, winnerLevel: number): number {
  const raw = (baseYield * foeLevel) / 7
  const gap = clamp(1 + (foeLevel - winnerLevel) / 20, 0.25, 1.75)
  return Math.max(1, Math.floor(raw * gap))
}
