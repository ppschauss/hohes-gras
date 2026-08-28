import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Db } from '../db/index.js'

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000

/** Tokens are random bytes; only their HMAC is stored. A database leak
 *  therefore does not hand out usable sessions. */
function hashToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex')
}

export interface SessionRecord {
  trainerId: string
  expiresAt: number
}

export function issueSession(db: Db, secret: string, trainerId: string, userAgent = '', now = Date.now()): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = now + SESSION_TTL_MS
  db.prepare(
    'INSERT INTO sessions (token_hash, trainer_id, issued_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
  ).run(hashToken(token, secret), trainerId, now, expiresAt, userAgent.slice(0, 200))
  return { token, expiresAt }
}

export function resolveSession(db: Db, secret: string, token: string, now = Date.now()): SessionRecord | null {
  if (!token) return null
  const row = db
    .prepare('SELECT trainer_id AS trainerId, expires_at AS expiresAt FROM sessions WHERE token_hash = ?')
    .get(hashToken(token, secret)) as SessionRecord | undefined
  if (!row) return null
  if (row.expiresAt <= now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token, secret))
    return null
  }
  return row
}

export function revokeSessionsOf(db: Db, trainerId: string): number {
  return db.prepare('DELETE FROM sessions WHERE trainer_id = ?').run(trainerId).changes
}

export function purgeExpiredSessions(db: Db, now = Date.now()): number {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes
}

/** Constant-time compare for anything else that needs it (invite codes etc.). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
