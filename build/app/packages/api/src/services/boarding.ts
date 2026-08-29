import { GameError, type Trainer } from '@game/shared'
import {
  BOARDING_MAX_LEVELS, BOARDING_MS, BOARDING_SLOTS, boardingLevels, boardingProgress,
  computeStats, ENERGY_COSTS, xpForLevel,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as boardingRepo from '../repos/boarding.js'
import * as creatures from '../repos/creatures.js'
import * as battles from '../repos/battles.js'
import { logEvent } from '../repos/events.js'
import { capOf } from './travel.js'
import { busyCreatureIds } from './busy.js'
import * as energy from './energy.js'
import { refreshMoves } from './garden.js'

/**
 * Pension.
 *
 * Die Regeln stehen in `engine/boarding.ts`. Hier steht, was die Datenbank
 * davon merkt — und die eine Rechnung, die diesen Dienst ausmacht: wie viel
 * Erfahrung ein Aufenthalt bis jetzt eingebracht hat.
 *
 * Sie geht über das *Level*, nicht über eine EP-Zahl je Stunde. Der Grund ist
 * die Levelkurve: dieselbe EP-Zahl ist auf Level 5 ein Sprung und auf Level 60
 * ein Rundungsfehler. Über die Level gerechnet bedeutet ein Tag Pension für
 * jedes Pokémon dasselbe — zehn Level —, und das ist die Aussage, die man
 * einem Spieler geben kann.
 */

/** Wie viel EP nötig sind, um von `from` auf `from + levels` zu kommen. */
function xpForLevels(
  ctx: AppContext, speciesId: string, from: number, levels: number, cap: number,
): { xp: number; target: number } {
  const species = ctx.registry.species(speciesId)
  const target = Math.min(cap, from + levels)
  if (target <= from) return { xp: 0, target: from }
  return {
    xp: xpForLevel(species.growthRate, target) - xpForLevel(species.growthRate, from),
    target,
  }
}

export interface BoardingEntry {
  id: string
  creatureId: string
  name: string
  sprite: string
  level: number
  levelAtStart: number
  startedAt: number
  readyAt: number
  ready: boolean
  /** Anteil des Aufenthalts, 0..1. */
  progress: number
  /** Level, die bis jetzt verdient sind. */
  levelsEarned: number
  /** Und wie viele es am Ende insgesamt wären. */
  levelsMax: number
  /** Was das Abholen jetzt kosten würde. 0, wenn der Aufenthalt vorbei ist. */
  energyCost: number
}

export function view(ctx: AppContext, trainer: Trainer) {
  const now = Date.now()
  const rows = boardingRepo.of(ctx.db, trainer.id)
  const cap = capOf(ctx, trainer)

  const entries: BoardingEntry[] = rows.flatMap((r) => {
    const c = creatures.byId(ctx.db, r.creatureId)
    if (!c) return []
    const species = ctx.registry.species(c.speciesId)
    const progress = boardingProgress(r.startedAt, now)
    const levels = boardingLevels(progress)
    return [{
      id: r.id,
      creatureId: c.id,
      name: c.nickname ?? ctx.registry.localized(species.name, trainer.locale),
      sprite: c.shiny ? species.spriteShiny : species.sprite,
      level: c.level,
      levelAtStart: r.levelAtStart,
      startedAt: r.startedAt,
      readyAt: r.readyAt,
      ready: r.readyAt <= now,
      progress,
      levelsEarned: xpForLevels(ctx, c.speciesId, r.levelAtStart, levels, cap).target - r.levelAtStart,
      levelsMax: Math.min(cap, r.levelAtStart + BOARDING_MAX_LEVELS) - r.levelAtStart,
      energyCost: r.readyAt <= now ? 0 : ENERGY_COSTS.boarding,
    }]
  })

  return {
    slots: BOARDING_SLOTS,
    used: entries.length,
    hours: BOARDING_MS / 3_600_000,
    maxLevels: BOARDING_MAX_LEVELS,
    abortCost: ENERGY_COSTS.boarding,
    levelCap: cap,
    entries,
  }
}

/**
 * Abgeben.
 *
 * Ein Pokémon aus dem aktiven Team darf mit — es wird dabei aus dem Garten
 * genommen, sonst stünde es im Kampf auf dem Feld und wäre gleichzeitig in
 * Pension.
 */
export function drop(ctx: AppContext, trainer: Trainer, creatureId: string) {
  return tx(ctx.db, () => {
    const rows = boardingRepo.of(ctx.db, trainer.id)
    if (rows.length >= BOARDING_SLOTS) {
      throw new GameError('invalid_state', { reason: 'already_full', limit: BOARDING_SLOTS }, 409)
    }
    const c = creatures.byId(ctx.db, creatureId)
    if (!c || c.ownerId !== trainer.id) throw new GameError('not_found', { creatureId }, 404)
    if (busyCreatureIds(ctx, trainer.id).has(creatureId)) {
      throw new GameError('invalid_state', { reason: 'creature_busy', creatureId }, 409)
    }
    if (battles.activeOf(ctx.db, trainer.id)) {
      throw new GameError('invalid_state', { reason: 'battle_in_progress' }, 409)
    }
    // Das letzte Pokemon bleibt da: ohne eines laesst sich nichts mehr tun.
    const own = creatures.countOwned(ctx.db, trainer.id)
    if (own.total - rows.length <= 1) {
      throw new GameError('invalid_state', { reason: 'last_creature' }, 409)
    }
    // Aus dem Garten nehmen, wenn es dort stand: sonst stuende es im Kampf
    // auf dem Feld und waere gleichzeitig in Pension.
    if (c.teamSlot !== null) {
      creatures.setTeam(
        ctx.db, trainer.id,
        creatures.teamOf(ctx.db, trainer.id).filter((m) => m.id !== c.id).map((m) => m.id),
      )
    }

    const now = Date.now()
    const row = boardingRepo.add(ctx.db, {
      trainerId: trainer.id,
      creatureId: c.id,
      levelAtStart: c.level,
      startedAt: now,
      readyAt: now + BOARDING_MS,
    })
    logEvent(ctx.db, trainer.id, 'boarding.drop', { creatureId, level: c.level })
    return { id: row.id }
  })
}

export interface BoardingPickup {
  name: string
  levelsGained: number
  newLevel: number
  /** Wurde vorzeitig abgeholt — und hat das Energie gekostet? */
  early: boolean
  energySpent: number
}

/**
 * Abholen.
 *
 * Vorzeitig kostet es Energie, aber niemals Fortschritt: was bis dahin
 * verdient ist, wird gutgeschrieben. Genau so war es gewünscht, und es ist
 * auch die einzige Variante, bei der man ein Pokémon guten Gewissens abgibt.
 */
export function pick(ctx: AppContext, trainer: Trainer, id: string): BoardingPickup {
  return tx(ctx.db, () => {
    const row = boardingRepo.byId(ctx.db, id)
    if (!row || row.trainerId !== trainer.id) throw new GameError('not_found', { id }, 404)

    const now = Date.now()
    const early = row.readyAt > now
    // Die Gebuehr faellt vor dem Entfernen an: reicht die Energie nicht, bleibt
    // das Pokemon, wo es ist.
    let energySpent = 0
    if (early) {
      energy.spendFor(ctx, trainer.id, 'boarding')
      energySpent = ENERGY_COSTS.boarding
    }
    if (!boardingRepo.remove(ctx.db, id)) {
      throw new GameError('invalid_state', { reason: 'already_claimed' }, 409)
    }

    const c = creatures.byId(ctx.db, row.creatureId)
    if (!c) return { name: '—', levelsGained: 0, newLevel: 0, early, energySpent }

    const species = ctx.registry.species(c.speciesId)
    const name = c.nickname ?? ctx.registry.localized(species.name, trainer.locale)
    const levels = boardingLevels(boardingProgress(row.startedAt, now))
    const { xp, target } = xpForLevels(ctx, c.speciesId, row.levelAtStart, levels, capOf(ctx, trainer))

    if (xp > 0 && target > c.level) {
      // Nicht addieren, sondern auf das Zielniveau setzen: wer zwischendurch
      // ein Bonbon bekommen hat, soll den Aufenthalt nicht doppelt zaehlen.
      creatures.setXp(ctx.db, c.id, xpForLevel(species.growthRate, target), target)
      const before = computeStats(species, c.level, c.ivs, c.evs, c.nature)
      const after = computeStats(species, target, c.ivs, c.evs, c.nature)
      creatures.setHp(ctx.db, c.id, Math.min(after.hp, c.hpCurrent + (after.hp - before.hp)))
      refreshMoves(ctx, c.id, c.speciesId, target, c.moves)
    }

    const gained = Math.max(0, target - c.level)
    logEvent(ctx.db, trainer.id, 'boarding.pick', {
      creatureId: c.id, levels: gained, early, energySpent,
    })
    return { name, levelsGained: gained, newLevel: Math.max(c.level, target), early, energySpent }
  })
}
