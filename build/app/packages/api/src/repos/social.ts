import { GameError } from '@game/shared'
import type { Db } from '../db/index.js'
import { newId } from '../db/ids.js'

/** Friendships are stored once, with the lexicographically smaller id first.
 *  Every read and write goes through this so the invariant cannot drift. */
const pairKey = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a])

export function areFriends(db: Db, a: string, b: string): boolean {
  const [low, high] = pairKey(a, b)
  return db.prepare('SELECT 1 FROM friendships WHERE low_id = ? AND high_id = ?').get(low, high) !== undefined
}

export function friendIdsOf(db: Db, trainerId: string): string[] {
  const rows = db
    .prepare(
      `SELECT CASE WHEN low_id = ? THEN high_id ELSE low_id END AS other
       FROM friendships WHERE low_id = ? OR high_id = ?`,
    )
    .all(trainerId, trainerId, trainerId) as Array<{ other: string }>
  return rows.map((r) => r.other)
}

export function addFriendship(db: Db, a: string, b: string, now = Date.now()): boolean {
  if (a === b) return false
  const [low, high] = pairKey(a, b)
  return db
    .prepare('INSERT OR IGNORE INTO friendships (low_id, high_id, created_at) VALUES (?, ?, ?)')
    .run(low, high, now).changes === 1
}

export function removeFriendship(db: Db, a: string, b: string): boolean {
  const [low, high] = pairKey(a, b)
  return db.prepare('DELETE FROM friendships WHERE low_id = ? AND high_id = ?').run(low, high).changes === 1
}

export interface FriendRequest { fromId: string; toId: string; createdAt: number }

export function sendRequest(db: Db, fromId: string, toId: string, now = Date.now()): void {
  if (fromId === toId) throw new GameError('validation_failed', { reason: 'self' })
  db.prepare('INSERT OR IGNORE INTO friend_requests (from_id, to_id, created_at) VALUES (?, ?, ?)')
    .run(fromId, toId, now)
}

export function incomingRequests(db: Db, trainerId: string): FriendRequest[] {
  return db
    .prepare('SELECT from_id AS fromId, to_id AS toId, created_at AS createdAt FROM friend_requests WHERE to_id = ? ORDER BY created_at')
    .all(trainerId) as FriendRequest[]
}

export function outgoingRequests(db: Db, trainerId: string): FriendRequest[] {
  return db
    .prepare('SELECT from_id AS fromId, to_id AS toId, created_at AS createdAt FROM friend_requests WHERE from_id = ? ORDER BY created_at')
    .all(trainerId) as FriendRequest[]
}

export function hasRequest(db: Db, fromId: string, toId: string): boolean {
  return db.prepare('SELECT 1 FROM friend_requests WHERE from_id = ? AND to_id = ?').get(fromId, toId) !== undefined
}

export function dropRequest(db: Db, fromId: string, toId: string): boolean {
  return db.prepare('DELETE FROM friend_requests WHERE from_id = ? AND to_id = ?').run(fromId, toId).changes === 1
}

/* ------------------------------------------------------------- Marktplatz */

export interface Listing {
  id: string
  sellerId: string
  creatureId: string
  price: number
  note: string
  createdAt: number
  soldAt: number | null
  buyerId: string | null
  cancelledAt: number | null
}

interface ListingRow {
  id: string; seller_id: string; creature_id: string; price: number; note: string
  created_at: number; sold_at: number | null; buyer_id: string | null; cancelled_at: number | null
}

const toListing = (r: ListingRow): Listing => ({
  id: r.id, sellerId: r.seller_id, creatureId: r.creature_id, price: r.price, note: r.note,
  createdAt: r.created_at, soldAt: r.sold_at, buyerId: r.buyer_id, cancelledAt: r.cancelled_at,
})

export function createListing(db: Db, sellerId: string, creatureId: string, price: number, note: string, now = Date.now()): Listing {
  const id = newId()
  db.prepare('INSERT INTO market_listings (id, seller_id, creature_id, price, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, sellerId, creatureId, price, note.slice(0, 140), now)
  return listingById(db, id)!
}

export function listingById(db: Db, id: string): Listing | null {
  const row = db.prepare('SELECT * FROM market_listings WHERE id = ?').get(id) as ListingRow | undefined
  return row ? toListing(row) : null
}

export function openListings(db: Db, limit = 50, excludeSeller?: string): Listing[] {
  const rows = excludeSeller
    ? db.prepare(
        `SELECT * FROM market_listings WHERE sold_at IS NULL AND cancelled_at IS NULL AND seller_id != ?
         ORDER BY created_at DESC LIMIT ?`,
      ).all(excludeSeller, limit) as ListingRow[]
    : db.prepare(
        'SELECT * FROM market_listings WHERE sold_at IS NULL AND cancelled_at IS NULL ORDER BY created_at DESC LIMIT ?',
      ).all(limit) as ListingRow[]
  return rows.map(toListing)
}

export function listingsOfSeller(db: Db, sellerId: string): Listing[] {
  const rows = db
    .prepare('SELECT * FROM market_listings WHERE seller_id = ? AND sold_at IS NULL AND cancelled_at IS NULL ORDER BY created_at DESC')
    .all(sellerId) as ListingRow[]
  return rows.map(toListing)
}

export function listedCreatureIds(db: Db, sellerId: string): Set<string> {
  return new Set(listingsOfSeller(db, sellerId).map((l) => l.creatureId))
}

/** Close a listing as sold. Returns false if someone got there first — that
 *  single condition is what prevents two buyers paying for one creature. */
export function markSold(db: Db, id: string, buyerId: string, now = Date.now()): boolean {
  return db
    .prepare('UPDATE market_listings SET sold_at = ?, buyer_id = ? WHERE id = ? AND sold_at IS NULL AND cancelled_at IS NULL')
    .run(now, buyerId, id).changes === 1
}

/**
 * Verkauft an jemanden, den es hier nicht gibt.
 *
 * `buyer_id` zeigt auf `trainers` — und ein Kaeufer aus einer anderen Instanz
 * steht dort nicht. Ihn dennoch einzutragen bricht den Fremdschluessel; genau
 * daran ist der erste Versuch gescheitert. Also bleibt das Feld leer: wer
 * gekauft hat, steht im Vorgang unter `hub_orders`, und dort gehoert es auch
 * hin — es ist eine Tatsache ueber den Verbund, nicht ueber diese Instanz.
 */
export function markSoldRemote(db: Db, id: string, now = Date.now()): boolean {
  return db
    .prepare('UPDATE market_listings SET sold_at = ? WHERE id = ? AND sold_at IS NULL AND cancelled_at IS NULL')
    .run(now, id).changes === 1
}

export function cancelListing(db: Db, id: string, sellerId: string, now = Date.now()): boolean {
  return db
    .prepare('UPDATE market_listings SET cancelled_at = ? WHERE id = ? AND seller_id = ? AND sold_at IS NULL AND cancelled_at IS NULL')
    .run(now, id, sellerId).changes === 1
}

/* ---------------------------------------------------------------- Tausch */

export interface TradeOffer {
  id: string
  fromId: string
  toId: string
  offeredId: string
  requestedId: string | null
  message: string
  createdAt: number
  expiresAt: number
  acceptedAt: number | null
  declinedAt: number | null
}

interface TradeRow {
  id: string; from_id: string; to_id: string; offered_id: string; requested_id: string | null
  message: string; created_at: number; expires_at: number
  accepted_at: number | null; declined_at: number | null
}

const toTrade = (r: TradeRow): TradeOffer => ({
  id: r.id, fromId: r.from_id, toId: r.to_id, offeredId: r.offered_id, requestedId: r.requested_id,
  message: r.message, createdAt: r.created_at, expiresAt: r.expires_at,
  acceptedAt: r.accepted_at, declinedAt: r.declined_at,
})

export const TRADE_TTL_MS = 3 * 24 * 60 * 60 * 1000

export function createTrade(db: Db, input: Omit<TradeOffer, 'id' | 'acceptedAt' | 'declinedAt'>): TradeOffer {
  const id = newId()
  db.prepare(
    `INSERT INTO trade_offers (id, from_id, to_id, offered_id, requested_id, message, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.fromId, input.toId, input.offeredId, input.requestedId,
    input.message.slice(0, 140), input.createdAt, input.expiresAt)
  return tradeById(db, id)!
}

export function tradeById(db: Db, id: string): TradeOffer | null {
  const row = db.prepare('SELECT * FROM trade_offers WHERE id = ?').get(id) as TradeRow | undefined
  return row ? toTrade(row) : null
}

export function openTradesFor(db: Db, trainerId: string, now = Date.now()): { incoming: TradeOffer[]; outgoing: TradeOffer[] } {
  const filter = 'accepted_at IS NULL AND declined_at IS NULL AND expires_at > ?'
  return {
    incoming: (db.prepare(`SELECT * FROM trade_offers WHERE to_id = ? AND ${filter} ORDER BY created_at DESC`)
      .all(trainerId, now) as TradeRow[]).map(toTrade),
    outgoing: (db.prepare(`SELECT * FROM trade_offers WHERE from_id = ? AND ${filter} ORDER BY created_at DESC`)
      .all(trainerId, now) as TradeRow[]).map(toTrade),
  }
}

export function creatureIdsInOpenTrades(db: Db, trainerId: string, now = Date.now()): Set<string> {
  const rows = db
    .prepare(
      `SELECT offered_id AS id FROM trade_offers
       WHERE from_id = ? AND accepted_at IS NULL AND declined_at IS NULL AND expires_at > ?`,
    )
    .all(trainerId, now) as Array<{ id: string }>
  return new Set(rows.map((r) => r.id))
}

export function acceptTrade(db: Db, id: string, now = Date.now()): boolean {
  return db
    .prepare('UPDATE trade_offers SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL AND declined_at IS NULL AND expires_at > ?')
    .run(now, id, now).changes === 1
}

export function declineTrade(db: Db, id: string, now = Date.now()): boolean {
  return db
    .prepare('UPDATE trade_offers SET declined_at = ? WHERE id = ? AND accepted_at IS NULL AND declined_at IS NULL')
    .run(now, id).changes === 1
}

/* ------------------------------------------------------------- Rangliste */

export interface LeaderboardRow {
  trainerId: string
  displayName: string
  dexCaught: number
  badges: number
  battlesWon: number
  shinies: number
  highestLevel: number
  teamPower: number
  score: number
}

/**
 * Recompute one trainer's standing.
 *
 * Called after anything that could change it. Recomputing from source rather
 * than incrementing counters means a bug in one code path cannot leave a
 * permanently wrong score behind.
 */
export function refreshStats(db: Db, trainerId: string, now = Date.now()): void {
  const dex = db.prepare('SELECT COUNT(*) AS n FROM dex_entries WHERE trainer_id = ? AND caught_at IS NOT NULL')
    .get(trainerId) as { n: number }
  const badges = db.prepare('SELECT COUNT(*) AS n FROM trainer_badges WHERE trainer_id = ?')
    .get(trainerId) as { n: number }
  const wins = db.prepare('SELECT COUNT(*) AS n FROM battles WHERE trainer_id = ? AND winner = 0')
    .get(trainerId) as { n: number }
  const losses = db.prepare('SELECT COUNT(*) AS n FROM battles WHERE trainer_id = ? AND winner = 1')
    .get(trainerId) as { n: number }
  const shinies = db.prepare('SELECT COUNT(*) AS n FROM creatures WHERE owner_id = ? AND shiny = 1')
    .get(trainerId) as { n: number }
  const top = db.prepare('SELECT COALESCE(MAX(level), 0) AS n FROM creatures WHERE owner_id = ?')
    .get(trainerId) as { n: number }
  const team = db.prepare('SELECT COALESCE(SUM(level), 0) AS n FROM creatures WHERE owner_id = ? AND team_slot IS NOT NULL')
    .get(trainerId) as { n: number }

  // Weighted so that collecting, fighting and raising all count, and none of
  // them alone can carry a ranking.
  const score =
    dex.n * 40 + badges.n * 250 + wins.n * 15 + shinies.n * 120 + top.n * 6 + team.n * 3

  db.prepare(
    `INSERT INTO leaderboard_stats
       (trainer_id, dex_caught, badges, battles_won, battles_lost, shinies, highest_level, team_power, score, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(trainer_id) DO UPDATE SET
       dex_caught = excluded.dex_caught, badges = excluded.badges,
       battles_won = excluded.battles_won, battles_lost = excluded.battles_lost,
       shinies = excluded.shinies, highest_level = excluded.highest_level,
       team_power = excluded.team_power, score = excluded.score, updated_at = excluded.updated_at`,
  ).run(trainerId, dex.n, badges.n, wins.n, losses.n, shinies.n, top.n, team.n, score, now)
}

export function leaderboard(db: Db, limit = 50): LeaderboardRow[] {
  return db
    .prepare(
      `SELECT s.trainer_id AS trainerId, t.display_name AS displayName,
              s.dex_caught AS dexCaught, s.badges, s.battles_won AS battlesWon,
              s.shinies, s.highest_level AS highestLevel, s.team_power AS teamPower, s.score
       FROM leaderboard_stats s
       JOIN trainers t ON t.id = s.trainer_id
       WHERE t.hide_leaderboard = 0 AND t.is_banned = 0
       ORDER BY s.score DESC, t.created_at ASC
       LIMIT ?`,
    )
    .all(limit) as LeaderboardRow[]
}

export function rankOf(db: Db, trainerId: string): number | null {
  const row = db
    .prepare(
      `SELECT COUNT(*) + 1 AS rank FROM leaderboard_stats s
       JOIN trainers t ON t.id = s.trainer_id
       WHERE t.hide_leaderboard = 0 AND t.is_banned = 0
         AND s.score > (SELECT score FROM leaderboard_stats WHERE trainer_id = ?)`,
    )
    .get(trainerId) as { rank: number } | undefined
  return row?.rank ?? null
}
