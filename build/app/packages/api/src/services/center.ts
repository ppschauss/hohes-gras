import {
  GameError, NATURES,
  type CenterEvent, type CenterOffer, type CenterState, type CenterVisit, type Trainer,
} from '@game/shared'
import {
  centerCooldown, TRADE_IV_FLOOR, TRADE_MIN_CATCH_RATE, TRADE_OFFER_TTL_MS,
  centerReady, centerReadyAt, computeStats, createRng, deriveSeed, foundGold,
  giftQuantity, giftWeight, itemValue, randomIvs, rollCenterEvent, tradeLevel, xpForLevel,
  type Rng,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as center from '../repos/center.js'
import { bonuses } from './progression.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import * as dex from '../repos/dex.js'
import * as world from '../repos/world.js'
import * as teamsRepo from '../repos/teams.js'
import * as expeditions from '../repos/expeditions.js'
import * as battles from '../repos/battles.js'
import { logEvent } from '../repos/events.js'
import { worldClock } from '../worldClock.js'
import { creatureView } from './views.js'
import { refreshMoves } from './garden.js'
import { syncActiveFromGarden } from './teams.js'
import { bumpMetric } from './progression.js'

/**
 * Poke-Center.
 *
 * Alle 15 Minuten kostenlos das ganze Team heilen — und mit kleiner
 * Wahrscheinlichkeit passiert dabei etwas: ein Geldfund, ein Geschenk oder ein
 * Trainer, der tauschen will. Die Abklingzeit ist der einzige Preis; deshalb
 * kostet der Besuch keine Energie.
 */

/** Namen fuer die Tauschpartner. Reine Farbe, gehoert nicht ins Content-Pack. */
const NPC_NAMES = [
  'Käfersammler Kai', 'Wanderin Nora', 'Angler Bruno', 'Schülerin Lea',
  'Rentner Alfons', 'Zwillinge Mia & Tim', 'Gärtnerin Ida', 'Seemann Ove',
]

/** Kategorien, aus denen ein Geschenk kommen kann. Hintergruende sind
 *  Einmalkaeufe — als Stapelgeschenk waeren sie sinnlos. */
const GIFT_CATEGORIES = new Set(['ball', 'berry', 'medicine', 'material', 'xp', 'stone'])

/** Wie viele Stufen die Schwesternstation von der Abklingzeit abzieht. */
function speedSteps(ctx: AppContext, trainerId: string): number {
  return bonuses(ctx, trainerId).centerSpeedBonus
}

export function state(ctx: AppContext, trainer: Trainer, now = Date.now()): CenterState {
  const lastUsed = center.lastVisit(ctx.db, trainer.id)
  const steps = speedSteps(ctx, trainer.id)
  const team = creatures.teamOf(ctx.db, trainer.id)
  const hurt = team.filter((c) => c.hpCurrent < maxHpOf(ctx, c)).length
  const offer = center.openOf(ctx.db, trainer.id, now)

  return {
    ready: centerReady(lastUsed, now, steps),
    readyAt: centerReadyAt(lastUsed, steps),
    cooldownMs: centerCooldown(steps),
    hurt,
    teamSize: team.length,
    offer: offer ? offerView(ctx, trainer, offer) : null,
  }
}

function maxHpOf(ctx: AppContext, c: ReturnType<typeof creatures.teamOf>[number]): number {
  const species = ctx.registry.species(c.speciesId)
  return computeStats(species, c.level, c.ivs, c.evs, c.nature).hp
}

export function visit(ctx: AppContext, trainer: Trainer, now = Date.now()): CenterVisit {
  return tx(ctx.db, () => {
    // Mitten im Kampf zu heilen waere ein kostenloser Ausweg aus jeder
    // verlorenen Runde.
    if (battles.activeOf(ctx.db, trainer.id)) {
      throw new GameError('invalid_state', { reason: 'battle_in_progress' }, 409)
    }

    const lastUsed = center.lastVisit(ctx.db, trainer.id)
    const steps = speedSteps(ctx, trainer.id)
    if (!centerReady(lastUsed, now, steps)) {
      throw new GameError('invalid_state', {
        reason: 'center_cooldown', readyAt: centerReadyAt(lastUsed, steps),
      }, 409)
    }
    if (!center.markVisited(ctx.db, trainer.id, now, lastUsed)) {
      throw new GameError('invalid_state', {
        reason: 'center_cooldown', readyAt: centerReadyAt(lastUsed, steps),
      }, 409)
    }

    const healed = healTeam(ctx, trainer)
    const rng = createRng(deriveSeed(trainer.id, 'center', String(now)))
    const event = rollEvent(ctx, trainer, rng, now)

    logEvent(ctx.db, trainer.id, 'center.visit', { healed, event: event.kind })
    return { healed, event, state: state(ctx, trainer, now) }
  })
}

/** Volle KP fuer alle im Team. Gibt zurueck, wie viele es noetig hatten. */
function healTeam(ctx: AppContext, trainer: Trainer): number {
  let healed = 0
  for (const c of creatures.teamOf(ctx.db, trainer.id)) {
    const max = maxHpOf(ctx, c)
    if (c.hpCurrent >= max) continue
    creatures.setHp(ctx.db, c.id, max)
    healed++
  }
  return healed
}

function rollEvent(ctx: AppContext, trainer: Trainer, rng: Rng, now: number): CenterEvent {
  switch (rollCenterEvent(rng)) {
    case 'gold': {
      const gold = foundGold(rng, world.badgesOf(ctx.db, trainer.id).size)
      inventory.earnGold(ctx.db, trainer.id, gold)
      logEvent(ctx.db, trainer.id, 'center.gold', { gold })
      return { kind: 'gold', gold }
    }
    case 'gift': {
      const gift = rollGift(ctx, trainer, rng)
      if (!gift) return { kind: 'none' }
      inventory.grant(ctx.db, trainer.id, gift.itemId, gift.quantity)
      logEvent(ctx.db, trainer.id, 'center.gift', { itemId: gift.itemId, quantity: gift.quantity })
      return { kind: 'gift', item: gift }
    }
    case 'trade': {
      const offer = rollTrade(ctx, trainer, rng, now)
      // Ohne passende eigene Art gibt es nichts zu tauschen — dann eben nicht.
      return offer ? { kind: 'trade', offer } : { kind: 'none' }
    }
    default:
      return { kind: 'none' }
  }
}

function rollGift(ctx: AppContext, trainer: Trainer, rng: Rng) {
  const pool = ctx.registry.allItems
    .filter((i) => GIFT_CATEGORIES.has(i.category))
    .map((item) => {
      const value = itemValue(item.price, item.sellPrice)
      return { item, value, weight: giftWeight(value) }
    })
  if (pool.length === 0) return null

  const picked = rng.weighted(pool, (e) => e.weight)
  return {
    itemId: picked.item.id,
    name: ctx.registry.localized(picked.item.name, trainer.locale),
    icon: picked.item.icon,
    quantity: giftQuantity(picked.value),
  }
}

/**
 * Ein Tauschangebot bauen.
 *
 * Gesucht wird eine Art, die der Trainer wirklich besitzt — ein Angebot, das
 * niemand annehmen kann, waere nur eine Enttaeuschung. Angeboten wird
 * bevorzugt etwas, das ihm noch fehlt: das ist der Reiz.
 */
function rollTrade(ctx: AppContext, trainer: Trainer, rng: Rng, now: number): CenterOffer | null {
  const owned = creatures.teamOf(ctx.db, trainer.id).concat(creatures.boxOf(ctx.db, trainer.id, 500))
  const tradable = owned.filter((c) => !expeditions.busyCreatureIds(ctx.db, trainer.id).has(c.id))
  if (tradable.length === 0) return null

  const given = rng.pick(tradable)
  const caught = dex.caughtSpeciesIds(ctx.db, trainer.id)
  const candidates = ctx.registry.obtainableSpecies.filter(
    (s) => s.catchRate >= TRADE_MIN_CATCH_RATE && s.id !== given.speciesId,
  )
  if (candidates.length === 0) return null

  const missing = candidates.filter((s) => !caught.has(s.id))
  const offered = rng.pick(missing.length > 0 ? missing : candidates)

  const row = center.create(ctx.db, {
    trainerId: trainer.id,
    npcName: rng.pick(NPC_NAMES),
    wantedSpeciesId: given.speciesId,
    offeredSpeciesId: offered.id,
    offeredLevel: tradeLevel(given.level, rng),
    offeredShiny: rng.chance(2),
    seed: deriveSeed(trainer.id, 'trade', String(now)),
    createdAt: now,
    expiresAt: now + TRADE_OFFER_TTL_MS,
  })
  logEvent(ctx.db, trainer.id, 'center.trade.offered', {
    wanted: row.wantedSpeciesId, offered: row.offeredSpeciesId,
  })
  return offerView(ctx, trainer, row)
}

function offerView(ctx: AppContext, trainer: Trainer, row: center.CenterOfferRow): CenterOffer {
  const wanted = ctx.registry.species(row.wantedSpeciesId)
  const offered = ctx.registry.species(row.offeredSpeciesId)
  const busy = expeditions.busyCreatureIds(ctx.db, trainer.id)

  const mine = creatures.teamOf(ctx.db, trainer.id)
    .concat(creatures.boxOf(ctx.db, trainer.id, 500))
    .filter((c) => c.speciesId === row.wantedSpeciesId && !busy.has(c.id))

  return {
    id: row.id,
    npcName: row.npcName,
    wanted: {
      speciesId: wanted.id,
      name: ctx.registry.localized(wanted.name, trainer.locale),
      sprite: wanted.sprite,
    },
    offered: {
      speciesId: offered.id,
      name: ctx.registry.localized(offered.name, trainer.locale),
      sprite: row.offeredShiny ? offered.spriteShiny : offered.sprite,
      level: row.offeredLevel,
      shiny: row.offeredShiny,
      types: offered.types.map((t) => {
        const type = ctx.registry.type(t)
        return { id: type.id, name: ctx.registry.localized(type.name, trainer.locale), color: type.color }
      }),
    },
    expiresAt: row.expiresAt,
    candidates: mine.map((c) => ({
      id: c.id,
      displayName: c.nickname ?? ctx.registry.localized(wanted.name, trainer.locale),
      level: c.level,
      sprite: c.shiny ? wanted.spriteShiny : wanted.sprite,
      inTeam: c.teamSlot !== null,
    })),
  }
}

export function acceptTrade(
  ctx: AppContext,
  trainer: Trainer,
  offerId: string,
  creatureId: string,
  now = Date.now(),
) {
  return tx(ctx.db, () => {
    const row = center.byId(ctx.db, offerId)
    if (!row || row.trainerId !== trainer.id) throw new GameError('not_found', { offerId }, 404)
    if (row.resolvedAt !== null) throw new GameError('invalid_state', { reason: 'already_resolved' }, 409)
    if (row.expiresAt <= now) throw new GameError('invalid_state', { reason: 'expired' }, 409)

    const given = creatures.byId(ctx.db, creatureId)
    if (!given) throw new GameError('not_found', { creatureId }, 404)
    if (given.ownerId !== trainer.id) throw new GameError('not_owner', { creatureId }, 403)
    if (given.speciesId !== row.wantedSpeciesId) {
      throw new GameError('invalid_state', { reason: 'wrong_species', wanted: row.wantedSpeciesId }, 409)
    }
    if (expeditions.busyCreatureIds(ctx.db, trainer.id).has(creatureId)) {
      throw new GameError('invalid_state', { reason: 'on_expedition', creatureId }, 409)
    }
    // Das letzte eigene Pokemon herzugeben wuerde den Spielstand blockieren:
    // ohne Team gibt es weder Kampf noch Pflege noch Expedition.
    if (creatures.countOwned(ctx.db, trainer.id).total <= 1) {
      throw new GameError('invalid_state', { reason: 'last_creature' }, 409)
    }
    if (!center.resolve(ctx.db, row.id, true, now)) {
      throw new GameError('invalid_state', { reason: 'already_resolved' }, 409)
    }

    const species = ctx.registry.species(row.offeredSpeciesId)
    const rng = createRng(row.seed)
    // Getauschte Pokemon haben spuerbar bessere Anlagen — das ist der Grund,
    // ein Angebot ueberhaupt anzunehmen.
    const ivs = randomIvs(rng)
    for (const key of Object.keys(ivs) as Array<keyof typeof ivs>) {
      ivs[key] = Math.max(ivs[key], TRADE_IV_FLOOR)
    }
    const nature = rng.pick(NATURES)
    const stats = computeStats(species, row.offeredLevel, ivs, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature)

    const slot = given.teamSlot
    teamsRepo.removeCreature(ctx.db, given.id)
    creatures.release(ctx.db, given.id, trainer.id)

    const created = creatures.insertCreature(ctx.db, {
      ownerId: trainer.id,
      speciesId: species.id,
      level: row.offeredLevel,
      xp: xpForLevel(species.growthRate, row.offeredLevel),
      nature,
      ivs,
      friendship: 70,
      hpCurrent: stats.hp,
      shiny: row.offeredShiny,
      moves: ctx.registry.learnableAt(species.id, row.offeredLevel).slice(0, 4),
      caughtAreaId: null,
      // Der Neue nimmt den Platz des Abgegebenen ein: sonst stuende das Team
      // nach einem Tausch aus dem Gartenteam heraus ploetzlich zu viert da.
      teamSlot: slot,
    })
    refreshMoves(ctx, created.id, species.id, created.level, created.moves)
    syncActiveFromGarden(ctx, trainer.id)

    const newDexEntry = dex.markCaught(ctx.db, trainer.id, species.id)
    bumpMetric(ctx, trainer.id, 'catches')
    logEvent(ctx.db, trainer.id, 'center.trade.accepted', {
      gave: given.speciesId, got: species.id, level: row.offeredLevel,
    })

    return {
      gaveName: given.nickname ?? ctx.registry.localized(ctx.registry.species(given.speciesId).name, trainer.locale),
      received: creatureView(ctx.registry, creatures.byId(ctx.db, created.id)!, trainer.locale, worldClock().timeOfDay),
      newDexEntry,
      state: state(ctx, trainer, now),
    }
  })
}

export function declineTrade(ctx: AppContext, trainer: Trainer, offerId: string, now = Date.now()): CenterState {
  const row = center.byId(ctx.db, offerId)
  if (!row || row.trainerId !== trainer.id) throw new GameError('not_found', { offerId }, 404)
  center.resolve(ctx.db, row.id, false, now)
  logEvent(ctx.db, trainer.id, 'center.trade.declined', { offerId })
  return state(ctx, trainer, now)
}
