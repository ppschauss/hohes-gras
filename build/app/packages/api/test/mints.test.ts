import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NATURE_EFFECTS } from '@game/engine'
import { NATURES } from '@game/shared'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let token: string
let trainerId: string
let starterId: string

beforeEach(async () => {
  h = await makeTestApp()
  const auth = await h.post('/api/auth/session', { initData: signInitData({ id: 333, first_name: 'Ash' }) })
  token = auth.body.token
  trainerId = auth.body.trainer.id
  await h.post('/api/starter', { speciesId: 'testmon' }, token)
  starterId = (h.ctx.db.prepare('SELECT id FROM creatures WHERE owner_id = ?').get(trainerId) as { id: string }).id
})
afterEach(async () => { await h.close() })

const gib = (itemId: string, n: number) =>
  h.ctx.db.prepare(
    `INSERT INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, ?)
     ON CONFLICT(trainer_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
  ).run(trainerId, itemId, n)

const forschungFertig = (projectId: string) => {
  const jetzt = Date.now()
  h.ctx.db.prepare(
    'INSERT INTO research (id, trainer_id, project_id, tier, started_at, ready_at, claimed_at) VALUES (?, ?, ?, 1, ?, ?, ?)',
  ).run(crypto.randomUUID(), trainerId, projectId, jetzt, jetzt, jetzt)
}

const wesen = () => (h.ctx.db.prepare('SELECT nature FROM creatures WHERE id = ?')
  .get(starterId) as { nature: string }).nature

describe('Minzen', () => {
  it('gibt es fuer jedes Wesen, das ueberhaupt etwas bewirkt', () => {
    const wirksam = NATURES.filter((n) => NATURE_EFFECTS[n] !== null)
    expect(wirksam).toHaveLength(20)
    // Die fuenf neutralen bekommen keine — eine Minze ohne Wirkung waere ein
    // Knopf, der nichts tut.
    expect(NATURES.filter((n) => NATURE_EFFECTS[n] === null)).toHaveLength(5)
  })

  it('aendert das Wesen dauerhaft', async () => {
    h.ctx.db.prepare("UPDATE creatures SET nature = 'hardy' WHERE id = ?").run(starterId)
    gib('mint-adamant', 1)
    const r = await h.post('/api/items/use', { itemId: 'mint-adamant', creatureId: starterId }, token)

    expect(r.status).toBe(200)
    expect(r.body.result).toMatchObject({ kind: 'nature', nature: 'adamant' })
    expect(wesen()).toBe('adamant')
  })

  it('verweigert dasselbe Wesen noch einmal und behaelt die Minze', async () => {
    h.ctx.db.prepare("UPDATE creatures SET nature = 'timid' WHERE id = ?").run(starterId)
    gib('mint-timid', 1)
    const r = await h.post('/api/items/use', { itemId: 'mint-timid', creatureId: starterId }, token)

    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('nature_unchanged')
    expect((h.ctx.db.prepare('SELECT quantity q FROM inventory WHERE trainer_id = ? AND item_id = ?')
      .get(trainerId, 'mint-timid') as { q: number }).q).toBe(1)
  })
})

describe('Das Minzen-Regal', () => {
  const abschnitte = async () =>
    ((await h.get('/api/shop', token)).body.sections as Array<{ category: string }>).map((s) => s.category)

  it('bleibt ohne die Forschung verschlossen', async () => {
    expect(await abschnitte()).not.toContain('mint')
  })

  it('oeffnet sich mit der Forschung', async () => {
    forschungFertig('res-mints')
    expect(await abschnitte()).toContain('mint')
  })

  /*
   * Das Regal ist eine Anzeige. Wer die Kennung kennt, koennte sonst daran
   * vorbeikaufen — deshalb prueft der Kauf dieselbe Bedingung noch einmal.
   */
  it('laesst sich nicht umgehen, indem man direkt kauft', async () => {
    h.ctx.db.prepare('UPDATE trainers SET gold = 999999 WHERE id = ?').run(trainerId)
    const ohne = await h.post('/api/shop/buy', { itemId: 'mint-adamant', quantity: 1 }, token)
    expect(ohne.status).toBe(409)
    expect(ohne.body.detail.reason).toBe('missing_research')

    forschungFertig('res-mints')
    h.resetRateLimits()
    const mit = await h.post('/api/shop/buy', { itemId: 'mint-adamant', quantity: 1 }, token)
    expect(mit.status).toBe(200)
  })
})
