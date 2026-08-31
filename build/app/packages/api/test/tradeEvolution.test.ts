import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LINK_CABLE_ITEM_ID } from '@game/engine'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

/**
 * Entwicklung durch Tausch.
 *
 * Elf Arten hingen im Pack, ohne dass sie je erreichbar waren: in der
 * Auswertung stand `case 'trade': break`. Es gibt jetzt zwei Wege dorthin, und
 * beide werden hier geprüft — samt der Frage, was dabei aus dem Beutel geht.
 */
let h: TestApp
let ash: { token: string; id: string }
let misty: { token: string; id: string }

const give = (trainerId: string, itemId: string, n: number) =>
  h.ctx.db.prepare(
    `INSERT INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, ?)
     ON CONFLICT(trainer_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
  ).run(trainerId, itemId, n)

const have = (trainerId: string, itemId: string): number =>
  (h.ctx.db.prepare('SELECT quantity FROM inventory WHERE trainer_id = ? AND item_id = ?')
    .get(trainerId, itemId) as { quantity: number } | undefined)?.quantity ?? 0

/** Ein Pokemon in die Box legen. Team-Plaetze stoeren beim Tausch. */
const grant = (trainerId: string, speciesId: string): string => {
  const id = crypto.randomUUID()
  h.ctx.db.prepare(
    `INSERT INTO creatures (id, owner_id, species_id, level, xp, nature, shiny,
       iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe,
       ev_hp, ev_atk, ev_def, ev_spa, ev_spd, ev_spe,
       hp_current, friendship, energy, caught_at, moves)
     VALUES (?, ?, ?, 30, 0, 'hardy', 0, 15,15,15,15,15,15, 0,0,0,0,0,0, 60, 70, 100, ?, ?)`,
  ).run(id, trainerId, speciesId, Date.now(), JSON.stringify([{ moveId: 'tackle', pp: 35 }]))
  return id
}

const speciesOf = (id: string): string =>
  (h.ctx.db.prepare('SELECT species_id AS s FROM creatures WHERE id = ?').get(id) as { s: string }).s

beforeEach(async () => {
  h = await makeTestApp()
  const a = await h.post('/api/auth/session', { initData: signInitData({ id: 11, first_name: 'Ash' }) })
  ash = { token: a.body.token, id: a.body.trainer.id }
  misty = await h.addTrainer(22, 'Misty')
  const [low, high] = [ash.id, misty.id].sort()
  h.ctx.db.prepare('INSERT INTO friendships (low_id, high_id, created_at) VALUES (?, ?, ?)')
    .run(low, high, Date.now())
})
afterEach(async () => { await h.close() })

describe('Verbindungskabel', () => {
  it('taucht ohne Kabel gar nicht erst als Möglichkeit auf', async () => {
    grant(ash.id, 'tauschmon')
    h.resetRateLimits()
    const r = await h.get('/api/evolutions', ash.token)
    expect(r.body.candidates).toHaveLength(0)
  })

  it('entwickelt und verbraucht dabei genau ein Kabel', async () => {
    const id = grant(ash.id, 'tauschmon')
    give(ash.id, LINK_CABLE_ITEM_ID, 2)
    h.resetRateLimits()
    const r = await h.post('/api/evolutions/evolve', { creatureId: id, targetSpeciesId: 'tauschmon-evo' }, ash.token)
    expect(r.status).toBe(200)
    expect(speciesOf(id)).toBe('tauschmon-evo')
    expect(have(ash.id, LINK_CABLE_ITEM_ID)).toBe(1)
  })

  it('verlangt bei einer Art mit Tragegegenstand auch diesen', async () => {
    const id = grant(ash.id, 'haltmon')
    give(ash.id, LINK_CABLE_ITEM_ID, 1)
    h.resetRateLimits()
    // Kabel ja, Metallmantel nein — also steht die Entwicklung nicht zur Wahl.
    const blocked = await h.post('/api/evolutions/evolve', { creatureId: id, targetSpeciesId: 'haltmon-evo' }, ash.token)
    expect(blocked.status).toBe(409)
    expect(blocked.body.detail.reason).toBe('not_ready')

    give(ash.id, 'metal-coat', 1)
    h.resetRateLimits()
    const ok = await h.post('/api/evolutions/evolve', { creatureId: id, targetSpeciesId: 'haltmon-evo' }, ash.token)
    expect(ok.status).toBe(200)
    // Beides ist weg: der Mantel gehoert im Vorbild zum Tausch dazu.
    expect(have(ash.id, LINK_CABLE_ITEM_ID)).toBe(0)
    expect(have(ash.id, 'metal-coat')).toBe(0)
  })
})

describe('Tausch-Station', () => {
  it('zeigt auch, was noch fehlt', async () => {
    grant(ash.id, 'haltmon')
    h.resetRateLimits()
    const r = await h.get('/api/trade-station', ash.token)
    expect(r.body.cables).toBe(0)
    expect(r.body.recipeUnlocked).toBe(false)
    const row = r.body.rows[0]
    expect(row.targetName).toBe('Haltmon-evo')
    expect(row.heldItem).toMatchObject({ id: 'metal-coat', owned: 0 })
    expect(row.ready).toBe(false)
  })

  it('meldet bereit, sobald beides da ist', async () => {
    grant(ash.id, 'haltmon')
    give(ash.id, LINK_CABLE_ITEM_ID, 1)
    give(ash.id, 'metal-coat', 1)
    h.resetRateLimits()
    const r = await h.get('/api/trade-station', ash.token)
    expect(r.body.rows[0].ready).toBe(true)
  })
})

describe('Echter Tausch', () => {
  /** Anbieten und die Id des frischen Angebots zurueckgeben. */
  const offer = async (offeredId: string, requestedId: string | null = null) => {
    h.resetRateLimits()
    const r = await h.post('/api/trades/offer',
      { toTrainerId: misty.id, offeredId, requestedId }, ash.token)
    expect(r.status).toBe(200)
    return r.body.outgoing[0].id as string
  }
  const accept = async (tradeId: string, token = misty.token) => {
    h.resetRateLimits()
    return h.post('/api/trades/respond', { tradeId, accept: true }, token)
  }

  it('entwickelt beim Empfaenger — ohne Kabel', async () => {
    const id = grant(ash.id, 'tauschmon')
    const r = await accept(await offer(id))
    expect(r.status).toBe(200)
    expect(r.body.evolved).toEqual(['Tauschmon-evo'])
    expect(speciesOf(id)).toBe('tauschmon-evo')
    // Niemand hat je ein Kabel besessen: der echte Tausch braucht keins.
    expect(have(misty.id, LINK_CABLE_ITEM_ID)).toBe(0)
  })

  it('braucht den Tragegegenstand beim Empfaenger, nicht beim Absender', async () => {
    const id = grant(ash.id, 'haltmon')
    give(ash.id, 'metal-coat', 1)
    await accept(await offer(id))
    // Ash hatte den Mantel, gibt das Pokemon aber weg: bei Misty liegt keiner,
    // also passiert nichts — und Ashs Mantel bleibt unangetastet.
    expect(speciesOf(id)).toBe('haltmon')
    expect(have(ash.id, 'metal-coat')).toBe(1)

    // Zurueck an Ash. Jetzt ist Ash der Empfaenger, und Ash hat den Mantel.
    h.resetRateLimits()
    const back = await h.post('/api/trades/offer',
      { toTrainerId: ash.id, offeredId: id, requestedId: null }, misty.token)
    h.resetRateLimits()
    await accept(back.body.outgoing[0].id, ash.token)
    expect(speciesOf(id)).toBe('haltmon-evo')
    expect(have(ash.id, 'metal-coat')).toBe(0)
  })

  it('entwickelt beide Seiten eines Ringtauschs', async () => {
    const mine = grant(ash.id, 'tauschmon')
    const hers = grant(misty.id, 'tauschmon')
    const r = await accept(await offer(mine, hers))
    expect(r.body.evolved).toHaveLength(2)
    expect(speciesOf(mine)).toBe('tauschmon-evo')
    expect(speciesOf(hers)).toBe('tauschmon-evo')
  })

  it('laesst den Marktkauf bewusst kalt', async () => {
    const id = grant(ash.id, 'tauschmon')
    h.resetRateLimits()
    const listed = await h.post('/api/market/list', { creatureId: id, price: 100 }, ash.token)
    expect(listed.status).toBe(200)
    h.ctx.db.prepare('UPDATE trainers SET gold = 5000 WHERE id = ?').run(misty.id)
    h.resetRateLimits()
    const bought = await h.post('/api/market/buy', { listingId: listed.body.ownListings[0].id }, misty.token)
    expect(bought.status).toBe(200)
    // Gold gegen Pokemon ist kein Tausch: mit einem zweiten Konto waere der
    // Markt sonst der billigste Weg an alle elf Arten.
    expect(speciesOf(id)).toBe('tauschmon')
  })
})
