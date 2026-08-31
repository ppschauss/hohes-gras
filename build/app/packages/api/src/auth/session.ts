import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { Db } from '../db/index.js'

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Browsersitzungen leben laenger — und gleitend.
 *
 * Die Mini-App holt sich ihre Identitaet bei jedem Start neu von Telegram; ein
 * Tag reicht ihr. Ein Browser hat diese Quelle nicht: liefe seine Sitzung nach
 * einem Tag ab, muesste man taeglich einen Code aus dem Chat holen. Dreissig
 * Tage, bei jeder Nutzung verlaengert, sind der Kompromiss — und weil jede
 * Sitzung sichtbar und einzeln widerrufbar ist, kostet die laengere Laufzeit
 * keine Kontrolle.
 */
export const BROWSER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type SessionKind = 'telegram' | 'browser'

/** So alt darf `last_seen_at` werden, bevor es neu geschrieben wird. Ohne die
 *  Schwelle waere jede Anfrage ein Schreibvorgang. */
const TOUCH_INTERVAL_MS = 60_000

/** Tokens are random bytes; only their HMAC is stored. A database leak
 *  therefore does not hand out usable sessions. */
function hashToken(token: string, secret: string): string {
  return createHmac('sha256', secret).update(token).digest('hex')
}

export interface SessionRecord {
  id: string
  trainerId: string
  expiresAt: number
  kind: SessionKind
}

export function issueSession(
  db: Db, secret: string, trainerId: string, userAgent = '',
  now = Date.now(), kind: SessionKind = 'telegram',
): { token: string; expiresAt: number; id: string } {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = now + (kind === 'browser' ? BROWSER_SESSION_TTL_MS : SESSION_TTL_MS)
  const id = randomUUID()

  // Die Mini-App meldet sich bei jedem Oeffnen neu an. Ohne diese Zeile
  // sammelt sich je Start eine Sitzung an — gemessen 304 Stueck bei vier
  // Geraeten, und die Liste der verbundenen Geraete waere unlesbar.
  //
  // Nur fuer Telegram: dort ist der alte Token in derselben Sekunde wertlos,
  // weil der Client den neuen bekommt. Zwei Browser koennen dagegen dieselbe
  // User-Agent-Zeichenkette haben und trotzdem auf verschiedenen Rechnern
  // stehen — da waere Zusammenfassen ein Rauswurf.
  if (kind === 'telegram') {
    db.prepare('DELETE FROM sessions WHERE trainer_id = ? AND kind = ? AND user_agent = ?')
      .run(trainerId, kind, userAgent.slice(0, 200))
  }
  db.prepare(
    `INSERT INTO sessions (token_hash, trainer_id, issued_at, expires_at, user_agent, id, kind, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(hashToken(token, secret), trainerId, now, expiresAt, userAgent.slice(0, 200), id, kind, now)
  return { token, expiresAt, id }
}

export function resolveSession(db: Db, secret: string, token: string, now = Date.now()): SessionRecord | null {
  if (!token) return null
  const hash = hashToken(token, secret)
  const row = db
    .prepare(
      `SELECT id, trainer_id AS trainerId, expires_at AS expiresAt, kind, last_seen_at AS lastSeenAt
       FROM sessions WHERE token_hash = ?`,
    )
    .get(hash) as (SessionRecord & { lastSeenAt: number }) | undefined
  if (!row) return null
  if (row.expiresAt <= now) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash)
    return null
  }
  if (now - row.lastSeenAt > TOUCH_INTERVAL_MS) {
    // Browsersitzungen gleiten mit: wer spielt, bleibt angemeldet. Eine
    // Telegram-Sitzung braucht das nicht, sie wird ohnehin neu ausgestellt.
    const expiresAt = row.kind === 'browser' ? now + BROWSER_SESSION_TTL_MS : row.expiresAt
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?')
      .run(now, expiresAt, hash)
  }
  return { id: row.id, trainerId: row.trainerId, expiresAt: row.expiresAt, kind: row.kind }
}

export interface SessionView {
  id: string
  kind: SessionKind
  userAgent: string
  issuedAt: number
  lastSeenAt: number
  expiresAt: number
  current: boolean
}

export function listSessions(db: Db, trainerId: string, currentId: string | null): SessionView[] {
  const rows = db
    .prepare(
      `SELECT id, kind, user_agent AS userAgent, issued_at AS issuedAt,
              last_seen_at AS lastSeenAt, expires_at AS expiresAt
       FROM sessions WHERE trainer_id = ? ORDER BY last_seen_at DESC`,
    )
    .all(trainerId) as Array<Omit<SessionView, 'current'>>
  return rows.map((r) => ({ ...r, current: r.id === currentId }))
}

/** Einzelne Sitzung beenden. Gibt false zurueck, wenn sie einem anderen
 *  Trainer gehoert — niemand soll fremde Sitzungen abmelden koennen. */
export function revokeSession(db: Db, trainerId: string, sessionId: string): boolean {
  return db.prepare('DELETE FROM sessions WHERE trainer_id = ? AND id = ?')
    .run(trainerId, sessionId).changes > 0
}

/** Alle ausser der aktuellen. Der Knopf fuer den Fall "ich habe mich woanders
 *  angemeldet und weiss nicht mehr, wo". */
export function revokeOtherSessions(db: Db, trainerId: string, keepId: string): number {
  return db.prepare('DELETE FROM sessions WHERE trainer_id = ? AND id <> ?')
    .run(trainerId, keepId).changes
}

export function revokeSessionsOf(db: Db, trainerId: string): number {
  return db.prepare('DELETE FROM sessions WHERE trainer_id = ?').run(trainerId).changes
}

export function purgeExpiredSessions(db: Db, now = Date.now()): number {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now).changes
}

/** Constant-time compare for anything else that needs it. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
