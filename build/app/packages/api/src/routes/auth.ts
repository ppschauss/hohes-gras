import type { FastifyInstance } from 'fastify'
import { AuthRequestSchema, GameError, type AuthResponse } from '@game/shared'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import { displayNameOf, verifyInitData } from '../auth/initData.js'
import { issueSession } from '../auth/session.js'
import { countTrainers, createTrainer, findById, findByTelegramId, updateDisplayName } from '../repos/trainers.js'
import { logEvent } from '../repos/events.js'
import { rateLimit, requireTrainer } from './plugin.js'
import * as link from '../services/link.js'
import { listSessions, revokeOtherSessions, revokeSession } from '../auth/session.js'
import { z } from 'zod'

const STARTING_GOLD = 500

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'action')] }

  /* ------------------------------------------------ Browser verbinden */

  // Code ausstellen: nur aus einer bestehenden, angemeldeten Sitzung heraus.
  app.post('/api/auth/link/code', auth, async (req) => {
    const code = link.createCode(ctx, req.trainer!)
    return { code: code.formatted, expiresAt: code.expiresAt }
  })

  // Code einloesen: der einzige Endpunkt ohne Anmeldung, entsprechend eng
  // begrenzt.
  app.post('/api/auth/link/redeem', { preHandler: [rateLimit(ctx, 'link')] }, async (req) => {
    const { code } = z.object({ code: z.string().min(1).max(32) }).parse(req.body)
    const result = link.redeem(ctx, code, String(req.headers['user-agent'] ?? ''))

    // Zwischen Ausstellen und Einloesen kann gesperrt worden sein.
    const trainer = findById(ctx.db, result.trainerId)
    if (!trainer) throw new GameError('unauthorized', {}, 401)
    if (trainer.isBanned) throw new GameError('banned', {}, 403)

    return { token: result.token, expiresAt: result.expiresAt, trainer }
  })

  /* --------------------------------------------- Verknuepfte Sitzungen */

  app.get('/api/sessions', auth, async (req) => ({
    sessions: listSessions(ctx.db, req.trainer!.id, req.sessionId ?? null),
  }))

  app.delete('/api/sessions/:id', auth, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params)
    if (!revokeSession(ctx.db, req.trainer!.id, id)) throw new GameError('not_found', {}, 404)
    logEvent(ctx.db, req.trainer!.id, 'session.revoked', { sessionId: id })
    return { sessions: listSessions(ctx.db, req.trainer!.id, req.sessionId ?? null) }
  })

  app.post('/api/sessions/revoke-others', auth, async (req) => {
    const removed = revokeOtherSessions(ctx.db, req.trainer!.id, req.sessionId ?? '')
    logEvent(ctx.db, req.trainer!.id, 'session.revoked', { count: removed })
    return { removed, sessions: listSessions(ctx.db, req.trainer!.id, req.sessionId ?? null) }
  })

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

    /*
     * Neuer Trainer. Jeder mit dem Link darf mitspielen.
     *
     * Frueher stand hier eine Einladungsschranke. Sie ist raus: sie hat den
     * Kreis klein gehalten, den sie schuetzen sollte, und der Aufwand lag bei
     * dem, der einladen wollte. Wer den Bot findet, spielt.
     *
     * Admin bleibt geregelt: der erste ueberhaupt, oder wer in `secrets.env`
     * als `ADMIN_TELEGRAM_ID` steht.
     */
    const isFirstEver = countTrainers(ctx.db) === 0
    const isConfiguredAdmin = ctx.config.adminTelegramId !== null && ctx.config.adminTelegramId === user.id
    const isAdmin = isFirstEver || isConfiguredAdmin

    const created = tx(ctx.db, () => {
      const trainer = createTrainer(ctx.db, {
        telegramId: user.id,
        displayName: displayNameOf(user),
        locale: user.languageCode.startsWith('de') ? 'de' : 'de',
        isAdmin,
        startingGold: STARTING_GOLD,
        startingAreaId: ctx.registry.manifest.startingArea,
      })
      logEvent(ctx.db, trainer.id, 'trainer.created', { isAdmin })
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
