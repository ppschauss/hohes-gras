import type { Db } from '../db/index.js'
import { newId } from '../db/ids.js'

export interface TeamRow {
  id: string
  trainerId: string
  name: string
  createdAt: number
}

interface Raw { id: string; trainer_id: string; name: string; created_at: number }

const toTeam = (r: Raw): TeamRow => ({
  id: r.id, trainerId: r.trainer_id, name: r.name, createdAt: r.created_at,
})

export function listOf(db: Db, trainerId: string): TeamRow[] {
  const rows = db
    .prepare('SELECT * FROM teams WHERE trainer_id = ? ORDER BY created_at, rowid')
    .all(trainerId) as Raw[]
  return rows.map(toTeam)
}

export function byId(db: Db, id: string): TeamRow | null {
  const row = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as Raw | undefined
  return row ? toTeam(row) : null
}

export function countOf(db: Db, trainerId: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM teams WHERE trainer_id = ?').get(trainerId) as { n: number }).n
}

/** Mitglieder in Slot-Reihenfolge. Geloeschte Kreaturen sind hier schon weg:
 *  team_members haengt per ON DELETE CASCADE an creatures. */
export function membersOf(db: Db, teamId: string): string[] {
  const rows = db
    .prepare('SELECT creature_id AS id FROM team_members WHERE team_id = ? ORDER BY slot')
    .all(teamId) as Array<{ id: string }>
  return rows.map((r) => r.id)
}

export function create(db: Db, trainerId: string, name: string, now = Date.now()): TeamRow {
  const id = newId()
  db.prepare('INSERT INTO teams (id, trainer_id, name, created_at) VALUES (?, ?, ?, ?)')
    .run(id, trainerId, name.slice(0, 24), now)
  return byId(db, id)!
}

export function rename(db: Db, id: string, name: string): void {
  db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name.slice(0, 24), id)
}

export function remove(db: Db, id: string): void {
  db.prepare('DELETE FROM teams WHERE id = ?').run(id)
}

/**
 * Mitglieder komplett neu schreiben.
 *
 * Erst leeren, dann setzen — wie beim Gartenteam: der eindeutige Index auf
 * (team_id, slot) macht ein Umsortieren an Ort und Stelle
 * reihenfolgeabhaengig, und das ist eine Fehlerquelle ohne jeden Gegenwert.
 */
export function setMembers(db: Db, teamId: string, orderedIds: string[]): void {
  db.prepare('DELETE FROM team_members WHERE team_id = ?').run(teamId)
  const stmt = db.prepare('INSERT INTO team_members (team_id, slot, creature_id) VALUES (?, ?, ?)')
  orderedIds.slice(0, 5).forEach((id, index) => stmt.run(teamId, index, id))
}

/** Eine Kreatur aus allen Teams eines Trainers nehmen — beim Freilassen oder
 *  Tauschen. Ohne das bliebe sie als Leiche in einem inaktiven Team stehen. */
export function removeCreature(db: Db, creatureId: string): void {
  db.prepare('DELETE FROM team_members WHERE creature_id = ?').run(creatureId)
}

export function activeIdOf(db: Db, trainerId: string): string | null {
  const row = db.prepare('SELECT active_team_id AS id FROM trainers WHERE id = ?')
    .get(trainerId) as { id: string | null } | undefined
  return row?.id ?? null
}

export function setActive(db: Db, trainerId: string, teamId: string): void {
  db.prepare('UPDATE trainers SET active_team_id = ? WHERE id = ?').run(teamId, trainerId)
}
