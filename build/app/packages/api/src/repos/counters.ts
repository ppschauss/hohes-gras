import type { Db } from '../db/index.js'
import { gameDate } from '../worldClock.js'

/**
 * Per-day counters, keyed by the local date in Europe/Berlin.
 *
 * Storing the date rather than a timestamp means the reset happens at local
 * midnight and survives daylight saving without any special handling: the
 * string simply changes and yesterday's row stops being read.
 */
export function counterValue(db: Db, trainerId: string, counter: string, date = gameDate()): number {
  const row = db
    .prepare('SELECT value FROM daily_counters WHERE trainer_id = ? AND game_date = ? AND counter = ?')
    .get(trainerId, date, counter) as { value: number } | undefined
  return row?.value ?? 0
}

export function bumpCounter(db: Db, trainerId: string, counter: string, by = 1, date = gameDate()): number {
  db.prepare(
    `INSERT INTO daily_counters (trainer_id, game_date, counter, value) VALUES (?, ?, ?, ?)
     ON CONFLICT(trainer_id, game_date, counter) DO UPDATE SET value = value + excluded.value`,
  ).run(trainerId, date, counter, by)
  return counterValue(db, trainerId, counter, date)
}

export function allCountersToday(db: Db, trainerId: string, date = gameDate()): Record<string, number> {
  const rows = db
    .prepare('SELECT counter, value FROM daily_counters WHERE trainer_id = ? AND game_date = ?')
    .all(trainerId, date) as Array<{ counter: string; value: number }>
  return Object.fromEntries(rows.map((r) => [r.counter, r.value]))
}

/** Yesterday's rows are only useful for statistics; anything older is noise. */
export function purgeOldCounters(db: Db, keepDays = 3): number {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000).toISOString().slice(0, 10)
  return db.prepare('DELETE FROM daily_counters WHERE game_date < ?').run(cutoff).changes
}
