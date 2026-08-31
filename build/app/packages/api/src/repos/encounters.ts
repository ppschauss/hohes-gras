import type { Db } from '../db/index.js'

export interface ActiveEncounter {
  trainerId: string
  areaId: string
  speciesId: string
  level: number
  shiny: boolean
  turn: number
  /** Wie oft schon geworfen wurde. Nur Wuerfe koennen zur Flucht fuehren. */
  throws: number
  weakenStacks: number
  calmStacks: number
  seed: string
  startedAt: number
  /** Eingesetzte Sagenbeeren — nur bei Legendaeren von Bedeutung. */
  legendaryBerries: number
}

interface Row {
  trainer_id: string; area_id: string; species_id: string; level: number
  shiny: number; turn: number; throws: number; weaken_stacks: number; calm_stacks: number
  seed: string; started_at: number; legendary_berries: number
}

const toEncounter = (r: Row): ActiveEncounter => ({
  trainerId: r.trainer_id, areaId: r.area_id, speciesId: r.species_id, level: r.level,
  shiny: r.shiny === 1, turn: r.turn, throws: r.throws, weakenStacks: r.weaken_stacks,
  calmStacks: r.calm_stacks, seed: r.seed, startedAt: r.started_at,
  legendaryBerries: r.legendary_berries,
})

export function activeOf(db: Db, trainerId: string): ActiveEncounter | null {
  const row = db.prepare('SELECT * FROM active_encounter WHERE trainer_id = ?').get(trainerId) as Row | undefined
  return row ? toEncounter(row) : null
}

export function start(
  db: Db,
  e: Omit<ActiveEncounter, 'turn' | 'throws' | 'weakenStacks' | 'calmStacks' | 'legendaryBerries'>,
): ActiveEncounter {
  // REPLACE rather than INSERT: fleeing is implicit when a new encounter
  // begins, and a stale row must never block the next one.
  db.prepare(
    `INSERT OR REPLACE INTO active_encounter
       (trainer_id, area_id, species_id, level, shiny, turn, weaken_stacks, calm_stacks, seed, started_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?)`,
  ).run(e.trainerId, e.areaId, e.speciesId, e.level, e.shiny ? 1 : 0, e.seed, e.startedAt)
  return activeOf(db, e.trainerId)!
}

export function bumpTurn(db: Db, trainerId: string): void {
  db.prepare('UPDATE active_encounter SET turn = turn + 1 WHERE trainer_id = ?').run(trainerId)
}

/** Ein Wurf. Zaehlt getrennt von der Runde, weil nur Wuerfe zur Flucht fuehren. */
export function bumpThrows(db: Db, trainerId: string): void {
  db.prepare('UPDATE active_encounter SET throws = throws + 1, turn = turn + 1 WHERE trainer_id = ?')
    .run(trainerId)
}

export function addStack(db: Db, trainerId: string, kind: 'weaken' | 'calm', max: number): void {
  const column = kind === 'weaken' ? 'weaken_stacks' : 'calm_stacks'
  db.prepare(`UPDATE active_encounter SET ${column} = MIN(${column} + 1, ?) WHERE trainer_id = ?`)
    .run(max, trainerId)
}

/** Eine Sagenbeere einsetzen. Gibt false zurueck, wenn schon das Maximum
 *  erreicht ist — die Bedingung steht im UPDATE, damit zwei schnelle Tipps
 *  nicht vier Beeren verbrauchen. */
export function addLegendaryBerry(db: Db, trainerId: string, max: number): boolean {
  return db
    .prepare('UPDATE active_encounter SET legendary_berries = legendary_berries + 1 WHERE trainer_id = ? AND legendary_berries < ?')
    .run(trainerId, max).changes === 1
}

export function clear(db: Db, trainerId: string): void {
  db.prepare('DELETE FROM active_encounter WHERE trainer_id = ?').run(trainerId)
}
