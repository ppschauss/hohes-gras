import type { Db } from '../db/index.js'

export interface QuestRow {
  trainerId: string
  periodKey: string
  questId: string
  progress: number
  claimedAt: number | null
}

const COLUMNS = `trainer_id AS trainerId, period_key AS periodKey, quest_id AS questId,
  progress, claimed_at AS claimedAt`

export function of(db: Db, trainerId: string, periodKey: string): QuestRow[] {
  return db.prepare(`SELECT ${COLUMNS} FROM quests WHERE trainer_id = ? AND period_key = ?`)
    .all(trainerId, periodKey) as QuestRow[]
}

export function one(db: Db, trainerId: string, periodKey: string, questId: string): QuestRow | null {
  return (db.prepare(`SELECT ${COLUMNS} FROM quests WHERE trainer_id = ? AND period_key = ? AND quest_id = ?`)
    .get(trainerId, periodKey, questId) as QuestRow | undefined) ?? null
}

export function ensure(db: Db, trainerId: string, periodKey: string, questId: string): void {
  db.prepare('INSERT OR IGNORE INTO quests (trainer_id, period_key, quest_id) VALUES (?, ?, ?)')
    .run(trainerId, periodKey, questId)
}

export function addProgress(db: Db, trainerId: string, periodKey: string, questId: string, amount: number): void {
  db.prepare('UPDATE quests SET progress = progress + ? WHERE trainer_id = ? AND period_key = ? AND quest_id = ?')
    .run(Math.max(0, amount), trainerId, periodKey, questId)
}

/** Abholen. false, wenn schon geschehen oder das Soll nicht erreicht ist —
 *  die Bedingung steht im UPDATE, damit zwei Tipps nicht zweimal zahlen. */
export function claim(db: Db, trainerId: string, periodKey: string, questId: string, target: number, now = Date.now()): boolean {
  return db.prepare(
    `UPDATE quests SET claimed_at = ?
      WHERE trainer_id = ? AND period_key = ? AND quest_id = ? AND claimed_at IS NULL AND progress >= ?`,
  ).run(now, trainerId, periodKey, questId, target).changes === 1
}

/** Aufräumen: was älter ist als die letzten Zeiträume, braucht niemand mehr. */
export function prune(db: Db, keepDailyKeys: string[], keepWeeklyKeys: string[]): void {
  const keep = [...keepDailyKeys, ...keepWeeklyKeys]
  if (keep.length === 0) return
  const marks = keep.map(() => '?').join(', ')
  db.prepare(`DELETE FROM quests WHERE period_key NOT IN (${marks})`).run(...keep)
}
