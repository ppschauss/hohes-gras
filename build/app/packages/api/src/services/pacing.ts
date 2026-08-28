import { GameError, type Trainer } from '@game/shared'
import { CARE_PACING, EXPLORE_PACING, checkPacing, type PacingRules } from '@game/engine'
import type { AppContext } from '../context.js'
import * as pulse from '../repos/pulse.js'
import { logEvent } from '../repos/events.js'

/**
 * Taktkontrolle vor einer Aktion.
 *
 * Anders als der Eimer in `repos/rateLimit` schuetzt das hier nicht den Server,
 * sondern das Spiel: es geht nicht um Last, sondern darum, dass sich Fortschritt
 * nicht wegautomatisieren laesst.
 */

export const BUCKETS: Record<'care' | 'explore', PacingRules> = {
  care: CARE_PACING,
  explore: EXPLORE_PACING,
}

export type PacingBucket = keyof typeof BUCKETS

export function assertPace(
  ctx: AppContext,
  trainer: Trainer,
  bucket: PacingBucket,
  now = Date.now(),
): void {
  const rules = BUCKETS[bucket]
  const history = pulse.recent(ctx.db, trainer.id, bucket, now - rules.windowMs)
  const verdict = checkPacing(history, now, rules)
  if (verdict.ok) return

  // Auffaellige Muster landen im Protokoll — nicht um jemanden zu sperren,
  // sondern damit sich hinterher nachsehen laesst, ob die Schwelle stimmt.
  if (verdict.reason === 'rhythm') {
    logEvent(ctx.db, trainer.id, 'pacing.rhythm', { bucket, samples: history.length })
  }

  throw new GameError('rate_limited', {
    reason: verdict.reason,
    retryAfter: Math.ceil(verdict.retryAfterMs / 1000),
    ...(verdict.reason === 'window' ? { limit: verdict.limit, windowMinutes: rules.windowMs / 60_000 } : {}),
  }, 429)
}

/** Erst nach der erfolgreichen Aktion vermerken: ein abgelehnter Versuch soll
 *  das Fenster nicht mit verbrauchen. */
export function recordPace(
  ctx: AppContext,
  trainer: Trainer,
  bucket: PacingBucket,
  now = Date.now(),
): void {
  pulse.record(ctx.db, trainer.id, bucket, now)
}
