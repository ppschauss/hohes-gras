import type { Db } from '../db/index.js'
import { GameError } from '@game/shared'

export interface Bucket { limit: number; windowMs: number }

/** Named buckets keep the numbers in one place instead of scattered magic
 *  values across route handlers. */
export const BUCKETS = {
  auth: { limit: 60, windowMs: 60_000 },
  action: { limit: 600, windowMs: 60_000 },
  // Seit die Tageslimits weg sind, ist Erkunden die haeufigste Aktion im Spiel
  // und laeuft ueber diesen Eimer. Zwanzig pro Minute waren dafuer viel zu eng:
  // die Schranke soll Skripte bremsen, nicht schnelles Spielen.
  write_heavy: { limit: 300, windowMs: 60_000 },
  social: { limit: 120, windowMs: 60_000 },
} as const satisfies Record<string, Bucket>

export type BucketName = keyof typeof BUCKETS

/** Fixed-window counter. Coarser than a sliding window, but it costs one row
 *  and one UPSERT — and the goal here is to stop scripted spam, not to shave
 *  microseconds off a legitimate player's burst. */
export function consume(db: Db, subject: string, name: BucketName, now = Date.now()): void {
  const bucket = BUCKETS[name]
  const windowStart = Math.floor(now / bucket.windowMs) * bucket.windowMs
  const row = db
    .prepare('SELECT window_start AS windowStart, count FROM rate_limits WHERE trainer_id = ? AND bucket = ?')
    .get(subject, name) as { windowStart: number; count: number } | undefined

  if (!row || row.windowStart !== windowStart) {
    db.prepare(
      `INSERT INTO rate_limits (trainer_id, bucket, window_start, count) VALUES (?, ?, ?, 1)
       ON CONFLICT(trainer_id, bucket) DO UPDATE SET window_start = excluded.window_start, count = 1`,
    ).run(subject, name, windowStart)
    return
  }

  if (row.count >= bucket.limit) {
    const retryAfter = Math.ceil((windowStart + bucket.windowMs - now) / 1000)
    throw new GameError('rate_limited', { retryAfter, bucket: name }, 429)
  }
  db.prepare('UPDATE rate_limits SET count = count + 1 WHERE trainer_id = ? AND bucket = ?').run(subject, name)
}

export function purgeStaleRateLimits(db: Db, now = Date.now()): number {
  const oldest = now - 3_600_000
  return db.prepare('DELETE FROM rate_limits WHERE window_start < ?').run(oldest).changes
}
