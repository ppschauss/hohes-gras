import type { Db } from '../db/index.js'

export interface DexEntry {
  speciesId: string
  seenAt: number | null
  caughtAt: number | null
}

export function markSeen(db: Db, trainerId: string, speciesId: string, now = Date.now()): void {
  db.prepare(
    `INSERT INTO dex_entries (trainer_id, species_id, seen_at) VALUES (?, ?, ?)
     ON CONFLICT(trainer_id, species_id) DO UPDATE SET seen_at = COALESCE(dex_entries.seen_at, excluded.seen_at)`,
  ).run(trainerId, speciesId, now)
}

/** Returns true the first time a species is caught, so the caller can
 *  celebrate a new dex entry rather than every duplicate. */
export function markCaught(db: Db, trainerId: string, speciesId: string, now = Date.now()): boolean {
  const before = db
    .prepare('SELECT caught_at FROM dex_entries WHERE trainer_id = ? AND species_id = ?')
    .get(trainerId, speciesId) as { caught_at: number | null } | undefined
  db.prepare(
    `INSERT INTO dex_entries (trainer_id, species_id, seen_at, caught_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(trainer_id, species_id) DO UPDATE SET
       seen_at = COALESCE(dex_entries.seen_at, excluded.seen_at),
       caught_at = COALESCE(dex_entries.caught_at, excluded.caught_at)`,
  ).run(trainerId, speciesId, now, now)
  return !before?.caught_at
}

/** Liegt die Art schon im Dex? Eine Zeile, weil die Safari sie fuer jede
 *  Begegnung braucht und der ganze Dex dafuer zu viel waere. */
export function isCaught(db: Db, trainerId: string, speciesId: string): boolean {
  const row = db
    .prepare('SELECT caught_at AS caughtAt FROM dex_entries WHERE trainer_id = ? AND species_id = ?')
    .get(trainerId, speciesId) as { caughtAt: number | null } | undefined
  return Boolean(row?.caughtAt)
}

export function dexOf(db: Db, trainerId: string): Map<string, DexEntry> {
  const rows = db
    .prepare('SELECT species_id AS speciesId, seen_at AS seenAt, caught_at AS caughtAt FROM dex_entries WHERE trainer_id = ?')
    .all(trainerId) as DexEntry[]
  return new Map(rows.map((r) => [r.speciesId, r]))
}

export function dexCounts(db: Db, trainerId: string): { seen: number; caught: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS seen, SUM(CASE WHEN caught_at IS NOT NULL THEN 1 ELSE 0 END) AS caught
       FROM dex_entries WHERE trainer_id = ?`,
    )
    .get(trainerId) as { seen: number; caught: number | null }
  return { seen: row.seen, caught: row.caught ?? 0 }
}

/** Count of distinct species caught in one area — the unlock condition the
 *  world map uses ("9/9 gefangen"). */
export function caughtInArea(db: Db, trainerId: string, areaId: string): number {
  const row = db
    .prepare('SELECT COUNT(DISTINCT species_id) AS n FROM creatures WHERE owner_id = ? AND caught_area_id = ?')
    .get(trainerId, areaId) as { n: number }
  return row.n
}

/** Alle Arten, die der Trainer schon gefangen hat. Basis fuer die Frage, ob ein
 *  Gebiet vollstaendig ist. */
export function caughtSpeciesIds(db: Db, trainerId: string): Set<string> {
  const rows = db
    .prepare('SELECT species_id AS s FROM dex_entries WHERE trainer_id = ? AND caught_at IS NOT NULL')
    .all(trainerId) as Array<{ s: string }>
  return new Set(rows.map((r) => r.s))
}
