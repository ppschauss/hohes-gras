import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { existsSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppContext } from './context.js'
import { registerErrorHandler } from './routes/plugin.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerStateRoutes } from './routes/state.js'
import { registerGardenRoutes } from './routes/garden.js'
import { registerWorldRoutes } from './routes/world.js'
import { registerBattleRoutes } from './routes/battle.js'
import { registerSocialRoutes } from './routes/social.js'
import { registerCoopRoutes } from './routes/coop.js'
import { registerProgressionRoutes } from './routes/progression.js'
import { registerAccountRoutes } from './routes/account.js'

const here = dirname(fileURLToPath(import.meta.url))

export async function buildServer(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: ctx.config.LOG_LEVEL },
    // The Cloudflare tunnel terminates TLS, so the real client IP and protocol
    // arrive in X-Forwarded-*. Without this, every request looks like it came
    // from the tunnel container and rate limiting would key on one address.
    trustProxy: true,
    bodyLimit: 256 * 1024,
  })

  registerErrorHandler(app)

  await app.register(cors, {
    origin: (origin, cb) => {
      // Telegram's in-app browser sends no Origin for same-origin requests and
      // `https://web.telegram.org` for the desktop web client.
      if (!origin) return cb(null, true)
      const allowed = [ctx.config.PUBLIC_URL, 'https://web.telegram.org', 'https://webk.telegram.org', 'https://webz.telegram.org']
      cb(null, allowed.some((a) => origin === a) || ctx.config.NODE_ENV !== 'production')
    },
    methods: ['GET', 'POST', 'DELETE'],
    credentials: false,
  })

  registerAuthRoutes(app, ctx)
  registerStateRoutes(app, ctx)
  registerGardenRoutes(app, ctx)
  registerWorldRoutes(app, ctx)
  registerBattleRoutes(app, ctx)
  registerSocialRoutes(app, ctx)
  registerCoopRoutes(app, ctx)
  registerProgressionRoutes(app, ctx)
  registerAccountRoutes(app, ctx)

  // Locally mirrored sprites and backgrounds. Immutable filenames, so a long
  // cache is safe and keeps the Cloudflare edge doing the work.
  if (existsSync(ctx.config.mediaDir)) {
    await app.register(fastifyStatic, {
      root: ctx.config.mediaDir,
      prefix: '/media/',
      decorateReply: false,
      maxAge: '365d',
      immutable: true,
    })
  }

  const webRoot = join(here, '..', 'public')
  if (existsSync(webRoot)) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: '/',
      decorateReply: true,
      // Die eigene Cache-Steuerung von @fastify/static abschalten: sie setzt
      // ihren Header nach `setHeaders` und wuerde ihn sonst ueberschreiben.
      cacheControl: false,
      /**
       * Zwei verschiedene Lebensdauern, und die Unterscheidung ist wichtig.
       *
       * Die Dateien unter /assets/ tragen einen Inhalts-Hash im Namen: aendert
       * sich der Inhalt, aendert sich der Name. Sie duerfen ewig im Cache
       * liegen.
       *
       * `index.html` traegt keinen Hash — sie ist die Datei, die auf die
       * aktuellen Hashes zeigt. Wird sie zwischengespeichert, laedt der Client
       * nach einem Deploy weiter die alte App und findet die darin genannten
       * Dateien womoeglich gar nicht mehr. Genau das ist passiert: eine Stunde
       * Cache auf index.html hat neue Funktionen unsichtbar gemacht.
       */
      setHeaders(res, path) {
        res.setHeader(
          'cache-control',
          path.includes(`${sep}assets${sep}`)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache, must-revalidate',
        )
      },
    })
  } else {
    app.log.warn(`Mini-App nicht gefunden unter ${webRoot} — nur die API ist erreichbar.`)
  }

  // Genau ein 404-Handler fuer die gesamte Instanz: API-Pfade antworten als
  // JSON, alles andere faellt auf die Single-Page-App zurueck.
  const hasWeb = existsSync(webRoot)
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/media/') || !hasWeb) {
      reply.status(404).send({ error: 'not_found' })
      return
    }
    reply.sendFile('index.html')
  })

  return app
}
