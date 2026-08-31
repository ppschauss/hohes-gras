import { CARE_ACTIONS, GameError, type CareAction, type GardenState, type Trainer } from '@game/shared'
import {
  applyCare, CARE_RULES, ENERGY_COSTS, ENERGY_MAX, ENERGY_REGEN_BOX_PER_HOUR,
  TEAM_CAPACITY as CAPACITY, randomIvs, energyTick, ENERGY_REGEN_PER_HOUR,
  computeStats, createRng, xpForLevel, type CareCreature,
} from '@game/engine'
import { NATURES } from '@game/shared'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import * as regionEntries from '../repos/regions.js'
import * as dex from '../repos/dex.js'
import { bumpCounter, counterValue } from '../repos/counters.js'
import * as energy from './energy.js'
import * as teams from './teams.js'
import { assertPace, recordPace } from './pacing.js'
import { capOf } from './travel.js'
import { logEvent } from '../repos/events.js'
import { worldClock } from '../worldClock.js'
import { creatureView } from './views.js'
import { awardSeasonPoints, bonuses, bumpMetric } from './progression.js'
import { busyReasons } from './busy.js'

export const TEAM_CAPACITY = CAPACITY
/** Attackenplaetze je Kreatur. */
export const MOVE_SLOTS = 4
const CARE_COUNTER = 'care'

/** What a brand-new trainer starts with. Enough to play for an evening without
 *  the shop, not enough to skip it. */
/**
 * Das Startpaket.
 *
 * Seit man Gegenstände auch mitten im Kampf einsetzen kann, gehören Medizin
 * und Beleber dazu: ein Kampf, in dem man nur zusehen kann, wie das Team
 * fällt, ist kein Kampf, sondern ein Countdown. Die Mengen reichen für die
 * ersten Gebiete, nicht für die Liga.
 */
const STARTER_KIT: Array<{ itemId: string; quantity: number }> = [
  { itemId: 'poke-ball', quantity: 10 },
  { itemId: 'oran-berry', quantity: 8 },
  { itemId: 'razz-berry', quantity: 3 },
  { itemId: 'potion', quantity: 5 },
  { itemId: 'super-potion', quantity: 2 },
  { itemId: 'revive', quantity: 1 },
  { itemId: 'full-heal', quantity: 1 },
  { itemId: 'bg-classic', quantity: 1 },
]

/** Was jedes bestehende Konto einmalig nachgereicht bekommt. */
export const CATCHUP_KIT: Array<{ itemId: string; quantity: number }> = [
  { itemId: 'potion', quantity: 5 },
  { itemId: 'super-potion', quantity: 3 },
  { itemId: 'revive', quantity: 2 },
  { itemId: 'full-heal', quantity: 2 },
]

const STARTER_LEVEL = 5

export function gardenState(ctx: AppContext, trainer: Trainer): GardenState {
  const clock = worldClock()
  const team = creatures.teamOf(ctx.db, trainer.id)
  const bag = inventory.bagOf(ctx.db, trainer.id)
  // Der Tageszaehler ist nur noch Statistik: begrenzt wird ueber Energie.
  const usedToday = counterValue(ctx.db, trainer.id, CARE_COUNTER)
  const energyState = energy.state(ctx, trainer.id)
  const counts = creatures.countOwned(ctx.db, trainer.id)
  const dexNumbers = dex.dexCounts(ctx.db, trainer.id)

  const background = ctx.registry.tryItem(trainer.gardenBackground)
  const cap = capOf(ctx, trainer)
  // Wer gebunden ist, steht weiter im Team — er kaempft nur nicht mit. Das
  // muss man sehen koennen; siehe `busy.ts`.
  const reasons = busyReasons(ctx, trainer.id)
  const views = team.map(
    (c) => creatureView(ctx.registry, c, trainer.locale, clock.timeOfDay, cap, reasons.get(c.id) ?? null),
  )

  return {
    team: views,
    teamCapacity: TEAM_CAPACITY,
    boxCount: counts.total - counts.inTeam,
    background: {
      id: trainer.gardenBackground,
      name: background ? ctx.registry.localized(background.name, trainer.locale) : 'Klassisch',
    },
    energy: energyState,
    care: {
      usedToday,
      energyCost: ENERGY_COSTS.care,
      actions: CARE_ACTIONS.map((action) => {
        const rules = CARE_RULES[action]
        const have = rules.costItemId ? (bag[rules.costItemId] ?? 0) : 0
        return {
          action,
          ...availability(action, team, have, energyState.current),
          costItemId: rules.costItemId,
          costQuantity: rules.costQuantity,
          have,
        }
      }),
    },
    dex: { seen: dexNumbers.seen, caught: dexNumbers.caught, total: ctx.registry.speciesCount },
  }
}

/** Mirrors the engine's refusals so the UI can grey a button out *and* say why,
 *  instead of letting the player discover the rule by being rejected. */
function availability(
  action: CareAction,
  team: Array<{ energy: number }>,
  have: number,
  trainerEnergy: number,
): { available: boolean; blockedReason: string | null } {
  const rules = CARE_RULES[action]
  if (team.length === 0) return { available: false, blockedReason: 'care.blocked.emptyTeam' }
  if (trainerEnergy < ENERGY_COSTS.care) return { available: false, blockedReason: 'care.blocked.noEnergy' }
  if (rules.costItemId && have < rules.costQuantity) return { available: false, blockedReason: 'care.blocked.needsItem' }
  if (rules.energy < 0 && team.some((c) => c.energy + rules.energy < 0)) {
    return { available: false, blockedReason: 'care.blocked.tooTired' }
  }
  return { available: true, blockedReason: null }
}

export interface CareGain {
  creatureId: string
  displayName: string
  xpGained: number
  leveledUp: boolean
  newLevel: number
  friendshipGained: number
}

export function performCare(ctx: AppContext, trainer: Trainer, action: CareAction): CareGain[] {
  // Hundert Pflegeaktionen je Viertelstunde, kein maschineller Takt. Steht
  // bewusst *vor* der Transaktion: ein abgewiesener Versuch soll weder Energie
  // noch Beeren kosten — und die Zwangspause, die die Pruefung dabei setzt,
  // muss den Abbruch ueberleben.
  assertPace(ctx, trainer, 'care')
  return tx(ctx.db, () => {

    const team = creatures.teamOf(ctx.db, trainer.id)
    const rules = CARE_RULES[action]
    const have = rules.costItemId ? inventory.quantityOf(ctx.db, trainer.id, rules.costItemId) : 0

    const careTeam: CareCreature[] = team.map((c) => ({
      id: c.id, speciesId: c.speciesId, xp: c.xp,
      friendship: c.friendship, energy: c.energy, level: c.level,
    }))

    const perks = bonuses(ctx, trainer.id)
    const result = applyCare(
      action, careTeam, (id) => ctx.registry.species(id), have, perks.careXpBonus,
      capOf(ctx, trainer),
    )
    if (!result.ok) throw refusalToError(result)

    // Energie erst abbuchen, wenn die Aktion tatsaechlich zustande kommt —
    // eine abgelehnte Pflege darf nichts kosten.
    energy.spendFor(ctx, trainer.id, 'care')
    // Zaehlt fuers Wochenziel der Gilde: eine Aktion, nicht ein Pokemon.
    bumpMetric(ctx, trainer.id, 'careActions')

    if (result.consumed) {
      inventory.consume(ctx.db, trainer.id, result.consumed.itemId, result.consumed.quantity)
    }
    creatures.applyCareResult(
      ctx.db,
      result.results.map((r) => ({
        creatureId: r.creatureId,
        xp: r.xp.totalXp,
        level: r.xp.levelAfter,
        friendship: r.friendshipAfter,
        energy: r.energyAfter,
      })),
    )
    // Levelling up raises max HP; without this a creature that levels while at
    // full health would look damaged.
    for (const r of result.results) {
      if (!r.leveledUp) continue
      const c = team.find((t) => t.id === r.creatureId)!
      const species = ctx.registry.species(c.speciesId)
      const stats = computeStats(species, r.xp.levelAfter, c.ivs, c.evs, c.nature)
      const before = computeStats(species, r.xp.levelBefore, c.ivs, c.evs, c.nature)
      creatures.setHp(ctx.db, c.id, Math.min(stats.hp, c.hpCurrent + (stats.hp - before.hp)))
      refreshMoves(ctx, c.id, c.speciesId, r.xp.levelAfter, c.moves)
    }

    bumpCounter(ctx.db, trainer.id, CARE_COUNTER)
    recordPace(ctx, trainer, 'care')
    awardSeasonPoints(ctx, trainer.id, 'careAction')
    logEvent(ctx.db, trainer.id, 'garden.care', { action, members: result.results.length })

    const byId = new Map(team.map((c) => [c.id, c]))
    return result.results.map((r) => {
      const c = byId.get(r.creatureId)!
      const species = ctx.registry.species(c.speciesId)
      return {
        creatureId: r.creatureId,
        displayName: c.nickname ?? ctx.registry.localized(species.name, trainer.locale),
        xpGained: r.xpGained,
        leveledUp: r.leveledUp,
        newLevel: r.xp.levelAfter,
        friendshipGained: r.friendshipAfter - r.friendshipBefore,
      }
    })
  })
}

function refusalToError(r: { reason: string; [k: string]: unknown }): GameError {
  switch (r.reason) {
    case 'needs_item': return new GameError('insufficient_items', { itemId: r.itemId, required: r.quantity })
    case 'empty_team': return new GameError('invalid_state', { reason: 'empty_team' }, 409)
    case 'too_tired': return new GameError('invalid_state', { reason: 'too_tired', creatureId: r.creatureId }, 409)
    default: return new GameError('invalid_state', { reason: r.reason }, 409)
  }
}

/**
 * Frisch freigeschaltete Attacken nachtragen — aber nur in leere Plaetze.
 *
 * Frueher setzte diese Funktion immer die vier zuletzt erlernbaren Attacken und
 * warf alles aeltere heraus. Seit die Attacken von Hand waehlbar sind, waere das
 * fatal: jede Auswahl waere beim naechsten Levelaufstieg wieder weg. Ein volles
 * Set bleibt deshalb unangetastet, und wer eine neue Attacke will, tauscht sie
 * bewusst ein.
 */
export function refreshMoves(ctx: AppContext, creatureId: string, speciesId: string, level: number, current: string[]): void {
  if (current.length >= MOVE_SLOTS) return
  const learnable = ctx.registry.learnableAt(speciesId, level)
  const next = [...new Set([...current, ...learnable])].slice(0, MOVE_SLOTS)
  if (next.length !== current.length || next.some((m, i) => m !== current[i])) {
    creatures.setMoves(ctx.db, creatureId, next)
  }
}

/**
 * Die waehlbaren Startregionen.
 *
 * Jede Region, deren erstes Gebiet ohne Vorbedingung offen steht. Das ist
 * keine gepflegte Liste, sondern faellt aus dem Content-Pack: eine neue Region
 * mit freiem Einstieg taucht hier automatisch auf.
 */
export function startRegions(ctx: AppContext, trainer: Trainer) {
  return ctx.registry.allRegions.flatMap((region) => {
    const first = ctx.registry.allAreas
      .filter((a) => a.regionId === region.id)
      .sort((a, b) => a.order - b.order)[0]
    if (!first || first.unlock.previousAreaId !== null || first.unlock.requiredBadgeIds.length > 0) {
      return []
    }
    const starters = region.starterSpeciesIds.length > 0
      ? region.starterSpeciesIds
      : ctx.registry.manifest.starterSpeciesIds
    return [{
      regionId: region.id,
      name: ctx.registry.localized(region.name, trainer.locale),
      tagline: ctx.registry.localized(region.tagline, trainer.locale),
      areaId: first.id,
      areaName: ctx.registry.localized(first.name, trainer.locale),
      areaCount: ctx.registry.allAreas.filter((a) => a.regionId === region.id).length,
      starters: starters.map((id) => {
        const sp = ctx.registry.species(id)
        return { speciesId: id, name: ctx.registry.localized(sp.name, trainer.locale), sprite: sp.sprite }
      }),
    }]
  })
}

/**
 * Die Starter einer Region — oder die des Packs, wenn sie keine eigenen hat.
 *
 * Ohne Region ist die Antwort die Vereinigung aller wählbaren Startregionen:
 * so sieht man auf dem ersten Bildschirm, was überhaupt zur Wahl steht.
 */
export function starterSpeciesFor(ctx: AppContext, trainer: Trainer, regionId?: string): string[] {
  const fallback = ctx.registry.manifest.starterSpeciesIds
  if (regionId) {
    const own = ctx.registry.allRegions.find((r) => r.id === regionId)?.starterSpeciesIds ?? []
    return own.length > 0 ? own : fallback
  }
  const all = startRegions(ctx, trainer).flatMap((r) => {
    const own = ctx.registry.allRegions.find((x) => x.id === r.regionId)?.starterSpeciesIds ?? []
    return own.length > 0 ? own : fallback
  })
  return all.length > 0 ? [...new Set(all)] : fallback
}

export function starterOptions(ctx: AppContext, trainer: Trainer, regionId?: string) {
  return starterSpeciesFor(ctx, trainer, regionId).map((id) => {
    const s = ctx.registry.species(id)
    return {
      speciesId: id,
      name: ctx.registry.localized(s.name, trainer.locale),
      sprite: s.sprite,
      types: s.types.map((t) => {
        const type = ctx.registry.type(t)
        return { id: type.id, name: ctx.registry.localized(type.name, trainer.locale), color: type.color }
      }),
      description: ctx.registry.localized(s.description, trainer.locale),
      baseStats: s.baseStats,
    }
  })
}

export function chooseStarter(
  ctx: AppContext, trainer: Trainer, speciesId: string, regionId?: string,
): void {
  const regions = startRegions(ctx, trainer)
  const start = regionId
    ? regions.find((r) => r.regionId === regionId)
    : regions[0]
  if (!start) throw new GameError('validation_failed', { field: 'regionId' })
  // Erst die Region, dann der Starter: welche Arten zur Wahl stehen, haengt
  // daran, wo man aufwacht.
  if (!starterSpeciesFor(ctx, trainer, start.regionId).includes(speciesId)) {
    throw new GameError('validation_failed', { field: 'speciesId' })
  }
  tx(ctx.db, () => {
    // Re-check inside the transaction: two taps on a slow connection must not
    // produce two starters.
    if (creatures.countOwned(ctx.db, trainer.id).total > 0) {
      throw new GameError('invalid_state', { reason: 'already_started' }, 409)
    }

    const species = ctx.registry.species(speciesId)
    const rng = createRng(`starter:${trainer.id}`)
    const ivs = randomIvs(rng)
    const nature = rng.pick(NATURES)
    const stats = computeStats(species, STARTER_LEVEL, ivs, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature)

    const created = creatures.insertCreature(ctx.db, {
      ownerId: trainer.id,
      speciesId,
      level: STARTER_LEVEL,
      xp: 0,
      nature,
      ivs,
      // Starters begin already attached; they are a gift, not a capture.
      friendship: 120,
      hpCurrent: stats.hp,
      shiny: rng.chance(0.5),
      moves: ctx.registry.learnableAt(speciesId, STARTER_LEVEL).slice(0, 4),
      // Kein Fangort: der Starter ist ein Geschenk. Wuerde er als Fang im
      // Startgebiet zaehlen, waere die erste Freischaltbedingung der Weltkarte
      // schon vor dem ersten Wurf teilweise erfuellt.
      caughtAreaId: null,
      teamSlot: 0,
    })
    // XP must match the level, or the next XP gain would snap it back to 1.
    ctx.db.prepare('UPDATE creatures SET xp = ? WHERE id = ?')
      .run(xpFloorForLevel(ctx, speciesId, STARTER_LEVEL), created.id)

    // Startgebiet setzen: die gewaehlte Region ist der Ort, an dem alles
    // beginnt.
    ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run(start.areaId, trainer.id)
    // Die Startregion empfaengt einen auf Starterniveau — festgeschrieben,
    // bevor das erste Level dazukommt.
    regionEntries.recordEntry(ctx.db, trainer.id, start.regionId, STARTER_LEVEL)

    for (const kit of STARTER_KIT) inventory.grant(ctx.db, trainer.id, kit.itemId, kit.quantity)
    dex.markCaught(ctx.db, trainer.id, speciesId)
    teams.syncActiveFromGarden(ctx, trainer.id)
    bumpMetric(ctx, trainer.id, 'catches')
    logEvent(ctx.db, trainer.id, 'starter.chosen', { speciesId, shiny: created.shiny })
  })
}

function xpFloorForLevel(ctx: AppContext, speciesId: string, level: number): number {
  return xpForLevel(ctx.registry.species(speciesId).growthRate, level)
}

/**
 * Erholung nachziehen — Team und Box.
 *
 * Wird überall aufgerufen, wo die Ausdauer einer Kreatur zählt: im Garten, in
 * der Expeditionsübersicht und beim Start einer Expedition. Nicht in der
 * Auth-Schicht, obwohl das lückenlos wäre — eine ausgebaute Box fasst über
 * tausend Kreaturen, und bei 100/h wäre fast jede Anfrage ein Massen-Update.
 *
 * Die Uhren stehen an jedem Trainer und rücken nur um die gewährten Punkte
 * vor. Vorher hing beides an `last_seen_at`, den *jede* Anfrage neu setzt:
 * wer alle fünf Minuten hereinsah, bekam nie etwas. In einem echten Spielstand
 * standen 40 von 100 eingelagerten Pokémon seit Tagen auf demselben Wert.
 */
export function catchUpEnergy(ctx: AppContext, trainer: Trainer, now = Date.now()): void {
  const row = ctx.db
    .prepare('SELECT box_energy_at AS box, team_energy_at AS team FROM trainers WHERE id = ?')
    .get(trainer.id) as { box: number; team: number } | undefined
  if (!row) return

  const box = energyTick(row.box, now, ENERGY_REGEN_BOX_PER_HOUR)
  if (box.gain > 0) {
    creatures.regenerateBoxEnergy(ctx.db, trainer.id, box.gain, ENERGY_MAX)
  }

  const team = energyTick(row.team, now, ENERGY_REGEN_PER_HOUR)
  if (team.gain > 0) {
    for (const c of creatures.teamOf(ctx.db, trainer.id)) {
      const next = Math.min(ENERGY_MAX, c.energy + team.gain)
      if (next !== c.energy) {
        ctx.db.prepare('UPDATE creatures SET energy = ? WHERE id = ?').run(next, c.id)
      }
    }
  }

  // Auch dann schreiben, wenn nichts gewährt wurde: eine Uhr, die noch nie
  // lief (0), muss anfangen zu laufen.
  ctx.db.prepare('UPDATE trainers SET box_energy_at = ?, team_energy_at = ? WHERE id = ?')
    .run(box.nextAt, team.nextAt, trainer.id)
}
