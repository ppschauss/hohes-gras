import { GameError, type Trainer } from '@game/shared'
import { von } from './ledger.js'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as social from '../repos/social.js'
import * as creatures from '../repos/creatures.js'
import { boxLimit } from './safari.js'
import * as teamsRepo from '../repos/teams.js'
import * as inventory from '../repos/inventory.js'
import * as world from '../repos/world.js'
import * as dex from '../repos/dex.js'
import * as expeditions from '../repos/expeditions.js'
import * as battles from '../repos/battles.js'
import { findById, findByTrainerCode } from '../repos/trainers.js'
import { logEvent } from '../repos/events.js'
import * as gifts from './gifts.js'
import { worldClock } from '../worldClock.js'
import { creatureView } from './views.js'
import { bumpMetric, evolveByTrade } from './progression.js'
import * as hub from './hub.js'
import { busyCreatureIds } from './busy.js'

/** Market prices are bounded so a listing cannot be used to move a fortune
 *  between two accounts one person controls. */
export const MIN_PRICE = 50
export const MAX_PRICE = 100_000
export const MARKET_FEE = 0.08

/* ------------------------------------------------------------- Trainerkarte */

export interface TrainerCard {
  trainerId: string
  displayName: string
  trainerCode: string
  joinedAt: number
  rank: number | null
  score: number
  dexCaught: number
  dexTotal: number
  badges: Array<{ id: string; name: string; icon: string }>
  battlesWon: number
  shinies: number
  highestLevel: number
  teamPreview: Array<{ speciesId: string; name: string; sprite: string; level: number; shiny: boolean }>
  isFriend: boolean
  isSelf: boolean
  requestPending: boolean
}

export function trainerCard(ctx: AppContext, viewer: Trainer, targetId: string): TrainerCard {
  const target = findById(ctx.db, targetId)
  if (!target || target.isBanned) throw new GameError('not_found', { trainerId: targetId }, 404)

  const isSelf = target.id === viewer.id
  const isFriend = !isSelf && social.areFriends(ctx.db, viewer.id, target.id)

  // Privacy is enforced here, not in the client: a trainer who hid their
  // profile must be invisible to anyone who is not already a friend.
  if (!isSelf && !isFriend && target.privacy.friendsOnlyInteractions) {
    throw new GameError('not_found', { trainerId: targetId }, 404)
  }

  social.refreshStats(ctx.db, target.id)
  const stats = ctx.db
    .prepare('SELECT * FROM leaderboard_stats WHERE trainer_id = ?')
    .get(target.id) as Record<string, number> | undefined

  const badgeIds = [...world.badgesOf(ctx.db, target.id)]
  const team = creatures.teamOf(ctx.db, target.id)

  return {
    trainerId: target.id,
    displayName: target.displayName,
    // Only the owner sees their own code; showing a stranger's would let
    // anyone spam friend requests at people who never shared it.
    trainerCode: isSelf ? target.trainerCode : '',
    joinedAt: target.createdAt,
    rank: target.privacy.hideFromLeaderboard && !isSelf ? null : social.rankOf(ctx.db, target.id),
    score: stats?.score ?? 0,
    dexCaught: stats?.dex_caught ?? 0,
    dexTotal: ctx.registry.speciesCount,
    badges: badgeIds.flatMap((id) => {
      const b = ctx.registry.tryBadge(id)
      if (!b) return []
      return [{ id: b.id, name: ctx.registry.localized(b.name, viewer.locale), icon: b.icon }]
    }),
    battlesWon: stats?.battles_won ?? 0,
    shinies: stats?.shinies ?? 0,
    highestLevel: stats?.highest_level ?? 0,
    teamPreview: team.map((c) => {
      const species = ctx.registry.species(c.speciesId)
      return {
        speciesId: c.speciesId,
        name: c.nickname ?? ctx.registry.localized(species.name, viewer.locale),
        sprite: c.shiny ? species.spriteShiny : species.sprite,
        level: c.level,
        shiny: c.shiny,
      }
    }),
    isFriend,
    isSelf,
    requestPending: !isSelf && social.hasRequest(ctx.db, viewer.id, target.id),
  }
}

/* ----------------------------------------------------------------- Freunde */

export function friendOverview(ctx: AppContext, trainer: Trainer) {
  const friendIds = social.friendIdsOf(ctx.db, trainer.id)
  const incoming = social.incomingRequests(ctx.db, trainer.id)
  const outgoing = social.outgoingRequests(ctx.db, trainer.id)

  const brief = (id: string) => {
    const t = findById(ctx.db, id)
    if (!t) return null
    social.refreshStats(ctx.db, id)
    const stats = ctx.db.prepare('SELECT score, badges, dex_caught AS dexCaught FROM leaderboard_stats WHERE trainer_id = ?')
      .get(id) as { score: number; badges: number; dexCaught: number } | undefined
    return {
      trainerId: t.id,
      displayName: t.displayName,
      lastSeenAt: t.lastSeenAt,
      score: stats?.score ?? 0,
      badges: stats?.badges ?? 0,
      dexCaught: stats?.dexCaught ?? 0,
    }
  }

  const gifted = gifts.sentToday(ctx, trainer.id)
  return {
    trainerCode: trainer.trainerCode,
    gifts: gifts.inbox(ctx, trainer),
    friends: friendIds.map(brief).filter((f): f is NonNullable<typeof f> => f !== null)
      // Der Knopf braucht nur ein Ja oder Nein; das Datum bleibt beim Server.
      .map((f) => ({ ...f, giftedToday: gifted.has(f.trainerId) })),
    incoming: incoming.map((r) => brief(r.fromId)).filter((f): f is NonNullable<typeof f> => f !== null),
    outgoing: outgoing.map((r) => brief(r.toId)).filter((f): f is NonNullable<typeof f> => f !== null),
  }
}

export function requestFriend(ctx: AppContext, trainer: Trainer, code: string): { status: 'sent' | 'accepted' } {
  return tx(ctx.db, () => {
    const target = findByTrainerCode(ctx.db, code.trim())
    if (!target || target.isBanned) throw new GameError('not_found', { code }, 404)
    if (target.id === trainer.id) throw new GameError('validation_failed', { reason: 'self' })
    if (!target.privacy.allowFriendRequests) throw new GameError('invalid_state', { reason: 'requests_closed' }, 409)
    if (social.areFriends(ctx.db, trainer.id, target.id)) {
      throw new GameError('invalid_state', { reason: 'already_friends' }, 409)
    }

    // If they already asked us, accept instead of queueing a mirror request.
    if (social.hasRequest(ctx.db, target.id, trainer.id)) {
      social.dropRequest(ctx.db, target.id, trainer.id)
      social.addFriendship(ctx.db, trainer.id, target.id)
      logEvent(ctx.db, trainer.id, 'friend.accepted', { other: target.id })
      return { status: 'accepted' as const }
    }

    social.sendRequest(ctx.db, trainer.id, target.id)
    logEvent(ctx.db, trainer.id, 'friend.requested', { other: target.id })
    return { status: 'sent' as const }
  })
}

export function respondToRequest(ctx: AppContext, trainer: Trainer, fromId: string, accept: boolean): void {
  tx(ctx.db, () => {
    if (!social.dropRequest(ctx.db, fromId, trainer.id)) {
      throw new GameError('not_found', { fromId }, 404)
    }
    if (accept) {
      social.addFriendship(ctx.db, trainer.id, fromId)
      bumpMetric(ctx, trainer.id, 'friends')
      bumpMetric(ctx, fromId, 'friends')
      logEvent(ctx.db, trainer.id, 'friend.accepted', { other: fromId })
    } else {
      logEvent(ctx.db, trainer.id, 'friend.declined', { other: fromId })
    }
  })
}

export function removeFriend(ctx: AppContext, trainer: Trainer, otherId: string): void {
  if (!social.removeFriendship(ctx.db, trainer.id, otherId)) {
    throw new GameError('not_found', { otherId }, 404)
  }
  logEvent(ctx.db, trainer.id, 'friend.removed', { other: otherId })
}

/* -------------------------------------------------------------- Marktplatz */

/** A creature that is busy elsewhere must not be tradable — otherwise it could
 *  be sold while it is out on an expedition or fighting. */
function assertTradable(ctx: AppContext, trainer: Trainer, creatureId: string): void {
  const c = creatures.byId(ctx.db, creatureId)
  if (!c) throw new GameError('not_found', { creatureId }, 404)
  if (c.ownerId !== trainer.id) throw new GameError('not_owner', { creatureId }, 403)
  if (c.teamSlot !== null) throw new GameError('invalid_state', { reason: 'in_team', creatureId }, 409)
  if (busyCreatureIds(ctx, trainer.id).has(creatureId)) {
    throw new GameError('invalid_state', { reason: 'on_expedition', creatureId }, 409)
  }
  if (social.listedCreatureIds(ctx.db, trainer.id).has(creatureId)) {
    throw new GameError('invalid_state', { reason: 'already_listed', creatureId }, 409)
  }
  if (social.creatureIdsInOpenTrades(ctx.db, trainer.id).has(creatureId)) {
    throw new GameError('invalid_state', { reason: 'in_trade', creatureId }, 409)
  }
  if (battles.activeOf(ctx.db, trainer.id)) {
    throw new GameError('invalid_state', { reason: 'battle_in_progress' }, 409)
  }
}

export function listingView(ctx: AppContext, viewer: Trainer, listing: social.Listing) {
  const c = creatures.byId(ctx.db, listing.creatureId)
  const seller = findById(ctx.db, listing.sellerId)
  return {
    id: listing.id,
    price: listing.price,
    note: listing.note,
    createdAt: listing.createdAt,
    sellerName: seller?.displayName ?? '?',
    isOwn: listing.sellerId === viewer.id,
    creature: c ? creatureView(ctx.registry, c, viewer.locale, worldClock().timeOfDay) : null,
  }
}

export function marketOverview(ctx: AppContext, trainer: Trainer) {
  const bag = creatures.allBoxOf(ctx.db, trainer.id)
  const busy = busyCreatureIds(ctx, trainer.id)
  const listed = social.listedCreatureIds(ctx.db, trainer.id)
  const inTrade = social.creatureIdsInOpenTrades(ctx.db, trainer.id)

  return {
    gold: inventory.goldOf(ctx.db, trainer.id),
    minPrice: MIN_PRICE,
    maxPrice: MAX_PRICE,
    feePercent: Math.round(MARKET_FEE * 100),
    listings: social.openListings(ctx.db, 50, trainer.id).map((l) => listingView(ctx, trainer, l)),
    /*
     * Was im Verbund aushaengt.
     *
     * Nur zum Ansehen: gekauft wird ueber Instanzgrenzen noch nicht. Die
     * Angebote stammen aus dem Zwischenspeicher, den der Hintergrundlauf
     * fuellt — ein Blick auf den Marktplatz wartet auf keine fremde Leitung.
     * Eigene Angebote, die ueber den Verbund zurueckkommen, filtert die
     * Ansicht heraus: sie stehen schon eine Liste weiter oben.
     */
    global: hub.cachedMarket(ctx)
      .filter((l) => l.trainerId !== hub.linkedId(ctx, trainer.id))
      .map((l) => ({ ...l, note: l.note.slice(0, 120) })),
    ownListings: social.listingsOfSeller(ctx.db, trainer.id).map((l) => listingView(ctx, trainer, l)),
    sellable: bag
      .filter((c) => !busy.has(c.id) && !listed.has(c.id) && !inTrade.has(c.id))
      .map((c) => creatureView(ctx.registry, c, trainer.locale, worldClock().timeOfDay)),
  }
}

export function createListing(ctx: AppContext, trainer: Trainer, creatureId: string, price: number, note: string) {
  if (price < MIN_PRICE || price > MAX_PRICE) {
    throw new GameError('validation_failed', { field: 'price', min: MIN_PRICE, max: MAX_PRICE })
  }
  return tx(ctx.db, () => {
    assertTradable(ctx, trainer, creatureId)
    const listing = social.createListing(ctx.db, trainer.id, creatureId, price, note)
    logEvent(ctx.db, trainer.id, 'market.list', { creatureId, price })
    return listingView(ctx, trainer, listing)
  })
}

export function cancelListing(ctx: AppContext, trainer: Trainer, listingId: string): void {
  if (!social.cancelListing(ctx.db, listingId, trainer.id)) {
    throw new GameError('not_found', { listingId }, 404)
  }
  logEvent(ctx.db, trainer.id, 'market.cancel', { listingId })
}

export function buyListing(ctx: AppContext, trainer: Trainer, listingId: string) {
  return tx(ctx.db, () => {
    const listing = social.listingById(ctx.db, listingId)
    if (!listing || listing.soldAt || listing.cancelledAt) {
      throw new GameError('not_found', { listingId }, 404)
    }
    if (listing.sellerId === trainer.id) throw new GameError('validation_failed', { reason: 'own_listing' })

    const creature = creatures.byId(ctx.db, listing.creatureId)
    if (!creature || creature.ownerId !== listing.sellerId) {
      throw new GameError('invalid_state', { reason: 'creature_gone' }, 409)
    }
    // Dieselbe Grenze wie beim Fangen — sie stand hier als nackte 300 und
    // waere beim Ausbau der Box zurueckgeblieben.
    const limit = boxLimit(ctx, trainer.id)
    if (creatures.countOwned(ctx.db, trainer.id).total >= limit) {
      throw new GameError('invalid_state', { reason: 'box_full', limit }, 409)
    }

    inventory.spendGold(ctx.db, trainer.id, listing.price)
    // Claim the listing before paying out: if another buyer won the race, this
    // returns false and the whole transaction rolls back.
    if (!social.markSold(ctx.db, listing.id, trainer.id)) {
      throw new GameError('invalid_state', { reason: 'already_sold' }, 409)
    }

    const payout = Math.max(1, Math.round(listing.price * (1 - MARKET_FEE)))
    inventory.earnGold(ctx.db, listing.sellerId, payout, von(ctx, 'market.sale'))

    teamsRepo.removeCreature(ctx.db, listing.creatureId)
    ctx.db.prepare('UPDATE creatures SET owner_id = ?, team_slot = NULL WHERE id = ?')
      .run(trainer.id, creature.id)
    dex.markCaught(ctx.db, trainer.id, creature.speciesId)

    social.refreshStats(ctx.db, trainer.id)
    social.refreshStats(ctx.db, listing.sellerId)
    bumpMetric(ctx, trainer.id, 'catches')
    logEvent(ctx.db, trainer.id, 'market.buy', { listingId, price: listing.price, sellerId: listing.sellerId })

    return {
      creature: creatureView(ctx.registry, creatures.byId(ctx.db, creature.id)!, trainer.locale, worldClock().timeOfDay),
      paid: listing.price,
    }
  })
}

/* ------------------------------------------------------------ Direkttausch */

export function tradeOverview(ctx: AppContext, trainer: Trainer) {
  const { incoming, outgoing } = social.openTradesFor(ctx.db, trainer.id)
  const busy = busyCreatureIds(ctx, trainer.id)
  const listed = social.listedCreatureIds(ctx.db, trainer.id)
  const inTrade = social.creatureIdsInOpenTrades(ctx.db, trainer.id)

  const describe = (offer: social.TradeOffer) => {
    const from = findById(ctx.db, offer.fromId)
    const to = findById(ctx.db, offer.toId)
    const offered = creatures.byId(ctx.db, offer.offeredId)
    const requested = offer.requestedId ? creatures.byId(ctx.db, offer.requestedId) : null
    const clock = worldClock()
    return {
      id: offer.id,
      fromName: from?.displayName ?? '?',
      toName: to?.displayName ?? '?',
      message: offer.message,
      expiresAt: offer.expiresAt,
      offered: offered ? creatureView(ctx.registry, offered, trainer.locale, clock.timeOfDay) : null,
      requested: requested ? creatureView(ctx.registry, requested, trainer.locale, clock.timeOfDay) : null,
    }
  }

  return {
    incoming: incoming.map(describe),
    outgoing: outgoing.map(describe),
    friends: social.friendIdsOf(ctx.db, trainer.id).flatMap((id) => {
      const t = findById(ctx.db, id)
      return t ? [{ trainerId: t.id, displayName: t.displayName }] : []
    }),
    tradable: creatures.allBoxOf(ctx.db, trainer.id)
      .filter((c) => !busy.has(c.id) && !listed.has(c.id) && !inTrade.has(c.id))
      .map((c) => creatureView(ctx.registry, c, trainer.locale, worldClock().timeOfDay)),
  }
}

export function offerTrade(
  ctx: AppContext, trainer: Trainer,
  toTrainerId: string, offeredId: string, requestedId: string | null, message: string,
) {
  return tx(ctx.db, () => {
    const target = findById(ctx.db, toTrainerId)
    if (!target || target.isBanned) throw new GameError('not_found', { toTrainerId }, 404)
    if (target.id === trainer.id) throw new GameError('validation_failed', { reason: 'self' })
    if (!social.areFriends(ctx.db, trainer.id, target.id)) {
      throw new GameError('invalid_state', { reason: 'not_friends' }, 409)
    }

    assertTradable(ctx, trainer, offeredId)

    if (requestedId) {
      const wanted = creatures.byId(ctx.db, requestedId)
      if (!wanted) throw new GameError('not_found', { requestedId }, 404)
      if (wanted.ownerId !== target.id) throw new GameError('validation_failed', { reason: 'not_theirs' })
    }

    const now = Date.now()
    const offer = social.createTrade(ctx.db, {
      fromId: trainer.id, toId: target.id, offeredId, requestedId,
      message, createdAt: now, expiresAt: now + social.TRADE_TTL_MS,
    })
    logEvent(ctx.db, trainer.id, 'trade.offered', { toId: target.id, offeredId, requestedId })
    return offer
  })
}

export function respondToTrade(ctx: AppContext, trainer: Trainer, tradeId: string, accept: boolean) {
  return tx(ctx.db, () => {
    const offer = social.tradeById(ctx.db, tradeId)
    if (!offer) throw new GameError('not_found', { tradeId }, 404)
    if (offer.toId !== trainer.id) throw new GameError('not_owner', { tradeId }, 403)
    if (offer.acceptedAt || offer.declinedAt) throw new GameError('invalid_state', { reason: 'already_resolved' }, 409)
    if (offer.expiresAt <= Date.now()) throw new GameError('invalid_state', { reason: 'expired' }, 409)

    if (!accept) {
      social.declineTrade(ctx.db, offer.id)
      logEvent(ctx.db, trainer.id, 'trade.declined', { tradeId })
      return { accepted: false }
    }

    // Re-validate both sides at acceptance time: the offered creature may have
    // been sold, put in a team or traded away since the offer was made.
    const offered = creatures.byId(ctx.db, offer.offeredId)
    if (!offered || offered.ownerId !== offer.fromId || offered.teamSlot !== null) {
      throw new GameError('invalid_state', { reason: 'offer_stale' }, 409)
    }
    if (offer.requestedId) {
      const wanted = creatures.byId(ctx.db, offer.requestedId)
      if (!wanted || wanted.ownerId !== trainer.id) {
        throw new GameError('invalid_state', { reason: 'request_stale' }, 409)
      }
      if (wanted.teamSlot !== null) throw new GameError('invalid_state', { reason: 'in_team' }, 409)
    }

    if (!social.acceptTrade(ctx.db, offer.id)) {
      throw new GameError('invalid_state', { reason: 'already_resolved' }, 409)
    }

    teamsRepo.removeCreature(ctx.db, offer.offeredId)
    ctx.db.prepare('UPDATE creatures SET owner_id = ?, team_slot = NULL WHERE id = ?')
      .run(trainer.id, offer.offeredId)
    dex.markCaught(ctx.db, trainer.id, offered.speciesId)

    if (offer.requestedId) {
      const wanted = creatures.byId(ctx.db, offer.requestedId)!
      teamsRepo.removeCreature(ctx.db, offer.requestedId)
      ctx.db.prepare('UPDATE creatures SET owner_id = ?, team_slot = NULL WHERE id = ?')
        .run(offer.fromId, offer.requestedId)
      dex.markCaught(ctx.db, offer.fromId, wanted.speciesId)
    }

    /*
     * Und jetzt das, wofuer im Vorbild ueberhaupt getauscht wird.
     *
     * Elf Arten entwickeln sich nur beim Besitzerwechsel. Beide Seiten werden
     * geprueft, denn beide bekommen etwas — beim Ringtausch koennen sich zwei
     * Pokemon gleichzeitig entwickeln.
     */
    const evolved: string[] = []
    const mine = evolveByTrade(ctx, trainer.id, offer.offeredId)
    if (mine) evolved.push(mine)
    if (offer.requestedId) {
      const theirs = evolveByTrade(ctx, offer.fromId, offer.requestedId)
      if (theirs) evolved.push(theirs)
    }

    social.refreshStats(ctx.db, trainer.id)
    social.refreshStats(ctx.db, offer.fromId)
    bumpMetric(ctx, trainer.id, 'catches')
    bumpMetric(ctx, offer.fromId, 'catches')
    logEvent(ctx.db, trainer.id, 'trade.accepted', { tradeId, fromId: offer.fromId, evolved })
    /** Was sich durch den Tausch entwickelt hat — die App sagt es beiden an. */
    return { accepted: true, evolved }
  })
}

/* -------------------------------------------------------------- Rangliste */

export function leaderboardView(ctx: AppContext, trainer: Trainer) {
  social.refreshStats(ctx.db, trainer.id)
  const rows = social.leaderboard(ctx.db, 50)
  // Die globale Liste kommt aus dem Zwischenspeicher und ist null, solange
  // kein Verbund eingerichtet ist. Die Ansicht blendet sie dann einfach aus.
  const globalId = hub.linkedId(ctx, trainer.id)
  const global = hub.cachedLeaderboard(ctx)
  return {
    rows: rows.map((r, i) => ({ ...r, rank: i + 1, isSelf: r.trainerId === trainer.id })),
    ownRank: trainer.privacy.hideFromLeaderboard ? null : social.rankOf(ctx.db, trainer.id),
    hidden: trainer.privacy.hideFromLeaderboard,
    global: global?.map((r, i) => ({ ...r, rank: i + 1, isSelf: r.trainerId === globalId })) ?? null,
  }
}

export function updatePrivacy(
  ctx: AppContext, trainer: Trainer,
  changes: Partial<{ hideFromLeaderboard: boolean; friendsOnlyInteractions: boolean; allowFriendRequests: boolean; reminders: boolean }>,
): void {
  const columns: Record<string, string> = {
    hideFromLeaderboard: 'hide_leaderboard',
    friendsOnlyInteractions: 'friends_only',
    allowFriendRequests: 'allow_requests',
    reminders: 'reminders',
  }
  for (const [key, value] of Object.entries(changes)) {
    const column = columns[key]
    if (!column || typeof value !== 'boolean') continue
    ctx.db.prepare(`UPDATE trainers SET ${column} = ? WHERE id = ?`).run(value ? 1 : 0, trainer.id)
  }
  logEvent(ctx.db, trainer.id, 'privacy.updated', changes)
}
