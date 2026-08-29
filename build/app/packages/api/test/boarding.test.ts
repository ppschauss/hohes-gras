import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BOARDING_MAX_LEVELS, BOARDING_MS, ENERGY_COSTS } from '@game/engine'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let token: string
let trainerId: string

beforeEach(async () => {
  h = await makeTestApp()
  token = (await h.post('/api/auth/session', { initData: signInitData({ id: 601, first_name: 'Ash' }) })).body.token
  trainerId = (h.ctx.db.prepare('SELECT id FROM trainers LIMIT 1').get() as { id: string }).id
  await h.post('/api/starter', { speciesId: 'testmon' }, token)
})
afterEach(async () => { await h.close() })

/** Ein zweites Pokemon: das letzte darf nie in Pension. */
const addOne = (level = 5) => {
  const id = crypto.randomUUID()
  h.ctx.db.prepare(
    `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature,
       iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe, friendship, energy, hp_current,
       shiny, moves, caught_at, team_slot)
     VALUES (?, ?, 'wildmon', 0, ?, 'hardy', 15,15,15,15,15,15, 0, 100, 20, 0, '["tackle"]', ?, NULL)`,
  ).run(id, trainerId, level, Date.now())
  return id
}

const rows = () => h.ctx.db.prepare('SELECT id, started_at AS s FROM boarding WHERE trainer_id = ?')
  .all(trainerId) as Array<{ id: string; s: number }>

const levelOf = (id: string) =>
  (h.ctx.db.prepare('SELECT level FROM creatures WHERE id = ?').get(id) as { level: number }).level

/** Den Aufenthalt in die Vergangenheit ruecken, statt einen Tag zu warten. */
const ageBy = (id: string, ms: number) =>
  h.ctx.db.prepare('UPDATE boarding SET started_at = started_at - ?, ready_at = ready_at - ? WHERE id = ?')
    .run(ms, ms, id)

describe('Pension', () => {
  it('nimmt ein Pokemon auf und bindet es', async () => {
    const id = addOne()
    h.resetRateLimits()
    const r = await h.post('/api/boarding/drop', { creatureId: id }, token)
    expect(r.status).toBe(200)
    expect(r.body.boarding.used).toBe(1)

    h.resetRateLimits()
    expect((await h.get('/api/teams', token)).body.busyCreatureIds).toContain(id)
  })

  it('behaelt das letzte Pokemon', async () => {
    const only = (h.ctx.db.prepare('SELECT id FROM creatures WHERE owner_id = ?').get(trainerId) as { id: string }).id
    h.resetRateLimits()
    const r = await h.post('/api/boarding/drop', { creatureId: only }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('last_creature')
  })

  it('deckelt die Plaetze bei fuenf', async () => {
    for (let i = 0; i < 6; i++) addOne()
    const ids = (h.ctx.db.prepare("SELECT id FROM creatures WHERE owner_id = ? AND species_id = 'wildmon'")
      .all(trainerId) as Array<{ id: string }>).map((c) => c.id)
    for (let i = 0; i < 5; i++) {
      h.resetRateLimits()
      expect((await h.post('/api/boarding/drop', { creatureId: ids[i] }, token)).status).toBe(200)
    }
    h.resetRateLimits()
    const sixth = await h.post('/api/boarding/drop', { creatureId: ids[5] }, token)
    expect(sixth.status).toBe(409)
    expect(sixth.body.detail.reason).toBe('already_full')
  })

  it('gibt nach einem vollen Aufenthalt zehn Level', async () => {
    const id = addOne(5)
    h.resetRateLimits()
    await h.post('/api/boarding/drop', { creatureId: id }, token)
    const [row] = rows()
    ageBy(row!.id, BOARDING_MS)

    h.resetRateLimits()
    const r = await h.post('/api/boarding/pick', { id: row!.id }, token)
    expect(r.status).toBe(200)
    expect(r.body.result.levelsGained).toBe(BOARDING_MAX_LEVELS)
    expect(r.body.result.early).toBe(false)
    expect(r.body.result.energySpent).toBe(0)
    expect(levelOf(id)).toBe(15)
  })

  it('behaelt beim vorzeitigen Abholen den halben Fortschritt und kostet Energie', async () => {
    const id = addOne(5)
    h.resetRateLimits()
    await h.post('/api/boarding/drop', { creatureId: id }, token)
    const [row] = rows()
    ageBy(row!.id, BOARDING_MS / 2)

    const before = (h.ctx.db.prepare('SELECT energy FROM trainers WHERE id = ?')
      .get(trainerId) as { energy: number }).energy
    h.resetRateLimits()
    const r = await h.post('/api/boarding/pick', { id: row!.id }, token)
    expect(r.status).toBe(200)
    // Genau die Haelfte — und sie ist nicht weg, das war der Punkt.
    expect(r.body.result.levelsGained).toBe(BOARDING_MAX_LEVELS / 2)
    expect(r.body.result.early).toBe(true)
    expect(r.body.result.energySpent).toBe(ENERGY_COSTS.boarding)
    expect(levelOf(id)).toBe(10)
    const after = (h.ctx.db.prepare('SELECT energy FROM trainers WHERE id = ?')
      .get(trainerId) as { energy: number }).energy
    expect(after).toBe(before - ENERGY_COSTS.boarding)
  })

  it('arbeitet nach dem Tag nicht weiter', async () => {
    const id = addOne(5)
    h.resetRateLimits()
    await h.post('/api/boarding/drop', { creatureId: id }, token)
    const [row] = rows()
    ageBy(row!.id, BOARDING_MS * 3)
    h.resetRateLimits()
    const r = await h.post('/api/boarding/pick', { id: row!.id }, token)
    expect(r.body.result.levelsGained).toBe(BOARDING_MAX_LEVELS)
  })

  it('gibt dasselbe Pokemon nicht zweimal ab', async () => {
    const id = addOne()
    h.resetRateLimits()
    await h.post('/api/boarding/drop', { creatureId: id }, token)
    h.resetRateLimits()
    const again = await h.post('/api/boarding/drop', { creatureId: id }, token)
    expect(again.status).toBe(409)
    expect(again.body.detail.reason).toBe('creature_busy')
  })
})
