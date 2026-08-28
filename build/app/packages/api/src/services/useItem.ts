import { GameError, type Trainer } from '@game/shared'
import { computeStats, grantXpTo } from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import * as battles from '../repos/battles.js'
import { logEvent } from '../repos/events.js'
import { capOf } from './travel.js'
import { useJammer } from './safari.js'

/**
 * Gegenstände aus dem Beutel benutzen.
 *
 * Es gab dafür keinen Weg: der Beutel war eine Liste, und Tränke ließen sich
 * nur im Kampf einsetzen. Wer nach einem verlorenen Kampf ein Team mit einem
 * Kraftpunkt hatte, konnte den Trank im Beutel ansehen und sonst nichts.
 *
 * Was hier *nicht* geht, sagt eine eigene Begründung statt einer allgemeinen
 * Absage — ein Lockduft etwa gehört in die Safari, nicht in den Beutel.
 */

export type UseKind = 'heal' | 'revive' | 'cure' | 'xp' | 'jammer'

export interface UseResult {
  kind: UseKind
  itemName: string
  creatureName?: string
  healed?: number
  xpGained?: number
  leveledUp?: boolean
  charges?: number
}

export function useItem(
  ctx: AppContext, trainer: Trainer, itemId: string, creatureId?: string,
): UseResult {
  const item = ctx.registry.tryItem(itemId)
  if (!item) throw new GameError('not_found', { itemId }, 404)
  const name = ctx.registry.localized(item.name, trainer.locale)

  // Der Störsender ist der einzige Schlüsselgegenstand, den man auslöst.
  if (item.category === 'key') {
    if (typeof item.params.rocketCharges !== 'number') {
      throw new GameError('invalid_state', { reason: 'not_usable', itemId }, 409)
    }
    const { charges } = useJammer(ctx, trainer)
    return { kind: 'jammer', itemName: name, charges }
  }

  if (item.category === 'lure') {
    throw new GameError('invalid_state', { reason: 'use_in_safari', itemId }, 409)
  }
  if (item.category !== 'medicine' && item.category !== 'xp') {
    throw new GameError('invalid_state', { reason: 'not_usable', itemId }, 409)
  }

  return tx(ctx.db, () => {
    if (battles.activeOf(ctx.db, trainer.id)) {
      // Im Kampf gibt es den eigenen Weg — dort kostet der Einsatz den Zug.
      throw new GameError('invalid_state', { reason: 'battle_in_progress' }, 409)
    }
    if (!creatureId) throw new GameError('validation_failed', { field: 'creatureId' })
    const c = creatures.byId(ctx.db, creatureId)
    if (!c || c.ownerId !== trainer.id) throw new GameError('not_found', { creatureId }, 404)
    if (inventory.quantityOf(ctx.db, trainer.id, itemId) < 1) {
      throw new GameError('insufficient_items', { itemId }, 409)
    }

    const species = ctx.registry.species(c.speciesId)
    const stats = computeStats(species, c.level, c.ivs, c.evs, c.nature)
    const creatureName = c.nickname ?? ctx.registry.localized(species.name, trainer.locale)
    const p = item.params

    if (item.category === 'xp') {
      const amount = Math.max(1, Math.floor(Number(p.xp ?? 0)))
      if (amount <= 0) throw new GameError('invalid_state', { reason: 'not_usable', itemId }, 409)
      const scaled = Math.max(1, Math.round(amount / (species.xpFactor ?? 1)))
      const result = grantXpTo(species.growthRate, c.xp, c.level, scaled, capOf(ctx, trainer))
      creatures.setXp(ctx.db, c.id, result.totalXp, result.levelAfter)
      inventory.consume(ctx.db, trainer.id, itemId, 1)
      logEvent(ctx.db, trainer.id, 'item.used', { itemId, creatureId, kind: 'xp' })
      return {
        kind: 'xp' as const,
        itemName: name,
        creatureName,
        xpGained: result.totalXp - c.xp,
        leveledUp: result.levelsGained > 0,
      }
    }

    // Medizin. Was nicht passt, wird abgelehnt statt verbraucht: ein Trank auf
    // einem vollen Pokemon ist ein Fehlgriff, kein Verbrauch.
    const revive = typeof p.revive === 'number' ? p.revive : null
    if (revive !== null) {
      if (c.hpCurrent > 0) throw new GameError('invalid_state', { reason: 'not_fainted', creatureId }, 409)
      const hp = Math.max(1, Math.round(stats.hp * revive))
      creatures.setHp(ctx.db, c.id, hp)
      inventory.consume(ctx.db, trainer.id, itemId, 1)
      logEvent(ctx.db, trainer.id, 'item.used', { itemId, creatureId, kind: 'revive' })
      return { kind: 'revive' as const, itemName: name, creatureName, healed: hp }
    }

    if (c.hpCurrent <= 0) throw new GameError('invalid_state', { reason: 'fainted', creatureId }, 409)

    const heal = p.healFull === true ? stats.hp : Math.floor(Number(p.heal ?? 0))
    if (heal > 0) {
      if (c.hpCurrent >= stats.hp) {
        throw new GameError('invalid_state', { reason: 'already_full', creatureId }, 409)
      }
      const after = Math.min(stats.hp, c.hpCurrent + heal)
      creatures.setHp(ctx.db, c.id, after)
      inventory.consume(ctx.db, trainer.id, itemId, 1)
      logEvent(ctx.db, trainer.id, 'item.used', { itemId, creatureId, kind: 'heal' })
      return { kind: 'heal' as const, itemName: name, creatureName, healed: after - c.hpCurrent }
    }

    if (p.cureAll === true || p.energy !== undefined) {
      inventory.consume(ctx.db, trainer.id, itemId, 1)
      logEvent(ctx.db, trainer.id, 'item.used', { itemId, creatureId, kind: 'cure' })
      return { kind: 'cure' as const, itemName: name, creatureName }
    }

    throw new GameError('invalid_state', { reason: 'not_usable', itemId }, 409)
  })
}
