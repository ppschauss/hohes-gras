import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_PARTY } from '@game/engine'
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

const teamId = async () => (await h.get('/api/garden', token)).body.team[0].id

/** Zeit vorspulen, indem die Endzeit in die Vergangenheit gelegt wird. */
function finishNow(expeditionId: string) {
  h.ctx.db.prepare('UPDATE expeditions SET ends_at = ? WHERE id = ?').run(Date.now() - 1000, expeditionId)
}

describe('Expeditionen', () => {
  it('bietet Arten, Dauern und verfuegbare Pokemon an', async () => {
    const r = await h.get('/api/expeditions', token)
    expect(r.status).toBe(200)
    expect(r.body.kinds.length).toBeGreaterThanOrEqual(4)
    expect(r.body.durations.map((d: any) => d.id)).toEqual(['short', 'medium', 'long'])
    expect(r.body.available).toHaveLength(1)
    expect(r.body.open).toHaveLength(0)
  })

  it('startet eine Expedition und zieht Energie ab', async () => {
    const id = await teamId()
    const before = (await h.get('/api/garden', token)).body.team[0].energy
    const r = await h.post('/api/expeditions', { kind: 'forage', duration: 'short', creatureIds: [id] }, token)
    expect(r.status).toBe(200)
    expect(r.body.expedition.ready).toBe(false)
    expect(r.body.expedition.members[0].id).toBe(id)
    const after = (await h.get('/api/garden', token)).body.team[0].energy
    expect(after).toBeLessThan(before)
  })

  it('sperrt Pokemon, die schon unterwegs sind', async () => {
    const id = await teamId()
    await h.post('/api/expeditions', { kind: 'forage', duration: 'short', creatureIds: [id] }, token)
    const again = await h.post('/api/expeditions', { kind: 'dig', duration: 'short', creatureIds: [id] }, token)
    expect(again.status).toBe(409)
    expect(again.body.detail.reason).toBe('already_away')
    const list = await h.get('/api/expeditions', token)
    expect(list.body.available.map((c: any) => c.id)).not.toContain(id)
  })

  it('weist zu erschoepfte Pokemon ab', async () => {
    const id = await teamId()
    h.ctx.db.prepare('UPDATE creatures SET energy = 1 WHERE id = ?').run(id)
    const r = await h.post('/api/expeditions', { kind: 'forage', duration: 'long', creatureIds: [id] }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('too_tired')
  })

  it('weist fremde Pokemon ab', async () => {
    const r = await h.post('/api/expeditions', {
      kind: 'forage', duration: 'short', creatureIds: ['00000000-0000-4000-8000-000000000000'],
    }, token)
    expect(r.status).toBe(404)
  })

  it('begrenzt die Zahl offener Expeditionen', async () => {
    // Drei zusaetzliche Pokemon, damit jede Expedition ein eigenes bekommt.
    for (let i = 0; i < 4; i++) {
      h.ctx.db.prepare(
        `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature, iv_hp, iv_atk, iv_def,
           iv_spa, iv_spd, iv_spe, friendship, energy, hp_current, shiny, moves, caught_at, team_slot)
         VALUES (?, ?, 'wildmon', 0, 10, 'hardy', 20,20,20,20,20,20, 70, 100, 30, 0, '["tackle"]', ?, NULL)`,
      ).run(crypto.randomUUID(), trainerId, Date.now())
    }
    const available = (await h.get('/api/expeditions', token)).body.available
    // Vier gleichzeitig — frueher war bei drei Schluss.
    for (let i = 0; i < 4; i++) {
      h.resetRateLimits()
      const r = await h.post('/api/expeditions', {
        kind: 'forage', duration: 'short', creatureIds: [available[i].id],
      }, token)
      expect(r.status).toBe(200)
    }
    expect((await h.get('/api/expeditions', token)).body.open).toHaveLength(4)
  })

  it('verweigert das Einsammeln vor Ablauf', async () => {
    const id = await teamId()
    const start = await h.post('/api/expeditions', { kind: 'forage', duration: 'long', creatureIds: [id] }, token)
    const r = await h.post('/api/expeditions/collect', { id: start.body.expedition.id }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('not_ready')
  })

  it('zahlt Beute, Gold und EP aus', async () => {
    const id = await teamId()
    const start = await h.post('/api/expeditions', { kind: 'forage', duration: 'medium', creatureIds: [id] }, token)
    finishNow(start.body.expedition.id)

    const goldBefore = (await h.get('/api/bag', token)).body.gold
    const r = await h.post('/api/expeditions/collect', { id: start.body.expedition.id }, token)
    expect(r.status).toBe(200)
    expect(r.body.result.loot.length).toBeGreaterThan(0)
    expect(r.body.result.gold).toBeGreaterThan(0)
    expect(r.body.result.xpPerMember).toBeGreaterThan(0)
    const goldAfter = (await h.get('/api/bag', token)).body.gold
    expect(goldAfter).toBe(goldBefore + r.body.result.gold)
    expect(r.body.overview.open).toHaveLength(0)
  })

  it('laesst sich nicht zweimal einsammeln', async () => {
    const id = await teamId()
    const start = await h.post('/api/expeditions', { kind: 'dig', duration: 'short', creatureIds: [id] }, token)
    finishNow(start.body.expedition.id)
    expect((await h.post('/api/expeditions/collect', { id: start.body.expedition.id }, token)).status).toBe(200)
    const second = await h.post('/api/expeditions/collect', { id: start.body.expedition.id }, token)
    expect(second.status).toBe(409)
    expect(second.body.detail.reason).toBe('already_collected')
  })

  it('liefert bei gleicher Expedition immer dasselbe Ergebnis', async () => {
    // Das Ergebnis wird beim Start durch den Seed festgelegt; spaeter oder
    // frueher einsammeln darf daran nichts aendern.
    const id = await teamId()
    const start = await h.post('/api/expeditions', { kind: 'dive', duration: 'short', creatureIds: [id] }, token)
    finishNow(start.body.expedition.id)
    const first = await h.post('/api/expeditions/collect', { id: start.body.expedition.id }, token)

    h.ctx.db.prepare('UPDATE expeditions SET collected_at = NULL WHERE id = ?').run(start.body.expedition.id)
    const again = await h.post('/api/expeditions/collect', { id: start.body.expedition.id }, token)
    expect(again.body.result.gold).toBe(first.body.result.gold)
    expect(again.body.result.loot).toEqual(first.body.result.loot)
  })

  it('weist eine unbekannte Art ab', async () => {
    const id = await teamId()
    const r = await h.post('/api/expeditions', { kind: 'raumfahrt', duration: 'short', creatureIds: [id] }, token)
    expect(r.status).toBe(400)
  })
})

describe('Vorziehen', () => {
  const startShort = async () => {
    const creature = await teamId()
    h.resetRateLimits()
    return h.post('/api/expeditions', { kind: 'dig', duration: 'short', creatureIds: [creature] }, token)
  }

  it('kostet Energie und macht die Expedition sofort fertig', async () => {
    const started = await startShort()
    const id = started.body.expedition.id
    h.resetRateLimits()
    const overview = await h.get('/api/expeditions', token)
    const cost = overview.body.open.find((e: any) => e.id === id).rushCost
    // 30 Minuten zu zehn Minuten je Punkt.
    expect(cost).toBe(3)

    const before = (await h.get('/api/energy', token)).body.state.current
    h.resetRateLimits()
    const r = await h.post('/api/expeditions/rush', { id }, token)
    expect(r.status).toBe(200)
    expect(r.body.result.cost).toBe(3)
    expect(r.body.overview.open.find((e: any) => e.id === id).ready).toBe(true)
    expect(r.body.energy.current).toBe(before - 3)

    // Und sie laesst sich sofort einsammeln.
    h.resetRateLimits()
    expect((await h.post('/api/expeditions/collect', { id }, token)).status).toBe(200)
  })

  it('laesst sich nicht zweimal vorziehen', async () => {
    const started = await startShort()
    const id = started.body.expedition.id
    h.resetRateLimits()
    await h.post('/api/expeditions/rush', { id }, token)
    h.resetRateLimits()
    const again = await h.post('/api/expeditions/rush', { id }, token)
    expect(again.status).toBe(409)
    expect(again.body.detail.reason).toBe('already_ready')
  })
})

describe('Truppgröße', () => {
  /*
   * Weitere Pokemon in der Box anlegen.
   *
   * Bewusst nicht im Team: das fasst fuenf, eine Expedition nimmt sechs. Wer
   * sechs losschickt, schickt also mindestens eines aus der Kiste — genau der
   * Fall, der gemeldet wurde.
   */
  const addMember = () => {
    const trainerId = (h.ctx.db.prepare('SELECT id FROM trainers LIMIT 1').get() as { id: string }).id
    const id = crypto.randomUUID()
    h.ctx.db.prepare(
      `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature,
         iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe, friendship, energy, hp_current,
         shiny, moves, caught_at, team_slot)
       VALUES (?, ?, 'wildmon', 0, 5, 'hardy', 20,20,20,20,20,20, 70, 100, 20, 0, '["tackle"]', ?, NULL)`,
    ).run(id, trainerId, Date.now())
    return id
  }

  it('nimmt so viele Pokemon an, wie die Oberflaeche verspricht', async () => {
    // Gemeldet: "Wähle 1 bis 6 Pokémon" und dann "Diese Eingabe passt nicht".
    // Die Route klemmte bei drei, Engine und Oberflaeche erlaubten sechs.
    const ids = [await teamId()]
    for (let i = 1; i < MAX_PARTY; i++) ids.push(addMember())
    h.resetRateLimits()
    const r = await h.post('/api/expeditions', { kind: 'forage', duration: 'short', creatureIds: ids }, token)
    expect(r.status).toBe(200)
    expect(r.body.expedition.members).toHaveLength(MAX_PARTY)
  })

  it('weist mehr als die Hoechstzahl ab', async () => {
    const ids = [await teamId()]
    for (let i = 1; i <= MAX_PARTY; i++) ids.push(addMember())
    h.resetRateLimits()
    expect((await h.post('/api/expeditions', { kind: 'forage', duration: 'short', creatureIds: ids }, token)).status)
      .toBe(400)
  })
})
