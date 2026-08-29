import type { GrowthRate } from '@game/shared'
import { clamp } from './stats.js'

/**
 * Die harte Obergrenze des Spiels.
 *
 * Frueher stand hier 100, und `xpForLevel` klemmte darauf — mit der Folge,
 * dass jedes Level darueber *gratis* gewesen waere: die Kurve lieferte fuer
 * 150 und fuer 450 denselben Wert. Seit die Reisegrenze mit jeder bezwungenen
 * Region waechst, laeuft die Kurve weiter. 500 ist das Ende der Fahnenstange:
 * die erste Region plus acht weitere zu je fuenfzig Leveln.
 */
export const ABSOLUTE_MAX_LEVEL = 500

/** Was jede bezwungene Region an Spielraum dazugibt. */
export const LEVELS_PER_REGION = 50

/**
 * Der Spielraum, mit dem man anfängt.
 *
 * Nicht 50, und das ist gemessen und nicht geraten: Kantos Champion steht mit
 * seinem Team auf Level 78–84, Johtos Meister auf 90. Eine erste Grenze von 50
 * machte die erste Liga unschlagbar — nicht schwer, sondern unmöglich, weil
 * auch das perfekte Team dreißig Level darunter bliebe. Die erste Region gibt
 * deshalb den Spielraum, den ihr Inhalt verlangt; erst danach beginnt die
 * Leiter.
 */
export const FIRST_REGION_LEVELS = 100

/** @deprecated Nur noch fuer Aufrufer ohne eigene Grenze. Wer eine
 *  Reisegrenze kennt, soll sie uebergeben. */
export const MAX_LEVEL = ABSOLUTE_MAX_LEVEL

/**
 * Total XP required to *be* at `level`. Level 1 is always 0.
 *
 * Ab Level 101 gilt eine Fortsetzung statt der Originalformeln. Die sind nur
 * bis 100 definiert, und zwei davon brechen darueber zusammen: `erratic`
 * enthaelt den Faktor (160 − n), wird bei Level 160 also null und danach
 * negativ. Eine EP-Kurve, die faellt, bedeutet Level, die man durch Kaempfen
 * *verliert*.
 *
 * Die Fortsetzung skaliert den Wert bei 100 kubisch weiter. Fuer die
 * polynomialen Kurven ist das exakt dieselbe Zahl wie zuvor — `medium_fast`
 * ist n³, und n³ = 100³·(n/100)³. Fuer die beiden Sonderkurven ist es die
 * naheliegende Fortschreibung ihres Aufwands.
 */
export function xpForLevel(rate: GrowthRate, level: number): number {
  const n = clamp(Math.floor(level), 1, ABSOLUTE_MAX_LEVEL)
  if (n === 1) return 0
  if (n > CURVE_LIMIT) {
    return Math.floor(baseCurve(rate, CURVE_LIMIT) * (n / CURVE_LIMIT) ** 3)
  }
  return baseCurve(rate, n)
}

/** Bis hierher gelten die Originalformeln. */
const CURVE_LIMIT = 100

function baseCurve(rate: GrowthRate, n: number): number {
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

/**
 * Level, das `totalXp` entspricht — hoechstens aber `cap`.
 *
 * Die Reisegrenze wird hier durchgereicht statt global zu gelten: zwei
 * Trainer mit unterschiedlich vielen bezwungenen Regionen haben verschiedene
 * Grenzen, und dieselbe EP-Zahl bedeutet fuer sie verschiedene Level.
 */
export function levelForXp(rate: GrowthRate, totalXp: number, cap = ABSOLUTE_MAX_LEVEL): number {
  let lo = 1
  let hi = clamp(Math.floor(cap), 1, ABSOLUTE_MAX_LEVEL)
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

export function levelProgress(rate: GrowthRate, totalXp: number, cap = ABSOLUTE_MAX_LEVEL): LevelProgress {
  const ceiling = clamp(Math.floor(cap), 1, ABSOLUTE_MAX_LEVEL)
  const level = levelForXp(rate, totalXp, ceiling)
  if (level >= ceiling) {
    return { level: ceiling, xpIntoLevel: 0, xpForNextLevel: 0, isMaxLevel: true }
  }
  const floor = xpForLevel(rate, level)
  const next = xpForLevel(rate, level + 1)
  return { level, xpIntoLevel: totalXp - floor, xpForNextLevel: next - floor, isMaxLevel: false }
}

export interface XpGainResult {
  totalXp: number
  levelBefore: number
  levelAfter: number
  levelsGained: number
}

export function grantXp(
  rate: GrowthRate, totalXp: number, amount: number, cap = ABSOLUTE_MAX_LEVEL,
): XpGainResult {
  const ceiling = clamp(Math.floor(cap), 1, ABSOLUTE_MAX_LEVEL)
  const levelBefore = levelForXp(rate, totalXp, ceiling)
  // An der Reisegrenze laeuft die EP-Zahl nicht weiter. Sonst saesse jemand
  // nach einer neuen Region ploetzlich auf zwanzig geschenkten Leveln.
  const capped = Math.min(totalXp + Math.max(0, Math.floor(amount)), xpForLevel(rate, ceiling))
  const levelAfter = levelForXp(rate, capped, ceiling)
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
export function grantXpTo(
  rate: GrowthRate, totalXp: number, level: number, amount: number, cap = ABSOLUTE_MAX_LEVEL,
): XpGainResult {
  return grantXp(rate, reconcileXp(rate, totalXp, level), amount, cap)
}

/**
 * Die Reisegrenze: fuenfzig Level je bezwungener Region, plus die erste.
 *
 * Bewusst an *bezwungene* Regionen gebunden, nicht an betretene — sonst
 * tourte man neun Regionen auf Level fuenf ab und haette die Grenze
 * geschenkt.
 */
export function travelCap(clearedRegions: number): number {
  const regions = Math.max(0, Math.floor(clearedRegions))
  return Math.min(ABSOLUTE_MAX_LEVEL, FIRST_REGION_LEVELS + LEVELS_PER_REGION * regions)
}

/**
 * Was ein besiegter Gegner an EP abwirft.
 *
 * Der Levelabstand sorgt dafuer, dass sich das Abgrasen niedriger Gebiete
 * nicht mehr lohnt, sobald das Team ihnen entwachsen ist.
 *
 * Die Zahl der gegnerischen Pokemon zaehlt seit einer Meldung mit: ein Kampf
 * gegen sechs war exakt so viel wert wie einer gegen eines, weil hier das
 * hoechste Level und der Durchschnitt der Arten eingingen, aber nie die Menge.
 * Gegen die Top Vier fuehlte sich das falsch an, und das war es auch.
 *
 * Multiplikativ und nicht linear: sechs Gegner sind nicht sechsmal so viel
 * wert, sonst wuerde ein Arenadurchlauf mit fuenf Gegnern je Kampf zum
 * Levelautomaten. Ein Viertel je zusaetzlichem Gegner ergibt 1,25 bei zweien
 * und gut das Dreifache bei sechs — spuerbar, ohne die Kurve umzuwerfen.
 */
export const XP_PER_EXTRA_FOE = 1.25

export function battleXpYield(
  baseYield: number, foeLevel: number, winnerLevel: number, foeCount = 1,
): number {
  const raw = (baseYield * foeLevel) / 7
  const gap = clamp(1 + (foeLevel - winnerLevel) / 20, 0.25, 1.75)
  const party = XP_PER_EXTRA_FOE ** Math.max(0, Math.floor(foeCount) - 1)
  return Math.max(1, Math.floor(raw * gap * party))
}
