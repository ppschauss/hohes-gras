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
  // Baelle fuer die Safari
  await h.post('/api/shop/buy', { itemId: 'poke-ball', quantity: 5 }, token)
})
afterEach(async () => { await h.close() })

/** Direkt in der DB fangen, um Freischaltbedingungen zu erfuellen, ohne von
 *  der Zufallslogik der Safari abzuhaengen. */
function seedCatch(speciesId: string, areaId: string, level = 12) {
  h.ctx.db.prepare(
    `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature,
       iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe, friendship, energy, hp_current,
       shiny, moves, caught_at, caught_area_id, team_slot)
     VALUES (?, ?, ?, 0, ?, 'hardy', 20,20,20,20,20,20, 70, 100, 30, 0, '["tackle"]', ?, ?, NULL)`,
  ).run(crypto.randomUUID(), trainerId, speciesId, level, Date.now(), areaId)
}

describe('Weltkarte', () => {
  it('zeigt Regionen und Gebiete in Reihenfolge', async () => {
    const r = await h.get('/api/world', token)
    expect(r.status).toBe(200)
    expect(r.body.regions).toHaveLength(2)
    const areas = r.body.regions[0].areas
    expect(areas.map((a: any) => a.id)).toEqual(['test-route', 'test-cave'])
  })

  it('oeffnet das Startgebiet ohne Bedingungen', async () => {
    const r = await h.get('/api/world', token)
    const route = r.body.regions[0].areas[0]
    expect(route.unlocked).toBe(true)
    expect(route.requirements).toHaveLength(0)
  })

  it('nennt jede unerfuellte Bedingung mit Ist- und Sollwert', async () => {
    const r = await h.get('/api/world', token)
    const cave = r.body.regions[0].areas[1]
    expect(cave.unlocked).toBe(false)
    const kinds = cave.requirements.map((q: any) => q.kind)
    expect(kinds).toContain('caught_in_previous')
    expect(kinds).toContain('creatures_at_level')
    expect(kinds).toContain('badges')
    const caught = cave.requirements.find((q: any) => q.kind === 'caught_in_previous')
    expect(caught).toMatchObject({ met: false, have: 0, need: 2 })
  })

  it('schaltet frei, sobald alle Bedingungen erfuellt sind', async () => {
    seedCatch('wildmon', 'test-route', 12)
    seedCatch('nachtmon', 'test-route', 12)
    h.ctx.db.prepare('INSERT INTO trainer_badges (trainer_id, badge_id, earned_at) VALUES (?, ?, ?)')
      .run(trainerId, 'test-badge', Date.now())
    const r = await h.get('/api/world', token)
    const cave = r.body.regions[0].areas[1]
    expect(cave.requirements.every((q: any) => q.met)).toBe(true)
    expect(cave.unlocked).toBe(true)
  })

  it('zaehlt nur verschiedene Arten pro Gebiet', async () => {
    seedCatch('wildmon', 'test-route')
    seedCatch('wildmon', 'test-route')
    const r = await h.get('/api/world', token)
    expect(r.body.regions[0].areas[0].caughtHere).toBe(1)
  })

  it('meldet, was gerade spawnen kann', async () => {
    const r = await h.get('/api/world', token)
    const route = r.body.regions[0].areas[0]
    expect(route.speciesHere).toBe(3)
    // Nachts alle drei, sonst zwei — in jedem Fall mindestens zwei.
    expect(route.spawnableNow).toBeGreaterThanOrEqual(2)
    expect(route.spawnableNow).toBeLessThanOrEqual(3)
  })
})

describe('Reisen', () => {
  it('erlaubt das Startgebiet', async () => {
    const r = await h.post('/api/world/travel', { areaId: 'test-route' }, token)
    expect(r.status).toBe(200)
    expect(r.body.currentAreaId).toBe('test-route')
  })

  it('verweigert ein gesperrtes Gebiet und nennt die Gruende', async () => {
    const r = await h.post('/api/world/travel', { areaId: 'test-cave' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('area_locked')
    expect(r.body.detail.requirements.length).toBeGreaterThan(0)
  })

  it('weist ein unbekanntes Gebiet ab', async () => {
    expect((await h.post('/api/world/travel', { areaId: 'atlantis' }, token)).status).toBe(404)
  })
})

describe('Safari', () => {
  it('findet ein Pokemon und legt eine Begegnung an', async () => {
    const r = await h.post('/api/safari/explore', { ballId: 'poke-ball', berryId: null }, token)
    expect(r.status).toBe(200)
    expect(r.body.kind).toBe('encounter')
    expect(r.body.legendary).toBe(false)
    expect(r.body.encounter.speciesId).toBeTruthy()
    expect(r.body.encounter.probability).toBeGreaterThan(0)
    expect(r.body.encounter.probability).toBeLessThanOrEqual(0.95)
  })

  it('haelt genau eine Begegnung offen', async () => {
    await h.post('/api/safari/explore', {}, token)
    const first = (await h.get('/api/safari', token)).body.encounter.speciesId
    await h.post('/api/safari/explore', {}, token)
    const rows = h.ctx.db.prepare('SELECT COUNT(*) n FROM active_encounter WHERE trainer_id = ?').get(trainerId) as any
    expect(rows.n).toBe(1)
    expect(first).toBeTruthy()
  })

  it('traegt die Art sofort als gesehen in den Dex ein', async () => {
    const r = await h.post('/api/safari/explore', {}, token)
    const dex = await h.get('/api/dex', token)
    const row = dex.body.rows.find((x: any) => x.speciesId === r.body.encounter.speciesId)
    expect(row.seen).toBe(true)
    expect(row.caught).toBe(false)
  })

  it('erhoeht die Fangchance mit Beruhigen', async () => {
    const start = await h.post('/api/safari/explore', {}, token)
    const before = start.body.encounter.probability
    const after = await h.post('/api/safari/soften', { action: 'calm' }, token)
    expect(after.body.probability).toBeGreaterThan(before)
    expect(after.body.calmStacks).toBe(1)
  })

  it('deckelt Beruhigen bei der Obergrenze', async () => {
    await h.post('/api/safari/explore', {}, token)
    await h.post('/api/safari/soften', { action: 'calm' }, token)
    await h.post('/api/safari/soften', { action: 'calm' }, token)
    const third = await h.post('/api/safari/soften', { action: 'calm' }, token)
    expect(third.status).toBe(409)
    expect(third.body.detail.reason).toBe('already_maxed')
  })

  it('erhoeht die Fangchance mit einem besseren Ball', async () => {
    const buy = await h.post('/api/shop/buy', { itemId: 'great-ball', quantity: 1 }, token)
    expect(buy.status).toBe(200)
    const plain = await h.post('/api/safari/explore', { ballId: 'poke-ball' }, token)
    const better = await h.get('/api/safari?ballId=great-ball', token)
    expect(better.body.encounter.probability).toBeGreaterThan(plain.body.encounter.probability)
  })

  it('verbraucht beim Werfen einen Ball', async () => {
    await h.post('/api/safari/explore', {}, token)
    const before = (await h.get('/api/bag', token)).body.items.find((i: any) => i.id === 'poke-ball').quantity
    await h.post('/api/safari/throw', { ballId: 'poke-ball' }, token)
    const after = (await h.get('/api/bag', token)).body.items.find((i: any) => i.id === 'poke-ball').quantity
    expect(after).toBe(before - 1)
  })

  it('weist einen Wurf ohne Baelle ab', async () => {
    await h.post('/api/safari/explore', {}, token)
    h.ctx.db.prepare('UPDATE inventory SET quantity = 0 WHERE trainer_id = ? AND item_id = ?')
      .run(trainerId, 'poke-ball')
    const r = await h.post('/api/safari/throw', { ballId: 'poke-ball' }, token)
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('insufficient_items')
  })

  it('weist einen Wurf ohne Begegnung ab', async () => {
    const r = await h.post('/api/safari/throw', { ballId: 'poke-ball' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('no_encounter')
  })

  it('legt bei Erfolg ein Pokemon an und schliesst die Begegnung', async () => {
    // Superbaelle direkt gutschreiben statt kaufen: 40 Stueck kosten mehr Gold,
    // als ein neuer Trainer besitzt, und der Fangtest soll den Fang pruefen,
    // nicht die Kaufkraft.
    h.ctx.db.prepare(
      `INSERT INTO inventory (trainer_id, item_id, quantity) VALUES (?, 'great-ball', 40)
       ON CONFLICT(trainer_id, item_id) DO UPDATE SET quantity = 40`,
    ).run(trainerId)
    let caught: any = null
    for (let i = 0; i < 40 && !caught; i++) {
      h.resetRateLimits()
      await h.post('/api/safari/explore', {}, token)
      const r = await h.post('/api/safari/throw', { ballId: 'great-ball' }, token)
      if (r.body.caught) caught = r.body
    }
    expect(caught).toBeTruthy()
    expect(caught.creature.id).toBeTruthy()
    expect(caught.reward.gold).toBeGreaterThan(0)
    expect(caught.chain).toBeGreaterThanOrEqual(1)
    const active = h.ctx.db.prepare('SELECT COUNT(*) n FROM active_encounter WHERE trainer_id = ?').get(trainerId) as any
    expect(active.n).toBe(0)
  })

  it('beendet die Begegnung beim Fliehen', async () => {
    await h.post('/api/safari/explore', {}, token)
    await h.post('/api/safari/flee', {}, token)
    const r = await h.get('/api/safari', token)
    expect(r.body.encounter).toBeNull()
  })

  it('weist einen unbekannten Ball ab', async () => {
    await h.post('/api/safari/explore', {}, token)
    const r = await h.post('/api/safari/throw', { ballId: 'oran-berry' }, token)
    expect(r.status).toBe(400)
    expect(r.body.detail.field).toBe('ballId')
  })
})
