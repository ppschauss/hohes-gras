import type { Db } from '../db/index.js'
import { newId } from '../db/ids.js'

export interface Raid {
  id: string
  guildId: string | null
  chatId: string | null
  messageId: number | null
  speciesId: string
  level: number
  tier: number
  hpMax: number
  hpLeft: number
  seed: string
  startedAt: number
  expiresAt: number
  defeatedAt: number | null
  rewardsPaid: boolean
}

interface Row {
  id: string; guild_id: string | null; chat_id: string | null; message_id: number | null
  species_id: string; level: number; tier: number; hp_max: number; hp_left: number
  seed: string; started_at: number; expires_at: number
  defeated_at: number | null; rewards_paid: number
}

const toRaid = (r: Row): Raid => ({
  id: r.id, guildId: r.guild_id, chatId: r.chat_id, messageId: r.message_id,
  speciesId: r.species_id, level: r.level, tier: r.tier,
  hpMax: r.hp_max, hpLeft: r.hp_left, seed: r.seed,
  startedAt: r.started_at, expiresAt: r.expires_at,
  defeatedAt: r.defeated_at, rewardsPaid: r.rewards_paid === 1,
})

export function byId(db: Db, id: string): Raid | null {
  const row = db.prepare('SELECT * FROM raids WHERE id = ?').get(id) as Row | undefined
  return row ? toRaid(row) : null
}

export function create(db: Db, input: Omit<Raid, 'id' | 'defeatedAt' | 'rewardsPaid' | 'messageId'>): Raid {
  const id = newId()
  db.prepare(
    `INSERT INTO raids (id, guild_id, chat_id, species_id, level, tier, hp_max, hp_left, seed, started_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.guildId, input.chatId, input.speciesId, input.level, input.tier,
    input.hpMax, input.hpLeft, input.seed, input.startedAt, input.expiresAt)
  return byId(db, id)!
}

export function setMessageId(db: Db, id: string, messageId: number): void {
  db.prepare('UPDATE raids SET message_id = ? WHERE id = ?').run(messageId, id)
}

export function openForGuild(db: Db, guildId: string, now = Date.now()): Raid[] {
  const rows = db
    .prepare('SELECT * FROM raids WHERE guild_id = ? AND defeated_at IS NULL AND expires_at > ? ORDER BY started_at DESC')
    .all(guildId, now) as Row[]
  return rows.map(toRaid)
}

export function recentForGuild(db: Db, guildId: string, limit = 5): Raid[] {
  const rows = db
    .prepare('SELECT * FROM raids WHERE guild_id = ? ORDER BY started_at DESC LIMIT ?')
    .all(guildId, limit) as Row[]
  return rows.map(toRaid)
}

/**
 * Apply damage, refusing to go below zero.
 *
 * The `hp_left >= ?` guard makes the last hit unambiguous: exactly one caller
 * can bring the boss from alive to defeated, so rewards are paid once.
 */
export function applyDamage(db: Db, id: string, amount: number, now = Date.now()): { hpLeft: number; defeated: boolean } | null {
  const raid = byId(db, id)
  if (!raid || raid.defeatedAt || raid.expiresAt <= now) return null

  const dealt = Math.min(amount, raid.hpLeft)
  db.prepare('UPDATE raids SET hp_left = hp_left - ? WHERE id = ? AND hp_left >= ?').run(dealt, id, dealt)
  const after = byId(db, id)!
  if (after.hpLeft <= 0 && !after.defeatedAt) {
    db.prepare('UPDATE raids SET defeated_at = ? WHERE id = ? AND defeated_at IS NULL').run(now, id)
  }
  return { hpLeft: after.hpLeft, defeated: after.hpLeft <= 0 }
}

export function markRewarded(db: Db, id: string): boolean {
  return db.prepare('UPDATE raids SET rewards_paid = 1 WHERE id = ? AND rewards_paid = 0').run(id).changes === 1
}

export interface Participant {
  trainerId: string
  displayName: string
  damage: number
  attacks: number
  joinedAt: number
  rewardedAt: number | null
}

export function participantsOf(db: Db, raidId: string): Participant[] {
  return db
    .prepare(
      `SELECT p.trainer_id AS trainerId, t.display_name AS displayName, p.damage, p.attacks,
              p.joined_at AS joinedAt, p.rewarded_at AS rewardedAt
       FROM raid_participants p JOIN trainers t ON t.id = p.trainer_id
       WHERE p.raid_id = ? ORDER BY p.damage DESC`,
    )
    .all(raidId) as Participant[]
}

export function participant(db: Db, raidId: string, trainerId: string): Participant | null {
  return participantsOf(db, raidId).find((p) => p.trainerId === trainerId) ?? null
}

export function recordAttack(db: Db, raidId: string, trainerId: string, damage: number, now = Date.now()): void {
  db.prepare(
    `INSERT INTO raid_participants (raid_id, trainer_id, damage, attacks, joined_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(raid_id, trainer_id) DO UPDATE SET damage = damage + excluded.damage, attacks = attacks + 1`,
  ).run(raidId, trainerId, damage, now)
}

export function markParticipantRewarded(db: Db, raidId: string, trainerId: string, now = Date.now()): boolean {
  return db
    .prepare('UPDATE raid_participants SET rewarded_at = ? WHERE raid_id = ? AND trainer_id = ? AND rewarded_at IS NULL')
    .run(now, raidId, trainerId).changes === 1
}
