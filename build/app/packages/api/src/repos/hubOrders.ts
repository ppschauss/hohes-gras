import type { Db } from '../db/index.js'

export type LocalOrderStatus = 'paid' | 'ordered' | 'holding' | 'done' | 'refunded'

export interface LocalOrder {
  id: string
  role: 'buyer' | 'seller'
  listingId: string
  trainerId: string
  price: number
  status: LocalOrderStatus
  payload: string | null
  reason: string | null
  createdAt: number
  updatedAt: number
}

const aus = (r: Record<string, unknown>): LocalOrder => ({
  id: String(r.id),
  role: r.role as LocalOrder['role'],
  listingId: String(r.listing_id),
  trainerId: String(r.trainer_id),
  price: Number(r.price),
  status: r.status as LocalOrderStatus,
  payload: (r.payload as string | null) ?? null,
  reason: (r.reason as string | null) ?? null,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
})

export function put(db: Db, o: Omit<LocalOrder, 'createdAt' | 'updatedAt'>, now = Date.now()): void {
  db.prepare(
    `INSERT INTO hub_orders (id, role, listing_id, trainer_id, price, status, payload, reason, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status, payload = excluded.payload,
       reason = excluded.reason, updated_at = excluded.updated_at`,
  ).run(o.id, o.role, o.listingId, o.trainerId, o.price, o.status, o.payload, o.reason, now, now)
}

export function byId(db: Db, id: string): LocalOrder | null {
  const r = db.prepare('SELECT * FROM hub_orders WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return r ? aus(r) : null
}

export function byListing(db: Db, listingId: string): LocalOrder | null {
  const r = db.prepare('SELECT * FROM hub_orders WHERE listing_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(listingId) as Record<string, unknown> | undefined
  return r ? aus(r) : null
}

export function withStatus(db: Db, status: LocalOrderStatus): LocalOrder[] {
  return (db.prepare('SELECT * FROM hub_orders WHERE status = ? ORDER BY created_at ASC')
    .all(status) as Array<Record<string, unknown>>).map(aus)
}

/** Die Kennung umschreiben, sobald der Verbund seine vergeben hat. */
export function rename(db: Db, alt: string, neu: string, status: LocalOrderStatus, now = Date.now()): void {
  db.prepare('UPDATE hub_orders SET id = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(neu, status, now, alt)
}

export function setStatus(db: Db, id: string, status: LocalOrderStatus, reason?: string, now = Date.now()): void {
  db.prepare('UPDATE hub_orders SET status = ?, reason = COALESCE(?, reason), updated_at = ? WHERE id = ?')
    .run(status, reason ?? null, now, id)
}
