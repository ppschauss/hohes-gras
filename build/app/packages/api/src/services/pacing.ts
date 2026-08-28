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

/**
 * Taktkontrolle. Muss **ausserhalb** einer Transaktion laufen.
 *
 * Sie schreibt zwei Dinge, die eine abgewiesene Aktion ueberleben muessen: die
 * Zwangspause und den Protokolleintrag. Innerhalb von `tx()` nimmt der
 * Rollback beide wieder mit — die Pause verschwaende, und das Protokoll, mit
 * dem sich die Schwelle ueberpruefen laesst, blieb fuer immer leer. Genau so
 * war es, bis es jemandem auffiel.
 */
export function assertPace(
  ctx: AppContext,
  trainer: Trainer,
  bucket: PacingBucket,
  now = Date.now(),
): void {
  const rules = BUCKETS[bucket]

  // Eine laufende Pause zuerst: sie meldet die *verbleibende* Zeit, nicht
  // jedes Mal wieder dreissig Sekunden.
  const penalty = pulse.penaltyOf(ctx.db, trainer.id, bucket)
  if (penalty && penalty.until > now) {
    throw new GameError('rate_limited', {
      reason: penalty.reason,
      retryAfter: Math.ceil((penalty.until - now) / 1000),
    }, 429)
  }

  const history = pulse.recent(ctx.db, trainer.id, bucket, now - rules.windowMs)
  // Abstaende aus der Zeit vor der letzten Pause sind abgegolten und duerfen
  // nicht noch einmal dieselbe Pause ausloesen.
  const verdict = checkPacing(history, now, rules, penalty?.until ?? 0)
  if (verdict.ok) return

  if (verdict.reason === 'rhythm') {
    pulse.setPenalty(ctx.db, trainer.id, bucket, now + verdict.retryAfterMs, 'rhythm', now)
    // Auffaellige Muster landen im Protokoll — nicht um jemanden zu sperren,
    // sondern damit sich hinterher nachsehen laesst, ob die Schwelle stimmt.
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
