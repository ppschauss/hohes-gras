import type { FastifyInstance } from 'fastify'
import { AuthRequestSchema, GameError, type AuthResponse } from '@game/shared'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import { displayNameOf, verifyInitData } from '../auth/initData.js'
import { issueSession } from '../auth/session.js'
import { checkInvite, redeemInvite } from '../repos/invites.js'
import { countTrainers, createTrainer, findByTelegramId, updateDisplayName } from '../repos/trainers.js'
import { logEvent } from '../repos/events.js'
import { rateLimit } from './plugin.js'

const STARTING_GOLD = 500

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/auth/session', { preHandler: [rateLimit(ctx, 'auth')] }, async (req, reply) => {
    const body = AuthRequestSchema.parse(req.body)

    const verified = verifyInitData(body.initData, ctx.config.BOT_TOKEN)
    if (!verified.ok) {
      // Signature problems and expiry are the same thing to the client: log in
      // again. Distinguishing them would only help someone probing the endpoint.
      req.log.warn({ reason: verified.reason }, 'initData abgelehnt')
      throw new GameError('unauthorized', { reason: verified.reason }, 401)
    }
    const { user } = verified

    const existing = findByTelegramId(ctx.db, user.id)
    if (existing) {
      if (existing.isBanned) throw new GameError('banned', {}, 403)
      const freshName = displayNameOf(user)
      if (freshName !== existing.displayName) updateDisplayName(ctx.db, existing.id, freshName)
      const session = issueSession(ctx.db, ctx.config.SESSION_SECRET, existing.id, String(req.headers['user-agent'] ?? ''))
      const response: AuthResponse = {
        token: session.token,
        expiresAt: session.expiresAt,
        trainer: { ...existing, displayName: freshName },
        isNewTrainer: false,
      }
      return reply.send(response)
    }

    // New account. The invite may come from the form field or from a deep link
    // (`t.me/bot/app?startapp=CODE`), which Telegram forwards as start_param.
    const isFirstEver = countTrainers(ctx.db) === 0
    const isConfiguredAdmin = ctx.config.adminTelegramId !== null && ctx.config.adminTelegramId === user.id
    const skipsInvite = isFirstEver || isConfiguredAdmin

    const code = (body.inviteCode ?? verified.startParam ?? '').trim().toUpperCase()
    if (!skipsInvite) {
      if (!code) throw new GameError('invite_required', {}, 403)
      const check = checkInvite(ctx.db, code)
      if (!check.ok) throw new GameError('invite_invalid', { reason: check.reason }, 403)
    }

    const created = tx(ctx.db, () => {
      const trainer = createTrainer(ctx.db, {
        telegramId: user.id,
        displayName: displayNameOf(user),
        locale: user.languageCode.startsWith('de') ? 'de' : 'de',
        isAdmin: skipsInvite,
        startingGold: STARTING_GOLD,
        startingAreaId: ctx.registry.manifest.startingArea,
      })
      if (!skipsInvite && code) redeemInvite(ctx.db, code, trainer.id)
      logEvent(ctx.db, trainer.id, 'trainer.created', { viaInvite: skipsInvite ? null : code, isAdmin: skipsInvite })
      return trainer
    })

    req.log.info({ trainerId: created.id, telegramId: user.id, admin: created.isAdmin }, 'neuer Trainer')
    const session = issueSession(ctx.db, ctx.config.SESSION_SECRET, created.id, String(req.headers['user-agent'] ?? ''))
    const response: AuthResponse = {
      token: session.token,
      expiresAt: session.expiresAt,
      trainer: created,
      isNewTrainer: true,
    }
    return reply.send(response)
  })
}
