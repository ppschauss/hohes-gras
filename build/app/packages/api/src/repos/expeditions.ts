import type { Db } from '../db/index.js'
import { newId } from '../db/ids.js'

export interface Expedition {
  id: string
  trainerId: string
  kind: string
  duration: string
  areaId: string
  party: string[]
  seed: string
  startedAt: number
  endsAt: number
  collectedAt: number | null
}

interface Row {
  id: string; trainer_id: string; kind: string; duration: string; area_id: string
  party: string; seed: string; started_at: number; ends_at: number; collected_at: number | null
}

const toExpedition = (r: Row): Expedition => ({
  id: r.id, trainerId: r.trainer_id, kind: r.kind, duration: r.duration, areaId: r.area_id,
  party: safeParty(r.party), seed: r.seed,
  startedAt: r.started_at, endsAt: r.ends_at, collectedAt: r.collected_at,
})

function safeParty(raw: string): string[] {
  try {
    const v: unknown = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch { return [] }
}

export function openOf(db: Db, trainerId: string): Expedition[] {
  const rows = db
    .prepare('SELECT * FROM expeditions WHERE trainer_id = ? AND collected_at IS NULL ORDER BY ends_at')
    .all(trainerId) as Row[]
  return rows.map(toExpedition)
}

export function byId(db: Db, id: string): Expedition | null {
  const row = db.prepare('SELECT * FROM expeditions WHERE id = ?').get(id) as Row | undefined
  return row ? toExpedition(row) : null
}

/** Creatures currently away. They must not be usable elsewhere at the same
 *  time, or one team could farm every feature simultaneously. */
export function busyCreatureIds(db: Db, trainerId: string): Set<string> {
  const busy = new Set<string>()
  for (const e of openOf(db, trainerId)) for (const id of e.party) busy.add(id)
  return busy
}

export function create(
  db: Db,
  input: Omit<Expedition, 'id' | 'collectedAt'>,
): Expedition {
  const id = newId()
  db.prepare(
    `INSERT INTO expeditions (id, trainer_id, kind, duration, area_id, party, seed, started_at, ends_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.trainerId, input.kind, input.duration, input.areaId,
    JSON.stringify(input.party), input.seed, input.startedAt, input.endsAt)
  return byId(db, id)!
}

/** Mark collected, refusing if someone already did. Returns false on a double
 *  collect, which is the cheap way to make the endpoint idempotent. */
export function markCollected(db: Db, id: string, now = Date.now()): boolean {
  return db
    .prepare('UPDATE expeditions SET collected_at = ? WHERE id = ? AND collected_at IS NULL')
    .run(now, id).changes === 1
}

/** Eine laufende Expedition vorziehen — der Beschleuniger setzt das Ende. */
export function setEndsAt(db: Db, id: string, endsAt: number): void {
  db.prepare('UPDATE expeditions SET ends_at = ? WHERE id = ?').run(endsAt, id)
}
