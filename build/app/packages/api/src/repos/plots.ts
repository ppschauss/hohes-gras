import type { Db } from '../db/index.js'
import { newId } from '../db/ids.js'

export interface PlotRow {
  id: string
  trainerId: string
  slot: number
  stakeKind: 'item' | 'gold'
  itemId: string | null
  amount: number
  plantedAt: number
  readyAt: number
  phasesDone: number
  tenderId: string | null
  /** Der beim Pflanzen eingesetzte Duenger; null, wenn ohne. */
  fertiliserId: string | null
  harvestedAt: number | null
}

interface Raw {
  id: string; trainer_id: string; slot: number; stake_kind: string; item_id: string | null
  amount: number; planted_at: number; ready_at: number; phases_done: number
  tender_id: string | null; fertiliser_id: string | null; harvested_at: number | null
}

const toPlot = (r: Raw): PlotRow => ({
  id: r.id, trainerId: r.trainer_id, slot: r.slot,
  stakeKind: r.stake_kind === 'gold' ? 'gold' : 'item',
  itemId: r.item_id, amount: r.amount,
  plantedAt: r.planted_at, readyAt: r.ready_at, phasesDone: r.phases_done,
  tenderId: r.tender_id, fertiliserId: r.fertiliser_id, harvestedAt: r.harvested_at,
})

export function openOf(db: Db, trainerId: string): PlotRow[] {
  const rows = db
    .prepare('SELECT * FROM garden_plots WHERE trainer_id = ? AND harvested_at IS NULL ORDER BY slot')
    .all(trainerId) as Raw[]
  return rows.map(toPlot)
}

export function atSlot(db: Db, trainerId: string, slot: number): PlotRow | null {
  const row = db
    .prepare('SELECT * FROM garden_plots WHERE trainer_id = ? AND slot = ? AND harvested_at IS NULL')
    .get(trainerId, slot) as Raw | undefined
  return row ? toPlot(row) : null
}

export function create(db: Db, input: Omit<PlotRow, 'id' | 'harvestedAt' | 'phasesDone'>): PlotRow {
  const id = newId()
  db.prepare(
    `INSERT INTO garden_plots (id, trainer_id, slot, stake_kind, item_id, amount,
                               planted_at, ready_at, tender_id, fertiliser_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.trainerId, input.slot, input.stakeKind, input.itemId, input.amount,
    input.plantedAt, input.readyAt, input.tenderId, input.fertiliserId)
  return atSlot(db, input.trainerId, input.slot)!
}

/** Einen Pflegeschritt verbuchen — nur, wenn wirklich einer offen ist. Die
 *  Bedingung steht im UPDATE, damit zwei schnelle Tipps nicht doppelt zaehlen. */
export function tend(db: Db, plotId: string, expectedDone: number): boolean {
  return db
    .prepare('UPDATE garden_plots SET phases_done = phases_done + 1 WHERE id = ? AND phases_done = ? AND harvested_at IS NULL')
    .run(plotId, expectedDone).changes === 1
}

export function setTender(db: Db, plotId: string, tenderId: string | null): void {
  db.prepare('UPDATE garden_plots SET tender_id = ? WHERE id = ?').run(tenderId, plotId)
}

/** Genau einmal ernten. Ein zweiter Aufruf findet die Markierung gesetzt. */
export function markHarvested(db: Db, plotId: string, now: number): boolean {
  return db
    .prepare('UPDATE garden_plots SET harvested_at = ? WHERE id = ? AND harvested_at IS NULL')
    .run(now, plotId).changes === 1
}

/**
 * Wann zuletzt Gold vergraben wurde — auch wenn das Beet laengst geerntet ist.
 *
 * Die Zeile bleibt nach der Ernte stehen, deshalb braucht die Tagessperre
 * keine eigene Spalte: die Pflanzung selbst ist der Zeitstempel.
 */
export function lastGoldPlantAt(db: Db, trainerId: string): number | null {
  const row = db
    .prepare("SELECT MAX(planted_at) AS at FROM garden_plots WHERE trainer_id = ? AND stake_kind = 'gold'")
    .get(trainerId) as { at: number | null } | undefined
  return row?.at ?? null
}

/** Kreaturen, die gerade ein Beet pflegen. Sie duerfen nicht gleichzeitig
 *  woanders eingeteilt sein. */
export function busyTenderIds(db: Db, trainerId: string): Set<string> {
  const rows = db
    .prepare('SELECT tender_id AS id FROM garden_plots WHERE trainer_id = ? AND harvested_at IS NULL AND tender_id IS NOT NULL')
    .all(trainerId) as Array<{ id: string }>
  return new Set(rows.map((r) => r.id))
}
