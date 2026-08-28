import { GameError, NATURES, type Trainer } from '@game/shared'
import {
  attemptCatch, catchProbability, catchReward, computeStats, createRng, deriveSeed,
  ENERGY_REWARDS, LEGENDARY_CATCH_RATE, LEGENDARY_LEVEL_BONUS, randomIvs, rollEncounter,
  isEventTrainer, LEGENDARY_BERRY_ID, LEGENDARY_MAX_BERRIES, isLegendaryCatchRate,
  legendaryCatchChance, rollEvent, rollLegendary, xpForLevel, type Rng,
  MAX_CALM_STACKS, MAX_WEAKEN_STACKS, type CatchModifiers,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as encounters from '../repos/encounters.js'
import * as world from '../repos/world.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import * as dex from '../repos/dex.js'
import { bumpCounter, counterValue } from '../repos/counters.js'
import * as energy from './energy.js'
import * as teams from './teams.js'
import { assertPace, recordPace } from './pacing.js'
import { areaOffset } from './scaling.js'
import { clearedRegions } from './league.js'
import { logEvent } from '../repos/events.js'
import { worldClock } from '../worldClock.js'
import { requireCurrentArea } from './world.js'
import { creatureView } from './views.js'
import { awardSeasonPoints, bonuses, bumpMetric } from './progression.js'

/**
 * Erkundungen sind unbegrenzt.
 *
 * Frueher gab es ein Tageskontingent und danach eine Goldgebuehr. Beides ist
 * weg: eine Begegnung kostet Trainer-Energie, sonst nichts. Der Zaehler bleibt,
 * weil er in den Seed jeder Begegnung eingeht und die Statistik traegt.
 */
export const EXPLORE_COUNTER = 'explore'

export const BOX_LIMIT = 300

export interface EncounterView {
  active: boolean
  areaId: string
  areaName: string
  speciesId: string
  speciesName: string
  sprite: string
  types: Array<{ id: string; name: string; color: string }>
  level: number
  shiny: boolean
  rarity: string
  turn: number
  weakenStacks: number
  calmStacks: number
  maxWeaken: number
  maxCalm: number
  /** Catch chance with the currently selected ball and berry, 0..1. */
  probability: number
  chain: number
  /** Ein Legendaeres folgt eigenen Fangregeln. */
  legendary: boolean
  legendaryBerries: number
  maxLegendaryBerries: number
  /** Wie viele Sagenbeeren im Beutel liegen. */
  berriesOwned: number
}

export function encounterView(
  ctx: AppContext,
  trainer: Trainer,
  e: encounters.ActiveEncounter,
  ballId: string,
  berryId: string | null,
): EncounterView {
  const species = ctx.registry.species(e.speciesId)
  const area = ctx.registry.area(e.areaId)
  const legendary = isLegendaryCatchRate(species.catchRate)
  const mods = buildModifiers(ctx, trainer, e, ballId, berryId)
  return {
    active: true,
    areaId: e.areaId,
    areaName: ctx.registry.localized(area.name, trainer.locale),
    speciesId: e.speciesId,
    speciesName: ctx.registry.localized(species.name, trainer.locale),
    sprite: e.shiny ? species.spriteShiny : species.sprite,
    types: species.types.map((id) => {
      const t = ctx.registry.type(id)
      return { id: t.id, name: ctx.registry.localized(t.name, trainer.locale), color: t.color }
    }),
    level: e.level,
    shiny: e.shiny,
    rarity: species.rarity,
    turn: e.turn,
    weakenStacks: e.weakenStacks,
    calmStacks: e.calmStacks,
    maxWeaken: MAX_WEAKEN_STACKS,
    maxCalm: MAX_CALM_STACKS,
    probability: legendary
      ? legendaryCatchChance(e.legendaryBerries)
      : catchProbability(species, e.level, mods),
    chain: world.chainOf(ctx.db, trainer.id, e.speciesId),
    legendary,
    legendaryBerries: e.legendaryBerries,
    maxLegendaryBerries: LEGENDARY_MAX_BERRIES,
    berriesOwned: inventory.quantityOf(ctx.db, trainer.id, LEGENDARY_BERRY_ID),
  }
}

function buildModifiers(
  ctx: AppContext,
  trainer: Trainer,
  e: encounters.ActiveEncounter,
  ballId: string,
  berryId: string | null,
): CatchModifiers {
  const ball = ctx.registry.tryItem(ballId)
  if (!ball || ball.category !== 'ball') throw new GameError('validation_failed', { field: 'ballId' })
  // tryItem liefert undefined, CatchModifiers erwartet null — der Unterschied
  // ist hier nicht bedeutungstragend, also einmal sauber umwandeln.
  const berry = berryId ? (ctx.registry.tryItem(berryId) ?? null) : null
  if (berryId && (!berry || berry.category !== 'berry')) {
    throw new GameError('validation_failed', { field: 'berryId' })
  }
  // Das Labor zaehlt wie zusaetzliche Orden: derselbe kleine, spuerbare
  // Dauerbonus, statt eine weitere Zahl in die Fangformel einzubauen.
  const labBonus = Math.round(bonuses(ctx, trainer.id).catchRateBonus / 2)

  return {
    ball,
    berry,
    turn: e.turn,
    timeOfDay: worldClock().timeOfDay,
    weakenStacks: e.weakenStacks,
    calmStacks: e.calmStacks,
    badgeCount: world.badgesOf(ctx.db, trainer.id).size + labBonus,
  }
}

/**
 * Was beim Erkunden herauskommt.
 *
 * Drei Ausgaenge statt zwei: ausser einer Begegnung und dem leeren Gras gibt
 * es jetzt den Ueberfall — eine Begegnung mit einem Menschen statt mit einem
 * Pokemon. Diskriminiert ueber `kind`, damit der Client nicht raten muss.
 */
export type ExploreResult =
  | { kind: 'encounter'; encounter: EncounterView; legendary: boolean }
  | { kind: 'nothing' }
  | {
      kind: 'event'
      opponent: { id: string; name: string; title: string; sprite: string; intro: string }
    }

export function explore(ctx: AppContext, trainer: Trainer, ballId: string, berryId: string | null): ExploreResult {
  return tx(ctx.db, () => {
    // Erkunden bleibt unbegrenzt; geprueft wird nur, ob ein Mensch klickt.
    assertPace(ctx, trainer, 'explore')
    const area = requireCurrentArea(ctx, trainer)
    const used = counterValue(ctx.db, trainer.id, EXPLORE_COUNTER)
    energy.spendFor(ctx, trainer.id, 'explore')

    const clock = worldClock()
    // A fresh seed per encounter, derived from the trainer and a counter, so
    // two players exploring at the same second get different results and a
    // single player cannot replay the same roll.
    const seed = deriveSeed(trainer.id, area.id, Date.now(), used)
    const rng = createRng(seed)

    const chainSpecies = ctx.db
      .prepare('SELECT species_id AS s, streak FROM catch_chains WHERE trainer_id = ? ORDER BY streak DESC LIMIT 1')
      .get(trainer.id) as { s: string; streak: number } | undefined

    // Das Gebiet hebt sich auf die Staerke des Teams, wenn es darunter liegt.
    const rolled = rollEncounter(
      area, clock, rng, chainSpecies?.streak ?? 0, areaOffset(ctx, trainer, area),
    )
    bumpCounter(ctx.db, trainer.id, EXPLORE_COUNTER)
    recordPace(ctx, trainer, 'explore')
    world.visitArea(ctx.db, trainer.id, area.id)

    // Zuerst das Seltenste: ein Legendaeres schlaegt jede andere Begegnung.
    // Nur in einer Region, die vollstaendig bezwungen ist — sonst waere es
    // eine Abkuerzung statt einer Belohnung.
    if (clearedRegions(ctx, trainer).has(area.regionId) && rollLegendary(rng)) {
      const legendary = pickLegendary(ctx, area.regionId, rng)
      if (legendary) {
        const level = Math.min(100, (rolled?.level ?? 60) + LEGENDARY_LEVEL_BONUS)
        dex.markSeen(ctx.db, trainer.id, legendary)
        const rare = encounters.start(ctx.db, {
          trainerId: trainer.id, areaId: area.id, speciesId: legendary,
          level, shiny: rng.chance(2), seed, startedAt: Date.now(),
        })
        logEvent(ctx.db, trainer.id, 'safari.legendary', { areaId: area.id, speciesId: legendary, level })
        return {
          kind: 'encounter' as const,
          encounter: encounterView(ctx, trainer, rare, ballId, berryId),
          legendary: true,
        }
      }
    }

    // Dann der Ueberfall. Er verdraengt die Begegnung: beides gleichzeitig
    // waere ein Zustand, in dem der Spieler zwei Dinge offen haette.
    if (rollEvent(rng)) {
      const opponent = pickEvent(ctx, trainer, area.regionId)
      if (opponent) {
        ctx.db.prepare('UPDATE trainers SET pending_event_id = ?, pending_event_area = ? WHERE id = ?')
          .run(opponent.id, area.id, trainer.id)
        logEvent(ctx.db, trainer.id, 'safari.event', { areaId: area.id, opponentId: opponent.id })
        return { kind: 'event' as const, opponent }
      }
    }

    if (!rolled) return { kind: 'nothing' as const }

    world.bumpAreaStat(ctx.db, trainer.id, area.id, 'encounters')
    dex.markSeen(ctx.db, trainer.id, rolled.speciesId)

    const e = encounters.start(ctx.db, {
      trainerId: trainer.id,
      areaId: area.id,
      speciesId: rolled.speciesId,
      level: rolled.level,
      shiny: rolled.shiny,
      seed,
      startedAt: Date.now(),
    })
    logEvent(ctx.db, trainer.id, 'safari.encounter', {
      areaId: area.id, speciesId: rolled.speciesId, level: rolled.level, shiny: rolled.shiny,
    })
    return {
      kind: 'encounter' as const,
      encounter: encounterView(ctx, trainer, e, ballId, berryId),
      legendary: false,
    }
  })
}

/**
 * Ein Legendaeres der Region.
 *
 * Welche das sind, steht nicht in einer Liste, sondern folgt aus dem Pack:
 * Legendaere haben die niedrigste Fangrate, und zu welcher Region sie gehoeren,
 * sagt ihre Dex-Nummer im Vergleich zu dem, was in der Region sonst vorkommt.
 * Damit funktioniert es auch fuer eine dritte Region, die niemand hier
 * eingetragen hat.
 */
function pickLegendary(ctx: AppContext, regionId: string, rng: Rng): string | null {
  const inRegion = new Set(
    ctx.registry.allAreas.filter((a) => a.regionId === regionId).flatMap((a) => a.spawns.map((sp) => sp.speciesId)),
  )
  const numbers = [...inRegion]
    .map((id) => ctx.registry.trySpecies(id)?.dexNumber)
    .filter((n): n is number => typeof n === 'number')
  if (numbers.length === 0) return null
  const low = Math.min(...numbers)
  const high = Math.max(...numbers)

  const candidates = ctx.registry.allSpecies.filter(
    (sp) => sp.catchRate <= LEGENDARY_CATCH_RATE && sp.dexNumber >= low && sp.dexNumber <= high,
  )
  return candidates.length > 0 ? rng.pick(candidates).id : null
}

/** Der Ereignis-Gegner der Region, falls das Pack einen mitbringt. */
function pickEvent(ctx: AppContext, trainer: Trainer, regionId: string) {
  const def = ctx.registry.allTrainers.find(
    (t) => isEventTrainer(t.id) && t.id.endsWith(regionId),
  )
  if (!def) return null
  return {
    id: def.id,
    name: ctx.registry.localized(def.name, trainer.locale),
    title: ctx.registry.localized(def.title, trainer.locale),
    sprite: def.sprite,
    intro: ctx.registry.localized(def.dialogue.intro, trainer.locale),
  }
}

/**
 * Eine Sagenbeere einsetzen.
 *
 * Der einzige Hebel gegen ein Legendaeres. Bei allem anderen waere sie
 * wirkungslos, deshalb wird sie dort gar nicht erst angenommen — eine Beere,
 * die man versehentlich an ein Rattfratz verschwendet, waere ein bitterer
 * Verlust fuer nichts.
 */
export function useLegendaryBerry(
  ctx: AppContext, trainer: Trainer, ballId: string, berryId: string | null,
): EncounterView {
  return tx(ctx.db, () => {
    const e = encounters.activeOf(ctx.db, trainer.id)
    if (!e) throw new GameError('invalid_state', { reason: 'no_encounter' }, 409)

    const species = ctx.registry.species(e.speciesId)
    if (!isLegendaryCatchRate(species.catchRate)) {
      throw new GameError('invalid_state', { reason: 'not_legendary' }, 409)
    }
    if (e.legendaryBerries >= LEGENDARY_MAX_BERRIES) {
      throw new GameError('invalid_state', { reason: 'already_maxed', max: LEGENDARY_MAX_BERRIES }, 409)
    }

    inventory.consume(ctx.db, trainer.id, LEGENDARY_BERRY_ID, 1)
    if (!encounters.addLegendaryBerry(ctx.db, trainer.id, LEGENDARY_MAX_BERRIES)) {
      throw new GameError('invalid_state', { reason: 'already_maxed', max: LEGENDARY_MAX_BERRIES }, 409)
    }
    logEvent(ctx.db, trainer.id, 'safari.legendaryBerry', {
      speciesId: e.speciesId, used: e.legendaryBerries + 1,
    })
    return encounterView(ctx, trainer, encounters.activeOf(ctx.db, trainer.id)!, ballId, berryId)
  })
}

export type SoftenAction = 'weaken' | 'calm'

export function soften(ctx: AppContext, trainer: Trainer, action: SoftenAction, ballId: string, berryId: string | null): EncounterView {
  return tx(ctx.db, () => {
    const e = encounters.activeOf(ctx.db, trainer.id)
    if (!e) throw new GameError('invalid_state', { reason: 'no_encounter' }, 409)

    const max = action === 'weaken' ? MAX_WEAKEN_STACKS : MAX_CALM_STACKS
    const current = action === 'weaken' ? e.weakenStacks : e.calmStacks
    if (current >= max) throw new GameError('invalid_state', { reason: 'already_maxed', action }, 409)

    encounters.addStack(ctx.db, trainer.id, action, max)
    encounters.bumpTurn(ctx.db, trainer.id)
    return encounterView(ctx, trainer, encounters.activeOf(ctx.db, trainer.id)!, ballId, berryId)
  })
}

export interface ThrowResult {
  caught: boolean
  shakes: number
  probability: number
  fled: boolean
  /** Present on success. */
  creature: ReturnType<typeof creatureView> | null
  newDexEntry: boolean
  chain: number
  reward: { gold: number } | null
  /** Gesetzt, wenn mit diesem Fang das Gebiet vollstaendig wurde. */
  areaCompleted: { areaId: string; areaName: string; energy: number } | null
  encounter: EncounterView | null
}

/**
 * Ein Gebiet gilt als abgeschlossen, wenn jede dort vorkommende Art im Dex
 * steht — auch die, die nur nachts oder bei Regen erscheinen. Dafuer gibt es
 * einmalig Energie: die groesste einzelne Gutschrift im Spiel, weil sie den
 * groessten Aufwand belohnt.
 */
function completeArea(
  ctx: AppContext,
  trainer: Trainer,
  areaId: string,
): ThrowResult['areaCompleted'] {
  const already = ctx.db
    .prepare('SELECT 1 FROM area_completions WHERE trainer_id = ? AND area_id = ?')
    .get(trainer.id, areaId)
  if (already) return null

  const area = ctx.registry.tryArea(areaId)
  if (!area) return null
  const needed = new Set(area.spawns.map((sp) => sp.speciesId))
  const caught = dex.caughtSpeciesIds(ctx.db, trainer.id)
  for (const id of needed) if (!caught.has(id)) return null

  ctx.db.prepare('INSERT INTO area_completions (trainer_id, area_id, completed_at) VALUES (?, ?, ?)')
    .run(trainer.id, areaId, Date.now())
  const granted = ENERGY_REWARDS.areaCompleted
  energy.reward(ctx, trainer.id, 'areaCompleted')
  logEvent(ctx.db, trainer.id, 'area.completed', { areaId, energy: granted })
  return {
    areaId,
    areaName: ctx.registry.localized(area.name, trainer.locale),
    energy: granted,
  }
}

/** Chance the wild creature runs after a failed throw. Rises with the turn
 *  count so an encounter cannot be ground down forever with free actions. */
function fleeChance(turn: number): number {
  return Math.min(0.05 + turn * 0.04, 0.5)
}

/**
 * Der Wurf auf ein Legendaeres.
 *
 * Weder Ball noch Schwaechen noch Beruhigen spielen hinein — nur die
 * Sagenbeeren. Die Wackler leiten sich aus der Chance ab, damit die Animation
 * dasselbe erzaehlt wie die Rechnung.
 */
function legendaryAttempt(berries: number, rng: Rng): { caught: boolean; shakes: number; probability: number } {
  const probability = legendaryCatchChance(berries)
  const caught = rng.next() < probability
  const shakes = caught ? 3 : Math.min(3, Math.floor(probability * 4))
  return { caught, shakes, probability }
}

export function throwBall(
  ctx: AppContext,
  trainer: Trainer,
  ballId: string,
  berryId: string | null,
): ThrowResult {
  return tx(ctx.db, () => {
    const e = encounters.activeOf(ctx.db, trainer.id)
    if (!e) throw new GameError('invalid_state', { reason: 'no_encounter' }, 409)

    const species = ctx.registry.species(e.speciesId)
    const legendary = isLegendaryCatchRate(species.catchRate)
    const mods = buildModifiers(ctx, trainer, e, ballId, berryId)

    inventory.consume(ctx.db, trainer.id, ballId, 1)
    // Gegen ein Legendaeres wirkt keine gewoehnliche Beere — sie wird deshalb
    // auch nicht verbraucht.
    if (berryId && !legendary) inventory.consume(ctx.db, trainer.id, berryId, 1)

    // Seed includes the turn so each throw in one encounter differs, but the
    // whole encounter stays reproducible from its stored seed.
    const rng = createRng(deriveSeed(e.seed, 'throw', e.turn))
    const attempt = legendary
      ? legendaryAttempt(e.legendaryBerries, rng)
      : attemptCatch(species, e.level, mods, rng)
    encounters.bumpTurn(ctx.db, trainer.id)

    if (!attempt.caught) {
      const fled = rng.next() < fleeChance(e.turn)
      if (fled) {
        encounters.clear(ctx.db, trainer.id)
        world.breakChain(ctx.db, trainer.id)
      }
      logEvent(ctx.db, trainer.id, 'safari.throw', { caught: false, fled, speciesId: e.speciesId })
      return {
        caught: false, shakes: attempt.shakes, probability: attempt.probability, fled,
        creature: null, newDexEntry: false, chain: 0, reward: null, areaCompleted: null,
        encounter: fled ? null : encounterView(ctx, trainer, encounters.activeOf(ctx.db, trainer.id)!, ballId, berryId),
      }
    }

    const owned = creatures.countOwned(ctx.db, trainer.id).total
    if (owned >= BOX_LIMIT) throw new GameError('invalid_state', { reason: 'box_full', limit: BOX_LIMIT }, 409)

    const catchRng = createRng(deriveSeed(e.seed, 'creature'))
    const ivs = randomIvs(catchRng)
    const nature = catchRng.pick(NATURES)
    const stats = computeStats(species, e.level, ivs, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature)

    const created = creatures.insertCreature(ctx.db, {
      ownerId: trainer.id,
      speciesId: e.speciesId,
      level: e.level,
      xp: xpForLevel(species.growthRate, e.level),
      nature,
      ivs,
      friendship: 70,
      hpCurrent: stats.hp,
      shiny: e.shiny,
      moves: ctx.registry.learnableAt(e.speciesId, e.level).slice(0, 4),
      caughtAreaId: e.areaId,
      teamSlot: creatures.teamOf(ctx.db, trainer.id).length < 5 ? nextFreeSlot(ctx, trainer.id) : null,
    })

    const newDexEntry = dex.markCaught(ctx.db, trainer.id, e.speciesId)
    const chain = world.recordCatch(ctx.db, trainer.id, e.speciesId)
    world.bumpAreaStat(ctx.db, trainer.id, e.areaId, 'catches')
    const reward = catchReward(species, e.level, e.shiny)
    inventory.earnGold(ctx.db, trainer.id, reward.gold)
    encounters.clear(ctx.db, trainer.id)

    teams.syncActiveFromGarden(ctx, trainer.id)
    awardSeasonPoints(ctx, trainer.id, 'catch')
    if (newDexEntry) awardSeasonPoints(ctx, trainer.id, 'newDexEntry')
    bumpMetric(ctx, trainer.id, 'catches')
    const areaCompleted = newDexEntry ? completeArea(ctx, trainer, e.areaId) : null
    logEvent(ctx.db, trainer.id, 'safari.catch', {
      speciesId: e.speciesId, level: e.level, shiny: e.shiny, chain, gold: reward.gold,
    })

    return {
      caught: true,
      shakes: attempt.shakes,
      probability: attempt.probability,
      fled: false,
      creature: creatureView(ctx.registry, created, trainer.locale, worldClock().timeOfDay),
      newDexEntry,
      chain,
      reward: { gold: reward.gold },
      areaCompleted,
      encounter: null,
    }
  })
}

function nextFreeSlot(ctx: AppContext, trainerId: string): number | null {
  const used = new Set(creatures.teamOf(ctx.db, trainerId).map((c) => c.teamSlot))
  for (let i = 0; i < 5; i++) if (!used.has(i)) return i
  return null
}

export function flee(ctx: AppContext, trainer: Trainer): void {
  encounters.clear(ctx.db, trainer.id)
  world.breakChain(ctx.db, trainer.id)
  logEvent(ctx.db, trainer.id, 'safari.flee', {})
}

export function currentEncounter(
  ctx: AppContext,
  trainer: Trainer,
  ballId: string,
  berryId: string | null,
): EncounterView | null {
  const e = encounters.activeOf(ctx.db, trainer.id)
  return e ? encounterView(ctx, trainer, e, ballId, berryId) : null
}
