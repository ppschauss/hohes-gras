import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

const starterId = async () => (await h.get('/api/garden', token)).body.team[0].id
const setLevel = (id: string, level: number) =>
  h.ctx.db.prepare('UPDATE creatures SET level = ? WHERE id = ?').run(level, id)
const movesOf = (id: string): string[] =>
  JSON.parse((h.ctx.db.prepare('SELECT moves FROM creatures WHERE id = ?').get(id) as { moves: string }).moves)

describe('Attacken', () => {
  it('zeigt Plaetze und alles auf diesem Level Lernbare', async () => {
    const id = await starterId()
    const r = await h.get(`/api/creatures/${id}/moves`, token)
    expect(r.status).toBe(200)
    expect(r.body.capacity).toBe(4)
    expect(r.body.creature.level).toBe(5)
    // Level 5: Tackle (1), Heuler (3), Ruckzuckhieb (5). Bodyslam erst ab 20.
    expect(r.body.options.map((m: any) => m.id).sort())
      .toEqual(['growl', 'quick-attack', 'tackle'])
    expect(r.body.options.every((m: any) => m.selected)).toBe(true)
  })

  it('nennt Typ, Kategorie und Kennzahlen je Attacke', async () => {
    const id = await starterId()
    const r = await h.get(`/api/creatures/${id}/moves`, token)
    const tackle = r.body.options.find((m: any) => m.id === 'tackle')
    expect(tackle).toMatchObject({
      name: 'Tackle', category: 'physical', power: 40, accuracy: 100, pp: 35, level: 1,
    })
    expect(tackle.type).toMatchObject({ id: 'normal', name: 'Normal' })
    const growl = r.body.options.find((m: any) => m.id === 'growl')
    expect(growl.effect).toBe('stat:atk:down')
  })

  it('setzt die Auswahl in der uebergebenen Reihenfolge', async () => {
    const id = await starterId()
    const r = await h.put(`/api/creatures/${id}/moves`, { moveIds: ['growl', 'tackle'] }, token)
    expect(r.status).toBe(200)
    expect(r.body.slots.map((m: any) => m.id)).toEqual(['growl', 'tackle'])
    expect(movesOf(id)).toEqual(['growl', 'tackle'])
  })

  it('weist eine Attacke ab, die die Art auf diesem Level nicht kann', async () => {
    const id = await starterId()
    const r = await h.put(`/api/creatures/${id}/moves`, { moveIds: ['body-slam'] }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('not_learnable')
    // Nach dem hoeheren Level geht dieselbe Anfrage durch.
    setLevel(id, 20)
    h.resetRateLimits()
    expect((await h.put(`/api/creatures/${id}/moves`, { moveIds: ['body-slam'] }, token)).status).toBe(200)
  })

  it('weist eine unbekannte Attacke ab', async () => {
    const id = await starterId()
    const r = await h.put(`/api/creatures/${id}/moves`, { moveIds: ['hyperstrahl'] }, token)
    expect(r.status).toBe(404)
  })

  it('weist Doppelbelegung und mehr als vier Attacken ab', async () => {
    const id = await starterId()
    const twice = await h.put(`/api/creatures/${id}/moves`, { moveIds: ['tackle', 'tackle'] }, token)
    expect(twice.status).toBe(400)

    setLevel(id, 20)
    h.resetRateLimits()
    const many = await h.put(`/api/creatures/${id}/moves`,
      { moveIds: ['tackle', 'growl', 'quick-attack', 'harden', 'body-slam'] }, token)
    expect(many.status).toBe(400)
  })

  it('verlangt mindestens eine Attacke', async () => {
    const id = await starterId()
    const r = await h.put(`/api/creatures/${id}/moves`, { moveIds: [] }, token)
    expect(r.status).toBe(400)
  })

  it('weist fremde Pokemon ab', async () => {
    const other = await h.addTrainer(222, 'Misty')
    await h.post('/api/starter', { speciesId: 'testmon' }, other.token)
    const theirs = (await h.get('/api/garden', other.token)).body.team[0].id

    expect((await h.get(`/api/creatures/${theirs}/moves`, token)).status).toBe(403)
    h.resetRateLimits()
    expect((await h.put(`/api/creatures/${theirs}/moves`, { moveIds: ['tackle'] }, token)).status).toBe(403)
  })

  it('sperrt den Wechsel waehrend eines laufenden Kampfes', async () => {
    const id = await starterId()
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run('test-route', trainerId)
    setLevel(id, 60)
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 9999 WHERE id = ?').run(id)
    const started = await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    expect(started.status).toBe(200)

    h.resetRateLimits()
    const r = await h.put(`/api/creatures/${id}/moves`, { moveIds: ['tackle'] }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('battle_in_progress')
  })

  it('laesst eine bewusste Auswahl beim Levelaufstieg stehen', async () => {
    const id = await starterId()
    setLevel(id, 19)
    await h.put(`/api/creatures/${id}/moves`,
      { moveIds: ['tackle', 'growl', 'quick-attack', 'harden'] }, token)

    // Level 20 schaltet Bodyslam frei. Frueher haette die Automatik hier die
    // aelteste Attacke herausgeworfen — genau das soll nicht mehr passieren.
    h.ctx.db.prepare('UPDATE creatures SET xp = 0, level = 19 WHERE id = ?').run(id)
    h.resetRateLimits()
    for (let i = 0; i < 40; i++) {
      h.resetRateLimits(); h.resetPacing()
      await h.post('/api/garden/care', { action: 'rest' }, token)
    }
    const after = movesOf(id)
    expect(after).toEqual(['tackle', 'growl', 'quick-attack', 'harden'])
  })

  it('fuellt nur leere Plaetze automatisch auf', async () => {
    const id = await starterId()
    await h.put(`/api/creatures/${id}/moves`, { moveIds: ['tackle'] }, token)
    h.resetRateLimits()
    // Ein Levelaufstieg darf die freien Plaetze belegen, aber nicht die
    // gewaehlte Attacke von Platz eins verdraengen.
    for (let i = 0; i < 30; i++) {
      h.resetRateLimits(); h.resetPacing()
      await h.post('/api/garden/care', { action: 'rest' }, token)
    }
    const after = movesOf(id)
    expect(after[0]).toBe('tackle')
    expect(after.length).toBeGreaterThan(1)
  })
})
