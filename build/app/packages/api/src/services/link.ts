import { createHmac, randomInt } from 'node:crypto'
import { GameError, type Trainer } from '@game/shared'
import type { AppContext } from '../context.js'
import { issueSession } from '../auth/session.js'
import { logEvent } from '../repos/events.js'

/**
 * Anmeldung im Browser über einen Einmalcode aus Telegram.
 *
 * Die Mini-App bekommt ihre Identität von Telegram signiert geliefert; eine
 * normale Webseite hat diese Quelle nicht. Statt ein zweites Anmeldesystem mit
 * Passwörtern zu bauen — und damit einen zweiten Weg, ein Konto zu verlieren —
 * leiht sich der Browser die Identität einmalig aus dem Chat, der ohnehin schon
 * authentifiziert ist.
 */

/**
 * Alphabet ohne verwechselbare Zeichen: kein O/0, kein I/1.
 *
 * Der Code wird abgetippt, oft vom Handy auf den Rechner. Jedes Zeichen, das
 * man verwechseln kann, ist ein Fehlversuch, der wie ein Angriff aussieht.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8
export const LINK_CODE_TTL_MS = 5 * 60_000

/** Nur der Hash wird gespeichert — wie beim Sitzungstoken. Wer die Datenbank
 *  liest, bekommt damit keine Anmeldung geschenkt. */
function hashCode(code: string, secret: string): string {
  return createHmac('sha256', secret).update(code.toUpperCase()).digest('hex')
}

export const formatCode = (code: string): string => `${code.slice(0, 4)}-${code.slice(4)}`

/** Nur Zeichen aus dem Alphabet; Bindestriche und Kleinschreibung sind erlaubt,
 *  weil Menschen so tippen. */
export const normalizeCode = (input: string): string =>
  input.toUpperCase().replace(/[^A-Z0-9]/g, '')

export interface LinkCode {
  code: string
  formatted: string
  expiresAt: number
}

/**
 * Neuen Code ausstellen. Ein etwaiger alter verfällt dabei.
 *
 * Sonst sammelten sich gültige Codes an: wer dreimal auf den Knopf tippt, weil
 * nichts zu passieren scheint, hätte drei offene Türen statt einer.
 */
export function createCode(ctx: AppContext, trainer: Trainer, now = Date.now()): LinkCode {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)]

  ctx.db.prepare('DELETE FROM link_codes WHERE trainer_id = ?').run(trainer.id)
  ctx.db.prepare(
    'INSERT INTO link_codes (code_hash, trainer_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  ).run(hashCode(code, ctx.config.SESSION_SECRET), trainer.id, now, now + LINK_CODE_TTL_MS)
  logEvent(ctx.db, trainer.id, 'session.code', {})

  return { code, formatted: formatCode(code), expiresAt: now + LINK_CODE_TTL_MS }
}

export interface RedeemResult {
  token: string
  expiresAt: number
  trainerId: string
}

/**
 * Code einlösen und eine Browsersitzung ausstellen.
 *
 * Abgelaufene und bereits benutzte Codes werden wie unbekannte behandelt: dem
 * Gegenüber zu erklären, *warum* ein Code nicht geht, hilft nur beim Raten.
 */
export function redeem(
  ctx: AppContext, input: string, userAgent: string, now = Date.now(),
): RedeemResult {
  const code = normalizeCode(input)
  if (code.length !== CODE_LENGTH) throw new GameError('link_invalid', {}, 400)

  const row = ctx.db
    .prepare(
      `SELECT trainer_id AS trainerId, expires_at AS expiresAt, used_at AS usedAt
       FROM link_codes WHERE code_hash = ?`,
    )
    .get(hashCode(code, ctx.config.SESSION_SECRET)) as
      { trainerId: string; expiresAt: number; usedAt: number | null } | undefined

  if (!row || row.usedAt !== null || row.expiresAt <= now) {
    throw new GameError('link_invalid', {}, 400)
  }

  // Einmalig: der Code wird verbraucht, bevor die Sitzung entsteht.
  ctx.db.prepare('UPDATE link_codes SET used_at = ? WHERE code_hash = ?')
    .run(now, hashCode(code, ctx.config.SESSION_SECRET))

  const session = issueSession(
    ctx.db, ctx.config.SESSION_SECRET, row.trainerId, userAgent, now, 'browser',
  )
  logEvent(ctx.db, row.trainerId, 'session.linked', { sessionId: session.id })
  return { token: session.token, expiresAt: session.expiresAt, trainerId: row.trainerId }
}

/** Abgelaufene Codes wegräumen; stündlich vom Scheduler. */
export function purgeStaleCodes(ctx: AppContext, now = Date.now()): number {
  return ctx.db.prepare('DELETE FROM link_codes WHERE expires_at <= ?').run(now - 3_600_000).changes
}
