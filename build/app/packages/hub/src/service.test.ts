import { beforeEach, describe, expect, it } from 'vitest'
import { CHAT_MAX_LENGTH, CHAT_PER_INSTANCE_PER_WINDOW, createHub, ORDER_TIMEOUT_MS, type HubRequest } from './service.js'
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

describe('Chat', () => {
  const anlegen = async (telegramId: string, name: string) =>
    (await call({ method: 'POST', path: '/trainers', body: { telegramId, displayName: name } })
      .then((r) => r.body as { id: string })).id

  it('nimmt eine Nachricht an und gibt sie wieder aus', async () => {
    const id = await anlegen('1', 'Patte')
    const gesendet = await call({ method: 'POST', path: '/chat', body: { trainerId: id, text: 'Moin' } })
    expect(gesendet.status).toBe(200)

    const gelesen = await call({ method: 'POST', path: '/chat/read', body: { since: 0 } })
    const [m] = (gelesen.body as any).messages
    expect(m).toMatchObject({ name: 'Patte', body: 'Moin', instanceId: 'heim' })
  })

  it('laesst keine Instanz im Namen fremder Spieler reden', async () => {
    /*
     * Dieselbe Regel wie bei den Profilen, und aus demselben Grund. Ohne sie
     * koennte eine beliebige Instanz im Verbund alles sagen und es jedem in
     * den Mund legen.
     */
    const meiner = await anlegen('1', 'Patte')
    const r = await hub({ method: 'POST', path: '/instances', body: { id: 'fremd' }, adminSecret: ADMIN })
    const otherSecret = (r.body as any).secret as string
    const body = JSON.stringify({ trainerId: meiner, text: 'ich bin Patte' })
    const evil = await hub({
      method: 'POST', path: '/chat', body: { trainerId: meiner, text: 'ich bin Patte' },
      auth: {
        instanceId: 'fremd', timestamp: NOW,
        signature: await sign(otherSecret, 'POST', '/chat', NOW, body),
      },
    })
    expect(evil.status).toBe(403)
  })

  it('kuerzt zu lange Nachrichten, statt sie abzuweisen', async () => {
    const id = await anlegen('1', 'Patte')
    await call({ method: 'POST', path: '/chat', body: { trainerId: id, text: 'a'.repeat(1000) } })
    const gelesen = await call({ method: 'POST', path: '/chat/read', body: { since: 0 } })
    expect((gelesen.body as any).messages[0].body.length).toBe(CHAT_MAX_LENGTH)
  })

  it('weist Leeres und reinen Weissraum ab', async () => {
    const id = await anlegen('1', 'Patte')
    for (const text of ['', '   ', '\n\t ']) {
      expect((await call({ method: 'POST', path: '/chat', body: { trainerId: id, text } })).status).toBe(400)
    }
  })

  it('bremst eine flutende Instanz', async () => {
    const id = await anlegen('1', 'Patte')
    for (let i = 0; i < CHAT_PER_INSTANCE_PER_WINDOW; i++) {
      await call({ method: 'POST', path: '/chat', body: { trainerId: id, text: `n${i}` } })
    }
    const zuviel = await call({ method: 'POST', path: '/chat', body: { trainerId: id, text: 'noch eine' } })
    expect(zuviel.status).toBe(429)
  })

  it('liefert nur, was seit der letzten Nummer dazukam', async () => {
    const id = await anlegen('1', 'Patte')
    await call({ method: 'POST', path: '/chat', body: { trainerId: id, text: 'eins' } })
    const nach1 = (await call({ method: 'POST', path: '/chat/read', body: { since: 0 } })).body as any
    const letzte = nach1.messages[nach1.messages.length - 1].id

    await call({ method: 'POST', path: '/chat', body: { trainerId: id, text: 'zwei' } })
    const neu = (await call({ method: 'POST', path: '/chat/read', body: { since: letzte } })).body as any
    expect(neu.messages).toHaveLength(1)
    expect(neu.messages[0].body).toBe('zwei')
  })
})

describe('Aushang des Verbunds', () => {
  const angebot = (id: string, extra: Record<string, unknown> = {}) => ({
    id, trainerId: 'g-1', sellerName: 'Ash', price: 5000, note: 'guenstig',
    speciesName: 'Bisasam', level: 30, shiny: false, ivPercent: 70,
    sprite: '/media/x.png', createdAt: NOW, ...extra,
  })

  it('nimmt Angebote an und gibt sie wieder heraus', async () => {
    const put = await call({ method: 'PUT', path: '/market', body: { listings: [angebot('a'), angebot('b')] } })
    expect(put.status).toBe(200)
    expect((put.body as { accepted: number }).accepted).toBe(2)

    const get = await call({ method: 'GET', path: '/market' })
    const rows = (get.body as { rows: Array<{ id: string; instanceId: string }> }).rows
    expect(rows.map((r) => r.id).sort()).toEqual(['a', 'b'])
    // Die Herkunft setzt der Dienst, nicht der Absender.
    expect(rows.every((r) => r.instanceId === 'heim')).toBe(true)
  })

  it('ersetzt den ganzen Aushang, statt anzuhaengen', async () => {
    /*
     * Der eigentliche Sinn des Ersetzens: was verkauft oder zurueckgezogen
     * wurde, verschwindet von selbst. Ein Schaufenster, das Verkauftes zeigt,
     * ist aergerlicher als eines, das kurz leer steht.
     */
    await call({ method: 'PUT', path: '/market', body: { listings: [angebot('a'), angebot('b')] } })
    await call({ method: 'PUT', path: '/market', body: { listings: [angebot('b')] } })

    const get = await call({ method: 'GET', path: '/market' })
    expect((get.body as { rows: Array<{ id: string }> }).rows.map((r) => r.id)).toEqual(['b'])
  })

  it('laesst die Herkunft nicht faelschen', async () => {
    // Was eine fremde Instanz schickt, ist eine Behauptung — auch ueber sich
    // selbst. Der Dienst schreibt die Instanz aus der Signatur ein.
    await call({ method: 'PUT', path: '/market', body: { listings: [angebot('a', { instanceId: 'fremd' })] } })
    const get = await call({ method: 'GET', path: '/market' })
    expect((get.body as { rows: Array<{ instanceId: string }> }).rows[0]!.instanceId).toBe('heim')
  })

  it('beschneidet masslose Angaben und wirft Angebote ohne Kennung weg', async () => {
    await call({
      method: 'PUT',
      path: '/market',
      body: {
        listings: [
          angebot('a', { price: 10 ** 12, level: 9999, ivPercent: 500, note: 'x'.repeat(500) }),
          angebot('', {}),
        ],
      },
    })
    const rows = (await call({ method: 'GET', path: '/market' })).body as {
      rows: Array<{ price: number; level: number; ivPercent: number; note: string }>
    }
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0]!.price).toBe(10_000_000)
    expect(rows.rows[0]!.level).toBe(500)
    expect(rows.rows[0]!.ivPercent).toBe(100)
    expect(rows.rows[0]!.note.length).toBe(120)
  })

  it('weist einen Aushang ohne Liste ab', async () => {
    const r = await call({ method: 'PUT', path: '/market', body: { listings: 'alles' } })
    expect(r.status).toBe(400)
  })

  it('laesst niemanden ohne Signatur lesen', async () => {
    const r = await hub({ method: 'GET', path: '/market' })
    expect(r.status).toBe(401)
  })
})

describe('Treuhand: kaufen ueber Instanzgrenzen', () => {
  /**
   * Eine zweite Instanz anmelden und deren Aufrufe signieren.
   *
   * Ein Kauf im Verbund braucht zwei Seiten, und nur mit zweien laesst sich
   * pruefen, was der Dienst eigentlich leistet: dass die eine Seite nicht
   * liefern muss, bevor die andere bezahlt hat, und umgekehrt.
   */
  let fremdSecret: string
  const alsFremd = async (req: Omit<HubRequest, 'auth'>) => {
    const body = JSON.stringify(req.body ?? {})
    return hub({
      ...req,
      auth: {
        instanceId: 'fremd',
        timestamp: NOW,
        signature: await sign(fremdSecret, req.method, req.path, NOW, body),
      },
    })
  }

  const angebot = {
    id: 'angebot-1', trainerId: 'g-verkaeufer', sellerName: 'Ash', price: 5000,
    note: '', speciesName: 'Bisasam', level: 30, shiny: false, ivPercent: 70,
    sprite: '/media/x.png', createdAt: NOW,
  }

  beforeEach(async () => {
    const r = await hub({ method: 'POST', path: '/instances', body: { id: 'fremd', name: 'Woanders' }, adminSecret: ADMIN })
    fremdSecret = (r.body as { secret: string }).secret
    // 'heim' bietet an, 'fremd' kauft.
    await call({ method: 'PUT', path: '/market', body: { listings: [angebot] } })
  })

  const bestellen = async () => {
    const r = await alsFremd({
      method: 'POST', path: '/market/buy',
      body: { listingId: 'angebot-1', buyerTrainerId: 'g-kaeufer' },
    })
    return { status: r.status, order: (r.body as { order?: { id: string } }).order }
  }

  it('fuehrt den ganzen Weg von der Bestellung bis zur Abholung', async () => {
    const { status, order } = await bestellen()
    expect(status).toBe(200)
    expect(order).toMatchObject({ status: 'reserved', price: 5000, sellerInstanceId: 'heim', buyerInstanceId: 'fremd' })

    // Die Verkaeuferseite sieht, dass sie liefern soll.
    const beiHeim = await call({ method: 'GET', path: '/market/orders' })
    const offen = (beiHeim.body as { orders: Array<{ id: string; status: string }> }).orders
    expect(offen).toHaveLength(1)
    expect(offen[0]!.status).toBe('reserved')

    const geliefert = await call({
      method: 'POST', path: '/market/deliver',
      body: { orderId: order!.id, creature: '{"speciesId":"bulbasaur","level":30}' },
    })
    expect(geliefert.status).toBe(200)

    // Erst jetzt kann der Kaeufer abholen — und bekommt genau das Verwahrte.
    const geholt = await alsFremd({ method: 'POST', path: '/market/collect', body: { orderId: order!.id } })
    expect(geholt.status).toBe(200)
    expect((geholt.body as { creature: string }).creature).toContain('bulbasaur')
    expect((await store.getOrder(order!.id))!.status).toBe('collected')
  })

  it('gibt dasselbe Pokemon kein zweites Mal heraus', async () => {
    const { order } = await bestellen()
    await call({ method: 'POST', path: '/market/deliver', body: { orderId: order!.id, creature: '{"x":1}' } })
    await alsFremd({ method: 'POST', path: '/market/collect', body: { orderId: order!.id } })

    const nochmal = await alsFremd({ method: 'POST', path: '/market/collect', body: { orderId: order!.id } })
    expect(nochmal.status).toBe(409)
  })

  it('laesst zu einem Angebot nur eine offene Bestellung zu', async () => {
    // Der Wettlauf zweier Kaeufer. Wer verliert, erfaehrt es sofort — statt
    // sein Gold in einen Vorgang zu legen, den es schon gibt.
    const erste = await bestellen()
    expect(erste.status).toBe(200)
    const zweite = await bestellen()
    expect(zweite.status).toBe(409)
  })

  it('laesst nur die Heimatinstanz liefern', async () => {
    const { order } = await bestellen()
    // Der Kaeufer selbst behauptet, geliefert zu haben.
    const r = await alsFremd({ method: 'POST', path: '/market/deliver', body: { orderId: order!.id, creature: '{"x":1}' } })
    expect(r.status).toBe(403)
  })

  it('laesst nur den Kaeufer abholen', async () => {
    const { order } = await bestellen()
    await call({ method: 'POST', path: '/market/deliver', body: { orderId: order!.id, creature: '{"x":1}' } })
    const r = await call({ method: 'POST', path: '/market/collect', body: { orderId: order!.id } })
    expect(r.status).toBe(403)
  })

  it('laesst nicht abholen, was noch nicht geliefert ist', async () => {
    const { order } = await bestellen()
    const r = await alsFremd({ method: 'POST', path: '/market/collect', body: { orderId: order!.id } })
    expect(r.status).toBe(409)
    expect((await store.getOrder(order!.id))!.status).toBe('reserved')
  })

  it('bricht ab, wenn die Verkaeuferseite nicht liefern kann', async () => {
    const { order } = await bestellen()
    const r = await call({ method: 'POST', path: '/market/abort', body: { orderId: order!.id, reason: 'pokemon_weg' } })
    expect(r.status).toBe(200)

    const o = (await store.getOrder(order!.id))!
    expect(o.status).toBe('aborted')
    expect(o.reason).toBe('pokemon_weg')
    // Nach dem Abbruch ist das Angebot wieder frei.
    expect((await bestellen()).status).toBe(200)
  })

  it('kauft nicht bei sich selbst', async () => {
    const r = await call({ method: 'POST', path: '/market/buy', body: { listingId: 'angebot-1', buyerTrainerId: 'g-1' } })
    expect(r.status).toBe(400)
  })

  it('laesst eine liegengebliebene Bestellung verfallen', async () => {
    /*
     * Bezahlt ist bezahlt. Gold, das unbegrenzt in einem Vorgang liegt, den
     * niemand mehr anfasst, waere verloren — eine Instanz, die zwei Stunden
     * nicht geliefert hat, ist entweder aus oder kaputt.
     */
    const { order } = await bestellen()
    const spaeter = createHub({ store, idSalt: 'salz', adminSecret: ADMIN, now: () => NOW + ORDER_TIMEOUT_MS + 1 })
    await spaeter({
      method: 'GET', path: '/market/orders', body: {},
      auth: {
        instanceId: 'heim', timestamp: NOW + ORDER_TIMEOUT_MS + 1,
        signature: await sign(secret, 'GET', '/market/orders', NOW + ORDER_TIMEOUT_MS + 1, '{}'),
      },
    })
    const o = (await store.getOrder(order!.id))!
    expect(o.status).toBe('aborted')
    expect(o.reason).toBe('zeit_abgelaufen')
  })
})

describe('Freunde über Instanzen', () => {
  const anlegen = async (telegramId: string, name: string, code: string) =>
    (await call({
      method: 'POST', path: '/trainers', body: { telegramId, displayName: name, code },
    }).then((r) => r.body as { id: string })).id

  it('findet jemanden über seinen Trainer-Code', async () => {
    await anlegen('1', 'Patte', 'AAAA-1111')
    const r = await call({ method: 'POST', path: '/trainers/find', body: { code: 'aaaa-1111' } })
    expect((r.body as any).trainer).toMatchObject({ displayName: 'Patte', instanceId: 'heim' })
  })

  it('meldet einen unbekannten Code als leer, nicht als Fehler', async () => {
    const r = await call({ method: 'POST', path: '/trainers/find', body: { code: 'ZZZZ-9999' } })
    expect(r.status).toBe(200)
    expect((r.body as any).trainer).toBeNull()
  })

  it('macht aus zwei Anfragen sofort eine Freundschaft', async () => {
    /*
     * Ohne das müssten zwei Leute, die gleichzeitig auf denselben Knopf
     * drücken, ewig aufeinander warten: jede Anfrage läge drüben neben der
     * eigenen, und keiner käme auf die Idee, die andere anzunehmen.
     */
    const a = await anlegen('1', 'Patte', 'AAAA-1111')
    const b = await anlegen('2', 'Benny', 'BBBB-2222')

    const erste = await call({ method: 'POST', path: '/friends/request', body: { trainerId: a, code: 'BBBB-2222' } })
    expect((erste.body as any).accepted).toBe(false)

    const zweite = await call({ method: 'POST', path: '/friends/request', body: { trainerId: b, code: 'AAAA-1111' } })
    expect((zweite.body as any).accepted).toBe(true)

    const liste = await call({ method: 'POST', path: '/friends', body: { trainerId: a } })
    expect((liste.body as any).friends.map((f: any) => f.displayName)).toEqual(['Benny'])
  })

  it('nimmt eine Anfrage an und lehnt eine andere ab', async () => {
    const a = await anlegen('1', 'Patte', 'AAAA-1111')
    const b = await anlegen('2', 'Benny', 'BBBB-2222')
    await call({ method: 'POST', path: '/friends/request', body: { trainerId: b, code: 'AAAA-1111' } })

    const offen = await call({ method: 'POST', path: '/friends', body: { trainerId: a } })
    expect((offen.body as any).incoming).toHaveLength(1)

    await call({ method: 'POST', path: '/friends/respond', body: { trainerId: a, otherId: b, accept: false } })
    const danach = await call({ method: 'POST', path: '/friends', body: { trainerId: a } })
    expect((danach.body as any).incoming).toHaveLength(0)
    expect((danach.body as any).friends).toHaveLength(0)
  })

  it('laesst niemanden sich selbst hinzufuegen', async () => {
    const a = await anlegen('1', 'Patte', 'AAAA-1111')
    const r = await call({ method: 'POST', path: '/friends/request', body: { trainerId: a, code: 'AAAA-1111' } })
    expect(r.status).toBe(400)
  })

  it('laesst keine Instanz fremde Freundeslisten lesen', async () => {
    /*
     * Dieselbe Regel wie bei Profilen und Chat: eine Instanz spricht nur fuer
     * ihre eigenen Trainer. Sonst waere die Freundesliste jedes Spielers im
     * Verbund fuer jede angemeldete Instanz einsehbar.
     */
    const a = await anlegen('1', 'Patte', 'AAAA-1111')
    const r = await hub({ method: 'POST', path: '/instances', body: { id: 'fremd' }, adminSecret: ADMIN })
    const otherSecret = (r.body as any).secret as string
    const body = JSON.stringify({ trainerId: a })
    const evil = await hub({
      method: 'POST', path: '/friends', body: { trainerId: a },
      auth: {
        instanceId: 'fremd', timestamp: NOW,
        signature: await sign(otherSecret, 'POST', '/friends', NOW, body),
      },
    })
    expect(evil.status).toBe(403)
  })

  it('entfernt eine Freundschaft von beiden Seiten', async () => {
    const a = await anlegen('1', 'Patte', 'AAAA-1111')
    const b = await anlegen('2', 'Benny', 'BBBB-2222')
    await call({ method: 'POST', path: '/friends/request', body: { trainerId: a, code: 'BBBB-2222' } })
    await call({ method: 'POST', path: '/friends/request', body: { trainerId: b, code: 'AAAA-1111' } })

    await call({ method: 'POST', path: '/friends/remove', body: { trainerId: a, otherId: b } })
    for (const wer of [a, b]) {
      const liste = await call({ method: 'POST', path: '/friends', body: { trainerId: wer } })
      expect((liste.body as any).friends).toHaveLength(0)
    }
  })
})
