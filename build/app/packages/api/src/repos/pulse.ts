import type { Db } from '../db/index.js'

/**
 * Die Zeitpunkte der letzten Aktionen — die Datengrundlage der Taktkontrolle.
 *
 * Es wird nur der Zeitpunkt gespeichert, nichts sonst. Was jemand getan hat,
 * steht im Ereignisprotokoll; hier geht es ausschliesslich um die Frage, ob das
 * Muster von einer Hand stammt.
 */
export function recent(db: Db, trainerId: string, bucket: string, since: number): number[] {
  const rows = db
    .prepare('SELECT at FROM action_pulse WHERE trainer_id = ? AND bucket = ? AND at > ? ORDER BY at')
    .all(trainerId, bucket, since) as Array<{ at: number }>
  return rows.map((r) => r.at)
}

export function record(db: Db, trainerId: string, bucket: string, at: number): void {
  db.prepare('INSERT INTO action_pulse (trainer_id, bucket, at) VALUES (?, ?, ?)').run(trainerId, bucket, at)
}

/** Alles aelter als das laengste Fenster ist wertlos. Wird stuendlich vom
 *  Scheduler aufgerufen, damit die Tabelle nicht mitwaechst. */
export function purgeStalePulses(db: Db, olderThan: number): number {
  return db.prepare('DELETE FROM action_pulse WHERE at < ?').run(olderThan).changes
}
