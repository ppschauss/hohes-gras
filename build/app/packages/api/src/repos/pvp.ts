import type { BattleEvent } from '@game/engine'
import type { Db } from '../db/index.js'
import { newId } from '../db/ids.js'
import { START_RATING } from '@game/engine'

export interface Rating {
  trainerId: string
  rating: number
  wins: number
  losses: number
  streak: number
}

export function ratingOf(db: Db, trainerId: string, now = Date.now()): Rating {
  const row = db
    .prepare('SELECT trainer_id AS trainerId, rating, wins, losses, streak FROM pvp_ratings WHERE trainer_id = ?')
    .get(trainerId) as Rating | undefined
  if (row) return row
  db.prepare('INSERT OR IGNORE INTO pvp_ratings (trainer_id, rating, updated_at) VALUES (?, ?, ?)')
    .run(trainerId, START_RATING, now)
  return { trainerId, rating: START_RATING, wins: 0, losses: 0, streak: 0 }
}

export function updateRating(db: Db, trainerId: string, rating: number, won: boolean, now = Date.now()): void {
  const current = ratingOf(db, trainerId, now)
  const streak = won ? Math.max(1, current.streak + 1) : Math.min(-1, current.streak - 1)
  db.prepare(
    `UPDATE pvp_ratings SET rating = ?, wins = wins + ?, losses = losses + ?, streak = ?, updated_at = ?
     WHERE trainer_id = ?`,
  ).run(rating, won ? 1 : 0, won ? 0 : 1, streak, now, trainerId)
}

/** Candidate opponents inside a rating band, excluding the caller. */
export function findOpponents(db: Db, trainerId: string, low: number, high: number, limit = 5): Array<{ trainerId: string; displayName: string; rating: number }> {
  return db
    .prepare(
      `SELECT r.trainer_id AS trainerId, t.display_name AS displayName, r.rating
       FROM pvp_ratings r JOIN trainers t ON t.id = r.trainer_id
       WHERE r.trainer_id != ? AND t.is_banned = 0 AND r.rating BETWEEN ? AND ?
         AND EXISTS (SELECT 1 FROM creatures c WHERE c.owner_id = t.id AND c.team_slot IS NOT NULL)
       ORDER BY ABS(r.rating - (SELECT rating FROM pvp_ratings WHERE trainer_id = ?)) ASC
       LIMIT ?`,
    )
    .all(trainerId, low, high, trainerId, limit) as Array<{ trainerId: string; displayName: string; rating: number }>
}

export function ladder(db: Db, limit = 50): Array<Rating & { displayName: string }> {
  return db
    .prepare(
      `SELECT r.trainer_id AS trainerId, t.display_name AS displayName, r.rating, r.wins, r.losses, r.streak
       FROM pvp_ratings r JOIN trainers t ON t.id = r.trainer_id
       WHERE t.hide_leaderboard = 0 AND t.is_banned = 0
       ORDER BY r.rating DESC LIMIT ?`,
    )
    .all(limit) as Array<Rating & { displayName: string }>
}

export interface Duel {
  id: string
  challengerId: string
  defenderId: string
  seed: string
  events: BattleEvent[]
  winner: number | null
  ratingDelta: number
  foughtAt: number
  seenByDefender: boolean
}

interface DuelRow {
  id: string; challenger_id: string; defender_id: string; seed: string; events: string
  winner: number | null; rating_delta: number; fought_at: number; seen_by_defender: number
}

const toDuel = (r: DuelRow): Duel => ({
  id: r.id, challengerId: r.challenger_id, defenderId: r.defender_id, seed: r.seed,
  events: JSON.parse(r.events) as BattleEvent[],
  winner: r.winner, ratingDelta: r.rating_delta, foughtAt: r.fought_at,
  seenByDefender: r.seen_by_defender === 1,
})

export function recordDuel(db: Db, input: Omit<Duel, 'id' | 'seenByDefender'>): Duel {
  const id = newId()
  db.prepare(
    `INSERT INTO pvp_duels (id, challenger_id, defender_id, seed, events, winner, rating_delta, fought_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.challengerId, input.defenderId, input.seed,
    JSON.stringify(input.events), input.winner, input.ratingDelta, input.foughtAt)
  return duelById(db, id)!
}

export function duelById(db: Db, id: string): Duel | null {
  const row = db.prepare('SELECT * FROM pvp_duels WHERE id = ?').get(id) as DuelRow | undefined
  return row ? toDuel(row) : null
}

export function historyOf(db: Db, trainerId: string, limit = 20): Duel[] {
  const rows = db
    .prepare('SELECT * FROM pvp_duels WHERE challenger_id = ? OR defender_id = ? ORDER BY fought_at DESC LIMIT ?')
    .all(trainerId, trainerId, limit) as DuelRow[]
  return rows.map(toDuel)
}

export function unseenDefences(db: Db, trainerId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM pvp_duels WHERE defender_id = ? AND seen_by_defender = 0')
    .get(trainerId) as { n: number }
  return row.n
}

export function markDefencesSeen(db: Db, trainerId: string): void {
  db.prepare('UPDATE pvp_duels SET seen_by_defender = 1 WHERE defender_id = ? AND seen_by_defender = 0').run(trainerId)
}

/** Duels started today, used to cap how often the ladder can be farmed. */
export function duelsToday(db: Db, trainerId: string, sinceMs: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM pvp_duels WHERE challenger_id = ? AND fought_at >= ?')
    .get(trainerId, sinceMs) as { n: number }
  return row.n
}
