import { GameError, type Trainer } from '@game/shared'
import {
  findQuest, questsFor, QUESTS_PER_DAY, QUESTS_PER_WEEK,
  type QuestCadence, type QuestMetric, type QuestSpec,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as quests from '../repos/quests.js'
import * as inventory from '../repos/inventory.js'
import { logEvent } from '../repos/events.js'
import { gameDate } from '../worldClock.js'
import { weekKey } from './guilds.js'

/**
 * Aufgaben.
 *
 * Die Regeln stehen in `engine/quests.ts`; hier steht, was die Datenbank davon
 * merkt und wo der Fortschritt herkommt.
 *
 * Gezählt wird über dieselbe Meldung, die schon die Erfolge und das
 * Gildenziel füttert — `bumpMetric`. Eine Aufgabe braucht deshalb meist keinen
 * neuen Aufruf an der Stelle, wo etwas passiert.
 */

/** Der Schlüssel des laufenden Zeitraums. */
export const periodKey = (cadence: QuestCadence): string =>
  (cadence === 'daily' ? gameDate() : weekKey())

/** Beide laufenden Zeiträume mit ihren Aufgaben. */
function activeSpecs(): Array<{ cadence: QuestCadence; key: string; specs: QuestSpec[] }> {
  return (['daily', 'weekly'] as const).map((cadence) => {
    const key = periodKey(cadence)
    return { cadence, key, specs: questsFor(cadence, key) }
  })
}

export interface QuestView {
  id: string
  cadence: QuestCadence
  metric: QuestMetric
  target: number
  progress: number
  complete: boolean
  claimed: boolean
  reward: { gold: number; items: Array<{ itemId: string; name: string; icon: string; quantity: number }> }
}

export function view(ctx: AppContext, trainer: Trainer) {
  const out: QuestView[] = []
  for (const { cadence, key, specs } of activeSpecs()) {
    for (const spec of specs) quests.ensure(ctx.db, trainer.id, key, spec.id)
    const rows = new Map(quests.of(ctx.db, trainer.id, key).map((r) => [r.questId, r]))
    for (const spec of specs) {
      const row = rows.get(spec.id)
      out.push({
        id: spec.id,
        cadence,
        metric: spec.metric,
        target: spec.target,
        progress: row?.progress ?? 0,
        complete: (row?.progress ?? 0) >= spec.target,
        claimed: row?.claimedAt != null,
        reward: {
          gold: spec.reward.gold,
          items: (spec.reward.items ?? []).map((i) => {
            const item = ctx.registry.tryItem(i.itemId)
            return {
              itemId: i.itemId,
              name: item ? ctx.registry.localized(item.name, trainer.locale) : i.itemId,
              icon: item?.icon ?? '',
              quantity: i.quantity,
            }
          }),
        },
      })
    }
  }
  return {
    daily: out.filter((q) => q.cadence === 'daily'),
    weekly: out.filter((q) => q.cadence === 'weekly'),
    perDay: QUESTS_PER_DAY,
    perWeek: QUESTS_PER_WEEK,
    /** Wann der Tag umschlägt — Mitternacht in Europe/Berlin. */
    dayKey: periodKey('daily'),
    weekKey: periodKey('weekly'),
  }
}

/**
 * Eine Handlung melden.
 *
 * Wird aus `bumpMetric` aufgerufen und trifft beide Zeiträume auf einmal: eine
 * Fangaufgabe kann heute *und* diese Woche laufen, und dann zählt derselbe Fang
 * für beide. Alles andere wäre eine Buchhaltung, die niemand nachvollzieht.
 */
export function record(ctx: AppContext, trainerId: string, metric: string, amount: number): void {
  for (const { key, specs } of activeSpecs()) {
    for (const spec of specs) {
      if (spec.metric !== metric) continue
      quests.ensure(ctx.db, trainerId, key, spec.id)
      quests.addProgress(ctx.db, trainerId, key, spec.id, amount)
    }
  }
}

export interface QuestClaim {
  questId: string
  gold: number
  items: Array<{ itemId: string; quantity: number }>
}

export function claim(ctx: AppContext, trainer: Trainer, questId: string): QuestClaim {
  const spec = findQuest(questId)
  if (!spec) throw new GameError('not_found', { questId }, 404)

  return tx(ctx.db, () => {
    const key = periodKey(spec.cadence)
    // Nur was gerade gestellt ist: eine alte Aufgabe laesst sich nicht
    // nachtraeglich einloesen, auch wenn ihre Zeile noch herumliegt.
    if (!questsFor(spec.cadence, key).some((q) => q.id === questId)) {
      throw new GameError('invalid_state', { reason: 'no_quest' }, 409)
    }
    const row = quests.one(ctx.db, trainer.id, key, questId)
    if (!row) throw new GameError('invalid_state', { reason: 'no_quest' }, 409)
    if (row.claimedAt !== null) throw new GameError('invalid_state', { reason: 'already_claimed' }, 409)
    if (row.progress < spec.target) {
      throw new GameError('invalid_state', { reason: 'goal_incomplete' }, 409)
    }
    if (!quests.claim(ctx.db, trainer.id, key, questId, spec.target)) {
      throw new GameError('invalid_state', { reason: 'already_claimed' }, 409)
    }

    inventory.earnGold(ctx.db, trainer.id, spec.reward.gold)
    const items = spec.reward.items ?? []
    for (const i of items) {
      if (ctx.registry.tryItem(i.itemId)) inventory.grant(ctx.db, trainer.id, i.itemId, i.quantity)
    }
    logEvent(ctx.db, trainer.id, 'quest.claimed', { questId, gold: spec.reward.gold })
    return { questId, gold: spec.reward.gold, items: [...items] }
  })
}
