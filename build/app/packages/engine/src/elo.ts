/**
 * Elo rating for asynchronous duels.
 *
 * K falls as a player settles: newcomers climb to their real level in a few
 * matches, established players do not swing wildly on one lucky duel.
 */
export const START_RATING = 1000

export function kFactor(gamesPlayed: number, rating: number): number {
  if (gamesPlayed < 10) return 48
  if (rating >= 1800) return 16
  return 24
}

export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400))
}

export interface RatingChange {
  rating: number
  delta: number
}

export function applyResult(
  rating: number,
  opponentRating: number,
  won: boolean,
  gamesPlayed: number,
): RatingChange {
  const k = kFactor(gamesPlayed, rating)
  const expected = expectedScore(rating, opponentRating)
  const delta = Math.round(k * ((won ? 1 : 0) - expected))
  // Never let a rating fall below a floor: hitting zero would make the number
  // meaningless and the ladder discouraging.
  const next = Math.max(100, rating + delta)
  return { rating: next, delta: next - rating }
}

/** Opponents worth offering: close enough to be fair, spread enough to have
 *  someone to play. */
export function matchmakingRange(rating: number, attempt = 0): [number, number] {
  const width = 150 + attempt * 150
  return [rating - width, rating + width]
}

export function tierOf(rating: number): 'bronze' | 'silber' | 'gold' | 'platin' | 'meister' {
  if (rating >= 1900) return 'meister'
  if (rating >= 1600) return 'platin'
  if (rating >= 1350) return 'gold'
  if (rating >= 1150) return 'silber'
  return 'bronze'
}
