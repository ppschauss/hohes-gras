import type { Db } from '../db/index.js'
import { newId } from '../db/ids.js'

export interface CenterOfferRow {
  id: string
  trainerId: string
  npcName: string
  wantedSpeciesId: string
  offeredSpeciesId: string
  offeredLevel: number
  offeredShiny: boolean
  seed: string
  createdAt: number
  expiresAt: number
  resolvedAt: number | null
  accepted: boolean
}

interface Raw {
  id: string; trainer_id: string; npc_name: string
  wanted_species_id: string; offered_species_id: string
  offered_level: number; offered_shiny: number; seed: string
  created_at: number; expires_at: number; resolved_at: number | null; accepted: number
}

const toOffer = (r: Raw): CenterOfferRow => ({
  id: r.id, trainerId: r.trainer_id, npcName: r.npc_name,
  wantedSpeciesId: r.wanted_species_id, offeredSpeciesId: r.offered_species_id,
  offeredLevel: r.offered_level, offeredShiny: r.offered_shiny === 1, seed: r.seed,
  createdAt: r.created_at, expiresAt: r.expires_at,
  resolvedAt: r.resolved_at, accepted: r.accepted === 1,
})

/** Das offene Angebot eines Trainers. Es gibt hoechstens eines: ein zweiter
 *  Besuch mit Tausch-Ereignis loest das alte ab. */
export function openOf(db: Db, trainerId: string, now = Date.now()): CenterOfferRow | null {
  const row = db
    .prepare(
      `SELECT * FROM center_offers
       WHERE trainer_id = ? AND resolved_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(trainerId, now) as Raw | undefined
  return row ? toOffer(row) : null
}

export function byId(db: Db, id: string): CenterOfferRow | null {
  const row = db.prepare('SELECT * FROM center_offers WHERE id = ?').get(id) as Raw | undefined
  return row ? toOffer(row) : null
}

export function create(
  db: Db,
  input: Omit<CenterOfferRow, 'id' | 'resolvedAt' | 'accepted'>,
): CenterOfferRow {
  // Ein aelteres Angebot verfaellt: zwei gleichzeitig waeren im UI nicht
  // unterscheidbar und im Zweifel widerspruechlich.
  db.prepare('UPDATE center_offers SET resolved_at = ? WHERE trainer_id = ? AND resolved_at IS NULL')
    .run(input.createdAt, input.trainerId)

  const id = newId()
  db.prepare(
    `INSERT INTO center_offers (id, trainer_id, npc_name, wanted_species_id, offered_species_id,
                                offered_level, offered_shiny, seed, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.trainerId, input.npcName, input.wantedSpeciesId, input.offeredSpeciesId,
    input.offeredLevel, input.offeredShiny ? 1 : 0, input.seed, input.createdAt, input.expiresAt)
  return byId(db, id)!
}

/** Abschliessen, und zwar genau einmal: bei einem Doppeltipp gewinnt der erste
 *  Aufruf, der zweite bekommt `false` und damit eine ehrliche Fehlermeldung. */
export function resolve(db: Db, id: string, accepted: boolean, now = Date.now()): boolean {
  return db
    .prepare('UPDATE center_offers SET resolved_at = ?, accepted = ? WHERE id = ? AND resolved_at IS NULL')
    .run(now, accepted ? 1 : 0, id).changes === 1
}

export function lastVisit(db: Db, trainerId: string): number {
  const row = db.prepare('SELECT center_used_at AS at FROM trainers WHERE id = ?')
    .get(trainerId) as { at: number } | undefined
  return row?.at ?? 0
}

/** Besuch verbuchen — nur, wenn die Abklingzeit wirklich abgelaufen ist. Die
 *  Bedingung steht im UPDATE, damit zwei gleichzeitige Anfragen nicht beide
 *  heilen. */
export function markVisited(db: Db, trainerId: string, now: number, notBefore: number): boolean {
  return db
    .prepare('UPDATE trainers SET center_used_at = ? WHERE id = ? AND center_used_at <= ?')
    .run(now, trainerId, notBefore).changes === 1
}
