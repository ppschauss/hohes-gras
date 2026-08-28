import type { Db } from '../db/index.js'
import { randomCode } from '../db/ids.js'

export interface Invite {
  code: string
  createdBy: string | null
  createdAt: number
  expiresAt: number | null
  maxUses: number
  uses: number
  note: string
}

interface InviteRow {
  code: string; created_by: string | null; created_at: number
  expires_at: number | null; max_uses: number; uses: number; note: string
}

const toInvite = (r: InviteRow): Invite => ({
  code: r.code, createdBy: r.created_by, createdAt: r.created_at,
  expiresAt: r.expires_at, maxUses: r.max_uses, uses: r.uses, note: r.note,
})

export function createInvite(
  db: Db,
  opts: { createdBy: string | null; maxUses?: number; expiresInDays?: number | null; note?: string },
  now = Date.now(),
): Invite {
  const code = randomCode(8)
  const expiresAt = opts.expiresInDays ? now + opts.expiresInDays * 86_400_000 : null
  db.prepare(
    'INSERT INTO invites (code, created_by, created_at, expires_at, max_uses, note) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(code, opts.createdBy, now, expiresAt, Math.max(1, opts.maxUses ?? 1), (opts.note ?? '').slice(0, 200))
  return getInvite(db, code)!
}

export function getInvite(db: Db, code: string): Invite | null {
  const row = db.prepare('SELECT * FROM invites WHERE code = ?').get(code.toUpperCase()) as InviteRow | undefined
  return row ? toInvite(row) : null
}

export type InviteCheck = { ok: true; invite: Invite } | { ok: false; reason: 'unknown' | 'expired' | 'used_up' }

export function checkInvite(db: Db, code: string, now = Date.now()): InviteCheck {
  const invite = getInvite(db, code.trim())
  if (!invite) return { ok: false, reason: 'unknown' }
  if (invite.expiresAt !== null && invite.expiresAt <= now) return { ok: false, reason: 'expired' }
  if (invite.uses >= invite.maxUses) return { ok: false, reason: 'used_up' }
  return { ok: true, invite }
}

/** Consume one use. Callers must already be inside a transaction together with
 *  the trainer INSERT, so a crash cannot burn a code without creating anyone. */
export function redeemInvite(db: Db, code: string, trainerId: string, now = Date.now()): void {
  const changed = db
    .prepare('UPDATE invites SET uses = uses + 1 WHERE code = ? AND uses < max_uses')
    .run(code.toUpperCase()).changes
  if (changed !== 1) throw new Error('Einladungscode war bereits aufgebraucht')
  db.prepare('INSERT INTO invite_redemptions (code, trainer_id, redeemed_at) VALUES (?, ?, ?)')
    .run(code.toUpperCase(), trainerId, now)
}

export function listInvites(db: Db, limit = 50): Invite[] {
  return (db.prepare('SELECT * FROM invites ORDER BY created_at DESC LIMIT ?').all(limit) as InviteRow[]).map(toInvite)
}

export function revokeInvite(db: Db, code: string): boolean {
  return db.prepare('DELETE FROM invites WHERE code = ?').run(code.toUpperCase()).changes > 0
}
