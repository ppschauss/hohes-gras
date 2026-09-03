import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let token: string
let trainerId: string
let starterId: string

beforeEach(async () => {
  h = await makeTestApp()
  const auth = await h.post('/api/auth/session', { initData: signInitData({ id: 111, first_name: 'Ash' }) })
  token = auth.body.token
  trainerId = auth.body.trainer.id
  await h.post('/api/starter', { speciesId: 'testmon' }, token)
  starterId = (await h.get('/api/garden', token)).body.team[0].id
})
afterEach(async () => { await h.close() })

const give = (itemId: string, n: number) =>
  h.ctx.db.prepare('INSERT OR REPLACE INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, ?)')
    .run(trainerId, itemId, n)
const hpOf = (id: string) =>
  (h.ctx.db.prepare('SELECT hp_current AS hp FROM creatures WHERE id = ?').get(id) as { hp: number }).hp
const quantity = (itemId: string) =>
  (h.ctx.db.prepare('SELECT quantity FROM inventory WHERE trainer_id = ? AND item_id = ?')
    .get(trainerId, itemId) as { quantity: number } | undefined)?.quantity ?? 0

describe('Gegenstände aus dem Beutel', () => {
  it('heilt ein verletztes Pokemon', async () => {
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 3 WHERE id = ?').run(starterId)
    give('potion', 2)
    h.resetRateLimits()
    const r = await h.post('/api/items/use', { itemId: 'potion', creatureId: starterId }, token)
    expect(r.status).toBe(200)
    expect(hpOf(starterId)).toBeGreaterThan(3)
    expect(quantity('potion')).toBe(1)
  })

  it('verbraucht nichts, wenn nichts zu heilen ist', async () => {
    give('potion', 1)
    h.resetRateLimits()
    const r = await h.post('/api/items/use', { itemId: 'potion', creatureId: starterId }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('already_full')
    expect(quantity('potion')).toBe(1)
  })

  it('schickt Lockduefte in die Safari statt sie hier zu verbrauchen', async () => {
    give('lure-grass', 3)
    h.resetRateLimits()
    const r = await h.post('/api/items/use', { itemId: 'lure-grass' }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('use_in_safari')
    expect(quantity('lure-grass')).toBe(3)
  })

  it('loest den Stoersender ohne Ziel aus', async () => {
    give('rocket-bait', 1)
    h.resetRateLimits()
    const r = await h.post('/api/items/use', { itemId: 'rocket-bait' }, token)
    expect(r.status).toBe(200)
    expect(r.body.result.charges).toBe(5)
    expect(quantity('rocket-bait')).toBe(0)
  })

  it('laesst waehrend eines Kampfes nichts aus dem Beutel zu', async () => {
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run('test-route', trainerId)
    h.resetRateLimits()
    await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)
    give('potion', 1)
    h.ctx.db.prepare('UPDATE creatures SET hp_current = 3 WHERE id = ?').run(starterId)
    h.resetRateLimits()
    const r = await h.post('/api/items/use', { itemId: 'potion', creatureId: starterId }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('battle_in_progress')
  })
})

describe('Vitamine, Kronkorken und Sonderbonbon', () => {
  const gib = (itemId: string, n: number) =>
    h.ctx.db.prepare('INSERT OR REPLACE INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, ?)')
      .run(trainerId, itemId, n)
  const feld = (spalte: string) => (h.ctx.db.prepare(`SELECT ${spalte} AS v FROM creatures WHERE id = ?`)
    .get(starterId) as { v: number }).v

  it('bringt sein Vitamin den eigenen Wert mit — ohne Nachfrage', async () => {
    /*
     * Ein Protein *ist* Angriff. Hier stand zuerst eine erfundene Beere mit
     * einer Wertwahl; die Vorlage kennt dafuer sechs eigene Gegenstaende, und
     * damit entfaellt die Frage.
     */
    gib('protein', 1)
    h.resetRateLimits()
    const r = await h.post('/api/items/use', { itemId: 'protein', creatureId: starterId }, token)

    expect(r.status).toBe(200)
    expect(r.body.result).toMatchObject({ kind: 'ev', stat: 'atk', statValue: 32 })
    expect(feld('ev_atk')).toBe(32)
    expect(feld('ev_spe')).toBe(0)
  })

  it('trifft jedes Vitamin seinen eigenen Wert', async () => {
    gib('carbos', 1)
    h.resetRateLimits()
    await h.post('/api/items/use', { itemId: 'carbos', creatureId: starterId }, token)
    expect(feld('ev_spe')).toBe(32)
    expect(feld('ev_atk')).toBe(0)
  })

  it('laesst den Kronkorken den Wert waehlen', async () => {
    h.ctx.db.prepare('UPDATE creatures SET iv_def = 4 WHERE id = ?').run(starterId)
    gib('bottle-cap', 1)
    h.resetRateLimits()
    const r = await h.post('/api/items/use',
      { itemId: 'bottle-cap', creatureId: starterId, stat: 'def' }, token)

    expect(r.status).toBe(200)
    expect(r.body.result).toMatchObject({ kind: 'iv', stat: 'def', statValue: 31 })
    expect(feld('iv_def')).toBe(31)
  })

  it('verweigert einen Wert, der schon vollkommen ist', async () => {
    // Sonst waere der teuerste Gegenstand im Spiel mit einem Fehlgriff weg.
    h.ctx.db.prepare('UPDATE creatures SET iv_def = 31 WHERE id = ?').run(starterId)
    gib('bottle-cap', 1)
    h.resetRateLimits()
    const r = await h.post('/api/items/use',
      { itemId: 'bottle-cap', creatureId: starterId, stat: 'def' }, token)

    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('already_perfect')
    expect((h.ctx.db.prepare('SELECT quantity AS q FROM inventory WHERE trainer_id = ? AND item_id = ?')
      .get(trainerId, 'bottle-cap') as { q: number }).q).toBe(1)
  })

  it('hebt das Sonderbonbon um genau ein Level', async () => {
    /*
     * Es gab fuenfzig Erfahrungspunkte. Bei Level 39 kostet ein Aufstieg
     * 4.681, bei Level 100 gut 30.000 — der Gegenstand tat also ein
     * Achtzigstel dessen, was sein Name verspricht.
     */
    h.ctx.db.prepare('UPDATE creatures SET level = 20, xp = 8000 WHERE id = ?').run(starterId)
    gib('rare-candy', 1)
    h.resetRateLimits()
    const r = await h.post('/api/items/use', { itemId: 'rare-candy', creatureId: starterId }, token)

    expect(r.status).toBe(200)
    expect(r.body.result.leveledUp).toBe(true)
    expect(feld('level')).toBe(21)
  })

  it('wirkt das Bonbon auf jeder Stufe gleich', async () => {
    // Der eigentliche Punkt: "ein Level" muss auf Stufe 60 dasselbe heissen
    // wie auf Stufe 20, und dafuer wird die Luecke gerechnet, kein Betrag.
    h.ctx.db.prepare('UPDATE creatures SET level = 60, xp = 216000 WHERE id = ?').run(starterId)
    gib('rare-candy', 1)
    h.resetRateLimits()
    await h.post('/api/items/use', { itemId: 'rare-candy', creatureId: starterId }, token)
    expect(feld('level')).toBe(61)
  })
})
