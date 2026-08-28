import { GameError, type Trainer } from '@game/shared'
import type { AreaDef } from '@game/content'
import { areaBand, availableSpawns } from '@game/engine'
import type { AppContext } from '../context.js'
import * as world from '../repos/world.js'
import * as creatures from '../repos/creatures.js'
import { worldClock } from '../worldClock.js'
import { areaOffset, referenceOf } from './scaling.js'
import { progressOf } from './league.js'

export interface UnlockRequirement {
  kind: 'previous_area' | 'caught_in_previous' | 'creatures_at_level' | 'badges'
  met: boolean
  label: string
  have: number
  need: number
  /** Ids the client can show as icons, e.g. missing badges. */
  detail?: string[]
}

export interface AreaView {
  id: string
  regionId: string
  order: number
  name: string
  description: string
  icon: string
  unlocked: boolean
  visited: boolean
  isCurrent: boolean
  requirements: UnlockRequirement[]
  caughtHere: number
  speciesHere: number
  encounters: number
  gymId: string | null
  gymCleared: boolean
  trainerCount: number
  /** What can actually appear right now — the reason to come back at night. */
  spawnableNow: number
  /** Levelband, wie es sich gerade zeigt — inklusive Skalierung. */
  levels: { min: number; max: number }
  /** Wie viele Level die Skalierung draufgelegt hat. 0 = Entwurfswerte. */
  levelBoost: number
}

/**
 * Decide whether an area is open.
 *
 * Every condition is returned with its current and required value, not just a
 * boolean. A locked door that does not say what it wants is the single most
 * common way a progression system feels arbitrary.
 */
export function evaluateArea(
  ctx: AppContext,
  trainer: Trainer,
  area: AreaDef,
  caughtPerArea: Map<string, number>,
  badges: Set<string>,
  levelCounts: number[],
): UnlockRequirement[] {
  const reqs: UnlockRequirement[] = []
  const unlock = area.unlock

  if (unlock.previousAreaId) {
    const prev = ctx.registry.tryArea(unlock.previousAreaId)
    const caughtThere = caughtPerArea.get(unlock.previousAreaId) ?? 0
    const need = unlock.minCaughtInPrevious
    if (need > 0) {
      reqs.push({
        kind: 'caught_in_previous',
        met: caughtThere >= need,
        label: prev ? ctx.registry.localized(prev.name, trainer.locale) : unlock.previousAreaId,
        have: caughtThere,
        need,
      })
    }
  }

  if (unlock.minCreaturesAtLevel) {
    const { count, level } = unlock.minCreaturesAtLevel
    const have = levelCounts.filter((l) => l >= level).length
    reqs.push({ kind: 'creatures_at_level', met: have >= count, label: String(level), have, need: count })
  }

  if (unlock.requiredBadgeIds.length > 0) {
    const missing = unlock.requiredBadgeIds.filter((b) => !badges.has(b))
    reqs.push({
      kind: 'badges',
      met: missing.length === 0,
      label: '',
      have: unlock.requiredBadgeIds.length - missing.length,
      need: unlock.requiredBadgeIds.length,
      detail: missing,
    })
  }

  return reqs
}

export function worldMap(ctx: AppContext, trainer: Trainer): {
  regions: Array<{ id: string; name: string; tagline: string; areas: AreaView[] }>
  clock: ReturnType<typeof worldClock>
  currentAreaId: string | null
  badges: string[]
  levelScaling: boolean
  referenceLevel: number
  league: ReturnType<typeof progressOf>
} {
  const clock = worldClock()
  const caughtPerArea = world.caughtPerArea(ctx.db, trainer.id)
  const badges = world.badgesOf(ctx.db, trainer.id)
  const progress = world.progressOf(ctx.db, trainer.id)
  const levelCounts = ctx.db
    .prepare('SELECT level FROM creatures WHERE owner_id = ?')
    .all(trainer.id)
    .map((r) => (r as { level: number }).level)

  const reference = referenceOf(ctx, trainer)
  const areasByRegion = new Map<string, AreaView[]>()
  for (const area of ctx.registry.allAreas) {
    const offset = areaOffset(ctx, trainer, area, reference)
    const band = areaBand(area)
    const reqs = evaluateArea(ctx, trainer, area, caughtPerArea, badges, levelCounts)
    const prog = progress.get(area.id)
    const view: AreaView = {
      id: area.id,
      regionId: area.regionId,
      order: area.order,
      name: ctx.registry.localized(area.name, trainer.locale),
      description: ctx.registry.localized(area.description, trainer.locale),
      icon: area.icon,
      unlocked: reqs.every((r) => r.met),
      visited: Boolean(prog),
      isCurrent: trainer.currentAreaId === area.id,
      requirements: reqs,
      caughtHere: caughtPerArea.get(area.id) ?? 0,
      speciesHere: new Set(area.spawns.map((s) => s.speciesId)).size,
      encounters: prog?.encounters ?? 0,
      gymId: area.gymId,
      gymCleared: area.gymId ? badges.has(ctx.registry.trainer(area.gymId).badgeId ?? '') : false,
      trainerCount: area.trainerIds.length,
      spawnableNow: new Set(availableSpawns(area, clock).map((s) => s.speciesId)).size,
      levels: { min: band.min + offset, max: band.max + offset },
      levelBoost: offset,
    }
    const list = areasByRegion.get(area.regionId) ?? []
    list.push(view)
    areasByRegion.set(area.regionId, list)
  }

  return {
    clock,
    currentAreaId: trainer.currentAreaId,
    badges: [...badges],
    levelScaling: trainer.levelScaling,
    referenceLevel: reference,
    league: progressOf(ctx, trainer),
    regions: ctx.registry.allRegions.map((r) => ({
      id: r.id,
      name: ctx.registry.localized(r.name, trainer.locale),
      tagline: ctx.registry.localized(r.tagline, trainer.locale),
      areas: (areasByRegion.get(r.id) ?? []).sort((a, b) => a.order - b.order),
    })),
  }
}

/** Travel to an area, refusing if its conditions are not met. */
export function travelTo(ctx: AppContext, trainer: Trainer, areaId: string): void {
  const area = ctx.registry.tryArea(areaId)
  if (!area) throw new GameError('not_found', { areaId }, 404)

  const reqs = evaluateArea(
    ctx, trainer, area,
    world.caughtPerArea(ctx.db, trainer.id),
    world.badgesOf(ctx.db, trainer.id),
    ctx.db.prepare('SELECT level FROM creatures WHERE owner_id = ?').all(trainer.id)
      .map((r) => (r as { level: number }).level),
  )
  const unmet = reqs.filter((r) => !r.met)
  if (unmet.length > 0) {
    throw new GameError('invalid_state', { reason: 'area_locked', requirements: unmet }, 409)
  }

  ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run(areaId, trainer.id)
  world.visitArea(ctx.db, trainer.id, areaId)
}

export function requireCurrentArea(ctx: AppContext, trainer: Trainer): AreaDef {
  const id = trainer.currentAreaId ?? ctx.registry.manifest.startingArea
  const area = ctx.registry.tryArea(id)
  if (!area) throw new GameError('invalid_state', { reason: 'no_area' }, 409)
  return area
}

/** Team members that are not away on an expedition and still standing. */
export function availableTeam(ctx: AppContext, trainer: Trainer, busy: Set<string>) {
  return creatures.teamOf(ctx.db, trainer.id).filter((c) => !busy.has(c.id))
}
