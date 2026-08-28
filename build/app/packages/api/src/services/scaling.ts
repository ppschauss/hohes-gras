import type { Trainer } from '@game/shared'
import type { AreaDef } from '@game/content'
import {
  areaBand, bandOffset, referenceLevel, shiftBand, shiftLevel,
  type LevelBand,
} from '@game/engine'
import type { AppContext } from '../context.js'
import * as creatures from '../repos/creatures.js'

/**
 * Wie stark ein Gebiet gerade ist.
 *
 * Der Bezugswert wird einmal je Anfrage aus dem aktiven Team gelesen. Er
 * absichtlich *nicht* aus der Box: was in der Kiste liegt, kämpft nicht.
 */
export function referenceOf(ctx: AppContext, trainer: Trainer): number {
  if (!trainer.levelScaling) return 0
  return referenceLevel(creatures.teamOf(ctx.db, trainer.id).map((c) => c.level))
}

/** Levelversatz eines Gebiets. 0 = unverändert. */
export function areaOffset(ctx: AppContext, trainer: Trainer, area: AreaDef, reference?: number): number {
  if (!trainer.levelScaling) return 0
  const ref = reference ?? referenceOf(ctx, trainer)
  return bandOffset(areaBand(area), ref)
}

/**
 * Levelversatz für die Trainer eines Gebiets — derselbe wie der des Gebiets.
 *
 * Bewusst nicht am eigenen Team des Trainers gemessen: der Rivale steht im
 * Entwurf zwei Level *unter* der Obergrenze seiner Route, ein Arenaleiter
 * darüber. Genau diese Abstände sind die Aussage des Entwurfs. Ein gemeinsamer
 * Versatz je Gebiet verschiebt sie alle zusammen und lässt die Verhältnisse
 * stehen; jeder Trainer für sich gerechnet würde sie einebnen.
 */
export function trainerOffset(ctx: AppContext, trainer: Trainer, area: AreaDef, reference?: number): number {
  return areaOffset(ctx, trainer, area, reference)
}

export function scaledAreaBand(area: AreaDef, offset: number): LevelBand {
  return shiftBand(areaBand(area), offset)
}

export const scaledLevel = shiftLevel
