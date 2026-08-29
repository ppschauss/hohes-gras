import type { Db } from '../db/index.js'

export interface AreaProgress {
  areaId: string
  firstVisit: number
  lastVisit: number
  encounters: number
  catches: number
}

export function badgesOf(db: Db, trainerId: string): Set<string> {
  const rows = db.prepare('SELECT badge_id AS id FROM trainer_badges WHERE trainer_id = ?').all(trainerId) as Array<{ id: string }>
  return new Set(rows.map((r) => r.id))
}

export function awardBadge(db: Db, trainerId: string, badgeId: string, now = Date.now()): boolean {
  const changed = db
    .prepare('INSERT OR IGNORE INTO trainer_badges (trainer_id, badge_id, earned_at) VALUES (?, ?, ?)')
    .run(trainerId, badgeId, now).changes
  return changed === 1
}

export function progressOf(db: Db, trainerId: string): Map<string, AreaProgress> {
  const rows = db
    .prepare(
      `SELECT area_id AS areaId, first_visit AS firstVisit, last_visit AS lastVisit,
              encounters, catches FROM area_progress WHERE trainer_id = ?`,
    )
    .all(trainerId) as AreaProgress[]
  return new Map(rows.map((r) => [r.areaId, r]))
}

export function visitArea(db: Db, trainerId: string, areaId: string, now = Date.now()): void {
  db.prepare(
    `INSERT INTO area_progress (trainer_id, area_id, first_visit, last_visit) VALUES (?, ?, ?, ?)
     ON CONFLICT(trainer_id, area_id) DO UPDATE SET last_visit = excluded.last_visit`,
  ).run(trainerId, areaId, now, now)
}

export function bumpAreaStat(db: Db, trainerId: string, areaId: string, field: 'encounters' | 'catches'): void {
  // Column name is from a closed set, never from user input.
  db.prepare(`UPDATE area_progress SET ${field} = ${field} + 1 WHERE trainer_id = ? AND area_id = ?`)
    .run(trainerId, areaId)
}

/** Distinct species caught per area — the "9/9 gefangen" counter. */
export function caughtPerArea(db: Db, trainerId: string): Map<string, number> {
  const rows = db
    .prepare(
      `SELECT caught_area_id AS areaId, COUNT(DISTINCT species_id) AS n
       FROM creatures WHERE owner_id = ? AND caught_area_id IS NOT NULL GROUP BY caught_area_id`,
    )
    .all(trainerId) as Array<{ areaId: string; n: number }>
  return new Map(rows.map((r) => [r.areaId, r.n]))
}

export function chainOf(db: Db, trainerId: string, speciesId: string): number {
  const row = db
    .prepare('SELECT streak FROM catch_chains WHERE trainer_id = ? AND species_id = ?')
    .get(trainerId, speciesId) as { streak: number } | undefined
  return row?.streak ?? 0
}

/**
 * Update the catch chain.
 *
 * Catching the same species extends the streak; catching a different one
 * resets it. Resetting everything else is what makes a chain a commitment
 * rather than a passive counter that only ever grows.
 */
export function recordCatch(db: Db, trainerId: string, speciesId: string, now = Date.now()): number {
  db.prepare('UPDATE catch_chains SET streak = 0, updated_at = ? WHERE trainer_id = ? AND species_id != ?')
    .run(now, trainerId, speciesId)
  db.prepare(
    `INSERT INTO catch_chains (trainer_id, species_id, streak, updated_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(trainer_id, species_id) DO UPDATE SET streak = streak + 1, updated_at = excluded.updated_at`,
  ).run(trainerId, speciesId, now)
  return chainOf(db, trainerId, speciesId)
}

/** Die Serie einer Art auf einen Wert setzen — nach einem Treffer. */
export function setChain(db: Db, trainerId: string, speciesId: string, streak: number, now = Date.now()): void {
  db.prepare(
    `INSERT INTO catch_chains (trainer_id, species_id, streak, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(trainer_id, species_id) DO UPDATE SET streak = excluded.streak, updated_at = excluded.updated_at`,
  ).run(trainerId, speciesId, Math.max(0, Math.floor(streak)), now)
}

export function breakChain(db: Db, trainerId: string, now = Date.now()): void {
  db.prepare('UPDATE catch_chains SET streak = 0, updated_at = ? WHERE trainer_id = ?').run(now, trainerId)
}
