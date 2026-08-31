import { beforeEach, describe, expect, it } from 'vitest'
import { createHub, type HubRequest } from './service.js'
import { memoryStore } from './memory.js'
import { sign, SIGNATURE_MAX_AGE_MS } from './auth.js'
import type { Store } from './store.js'

/**
 * Der Verbund-Dienst, vollstaendig ohne Netz geprueft.
 *
 * Das geht, weil die Logik keine Datenbank kennt, sondern nur eine
 * Schnittstelle — dieselbe Trennung, die die Engine vom Spiel hat.
 */
let store: Store
let hub: ReturnType<typeof createHub>
let secret: string

const ADMIN = 'admin-geheim'
const NOW = 1_800_000_000_000

const call = async (req: Omit<HubRequest, 'auth'> & { signed?: boolean }) => {
  const { signed = true, ...rest } = req
  if (!signed) return hub(rest)
  const body = JSON.stringify(rest.body ?? {})
  return hub({
    ...rest,
    auth: {
      instanceId: 'heim',
      timestamp: NOW,
      signature: await sign(secret, rest.method, rest.path, NOW, body),
    },
  })
}

beforeEach(async () => {
  store = memoryStore()
  hub = createHub({ store, idSalt: 'salz', adminSecret: ADMIN, now: () => NOW })
  const r = await hub({ method: 'POST', path: '/instances', body: { id: 'heim', name: 'Zuhause' }, adminSecret: ADMIN })
  secret = (r.body as { secret: string }).secret
})

describe('Anmeldung einer Instanz', () => {
  it('gibt das Geheimnis genau einmal heraus', async () => {
    const again = await hub({ method: 'POST', path: '/instances', body: { id: 'heim' }, adminSecret: ADMIN })
    expect(again.status).toBe(409)
  })

  it('braucht das Admin-Geheimnis', async () => {
    const r = await hub({ method: 'POST', path: '/instances', body: { id: 'fremd' }, adminSecret: 'falsch' })
    expect(r.status).toBe(401)
  })

  it('faengt neue Instanzen auf der Lesestufe ab', async () => {
    expect((await store.getInstance('heim'))!.trust).toBe('read')
  })
})

describe('Signatur', () => {
  it('weist eine unsignierte Anfrage ab', async () => {
    const r = await call({ method: 'POST', path: '/trainers', body: { telegramId: '1' }, signed: false })
    expect(r.status).toBe(401)
  })

  it('weist eine gefaelschte Signatur ab', async () => {
    const r = await hub({
      method: 'POST', path: '/trainers', body: { telegramId: '1' },
      auth: { instanceId: 'heim', timestamp: NOW, signature: 'ff'.repeat(32) },
    })
    expect(r.status).toBe(401)
    expect((r.body as any).detail.reason).toBe('bad_signature')
  })

  it('weist eine alte Anfrage ab, damit sie sich nicht wiederholen laesst', async () => {
    const old = NOW - SIGNATURE_MAX_AGE_MS - 1000
    const body = JSON.stringify({ telegramId: '1' })
    const r = await hub({
      method: 'POST', path: '/trainers', body: { telegramId: '1' },
      auth: { instanceId: 'heim', timestamp: old, signature: await sign(secret, 'POST', '/trainers', old, body) },
    })
    expect(r.status).toBe(401)
    expect((r.body as any).detail.reason).toBe('stale')
  })

  it('schuetzt auch den Rumpf', async () => {
    // Signatur ueber den einen Rumpf, geschickt mit einem anderen.
    const sig = await sign(secret, 'POST', '/trainers', NOW, JSON.stringify({ telegramId: '1' }))
    const r = await hub({
      method: 'POST', path: '/trainers', body: { telegramId: '999' },
      auth: { instanceId: 'heim', timestamp: NOW, signature: sig },
    })
    expect(r.status).toBe(401)
  })
})

describe('Trainer', () => {
  it('gibt fuer dieselbe Telegram-Id immer dieselbe globale Id', async () => {
    const a = await call({ method: 'POST', path: '/trainers', body: { telegramId: '4242', displayName: 'Patte' } })
    const b = await call({ method: 'POST', path: '/trainers', body: { telegramId: '4242', displayName: 'Patte' } })
    expect(a.status).toBe(200)
    expect((a.body as any).id).toBe((b.body as any).id)
  })

  it('behaelt den Namen, wenn eine Anfrage keinen mitbringt', async () => {
    const first = await call({ method: 'POST', path: '/trainers', body: { telegramId: '7', displayName: 'Patte' } })
    await call({ method: 'POST', path: '/trainers', body: { telegramId: '7' } })
    expect((await store.getTrainer((first.body as any).id))!.displayName).toBe('Patte')
  })

  it('laesst die rohe Telegram-Id nicht durchscheinen', async () => {
    const r = await call({ method: 'POST', path: '/trainers', body: { telegramId: '4242' } })
    expect((r.body as any).id).not.toContain('4242')
  })

  it('deckelt, wie viele eine Instanz anlegen darf', async () => {
    for (let i = 0; i < 500; i++) {
      await call({ method: 'POST', path: '/trainers', body: { telegramId: `t${i}` } })
    }
    const over = await call({ method: 'POST', path: '/trainers', body: { telegramId: 'zuviel' } })
    expect(over.status).toBe(429)
    // Ein schon bekannter geht weiter durch — die Grenze trifft nur Neue.
    const known = await call({ method: 'POST', path: '/trainers', body: { telegramId: 't1' } })
    expect(known.status).toBe(200)
  })
})

describe('Profile und Rangliste', () => {
  const put = async (telegramId: string, name: string, p: Record<string, number>) => {
    const r = await call({ method: 'POST', path: '/trainers', body: { telegramId, displayName: name } })
    const id = (r.body as any).id as string
    await call({ method: 'PUT', path: '/profiles', body: { trainerId: id, ...p } })
    return id
  }

  it('sortiert ueber alle Instanzen', async () => {
    await put('1', 'Wenig', { badges: 1, dexCaught: 10, battlesWon: 5 })
    await put('2', 'Viel', { badges: 8, dexCaught: 90, battlesWon: 300 })
    const r = await call({ method: 'GET', path: '/leaderboard' })
    const rows = (r.body as any).rows
    expect(rows[0].displayName).toBe('Viel')
    expect(rows[0].instanceId).toBe('heim')
  })

  it('weist Werte ab, die es im Spiel nicht geben kann', async () => {
    const id = await put('3', 'Schummler', { badges: 9999, dexCaught: -5, level: 100000 })
    const r = await call({ method: 'GET', path: '/leaderboard' })
    const row = (r.body as any).rows.find((x: any) => x.trainerId === id)
    expect(row.badges).toBe(26)
    expect(row.dexCaught).toBe(0)
    expect(row.level).toBe(500)
  })

  it('laesst keine fremden Profile schreiben', async () => {
    const r = await hub({ method: 'POST', path: '/instances', body: { id: 'fremd' }, adminSecret: ADMIN })
    const otherSecret = (r.body as any).secret as string
    const mine = await call({ method: 'POST', path: '/trainers', body: { telegramId: '77', displayName: 'Ich' } })
    const id = (mine.body as any).id

    const body = JSON.stringify({ trainerId: id, badges: 26 })
    const evil = await hub({
      method: 'PUT', path: '/profiles', body: { trainerId: id, badges: 26 },
      auth: {
        instanceId: 'fremd', timestamp: NOW,
        signature: await sign(otherSecret, 'PUT', '/profiles', NOW, body),
      },
    })
    expect(evil.status).toBe(403)
  })
})

describe('Aktueller Stand', () => {
  it('meldet ohne gesetzten Stand einfach nichts', async () => {
    const r = await call({ method: 'GET', path: '/release' })
    expect(r.status).toBe(200)
    expect((r.body as any).release).toBeNull()
  })

  it('setzt und liefert ihn aus', async () => {
    const set = await hub({
      method: 'PUT', path: '/release', body: { sha: 'a1b2c3d', notes: 'Kampfzone' }, adminSecret: ADMIN,
    })
    expect(set.status).toBe(200)
    const r = await call({ method: 'GET', path: '/release' })
    expect((r.body as any).release).toMatchObject({ sha: 'a1b2c3d', notes: 'Kampfzone' })
  })

  it('laesst nur den Admin setzen', async () => {
    /*
     * Der Stand steuert, was auf *fremden* Maschinen als veraltet gilt. Duerfte
     * ihn jede angemeldete Instanz setzen, koennte eine davon allen anderen
     * einen beliebigen Commit als "aktuell" unterschieben.
     */
    const r = await call({ method: 'PUT', path: '/release', body: { sha: 'deadbee' } })
    expect(r.status).toBe(401)
  })

  it('nimmt nur etwas an, das wie ein Git-Hash aussieht', async () => {
    for (const sha of ['', 'nope', '../../etc', 'a1b2c3']) {
      const r = await hub({ method: 'PUT', path: '/release', body: { sha }, adminSecret: ADMIN })
      expect(r.status).toBe(400)
    }
  })
})
