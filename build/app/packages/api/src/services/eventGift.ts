import { GameError, NATURES, type Trainer } from '@game/shared'
import { computeStats, createRng, PERFECT_IV, xpForLevel } from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as creatures from '../repos/creatures.js'
import * as dex from '../repos/dex.js'
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
    })
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

/** Alle Ereignis-Arten des Packs — für die Auswahl im Bot. */
export function eventSpecies(ctx: AppContext): Array<{ id: string; name: string }> {
  return ctx.registry.allSpecies
    .filter((s) => s.event)
    .map((s) => ({ id: s.id, name: ctx.registry.localized(s.name, 'de') }))
}
