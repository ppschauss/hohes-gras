import type { Db } from '../db/index.js'

/**
 * Das Teamniveau beim ersten Betreten einer Region.
 *
 * Der einzige Zweck: den Regionsversatz einzufrieren. Alles andere an der
 * Skalierung ist abgeleitet und braucht keinen Speicher — das hier lässt sich
 * nicht ableiten, weil es ein vergangener Zustand ist.
 */
export function entryReference(db: Db, trainerId: string, regionId: string): number | null {
  const row = db
    .prepare('SELECT reference_level AS ref FROM region_entries WHERE trainer_id = ? AND region_id = ?')
    .get(trainerId, regionId) as { ref: number } | undefined
  return row?.ref ?? null
}

/** Erster Eintrag gewinnt: ein zweiter Besuch verschiebt nichts mehr. */
export function recordEntry(
  db: Db, trainerId: string, regionId: string, reference: number, now = Date.now(),
): void {
  db.prepare(
    `INSERT OR IGNORE INTO region_entries (trainer_id, region_id, reference_level, entered_at)
     VALUES (?, ?, ?, ?)`,
  ).run(trainerId, regionId, Math.max(0, Math.floor(reference)), now)
}

export function entriesOf(db: Db, trainerId: string): Map<string, number> {
  const rows = db
    .prepare('SELECT region_id AS id, reference_level AS ref FROM region_entries WHERE trainer_id = ?')
    .all(trainerId) as Array<{ id: string; ref: number }>
  return new Map(rows.map((r) => [r.id, r.ref]))
}
