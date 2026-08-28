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

const starter = async () => (await h.get('/api/garden', token)).body.team[0]
/** Abklingzeit zurueckdrehen, statt 10 Minuten zu warten. */
const resetCooldown = () =>
  h.ctx.db.prepare('UPDATE trainers SET center_used_at = 0 WHERE id = ?').run(trainerId)
const hurt = (id: string, hp: number) =>
  h.ctx.db.prepare('UPDATE creatures SET hp_current = ? WHERE id = ?').run(hp, id)

function addToBox(species: string, nickname: string): string {
  const id = crypto.randomUUID()
  h.ctx.db.prepare(
    `INSERT INTO creatures (id, owner_id, species_id, nickname, xp, level, nature,
       iv_hp, iv_atk, iv_def, iv_spa, iv_spd, iv_spe,
       friendship, energy, hp_current, shiny, moves, caught_at, team_slot)
     VALUES (?, ?, ?, ?, 125, 5, 'hardy', 20,20,20,20,20,20, 70, 100, 20, 0, '["tackle"]', ?, NULL)`,
  ).run(id, trainerId, species, nickname, Date.now())
  return id
}

/** Ein Tauschangebot direkt anlegen: das Ereignis selbst tritt mit 1,5 %
 *  Wahrscheinlichkeit auf und liesse sich sonst nur zufaellig testen. */
function makeOffer(wanted: string, offered: string, level = 6, ttlMs = 3_600_000): string {
  const id = crypto.randomUUID()
  h.ctx.db.prepare(
    `INSERT INTO center_offers (id, trainer_id, npc_name, wanted_species_id, offered_species_id,
       offered_level, offered_shiny, seed, created_at, expires_at)
     VALUES (?, ?, 'Angler Bruno', ?, ?, ?, 0, 'test-seed', ?, ?)`,
  ).run(id, trainerId, wanted, offered, level, Date.now(), Date.now() + ttlMs)
  return id
}

describe('Poké-Center', () => {
  it('ist beim ersten Aufruf sofort bereit', async () => {
    const r = await h.get('/api/center', token)
    expect(r.status).toBe(200)
    expect(r.body.ready).toBe(true)
    expect(r.body.cooldownMs).toBe(10 * 60_000)
    expect(r.body.teamSize).toBe(1)
    expect(r.body.offer).toBeNull()
  })

  it('heilt das ganze Team und meldet, wie viele es noetig hatten', async () => {
    const c = await starter()
    hurt(c.id, 1)
    const before = (await h.get('/api/center', token)).body
    expect(before.hurt).toBe(1)

    const r = await h.post('/api/center/visit', {}, token)
    expect(r.status).toBe(200)
    expect(r.body.healed).toBe(1)

    const after = await starter()
    expect(after.hpCurrent).toBe(after.hpMax)
    expect(r.body.state.hurt).toBe(0)
  })

  it('kostet keine Energie', async () => {
    const before = (await h.get('/api/energy', token)).body.state.current
    await h.post('/api/center/visit', {}, token)
    expect((await h.get('/api/energy', token)).body.state.current).toBe(before)
  })

  it('sperrt fuer 10 Minuten und nennt den Zeitpunkt der Freigabe', async () => {
    const first = await h.post('/api/center/visit', {}, token)
    expect(first.status).toBe(200)
    expect(first.body.state.ready).toBe(false)

    h.resetRateLimits()
    const second = await h.post('/api/center/visit', {}, token)
    expect(second.status).toBe(409)
    expect(second.body.detail.reason).toBe('center_cooldown')
    expect(second.body.detail.readyAt).toBeGreaterThan(Date.now())

    // Kurz vor Ablauf immer noch gesperrt, danach frei.
    h.ctx.db.prepare('UPDATE trainers SET center_used_at = ? WHERE id = ?')
      .run(Date.now() - 10 * 60_000 + 5_000, trainerId)
    h.resetRateLimits()
    expect((await h.post('/api/center/visit', {}, token)).status).toBe(409)

    resetCooldown()
    h.resetRateLimits()
    expect((await h.post('/api/center/visit', {}, token)).status).toBe(200)
  })

  it('heilt nicht mitten im Kampf', async () => {
    const c = await starter()
    h.ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run('test-route', trainerId)
    h.ctx.db.prepare('UPDATE creatures SET level = 60, hp_current = 9999 WHERE id = ?').run(c.id)
    expect((await h.post('/api/battle/start', { opponentId: 'test-rival' }, token)).status).toBe(200)

    h.resetRateLimits()
    const r = await h.post('/api/center/visit', {}, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('battle_in_progress')
  })

  it('liefert ein wohlgeformtes Ereignis und bucht Funde sofort ein', async () => {
    // Feste Rundenzahl statt Abbruch, sobald alle Arten gesehen wurden: der
    // Seed haengt an der Uhr, und ein Abbruch nach "drei von vier" haette den
    // Test vom Zufall abhaengig gemacht.
    const seen = new Set<string>()
    let events = 0

    for (let i = 0; i < 250; i++) {
      resetCooldown()
      h.resetRateLimits()
      const goldBefore = (await h.get('/api/bag', token)).body.gold
      const r = await h.post('/api/center/visit', {}, token)
      expect(r.status).toBe(200)
      const event = r.body.event
      seen.add(event.kind)
      if (event.kind !== 'none') events++

      if (event.kind === 'gold') {
        expect(event.gold).toBeGreaterThan(0)
        expect((await h.get('/api/bag', token)).body.gold).toBe(goldBefore + event.gold)
      }
      if (event.kind === 'gift') {
        expect(event.item.quantity).toBeGreaterThanOrEqual(1)
        expect(event.item.quantity).toBeLessThanOrEqual(15)
        const bag = (await h.get('/api/bag', token)).body.items
        expect(bag.some((i: any) => i.id === event.item.itemId)).toBe(true)
      }
      if (event.kind === 'trade') {
        expect(event.offer.offered.speciesId).not.toBe('')
        expect(event.offer.npcName.length).toBeGreaterThan(0)
      }
    }

    // Der weit ueberwiegende Teil der Besuche bleibt ereignislos ...
    expect(seen.has('none')).toBe(true)
    // ... aber bei 250 Besuchen und rund 11 % Ereignisquote ist "gar nichts"
    // praktisch ausgeschlossen.
    expect(events).toBeGreaterThan(0)
    expect(events).toBeLessThan(250 * 0.35)
  })

  it('nimmt ein Tauschangebot an und tauscht die Kreatur wirklich aus', async () => {
    const keeper = addToBox('testmon', 'Reserve')
    const give = await starter()
    const offerId = makeOffer('testmon', 'wildmon', 7)

    const r = await h.post('/api/center/trade/accept', { offerId, creatureId: give.id }, token)
    expect(r.status).toBe(200)
    expect(r.body.received.speciesId).toBe('wildmon')
    expect(r.body.received.level).toBe(7)
    expect(r.body.newDexEntry).toBe(true)

    // Das hergegebene Pokemon ist weg, das neue steht an seinem Platz.
    expect(h.ctx.db.prepare('SELECT 1 FROM creatures WHERE id = ?').get(give.id)).toBeUndefined()
    const team = (await h.get('/api/garden', token)).body.team
    expect(team.map((c: any) => c.speciesId)).toContain('wildmon')
    expect(keeper).toBeTruthy()
  })

  it('gibt getauschten Pokemon spuerbar bessere Anlagen', async () => {
    addToBox('testmon', 'Reserve')
    const give = await starter()
    const offerId = makeOffer('testmon', 'wildmon')
    const r = await h.post('/api/center/trade/accept', { offerId, creatureId: give.id }, token)
    for (const value of Object.values(r.body.received.ivs as Record<string, number>)) {
      expect(value).toBeGreaterThanOrEqual(18)
    }
  })

  it('weist eine Kreatur der falschen Art ab', async () => {
    const wrong = addToBox('nachtmon', 'Falsch')
    addToBox('testmon', 'Reserve')
    const offerId = makeOffer('testmon', 'wildmon')
    const r = await h.post('/api/center/trade/accept', { offerId, creatureId: wrong }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('wrong_species')
  })

  it('laesst das letzte Pokemon nicht hergeben', async () => {
    const only = await starter()
    const offerId = makeOffer('testmon', 'wildmon')
    const r = await h.post('/api/center/trade/accept', { offerId, creatureId: only.id }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('last_creature')
  })

  it('nimmt ein Angebot nur einmal an', async () => {
    addToBox('testmon', 'Reserve')
    const give = await starter()
    const offerId = makeOffer('testmon', 'wildmon')
    expect((await h.post('/api/center/trade/accept', { offerId, creatureId: give.id }, token)).status).toBe(200)

    h.resetRateLimits()
    const again = addToBox('testmon', 'Nochmal')
    const second = await h.post('/api/center/trade/accept', { offerId, creatureId: again }, token)
    expect(second.status).toBe(409)
    expect(second.body.detail.reason).toBe('already_resolved')
  })

  it('weist ein abgelaufenes Angebot ab', async () => {
    addToBox('testmon', 'Reserve')
    const give = await starter()
    const offerId = makeOffer('testmon', 'wildmon', 6, -1000)
    const r = await h.post('/api/center/trade/accept', { offerId, creatureId: give.id }, token)
    expect(r.status).toBe(409)
    expect(r.body.detail.reason).toBe('expired')
  })

  it('weist ein fremdes Angebot ab', async () => {
    const other = await h.addTrainer(222, 'Misty')
    await h.post('/api/starter', { speciesId: 'testmon' }, other.token)
    const offerId = makeOffer('testmon', 'wildmon')
    const theirs = (await h.get('/api/garden', other.token)).body.team[0].id
    const r = await h.post('/api/center/trade/accept', { offerId, creatureId: theirs }, other.token)
    expect(r.status).toBe(404)
  })

  it('legt ein abgelehntes Angebot beiseite', async () => {
    const offerId = makeOffer('testmon', 'wildmon')
    expect((await h.get('/api/center', token)).body.offer?.id).toBe(offerId)

    const r = await h.post('/api/center/trade/decline', { offerId }, token)
    expect(r.status).toBe(200)
    expect(r.body.offer).toBeNull()
    expect((await h.get('/api/center', token)).body.offer).toBeNull()
  })

  it('zeigt im Angebot nur eigene Kreaturen der gesuchten Art', async () => {
    addToBox('nachtmon', 'Passt nicht')
    const fits = addToBox('testmon', 'Passt')
    makeOffer('testmon', 'wildmon')

    const offer = (await h.get('/api/center', token)).body.offer
    const ids = offer.candidates.map((c: any) => c.id)
    expect(ids).toContain(fits)
    expect(offer.candidates.every((c: any) => c.displayName)).toBe(true)
    expect(ids.length).toBe(2) // Starter plus Box-Exemplar
  })
})
