import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHub, memoryStore } from '@game/hub'
import { assertGetHasNoBody, cachedLeaderboard, linkNew, linkedId, pending, pushProfiles, refreshLeaderboard }
  from '../src/services/hub.js'
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
