import { GameError } from '@game/shared'
import type { Db } from '../db/index.js'

export type Bag = Record<string, number>

export function bagOf(db: Db, trainerId: string): Bag {
  const rows = db
    .prepare('SELECT item_id AS id, quantity FROM inventory WHERE trainer_id = ? AND quantity > 0')
    .all(trainerId) as Array<{ id: string; quantity: number }>
  return Object.fromEntries(rows.map((r) => [r.id, r.quantity]))
}

export function quantityOf(db: Db, trainerId: string, itemId: string): number {
  const row = db
    .prepare('SELECT quantity FROM inventory WHERE trainer_id = ? AND item_id = ?')
    .get(trainerId, itemId) as { quantity: number } | undefined
  return row?.quantity ?? 0
}

export function grant(db: Db, trainerId: string, itemId: string, amount: number): void {
  if (amount <= 0) return
  db.prepare(
    `INSERT INTO inventory (trainer_id, item_id, quantity) VALUES (?, ?, ?)
     ON CONFLICT(trainer_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity`,
  ).run(trainerId, itemId, Math.floor(amount))
}

/**
 * Remove items, refusing rather than going negative.
 *
 * The `quantity >= ?` in the WHERE clause is what makes this safe under
 * concurrent requests: two simultaneous purchases cannot both succeed on the
 * same last item, because the second UPDATE matches no row.
 */
export function consume(db: Db, trainerId: string, itemId: string, amount: number): void {
  if (amount <= 0) return
  const changed = db
    .prepare('UPDATE inventory SET quantity = quantity - ? WHERE trainer_id = ? AND item_id = ? AND quantity >= ?')
    .run(Math.floor(amount), trainerId, itemId, Math.floor(amount)).changes
  if (changed !== 1) {
    throw new GameError('insufficient_items', { itemId, required: amount, have: quantityOf(db, trainerId, itemId) })
  }
}

export function spendGold(db: Db, trainerId: string, amount: number): void {
  if (amount <= 0) return
  const changed = db
    .prepare('UPDATE trainers SET gold = gold - ? WHERE id = ? AND gold >= ?')
    .run(Math.floor(amount), trainerId, Math.floor(amount)).changes
  if (changed !== 1) throw new GameError('insufficient_funds', { required: amount })
}

export function earnGold(db: Db, trainerId: string, amount: number): void {
  if (amount <= 0) return
  db.prepare('UPDATE trainers SET gold = gold + ? WHERE id = ?').run(Math.floor(amount), trainerId)
}

export function goldOf(db: Db, trainerId: string): number {
  return (db.prepare('SELECT gold FROM trainers WHERE id = ?').get(trainerId) as { gold: number } | undefined)?.gold ?? 0
}

export function setBackground(db: Db, trainerId: string, itemId: string): void {
  db.prepare('UPDATE trainers SET garden_background = ? WHERE id = ?').run(itemId, trainerId)
}
