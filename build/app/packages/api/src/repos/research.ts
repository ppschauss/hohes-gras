import type { Db } from '../db/index.js'
import { newId } from '../db/ids.js'

export interface ResearchRow {
  id: string
  trainerId: string
  projectId: string
  tier: number
  creatureId: string | null
  stat: string | null
  startedAt: number
  readyAt: number
  claimedAt: number | null
}

const COLUMNS = `id, trainer_id AS trainerId, project_id AS projectId, tier,
  creature_id AS creatureId, stat, started_at AS startedAt, ready_at AS readyAt,
  claimed_at AS claimedAt`

export function runningOf(db: Db, trainerId: string): ResearchRow[] {
  return db.prepare(
    `SELECT ${COLUMNS} FROM research WHERE trainer_id = ? AND claimed_at IS NULL ORDER BY ready_at`,
  ).all(trainerId) as ResearchRow[]
}

/** Was fertig erforscht ist, als Projekt-Id → hoechste Stufe. */
export function doneOf(db: Db, trainerId: string): Map<string, number> {
  const rows = db.prepare(
    'SELECT project_id AS p, MAX(tier) AS t FROM research WHERE trainer_id = ? AND claimed_at IS NOT NULL GROUP BY project_id',
  ).all(trainerId) as Array<{ p: string; t: number }>
  return new Map(rows.map((r) => [r.p, r.t]))
}

export function byId(db: Db, id: string): ResearchRow | null {
  return (db.prepare(`SELECT ${COLUMNS} FROM research WHERE id = ?`).get(id) as ResearchRow | undefined) ?? null
}

/** Kreaturen, die gerade im Labor stehen — sie kaempfen und reisen nicht. */
export function busyCreatures(db: Db, trainerId: string): Set<string> {
  const rows = db.prepare(
    'SELECT creature_id AS id FROM research WHERE trainer_id = ? AND claimed_at IS NULL AND creature_id IS NOT NULL',
  ).all(trainerId) as Array<{ id: string }>
  return new Set(rows.map((r) => r.id))
}

export function start(db: Db, r: Omit<ResearchRow, 'id' | 'claimedAt'>): ResearchRow {
  const id = newId()
  db.prepare(
    `INSERT INTO research (id, trainer_id, project_id, tier, creature_id, stat, started_at, ready_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, r.trainerId, r.projectId, r.tier, r.creatureId, r.stat, r.startedAt, r.readyAt)
  return byId(db, id)!
}

/** Abschliessen. Gibt false zurueck, wenn schon jemand anderes schneller war —
 *  die Schranke gegen doppeltes Auszahlen. */
export function claim(db: Db, id: string, now: number): boolean {
  return db.prepare('UPDATE research SET claimed_at = ? WHERE id = ? AND claimed_at IS NULL')
    .run(now, id).changes > 0
}

export function cancel(db: Db, id: string): void {
  db.prepare('DELETE FROM research WHERE id = ? AND claimed_at IS NULL').run(id)
}
