import type { Db } from '../db/index.js'
import { newId } from '../db/ids.js'

export interface Guild {
  id: string
  name: string
  tag: string
  motto: string
  founderId: string | null
  createdAt: number
  treasury: number
  chatId: string | null
  joinOpen: boolean
}

interface GuildRow {
  id: string; name: string; tag: string; motto: string; founder_id: string | null
  created_at: number; treasury: number; chat_id: string | null; join_open: number
}

const toGuild = (r: GuildRow): Guild => ({
  id: r.id, name: r.name, tag: r.tag, motto: r.motto, founderId: r.founder_id,
  createdAt: r.created_at, treasury: r.treasury, chatId: r.chat_id, joinOpen: r.join_open === 1,
})

export function byId(db: Db, id: string): Guild | null {
  const row = db.prepare('SELECT * FROM guilds WHERE id = ?').get(id) as GuildRow | undefined
  return row ? toGuild(row) : null
}

export function byTag(db: Db, tag: string): Guild | null {
  const row = db.prepare('SELECT * FROM guilds WHERE tag = ?').get(tag.toUpperCase()) as GuildRow | undefined
  return row ? toGuild(row) : null
}

export function byChat(db: Db, chatId: string): Guild | null {
  const row = db.prepare('SELECT * FROM guilds WHERE chat_id = ?').get(chatId) as GuildRow | undefined
  return row ? toGuild(row) : null
}

export function guildOf(db: Db, trainerId: string): Guild | null {
  const row = db
    .prepare('SELECT g.* FROM guilds g JOIN guild_members m ON m.guild_id = g.id WHERE m.trainer_id = ?')
    .get(trainerId) as GuildRow | undefined
  return row ? toGuild(row) : null
}

export function create(db: Db, input: { name: string; tag: string; motto: string; founderId: string }, now = Date.now()): Guild {
  const id = newId()
  db.prepare('INSERT INTO guilds (id, name, tag, motto, founder_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, input.name, input.tag.toUpperCase(), input.motto, input.founderId, now)
  db.prepare('INSERT INTO guild_members (guild_id, trainer_id, role, joined_at) VALUES (?, ?, ?, ?)')
    .run(id, input.founderId, 'leader', now)
  return byId(db, id)!
}

export function listOpen(db: Db, limit = 30): Array<Guild & { memberCount: number }> {
  return db
    .prepare(
      `SELECT g.*, (SELECT COUNT(*) FROM guild_members m WHERE m.guild_id = g.id) AS memberCount
       FROM guilds g WHERE g.join_open = 1 ORDER BY memberCount DESC, g.created_at ASC LIMIT ?`,
    )
    .all(limit)
    .map((r) => ({ ...toGuild(r as GuildRow), memberCount: (r as { memberCount: number }).memberCount }))
}

export interface Member {
  trainerId: string
  displayName: string
  role: string
  joinedAt: number
  contribution: number
}

export function membersOf(db: Db, guildId: string): Member[] {
  return db
    .prepare(
      `SELECT m.trainer_id AS trainerId, t.display_name AS displayName, m.role,
              m.joined_at AS joinedAt, m.contribution
       FROM guild_members m JOIN trainers t ON t.id = m.trainer_id
       WHERE m.guild_id = ? ORDER BY m.contribution DESC, m.joined_at ASC`,
    )
    .all(guildId) as Member[]
}

export function addMember(db: Db, guildId: string, trainerId: string, now = Date.now()): boolean {
  return db
    .prepare('INSERT OR IGNORE INTO guild_members (guild_id, trainer_id, joined_at) VALUES (?, ?, ?)')
    .run(guildId, trainerId, now).changes === 1
}

export function removeMember(db: Db, guildId: string, trainerId: string): boolean {
  return db.prepare('DELETE FROM guild_members WHERE guild_id = ? AND trainer_id = ?')
    .run(guildId, trainerId).changes === 1
}

export function roleOf(db: Db, guildId: string, trainerId: string): string | null {
  const row = db.prepare('SELECT role FROM guild_members WHERE guild_id = ? AND trainer_id = ?')
    .get(guildId, trainerId) as { role: string } | undefined
  return row?.role ?? null
}

export function bindChat(db: Db, guildId: string, chatId: string | null): void {
  db.prepare('UPDATE guilds SET chat_id = ? WHERE id = ?').run(chatId, guildId)
}

export function addToTreasury(db: Db, guildId: string, amount: number): void {
  db.prepare('UPDATE guilds SET treasury = treasury + ? WHERE id = ?').run(Math.max(0, amount), guildId)
}

export function addContribution(db: Db, guildId: string, trainerId: string, amount: number): void {
  db.prepare('UPDATE guild_members SET contribution = contribution + ? WHERE guild_id = ? AND trainer_id = ?')
    .run(Math.max(0, amount), guildId, trainerId)
}

/* -------------------------------------------------------------- Wochenziel */

export interface Goal {
  guildId: string
  weekKey: string
  goalKind: string
  target: number
  progress: number
  claimedAt: number | null
}

interface GoalRow {
  guild_id: string; week_key: string; goal_kind: string
  target: number; progress: number; claimed_at: number | null
}

const toGoal = (r: GoalRow): Goal => ({
  guildId: r.guild_id, weekKey: r.week_key, goalKind: r.goal_kind,
  target: r.target, progress: r.progress, claimedAt: r.claimed_at,
})

export function goalOf(db: Db, guildId: string, weekKey: string, kind: string): Goal | null {
  const row = db.prepare('SELECT * FROM guild_goals WHERE guild_id = ? AND week_key = ? AND goal_kind = ?')
    .get(guildId, weekKey, kind) as GoalRow | undefined
  return row ? toGoal(row) : null
}

/** Alle Ziele einer Woche. Seit es drei gleichzeitig gibt, ist das der
 *  Regelfall; `goalOf` fragt eines davon gezielt ab. */
export function goalsOf(db: Db, guildId: string, weekKey: string): Goal[] {
  return (db.prepare('SELECT * FROM guild_goals WHERE guild_id = ? AND week_key = ?')
    .all(guildId, weekKey) as GoalRow[]).map(toGoal)
}

/**
 * Das Wochenziel anlegen — und sein Soll nachfuehren.
 *
 * Das Soll haengt an der Mitgliederzahl, und die aendert sich mitten in der
 * Woche. Es wird deshalb bei jedem Zugriff neu gesetzt: wer beitritt, hebt die
 * Latte und traegt selbst dazu bei. Ein abgeholtes Ziel bleibt unangetastet —
 * eine Belohnung, die durch einen Neuzugang rueckwirkend unverdient wird,
 * waere unfair.
 */
/**
 * Ein Wochenziel anlegen — und sein Soll nachfuehren.
 *
 * Seit die Art im Schluessel steht, braucht es kein Umschreiben mehr, wenn
 * sich die Liste der Ziele aendert: eine Woche traegt einfach die Zeilen, die
 * zu ihr gehoeren, und alte bleiben liegen, ohne zu stoeren. Nachgefuehrt wird
 * nur noch das Soll, das an der Mitgliederzahl haengt.
 */
export function ensureGoal(db: Db, guildId: string, weekKey: string, kind: string, target: number): Goal {
  db.prepare('INSERT OR IGNORE INTO guild_goals (guild_id, week_key, goal_kind, target) VALUES (?, ?, ?, ?)')
    .run(guildId, weekKey, kind, target)
  db.prepare(
    `UPDATE guild_goals SET target = ?
      WHERE guild_id = ? AND week_key = ? AND goal_kind = ? AND claimed_at IS NULL AND target <> ?`,
  ).run(target, guildId, weekKey, kind, target)
  return goalOf(db, guildId, weekKey, kind)!
}

export function addGoalProgress(db: Db, guildId: string, weekKey: string, kind: string, amount: number): void {
  db.prepare('UPDATE guild_goals SET progress = progress + ? WHERE guild_id = ? AND week_key = ? AND goal_kind = ?')
    .run(Math.max(0, amount), guildId, weekKey, kind)
}

export function claimGoal(db: Db, guildId: string, weekKey: string, kind: string, now = Date.now()): boolean {
  return db.prepare(
    `UPDATE guild_goals SET claimed_at = ?
      WHERE guild_id = ? AND week_key = ? AND goal_kind = ? AND claimed_at IS NULL AND progress >= target`,
  ).run(now, guildId, weekKey, kind).changes === 1
}
