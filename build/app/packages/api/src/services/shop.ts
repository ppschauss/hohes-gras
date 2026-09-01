import { GameError, type ShopState, type Trainer } from '@game/shared'
import { von } from './ledger.js'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as inventory from '../repos/inventory.js'
import { logEvent } from '../repos/events.js'

/** Only these categories are sold. Materials and key items exist but are found,
 *  not bought — otherwise expeditions lose their point. */
const SECTIONS: Array<{ category: string; title: string }> = [
  { category: 'ball', title: 'shop.section.balls' },
  { category: 'berry', title: 'shop.section.berries' },
  { category: 'medicine', title: 'shop.section.medicine' },
  { category: 'xp', title: 'shop.section.xp' },
  { category: 'stone', title: 'shop.section.stones' },
  { category: 'lure', title: 'shop.section.lures' },
  // Schluesselgegenstaende: bislang gab es keine kaeuflichen. Der Stoersender
  // ist der erste, und ohne diesen Abschnitt stuende er im Laden nicht.
  { category: 'key', title: 'shop.section.key' },
  { category: 'background', title: 'shop.section.backgrounds' },
]

const ONE_TIME_CATEGORIES = new Set(['background'])

export function shopState(ctx: AppContext, trainer: Trainer): ShopState {
  const bag = inventory.bagOf(ctx.db, trainer.id)
  const gold = inventory.goldOf(ctx.db, trainer.id)

  return {
    gold,
    sections: SECTIONS.map((section) => ({
      category: section.category,
      title: section.title,
      items: ctx.registry.allItems
        .filter((i) => i.category === section.category && i.price !== null)
        .sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
        .map((i) => {
          const owned = bag[i.id] ?? 0
          const oneTime = ONE_TIME_CATEGORIES.has(i.category)
          return {
            id: i.id,
            name: ctx.registry.localized(i.name, trainer.locale),
            description: ctx.registry.localized(i.description, trainer.locale),
            category: i.category,
            price: i.price ?? 0,
            sellPrice: i.sellPrice,
            icon: i.icon,
            owned,
            oneTime,
            alreadyOwned: oneTime && owned > 0,
          }
        }),
    })).filter((s) => s.items.length > 0),
  }
}

export function buy(ctx: AppContext, trainer: Trainer, itemId: string, quantity: number): void {
  const item = ctx.registry.tryItem(itemId)
  if (!item || item.price === null) throw new GameError('not_found', { itemId }, 404)

  const oneTime = ONE_TIME_CATEGORIES.has(item.category)
  const amount = oneTime ? 1 : quantity

  tx(ctx.db, () => {
    if (oneTime && inventory.quantityOf(ctx.db, trainer.id, itemId) > 0) {
      throw new GameError('invalid_state', { reason: 'already_owned', itemId }, 409)
    }
    const cost = item.price! * amount
    // Manche Gegenstaende werden als Packung verkauft: ein Lockduft kostet
    // 50 Gold und reicht fuer fuenf Erkundungen. Der Preis gilt fuer die
    // Packung, im Beutel liegen die einzelnen Anwendungen.
    const perUnit = Math.max(1, Math.floor(Number(item.params.packSize ?? 1)))
    // spendGold refuses rather than going negative, so two concurrent buys
    // cannot both succeed on the same coins.
    inventory.spendGold(ctx.db, trainer.id, cost)
    inventory.grant(ctx.db, trainer.id, itemId, amount * perUnit, von(ctx, 'shop.buy'))
    logEvent(ctx.db, trainer.id, 'shop.buy', { itemId, quantity: amount * perUnit, cost })
  })
}

export function sell(ctx: AppContext, trainer: Trainer, itemId: string, quantity: number): void {
  const item = ctx.registry.tryItem(itemId)
  if (!item) throw new GameError('not_found', { itemId }, 404)
  if (item.sellPrice === null) throw new GameError('invalid_state', { reason: 'not_sellable', itemId }, 409)

  tx(ctx.db, () => {
    inventory.consume(ctx.db, trainer.id, itemId, quantity)
    const revenue = item.sellPrice! * quantity
    inventory.earnGold(ctx.db, trainer.id, revenue, von(ctx, 'shop.sell'))
    logEvent(ctx.db, trainer.id, 'shop.sell', { itemId, quantity, revenue })
  })
}

export function equipBackground(ctx: AppContext, trainer: Trainer, itemId: string): void {
  const item = ctx.registry.tryItem(itemId)
  if (!item || item.category !== 'background') throw new GameError('not_found', { itemId }, 404)
  if (inventory.quantityOf(ctx.db, trainer.id, itemId) < 1) {
    throw new GameError('insufficient_items', { itemId }, 400)
  }
  inventory.setBackground(ctx.db, trainer.id, itemId)
  logEvent(ctx.db, trainer.id, 'garden.background', { itemId })
}
