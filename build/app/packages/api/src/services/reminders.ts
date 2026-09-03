import type { AppContext } from '../context.js'
import { gameDate, berlinParts } from '../worldClock.js'
import * as expeditions from '../repos/expeditions.js'
import * as eggsRepo from '../repos/eggs.js'
import * as raidsRepo from '../repos/raids.js'
import * as guildsRepo from '../repos/guilds.js'
import * as pvpRepo from '../repos/pvp.js'
import * as creatures from '../repos/creatures.js'
import { counterValue } from '../repos/counters.js'
import * as energy from './energy.js'
import { ENERGY_COSTS } from '@game/engine'

/**
 * Daily reminder.
 *
 * The rule from the original is one quiet message per day, at most. That is a
 * hard constraint, not a default: a game that pings people twice gets muted,
 * and a muted bot cannot remind anyone of anything.
 *
 * Only one thing is mentioned per message — the most time-critical one. A list
 * of five things is a chore; one sentence is a nudge.
 */

export interface Reminder {
  trainerId: string
  telegramId: string
  kind: string
  text: string
  /** Deep link target inside the Mini App. */
  screen: string
}

/** Sending window in local time. Nobody wants a game notification at 03:00. */
export const SEND_FROM_HOUR = 17
export const SEND_TO_HOUR = 21

export function isWithinSendWindow(at = new Date()): boolean {
  const { hour } = berlinParts(at)
  return hour >= SEND_FROM_HOUR && hour < SEND_TO_HOUR
}

function alreadySentToday(ctx: AppContext, trainerId: string, date = gameDate()): boolean {
  const row = ctx.db
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE trainer_id = ? AND game_date = ?')
    .get(trainerId, date) as { n: number }
  return row.n > 0
}

export function recordSent(ctx: AppContext, trainerId: string, kind: string, payload: Record<string, unknown> = {}): void {
  ctx.db.prepare('INSERT INTO notifications (trainer_id, kind, sent_at, game_date, payload) VALUES (?, ?, ?, ?, ?)')
    .run(trainerId, kind, Date.now(), gameDate(), JSON.stringify(payload))
}

/**
 * Decide what — if anything — is worth saying to one trainer.
 *
 * Ordered by how much the player loses by not knowing: an expedition that
 * finished hours ago is wasted time, a raid that expires tonight is a missed
 * group effort, unused care actions are only a small nudge.
 */
export function reminderFor(ctx: AppContext, trainer: { id: string; telegramId: string; displayName: string; privacy: { reminders: boolean }; lastSeenAt: number }): Reminder | null {
  if (!trainer.privacy.reminders) return null
  if (alreadySentToday(ctx, trainer.id)) return null

  // Someone who used the app in the last few hours does not need reminding.
  const hoursAway = (Date.now() - trainer.lastSeenAt) / 3_600_000
  if (hoursAway < 6) return null

  const now = Date.now()
  const base = { trainerId: trainer.id, telegramId: trainer.telegramId }

  const readyExpeditions = expeditions.openOf(ctx.db, trainer.id).filter((e) => e.endsAt <= now)
  if (readyExpeditions.length > 0) {
    return {
      ...base, kind: 'expedition', screen: 'expeditions',
      text: readyExpeditions.length === 1
        ? 'Deine Expedition ist zurück. Die Beute wartet.'
        : `${readyExpeditions.length} Expeditionen sind zurück.`,
    }
  }

  const readyEggs = eggsRepo.openOf(ctx.db, trainer.id)
    .filter((e) => e.startedAt + e.hatchMinutes * 60_000 <= now)
  if (readyEggs.length > 0) {
    return {
      ...base, kind: 'egg', screen: 'eggs',
      text: readyEggs.length === 1 ? 'Ein Ei wackelt. Es ist so weit.' : `${readyEggs.length} Eier sind bereit.`,
    }
  }

  const guild = guildsRepo.guildOf(ctx.db, trainer.id)
  if (guild) {
    const raids = raidsRepo.openForGuild(ctx.db, guild.id)
      .filter((r) => r.expiresAt - now < 4 * 3_600_000)
    if (raids.length > 0) {
      const raid = raids[0]!
      const species = ctx.registry.trySpecies(raid.speciesId)
      const name = species ? ctx.registry.localized(species.name, 'de') : 'Ein Raid-Boss'
      const mine = raidsRepo.participant(ctx.db, raid.id, trainer.id)
      if (!mine || mine.attacks < 5) {
        return {
          ...base, kind: 'raid', screen: 'coop',
          text: `${name} läuft heute noch weg. Deine Gilde kämpft ohne dich.`,
        }
      }
    }
  }

  const defended = pvpRepo.unseenDefences(ctx.db, trainer.id)
  if (defended > 0) {
    return {
      ...base, kind: 'pvp', screen: 'coop',
      text: defended === 1
        ? 'Jemand hat dein Team herausgefordert. Sieh nach, wie es ausging.'
        : `${defended} Trainer haben dein Team herausgefordert.`,
    }
  }

  const team = creatures.teamOf(ctx.db, trainer.id)
  if (team.length > 0) {
    const used = counterValue(ctx.db, trainer.id, 'care')
    const energyState = energy.state(ctx, trainer.id)
    if (used === 0 && energyState.current >= ENERGY_COSTS.care) {
      const names = team.slice(0, 2).map((c) => {
        const species = ctx.registry.trySpecies(c.speciesId)
        return c.nickname ?? (species ? ctx.registry.localized(species.name, 'de') : '?')
      })
      return {
        ...base, kind: 'care', screen: 'garden',
        text: `${names.join(' und ')} warten im Garten. Deine Energie reicht für ${Math.floor(energyState.current / ENERGY_COSTS.care)} Pflegeaktionen.`,
      }
    }
  }

  return null
}

/** All reminders due right now. */
export function dueReminders(ctx: AppContext): Reminder[] {
  if (!isWithinSendWindow()) return []

  const candidates = ctx.db
    .prepare(
      `SELECT id, telegram_id AS telegramId, display_name AS displayName,
              last_seen_at AS lastSeenAt, reminders
       -- Bots bleiben draussen: eine erfundene Telegram-Kennung laesst jeden Versuch
       -- scheitern, und der Fehlschlag wuerde taeglich neu protokolliert.
       FROM trainers WHERE is_banned = 0 AND reminders = 1 AND is_bot = 0`,
    )
    .all() as Array<{ id: string; telegramId: string; displayName: string; lastSeenAt: number; reminders: number }>

  return candidates.flatMap((row) => {
    const reminder = reminderFor(ctx, {
      id: row.id, telegramId: row.telegramId, displayName: row.displayName,
      lastSeenAt: row.lastSeenAt, privacy: { reminders: row.reminders === 1 },
    })
    return reminder ? [reminder] : []
  })
}
