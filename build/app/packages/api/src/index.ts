import { loadConfig } from './config.js'
import { createContext } from './context.js'
import { buildServer } from './server.js'
import { createBot, syncBotProfile } from './bot/index.js'
import { startScheduler, setReminderSender } from './jobs/scheduler.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const ctx = await createContext(config)

  const app = await buildServer(ctx)
  await app.listen({ port: config.PORT, host: config.HOST })
  app.log.info(`API auf http://${config.HOST}:${config.PORT} — öffentlich als ${config.PUBLIC_URL}`)

  const scheduler = startScheduler(ctx)

  // Long polling: no inbound port, no webhook URL to configure, and it keeps
  // working while the Cloudflare hostname is still being set up.
  const bot = createBot(ctx)
  await syncBotProfile(bot, config.PUBLIC_URL).catch((err: Error) =>
    console.warn('[bot] Profil konnte nicht gesetzt werden:', err.message),
  )
  // Der Bot ist jetzt bekannt: der Scheduler bekommt einen Weg, still zu
  // schreiben. disable_notification ist Absicht — eine Erinnerung soll im Chat
  // stehen, nicht klingeln.
  setReminderSender(async (telegramId, text, screen) => {
    await bot.api.sendMessage(Number(telegramId), text, {
      disable_notification: true,
      reply_markup: {
        inline_keyboard: [[{
          text: 'Öffnen',
          web_app: { url: `${config.PUBLIC_URL}#${screen}` },
        }]],
      },
    })
  })

  void bot.start({
    drop_pending_updates: true,
    onStart: (me) => {
      // Der Benutzername wird fuer die Deep-Links in Raid-Karten gebraucht.
      ctx.config.BOT_USERNAME = me.username
      console.log(`[bot] @${me.username} läuft (Long-Polling)`)
    },
  })

  const shutdown = async (signal: string) => {
    console.log(`\n[app] ${signal} — fahre herunter`)
    scheduler.stop()
    setReminderSender(null)
    await bot.stop().catch(() => {})
    await app.close().catch(() => {})
    ctx.db.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err: Error) => {
  console.error('[app] Start fehlgeschlagen:\n' + err.message)
  process.exit(1)
})
