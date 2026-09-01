import { GameError, type Trainer } from '@game/shared'
import type { AppContext } from '../context.js'
import { logEvent } from '../repos/events.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import * as social from '../repos/social.js'
import * as teamsRepo from '../repos/teams.js'
import * as orders from '../repos/hubOrders.js'
import { von } from './ledger.js'
import { boxLimit } from './safari.js'
import { MARKET_FEE } from './social.js'
import { call, callOrThrow, enabled, linkedId } from './hub.js'
import { tx } from '../db/index.js'

/**
 * Kaufen ueber Instanzgrenzen.
 *
 * Das Gold liegt in der einen Datenbank, das Pokemon in der anderen, und keine
 * sieht die andere. Ein Kauf in einem Zug ist damit unmoeglich. Er zerfaellt in
 * drei Schritte, und der Verbund verwahrt dazwischen — das ist die Treuhand.
 *
 * Der Leitgedanke bei jedem Schritt: **nichts darf verschwinden**. Deshalb
 * gilt an jeder Bruchstelle eine feste Reihenfolge —
 *
 *   Der Kaeufer zahlt, *bevor* er bestellt. Kommt der Verbund nicht zustande,
 *   bekommt er sein Gold sofort zurueck; kommt die Antwort nicht an, findet
 *   der Abgleich die bezahlte Zeile und erstattet sie.
 *
 *   Der Verkaeufer nimmt das Pokemon aus seiner Datenbank und legt es in die
 *   eigene Bestellzeile, *bevor* er es dem Verbund gibt. Bricht die Leitung
 *   dazwischen, ist es nicht fort, sondern liegt bei ihm und wird beim
 *   naechsten Lauf erneut angeboten.
 *
 *   Der Verbund gibt es heraus und hakt danach ab. Im schlechtesten Fall wird
 *   es zweimal geholt — und das faellt beim Kaeufer auf, der den Vorgang
 *   bereits als erledigt fuehrt.
 *
 * Ein Pokemon kann so kurz doppelt zu existieren *scheinen* (verwahrt und
 * notiert), aber nie verschwinden. Die umgekehrte Wahl waere die falsche: ein
 * verlorenes Pokemon nimmt einem Spieler etwas weg, ein kurz doppelt
 * gebuchtes kostet nur einen Abgleich.
 */

/** Was von einem Pokemon ueber die Grenze geht. */
interface Reisepass {
  speciesId: string
  level: number
  xp: number
  nature: string
  ivs: Record<string, number>
  friendship: number
  shiny: boolean
  moves: string[]
  nickname: string | null
}

/**
 * Ein fremdes Angebot kaufen.
 *
 * Bezahlt wird zuerst, und zwar oertlich. Das ist die unangenehme, aber
 * richtige Reihenfolge: wer erst bestellt und dann bezahlt, kann bestellen,
 * ohne zu koennen — und der Verkaeufer haette sein Pokemon fuer nichts
 * herausgegeben.
 */
export async function buyRemote(ctx: AppContext, trainer: Trainer, listingId: string) {
  if (!enabled(ctx)) throw new GameError('invalid_state', { reason: 'no_hub' }, 409)

  const angebot = cachedRow(ctx, listingId)
  if (!angebot) throw new GameError('not_found', { listingId }, 404)
  if (angebot.trainerId === linkedId(ctx, trainer.id)) {
    throw new GameError('validation_failed', { reason: 'own_listing' })
  }
  if (orders.byListing(ctx.db, listingId)) {
    throw new GameError('invalid_state', { reason: 'already_ordered' }, 409)
  }
  const limit = boxLimit(ctx, trainer.id)
  if (creatures.countOwned(ctx.db, trainer.id).total >= limit) {
    throw new GameError('invalid_state', { reason: 'box_full', limit }, 409)
  }

  // Die vorlaeufige Kennung: die Zeile muss existieren, bevor das Netz
  // befragt wird — sonst waere eine abgebrochene Antwort spurlos.
  const vorlaeufig = `offen:${listingId}`
  tx(ctx.db, () => {
    inventory.spendGold(ctx.db, trainer.id, angebot.price)
    orders.put(ctx.db, {
      id: vorlaeufig, role: 'buyer', listingId, trainerId: trainer.id,
      price: angebot.price, status: 'paid', payload: null, reason: null,
    })
  })

  try {
    const res = await callOrThrow(ctx, 'POST', '/market/buy', {
      listingId, buyerTrainerId: linkedId(ctx, trainer.id),
    }) as { order?: { id: string } }
    const id = res.order?.id
    if (!id) throw new GameError('invalid_state', { reason: 'no_order' }, 502)
    orders.rename(ctx.db, vorlaeufig, id, 'ordered')
    logEvent(ctx.db, trainer.id, 'hub.market.ordered', { listingId, orderId: id, price: angebot.price })
    return { orderId: id, price: angebot.price }
  } catch (err) {
    // Nicht zustande gekommen: das Gold gehoert sofort zurueck. Nur wenn auch
    // das scheitert, bleibt die Zeile stehen — der Abgleich findet sie.
    erstatten(ctx, vorlaeufig, 'bestellung_gescheitert')
    throw err
  }
}

/** Das Angebot aus dem zuletzt geholten Aushang. */
function cachedRow(ctx: AppContext, listingId: string) {
  const row = ctx.db.prepare('SELECT payload FROM hub_cache WHERE key = ?')
    .get('market') as { payload: string } | undefined
  if (!row) return null
  try {
    const rows = JSON.parse(row.payload) as Array<{ id: string; trainerId: string; price: number }>
    return rows.find((r) => r.id === listingId) ?? null
  } catch { return null }
}

function erstatten(ctx: AppContext, orderId: string, grund: string): void {
  const o = orders.byId(ctx.db, orderId)
  if (!o || o.role !== 'buyer' || o.status === 'refunded' || o.status === 'done') return
  tx(ctx.db, () => {
    inventory.earnGold(ctx.db, o.trainerId, o.price, von(ctx, 'hub.market.refund'))
    orders.setStatus(ctx.db, o.id, 'refunded', grund)
  })
  logEvent(ctx.db, o.trainerId, 'hub.market.refunded', { orderId, price: o.price, reason: grund })
}

/**
 * Der Abgleich.
 *
 * Laeuft im Hintergrund und macht in jeder Runde genau das, was gerade
 * moeglich ist. Jeder Schritt ist wiederholbar: bricht etwas ab, bleibt der
 * Vorgang in seinem Zustand und wird beim naechsten Lauf erneut versucht.
 */
export async function settle(ctx: AppContext): Promise<number> {
  if (!enabled(ctx)) return 0
  const res = await call(ctx, 'GET', '/market/orders') as { orders?: HubOrder[] } | null
  if (!res?.orders) return 0

  let getan = 0
  const meine = new Map(res.orders.map((o) => [o.id, o]))

  // Bezahlt, aber ohne Vorgang im Verbund: die Antwort ist nie angekommen.
  for (const offen of orders.withStatus(ctx.db, 'paid')) {
    const passend = res.orders.find(
      (o) => o.listingId === offen.listingId && o.status !== 'aborted',
    )
    if (passend) { orders.rename(ctx.db, offen.id, passend.id, 'ordered'); getan++; continue }
    erstatten(ctx, offen.id, 'keine_bestellung_im_verbund')
    getan++
  }

  for (const o of res.orders) {
    const lokal = orders.byId(ctx.db, o.id)

    // --- Verkaeuferseite: liefern.
    if (o.status === 'reserved' && !lokal) { if (await ausliefern(ctx, o)) getan++ }
    // Schon entnommen, aber noch nicht uebergeben — erneut anbieten.
    else if (o.status === 'reserved' && lokal?.status === 'holding') {
      if (await uebergeben(ctx, o.id, lokal.payload ?? '')) getan++
    }
    // --- Kaeuferseite: abholen.
    else if (o.status === 'delivered' && lokal && lokal.role === 'buyer' && lokal.status === 'ordered') {
      if (await abholen(ctx, o, lokal)) getan++
    }
    // --- Abgebrochen: Gold zurueck.
    else if (o.status === 'aborted' && lokal?.role === 'buyer' && lokal.status === 'ordered') {
      erstatten(ctx, o.id, o.reason ?? 'abgebrochen')
      getan++
    }
    // --- Geliefert und abgehakt: unsere Notiz schliessen.
    else if (o.status === 'collected' && lokal && lokal.status === 'holding') {
      orders.setStatus(ctx.db, o.id, 'done')
      getan++
    }
  }
  void meine
  return getan
}

interface HubOrder {
  id: string
  listingId: string
  sellerInstanceId: string
  sellerTrainerId: string
  buyerInstanceId: string
  buyerTrainerId: string
  price: number
  status: 'reserved' | 'delivered' | 'collected' | 'aborted'
  creature: string | null
  reason: string | null
}

/**
 * Das Pokemon aus der eigenen Datenbank nehmen und in die Bestellzeile legen.
 *
 * Erst danach geht es an den Verbund. Bricht die Leitung dazwischen, ist es
 * nicht fort — es liegt in `payload` und wird beim naechsten Lauf angeboten.
 */
async function ausliefern(ctx: AppContext, o: HubOrder): Promise<boolean> {
  const listing = social.listingById(ctx.db, o.listingId)
  if (!listing || listing.soldAt || listing.cancelledAt) {
    await call(ctx, 'POST', '/market/abort', { orderId: o.id, reason: 'angebot_weg' })
    return true
  }
  const c = creatures.byId(ctx.db, listing.creatureId)
  if (!c || c.ownerId !== listing.sellerId) {
    await call(ctx, 'POST', '/market/abort', { orderId: o.id, reason: 'pokemon_weg' })
    return true
  }

  const pass: Reisepass = {
    speciesId: c.speciesId, level: c.level, xp: c.xp, nature: c.nature,
    ivs: c.ivs as unknown as Record<string, number>, friendship: c.friendship,
    shiny: c.shiny, moves: c.moves, nickname: c.nickname,
  }
  const payload = JSON.stringify(pass)
  const auszahlung = Math.max(1, Math.round(o.price * (1 - MARKET_FEE)))

  tx(ctx.db, () => {
    social.markSoldRemote(ctx.db, listing.id)
    teamsRepo.removeCreature(ctx.db, listing.creatureId)
    ctx.db.prepare('DELETE FROM creatures WHERE id = ?').run(listing.creatureId)
    inventory.earnGold(ctx.db, listing.sellerId, auszahlung, von(ctx, 'hub.market.sale'))
    orders.put(ctx.db, {
      id: o.id, role: 'seller', listingId: o.listingId, trainerId: listing.sellerId,
      price: o.price, status: 'holding', payload, reason: null,
    })
  })
  logEvent(ctx.db, listing.sellerId, 'hub.market.sold', { orderId: o.id, price: o.price, payout: auszahlung })

  return uebergeben(ctx, o.id, payload)
}

/** Das Verwahrte an den Verbund geben. Scheitert es, bleibt es liegen. */
async function uebergeben(ctx: AppContext, orderId: string, payload: string): Promise<boolean> {
  if (!payload) return false
  const res = await call(ctx, 'POST', '/market/deliver', { orderId, creature: payload })
  if (res === null) return false
  orders.setStatus(ctx.db, orderId, 'done')
  return true
}

/** Das Verwahrte abholen und daraus ein Pokemon machen. */
async function abholen(ctx: AppContext, o: HubOrder, lokal: orders.LocalOrder): Promise<boolean> {
  const res = await call(ctx, 'POST', '/market/collect', { orderId: o.id }) as { creature?: string } | null
  if (!res?.creature) return false

  let pass: Reisepass
  try { pass = JSON.parse(res.creature) as Reisepass } catch {
    erstatten(ctx, o.id, 'unlesbar')
    return true
  }
  /*
   * Eine Art, die dieses Paket nicht kennt, kann hier nicht entstehen.
   *
   * Zwei Instanzen koennen verschiedene Pakete fahren. Das Gold zurueck ist
   * dann die einzige ehrliche Antwort — ein Platzhalter waere ein Pokemon,
   * das es nicht gibt.
   */
  if (!ctx.registry.trySpecies(pass.speciesId)) {
    erstatten(ctx, o.id, 'art_unbekannt')
    return true
  }

  tx(ctx.db, () => {
    creatures.insertCreature(ctx.db, {
      ownerId: lokal.trainerId,
      speciesId: pass.speciesId,
      level: pass.level,
      xp: pass.xp,
      nature: pass.nature,
      ivs: pass.ivs,
      friendship: pass.friendship,
      hpCurrent: Number.MAX_SAFE_INTEGER,
      shiny: pass.shiny,
      moves: pass.moves,
      // Kein Fundort: gefangen wurde es woanders, und eine erfundene Route
      // waere eine Behauptung ueber eine fremde Welt.
      caughtAreaId: null,
      teamSlot: null,
    } as Parameters<typeof creatures.insertCreature>[1], von(ctx, 'hub.market.buy'))
    orders.setStatus(ctx.db, o.id, 'done')
  })
  logEvent(ctx.db, lokal.trainerId, 'hub.market.received', {
    orderId: o.id, speciesId: pass.speciesId, price: lokal.price,
  })
  return true
}
