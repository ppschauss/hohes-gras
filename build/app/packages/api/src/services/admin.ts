import { GameError, type Trainer } from '@game/shared'
import type { AppContext } from '../context.js'
import * as invites from '../repos/invites.js'
import { countTrainers, findById, setAdmin, setBanned } from '../repos/trainers.js'
import { logEvent } from '../repos/events.js'

/** Every admin route goes through this. Admin status lives on the trainer row,
 *  so revoking it takes effect on the next request. */
export function requireAdmin(trainer: Trainer): void {
  if (!trainer.isAdmin) throw new GameError('unauthorized', { reason: 'admin_only' }, 403)
}

export function dashboard(ctx: AppContext, trainer: Trainer) {
  requireAdmin(trainer)

  const one = (sql: string, ...args: unknown[]): number =>
    (ctx.db.prepare(sql).get(...args) as { n: number }).n

  const dayAgo = Date.now() - 86_400_000
  const weekAgo = Date.now() - 7 * 86_400_000

  return {
    trainers: {
      total: countTrainers(ctx.db),
      activeToday: one('SELECT COUNT(*) AS n FROM trainers WHERE last_seen_at >= ?', dayAgo),
      activeWeek: one('SELECT COUNT(*) AS n FROM trainers WHERE last_seen_at >= ?', weekAgo),
      banned: one('SELECT COUNT(*) AS n FROM trainers WHERE is_banned = 1'),
    },
    content: {
      pack: ctx.registry.manifest.id,
      version: ctx.registry.manifest.version,
      species: ctx.registry.speciesCount,
      areas: ctx.registry.allAreas.length,
      trainers: ctx.registry.allTrainers.length,
    },
    activity: {
      creatures: one('SELECT COUNT(*) AS n FROM creatures'),
      shinies: one('SELECT COUNT(*) AS n FROM creatures WHERE shiny = 1'),
      battles: one('SELECT COUNT(*) AS n FROM battles WHERE finished_at IS NOT NULL'),
      duels: one('SELECT COUNT(*) AS n FROM pvp_duels'),
      raids: one('SELECT COUNT(*) AS n FROM raids WHERE defeated_at IS NOT NULL'),
      guilds: one('SELECT COUNT(*) AS n FROM guilds'),
      marketSales: one('SELECT COUNT(*) AS n FROM market_listings WHERE sold_at IS NOT NULL'),
      goldInCirculation: one('SELECT COALESCE(SUM(gold), 0) AS n FROM trainers'),
    },
    invites: invites.listInvites(ctx.db, 30).map((i) => ({
      code: i.code, uses: i.uses, maxUses: i.maxUses,
      expiresAt: i.expiresAt, note: i.note, exhausted: i.uses >= i.maxUses,
    })),
    recentTrainers: ctx.db
      .prepare(
        `SELECT id, display_name AS displayName, trainer_code AS trainerCode,
                created_at AS createdAt, last_seen_at AS lastSeenAt,
                is_admin AS isAdmin, is_banned AS isBanned, gold
         FROM trainers ORDER BY created_at DESC LIMIT 50`,
      )
      .all(),
    uptimeSeconds: Math.floor((Date.now() - ctx.startedAt) / 1000),
  }
}

export function createInvite(ctx: AppContext, trainer: Trainer, maxUses: number, expiresInDays: number | null, note: string) {
  requireAdmin(trainer)
  const invite = invites.createInvite(ctx.db, {
    createdBy: trainer.id,
    maxUses: Math.min(50, Math.max(1, maxUses)),
    expiresInDays,
    note,
  })
  logEvent(ctx.db, trainer.id, 'admin.inviteCreated', { code: invite.code, maxUses })
  return invite
}

export function revokeInvite(ctx: AppContext, trainer: Trainer, code: string): void {
  requireAdmin(trainer)
  if (!invites.revokeInvite(ctx.db, code)) throw new GameError('not_found', { code }, 404)
  logEvent(ctx.db, trainer.id, 'admin.inviteRevoked', { code })
}

export function setBan(ctx: AppContext, trainer: Trainer, targetId: string, banned: boolean): void {
  requireAdmin(trainer)
  const target = findById(ctx.db, targetId)
  if (!target) throw new GameError('not_found', { targetId }, 404)
  // Locking yourself out of the admin panel is not a useful capability.
  if (target.id === trainer.id) throw new GameError('validation_failed', { reason: 'self' })
  setBanned(ctx.db, targetId, banned)
  logEvent(ctx.db, trainer.id, banned ? 'admin.banned' : 'admin.unbanned', { targetId })
}

export function grantAdmin(ctx: AppContext, trainer: Trainer, targetId: string, admin: boolean): void {
  requireAdmin(trainer)
  const target = findById(ctx.db, targetId)
  if (!target) throw new GameError('not_found', { targetId }, 404)
  if (target.id === trainer.id && !admin) {
    throw new GameError('validation_failed', { reason: 'cannot_demote_self' })
  }
  setAdmin(ctx.db, targetId, admin)
  logEvent(ctx.db, trainer.id, 'admin.roleChanged', { targetId, admin })
}
