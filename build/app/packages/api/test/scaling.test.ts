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
  h.ctx.db.prepare('UPDATE trainers SET current_area_id = ?, energy = 9000 WHERE id = ?')
    .run('test-route', trainerId)
})
afterEach(async () => { await h.close() })

/** Das ganze Team auf ein Level setzen — der Median ist dann dieses Level. */
const setTeamLevel = (level: number) =>
  h.ctx.db.prepare('UPDATE creatures SET level = ? WHERE owner_id = ? AND team_slot IS NOT NULL')
    .run(level, trainerId)

async function exploreLevels(times: number): Promise<number[]> {
  const levels: number[] = []
  for (let i = 0; i < times; i++) {
    h.resetRateLimits(); h.resetPacing()
    const r = await h.post('/api/safari/explore', { ballId: 'poke-ball' }, token)
    if (r.body.kind === 'encounter') levels.push(r.body.encounter.level)
    h.resetRateLimits()
    await h.post('/api/safari/flee', {}, token)
  }
  return levels
}

describe('Dynamische Levelskalierung', () => {
  it('ist standardmaessig an', async () => {
    const r = await h.get('/api/world', token)
    expect(r.body.levelScaling).toBe(true)
    expect(r.body.referenceLevel).toBe(5)
  })

  it('laesst ein Gebiet unveraendert, solange das Team im Band liegt', async () => {
    // Testroute ist mit Lv 2–6 entworfen, der Starter steht auf 5.
    const route = (await h.get('/api/world', token)).body.regions[0].areas[0]
    expect(route.levels).toEqual({ min: 2, max: 6 })
    expect(route.levelBoost).toBe(0)

    const levels = await exploreLevels(8)
    expect(levels.length).toBeGreaterThan(0)
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(2)
      expect(level).toBeLessThanOrEqual(6)
    }
  })

  it('hebt das Gebiet an, sobald das Team darueber liegt', async () => {
    setTeamLevel(60)
    const route = (await h.get('/api/world', token)).body.regions[0].areas[0]
    // Bandobergrenze wandert auf 60, die Breite bleibt.
    expect(route.levels).toEqual({ min: 56, max: 60 })
    expect(route.levelBoost).toBe(54)

    const levels = await exploreLevels(8)
    expect(levels.length).toBeGreaterThan(0)
    for (const level of levels) {
      expect(level).toBeGreaterThanOrEqual(56)
      expect(level).toBeLessThanOrEqual(60)
    }
  })

  it('macht ein Gebiet nie leichter als entworfen', async () => {
    setTeamLevel(1)
    const route = (await h.get('/api/world', token)).body.regions[0].areas[0]
    expect(route.levels).toEqual({ min: 2, max: 6 })
    expect(route.levelBoost).toBe(0)
  })

  it('folgt dem Median, nicht dem staerksten Mitglied', async () => {
    // Vier auf Level 5, eines auf 90 — der Median bleibt 5.
    const stmt = h.ctx.db.prepare(
      `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature,
         iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe,
         friendship, energy, hp_current, shiny, moves, caught_at, team_slot)
       VALUES (?, ?, 'testmon', 125, ?, 'hardy', 20,20,20,20,20,20, 70, 100, 20, 0, '["tackle"]', ?, ?)`,
    )
    stmt.run(crypto.randomUUID(), trainerId, 5, Date.now(), 1)
    stmt.run(crypto.randomUUID(), trainerId, 5, Date.now(), 2)
    stmt.run(crypto.randomUUID(), trainerId, 5, Date.now(), 3)
    stmt.run(crypto.randomUUID(), trainerId, 90, Date.now(), 4)

    const r = await h.get('/api/world', token)
    expect(r.body.referenceLevel).toBe(5)
    expect(r.body.regions[0].areas[0].levelBoost).toBe(0)
  })

  it('skaliert auch die Trainer im Gebiet', async () => {
    // Der Rivale steht im Entwurf auf Level 3 — zwei unter der Obergrenze
    // seiner Route. Dieser Abstand bleibt erhalten.
    const before = (await h.get('/api/battle/opponents', token)).body
    expect(before.trainers[0].maxLevel).toBe(3)
    expect(before.trainers[0].levelBoost).toBe(0)

    setTeamLevel(40)
    const after = (await h.get('/api/battle/opponents', token)).body
    expect(after.trainers[0].levelBoost).toBe(34)
    expect(after.trainers[0].maxLevel).toBe(37)
  })

  it('schickt den skalierten Gegner auch wirklich in den Kampf', async () => {
    setTeamLevel(40)
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 9999 WHERE owner_id = ?').run(trainerId)
    const r = await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    expect(r.status).toBe(200)
    expect(r.body.foe.active.level).toBe(37)
  })

  it('laesst sich abschalten und wieder einschalten', async () => {
    setTeamLevel(60)
    const off = await h.post('/api/world/scaling', { enabled: false }, token)
    expect(off.status).toBe(200)
    expect(off.body.levelScaling).toBe(false)
    expect(off.body.regions[0].areas[0].levels).toEqual({ min: 2, max: 6 })
    expect(off.body.referenceLevel).toBe(0)

    const levels = await exploreLevels(6)
    for (const level of levels) expect(level).toBeLessThanOrEqual(6)

    h.resetRateLimits()
    const on = await h.post('/api/world/scaling', { enabled: true }, token)
    expect(on.body.levelScaling).toBe(true)
    expect(on.body.regions[0].areas[0].levelBoost).toBe(54)
  })

  it('stoesst nicht ueber Level 100 hinaus', async () => {
    setTeamLevel(100)
    const route = (await h.get('/api/world', token)).body.regions[0].areas[0]
    expect(route.levels.max).toBe(100)
    const levels = await exploreLevels(6)
    for (const level of levels) expect(level).toBeLessThanOrEqual(100)
  })
})
