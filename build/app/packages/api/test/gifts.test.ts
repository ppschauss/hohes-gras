import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createRng, GIFT_EGG_CHANCE, rollGift } from '@game/engine'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let ash: { token: string; id: string }
let misty: { token: string; id: string }

/* Der erste Trainer meldet sich an, alle weiteren brauchen eine Einladung. */
const login = async (id: number, name: string, first = false) => {
  if (first) {
    const r = await h.post('/api/auth/session', { initData: signInitData({ id, first_name: name }) })
    return { token: r.body.token, id: r.body.trainer.id }
  }
  return h.addTrainer(id, name)
}

beforeEach(async () => {
  h = await makeTestApp()
  ash = await login(11, 'Ash', true)
  misty = await login(22, 'Misty')
  const [low, high] = [ash.id, misty.id].sort()
  h.ctx.db.prepare('INSERT INTO friendships (low_id, high_id, created_at) VALUES (?, ?, ?)')
    .run(low, high, Date.now())
})
afterEach(async () => { await h.close() })

const quantity = (trainerId: string, itemId: string): number =>
  (h.ctx.db.prepare('SELECT quantity FROM inventory WHERE trainer_id = ? AND item_id = ?')
    .get(trainerId, itemId) as { quantity: number } | undefined)?.quantity ?? 0

describe('Freundschaftsgeschenke', () => {
  it('enthaelt Trank, Beeren und Baelle, gelegentlich ein Ei', () => {
    const rng = createRng('geschenke')
    let eggs = 0
    for (let i = 0; i < 2000; i++) {
      const gift = rollGift(rng)
      const ids = gift.items.map((x) => x.itemId)
      expect(ids).toContain('potion')
      expect(ids).toContain('poke-ball')
      const balls = gift.items.find((x) => x.itemId === 'poke-ball')!.quantity
      expect(balls).toBeGreaterThanOrEqual(5)
      expect(balls).toBeLessThanOrEqual(10)
      const berry = gift.items.find((x) => !['potion', 'poke-ball'].includes(x.itemId))!
      expect(berry.quantity).toBeGreaterThanOrEqual(1)
      expect(berry.quantity).toBeLessThanOrEqual(3)
      if (gift.egg) eggs++
    }
    const rate = (eggs / 2000) * 100
    expect(rate).toBeGreaterThan(GIFT_EGG_CHANCE - 3)
    expect(rate).toBeLessThan(GIFT_EGG_CHANCE + 3)
  })

  it('schickt eines und legt es beim Empfaenger in den Briefkasten', async () => {
    h.resetRateLimits()
    const r = await h.post('/api/friends/gift', { trainerId: misty.id }, ash.token)
    expect(r.status).toBe(200)
    expect(r.body.sent.to).toBe('Misty')

    h.resetRateLimits()
    const inbox = await h.get('/api/friends', misty.token)
    expect(inbox.body.gifts).toHaveLength(1)
    expect(inbox.body.gifts[0].fromName).toBe('Ash')
    // Beim Absender steht der Knopf jetzt auf "heute geschickt".
    h.resetRateLimits()
    const mine = await h.get('/api/friends', ash.token)
    expect(mine.body.friends[0].giftedToday).toBe(true)
  })

  it('laesst nur ein Geschenk je Freund und Tag zu', async () => {
    h.resetRateLimits()
    await h.post('/api/friends/gift', { trainerId: misty.id }, ash.token)
    h.resetRateLimits()
    const again = await h.post('/api/friends/gift', { trainerId: misty.id }, ash.token)
    expect(again.status).toBe(409)
    expect(again.body.detail.reason).toBe('already_claimed')
  })

  it('schenkt nur Freunden', async () => {
    const brock = await login(33, 'Brock')
    h.resetRateLimits()
    const r = await h.post('/api/friends/gift', { trainerId: brock.id }, ash.token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('not_friends')
  })

  it('legt den Inhalt beim Oeffnen in den Beutel', async () => {
    h.resetRateLimits()
    await h.post('/api/friends/gift', { trainerId: misty.id }, ash.token)
    h.resetRateLimits()
    const inbox = await h.get('/api/friends', misty.token)
    const gift = inbox.body.gifts[0]

    const ballsBefore = quantity(misty.id, 'poke-ball')
    h.resetRateLimits()
    const opened = await h.post('/api/gifts/open', { giftId: gift.id }, misty.token)
    expect(opened.status).toBe(200)
    expect(quantity(misty.id, 'poke-ball')).toBeGreaterThan(ballsBefore)
    expect(quantity(misty.id, 'potion')).toBeGreaterThan(0)

    // Und ein zweites Mal geht nicht.
    h.resetRateLimits()
    const twice = await h.post('/api/gifts/open', { giftId: gift.id }, misty.token)
    expect(twice.status).toBe(409)
    h.resetRateLimits()
    expect((await h.get('/api/friends', misty.token)).body.gifts).toHaveLength(0)
  })

  it('oeffnet kein fremdes Geschenk', async () => {
    h.resetRateLimits()
    await h.post('/api/friends/gift', { trainerId: misty.id }, ash.token)
    const row = h.ctx.db.prepare('SELECT id FROM friend_gifts LIMIT 1').get() as { id: string }
    h.resetRateLimits()
    // Ash hat es geschickt, aber nicht bekommen.
    const r = await h.post('/api/gifts/open', { giftId: row.id }, ash.token)
    expect(r.status).toBe(404)
  })
})
