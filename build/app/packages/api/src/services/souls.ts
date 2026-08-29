import { GameError, NATURES, type Trainer } from '@game/shared'
import {
  createRng, produceEgg, randomIvs, SHINY_SOUL_ID, SHINY_SOUL_PER_EGG,
  SOUL_PER_EGG, SOUL_PER_SHINY_EGG,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import * as eggs from '../repos/eggs.js'
import * as expeditions from '../repos/expeditions.js'
import * as battles from '../repos/battles.js'
import { logEvent } from '../repos/events.js'
import { bonuses } from './progression.js'
import { eggSlots } from './breeding.js'

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
 * verdoppeln: zwanzig Feuer-Fragmente brauchen weiterhin zwanzig Pokémon mit
 * Feuer-Anteil.
 */
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

/**
 * Wie viele Pokemon eine Sammelverwertung hoechstens umfasst.
 *
 * Nicht die Box in einem Rutsch: alles laeuft in einer Transaktion, und ein
 * Fehlgriff bei 900 Tieren waere nicht mehr zu ueberblicken — bei fuenfzig
 * schon.
 */
export const SALVAGE_BATCH_LIMIT = 50

export interface BulkSalvageResult {
  count: number
  names: string[]
  fragments: Array<{ itemId: string; typeId: string; name: string; quantity: number }>
}

/**
 * Mehrere auf einmal verwerten.
 *
 * Eine Transaktion fuer alle: entweder gehen sie zusammen oder keines. Wer
 * fuenfzig Haekchen setzt, soll nicht hinterher raten muessen, welche davon
 * durchgekommen sind.
 */
export function salvageMany(
  ctx: AppContext, trainer: Trainer, creatureIds: string[],
): BulkSalvageResult {
  const ids = [...new Set(creatureIds)]
  if (ids.length === 0) throw new GameError('validation_failed', { field: 'creatureIds' })
  if (ids.length > SALVAGE_BATCH_LIMIT) {
    throw new GameError('validation_failed', { field: 'creatureIds', limit: SALVAGE_BATCH_LIMIT })
  }

  return tx(ctx.db, () => {
    if (battles.activeOf(ctx.db, trainer.id)) {
      throw new GameError('invalid_state', { reason: 'battle_in_progress' }, 409)
    }
    /*
     * Erst pruefen, dann zaehlen, dann handeln.
     *
     * Die Reihenfolge ist keine Kosmetik: zaehlte man zuerst, machte eine
     * fremde Id die Auswahl scheinbar zu gross und man bekaeme "letztes
     * Pokemon" zu lesen, wo "gibt es nicht" gemeint ist.
     */
    const busy = expeditions.busyCreatureIds(ctx.db, trainer.id)
    const chosen = ids.map((creatureId) => {
      const c = creatures.byId(ctx.db, creatureId)
      if (!c || c.ownerId !== trainer.id) throw new GameError('not_found', { creatureId }, 404)
      if (busy.has(c.id)) {
        throw new GameError('invalid_state', { reason: 'on_expedition', creatureId }, 409)
      }
      return c
    })

    // Die Grenze gilt fuer die Summe, nicht je Stueck: fuenfzig einzeln
    // erlaubte Verwertungen duerfen die Box nicht gemeinsam leeren.
    if (creatures.countOwned(ctx.db, trainer.id).total - chosen.length < 1) {
      throw new GameError('invalid_state', { reason: 'last_creature' }, 409)
    }

    const names: string[] = []
    const totals = new Map<string, { itemId: string; typeId: string; name: string; quantity: number }>()
    for (const c of chosen) {
      const creatureId = c.id
      const species = ctx.registry.species(c.speciesId)
      for (const typeId of species.types) {
        const item = ctx.registry.tryItem(soulItemId(typeId))
        if (!item) continue
        inventory.grant(ctx.db, trainer.id, item.id, 1)
        totals.set(item.id, {
          itemId: item.id,
          typeId,
          name: ctx.registry.localized(item.name, trainer.locale),
          quantity: inventory.quantityOf(ctx.db, trainer.id, item.id),
        })
      }
      names.push(c.nickname ?? ctx.registry.localized(species.name, trainer.locale))
      creatures.release(ctx.db, c.id, trainer.id)
      logEvent(ctx.db, trainer.id, 'creature.salvaged', {
        creatureId, speciesId: c.speciesId, level: c.level, types: species.types, bulk: ids.length,
      })
    }

    return { count: ids.length, names, fragments: [...totals.values()] }
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
  /** Was ein schillerndes Ei desselben Typs kostet. */
  needShiny: number
  readyShiny: boolean
}

/** Wie viele Schillernde Fragmente jemand hat. */
export function shinySoulsOf(ctx: AppContext, trainer: Trainer): number {
  return inventory.quantityOf(ctx.db, trainer.id, SHINY_SOUL_ID)
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
        needShiny: SOUL_PER_SHINY_EGG,
        readyShiny: have >= SOUL_PER_SHINY_EGG,
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
export function redeem(ctx: AppContext, trainer: Trainer, typeId: string, shiny = false) {
  return tx(ctx.db, () => {
    const item = ctx.registry.tryItem(soulItemId(typeId))
    if (!item) throw new GameError('not_found', { typeId }, 404)

    /*
     * Zwei Waehrungen fuer dasselbe Ei.
     *
     * Schillernde Fragmente haben keinen anderen Verwendungszweck und fallen
     * hoechstens einmal die Woche — wer welche hat, will sie hier ausgeben.
     * Deshalb gehen sie zuerst; die 85 gleichfarbigen bleiben der Weg fuer
     * alle, die keine haben.
     */
    const shinySouls = inventory.quantityOf(ctx.db, trainer.id, SHINY_SOUL_ID)
    const payWithShinySouls = shiny && shinySouls >= SHINY_SOUL_PER_EGG
    const cost = shiny ? SOUL_PER_SHINY_EGG : SOUL_PER_EGG
    if (!payWithShinySouls && inventory.quantityOf(ctx.db, trainer.id, item.id) < cost) {
      throw new GameError('insufficient_items', {
        itemId: item.id, need: cost, needShinySouls: SHINY_SOUL_PER_EGG,
      }, 409)
    }
    const maxEggs = eggSlots(ctx, trainer.id)
    if (eggs.openOf(ctx.db, trainer.id).length >= maxEggs) {
      throw new GameError('invalid_state', { reason: 'too_many_eggs', max: maxEggs }, 409)
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

    if (payWithShinySouls) inventory.consume(ctx.db, trainer.id, SHINY_SOUL_ID, SHINY_SOUL_PER_EGG)
    else inventory.consume(ctx.db, trainer.id, item.id, cost)
    const speedUp = 1 - bonuses(ctx, trainer.id).hatchSpeedBonus / 100
    const created = eggs.create(ctx.db, {
      trainerId: trainer.id,
      speciesId: result.speciesId,
      nature: result.nature,
      ivs: result.ivs,
      // Das teure Ei schluepft garantiert schillernd — dafuer ist es teuer.
      shiny: shiny || result.shiny,
      hatchMinutes: Math.max(5, Math.round(result.hatchMinutes * Math.max(0.4, speedUp))),
      startedAt: Date.now(),
      parentA: null,
      parentB: null,
    })
    logEvent(ctx.db, trainer.id, 'soul.redeemed', { typeId, speciesId: result.speciesId, shiny, cost })
    return created
  })
}

/** Ist diese Art die Entwicklung einer anderen? */
function isEvolution(ctx: AppContext, speciesId: string): boolean {
  return ctx.registry.allSpecies.some((s) => s.evolutions.some((e) => e.to === speciesId))
}
