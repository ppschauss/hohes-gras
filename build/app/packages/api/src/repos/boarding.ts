import type { Db } from '../db/index.js'
import { newId } from '../db/ids.js'

export interface BoardingRow {
  id: string
  trainerId: string
  creatureId: string
  levelAtStart: number
  startedAt: number
  readyAt: number
}

const COLUMNS = `id, trainer_id AS trainerId, creature_id AS creatureId,
  level_at_start AS levelAtStart, started_at AS startedAt, ready_at AS readyAt`

export function of(db: Db, trainerId: string): BoardingRow[] {
  return db.prepare(`SELECT ${COLUMNS} FROM boarding WHERE trainer_id = ? ORDER BY started_at`)
    .all(trainerId) as BoardingRow[]
}

export function byId(db: Db, id: string): BoardingRow | null {
  return (db.prepare(`SELECT ${COLUMNS} FROM boarding WHERE id = ?`).get(id) as BoardingRow | undefined) ?? null
}

/** Wer gerade in Pension ist — die kaempfen, reisen und forschen nicht. */
export function busyCreatures(db: Db, trainerId: string): Set<string> {
  const rows = db.prepare('SELECT creature_id AS id FROM boarding WHERE trainer_id = ?')
    .all(trainerId) as Array<{ id: string }>
  return new Set(rows.map((r) => r.id))
}

export function add(db: Db, r: Omit<BoardingRow, 'id'>): BoardingRow {
  const id = newId()
  db.prepare(
    `INSERT INTO boarding (id, trainer_id, creature_id, level_at_start, started_at, ready_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, r.trainerId, r.creatureId, r.levelAtStart, r.startedAt, r.readyAt)
  return byId(db, id)!
}

/** Abholen. false, wenn schon jemand schneller war. */
export function remove(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM boarding WHERE id = ?').run(id).changes > 0
}
