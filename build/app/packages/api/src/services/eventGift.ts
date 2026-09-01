import { GameError, NATURES, type Trainer } from '@game/shared'
import { von } from './ledger.js'
import { computeStats, createRng, PERFECT_IV, xpForLevel } from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as creatures from '../repos/creatures.js'
import * as dex from '../repos/dex.js'
import * as inventory from '../repos/inventory.js'
import { logEvent } from '../repos/events.js'

/**
 * Ereignis-Wesen von Hand vergeben.
 *
 * Sie stehen in keiner Spawn-Tabelle und lassen sich nicht fangen — der einzige
 * Weg ins Spiel führt über diesen Aufruf. Deshalb liegt er beim Admin und
 * nirgends sonst.
 *
 * Vergeben wird immer schillernd und mit makellosen Werten: ein Geschenk, das
 * man nachwürfeln müsste, wäre keins.
 */
export const EVENT_GIFT_LEVEL = 5

export interface GiftResult {
  creatureId: string
  speciesId: string
  speciesName: string
  trainerName: string
  level: number
}

export function grantEventSpecies(
  ctx: AppContext, admin: Trainer, trainerCode: string, speciesId: string,
): GiftResult {
  const species = ctx.registry.trySpecies(speciesId)
  if (!species) throw new GameError('not_found', { speciesId }, 404)
  if (!species.event) throw new GameError('validation_failed', { field: 'speciesId' })

  const target = ctx.db
    .prepare('SELECT id, display_name AS displayName FROM trainers WHERE trainer_code = ?')
    .get(trainerCode.trim().toUpperCase()) as { id: string; displayName: string } | undefined
  if (!target) throw new GameError('not_found', { trainerCode }, 404)

  return tx(ctx.db, () => {
    const rng = createRng(`event:${target.id}:${speciesId}:${Date.now()}`)
    const ivs = { hp: PERFECT_IV, atk: PERFECT_IV, def: PERFECT_IV, spa: PERFECT_IV, spd: PERFECT_IV, spe: PERFECT_IV }
    const nature = rng.pick(NATURES)
    const evs = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
    const stats = computeStats(species, EVENT_GIFT_LEVEL, ivs, evs, nature)

    const created = creatures.insertCreature(ctx.db, {
      ownerId: target.id,
      speciesId,
      level: EVENT_GIFT_LEVEL,
      xp: xpForLevel(species.growthRate, EVENT_GIFT_LEVEL),
      nature,
      ivs,
      friendship: 120,
      hpCurrent: stats.hp,
      shiny: true,
      // Die vier zuletzt gelernten Attacken auf diesem Level — den Rest holt
      // es sich beim Aufsteigen.
      moves: ctx.registry.learnableAt(speciesId, EVENT_GIFT_LEVEL).slice(0, 4),
      caughtAreaId: null,
      teamSlot: null,
    }, von(ctx, 'admin.gift'))
    dex.markCaught(ctx.db, target.id, speciesId)
    logEvent(ctx.db, target.id, 'event.gift', { speciesId, by: admin.id, creatureId: created.id })

    return {
      creatureId: created.id,
      speciesId,
      speciesName: ctx.registry.localized(species.name, 'de'),
      trainerName: target.displayName,
      level: EVENT_GIFT_LEVEL,
    }
  })
}

export interface ItemGiftResult {
  itemId: string
  itemName: string
  trainerName: string
  quantity: number
  total: number
}

/**
 * Gegenstände von Hand vergeben.
 *
 * Der Gegenstück zu `grantEventSpecies` für alles, was im Beutel liegt:
 * Prüfgegenstände wie der legendäre Lockduft haben keinen Preis und fallen
 * nirgends, es gibt also keinen anderen Weg ins Spiel. Bewusst ohne
 * Obergrenze je Aufruf, aber mit Protokoll — wer 250 Stück verteilt, soll das
 * im `event_log` wiederfinden.
 */
export function grantItem(
  ctx: AppContext, admin: Trainer, trainerCode: string, itemId: string, quantity: number,
): ItemGiftResult {
  const item = ctx.registry.tryItem(itemId)
  if (!item) throw new GameError('not_found', { itemId }, 404)
  const n = Math.floor(quantity)
  if (!Number.isFinite(n) || n <= 0) throw new GameError('validation_failed', { field: 'quantity' })

  const target = ctx.db
    .prepare('SELECT id, display_name AS displayName FROM trainers WHERE trainer_code = ?')
    .get(trainerCode.trim().toUpperCase()) as { id: string; displayName: string } | undefined
  if (!target) throw new GameError('not_found', { trainerCode }, 404)

  return tx(ctx.db, () => {
    inventory.grant(ctx.db, target.id, itemId, n, von(ctx, 'admin.gift'))
    logEvent(ctx.db, target.id, 'admin.item', { itemId, quantity: n, by: admin.id })
    return {
      itemId,
      itemName: ctx.registry.localized(item.name, 'de'),
      trainerName: target.displayName,
      quantity: n,
      total: inventory.quantityOf(ctx.db, target.id, itemId),
    }
  })
}

/** Alle Ereignis-Arten des Packs — für die Auswahl im Bot. */
export function eventSpecies(ctx: AppContext): Array<{ id: string; name: string }> {
  return ctx.registry.allSpecies
    .filter((s) => s.event)
    .map((s) => ({ id: s.id, name: ctx.registry.localized(s.name, 'de') }))
}
