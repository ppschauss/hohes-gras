import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SOUL_PER_EGG, SOUL_PER_SHINY_EGG } from '@game/engine'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let token: string
let trainerId: string

beforeEach(async () => {
  h = await makeTestApp()
  const auth = await h.post('/api/auth/session', { initData: signInitData({ id: 111, first_name: 'Ash' }) })
  token = auth.body.token
  trainerId = auth.body.trainer.id
  await h.post('/api/starter', { speciesId: 'testmon' }, token)
})
afterEach(async () => { await h.close() })

/** Ein Pokemon in der Box — Verwerten soll das Team nicht leeren. */
const addBoxed = (speciesId = 'wildmon') => {
  const id = crypto.randomUUID()
  h.ctx.db.prepare(
    `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature,
       iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe, friendship, energy, hp_current,
       shiny, moves, caught_at, team_slot)
     VALUES (?, ?, ?, 0, 5, 'hardy', 20,20,20,20,20,20, 70, 100, 20, 0, '["tackle"]', ?, NULL)`,
  ).run(id, trainerId, speciesId, Date.now())
  return id
}

const quantity = (itemId: string): number =>
  (h.ctx.db.prepare('SELECT quantity FROM inventory WHERE trainer_id = ? AND item_id = ?')
    .get(trainerId, itemId) as { quantity: number } | undefined)?.quantity ?? 0

describe('Verwerten', () => {
  it('macht aus einem Pokemon ein Fragment seines Typs', async () => {
    const id = addBoxed('wildmon')
    h.resetRateLimits()
    const r = await h.post('/api/souls/salvage', { creatureId: id }, token)
    expect(r.status).toBe(200)
    expect(quantity('soul-normal')).toBe(1)

    // Und das Pokemon ist weg.
    expect(h.ctx.db.prepare('SELECT id FROM creatures WHERE id = ?').get(id)).toBeUndefined()
  })

  it('gibt je Typ ein Fragment — auch bei Mischtypen', async () => {
    // Einzelmon traegt in der Fixture zwei Typen; es muss beide Fragmente
    // geben, nicht eines fuer das Pokemon.
    const id = addBoxed('mischmon')
    h.resetRateLimits()
    const r = await h.post('/api/souls/salvage', { creatureId: id }, token)
    expect(r.body.result.fragments.map((f: any) => f.typeId).sort()).toEqual(['grass', 'normal'])
    expect(quantity('soul-normal')).toBe(1)
    expect(quantity('soul-grass')).toBe(1)
  })

  it('laesst das letzte Pokemon in Ruhe', async () => {
    const own = h.ctx.db.prepare('SELECT id FROM creatures WHERE owner_id = ?').all(trainerId) as Array<{ id: string }>
    expect(own).toHaveLength(1)
    h.resetRateLimits()
    const r = await h.post('/api/souls/salvage', { creatureId: own[0]!.id }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('last_creature')
  })

  it('verwertet nichts, was gerade unterwegs ist', async () => {
    const id = addBoxed('wildmon')
    h.resetRateLimits()
    await h.post('/api/expeditions', { kind: 'forage', duration: 'short', creatureIds: [id] }, token)
    h.resetRateLimits()
    const r = await h.post('/api/souls/salvage', { creatureId: id }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('on_expedition')
  })

  it('verwertet eine ganze Auswahl auf einmal', async () => {
    const ids = [addBoxed('wildmon'), addBoxed('wildmon'), addBoxed('mischmon')]
    h.resetRateLimits()
    const r = await h.post('/api/souls/salvage', { creatureIds: ids }, token)
    expect(r.status).toBe(200)
    expect(r.body.bulk.count).toBe(3)
    // Drei Pokemon, aber vier Fragmente: Mischmon traegt zwei Typen.
    expect(quantity('soul-normal')).toBe(3)
    expect(quantity('soul-grass')).toBe(1)
    for (const id of ids) {
      expect(h.ctx.db.prepare('SELECT id FROM creatures WHERE id = ?').get(id)).toBeUndefined()
    }
  })

  it('verwertet die Auswahl ganz oder gar nicht', async () => {
    // Das zweite gehoert jemand anderem: dann darf auch das erste bleiben.
    const mine = addBoxed('wildmon')
    h.resetRateLimits()
    const r = await h.post('/api/souls/salvage', { creatureIds: [mine, crypto.randomUUID()] }, token)
    expect(r.status).toBe(404)
    expect(h.ctx.db.prepare('SELECT id FROM creatures WHERE id = ?').get(mine)).toBeDefined()
    expect(quantity('soul-normal')).toBe(0)
  })

  it('laesst auch der Auswahl das letzte Pokemon', async () => {
    // Einzeln waere jedes erlaubt — die Grenze gilt fuer die Summe.
    const own = h.ctx.db.prepare('SELECT id FROM creatures WHERE owner_id = ?').all(trainerId) as Array<{ id: string }>
    const ids = [...own.map((c) => c.id), addBoxed('wildmon')]
    h.resetRateLimits()
    const r = await h.post('/api/souls/salvage', { creatureIds: ids }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('last_creature')
  })

  it('tauscht zwanzig Fragmente gegen ein Ei desselben Typs', async () => {
    h.ctx.db.prepare('INSERT OR REPLACE INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, ?)')
      .run(trainerId, 'soul-grass', SOUL_PER_EGG)
    h.resetRateLimits()
    const r = await h.post('/api/souls/redeem', { typeId: 'grass' }, token)
    expect(r.status).toBe(200)
    expect(quantity('soul-grass')).toBe(0)

    const species = h.ctx.registry.species(r.body.egg.speciesId)
    expect(species.types).toContain('grass')
  })

  it('gibt kein Ei fuer eines zu wenig', async () => {
    h.ctx.db.prepare('INSERT OR REPLACE INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, ?)')
      .run(trainerId, 'soul-grass', SOUL_PER_EGG - 1)
    h.resetRateLimits()
    const r = await h.post('/api/souls/redeem', { typeId: 'grass' }, token)
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('insufficient_items')
    expect(quantity('soul-grass')).toBe(SOUL_PER_EGG - 1)
  })

  it('zeigt den Fortschritt je Typ', async () => {
    h.ctx.db.prepare('INSERT OR REPLACE INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, 4)')
      .run(trainerId, 'soul-grass')
    h.resetRateLimits()
    const r = await h.get('/api/souls', token)
    const grass = r.body.souls.find((s: any) => s.typeId === 'grass')
    expect(grass).toMatchObject({ have: 4, need: SOUL_PER_EGG, ready: false })
  })
})

describe('Schillerndes Ei', () => {
  const give = (n: number) =>
    h.ctx.db.prepare('INSERT OR REPLACE INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, ?)')
      .run(trainerId, 'soul-grass', n)

  it('kostet fuenfundachtzig und schluepft garantiert schillernd', async () => {
    give(SOUL_PER_SHINY_EGG)
    h.resetRateLimits()
    const r = await h.post('/api/souls/redeem', { typeId: 'grass', shiny: true }, token)
    expect(r.status).toBe(200)
    expect(r.body.egg.shiny).toBe(true)
    expect(quantity('soul-grass')).toBe(0)
  })

  it('gibt sich nicht mit dem Preis des gewoehnlichen zufrieden', async () => {
    give(SOUL_PER_EGG)
    h.resetRateLimits()
    const r = await h.post('/api/souls/redeem', { typeId: 'grass', shiny: true }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.need).toBe(SOUL_PER_SHINY_EGG)
    // Und es hat nichts abgezogen.
    expect(quantity('soul-grass')).toBe(SOUL_PER_EGG)
  })
})

