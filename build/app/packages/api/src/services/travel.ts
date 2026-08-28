import type { Trainer } from '@game/shared'
import { LEVELS_PER_REGION, travelCap } from '@game/engine'
import type { AppContext } from '../context.js'
import { clearedRegions } from './league.js'

/**
 * Die Reisegrenze.
 *
 * Fuenfzig Level je bezwungener Region, plus die erste. Sie ist die einzige
 * Zahl, die sagt, wie weit ein Trainer bisher gekommen ist — und sie steht
 * nirgends gespeichert, sondern folgt aus den Orden und den besiegten
 * Meistern. Eine gespeicherte Grenze waere eine zweite Wahrheit, die beim
 * naechsten Content-Wechsel falsch wird.
 */
export function capOf(ctx: AppContext, trainer: Trainer): number {
  return travelCap(clearedRegions(ctx, trainer).size)
}

export interface TravelView {
  cap: number
  clearedRegions: number
  totalRegions: number
  levelsPerRegion: number
  /** Grenze nach der naechsten bezwungenen Region; null, wenn alle durch sind. */
  nextCap: number | null
}

export function viewOf(ctx: AppContext, trainer: Trainer): TravelView {
  const cleared = clearedRegions(ctx, trainer).size
  const total = ctx.registry.allRegions.length
  return {
    cap: travelCap(cleared),
    clearedRegions: cleared,
    totalRegions: total,
    levelsPerRegion: LEVELS_PER_REGION,
    nextCap: cleared < total ? travelCap(cleared + 1) : null,
  }
}

/**
 * Die Grenze, die fuer ein Duell zwischen zwei Trainern gilt.
 *
 * Die niedrigere von beiden. Sonst gewinnt, wer mehr Regionen abgehakt hat,
 * und nicht, wer das bessere Team aufgestellt hat — ein Duell soll ueber
 * Aufstellung entscheiden, nicht ueber Reisekilometer.
 */
export function duelCap(ctx: AppContext, a: Trainer, b: Trainer): number {
  return Math.min(capOf(ctx, a), capOf(ctx, b))
}
