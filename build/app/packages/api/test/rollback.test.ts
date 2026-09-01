import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as acquisitions from '../src/repos/acquisitions.js'
import { zuruecknehmen } from '../src/tools/rollback.js'
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
  h.ctx.db.prepare('UPDATE trainers SET current_area_id = ?, energy = 9000, gold = 5000 WHERE id = ?')
    .run('test-route', trainerId)
})
afterEach(async () => { await h.close() })

describe('Belege', () => {
  it('haelt fest, was der Starter gebracht hat — mit Quelle und Stand', () => {
    const belege = acquisitions.find(h.ctx.db, { trainerId })
    const starter = belege.find((b) => b.source === 'starter')

    expect(starter).toBeDefined()
    expect(starter!.kind).toBe('creature')
    // Ohne die Kennung liesse sich die Zeile in `creatures` nicht finden —
    // genau daran scheiterte die Aufarbeitung des Mewtu-Falls.
    expect(h.ctx.db.prepare('SELECT id FROM creatures WHERE id = ?').get(starter!.ref)).toBeDefined()
    expect(belege.some((b) => b.source === 'starter.kit' && b.kind === 'item')).toBe(true)
  })

  it('bucht einen Einkauf auf seine eigene Quelle', async () => {
    h.resetRateLimits()
    const r = await h.post('/api/shop/buy', { itemId: 'poke-ball', quantity: 3 }, token)
    expect(r.status).toBe(200)

    const kauf = acquisitions.find(h.ctx.db, { trainerId, source: 'shop.buy' })
    expect(kauf).toHaveLength(1)
    expect(kauf[0]).toMatchObject({ kind: 'item', ref: 'poke-ball', amount: 3 })
  })
})

describe('Ruecknahme', () => {
  it('loescht das Pokemon und nimmt die Gegenstaende zurueck', async () => {
    h.resetRateLimits()
    await h.post('/api/shop/buy', { itemId: 'poke-ball', quantity: 5 }, token)

    const vorher = h.ctx.db.prepare('SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ?')
      .get(trainerId) as { n: number }
    const baelle = () => (h.ctx.db.prepare('SELECT quantity AS q FROM inventory WHERE trainer_id = ? AND item_id = ?')
      .get(trainerId, 'poke-ball') as { q: number } | undefined)?.q ?? 0
    const vorherBaelle = baelle()

    const treffer = acquisitions.find(h.ctx.db, { trainerId, source: 'starter' })
      .concat(acquisitions.find(h.ctx.db, { trainerId, source: 'shop.buy' }))
    const bericht = zuruecknehmen(h.ctx.db, treffer)

    expect(bericht.erledigt).toBe(2)
    expect(bericht.probleme).toEqual([])
    const nachher = h.ctx.db.prepare('SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ?')
      .get(trainerId) as { n: number }
    expect(nachher.n).toBe(vorher.n - 1)
    expect(baelle()).toBe(vorherBaelle - 5)
  })

  it('meldet, was schon verbraucht ist, statt ins Minus zu gehen', () => {
    // Ein Beleg ueber zehn Beeren, von denen nur zwei im Beutel liegen.
    h.ctx.db.prepare('INSERT OR REPLACE INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, 2)')
      .run(trainerId, 'oran-berry')
    acquisitions.record(h.ctx.db, trainerId, { source: 'test.quelle', release: 'abc123' }, 'item', 'oran-berry', 10)

    const bericht = zuruecknehmen(h.ctx.db, acquisitions.find(h.ctx.db, { source: 'test.quelle' }))

    const rest = h.ctx.db.prepare('SELECT quantity AS q FROM inventory WHERE trainer_id = ? AND item_id = ?')
      .get(trainerId, 'oran-berry') as { q: number }
    expect(rest.q).toBe(0)
    expect(bericht.probleme[0]).toContain('nur 2 von 10')
  })

  it('fasst ein weitergetauschtes Pokemon nicht an', async () => {
    /*
     * Der Fall, der einem Unbeteiligten schaden wuerde. Wer den Beleg hat,
     * hat es bekommen — wer es jetzt besitzt, muss es nicht gewesen sein.
     */
    const zweiter = await h.addTrainer(222, 'Misty')
    const starter = acquisitions.find(h.ctx.db, { trainerId, source: 'starter' })[0]!
    h.ctx.db.prepare('UPDATE creatures SET owner_id = ?, team_slot = NULL WHERE id = ?')
      .run(zweiter.id, starter.ref)

    const bericht = zuruecknehmen(h.ctx.db, [starter])

    expect(bericht.erledigt).toBe(0)
    expect(bericht.probleme[0]).toContain('jemand anderem')
    expect(h.ctx.db.prepare('SELECT id FROM creatures WHERE id = ?').get(starter.ref)).toBeDefined()
  })

  it('meldet ein Pokemon, das es nicht mehr gibt', () => {
    const starter = acquisitions.find(h.ctx.db, { trainerId, source: 'starter' })[0]!
    h.ctx.db.prepare('DELETE FROM creatures WHERE id = ?').run(starter.ref)

    const bericht = zuruecknehmen(h.ctx.db, [starter])
    expect(bericht.erledigt).toBe(0)
    expect(bericht.probleme[0]).toContain('gibt es nicht mehr')
  })

  it('findet gezielt nach Stand und Quelle', () => {
    // Die Abfrage, die im Mewtu-Fall gefehlt hat: alles, was unter einem
    // bestimmten Build durch eine bestimmte Quelle kam.
    for (const [stand, quelle] of [['aaa111', 'safari.catch'], ['bbb222', 'safari.catch'], ['aaa111', 'shop.buy']] as const) {
      acquisitions.record(h.ctx.db, trainerId, { source: quelle, release: stand }, 'gold', '', 100)
    }
    const treffer = acquisitions.find(h.ctx.db, { releaseSha: 'aaa111', source: 'safari.catch' })
    expect(treffer).toHaveLength(1)
  })
})
