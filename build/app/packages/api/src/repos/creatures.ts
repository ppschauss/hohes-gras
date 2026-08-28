import type { OwnedCreature } from '@game/shared'
import type { Db } from '../db/index.js'
import { newId } from '../db/ids.js'

interface CreatureRow {
  id: string; owner_id: string; species_id: string; nickname: string | null
  xp: number; level: number; nature: string
  iv_hp: number; iv_atk: number; iv_def: number; iv_spa: number; iv_spd: number; iv_spe: number
  ev_hp: number; ev_atk: number; ev_def: number; ev_spa: number; ev_spd: number; ev_spe: number
  friendship: number; energy: number; hp_current: number; shiny: number
  moves: string; held_item: string | null
  caught_at: number; caught_area_id: string | null; team_slot: number | null
}

const toCreature = (r: CreatureRow): OwnedCreature => ({
  id: r.id,
  ownerId: r.owner_id,
  speciesId: r.species_id,
  nickname: r.nickname,
  level: r.level,
  xp: r.xp,
  nature: r.nature as OwnedCreature['nature'],
  ivs: { hp: r.iv_hp, atk: r.iv_atk, def: r.iv_def, spa: r.iv_spa, spd: r.iv_spd, spe: r.iv_spe },
  evs: { hp: r.ev_hp, atk: r.ev_atk, def: r.ev_def, spa: r.ev_spa, spd: r.ev_spd, spe: r.ev_spe },
  friendship: r.friendship,
  energy: r.energy,
  hpCurrent: r.hp_current,
  shiny: r.shiny === 1,
  moves: safeMoves(r.moves),
  heldItem: r.held_item,
  caughtAt: r.caught_at,
  caughtAreaId: r.caught_area_id,
  teamSlot: r.team_slot,
})

/** Moves are stored as a JSON array. A corrupted row must not take down the
 *  whole garden, so a bad value degrades to "no moves" instead of throwing. */
function safeMoves(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((m): m is string => typeof m === 'string').slice(0, 4) : []
  } catch {
    return []
  }
}

export interface NewCreature {
  ownerId: string
  speciesId: string
  level: number
  xp: number
  nature: string
  ivs: Record<string, number>
  friendship: number
  hpCurrent: number
  shiny: boolean
  moves: string[]
  caughtAreaId: string | null
  teamSlot: number | null
}

export function insertCreature(db: Db, c: NewCreature, now = Date.now()): OwnedCreature {
  const id = newId()
  db.prepare(
    `INSERT INTO creatures (
       id, owner_id, species_id, xp, level, nature,
       iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe,
       friendship, energy, hp_current, shiny, moves, caught_at, caught_area_id, team_slot
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, c.ownerId, c.speciesId, c.xp, c.level, c.nature,
    c.ivs.hp, c.ivs.atk, c.ivs.def, c.ivs.spa, c.ivs.spd, c.ivs.spe,
    c.friendship, 100, c.hpCurrent, c.shiny ? 1 : 0,
    JSON.stringify(c.moves.slice(0, 4)), now, c.caughtAreaId, c.teamSlot,
  )
  return byId(db, id)!
}

export function byId(db: Db, id: string): OwnedCreature | null {
  const row = db.prepare('SELECT * FROM creatures WHERE id = ?').get(id) as CreatureRow | undefined
  return row ? toCreature(row) : null
}

export function teamOf(db: Db, ownerId: string): OwnedCreature[] {
  const rows = db
    .prepare('SELECT * FROM creatures WHERE owner_id = ? AND team_slot IS NOT NULL ORDER BY team_slot')
    .all(ownerId) as CreatureRow[]
  return rows.map(toCreature)
}

export function boxOf(db: Db, ownerId: string, limit = 200, offset = 0): OwnedCreature[] {
  const rows = db
    .prepare(
      `SELECT * FROM creatures WHERE owner_id = ? AND team_slot IS NULL
       ORDER BY level DESC, caught_at DESC LIMIT ? OFFSET ?`,
    )
    .all(ownerId, limit, offset) as CreatureRow[]
  return rows.map(toCreature)
}

export function countOwned(db: Db, ownerId: string): { total: number; inTeam: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN team_slot IS NOT NULL THEN 1 ELSE 0 END) AS inTeam
       FROM creatures WHERE owner_id = ?`,
    )
    .get(ownerId) as { total: number; inTeam: number | null }
  return { total: row.total, inTeam: row.inTeam ?? 0 }
}

export function applyCareResult(
  db: Db,
  updates: Array<{ creatureId: string; xp: number; level: number; friendship: number; energy: number }>,
): void {
  const stmt = db.prepare('UPDATE creatures SET xp = ?, level = ?, friendship = ?, energy = ? WHERE id = ?')
  for (const u of updates) stmt.run(u.xp, u.level, u.friendship, u.energy, u.creatureId)
}

export function setHp(db: Db, creatureId: string, hp: number): void {
  db.prepare('UPDATE creatures SET hp_current = ? WHERE id = ?').run(Math.max(0, Math.floor(hp)), creatureId)
}

export function setMoves(db: Db, creatureId: string, moves: string[]): void {
  db.prepare('UPDATE creatures SET moves = ? WHERE id = ?').run(JSON.stringify(moves.slice(0, 4)), creatureId)
}

export function setNickname(db: Db, creatureId: string, nickname: string | null): void {
  db.prepare('UPDATE creatures SET nickname = ? WHERE id = ?').run(nickname?.slice(0, 24) ?? null, creatureId)
}

export function evolveTo(db: Db, creatureId: string, speciesId: string): void {
  db.prepare('UPDATE creatures SET species_id = ? WHERE id = ?').run(speciesId, creatureId)
}

/**
 * Rewrite the whole team in one statement pass.
 *
 * The unique index on (owner_id, team_slot) makes a naive "set A to 0, set B to
 * 1" order-dependent and prone to transient collisions. Clearing every slot
 * first and then assigning avoids that without needing a deferred constraint.
 */
export function setTeam(db: Db, ownerId: string, orderedIds: string[]): void {
  db.prepare('UPDATE creatures SET team_slot = NULL WHERE owner_id = ?').run(ownerId)
  const stmt = db.prepare('UPDATE creatures SET team_slot = ? WHERE id = ? AND owner_id = ?')
  orderedIds.slice(0, 5).forEach((id, index) => stmt.run(index, id, ownerId))
}

export function release(db: Db, creatureId: string, ownerId: string): boolean {
  return db.prepare('DELETE FROM creatures WHERE id = ? AND owner_id = ?').run(creatureId, ownerId).changes > 0
}

export function ownedSpeciesIds(db: Db, ownerId: string): Set<string> {
  const rows = db.prepare('SELECT DISTINCT species_id AS s FROM creatures WHERE owner_id = ?').all(ownerId) as Array<{ s: string }>
  return new Set(rows.map((r) => r.s))
}
