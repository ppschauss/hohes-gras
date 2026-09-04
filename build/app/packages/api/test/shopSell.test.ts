import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let token: string
let trainerId: string

beforeEach(async () => {
  h = await makeTestApp()
  const auth = await h.post('/api/auth/session', { initData: signInitData({ id: 222, first_name: 'Ash' }) })
  token = auth.body.token
  trainerId = auth.body.trainer.id
  await h.post('/api/starter', { speciesId: 'testmon' }, token)
})
afterEach(async () => { await h.close() })

const gib = (itemId: string, n: number) =>
  h.ctx.db.prepare(
    `INSERT INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, ?)
     ON CONFLICT(trainer_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
  ).run(trainerId, itemId, n)

const gold = () => (h.ctx.db.prepare('SELECT gold FROM trainers WHERE id = ?')
  .get(trainerId) as { gold: number }).gold
const menge = (itemId: string) => ((h.ctx.db
  .prepare('SELECT quantity q FROM inventory WHERE trainer_id = ? AND item_id = ?')
  .get(trainerId, itemId) as { q: number } | undefined)?.q ?? 0)
const laden = async () => (await h.get('/api/shop', token)).body

describe('Gegenstaende gegen Gold', () => {
  it('kauft Seelenfragmente an', async () => {
    gib('soul-normal', 10)
    const vorher = gold()
    const r = await h.post('/api/shop/sell', { itemId: 'soul-normal', quantity: 4 }, token)

    expect(r.status).toBe(200)
    expect(menge('soul-normal')).toBe(6)
    expect(gold()).toBe(vorher + 4 * 25)
  })

  /*
   * Die Liste kommt aus dem Beutel und nicht aus dem Sortiment. Genau daran
   * haette es sonst gescheitert: Fragmente sind nicht kaeuflich, stehen also
   * in keinem Ladenabschnitt — eine Verkaufsliste aus `sections` haette sie
   * nie gezeigt.
   */
  it('zeigt Fragmente in der Ankaufsliste, obwohl der Laden sie nicht fuehrt', async () => {
    gib('soul-normal', 3)
    const d = await laden()

    expect(d.sellable.map((i: { id: string }) => i.id)).toContain('soul-normal')
    const imSortiment = d.sections.some((s: { items: Array<{ id: string }> }) =>
      s.items.some((i) => i.id === 'soul-normal'))
    expect(imSortiment).toBe(false)
  })

  it('listet nur, was wirklich im Beutel liegt', async () => {
    const leer = await laden()
    expect(leer.sellable.map((i: { id: string }) => i.id)).not.toContain('soul-grass')
    gib('soul-grass', 1)
    const voll = await laden()
    expect(voll.sellable.map((i: { id: string }) => i.id)).toContain('soul-grass')
  })

  it('verweigert mehr, als man hat, und nimmt dabei nichts weg', async () => {
    gib('soul-normal', 2)
    const vorher = gold()
    const r = await h.post('/api/shop/sell', { itemId: 'soul-normal', quantity: 5 }, token)

    expect(r.body.error).toBe('insufficient_items')
    // Der eigentliche Punkt: die Abweisung darf nichts halb erledigt haben.
    expect(menge('soul-normal')).toBe(2)
    expect(gold()).toBe(vorher)
  })

  it('verweigert, was keinen Ankaufspreis hat', async () => {
    gib('bg-classic', 1)
    const r = await h.post('/api/shop/sell', { itemId: 'bg-classic', quantity: 1 }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('not_sellable')
  })

  it('schreibt den Verkauf ins Herkunftsregister', async () => {
    gib('soul-normal', 5)
    await h.post('/api/shop/sell', { itemId: 'soul-normal', quantity: 5 }, token)
    const eintrag = h.ctx.db
      .prepare("SELECT COUNT(*) c FROM acquisitions WHERE trainer_id = ? AND source = 'shop.sell'")
      .get(trainerId) as { c: number }
    expect(eintrag.c).toBeGreaterThan(0)
  })
})
