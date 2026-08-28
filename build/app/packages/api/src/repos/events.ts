import type { Db } from '../db/index.js'

/** Append-only audit trail. Deliberately schema-light: the payload is JSON so a
 *  new feature can log what it needs without a migration, and the DSGVO export
 *  can hand the player everything recorded about them in one query. */
export function logEvent(db: Db, trainerId: string | null, kind: string, payload: Record<string, unknown> = {}, now = Date.now()): void {
  db.prepare('INSERT INTO event_log (trainer_id, at, kind, payload) VALUES (?, ?, ?, ?)')
    .run(trainerId, now, kind, JSON.stringify(payload))
}

export function eventsOf(db: Db, trainerId: string, limit = 500): Array<{ at: number; kind: string; payload: unknown }> {
  const rows = db
    .prepare('SELECT at, kind, payload FROM event_log WHERE trainer_id = ? ORDER BY at DESC LIMIT ?')
    .all(trainerId, limit) as Array<{ at: number; kind: string; payload: string }>
  return rows.map((r) => ({ at: r.at, kind: r.kind, payload: safeParse(r.payload) }))
}

const safeParse = (s: string): unknown => {
  try { return JSON.parse(s) } catch { return s }
}
