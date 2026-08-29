import type { BattleEvent, BattleState } from '@game/engine'
import type { Db } from '../db/index.js'
import { newId } from '../db/ids.js'

export interface BattleRecord {
  id: string
  trainerId: string
  kind: string
  opponentId: string | null
  areaId: string | null
  seed: string
  state: BattleState
  events: BattleEvent[]
  startedAt: number
  finishedAt: number | null
  winner: number | null
  rewarded: boolean
  /**
   * Der Gegner, wenn er in keinem Pack steht.
   *
   * Arenakaempfe erzeugen ihre Gegner aus Typ des Tages und eigenem
   * Durchschnittslevel. Ohne diese Kopie waere der Gegner nach dem Neuladen
   * unbekannt — und ein unbekannter Gegner zahlt keine Belohnung aus.
   */
  opponentDef: string | null
}

interface Row {
  id: string; trainer_id: string; kind: string; opponent_id: string | null
  area_id: string | null; seed: string; state: string; events: string
  started_at: number; finished_at: number | null; winner: number | null; rewarded: number
  opponent_def: string | null
}

const toRecord = (r: Row): BattleRecord => ({
  id: r.id, trainerId: r.trainer_id, kind: r.kind, opponentId: r.opponent_id,
  areaId: r.area_id, seed: r.seed,
  state: JSON.parse(r.state) as BattleState,
  events: JSON.parse(r.events) as BattleEvent[],
  startedAt: r.started_at, finishedAt: r.finished_at,
  winner: r.winner, rewarded: r.rewarded === 1,
  opponentDef: r.opponent_def,
})

/**
 * Wie lange ein unberührter Kampf offen bleibt.
 *
 * Ein Kampf ist rundenbasiert und wartet geduldig — aber nicht ewig. Wer die
 * App mitten im Kampf schließt, hat sonst für immer einen laufenden Kampf, und
 * *alles*, was "läuft gerade ein Kampf?" prüft, sagt nein: Heilen im Center,
 * der nächste Überfall, der nächste Arenaleiter. Genau das ist passiert — ein
 * Kampf von 13:06 blockierte sechs Stunden später noch das Heilen.
 *
 * Zwei Stunden sind großzügig genug für eine Pause und kurz genug, dass ein
 * vergessener Kampf niemanden aussperrt.
 */
export const BATTLE_ABANDON_MS = 2 * 60 * 60 * 1000

export function activeOf(db: Db, trainerId: string, now = Date.now()): BattleRecord | null {
  const row = db
    .prepare('SELECT * FROM battles WHERE trainer_id = ? AND finished_at IS NULL ORDER BY started_at DESC LIMIT 1')
    .get(trainerId) as Row | undefined
  if (!row) return null
  if (now - row.started_at > BATTLE_ABANDON_MS) {
    // Aufgeben ohne Strafe: wer nicht zurückkommt, hat auch nicht verloren.
    abandon(db, row.id, now)
    return null
  }
  return toRecord(row)
}

/** Einen offenen Kampf schließen, ohne Sieger und ohne Belohnung. */
export function abandon(db: Db, battleId: string, now = Date.now()): void {
  // winner bleibt NULL: der Kampf ist beendet, aber niemand hat gewonnen.
  db.prepare('UPDATE battles SET finished_at = ? WHERE id = ? AND finished_at IS NULL')
    .run(now, battleId)
}

/** Alle vergessenen Kämpfe schließen; stündlich vom Scheduler. */
export function abandonStale(db: Db, now = Date.now()): number {
  return db.prepare(
    'UPDATE battles SET finished_at = ? WHERE finished_at IS NULL AND started_at < ?',
  ).run(now, now - BATTLE_ABANDON_MS).changes
}

export function byId(db: Db, id: string): BattleRecord | null {
  const row = db.prepare('SELECT * FROM battles WHERE id = ?').get(id) as Row | undefined
  return row ? toRecord(row) : null
}

export function create(db: Db, input: {
  trainerId: string; kind: string; opponentId: string | null; areaId: string | null
  seed: string; state: BattleState; opponentDef?: unknown
}, now = Date.now()): BattleRecord {
  const id = newId()
  db.prepare(
    `INSERT INTO battles (id, trainer_id, kind, opponent_id, area_id, seed, state, events, started_at, opponent_def)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', ?, ?)`,
  ).run(id, input.trainerId, input.kind, input.opponentId, input.areaId, input.seed,
    JSON.stringify(input.state), now,
    input.opponentDef === undefined ? null : JSON.stringify(input.opponentDef))
  return byId(db, id)!
}

export function update(db: Db, id: string, state: BattleState, events: BattleEvent[]): void {
  db.prepare('UPDATE battles SET state = ?, events = ? WHERE id = ?')
    .run(JSON.stringify(state), JSON.stringify(events), id)
}

/** Close the battle. Returns false if it was already closed, which makes the
 *  reward path safe against a double submit. */
export function finish(db: Db, id: string, winner: number | null, now = Date.now()): boolean {
  return db
    .prepare('UPDATE battles SET finished_at = ?, winner = ? WHERE id = ? AND finished_at IS NULL')
    .run(now, winner, id).changes === 1
}

export function markRewarded(db: Db, id: string): boolean {
  return db.prepare('UPDATE battles SET rewarded = 1 WHERE id = ? AND rewarded = 0').run(id).changes === 1
}

export function abandonOpen(db: Db, trainerId: string): void {
  db.prepare('UPDATE battles SET finished_at = ?, winner = 1 WHERE trainer_id = ? AND finished_at IS NULL')
    .run(Date.now(), trainerId)
}

export interface DefeatRecord { opponentId: string; wins: number; firstWinAt: number }

export function defeatsOf(db: Db, trainerId: string): Map<string, DefeatRecord> {
  const rows = db
    .prepare('SELECT opponent_id AS opponentId, wins, first_win_at AS firstWinAt FROM trainer_defeats WHERE trainer_id = ?')
    .all(trainerId) as DefeatRecord[]
  return new Map(rows.map((r) => [r.opponentId, r]))
}

/** Returns true on the first ever win against this opponent. */
/**
 * Wann dieser Gegner zuletzt besiegt wurde — `null`, wenn noch nie.
 *
 * Muss *vor* `recordWin` gelesen werden: der Aufruf schreibt den Zeitpunkt
 * neu, und danach ist jeder Sieg der erste des Tages.
 */
export function lastWinAt(db: Db, trainerId: string, opponentId: string): number | null {
  const row = db
    .prepare('SELECT last_win_at AS at FROM trainer_defeats WHERE trainer_id = ? AND opponent_id = ?')
    .get(trainerId, opponentId) as { at: number } | undefined
  return row?.at ?? null
}

export function recordWin(db: Db, trainerId: string, opponentId: string, now = Date.now()): boolean {
  const existing = db
    .prepare('SELECT wins FROM trainer_defeats WHERE trainer_id = ? AND opponent_id = ?')
    .get(trainerId, opponentId) as { wins: number } | undefined
  db.prepare(
    `INSERT INTO trainer_defeats (trainer_id, opponent_id, first_win_at, wins, last_win_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(trainer_id, opponent_id) DO UPDATE SET wins = wins + 1, last_win_at = excluded.last_win_at`,
  ).run(trainerId, opponentId, now, now)
  return !existing
}
