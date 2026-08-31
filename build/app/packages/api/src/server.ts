import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import { existsSync, readFileSync } from 'node:fs'
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
    /*
     * Wem wir `X-Forwarded-For` glauben.
     *
     * Der Cloudflare-Tunnel beendet TLS, die echte Client-Adresse steht also
     * in der Kopfzeile. Ohne das saehe jede Anfrage aus wie vom Tunnel, und
     * die Ratenbegrenzung liefe fuer alle auf denselben Eimer.
     *
     * Aber nicht `true`: das glaubt die Kopfzeile *jedem*. Port 3010 liegt auf
     * dem LAN offen, also koennte dort jeder eine beliebige Adresse behaupten
     * und die Begrenzung damit umgehen. Vertraut wird nur den privaten Netzen,
     * durch die der Tunnel und der Proxy tatsaechlich sprechen.
     */
    trustProxy: ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'],
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

  /*
   * Die Kennung des ausgelieferten Baus, auf jeder API-Antwort.
   *
   * Eine Mini-App bleibt tagelang offen. Wer sie ueber einen Deploy hinweg
   * nicht neu laedt, spricht mit einem neuen Server und einer alten Oberflaeche
   * — und bekommt fuer jede Antwortart, die es beim Laden noch nicht gab,
   * irgendetwas Falsches angezeigt. Genau so gemeldet: neue Fundstuecke kamen
   * beim Spieler als "nichts gefunden" an, obwohl sie laengst im Beutel lagen.
   *
   * Der Dateiname des Haupt-Bundles traegt einen Inhalts-Hash und ist damit
   * genau die Kennung, die sich bei jedem echten Deploy aendert. Der Client
   * vergleicht sie und laedt einmal neu.
   */
  const buildId = readBuildId(join(here, '..', 'public'))
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/')) reply.header('x-app-build', buildId)
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
      /*
       * Ab @fastify/static 10 bekommt der Rueckruf die Fastify-Antwort statt
       * der rohen Node-Antwort — also `header()` und nicht `setHeader()`. Der
       * Sprung auf 10 war noetig: Version 8 hatte vier bekannte Luecken,
       * darunter Path-Traversal und die Umgehung von Routen-Schutz.
       */
      setHeaders(res, path) {
        res.header(
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

/** Der Inhalts-Hash des Haupt-Bundles, aus der index.html gelesen. */
function readBuildId(webRoot: string): string {
  try {
    const html = readFileSync(join(webRoot, 'index.html'), 'utf8')
    return /assets\/(index-[A-Za-z0-9_-]+\.js)/.exec(html)?.[1] ?? 'dev'
  } catch {
    return 'dev'
  }
}
