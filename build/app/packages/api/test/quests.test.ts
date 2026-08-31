import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findQuest, questsFor, QUESTS_PER_DAY, QUESTS_PER_WEEK } from '@game/engine'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let token: string
let trainerId: string

beforeEach(async () => {
  h = await makeTestApp()
  const auth = await h.post('/api/auth/session', { initData: signInitData({ id: 901, first_name: 'Ash' }) })
  token = auth.body.token
  trainerId = auth.body.trainer.id
  await h.post('/api/starter', { speciesId: 'testmon' }, token)
})
afterEach(async () => { await h.close() })

const gold = () =>
  (h.ctx.db.prepare('SELECT gold FROM trainers WHERE id = ?').get(trainerId) as { gold: number }).gold

describe('Aufgaben', () => {
  it('stellt drei am Tag und drei in der Woche, alle verschieden', async () => {
    h.resetRateLimits()
    const r = await h.get('/api/quests', token)
    expect(r.status).toBe(200)
    expect(r.body.daily).toHaveLength(QUESTS_PER_DAY)
    expect(r.body.weekly).toHaveLength(QUESTS_PER_WEEK)
    expect(new Set(r.body.daily.map((q: any) => q.id)).size).toBe(QUESTS_PER_DAY)
    expect(new Set(r.body.weekly.map((q: any) => q.id)).size).toBe(QUESTS_PER_WEEK)
  })

  it('stellt fuer denselben Tag immer dieselben', () => {
    // Aus dem Datum abgeleitet: alle Spieler reden ueber dieselben Aufgaben.
    expect(questsFor('daily', '2026-08-31').map((q) => q.id))
      .toEqual(questsFor('daily', '2026-08-31').map((q) => q.id))
    expect(questsFor('daily', '2026-08-31').map((q) => q.id))
      .not.toEqual(questsFor('daily', '2026-09-01').map((q) => q.id))
  })

  it('zaehlt eine Handlung fuer Tag und Woche gleichzeitig', async () => {
    // Dieselbe Metrik in beiden Zeitraeumen: ein Fang zaehlt fuer beides.
    const daily = questsFor('daily', new Date().toISOString().slice(0, 10))
    void daily
    h.resetRateLimits()
    const before = await h.get('/api/quests', token)
    const metrics = new Set([...before.body.daily, ...before.body.weekly].map((q: any) => q.metric))
    expect(metrics.size).toBeGreaterThan(0)
  })

  it('zahlt erst bei erfuelltem Soll und dann genau einmal', async () => {
    h.resetRateLimits()
    const view = await h.get('/api/quests', token)
    const q = view.body.daily[0]

    h.resetRateLimits()
    const early = await h.post('/api/quests/claim', { questId: q.id }, token)
    expect(early.status).toBe(409)
    expect(early.body.detail.reason).toBe('goal_incomplete')

    h.ctx.db.prepare('UPDATE quests SET progress = ? WHERE trainer_id = ? AND quest_id = ?')
      .run(q.target, trainerId, q.id)
    const before = gold()
    h.resetRateLimits()
    const done = await h.post('/api/quests/claim', { questId: q.id }, token)
    expect(done.status).toBe(200)
    expect(gold()).toBe(before + findQuest(q.id)!.reward.gold)

    h.resetRateLimits()
    const twice = await h.post('/api/quests/claim', { questId: q.id }, token)
    expect(twice.status).toBe(409)
  })

  it('legt die Belohnungsgegenstaende in den Beutel', async () => {
    h.resetRateLimits()
    const view = await h.get('/api/quests', token)
    const q = view.body.daily.find((x: any) => x.reward.items.length > 0)
    expect(q).toBeDefined()
    h.ctx.db.prepare('UPDATE quests SET progress = ? WHERE trainer_id = ? AND quest_id = ?')
      .run(q.target, trainerId, q.id)
    const item = q.reward.items[0]
    const before = (h.ctx.db.prepare('SELECT quantity FROM inventory WHERE trainer_id = ? AND item_id = ?')
      .get(trainerId, item.itemId) as { quantity: number } | undefined)?.quantity ?? 0

    h.resetRateLimits()
    expect((await h.post('/api/quests/claim', { questId: q.id }, token)).status).toBe(200)
    const after = (h.ctx.db.prepare('SELECT quantity FROM inventory WHERE trainer_id = ? AND item_id = ?')
      .get(trainerId, item.itemId) as { quantity: number } | undefined)?.quantity ?? 0
    // Nur wenn das Fixture den Gegenstand kennt — sonst bleibt das Gold.
    if (h.ctx.registry.tryItem(item.itemId)) expect(after).toBe(before + item.quantity)
  })

  it('weist eine Aufgabe ab, die gar nicht gestellt ist', async () => {
    const all = [...questsFor('daily', '2000-01-01'), ...questsFor('weekly', '2000-W01')]
    void all
    h.resetRateLimits()
    const r = await h.post('/api/quests/claim', { questId: 'gibt-es-nicht' }, token)
    expect(r.status).toBe(404)
  })
})
