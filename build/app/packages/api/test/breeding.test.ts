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

function addCreature(speciesId: string, level: number, ivs = 20): string {
  const id = crypto.randomUUID()
  h.ctx.db.prepare(
    `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature, iv_hp, iv_atk, iv_def,
       iv_spa, iv_spd, iv_spe, friendship, energy, hp_current, shiny, moves, caught_at, team_slot)
     VALUES (?, ?, ?, 0, ?, 'hardy', ?, ?, ?, ?, ?, ?, 70, 100, 30, 0, '["tackle"]', ?, NULL)`,
  ).run(id, trainerId, speciesId, level, ivs, ivs, ivs, ivs, ivs, ivs, Date.now())
  return id
}

function finishEgg(eggId: string) {
  h.ctx.db.prepare('UPDATE eggs SET started_at = ? WHERE id = ?')
    .run(Date.now() - 999 * 60_000, eggId)
}

describe('Zucht', () => {
  it('zeigt nur Pokemon ab dem Mindestlevel als Elternteil', async () => {
    addCreature('wildmon', 5)
    addCreature('wildmon', 30)
    const r = await h.get('/api/eggs', token)
    expect(r.status).toBe(200)
    expect(r.body.minLevel).toBe(15)
    expect(r.body.candidates.every((c: any) => c.level >= 15)).toBe(true)
    expect(r.body.candidates).toHaveLength(1)
  })

  it('legt ein Ei aus zwei passenden Eltern', async () => {
    const a = addCreature('wildmon', 20)
    const b = addCreature('nachtmon', 20)
    const r = await h.post('/api/eggs/pair', { creatureIdA: a, creatureIdB: b }, token)
    expect(r.status).toBe(200)
    expect(r.body.egg.ready).toBe(false)
    expect(r.body.egg.progress).toBeLessThan(1)
    // Die Art bleibt bis zum Schluepfen verborgen — das ist der Reiz.
    expect(r.body.egg.speciesKnown).toBe(false)
    expect(r.body.egg.speciesName).toBeNull()
    expect(r.body.egg.ivPercentHint).toBeTruthy()
  })

  it('weist dasselbe Pokemon als beide Eltern ab', async () => {
    const a = addCreature('wildmon', 20)
    const r = await h.post('/api/eggs/pair', { creatureIdA: a, creatureIdB: a }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('same_creature')
  })

  it('weist zu junge Eltern ab', async () => {
    const a = addCreature('wildmon', 20)
    const b = addCreature('wildmon', 5)
    const r = await h.post('/api/eggs/pair', { creatureIdA: a, creatureIdB: b }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('too_young')
  })

  it('weist nicht zuechtbare Arten ab', async () => {
    const a = addCreature('wildmon', 20)
    const b = addCreature('einzelmon', 20)
    const r = await h.post('/api/eggs/pair', { creatureIdA: a, creatureIdB: b }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('unbreedable')
  })

  it('weist fremde Pokemon ab', async () => {
    const a = addCreature('wildmon', 20)
    const r = await h.post('/api/eggs/pair', {
      creatureIdA: a, creatureIdB: '00000000-0000-4000-8000-000000000000',
    }, token)
    expect(r.status).toBe(404)
  })

  it('begrenzt die Zahl offener Eier', async () => {
    for (let i = 0; i < 4; i++) {
      const a = addCreature('wildmon', 20)
      const b = addCreature('nachtmon', 20)
      const r = await h.post('/api/eggs/pair', { creatureIdA: a, creatureIdB: b }, token)
      if (i < 3) expect(r.status).toBe(200)
      else {
        expect(r.status).toBe(409)
        expect(r.body.detail.reason).toBe('too_many_eggs')
      }
    }
  })

  it('verweigert das Schluepfen vor Ablauf', async () => {
    const a = addCreature('wildmon', 20)
    const b = addCreature('nachtmon', 20)
    const egg = await h.post('/api/eggs/pair', { creatureIdA: a, creatureIdB: b }, token)
    const r = await h.post('/api/eggs/hatch', { id: egg.body.egg.id }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('not_ready')
  })

  it('schluepft und legt ein Pokemon auf Level 1 an', async () => {
    const a = addCreature('wildmon', 20)
    const b = addCreature('nachtmon', 20)
    const egg = await h.post('/api/eggs/pair', { creatureIdA: a, creatureIdB: b }, token)
    finishEgg(egg.body.egg.id)

    const ready = await h.get('/api/eggs', token)
    expect(ready.body.eggs[0].ready).toBe(true)
    expect(ready.body.eggs[0].speciesKnown).toBe(true)
    expect(ready.body.eggs[0].speciesName).toBeTruthy()

    const r = await h.post('/api/eggs/hatch', { id: egg.body.egg.id }, token)
    expect(r.status).toBe(200)
    expect(r.body.creature.level).toBe(1)
    expect(r.body.creature.friendship).toBe(120)
    expect(r.body.creature.teamSlot).toBeNull()
    expect(r.body.overview.eggs).toHaveLength(0)
  })

  it('laesst sich nicht zweimal ausbrueten', async () => {
    const a = addCreature('wildmon', 20)
    const b = addCreature('nachtmon', 20)
    const egg = await h.post('/api/eggs/pair', { creatureIdA: a, creatureIdB: b }, token)
    finishEgg(egg.body.egg.id)
    expect((await h.post('/api/eggs/hatch', { id: egg.body.egg.id }, token)).status).toBe(200)
    const second = await h.post('/api/eggs/hatch', { id: egg.body.egg.id }, token)
    expect(second.status).toBe(409)
    expect(second.body.detail.reason).toBe('already_hatched')
  })

  it('schluepft die Basisform, nicht die Entwicklung', async () => {
    // testmon entwickelt sich zu testmon-evo; ein Ei zweier Entwicklungen
    // muss trotzdem die Basisform ergeben.
    const a = addCreature('testmon-evo', 30)
    const b = addCreature('testmon-evo', 30)
    const egg = await h.post('/api/eggs/pair', { creatureIdA: a, creatureIdB: b }, token)
    finishEgg(egg.body.egg.id)
    const r = await h.post('/api/eggs/hatch', { id: egg.body.egg.id }, token)
    expect(r.body.creature.speciesId).toBe('testmon')
  })

  it('vererbt gute Werte spuerbar', async () => {
    /*
     * Ueber mehrere Eier gemittelt, nicht an einem einzelnen gemessen.
     *
     * Drei von sechs Werten kommen vom besseren Elternteil, die anderen drei
     * sind ein Wurf zwischen 0 und 31 — der Erwartungswert liegt bei 75 %, ein
     * einzelnes Ei kann aber auch mal bei 54 % landen. Genau das ist im
     * Gesamtlauf passiert, und ein Test, der gelegentlich ohne Grund rot wird,
     * macht den ganzen Lauf wertlos.
     */
    const percents: number[] = []
    for (let i = 0; i < 5; i++) {
      const a = addCreature('wildmon', 30, 31)
      const b = addCreature('nachtmon', 30, 31)
      h.resetRateLimits()
      const egg = await h.post('/api/eggs/pair', { creatureIdA: a, creatureIdB: b }, token)
      finishEgg(egg.body.egg.id)
      h.resetRateLimits()
      const r = await h.post('/api/eggs/hatch', { id: egg.body.egg.id }, token)
      percents.push(r.body.creature.ivPercent)
    }
    const mean = percents.reduce((x, y) => x + y, 0) / percents.length
    expect(mean).toBeGreaterThan(55)
  })
})
