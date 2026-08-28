import { GameError, NATURES, type Trainer } from '@game/shared'
import { createRng, produceEgg, randomIvs } from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import * as eggs from '../repos/eggs.js'
import * as expeditions from '../repos/expeditions.js'
import * as battles from '../repos/battles.js'
import { logEvent } from '../repos/events.js'
import { bonuses } from './progression.js'

/**
 * Verwerten.
 *
 * Eine Box füllt sich mit Pokémon, die man nicht braucht — und wegwerfen ohne
 * Gegenwert tut niemand. Verwerten macht aus ihnen Seelenfragmente ihres Typs,
 * und zehn davon werden zu einem Ei derselben Sorte. Aus dem, was man nicht
 * braucht, wird damit ein Weg zu dem, was man sucht.
 *
 * Ein Pokémon gibt **je ein Fragment pro Typ** — ein Zwei-Typen-Pokémon also
 * zwei verschiedene. Das belohnt Vielfalt in der Box, ohne die Menge zu
 * verdoppeln: zehn Feuer-Fragmente brauchen weiterhin zehn Feuer-Pokémon.
 */
export const SOUL_PER_EGG = 10

export const soulItemId = (typeId: string): string => `soul-${typeId}`

export interface SalvageResult {
  creatureName: string
  fragments: Array<{ itemId: string; typeId: string; name: string; quantity: number }>
}

export function salvage(ctx: AppContext, trainer: Trainer, creatureId: string): SalvageResult {
  return tx(ctx.db, () => {
    const c = creatures.byId(ctx.db, creatureId)
    if (!c || c.ownerId !== trainer.id) throw new GameError('not_found', { creatureId }, 404)

    // Drei Sperren, die alle denselben Grund haben: Verwerten ist endgültig.
    if (battles.activeOf(ctx.db, trainer.id)) {
      throw new GameError('invalid_state', { reason: 'battle_in_progress' }, 409)
    }
    if (expeditions.busyCreatureIds(ctx.db, trainer.id).has(c.id)) {
      throw new GameError('invalid_state', { reason: 'on_expedition', creatureId }, 409)
    }
    if (creatures.countOwned(ctx.db, trainer.id).total <= 1) {
      throw new GameError('invalid_state', { reason: 'last_creature' }, 409)
    }

    const species = ctx.registry.species(c.speciesId)
    const fragments = species.types.map((typeId) => {
      const item = ctx.registry.tryItem(soulItemId(typeId))
      if (!item) return null
      inventory.grant(ctx.db, trainer.id, item.id, 1)
      return {
        itemId: item.id,
        typeId,
        name: ctx.registry.localized(item.name, trainer.locale),
        quantity: inventory.quantityOf(ctx.db, trainer.id, item.id),
      }
    }).filter((f): f is NonNullable<typeof f> => f !== null)

    creatures.release(ctx.db, c.id, trainer.id)
    logEvent(ctx.db, trainer.id, 'creature.salvaged', {
      creatureId, speciesId: c.speciesId, level: c.level, types: species.types,
    })

    return {
      creatureName: c.nickname ?? ctx.registry.localized(species.name, trainer.locale),
      fragments,
    }
  })
}

export interface SoulView {
  typeId: string
  typeName: string
  color: string
  itemId: string
  have: number
  need: number
  ready: boolean
}

export function overview(ctx: AppContext, trainer: Trainer): SoulView[] {
  return ctx.registry.allItems
    .filter((i) => typeof i.params.soulType === 'string')
    .map((item) => {
      const typeId = String(item.params.soulType)
      const type = ctx.registry.tryType(typeId)
      const have = inventory.quantityOf(ctx.db, trainer.id, item.id)
      return {
        typeId,
        typeName: type ? ctx.registry.localized(type.name, trainer.locale) : typeId,
        color: type?.color ?? '#888888',
        itemId: item.id,
        have,
        need: SOUL_PER_EGG,
        ready: have >= SOUL_PER_EGG,
      }
    })
    .filter((s) => s.have > 0)
    .sort((a, b) => b.have - a.have)
}

/**
 * Zehn Fragmente eines Typs gegen ein Ei.
 *
 * Die Art wird unter allen erspielbaren dieses Typs gezogen — auch unter
 * denen, die man noch nie gesehen hat. Das ist der Reiz: ein Ei aus Fragmenten
 * ist die einzige Quelle für Arten, die in keinem erreichbaren Gebiet wohnen.
 */
export function redeem(ctx: AppContext, trainer: Trainer, typeId: string) {
  return tx(ctx.db, () => {
    const item = ctx.registry.tryItem(soulItemId(typeId))
    if (!item) throw new GameError('not_found', { typeId }, 404)
    if (inventory.quantityOf(ctx.db, trainer.id, item.id) < SOUL_PER_EGG) {
      throw new GameError('insufficient_items', { itemId: item.id, need: SOUL_PER_EGG }, 409)
    }
    if (eggs.openOf(ctx.db, trainer.id).length >= eggs.MAX_OPEN_EGGS) {
      throw new GameError('invalid_state', { reason: 'too_many_eggs', max: eggs.MAX_OPEN_EGGS }, 409)
    }

    // Nur Grundformen: ein Ei, aus dem eine Entwicklungsstufe schluepft, waere
    // eine Abkuerzung um das ganze Aufziehen herum.
    const pool = ctx.registry.obtainableSpecies.filter(
      (s) => s.types.includes(typeId) && !isEvolution(ctx, s.id),
    )
    if (pool.length === 0) throw new GameError('content_unavailable', { typeId }, 409)

    const rng = createRng(`soul:${trainer.id}:${typeId}:${Date.now()}`)
    const species = rng.pick(pool)
    const ivs = randomIvs(rng)
    const result = produceEgg(
      { speciesId: species.id, ivs, nature: rng.pick(NATURES), shiny: false },
      { speciesId: species.id, ivs, nature: rng.pick(NATURES), shiny: false },
      species, rng,
    )

    inventory.consume(ctx.db, trainer.id, item.id, SOUL_PER_EGG)
    const speedUp = 1 - bonuses(ctx, trainer.id).hatchSpeedBonus / 100
    const created = eggs.create(ctx.db, {
      trainerId: trainer.id,
      speciesId: result.speciesId,
      nature: result.nature,
      ivs: result.ivs,
      shiny: result.shiny,
      hatchMinutes: Math.max(5, Math.round(result.hatchMinutes * Math.max(0.4, speedUp))),
      startedAt: Date.now(),
      parentA: null,
      parentB: null,
    })
    logEvent(ctx.db, trainer.id, 'soul.redeemed', { typeId, speciesId: result.speciesId })
    return created
  })
}

/** Ist diese Art die Entwicklung einer anderen? */
function isEvolution(ctx: AppContext, speciesId: string): boolean {
  return ctx.registry.allSpecies.some((s) => s.evolutions.some((e) => e.to === speciesId))
}
