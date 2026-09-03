import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { AppContext } from '../context.js'
import { purgeExpiredSessions } from '../auth/session.js'
import { purgeStaleRateLimits } from '../repos/rateLimit.js'
import { gameDate } from '../worldClock.js'
import { resolve as resolveTournament, currentWeek } from '../services/tournament.js'
import { dueReminders, recordSent } from '../services/reminders.js'
import { purgeOldCounters } from '../repos/counters.js'
import { purgeStalePulses } from '../repos/pulse.js'
import { abandonStale } from '../repos/battles.js'
import {
  joinIfNeeded, linkNew, pushCodes, pushMarket, pushProfiles, refreshLeaderboard, refreshMarket,
  refreshRelease, releaseInfo,
} from '../services/hub.js'
import { settle as settleHubMarket } from '../services/hubMarket.js'
import { tick as botTick } from '../services/botPlayer.js'

export interface Job {
  name: string
  everyMs: number
  run: (ctx: AppContext) => void | Promise<void>
}

/**
 * How a reminder actually reaches Telegram.
 *
 * The scheduler does not import the bot: that would tie housekeeping to the
 * messaging layer and make the whole thing untestable. Instead the entry point
 * installs a sender once the bot is running.
 */
export type ReminderSender = (telegramId: string, text: string, screen: string) => Promise<void>

let sendReminder: ReminderSender | null = null

export function setReminderSender(sender: ReminderSender | null): void {
  sendReminder = sender
}

/** Housekeeping that must happen whether or not anyone is playing. Later phases
 *  append jobs here (finishing expeditions, hatching eggs, season rollover). */
export const JOBS: Job[] = [
  {
    /*
     * Die Bots spielen.
     *
     * Zwanzig Minuten sind mit Bedacht gewaehlt: haeufiger braechte nichts,
     * weil die Energie nicht schneller nachwaechst, und seltener liesse die
     * Rangliste ueber Stunden stillstehen. Der erste Durchlauf legt die
     * Konten an, jeder weitere findet sie vor.
     */
    name: 'bot-players',
    everyMs: 20 * 60_000,
    run: (ctx) => {
      const berichte = botTick(ctx)
      const getan = berichte.filter((b) => b.erkundet + b.gefangen + b.gepflegt + b.angeboten > 0)
      if (getan.length) {
        console.log('[job] Bots: ' + getan
          .map((b) => `${b.name} ${b.erkundet}x erkundet, ${b.gefangen} gefangen, ${b.gepflegt} gepflegt`)
          .join(' | '))
      }
    },
  },
  {
    name: 'purge-sessions',
    everyMs: 15 * 60_000,
    run: (ctx) => {
      const n = purgeExpiredSessions(ctx.db)
      if (n) console.log(`[job] ${n} abgelaufene Sessions entfernt`)
    },
  },
  {
    name: 'purge-rate-limits',
    everyMs: 15 * 60_000,
    run: (ctx) => { purgeStaleRateLimits(ctx.db) },
  },
  {
    name: 'reminders',
    // Alle 30 Minuten pruefen; das Fenster und die Ein-Nachricht-pro-Tag-Regel
    // stecken im Dienst, nicht im Takt.
    everyMs: 30 * 60_000,
    run: async (ctx) => {
      if (!sendReminder) return
      const due = dueReminders(ctx)
      for (const reminder of due) {
        try {
          await sendReminder(reminder.telegramId, reminder.text, reminder.screen)
          recordSent(ctx, reminder.trainerId, reminder.kind, { screen: reminder.screen })
        } catch (err) {
          // Eine blockierte Konversation ist kein Fehler des Servers; trotzdem
          // festhalten, damit derselbe Trainer heute nicht erneut versucht wird.
          recordSent(ctx, reminder.trainerId, `${reminder.kind}:failed`, { error: (err as Error).message })
        }
      }
      if (due.length) console.log(`[job] ${due.length} Erinnerungen verschickt`)
    },
  },
  {
    // Vergessene Kaempfe schliessen. Ohne das blockiert ein Kampf, den jemand
    // durch Schliessen der App verlassen hat, auf Dauer Heilen, Ueberfaelle
    // und jeden weiteren Kampf.
    name: 'abandon-stale-battles',
    everyMs: 3_600_000,
    run: (ctx) => { abandonStale(ctx.db) },
  },
  {
    name: 'purge-pulses',
    everyMs: 3_600_000,
    run: (ctx) => { purgeStalePulses(ctx.db, Date.now() - 3_600_000) },
  },
  {
    name: 'purge-counters',
    everyMs: 6 * 60 * 60_000,
    run: (ctx) => { purgeOldCounters(ctx.db) },
  },
  {
    name: 'tournament',
    everyMs: 30 * 60_000,
    run: (ctx) => {
      // Offene Turniere aufloesen, deren Frist abgelaufen ist. Idempotent:
      // resolve() prueft Zustand und Frist selbst.
      const rows = ctx.db
        .prepare("SELECT week_key AS week FROM tournaments WHERE state != 'finished'")
        .all() as Array<{ week: string }>
      for (const row of rows) {
        const result = resolveTournament(ctx, row.week)
        if (result.resolved) console.log(`[job] Turnier ${row.week} aufgeloest (${result.placements} Platzierungen)`)
      }
      // Die laufende Woche anlegen, damit es immer eine offene Anmeldung gibt.
      void currentWeek()
    },
  },
  {
    /*
     * Die Treuhand.
     *
     * Eigener Lauf und ein viel kuerzerer Takt als der uebrige Abgleich: ein
     * Kauf ist eine Sache zwischen zwei Menschen, die beide warten. Zehn
     * Minuten waeren fuer einen Aushang richtig und fuer einen bezahlten
     * Vorgang unertraeglich.
     *
     * Er kostet wenig: eine Anfrage, und nur wenn wirklich etwas offen ist,
     * folgen weitere.
     */
    name: 'hub-escrow',
    everyMs: 60_000,
    run: async (ctx) => {
      if (!ctx.config.hubEnabled) return
      const getan = await settleHubMarket(ctx)
      if (getan) console.log(`[job] Treuhand: ${getan} Schritte`)
    },
  },
  {
    // Verbund. Tut nichts, solange keiner eingerichtet ist — und wenn einer
    // eingerichtet ist, aber schweigt, wird das geloggt und sonst nichts.
    name: 'hub-sync',
    everyMs: 10 * 60_000,
    run: async (ctx) => {
      if (!ctx.config.hubEnabled) return
      /*
       * Zuerst die eigene Anmeldung.
       *
       * Ohne Kennung ist jede weitere Anfrage ein 401. `joinIfNeeded` tut in
       * aller Regel nichts — nur eine Installation, die mit einem
       * Beitrittsschluessel aufgesetzt wurde, holt hier ihr Geheimnis.
       */
      if (await joinIfNeeded(ctx) === 'blocked') return
      const linked = await linkNew(ctx)
      // Codes von frueher angemeldeten Trainern nachreichen.
      const codes = await pushCodes(ctx)
      const pushed = await pushProfiles(ctx)
      const rows = await refreshLeaderboard(ctx)
      // Der Aushang: eigene Angebote hoch, fremde herunter. Beides im selben
      // Takt wie die Rangliste — ein Marktplatz aendert sich nicht schneller.
      const angeboten = await pushMarket(ctx)
      const fremde = await refreshMarket(ctx)
      if (linked || pushed || codes || angeboten || fremde) {
        console.log(`[job] Verbund: ${linked} angemeldet, ${codes} Codes, ${pushed} Profile, `
          + `${rows} in der Rangliste, ${angeboten} Angebote hoch, ${fremde} herunter`)
      }

      /*
       * Den aktuellen Stand erfragen und den Betreiber einmal benachrichtigen.
       *
       * Einmal je Stand, nicht je Lauf: eine Nachricht alle zehn Minuten waere
       * keine Nachricht, sondern eine Belaestigung. Der Zaehler steht in
       * `hub_cache`, damit ein Neustart ihn nicht vergisst.
       */
      await refreshRelease(ctx)
      const info = releaseInfo(ctx)
      if (info.outdated && sendReminder) {
        const gemeldet = ctx.db.prepare("SELECT payload FROM hub_cache WHERE key = 'release_notified'")
          .get() as { payload: string } | undefined
        if (gemeldet?.payload !== info.latest) {
          const admin = ctx.db.prepare('SELECT telegram_id AS tg FROM trainers WHERE is_admin = 1 ORDER BY created_at LIMIT 1')
            .get() as { tg: string } | undefined
          if (admin) {
            const text = `Neuer Stand verfügbar: \`${info.latest}\`${info.notes ? `\n${info.notes}` : ''}`
              /*
               * Der Weg muss stimmen, sonst sucht der Betreiber vergeblich.
               * Der Bereich hiess einmal "Designs" und lag unter Fortschritt;
               * er heisst jetzt "Einstellungen" und steht fuer sich. Genau
               * dieser Umzug wurde damals gemeldet — die Nachricht hier ist
               * ihm nicht gefolgt und schickte seitdem an einen Reiter, den
               * es nicht mehr gibt.
               */
              + '\n\nDu läufst auf `' + info.current + '`. In der App unter '
              + '*Einstellungen → Konto & Daten* steht ein Knopf zum Aktualisieren.'
            await sendReminder(admin.tg, text, 'progress').catch(() => { /* Chat blockiert */ })
            ctx.db.prepare(
              `INSERT INTO hub_cache (key, payload, fetched_at) VALUES ('release_notified', ?, ?)
               ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
            ).run(info.latest, Date.now())
          }
        }
      }
    },
  },
  {
    name: 'backup',
    everyMs: 24 * 60 * 60_000,
    run: (ctx) => {
      mkdirSync(ctx.config.backupsDir, { recursive: true })
      const target = join(ctx.config.backupsDir, `game-${gameDate()}.db`)
      // better-sqlite3's backup is online and consistent, so this is safe to
      // run while requests are being served.
      ;(ctx.db as unknown as { backup: (p: string) => Promise<unknown> }).backup(target)
        .then(() => console.log(`[job] Backup geschrieben: ${target}`))
        .catch((err: Error) => console.error('[job] Backup fehlgeschlagen:', err.message))
    },
  },
]

export interface SchedulerHandle { stop: () => void }

export function startScheduler(ctx: AppContext, jobs: Job[] = JOBS): SchedulerHandle {
  const timers = jobs.map((job) => {
    const tick = async () => {
      try {
        await job.run(ctx)
      } catch (err) {
        console.error(`[job] "${job.name}" fehlgeschlagen:`, (err as Error).message)
      }
    }
    void tick()
    const timer = setInterval(tick, job.everyMs)
    timer.unref()
    return timer
  })
  return { stop: () => timers.forEach(clearInterval) }
}
