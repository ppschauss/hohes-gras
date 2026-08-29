import { GameError, type Trainer } from '@game/shared'
import {
  claimLogin, isLoginBonusDay, LOGIN_CYCLE_DAYS, LOGIN_REWARDS, LOGIN_WEEK_DAYS,
  loginRewardFor, type LoginReward, type LoginState,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as inventory from '../repos/inventory.js'
import { logEvent } from '../repos/events.js'
import { gameDate } from '../worldClock.js'
import * as energy from './energy.js'

/** Das Spieldatum von gestern — die Grenze, an der eine Serie reißt. */
const yesterdayDate = (at = new Date()): string => gameDate(new Date(at.getTime() - 86_400_000))

function stateOf(ctx: AppContext, trainerId: string): LoginState & { best: number; claimed: number } {
  const row = ctx.db
    .prepare('SELECT day, streak, best_streak AS best, claimed, last_date AS lastDate FROM login_rewards WHERE trainer_id = ?')
    .get(trainerId) as { day: number; streak: number; best: number; claimed: number; lastDate: string | null } | undefined
  return row ?? { day: 0, streak: 0, best: 0, claimed: 0, lastDate: null }
}

export function describeReward(ctx: AppContext, trainer: Trainer, reward: LoginReward): string {
  if (reward.kind === 'gold') return `${reward.amount} Gold`
  if (reward.kind === 'energy') return `${reward.amount} Energie`
  const item = ctx.registry.tryItem(reward.itemId)
  const name = item ? ctx.registry.localized(item.name, trainer.locale) : reward.itemId
  return `${reward.quantity}× ${name}`
}

export function view(ctx: AppContext, trainer: Trainer) {
  const state = stateOf(ctx, trainer.id)
  const today = gameDate()
  const claimable = state.lastDate !== today
  // Welcher Tag heute anstünde — dieselbe Rechnung wie beim Abholen, damit die
  // Vorschau nicht etwas anderes verspricht, als der Knopf dann gibt.
  const next = claimLogin(state, today, yesterdayDate()) ?? state

  return {
    day: state.day,
    streak: state.streak,
    bestStreak: state.best,
    claimedTotal: state.claimed,
    cycleDays: LOGIN_CYCLE_DAYS,
    weekDays: LOGIN_WEEK_DAYS,
    claimable,
    /** Der Tag, den der Knopf gerade auszahlt. */
    nextDay: next.day,
    /** Bricht die Serie, wenn heute nichts passiert? */
    streakAtRisk: claimable && state.streak > 0 && state.lastDate !== yesterdayDate(),
    days: LOGIN_REWARDS.map((reward, i) => ({
      day: i + 1,
      bonus: isLoginBonusDay(i + 1),
      claimed: state.lastDate !== null && i + 1 <= state.day,
      isNext: i + 1 === next.day && claimable,
      reward,
      label: describeReward(ctx, trainer, reward),
    })),
  }
}

/**
 * Die heutige Gabe abholen.
 *
 * Der Tag kommt aus der Spielzeitzone, nicht aus der Uhr des Geräts: sonst
 * holte man um Mitternacht in zwei Zeitzonen zweimal ab.
 */
export function claim(ctx: AppContext, trainer: Trainer) {
  return tx(ctx.db, () => {
    const state = stateOf(ctx, trainer.id)
    const next = claimLogin(state, gameDate(), yesterdayDate())
    if (!next) throw new GameError('invalid_state', { reason: 'already_claimed' }, 409)

    const reward = loginRewardFor(next.day)
    if (reward.kind === 'gold') inventory.earnGold(ctx.db, trainer.id, reward.amount)
    else if (reward.kind === 'item') inventory.grant(ctx.db, trainer.id, reward.itemId, reward.quantity)
    else energy.grant(ctx, trainer.id, reward.amount, 'login')

    ctx.db.prepare(
      `INSERT INTO login_rewards (trainer_id, day, streak, best_streak, claimed, last_date)
       VALUES (?, ?, ?, ?, 1, ?)
       ON CONFLICT(trainer_id) DO UPDATE SET
         day = excluded.day,
         streak = excluded.streak,
         best_streak = max(login_rewards.best_streak, excluded.streak),
         claimed = login_rewards.claimed + 1,
         last_date = excluded.last_date`,
    ).run(trainer.id, next.day, next.streak, next.streak, next.lastDate)

    logEvent(ctx.db, trainer.id, 'login.claimed', { day: next.day, streak: next.streak, reward })
    return {
      day: next.day,
      streak: next.streak,
      bonus: isLoginBonusDay(next.day),
      reward,
      label: describeReward(ctx, trainer, reward),
      state: view(ctx, trainer),
    }
  })
}
