import type { Db } from '../db/index.js'

export interface OwnedBuilding { buildingId: string; level: number; builtAt: number }

export function buildingsOf(db: Db, trainerId: string): OwnedBuilding[] {
  return db
    .prepare('SELECT building_id AS buildingId, level, built_at AS builtAt FROM buildings WHERE trainer_id = ?')
    .all(trainerId) as OwnedBuilding[]
}

export function buildingLevel(db: Db, trainerId: string, buildingId: string): number {
  const row = db.prepare('SELECT level FROM buildings WHERE trainer_id = ? AND building_id = ?')
    .get(trainerId, buildingId) as { level: number } | undefined
  return row?.level ?? 0
}

export function upgradeBuilding(db: Db, trainerId: string, buildingId: string, now = Date.now()): number {
  db.prepare(
    `INSERT INTO buildings (trainer_id, building_id, level, built_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(trainer_id, building_id) DO UPDATE SET level = level + 1`,
  ).run(trainerId, buildingId, now)
  return buildingLevel(db, trainerId, buildingId)
}

/* ------------------------------------------------------------ Saison-Reise */

export interface SeasonRow { points: number; claimed: number[] }

export function seasonOf(db: Db, trainerId: string, seasonKey: string): SeasonRow {
  const row = db.prepare('SELECT points, claimed FROM season_progress WHERE trainer_id = ? AND season_key = ?')
    .get(trainerId, seasonKey) as { points: number; claimed: string } | undefined
  if (!row) return { points: 0, claimed: [] }
  try {
    return { points: row.points, claimed: JSON.parse(row.claimed) as number[] }
  } catch {
    return { points: row.points, claimed: [] }
  }
}

export function addSeasonPoints(db: Db, trainerId: string, seasonKey: string, points: number, now = Date.now()): void {
  if (points <= 0) return
  db.prepare(
    `INSERT INTO season_progress (trainer_id, season_key, points, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(trainer_id, season_key) DO UPDATE SET points = points + excluded.points, updated_at = excluded.updated_at`,
  ).run(trainerId, seasonKey, points, now)
}

/** Record a claimed tier. Returns false if it was already claimed, which is
 *  what keeps the reward from being taken twice. */
export function claimSeasonTier(db: Db, trainerId: string, seasonKey: string, tier: number, now = Date.now()): boolean {
  const current = seasonOf(db, trainerId, seasonKey)
  if (current.claimed.includes(tier)) return false
  const next = [...current.claimed, tier].sort((a, b) => a - b)
  db.prepare(
    `INSERT INTO season_progress (trainer_id, season_key, points, claimed, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(trainer_id, season_key) DO UPDATE SET claimed = excluded.claimed, updated_at = excluded.updated_at`,
  ).run(trainerId, seasonKey, current.points, JSON.stringify(next), now)
  return true
}

/* ----------------------------------------------------------------- Erfolge */

export interface AchievementRow {
  achievementId: string
  progress: number
  unlockedAt: number | null
  claimedAt: number | null
}

export function achievementsOf(db: Db, trainerId: string): Map<string, AchievementRow> {
  const rows = db
    .prepare(
      `SELECT achievement_id AS achievementId, progress, unlocked_at AS unlockedAt, claimed_at AS claimedAt
       FROM achievements WHERE trainer_id = ?`,
    )
    .all(trainerId) as AchievementRow[]
  return new Map(rows.map((r) => [r.achievementId, r]))
}

export function markUnlocked(db: Db, trainerId: string, achievementId: string, progress: number, now = Date.now()): boolean {
  const before = db.prepare('SELECT unlocked_at FROM achievements WHERE trainer_id = ? AND achievement_id = ?')
    .get(trainerId, achievementId) as { unlocked_at: number | null } | undefined
  db.prepare(
    `INSERT INTO achievements (trainer_id, achievement_id, progress, unlocked_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(trainer_id, achievement_id) DO UPDATE SET
       progress = excluded.progress,
       unlocked_at = COALESCE(achievements.unlocked_at, excluded.unlocked_at)`,
  ).run(trainerId, achievementId, progress, now)
  return !before?.unlocked_at
}

export function setProgress(db: Db, trainerId: string, achievementId: string, progress: number): void {
  db.prepare(
    `INSERT INTO achievements (trainer_id, achievement_id, progress) VALUES (?, ?, ?)
     ON CONFLICT(trainer_id, achievement_id) DO UPDATE SET progress = excluded.progress`,
  ).run(trainerId, achievementId, progress)
}

export function claimAchievement(db: Db, trainerId: string, achievementId: string, now = Date.now()): boolean {
  return db
    .prepare('UPDATE achievements SET claimed_at = ? WHERE trainer_id = ? AND achievement_id = ? AND unlocked_at IS NOT NULL AND claimed_at IS NULL')
    .run(now, trainerId, achievementId).changes === 1
}

/* ------------------------------------------------------------------- Story */

export function storyOf(db: Db, trainerId: string): Set<string> {
  const rows = db.prepare('SELECT chapter_id AS id FROM story_progress WHERE trainer_id = ?')
    .all(trainerId) as Array<{ id: string }>
  return new Set(rows.map((r) => r.id))
}

export function reachChapter(db: Db, trainerId: string, chapterId: string, now = Date.now()): boolean {
  return db
    .prepare('INSERT OR IGNORE INTO story_progress (trainer_id, chapter_id, reached_at) VALUES (?, ?, ?)')
    .run(trainerId, chapterId, now).changes === 1
}
