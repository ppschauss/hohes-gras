import type { Trainer } from '@game/shared'
import type { AreaDef } from '@game/content'
import {
  areaBand, referenceLevel, regionOffset, shiftBand, shiftLevel,
  type LevelBand,
} from '@game/engine'
import type { AppContext } from '../context.js'
import * as creatures from '../repos/creatures.js'
import { capOf } from './travel.js'

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

/**
 * Levelversatz eines Gebiets — bestimmt am Eingang seiner Region.
 *
 * Nicht am Gebiet selbst: sonst wäre jede Region nur über ihren eigenen
 * Einstieg betretbar und die freie Startwahl eine Lüge. So wandert die ganze
 * Region auf das Niveau dessen, der sie betritt, und behält dabei ihre innere
 * Steigung.
 */
export function areaOffset(ctx: AppContext, trainer: Trainer, area: AreaDef, reference?: number): number {
  if (!trainer.levelScaling) return 0
  const ref = reference ?? referenceOf(ctx, trainer)
  return regionOffset(anchorOf(ctx, area.regionId), ref, capOf(ctx, trainer))
}

/** Das Levelband des ersten Gebiets einer Region. */
export function anchorOf(ctx: AppContext, regionId: string): LevelBand {
  const first = ctx.registry.allAreas
    .filter((a) => a.regionId === regionId)
    .sort((a, b) => a.order - b.order)[0]
  return first ? areaBand(first) : { min: 1, max: 1 }
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
