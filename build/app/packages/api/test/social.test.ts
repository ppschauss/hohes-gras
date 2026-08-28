import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

let h: TestApp
let ash: { token: string; id: string; code: string }
let misty: { token: string; id: string; code: string }

async function setUp(telegramId: number, name: string, first = false) {
  if (first) {
    const auth = await h.post('/api/auth/session', { initData: signInitData({ id: telegramId, first_name: name }) })
    return { token: auth.body.token, id: auth.body.trainer.id, code: auth.body.trainer.trainerCode }
  }
  const t = await h.addTrainer(telegramId, name)
  const card = await h.get('/api/card', t.token)
  return { ...t, code: card.body.trainerCode }
}

beforeEach(async () => {
  h = await makeTestApp()
  ash = await setUp(111, 'Ash', true)
  misty = await setUp(222, 'Misty')
  await h.post('/api/starter', { speciesId: 'testmon' }, ash.token)
  await h.post('/api/starter', { speciesId: 'testmon' }, misty.token)
})
afterEach(async () => { await h.close() })

function giveCreature(ownerId: string, speciesId = 'wildmon', level = 10): string {
  const id = crypto.randomUUID()
  h.ctx.db.prepare(
    `INSERT INTO creatures (id, owner_id, species_id, xp, level, nature, iv_hp, iv_atk, iv_def,
       iv_spa, iv_spd, iv_spe, friendship, energy, hp_current, shiny, moves, caught_at, team_slot)
     VALUES (?, ?, ?, ?, ?, 'hardy', 20,20,20,20,20,20, 70, 100, 30, 0, '["tackle"]', ?, NULL)`,
  ).run(id, ownerId, speciesId, level ** 3, level, Date.now())
  return id
}

describe('Freunde', () => {
  it('zeigt den eigenen Trainer-Code', async () => {
    const r = await h.get('/api/friends', ash.token)
    expect(r.body.trainerCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(r.body.friends).toHaveLength(0)
  })

  it('sendet eine Anfrage und zeigt sie beiden Seiten', async () => {
    const r = await h.post('/api/friends/request', { code: misty.code }, ash.token)
    expect(r.body.status).toBe('sent')
    expect((await h.get('/api/friends', ash.token)).body.outgoing).toHaveLength(1)
    expect((await h.get('/api/friends', misty.token)).body.incoming).toHaveLength(1)
  })

  it('verbindet sofort, wenn beide sich gegenseitig anfragen', async () => {
    await h.post('/api/friends/request', { code: misty.code }, ash.token)
    const r = await h.post('/api/friends/request', { code: ash.code }, misty.token)
    expect(r.body.status).toBe('accepted')
    expect((await h.get('/api/friends', ash.token)).body.friends).toHaveLength(1)
    expect((await h.get('/api/friends', misty.token)).body.friends).toHaveLength(1)
  })

  it('nimmt eine Anfrage an', async () => {
    await h.post('/api/friends/request', { code: misty.code }, ash.token)
    const r = await h.post('/api/friends/respond', { fromId: ash.id, accept: true }, misty.token)
    expect(r.body.friends).toHaveLength(1)
    expect(r.body.incoming).toHaveLength(0)
  })

  it('lehnt eine Anfrage ab, ohne zu verbinden', async () => {
    await h.post('/api/friends/request', { code: misty.code }, ash.token)
    const r = await h.post('/api/friends/respond', { fromId: ash.id, accept: false }, misty.token)
    expect(r.body.friends).toHaveLength(0)
    expect(r.body.incoming).toHaveLength(0)
  })

  it('loest eine Freundschaft auf beiden Seiten', async () => {
    await h.post('/api/friends/request', { code: misty.code }, ash.token)
    await h.post('/api/friends/respond', { fromId: ash.id, accept: true }, misty.token)
    await h.post('/api/friends/remove', { trainerId: misty.id }, ash.token)
    expect((await h.get('/api/friends', ash.token)).body.friends).toHaveLength(0)
    expect((await h.get('/api/friends', misty.token)).body.friends).toHaveLength(0)
  })

  it('weist den eigenen Code ab', async () => {
    const r = await h.post('/api/friends/request', { code: ash.code }, ash.token)
    expect(r.status).toBe(400)
    expect(r.body.detail.reason).toBe('self')
  })

  it('weist einen unbekannten Code ab', async () => {
    expect((await h.post('/api/friends/request', { code: 'XXXX-XXXX' }, ash.token)).status).toBe(404)
  })

  it('respektiert eine geschlossene Anfrage-Einstellung', async () => {
    await h.post('/api/privacy', { allowFriendRequests: false }, misty.token)
    const r = await h.post('/api/friends/request', { code: misty.code }, ash.token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('requests_closed')
  })
})

describe('Trainerkarte', () => {
  it('zeigt die eigene Karte mit Code', async () => {
    const r = await h.get('/api/card', ash.token)
    expect(r.body.isSelf).toBe(true)
    expect(r.body.trainerCode).toBeTruthy()
    expect(r.body.dexTotal).toBe(7)
    expect(r.body.teamPreview).toHaveLength(1)
  })

  it('verbirgt den Code fremder Trainer', async () => {
    const r = await h.get(`/api/card/${misty.id}`, ash.token)
    expect(r.body.isSelf).toBe(false)
    expect(r.body.trainerCode).toBe('')
  })

  it('verbirgt ein Profil, das nur Freunde zulaesst', async () => {
    await h.post('/api/privacy', { friendsOnlyInteractions: true }, misty.token)
    expect((await h.get(`/api/card/${misty.id}`, ash.token)).status).toBe(404)
  })

  it('zeigt es Freunden trotzdem', async () => {
    await h.post('/api/privacy', { friendsOnlyInteractions: true }, misty.token)
    await h.post('/api/friends/request', { code: misty.code }, ash.token)
    await h.post('/api/friends/respond', { fromId: ash.id, accept: true }, misty.token)
    const r = await h.get(`/api/card/${misty.id}`, ash.token)
    expect(r.status).toBe(200)
    expect(r.body.isFriend).toBe(true)
  })
})

describe('Marktplatz', () => {
  it('listet ein Pokemon aus der Box', async () => {
    const id = giveCreature(ash.id)
    const r = await h.post('/api/market/list', { creatureId: id, price: 500, note: 'gut' }, ash.token)
    expect(r.status).toBe(200)
    expect(r.body.ownListings).toHaveLength(1)
    expect(r.body.ownListings[0].price).toBe(500)
  })

  it('weist ein Pokemon aus dem Team ab', async () => {
    const garden = await h.get('/api/garden', ash.token)
    const r = await h.post('/api/market/list', { creatureId: garden.body.team[0].id, price: 500 }, ash.token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('in_team')
  })

  it('weist ein fremdes Pokemon ab', async () => {
    const id = giveCreature(misty.id)
    const r = await h.post('/api/market/list', { creatureId: id, price: 500 }, ash.token)
    expect(r.status).toBe(403)
  })

  it('weist Preise ausserhalb der Grenzen ab', async () => {
    const id = giveCreature(ash.id)
    expect((await h.post('/api/market/list', { creatureId: id, price: 1 }, ash.token)).status).toBe(400)
    expect((await h.post('/api/market/list', { creatureId: id, price: 999999 }, ash.token)).status).toBe(400)
  })

  it('zeigt Angebote anderer, nicht die eigenen', async () => {
    const mine = giveCreature(ash.id)
    const theirs = giveCreature(misty.id)
    await h.post('/api/market/list', { creatureId: mine, price: 500 }, ash.token)
    await h.post('/api/market/list', { creatureId: theirs, price: 700 }, misty.token)
    const r = await h.get('/api/market', ash.token)
    expect(r.body.listings).toHaveLength(1)
    expect(r.body.listings[0].price).toBe(700)
    expect(r.body.ownListings).toHaveLength(1)
  })

  it('kauft, ueberschreibt den Besitzer und zieht die Gebuehr ab', async () => {
    const id = giveCreature(misty.id, 'wildmon', 12)
    const listed = await h.post('/api/market/list', { creatureId: id, price: 300 }, misty.token)
    const listingId = listed.body.ownListings[0].id

    h.ctx.db.prepare('UPDATE trainers SET gold = 1000 WHERE id = ?').run(ash.id)
    const sellerBefore = (await h.get('/api/bag', misty.token)).body.gold

    const r = await h.post('/api/market/buy', { listingId }, ash.token)
    expect(r.status).toBe(200)
    expect(r.body.paid).toBe(300)
    expect(r.body.creature.ownerId).toBe(ash.id)

    const buyerGold = (await h.get('/api/bag', ash.token)).body.gold
    expect(buyerGold).toBe(700)
    const sellerGold = (await h.get('/api/bag', misty.token)).body.gold
    expect(sellerGold).toBe(sellerBefore + 276)   // 300 minus 8 % Gebuehr
  })

  it('traegt den Kauf in den Pokedex ein', async () => {
    const id = giveCreature(misty.id, 'nachtmon')
    const listed = await h.post('/api/market/list', { creatureId: id, price: 100 }, misty.token)
    h.ctx.db.prepare('UPDATE trainers SET gold = 1000 WHERE id = ?').run(ash.id)
    await h.post('/api/market/buy', { listingId: listed.body.ownListings[0].id }, ash.token)
    const dex = await h.get('/api/dex', ash.token)
    expect(dex.body.rows.find((x: any) => x.speciesId === 'nachtmon').caught).toBe(true)
  })

  it('verhindert den zweiten Kauf desselben Angebots', async () => {
    const id = giveCreature(misty.id)
    const listed = await h.post('/api/market/list', { creatureId: id, price: 100 }, misty.token)
    const listingId = listed.body.ownListings[0].id
    h.ctx.db.prepare('UPDATE trainers SET gold = 1000 WHERE id = ?').run(ash.id)
    expect((await h.post('/api/market/buy', { listingId }, ash.token)).status).toBe(200)
    expect((await h.post('/api/market/buy', { listingId }, ash.token)).status).toBe(404)
  })

  it('verweigert den Kauf ohne Gold', async () => {
    const id = giveCreature(misty.id)
    const listed = await h.post('/api/market/list', { creatureId: id, price: 5000 }, misty.token)
    const r = await h.post('/api/market/buy', { listingId: listed.body.ownListings[0].id }, ash.token)
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('insufficient_funds')
    // Und das Angebot bleibt offen.
    expect((await h.get('/api/market', misty.token)).body.ownListings).toHaveLength(1)
  })

  it('verweigert den Kauf des eigenen Angebots', async () => {
    const id = giveCreature(ash.id)
    const listed = await h.post('/api/market/list', { creatureId: id, price: 100 }, ash.token)
    const r = await h.post('/api/market/buy', { listingId: listed.body.ownListings[0].id }, ash.token)
    expect(r.status).toBe(400)
  })

  it('zieht ein Angebot zurueck', async () => {
    const id = giveCreature(ash.id)
    const listed = await h.post('/api/market/list', { creatureId: id, price: 100 }, ash.token)
    const r = await h.post('/api/market/cancel', { listingId: listed.body.ownListings[0].id }, ash.token)
    expect(r.body.ownListings).toHaveLength(0)
    expect(r.body.sellable.some((c: any) => c.id === id)).toBe(true)
  })
})

describe('Direkttausch', () => {
  beforeEach(async () => {
    await h.post('/api/friends/request', { code: misty.code }, ash.token)
    await h.post('/api/friends/respond', { fromId: ash.id, accept: true }, misty.token)
  })

  it('verlangt eine Freundschaft', async () => {
    const stranger = await h.addTrainer(333, 'Brock')
    const mine = giveCreature(ash.id)
    const r = await h.post('/api/trades/offer', {
      toTrainerId: stranger.id, offeredId: mine, requestedId: null, message: '',
    }, ash.token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('not_friends')
  })

  it('legt ein Angebot an und zeigt es beiden', async () => {
    const mine = giveCreature(ash.id)
    const theirs = giveCreature(misty.id)
    const r = await h.post('/api/trades/offer', {
      toTrainerId: misty.id, offeredId: mine, requestedId: theirs, message: 'Deal?',
    }, ash.token)
    expect(r.status).toBe(200)
    expect(r.body.outgoing).toHaveLength(1)
    const theirView = await h.get('/api/trades', misty.token)
    expect(theirView.body.incoming).toHaveLength(1)
    expect(theirView.body.incoming[0].message).toBe('Deal?')
  })

  it('tauscht bei Annahme beide Pokemon', async () => {
    const mine = giveCreature(ash.id, 'wildmon')
    const theirs = giveCreature(misty.id, 'nachtmon')
    const offer = await h.post('/api/trades/offer', {
      toTrainerId: misty.id, offeredId: mine, requestedId: theirs, message: '',
    }, ash.token)
    const tradeId = offer.body.outgoing[0].id

    const r = await h.post('/api/trades/respond', { tradeId, accept: true }, misty.token)
    expect(r.body.accepted).toBe(true)

    const owners = h.ctx.db.prepare('SELECT id, owner_id FROM creatures WHERE id IN (?, ?)').all(mine, theirs) as any[]
    const byId = Object.fromEntries(owners.map((o) => [o.id, o.owner_id]))
    expect(byId[mine]).toBe(misty.id)
    expect(byId[theirs]).toBe(ash.id)
  })

  it('funktioniert auch als Geschenk ohne Gegenleistung', async () => {
    const mine = giveCreature(ash.id)
    const offer = await h.post('/api/trades/offer', {
      toTrainerId: misty.id, offeredId: mine, requestedId: null, message: 'Geschenk',
    }, ash.token)
    await h.post('/api/trades/respond', { tradeId: offer.body.outgoing[0].id, accept: true }, misty.token)
    const owner = h.ctx.db.prepare('SELECT owner_id FROM creatures WHERE id = ?').get(mine) as any
    expect(owner.owner_id).toBe(misty.id)
  })

  it('aendert bei Ablehnung nichts', async () => {
    const mine = giveCreature(ash.id)
    const offer = await h.post('/api/trades/offer', {
      toTrainerId: misty.id, offeredId: mine, requestedId: null, message: '',
    }, ash.token)
    const r = await h.post('/api/trades/respond', { tradeId: offer.body.outgoing[0].id, accept: false }, misty.token)
    expect(r.body.accepted).toBe(false)
    const owner = h.ctx.db.prepare('SELECT owner_id FROM creatures WHERE id = ?').get(mine) as any
    expect(owner.owner_id).toBe(ash.id)
  })

  it('weist ein Angebot ab, dessen Pokemon inzwischen im Team steht', async () => {
    const mine = giveCreature(ash.id)
    const offer = await h.post('/api/trades/offer', {
      toTrainerId: misty.id, offeredId: mine, requestedId: null, message: '',
    }, ash.token)
    const garden = await h.get('/api/garden', ash.token)
    await h.post('/api/team', { creatureIds: [garden.body.team[0].id, mine] }, ash.token)
    const r = await h.post('/api/trades/respond', { tradeId: offer.body.outgoing[0].id, accept: true }, misty.token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('offer_stale')
  })

  it('laesst nur den Empfaenger antworten', async () => {
    const mine = giveCreature(ash.id)
    const offer = await h.post('/api/trades/offer', {
      toTrainerId: misty.id, offeredId: mine, requestedId: null, message: '',
    }, ash.token)
    const r = await h.post('/api/trades/respond', { tradeId: offer.body.outgoing[0].id, accept: true }, ash.token)
    expect(r.status).toBe(403)
  })

  it('sperrt ein Pokemon mit offenem Angebot fuer den Markt', async () => {
    const mine = giveCreature(ash.id)
    await h.post('/api/trades/offer', { toTrainerId: misty.id, offeredId: mine, requestedId: null, message: '' }, ash.token)
    const r = await h.post('/api/market/list', { creatureId: mine, price: 500 }, ash.token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('in_trade')
  })
})

describe('Rangliste', () => {
  it('sortiert nach Punkten und markiert einen selbst', async () => {
    h.ctx.db.prepare('INSERT INTO trainer_badges (trainer_id, badge_id, earned_at) VALUES (?, ?, ?)')
      .run(misty.id, 'test-badge', Date.now())
    // Punkte werden beim Aufruf frisch berechnet.
    await h.get('/api/leaderboard', misty.token)
    const r = await h.get('/api/leaderboard', ash.token)
    expect(r.status).toBe(200)
    expect(r.body.rows.length).toBeGreaterThanOrEqual(2)
    expect(r.body.rows[0].score).toBeGreaterThanOrEqual(r.body.rows[1].score)
    expect(r.body.rows.some((x: any) => x.isSelf)).toBe(true)
  })

  it('blendet verborgene Trainer aus', async () => {
    await h.get('/api/leaderboard', misty.token)
    await h.post('/api/privacy', { hideFromLeaderboard: true }, misty.token)
    const r = await h.get('/api/leaderboard', ash.token)
    expect(r.body.rows.some((x: any) => x.trainerId === misty.id)).toBe(false)
  })

  it('meldet keinen eigenen Rang, wenn man sich verbirgt', async () => {
    await h.post('/api/privacy', { hideFromLeaderboard: true }, ash.token)
    const r = await h.get('/api/leaderboard', ash.token)
    expect(r.body.hidden).toBe(true)
    expect(r.body.ownRank).toBeNull()
  })
})
