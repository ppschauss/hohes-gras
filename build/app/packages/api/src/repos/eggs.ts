import type { Nature, StatBlock } from '@game/shared'
import type { Db } from '../db/index.js'
import { newId } from '../db/ids.js'

export interface Egg {
  id: string
  trainerId: string
  speciesId: string
  nature: Nature
  ivs: StatBlock
  shiny: boolean
  hatchMinutes: number
  startedAt: number
  hatchedAt: number | null
  parentA: string | null
  parentB: string | null
  /** Erledigte Pflegeschritte im Brut-Beet. */
  phasesDone: number
  /** Das Pokemon, das sich automatisch kuemmert. */
  brooderId: string | null
}

interface Row {
  id: string; trainer_id: string; species_id: string; nature: string
  iv_hp: number; iv_atk: number; iv_def: number; iv_spa: number; iv_spd: number; iv_spe: number
  shiny: number; hatch_minutes: number; started_at: number; hatched_at: number | null
  parent_a: string | null; parent_b: string | null
  phases_done: number; brooder_id: string | null
}

const toEgg = (r: Row): Egg => ({
  id: r.id, trainerId: r.trainer_id, speciesId: r.species_id, nature: r.nature as Nature,
  ivs: { hp: r.iv_hp, atk: r.iv_atk, def: r.iv_def, spa: r.iv_spa, spd: r.iv_spd, spe: r.iv_spe },
  shiny: r.shiny === 1, hatchMinutes: r.hatch_minutes,
  startedAt: r.started_at, hatchedAt: r.hatched_at,
  parentA: r.parent_a, parentB: r.parent_b,
  phasesDone: r.phases_done, brooderId: r.brooder_id,
})

export const MAX_OPEN_EGGS = 3

export function openOf(db: Db, trainerId: string): Egg[] {
  const rows = db
    .prepare('SELECT * FROM eggs WHERE trainer_id = ? AND hatched_at IS NULL ORDER BY started_at')
    .all(trainerId) as Row[]
  return rows.map(toEgg)
}

export function byId(db: Db, id: string): Egg | null {
  const row = db.prepare('SELECT * FROM eggs WHERE id = ?').get(id) as Row | undefined
  return row ? toEgg(row) : null
}

export function create(db: Db, egg: Omit<Egg, 'id' | 'hatchedAt' | 'phasesDone' | 'brooderId'>): Egg {
  const id = newId()
  db.prepare(
    `INSERT INTO eggs (id, trainer_id, species_id, nature, iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe,
                       shiny, hatch_minutes, started_at, parent_a, parent_b)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, egg.trainerId, egg.speciesId, egg.nature,
    egg.ivs.hp, egg.ivs.atk, egg.ivs.def, egg.ivs.spa, egg.ivs.spd, egg.ivs.spe,
    egg.shiny ? 1 : 0, egg.hatchMinutes, egg.startedAt, egg.parentA, egg.parentB)
  return byId(db, id)!
}

/** Einen Pflegeschritt eintragen. Bedingt auf den erwarteten Stand, damit
 *  zwei schnelle Tipps nicht zwei Schritte werden. */
export function tend(db: Db, id: string, from: number): boolean {
  return db.prepare('UPDATE eggs SET phases_done = ? WHERE id = ? AND phases_done = ?')
    .run(from + 1, id, from).changes === 1
}

export function setBrooder(db: Db, id: string, creatureId: string | null): void {
  db.prepare('UPDATE eggs SET brooder_id = ? WHERE id = ?').run(creatureId, id)
}

/** Wer gerade ein Ei waermt — die stehen fuer nichts anderes zur Verfuegung. */
export function brooders(db: Db, trainerId: string): Set<string> {
  const rows = db.prepare(
    'SELECT brooder_id AS id FROM eggs WHERE trainer_id = ? AND hatched_at IS NULL AND brooder_id IS NOT NULL',
  ).all(trainerId) as Array<{ id: string }>
  return new Set(rows.map((r) => r.id))
}

export function markHatched(db: Db, id: string, now = Date.now()): boolean {
  return db.prepare('UPDATE eggs SET hatched_at = ? WHERE id = ? AND hatched_at IS NULL')
    .run(now, id).changes === 1
}
