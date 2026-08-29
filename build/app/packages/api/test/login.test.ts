import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOGIN_CYCLE_DAYS, LOGIN_REWARDS, isLoginBonusDay, loginRewardFor } from '@game/engine'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let token: string
let trainerId: string

beforeEach(async () => {
  h = await makeTestApp()
  const auth = await h.post('/api/auth/session', { initData: signInitData({ id: 501, first_name: 'Ash' }) })
  token = auth.body.token
  trainerId = auth.body.trainer.id
})
afterEach(async () => { await h.close() })

/** Die gespeicherte Leiter von Hand auf einen Stand bringen. */
const seed = (day: number, streak: number, lastDate: string) => {
  h.ctx.db.prepare(
    `INSERT INTO login_rewards (trainer_id, day, streak, best_streak, claimed, last_date)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(trainer_id) DO UPDATE SET day = excluded.day, streak = excluded.streak,
       best_streak = excluded.best_streak, last_date = excluded.last_date`,
  ).run(trainerId, day, streak, streak, lastDate)
}
const dayString = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

describe('Anmeldebelohnung', () => {
  it('beschreibt vier Wochen mit unterschiedlichen Gaben', () => {
    expect(LOGIN_REWARDS).toHaveLength(LOGIN_CYCLE_DAYS)
    // Vier Wochenpraemien, jede ein Schillerndes Seelenfragment.
    const bonus = LOGIN_REWARDS.filter((_, i) => isLoginBonusDay(i + 1))
    expect(bonus).toHaveLength(4)
    for (const b of bonus) expect(b).toMatchObject({ kind: 'item', itemId: 'soul-shiny' })
    // Und sie wachsen: die vierte Woche ist mehr als die erste.
    expect((bonus[3] as { quantity: number }).quantity)
      .toBeGreaterThan((bonus[0] as { quantity: number }).quantity)
    // Keine zwei aufeinanderfolgenden Tage geben dasselbe.
    for (let i = 1; i < LOGIN_REWARDS.length; i++) {
      expect(JSON.stringify(LOGIN_REWARDS[i])).not.toBe(JSON.stringify(LOGIN_REWARDS[i - 1]))
    }
  })

  it('zahlt den ersten Tag und danach heute nichts mehr', async () => {
    const before = (await h.get('/api/bag', token)).body.gold
    h.resetRateLimits()
    const r = await h.post('/api/login/claim', {}, token)
    expect(r.status).toBe(200)
    expect(r.body.day).toBe(1)
    expect(r.body.streak).toBe(1)
    h.resetRateLimits()
    expect((await h.get('/api/bag', token)).body.gold).toBeGreaterThan(before)

    h.resetRateLimits()
    const again = await h.post('/api/login/claim', {}, token)
    expect(again.status).toBe(409)
    expect(again.body.detail.reason).toBe('already_claimed')
  })

  it('zaehlt weiter, wenn gestern abgeholt wurde', async () => {
    seed(3, 3, dayString(-1))
    h.resetRateLimits()
    const r = await h.post('/api/login/claim', {}, token)
    expect(r.body.day).toBe(4)
    expect(r.body.streak).toBe(4)
  })

  it('faengt nach einem ausgelassenen Tag wieder bei eins an', async () => {
    // Genau das ist der Reiz: die Kette reisst, und die Wochenpraemie ist weg.
    seed(6, 6, dayString(-2))
    h.resetRateLimits()
    const r = await h.post('/api/login/claim', {}, token)
    expect(r.body.day).toBe(1)
    expect(r.body.streak).toBe(1)
  })

  it('gibt am siebten Tag ein Schillerndes Seelenfragment', async () => {
    seed(6, 6, dayString(-1))
    h.resetRateLimits()
    const r = await h.post('/api/login/claim', {}, token)
    expect(r.body.day).toBe(7)
    expect(r.body.bonus).toBe(true)
    const have = h.ctx.db
      .prepare('SELECT quantity FROM inventory WHERE trainer_id = ? AND item_id = ?')
      .get(trainerId, 'soul-shiny') as { quantity: number } | undefined
    expect(have?.quantity).toBe((loginRewardFor(7) as { quantity: number }).quantity)
  })

  it('beginnt nach dem achtundzwanzigsten Tag von vorn, ohne die Serie zu verlieren', async () => {
    seed(LOGIN_CYCLE_DAYS, 40, dayString(-1))
    h.resetRateLimits()
    const r = await h.post('/api/login/claim', {}, token)
    expect(r.body.day).toBe(1)
    expect(r.body.streak).toBe(41)
  })

  it('zeigt vorher an, was der Knopf auszahlt', async () => {
    seed(6, 6, dayString(-1))
    h.resetRateLimits()
    const v = await h.get('/api/login', token)
    expect(v.body.claimable).toBe(true)
    expect(v.body.nextDay).toBe(7)
    expect(v.body.days[6].bonus).toBe(true)
  })
})
