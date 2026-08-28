import type { Trainer } from '@game/shared'
import type { Db } from '../db/index.js'
import { newId, newTrainerCode } from '../db/ids.js'

interface TrainerRow {
  id: string; telegram_id: string; display_name: string; trainer_code: string; locale: string
  created_at: number; last_seen_at: number; gold: number; shards: number; tickets: number
  current_area_id: string | null; garden_background: string
  energy: number; energy_updated_at: number; active_team_id: string | null
  level_scaling: number; energy_cap_steps: number
  theme_id: string; theme_mode: string
  is_admin: number; is_banned: number
  hide_leaderboard: number; friends_only: number; allow_requests: number; reminders: number
}

const toTrainer = (r: TrainerRow): Trainer => ({
  id: r.id,
  telegramId: r.telegram_id,
  displayName: r.display_name,
  trainerCode: r.trainer_code,
  locale: r.locale,
  createdAt: r.created_at,
  lastSeenAt: r.last_seen_at,
  gold: r.gold,
  shards: r.shards,
  tickets: r.tickets,
  currentAreaId: r.current_area_id,
  gardenBackground: r.garden_background,
  energy: r.energy,
  energyUpdatedAt: r.energy_updated_at,
  activeTeamId: r.active_team_id,
  levelScaling: r.level_scaling === 1,
  energyCapSteps: r.energy_cap_steps,
  themeId: r.theme_id,
  themeMode: (['auto', 'day', 'night'].includes(r.theme_mode) ? r.theme_mode : 'auto') as 'auto' | 'day' | 'night',
  isAdmin: r.is_admin === 1,
  isBanned: r.is_banned === 1,
  privacy: {
    hideFromLeaderboard: r.hide_leaderboard === 1,
    friendsOnlyInteractions: r.friends_only === 1,
    allowFriendRequests: r.allow_requests === 1,
    reminders: r.reminders === 1,
  },
})

export function findByTelegramId(db: Db, telegramId: string): Trainer | null {
  const row = db.prepare('SELECT * FROM trainers WHERE telegram_id = ?').get(telegramId) as TrainerRow | undefined
  return row ? toTrainer(row) : null
}

export function findById(db: Db, id: string): Trainer | null {
  const row = db.prepare('SELECT * FROM trainers WHERE id = ?').get(id) as TrainerRow | undefined
  return row ? toTrainer(row) : null
}

export function findByTrainerCode(db: Db, code: string): Trainer | null {
  const row = db.prepare('SELECT * FROM trainers WHERE trainer_code = ?').get(code.toUpperCase()) as TrainerRow | undefined
  return row ? toTrainer(row) : null
}

export interface CreateTrainerInput {
  telegramId: string
  displayName: string
  locale: string
  isAdmin: boolean
  startingGold: number
  startingAreaId: string | null
}

export function createTrainer(db: Db, input: CreateTrainerInput, now = Date.now()): Trainer {
  const id = newId()
  // The unique index on trainer_code makes a collision a constraint error
  // rather than a silent duplicate; retrying a few times is cheaper than
  // locking, and 32^8 codes make more than one retry vanishingly unlikely.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newTrainerCode()
    try {
      db.prepare(
        `INSERT INTO trainers (id, telegram_id, display_name, trainer_code, locale, created_at, last_seen_at,
                               gold, current_area_id, is_admin, energy_updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, input.telegramId, input.displayName, code, input.locale, now, now,
        input.startingGold, input.startingAreaId, input.isAdmin ? 1 : 0, now)
      return findById(db, id)!
    } catch (err) {
      const msg = (err as Error).message
      if (attempt < 4 && msg.includes('trainers.trainer_code')) continue
      throw err
    }
  }
  throw new Error('Trainer-Code konnte nicht vergeben werden')
}

export function touchLastSeen(db: Db, trainerId: string, now = Date.now()): void {
  db.prepare('UPDATE trainers SET last_seen_at = ? WHERE id = ?').run(now, trainerId)
}

export function updateDisplayName(db: Db, trainerId: string, name: string): void {
  db.prepare('UPDATE trainers SET display_name = ? WHERE id = ?').run(name.slice(0, 32), trainerId)
}

export function setBanned(db: Db, trainerId: string, banned: boolean): void {
  db.prepare('UPDATE trainers SET is_banned = ? WHERE id = ?').run(banned ? 1 : 0, trainerId)
}

export function bumpEnergyCapStep(db: Db, trainerId: string): number {
  db.prepare('UPDATE trainers SET energy_cap_steps = energy_cap_steps + 1 WHERE id = ?').run(trainerId)
  const row = db.prepare('SELECT energy_cap_steps AS n FROM trainers WHERE id = ?')
    .get(trainerId) as { n: number }
  return row.n
}

export function setLevelScaling(db: Db, trainerId: string, enabled: boolean): void {
  db.prepare('UPDATE trainers SET level_scaling = ? WHERE id = ?').run(enabled ? 1 : 0, trainerId)
}

export function setAdmin(db: Db, trainerId: string, admin: boolean): void {
  db.prepare('UPDATE trainers SET is_admin = ? WHERE id = ?').run(admin ? 1 : 0, trainerId)
}

export function countTrainers(db: Db): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM trainers').get() as { n: number }).n
}
