import type { Trainer } from '@game/shared'
import type { AreaDef } from '@game/content'
import {
  areaBand, areaOffset as offsetOf, referenceLevel, regionShift, shiftBand, shiftLevel,
  type LevelBand,
} from '@game/engine'
import type { AppContext } from '../context.js'
import * as creatures from '../repos/creatures.js'
import * as regions from '../repos/regions.js'
import { capOf } from './travel.js'

/**
 * Wie stark ein Gebiet gerade ist.
 *
 * Der Bezugswert wird einmal je Anfrage aus dem aktiven Team gelesen. Er
 * absichtlich *nicht* aus der Box: was in der Kiste liegt, kämpft nicht.
 */
export function referenceOf(ctx: AppContext, trainer: Trainer): number {
  return referenceLevel(creatures.teamOf(ctx.db, trainer.id).map((c) => c.level))
}

/**
 * Levelversatz eines Gebiets: seine Region nach unten, es selbst nach oben.
 *
 * Der Eingang der Region entscheidet über den Teil nach unten — sonst wäre
 * jede Region nur über ihren eigenen Einstieg betretbar und die freie
 * Startwahl eine Lüge. Nach oben zählt dagegen nur das Gebiet selbst, sonst
 * liefe einem die eigene Liga davon.
 *
 * ---
 *
 * Der Schalter regelt nur den Teil nach oben, und das ist eine Korrektur.
 *
 * Er hiess immer „Gebiete behalten ihre Entwurfslevel, frühere Routen bleiben
 * leicht" — und tat zwei Dinge: er liess frühere Routen leicht *und* nahm der
 * Region ihren Einstieg. Die entworfenen Bänder sind eine Kette (Kanto 2–78,
 * Johto 58–100, Hoenn 96–150), also stand hinter dem ausgeschalteten Schalter
 * ein Johto ab Level 58 und ein Hoenn ab Level 96. Wer ihn umlegte, verlor die
 * freie Wahl der Startregion, ohne dass irgendwo stand, dass er das täte.
 *
 * Jetzt gilt: **die Region empfängt einen immer auf dem eigenen Niveau** — das
 * ist keine Geschmacksfrage, sondern die Bedingung dafür, dass es drei
 * Startregionen gibt. Der Schalter entscheidet nur noch, ob die Gebiete danach
 * mitwachsen. Aus heisst: du wächst in die Region hinein und lässt sie hinter
 * dir. An heisst: sie bleibt fordernd.
 */
export function areaOffset(ctx: AppContext, trainer: Trainer, area: AreaDef, reference?: number): number {
  const ref = reference ?? referenceOf(ctx, trainer)
  const entry = entryReferenceOf(ctx, trainer, area.regionId, ref)
  const anchor = anchorOf(ctx, area.regionId)
  if (!trainer.levelScaling) return regionShift(anchor, entry)
  return offsetOf(anchor, areaBand(area), ref, capOf(ctx, trainer), entry)
}

/**
 * Das Niveau, auf dem die Region einen empfangen hat.
 *
 * Für eine noch nicht betretene Region gibt es keinen Eintrag — dann gilt das
 * heutige Niveau. Auf der Weltkarte ist das genau die richtige Vorschau: *so
 * würde diese Region dich empfangen*. Sobald man wirklich hineingeht, wird die
 * Zahl festgeschrieben und ändert sich nie wieder.
 */
export function entryReferenceOf(
  ctx: AppContext, trainer: Trainer, regionId: string, reference: number,
): number {
  return regions.entryReference(ctx.db, trainer.id, regionId) ?? reference
}

/** Beim ersten Betreten einer Region ihr Niveau festhalten. */
export function recordRegionEntry(ctx: AppContext, trainer: Trainer, regionId: string): void {
  regions.recordEntry(ctx.db, trainer.id, regionId, referenceOf(ctx, trainer))
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
