import { GameError, STATS, type StatBlock, type Trainer } from '@game/shared'
import {
  addEvs, computeStats, EV_MAX_PER_STAT, EV_MAX_TOTAL, EV_PER_TRAINING,
  findResearch, grantXpTo, RESEARCH_PROJECTS, researchBonusAt, researchCost, researchSlots,
  TRAINING_GOLD, TRAINING_HOURS, TRAINING_INPUTS, TRAINING_XP_PER_HOUR,
  type ResearchBonus, type ResearchProject,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as researchRepo from '../repos/research.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import * as progression from '../repos/progression.js'
import * as battles from '../repos/battles.js'
import { logEvent } from '../repos/events.js'
import { capOf } from './travel.js'
import { busyCreatureIds } from './busy.js'
import * as energy from './energy.js'
import { bumpMetric } from './progression.js'

/**
 * Forschung.
 *
 * Die Regeln stehen in `engine/research.ts`; hier steht, was die Datenbank
 * davon merkt. Drei Dinge sind heikel und deshalb ausdrücklich geregelt:
 *
 *  - Ein Projekt darf nur einmal erforscht werden. Die Sperre steht hier und
 *    nicht als Index, damit sie eine verständliche Meldung geben kann.
 *  - Das eingesetzte Pokémon ist so lange nicht verfügbar — dieselbe Regel wie
 *    bei Expeditionen, siehe `busy.ts`.
 *  - Abgeholt wird genau einmal. Das erledigt ein bedingtes UPDATE, nicht ein
 *    Lesen-und-dann-Schreiben.
 */

const TRAINING_ID = 'res-training'

/** Was fertig ist, als Projekt-Id → höchste Stufe. */
export function doneOf(ctx: AppContext, trainerId: string): Map<string, number> {
  return researchRepo.doneOf(ctx.db, trainerId)
}

/** Welche Rezepte freigeschaltet sind — die Menge, die `canCraft` erwartet. */
export function unlockedRecipes(ctx: AppContext, trainerId: string): Set<string> {
  return new Set(doneOf(ctx, trainerId).keys())
}

/**
 * Die erforschten Boni, wie der Rest des Spiels sie liest.
 *
 * Dieselbe Form wie `bonuses()` bei den Gebäuden: eine flache Tabelle, damit
 * ein Dienst nicht wissen muss, aus welchem Projekt eine Zahl stammt.
 */
export function researchBonuses(ctx: AppContext, trainerId: string): Record<ResearchBonus, number> {
  const done = doneOf(ctx, trainerId)
  const out = {
    findChance: 0, catchDrop: 0, expeditionLoot: 0,
    battleXp: 0, battleGold: 0, catchRate: 0, shinyOdds: 0,
  } as Record<ResearchBonus, number>
  for (const p of RESEARCH_PROJECTS) {
    if (p.kind !== 'bonus' || !p.unlocks) continue
    out[p.unlocks] += researchBonusAt(p, done.get(p.id) ?? 0)
  }
  return out
}

const labLevel = (ctx: AppContext, trainerId: string): number =>
  progression.buildingLevel(ctx.db, trainerId, 'lab')

/** Was ein Projekt gerade kostet — Stufe für Stufe teurer. */
const nextTier = (p: ResearchProject, done: Map<string, number>): number => (done.get(p.id) ?? 0) + 1

export function view(ctx: AppContext, trainer: Trainer) {
  const done = doneOf(ctx, trainer.id)
  const running = researchRepo.runningOf(ctx.db, trainer.id)
  const lab = labLevel(ctx, trainer.id)
  const slots = researchSlots(lab)
  const bag = inventory.bagOf(ctx.db, trainer.id)
  const gold = inventory.goldOf(ctx.db, trainer.id)
  const now = Date.now()

  const label = (itemId: string) => {
    const item = ctx.registry.tryItem(itemId)
    return {
      itemId,
      name: item ? ctx.registry.localized(item.name, trainer.locale) : itemId,
      icon: item?.icon ?? '',
    }
  }

  const nameOf = (creatureId: string | null) => {
    if (!creatureId) return null
    const c = creatures.byId(ctx.db, creatureId)
    if (!c) return null
    return c.nickname ?? ctx.registry.localized(ctx.registry.species(c.speciesId).name, trainer.locale)
  }

  return {
    lab,
    slots,
    /** Wie viele Plätze gerade belegt sind. */
    used: running.length,
    gold,
    trainingUnlocked: done.has(TRAINING_ID),
    evPerTraining: EV_PER_TRAINING,
    evMaxPerStat: EV_MAX_PER_STAT,
    evMaxTotal: EV_MAX_TOTAL,
    /** Was ein Trainingsdurchlauf verlangt. */
    training: {
      hours: TRAINING_HOURS,
      gold: TRAINING_GOLD,
      inputs: TRAINING_INPUTS.map((i) => ({ ...label(i.itemId), quantity: i.quantity, have: bag[i.itemId] ?? 0 })),
    },
    running: running.map((r) => {
      const p = findResearch(r.projectId)
      return {
        id: r.id,
        projectId: r.projectId,
        /** Trainingsläufe tragen kein Projekt im Sinne des Baums. */
        training: r.projectId === TRAINING_ID && r.stat !== null,
        tier: r.tier,
        stat: r.stat,
        creatureName: nameOf(r.creatureId),
        readyAt: r.readyAt,
        ready: r.readyAt <= now,
        totalMs: r.readyAt - r.startedAt,
        xp: Math.round(((r.readyAt - r.startedAt) / 3_600_000) * (p?.xpPerHour ?? TRAINING_XP_PER_HOUR)),
      }
    }),
    projects: RESEARCH_PROJECTS.map((p) => {
      const have = done.get(p.id) ?? 0
      const tier = nextTier(p, done)
      const complete = have >= p.tiers
      const cost = researchCost(p, Math.min(tier, p.tiers))
      return {
        id: p.id,
        kind: p.kind,
        tiers: p.tiers,
        done: have,
        complete,
        lab: p.lab,
        /** Der Bonus, den man heute hat, und der nach der nächsten Stufe. */
        bonusNow: p.kind === 'bonus' ? researchBonusAt(p, have) : 0,
        bonusNext: p.kind === 'bonus' ? researchBonusAt(p, Math.min(tier, p.tiers)) : 0,
        step: p.step,
        unlocks: p.unlocks,
        hours: cost.hours,
        goldCost: cost.gold,
        xp: Math.round(cost.hours * p.xpPerHour),
        inputs: cost.inputs.map((i) => ({ ...label(i.itemId), quantity: i.quantity, have: bag[i.itemId] ?? 0 })),
        /** Warum es gerade nicht geht — oder null. */
        blockedReason: blockedReason(p, { complete, lab, cost, bag, gold, running: running.length, slots }),
      }
    }),
  }
}

function blockedReason(
  p: ResearchProject,
  ctx: {
    complete: boolean; lab: number; slots: number; running: number
    cost: ReturnType<typeof researchCost>; bag: Record<string, number>; gold: number
  },
): string | null {
  if (ctx.complete) return null
  if (ctx.lab < p.lab) return 'missing_building'
  if (ctx.running >= ctx.slots) return 'already_full'
  if (ctx.gold < ctx.cost.gold) return 'insufficient_gold'
  for (const i of ctx.cost.inputs) if ((ctx.bag[i.itemId] ?? 0) < i.quantity) return 'missing_items'
  return null
}

/** Das Pokémon prüfen und für die Laufzeit binden. */
function claimCreature(ctx: AppContext, trainer: Trainer, creatureId: string) {
  const c = creatures.byId(ctx.db, creatureId)
  if (!c || c.ownerId !== trainer.id) throw new GameError('not_found', { creatureId }, 404)
  if (busyCreatureIds(ctx, trainer.id).has(creatureId)) {
    throw new GameError('invalid_state', { reason: 'creature_busy', creatureId }, 409)
  }
  if (battles.activeOf(ctx.db, trainer.id)) {
    throw new GameError('invalid_state', { reason: 'battle_in_progress' }, 409)
  }
  return c
}

export function start(ctx: AppContext, trainer: Trainer, projectId: string, creatureId: string) {
  const p = findResearch(projectId)
  if (!p) throw new GameError('not_found', { projectId }, 404)

  return tx(ctx.db, () => {
    const done = doneOf(ctx, trainer.id)
    const tier = nextTier(p, done)
    if (tier > p.tiers) throw new GameError('invalid_state', { reason: 'already_claimed' }, 409)

    const running = researchRepo.runningOf(ctx.db, trainer.id)
    if (running.some((r) => r.projectId === projectId)) {
      throw new GameError('invalid_state', { reason: 'already_running' }, 409)
    }
    const lab = labLevel(ctx, trainer.id)
    if (lab < p.lab) {
      throw new GameError('invalid_state', { reason: 'missing_building', buildingId: 'lab', level: p.lab }, 409)
    }
    if (running.length >= researchSlots(lab)) {
      throw new GameError('invalid_state', { reason: 'already_full', limit: researchSlots(lab) }, 409)
    }

    const c = claimCreature(ctx, trainer, creatureId)
    const cost = researchCost(p, tier)
    pay(ctx, trainer, cost.gold, cost.inputs)

    const now = Date.now()
    const row = researchRepo.start(ctx.db, {
      trainerId: trainer.id, projectId, tier, creatureId: c.id, stat: null,
      startedAt: now, readyAt: now + cost.hours * 3_600_000,
    })
    logEvent(ctx.db, trainer.id, 'research.started', { projectId, tier, creatureId })
    return { id: row.id }
  })
}

/** Ein Trainingsdurchlauf: dasselbe Verfahren, aber wiederholbar. */
export function train(ctx: AppContext, trainer: Trainer, creatureId: string, stat: string) {
  return tx(ctx.db, () => {
    if (!STATS.includes(stat as (typeof STATS)[number])) {
      throw new GameError('validation_failed', { field: 'stat' })
    }
    if (!doneOf(ctx, trainer.id).has(TRAINING_ID)) {
      throw new GameError('invalid_state', { reason: 'missing_research', projectId: TRAINING_ID }, 409)
    }
    const running = researchRepo.runningOf(ctx.db, trainer.id)
    const lab = labLevel(ctx, trainer.id)
    if (running.length >= researchSlots(lab)) {
      throw new GameError('invalid_state', { reason: 'already_full', limit: researchSlots(lab) }, 409)
    }

    const c = claimCreature(ctx, trainer, creatureId)
    const total = STATS.reduce((sum, s) => sum + c.evs[s], 0)
    if (total >= EV_MAX_TOTAL || c.evs[stat as keyof StatBlock] >= EV_MAX_PER_STAT) {
      throw new GameError('invalid_state', { reason: 'already_maxed' }, 409)
    }

    pay(ctx, trainer, TRAINING_GOLD, TRAINING_INPUTS)
    const now = Date.now()
    const row = researchRepo.start(ctx.db, {
      trainerId: trainer.id, projectId: TRAINING_ID, tier: 1, creatureId: c.id, stat,
      startedAt: now, readyAt: now + TRAINING_HOURS * 3_600_000,
    })
    logEvent(ctx.db, trainer.id, 'research.training', { creatureId, stat })
    return { id: row.id }
  })
}

function pay(
  ctx: AppContext, trainer: Trainer, gold: number,
  inputs: ReadonlyArray<{ itemId: string; quantity: number }>,
) {
  if (inventory.goldOf(ctx.db, trainer.id) < gold) {
    throw new GameError('insufficient_funds', { need: gold }, 409)
  }
  for (const i of inputs) {
    if (inventory.quantityOf(ctx.db, trainer.id, i.itemId) < i.quantity) {
      throw new GameError('insufficient_items', { itemId: i.itemId, need: i.quantity }, 409)
    }
  }
  inventory.spendGold(ctx.db, trainer.id, gold)
  for (const i of inputs) inventory.consume(ctx.db, trainer.id, i.itemId, i.quantity)
}

export interface ResearchClaim {
  projectId: string
  tier: number
  training: boolean
  stat: string | null
  creatureName: string | null
  xpGained: number
  leveledUp: boolean
  newLevel: number | null
  evGained: number
}

export function collect(ctx: AppContext, trainer: Trainer, id: string): ResearchClaim {
  return tx(ctx.db, () => {
    const row = researchRepo.byId(ctx.db, id)
    if (!row || row.trainerId !== trainer.id) throw new GameError('not_found', { id }, 404)
    if (row.claimedAt !== null) throw new GameError('invalid_state', { reason: 'already_claimed' }, 409)
    if (row.readyAt > Date.now()) {
      throw new GameError('invalid_state', { reason: 'not_ready', readyAt: row.readyAt }, 409)
    }
    // Genau einmal: das bedingte UPDATE ist die Schranke, nicht die Pruefung
    // darueber.
    if (!researchRepo.claim(ctx.db, id, Date.now())) {
      throw new GameError('invalid_state', { reason: 'already_claimed' }, 409)
    }

    const p = findResearch(row.projectId)
    const hours = (row.readyAt - row.startedAt) / 3_600_000
    const xp = Math.round(hours * (row.stat ? TRAINING_XP_PER_HOUR : p?.xpPerHour ?? 0))
    const result = grantToCreature(ctx, trainer, row.creatureId, xp, row.stat)

    logEvent(ctx.db, trainer.id, 'research.done', {
      projectId: row.projectId, tier: row.tier, stat: row.stat, xp,
    })
    bumpMetric(ctx, trainer.id, 'research')
    return {
      projectId: row.projectId,
      tier: row.tier,
      training: row.stat !== null,
      stat: row.stat,
      ...result,
    }
  })
}

/** Erfahrung und Fleisspunkte an das eingesetzte Pokemon. */
function grantToCreature(
  ctx: AppContext, trainer: Trainer, creatureId: string | null, xp: number, stat: string | null,
) {
  const empty = { creatureName: null, xpGained: 0, leveledUp: false, newLevel: null, evGained: 0 }
  if (!creatureId) return empty
  const c = creatures.byId(ctx.db, creatureId)
  if (!c || c.ownerId !== trainer.id) return empty

  const species = ctx.registry.species(c.speciesId)
  const name = c.nickname ?? ctx.registry.localized(species.name, trainer.locale)

  let evGained = 0
  if (stat) {
    const before = STATS.reduce((sum, s) => sum + c.evs[s], 0)
    const next = addEvs(c.evs, { [stat]: EV_PER_TRAINING } as Partial<StatBlock>)
    evGained = STATS.reduce((sum, s) => sum + next[s], 0) - before
    if (evGained > 0) creatures.setEvs(ctx.db, c.id, next)
  }

  const scaled = Math.max(1, Math.round(xp / (species.xpFactor ?? 1)))
  const gained = grantXpTo(species.growthRate, c.xp, c.level, scaled, capOf(ctx, trainer))
  creatures.setXp(ctx.db, c.id, gained.totalXp, gained.levelAfter)
  if (gained.levelsGained > 0) {
    const after = computeStats(species, gained.levelAfter, c.ivs, c.evs, c.nature)
    creatures.setHp(ctx.db, c.id, Math.min(after.hp, c.hpCurrent + 1))
  }
  return {
    creatureName: name,
    xpGained: scaled,
    leveledUp: gained.levelsGained > 0,
    newLevel: gained.levelsGained > 0 ? gained.levelAfter : null,
    evGained,
  }
}

/**
 * Abbrechen.
 *
 * Kostet Energie und gibt nichts zurück: Material und Gold sind in den Versuch
 * geflossen. Ohne Preis wäre das Abbrechen die beste Art, einen Laborplatz zu
 * verwalten — anfangen, umentscheiden, kostenlos zurück.
 */
export function abort(ctx: AppContext, trainer: Trainer, id: string) {
  return tx(ctx.db, () => {
    const row = researchRepo.byId(ctx.db, id)
    if (!row || row.trainerId !== trainer.id) throw new GameError('not_found', { id }, 404)
    if (row.claimedAt !== null) throw new GameError('invalid_state', { reason: 'already_claimed' }, 409)
    energy.spendFor(ctx, trainer.id, 'research')
    researchRepo.cancel(ctx.db, id)
    logEvent(ctx.db, trainer.id, 'research.aborted', { projectId: row.projectId, tier: row.tier })
    return { ok: true }
  })
}
