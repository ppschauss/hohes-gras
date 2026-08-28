import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let token: string
let trainerId: string
let starterId: string

beforeEach(async () => {
  h = await makeTestApp()
  const auth = await h.post('/api/auth/session', { initData: signInitData({ id: 111, first_name: 'Ash' }) })
  token = auth.body.token
  trainerId = auth.body.trainer.id
  await h.post('/api/starter', { speciesId: 'testmon' }, token)
  starterId = (await h.get('/api/garden', token)).body.team[0].id
})
afterEach(async () => { await h.close() })

const give = (itemId: string, n: number) =>
  h.ctx.db.prepare('INSERT OR REPLACE INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, ?)')
    .run(trainerId, itemId, n)
const hpOf = (id: string) =>
  (h.ctx.db.prepare('SELECT hp_current AS hp FROM creatures WHERE id = ?').get(id) as { hp: number }).hp
const quantity = (itemId: string) =>
  (h.ctx.db.prepare('SELECT quantity FROM inventory WHERE trainer_id = ? AND item_id = ?')
    .get(trainerId, itemId) as { quantity: number } | undefined)?.quantity ?? 0

describe('Gegenstände aus dem Beutel', () => {
  it('heilt ein verletztes Pokemon', async () => {
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 3 WHERE id = ?').run(starterId)
    give('potion', 2)
    h.resetRateLimits()
    const r = await h.post('/api/items/use', { itemId: 'potion', creatureId: starterId }, token)
    expect(r.status).toBe(200)
    expect(hpOf(starterId)).toBeGreaterThan(3)
    expect(quantity('potion')).toBe(1)
  })

  it('verbraucht nichts, wenn nichts zu heilen ist', async () => {
    give('potion', 1)
    h.resetRateLimits()
    const r = await h.post('/api/items/use', { itemId: 'potion', creatureId: starterId }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('already_full')
    expect(quantity('potion')).toBe(1)
  })

  it('schickt Lockduefte in die Safari statt sie hier zu verbrauchen', async () => {
    give('lure-grass', 3)
    h.resetRateLimits()
    const r = await h.post('/api/items/use', { itemId: 'lure-grass' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('use_in_safari')
    expect(quantity('lure-grass')).toBe(3)
  })

  it('loest den Stoersender ohne Ziel aus', async () => {
    give('rocket-bait', 1)
    h.resetRateLimits()
    const r = await h.post('/api/items/use', { itemId: 'rocket-bait' }, token)
    expect(r.status).toBe(200)
    expect(r.body.result.charges).toBe(5)
    expect(quantity('rocket-bait')).toBe(0)
  })

  it('laesst waehrend eines Kampfes nichts aus dem Beutel zu', async () => {
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run('test-route', trainerId)
    h.resetRateLimits()
    await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    give('potion', 1)
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 3 WHERE id = ?').run(starterId)
    h.resetRateLimits()
    const r = await h.post('/api/items/use', { itemId: 'potion', creatureId: starterId }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('battle_in_progress')
  })
})
