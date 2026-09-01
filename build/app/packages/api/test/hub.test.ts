import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHub, memoryStore, sign } from '@game/hub'
import {
  assertGetHasNoBody, cachedLeaderboard, linkNew, linkedId, pending, pushMarket,
  pushProfiles, refreshLeaderboard, refreshMarket,
} from '../src/services/hub.js'
import { buyRemote, settle } from '../src/services/hubMarket.js'
import * as acquisitions from '../src/repos/acquisitions.js'
import { makeTestApp, signInitData, type TestApp } from './helpers.js'

/**
 * Instanz und Verbund gegeneinander.
 *
 * Der Wert dieses Tests liegt nicht darin, dass beide Seiten für sich
 * funktionieren — das prüfen ihre eigenen Tests. Er liegt darin, dass sie
 * dieselbe Sprache sprechen: derselbe Signatur-Rumpf, dieselben Kopfzeilen,
 * dieselben Feldnamen. Genau da gehen verteilte Systeme kaputt, und genau das
 * merkt man sonst erst im Betrieb.
 *
 * Statt eines echten Netzes wird `fetch` in den Dienst umgeleitet.
 */
let h: TestApp
let ash: { token: string; id: string }
let hub: ReturnType<typeof createHub>
let refused = false

const HUB = {
  HUB_URL: 'https://verbund.example/',
  HUB_INSTANCE_ID: 'heim',
  HUB_SECRET: '',
}

beforeEach(async () => {
  refused = false
  const store = memoryStore()
  hub = createHub({ store, idSalt: 'salz', adminSecret: 'admin' })
  const reg = await hub({ method: 'POST', path: '/instances', body: { id: 'heim' }, adminSecret: 'admin' })
  HUB.HUB_SECRET = (reg.body as { secret: string }).secret

  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (refused) throw new Error('ECONNREFUSED')
    /*
     * Dieselbe Regel wie im echten `fetch`.
     *
     * Sie stand hier zuerst nicht — und deshalb ging ein GET mit Rumpf durch,
     * das im Betrieb jedes Mal geworfen haette. Ein Doppel, das mehr erlaubt
     * als das Echte, prueft die falsche Welt.
     */
    if (init.method === 'GET' && init.body != null) {
      throw new TypeError('Request with GET/HEAD method cannot have body.')
    }
    const res = await hub({
      method: init.method as string,
      path: new URL(url).pathname,
      body: JSON.parse((init.body as string) || '{}'),
      auth: {
        instanceId: (init.headers as Record<string, string>)['x-hub-instance']!,
        timestamp: Number((init.headers as Record<string, string>)['x-hub-timestamp']),
        signature: (init.headers as Record<string, string>)['x-hub-signature']!,
      },
    })
    return { ok: res.status < 400, status: res.status, json: async () => res.body } as Response
  })

  h = await makeTestApp(HUB)
  const r = await h.post('/api/auth/session', { initData: signInitData({ id: 11, first_name: 'Ash' }) })
  ash = { token: r.body.token, id: r.body.trainer.id }
})
afterEach(async () => { vi.unstubAllGlobals(); await h.close() })

const setStats = (trainerId: string, stats: Record<string, number>) => {
  const cols = Object.keys(stats)
  h.ctx.db.prepare(
    `INSERT INTO leaderboard_stats (trainer_id, ${cols.join(', ')}, updated_at)
     VALUES (?, ${cols.map(() => '?').join(', ')}, ?)
     ON CONFLICT(trainer_id) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(', ')}`,
  ).run(trainerId, ...cols.map((c) => stats[c]), Date.now())
}

describe('Treuhand: kaufen und verkaufen ueber Instanzgrenzen', () => {
  /**
   * Der Wert dieses Tests liegt in den zwei Seiten.
   *
   * Der Verbund fuer sich ist geprueft, die Instanz fuer sich auch. Hier
   * laufen beide gegeneinander — durch dieselbe Signatur, dieselben Namen,
   * denselben Weg. Ein echter zweiter Server fehlt weiterhin; was ihn
   * ersetzt, ist eine zweite angemeldete Instanz, die ihre Aufrufe selbst
   * signiert.
   */
  let fremdSecret: string
  const alsFremd = async (method: string, path: string, body: unknown = {}) => {
    const raw = JSON.stringify(body)
    const ts = Date.now()
    return hub({
      method, path, body,
      auth: { instanceId: 'fremd', timestamp: ts, signature: await sign(fremdSecret, method, path, ts, raw) },
    })
  }

  const gold = () => (h.ctx.db.prepare('SELECT gold AS g FROM trainers WHERE id = ?')
    .get(ash.id) as { g: number }).g
  const boxCount = () => (h.ctx.db.prepare('SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ?')
    .get(ash.id) as { n: number }).n

  const fremdesAngebot = async (id = 'fremd-1', price = 500) => {
    await alsFremd('PUT', '/market', { listings: [{
      id, trainerId: 'g-fremd', sellerName: 'Misty', price, note: '',
      speciesName: 'Testmon', level: 12, shiny: false, ivPercent: 60,
      sprite: '/media/x.png', createdAt: Date.now(),
    }] })
    await refreshMarket(h.ctx)
    return id
  }

  beforeEach(async () => {
    const r = await hub({ method: 'POST', path: '/instances', body: { id: 'fremd' }, adminSecret: 'admin' })
    fremdSecret = (r.body as { secret: string }).secret
    await h.post('/api/starter', { speciesId: 'testmon' }, ash.token)
    h.ctx.db.prepare('UPDATE trainers SET gold = 5000 WHERE id = ?').run(ash.id)
    await linkNew(h.ctx)
  })

  it('nimmt das Gold sofort und liefert das Pokemon nach', async () => {
    const id = await fremdesAngebot()
    const vorher = gold()

    const bestellt = await buyRemote(h.ctx, h.ctx.db.prepare('SELECT * FROM trainers WHERE id = ?')
      .get(ash.id) as never, id)
    expect(gold()).toBe(vorher - 500)

    // Die Gegenseite gibt das Pokemon heraus.
    const geliefert = await alsFremd('POST', '/market/deliver', {
      orderId: bestellt.orderId,
      creature: JSON.stringify({
        speciesId: 'testmon', level: 12, xp: 100, nature: 'hardy',
        ivs: { hp: 5, atk: 5, def: 5, spa: 5, spd: 5, spe: 5 },
        friendship: 70, shiny: false, moves: ['tackle'], nickname: null,
      }),
    })
    expect(geliefert.status).toBe(200)

    const vorherBox = boxCount()
    expect(await settle(h.ctx)).toBeGreaterThan(0)
    expect(boxCount()).toBe(vorherBox + 1)
    // Und es ist belegt — mit eigener Quelle, wie jede andere Zuwendung.
    expect(acquisitions.find(h.ctx.db, { source: 'hub.market.buy' })).toHaveLength(1)
  })

  it('gibt das Gold zurueck, wenn die Gegenseite nicht liefern kann', async () => {
    const id = await fremdesAngebot('fremd-2', 700)
    const vorher = gold()
    const bestellt = await buyRemote(h.ctx, h.ctx.db.prepare('SELECT * FROM trainers WHERE id = ?')
      .get(ash.id) as never, id)
    expect(gold()).toBe(vorher - 700)

    await alsFremd('POST', '/market/abort', { orderId: bestellt.orderId, reason: 'pokemon_weg' })
    await settle(h.ctx)

    expect(gold()).toBe(vorher)
    expect(boxCount()).toBe(1)
  })

  it('erstattet, wenn der Verbund die Bestellung gar nicht annimmt', async () => {
    // Kein Angebot mit dieser Kennung im Verbund — der Aufruf schlaegt fehl,
    // und das Gold darf nicht dabei bleiben.
    await fremdesAngebot('fremd-3', 300)
    h.ctx.db.prepare("UPDATE hub_cache SET payload = ? WHERE key = 'market'").run(JSON.stringify([
      { id: 'gibt-es-nicht', trainerId: 'g-fremd', price: 300 },
    ]))
    const vorher = gold()
    await expect(buyRemote(h.ctx, h.ctx.db.prepare('SELECT * FROM trainers WHERE id = ?')
      .get(ash.id) as never, 'gibt-es-nicht')).rejects.toThrow()
    expect(gold()).toBe(vorher)
  })

  it('liefert als Verkaeuferin aus und zahlt den Verkaeufer aus', async () => {
    // Ein eigenes Angebot, das die fremde Instanz kauft.
    const garden = await h.get('/api/garden', ash.token)
    const creatureId = garden.body.team[0].id as string
    // Angeboten wird aus der Box, nicht aus dem Team.
    h.ctx.db.prepare('UPDATE creatures SET team_slot = NULL WHERE id = ?').run(creatureId)
    const liste = await h.post('/api/market/list', { creatureId, price: 1000 }, ash.token)
    expect(liste.status).toBe(200)
    const listingId = liste.body.ownListings[0].id as string
    await pushMarket(h.ctx)

    const gekauft = await alsFremd('POST', '/market/buy', { listingId, buyerTrainerId: 'g-fremdkaeufer' })
    expect(gekauft.status).toBe(200)

    const vorher = gold()
    expect(await settle(h.ctx)).toBeGreaterThan(0)

    // Das Pokemon ist hier weg, das Gold da — abzueglich der Gebuehr.
    expect(h.ctx.db.prepare('SELECT id FROM creatures WHERE id = ?').get(creatureId)).toBeUndefined()
    expect(gold()).toBeGreaterThan(vorher)

    // Und der Verbund verwahrt es fuer den Kaeufer.
    const beiFremd = await alsFremd('GET', '/market/orders')
    const o = (beiFremd.body as { orders: Array<{ status: string; creature: string | null }> }).orders[0]!
    expect(o.status).toBe('delivered')
    expect(o.creature).toContain('testmon')
  })
})

describe('Verbund von der Instanz aus', () => {
  it('meldet Trainer an und behaelt die Id', async () => {
    expect(await linkNew(h.ctx)).toBe(1)
    const id = linkedId(h.ctx, ash.id)
    expect(id).toMatch(/^[0-9a-f]{32}$/)
    // Ein zweiter Lauf meldet niemanden erneut an.
    expect(await linkNew(h.ctx)).toBe(0)
    expect(linkedId(h.ctx, ash.id)).toBe(id)
  })

  it('schiebt ein Profil hoch und danach nur noch bei Aenderung', async () => {
    await linkNew(h.ctx)
    setStats(ash.id, { badges: 3, dex_caught: 40, battles_won: 12, highest_level: 33, score: 3400 })
    expect(await pushProfiles(h.ctx)).toBe(1)
    // Nichts hat sich geaendert — also geht auch nichts hinaus.
    expect(pending(h.ctx)).toHaveLength(0)
    expect(await pushProfiles(h.ctx)).toBe(0)

    setStats(ash.id, { score: 3500, badges: 4 })
    expect(pending(h.ctx)).toHaveLength(1)
    expect(await pushProfiles(h.ctx)).toBe(1)
  })

  it('haelt Ausgeblendete aus der globalen Liste heraus', async () => {
    await linkNew(h.ctx)
    setStats(ash.id, { badges: 3, dex_caught: 40, battles_won: 12, score: 3400 })
    h.ctx.db.prepare('UPDATE trainers SET hide_leaderboard = 1 WHERE id = ?').run(ash.id)
    expect(pending(h.ctx)).toHaveLength(0)
    expect(await pushProfiles(h.ctx)).toBe(0)
  })

  it('holt die Rangliste und liest sie danach ohne Netz', async () => {
    await linkNew(h.ctx)
    setStats(ash.id, { badges: 5, dex_caught: 80, battles_won: 30, highest_level: 44, score: 5800 })
    await pushProfiles(h.ctx)
    expect(await refreshLeaderboard(h.ctx)).toBe(1)

    const rows = cachedLeaderboard(h.ctx)!
    expect(rows[0]!.displayName).toBe('Ash')
    expect(rows[0]!.instanceId).toBe('heim')
    expect(rows[0]!.badges).toBe(5)
    expect(rows[0]!.trainerId).toBe(linkedId(h.ctx, ash.id))
  })

  it('laesst den alten Stand stehen, wenn der Verbund schweigt', async () => {
    await linkNew(h.ctx)
    setStats(ash.id, { badges: 5, score: 5000 })
    await pushProfiles(h.ctx)
    await refreshLeaderboard(h.ctx)

    refused = true
    expect(await refreshLeaderboard(h.ctx)).toBe(0)
    // Der Blick auf die Rangliste zeigt weiter, was zuletzt ankam.
    expect(cachedLeaderboard(h.ctx)).toHaveLength(1)
    // Und keine dieser Funktionen wirft — das ist die eigentliche Zusage.
    expect(await linkNew(h.ctx)).toBe(0)
    expect(await pushProfiles(h.ctx)).toBe(0)
  })
})

describe('ohne Verbund', () => {
  it('tut nichts und meldet nichts', async () => {
    await h.close()
    h = await makeTestApp()
    expect(h.ctx.config.hubEnabled).toBe(false)
    expect(await linkNew(h.ctx)).toBe(0)
    expect(await pushProfiles(h.ctx)).toBe(0)
    expect(await refreshLeaderboard(h.ctx)).toBe(0)
    expect(cachedLeaderboard(h.ctx)).toBeNull()
  })
})


describe('Signatur und Rumpf', () => {
  it('verweigert ein GET mit Parametern', () => {
    expect(() => assertGetHasNoBody('GET', '/chat', '{"since":5}')).toThrow(/POST/)
  })

  it('laesst ein leeres GET und jeden POST durch', () => {
    expect(() => assertGetHasNoBody('GET', '/leaderboard', '{}')).not.toThrow()
    expect(() => assertGetHasNoBody('POST', '/chat/read', '{"since":5}')).not.toThrow()
  })
})
