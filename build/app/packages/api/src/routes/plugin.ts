import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { GameError, type Trainer } from '@game/shared'
import type { AppContext } from '../context.js'
import { resolveSession } from '../auth/session.js'
import { findById, touchLastSeen } from '../repos/trainers.js'
import { consume, type BucketName } from '../repos/rateLimit.js'
import { state as energyState } from '../services/energy.js'

declare module 'fastify' {
  interface FastifyRequest {
    trainer?: Trainer
    /** Kennung der Sitzung, mit der die Anfrage kam. Die Sitzungsliste braucht
     *  sie, um "dieses Geraet" zu markieren, ohne den Token zu kennen. */
    sessionId?: string
  }
}

/** Read the bearer token, resolve the session, and reject banned accounts.
 *  Routes opt in by calling this in a preHandler — there is no global hook, so
 *  a new public endpoint cannot accidentally inherit auth it does not want. */
export function requireTrainer(ctx: AppContext) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const header = req.headers.authorization ?? ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    const session = resolveSession(ctx.db, ctx.config.SESSION_SECRET, token)
    if (!session) throw new GameError('unauthorized', {}, 401)

    const trainer = findById(ctx.db, session.trainerId)
    if (!trainer) throw new GameError('unauthorized', {}, 401)
    if (trainer.isBanned) throw new GameError('banned', {}, 403)

    req.trainer = trainer
    req.sessionId = session.id
    touchLastSeen(ctx.db, trainer.id)
  }
}

export function rateLimit(ctx: AppContext, bucket: BucketName) {
  return async (req: FastifyRequest): Promise<void> => {
    const subject = req.trainer?.id ?? `ip:${req.ip}`
    consume(ctx.db, subject, bucket)
  }
}

/** Turn every thrown error into the shape the client knows how to display, and
 *  keep internal messages out of the response body. */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof GameError) {
      reply.status(err.httpStatus).send({ error: err.code, detail: err.detail })
      return
    }
    // Ein kaputter Request-Body ist die Schuld des Clients, nicht des Servers.
    // Ohne diesen Zweig wird ein ZodError zu einem 500 und verschwindet als
    // "internal" — genau die Klasse Fehler, die man beim Debuggen sucht.
    if (err instanceof ZodError) {
      reply.status(400).send({
        error: 'validation_failed',
        detail: { fields: err.issues.map((i) => i.path.join('.')).filter(Boolean) },
      })
      return
    }
    if ((err as { validation?: unknown }).validation) {
      reply.status(400).send({ error: 'validation_failed' })
      return
    }
    req.log.error({ err }, 'unbehandelter Fehler')
    reply.status(500).send({ error: 'internal' })
  })

  // Der 404-Handler wird bewusst NICHT hier gesetzt: Fastify erlaubt nur einen
  // pro Praefix, und server.ts braucht ihn fuer den SPA-Fallback.
}

/**
 * Antwort einer Aktion, die Energie kostet.
 *
 * Die Kopfzeile im Client aktualisiert sich aus jeder Antwort, die ein Feld
 * `energy` mitbringt — und genau das fehlte ausgerechnet den Endpunkten, die
 * Energie *verbrauchen*: Pflege, Erkunden, Kampf, Raid, Duell, Beetpflege.
 * Der Balken stand deshalb still, bis irgendwann ein Neuladen oder ein
 * Tabwechsel den Stand vom Server holte.
 *
 * Statt die Zeile an sechs Stellen einzeln zu ergaenzen — und sie bei der
 * siebten wieder zu vergessen — haengt sie hier an einer Stelle.
 */
export function withEnergy<T extends object>(
  ctx: AppContext, trainerId: string, payload: T,
): T & { energy: ReturnType<typeof energyState> } {
  return { ...payload, energy: energyState(ctx, trainerId) }
}
