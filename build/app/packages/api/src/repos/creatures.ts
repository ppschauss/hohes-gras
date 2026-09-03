import type { OwnedCreature, StatBlock } from '@game/shared'
import type { Db } from '../db/index.js'
import * as acquisitions from './acquisitions.js'
import type { Herkunft } from './acquisitions.js'
import { newId } from '../db/ids.js'

interface CreatureRow {
  id: string; owner_id: string; species_id: string; nickname: string | null
  xp: number; level: number; nature: string
  iv_hp: number; iv_atk: number; iv_def: number; iv_spa: number; iv_spd: number; iv_spe: number
  ev_hp: number; ev_atk: number; ev_def: number; ev_spa: number; ev_spd: number; ev_spe: number
  friendship: number; energy: number; hp_current: number; shiny: number; iv_caps: number
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
  ivCaps: r.iv_caps ?? 0,
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

/**
 * Ein neues Pokemon anlegen.
 *
 * `herkunft` ist Pflicht: sieben Wege fuehren hierher — Fang, Ei, Starter,
 * Tausch, Raid, Ereignis, Verwertung —, und nach dem Mewtu-Vorfall stand
 * genau die Frage im Raum, welche Zeilen in dieser Tabelle aus welchem
 * stammen. Das Ereignisprotokoll konnte sie nicht beantworten; der Beleg,
 * den diese Funktion schreibt, kann es.
 */
export function insertCreature(
  db: Db, c: NewCreature, herkunft: Herkunft, now = Date.now(),
): OwnedCreature {
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
  acquisitions.record(db, c.ownerId, herkunft, 'creature', id, 1, {
    speciesId: c.speciesId, level: c.level, shiny: c.shiny,
  }, now)
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

/**
 * Alles, was in der Box liegt — ohne stille Obergrenze.
 *
 * `boxOf` hat eine Vorgabe von 200, und die war jahrelang unauffaellig, weil
 * niemand so viele hatte. Gemeldet wurde sie als "mein shiny seemon ist weg":
 * bei 271 Pokemon in der Box fielen 71 aus der Liste, sortiert nach Level
 * absteigend — und damit ausgerechnet die niedrigstufigen Schillernden, die
 * man aufhebt statt sie hochzuziehen. Dreizehn von siebzehn waren unsichtbar.
 *
 * Wer eine Grenze *will* — eine Vorschau, eine Auswahl —, setzt sie weiter
 * selbst. Wer alles zeigen will, sagt das hiermit, statt sich auf eine
 * Vorgabe zu verlassen, die er nicht sieht.
 */
export function allBoxOf(db: Db, ownerId: string): OwnedCreature[] {
  return boxOf(db, ownerId, countOwned(db, ownerId).total)
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

/**
 * Energie der eingelagerten Kreaturen anheben.
 *
 * Als eine Anweisung und nicht als Schleife: eine ausgebaute Box fasst
 * ueber tausend Kreaturen, und das hier laeuft bei jedem Blick in den Garten.
 */
export function regenerateBoxEnergy(db: Db, ownerId: string, gain: number, max: number): number {
  if (gain <= 0) return 0
  return db.prepare(
    `UPDATE creatures SET energy = MIN(?, energy + ?)
      WHERE owner_id = ? AND team_slot IS NULL AND energy < ?`,
  ).run(max, Math.floor(gain), ownerId, max).changes
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

/** EP und Level setzen — für Bonbons und alles, was ausserhalb eines Kampfes
 *  Erfahrung gibt. */
/** Fleisspunkte setzen. Es gab dafuer nie einen Weg — sie standen bei jedem
 *  Pokemon auf null, obwohl die Werteformel sie laengst liest. */
/**
 * Anlagen setzen.
 *
 * Der einzige Weg, an ihnen zu drehen, nachdem ein Pokemon entstanden ist —
 * das Erbgut-Serum. Sonst stehen sie vom ersten Augenblick an fest, und genau
 * das macht sie zu dem, was man an einem Pokemon sammelt.
 */
export function setIvs(db: Db, creatureId: string, ivs: StatBlock): void {
  db.prepare(
    'UPDATE creatures SET iv_hp = ?, iv_atk = ?, iv_def = ?, iv_spa = ?, iv_spd = ?, iv_spe = ? WHERE id = ?',
  ).run(ivs.hp, ivs.atk, ivs.def, ivs.spa, ivs.spd, ivs.spe, creatureId)
}

/** Einen verbrauchten Kronkorken vermerken. */
export function bumpIvCaps(db: Db, creatureId: string): void {
  db.prepare('UPDATE creatures SET iv_caps = iv_caps + 1 WHERE id = ?').run(creatureId)
}

export function setEvs(db: Db, creatureId: string, evs: StatBlock): void {
  db.prepare(
    'UPDATE creatures SET ev_hp = ?, ev_atk = ?, ev_def = ?, ev_spa = ?, ev_spd = ?, ev_spe = ? WHERE id = ?',
  ).run(evs.hp, evs.atk, evs.def, evs.spa, evs.spd, evs.spe, creatureId)
}

export function setXp(db: Db, creatureId: string, xp: number, level: number): void {
  db.prepare('UPDATE creatures SET xp = ?, level = ? WHERE id = ?').run(xp, level, creatureId)
}
