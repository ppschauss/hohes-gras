import { GameError, type EnergyOverview, type EnergyState, type Trainer } from '@game/shared'
import { von } from './ledger.js'
import {
  bonusOf, clampEnergy, ENERGY_BASE_CAP, ENERGY_CAP_MAX_STEPS, ENERGY_CAP_STEP,
  ENERGY_COSTS, ENERGY_FILL_MINUTES, ENERGY_PACKS, ENERGY_REWARDS,
  ENERGY_TO_GOLD_LIMIT, ENERGY_TO_GOLD_RATE,
  energyCapPrice, energyPerHour, findEnergyPack, fullAt, nextPointAt,
  regenerateTrainerEnergy, type EnergyAction, type EnergySource,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as trainers from '../repos/trainers.js'
import * as progression from '../repos/progression.js'
import * as inventory from '../repos/inventory.js'
import { logEvent } from '../repos/events.js'

/**
 * Trainer-Energie.
 *
 * Die zentrale Schranke des Spiels, seit die Tageslimits weg sind. Jede
 * verbrauchende Stelle geht durch `spend`, jede Belohnung durch `grant` — so
 * gibt es genau einen Ort, an dem die Ressource entsteht und vergeht, und das
 * Ereignisprotokoll erklaert hinterher jeden Punkt.
 */

export interface EnergyLimits {
  cap: number
  perHour: number
}

/**
 * Obergrenze und Nachschub.
 *
 * Der Vorrat waechst aus drei Quellen: dem Grundwert, dem Gewaechshaus und den
 * gekauften Ausbaustufen. Die Regeneration haengt daran — ein groesserer
 * Vorrat fuellt sich schneller, sodass die Zeit bis "wieder voll" ungefaehr
 * gleich bleibt. Alles wird bei jedem Zugriff neu gelesen: ein Ausbau soll
 * sofort wirken, nicht erst beim naechsten Login.
 */
export function limits(ctx: AppContext, trainerId: string): EnergyLimits {
  const owned = progression.buildingsOf(ctx.db, trainerId)
  const steps = capStepsOf(ctx, trainerId)
  const cap = ENERGY_BASE_CAP + bonusOf(owned, 'energyCapBonus') + steps * ENERGY_CAP_STEP
  const perHour = Math.round(energyPerHour(cap) * (1 + bonusOf(owned, 'energyRegenBonus') / 100))
  return { cap, perHour }
}

function capStepsOf(ctx: AppContext, trainerId: string): number {
  const row = ctx.db.prepare('SELECT energy_cap_steps AS n FROM trainers WHERE id = ?')
    .get(trainerId) as { n: number } | undefined
  return row?.n ?? 0
}

interface Row { energy: number; updatedAt: number }

function readRow(ctx: AppContext, trainerId: string): Row {
  const row = ctx.db
    .prepare('SELECT energy, energy_updated_at AS updatedAt FROM trainers WHERE id = ?')
    .get(trainerId) as Row | undefined
  if (!row) throw new GameError('not_found', { trainerId }, 404)
  return row
}

/**
 * Regeneration bis jetzt nachtragen und den Stand zurueckgeben.
 *
 * Wird vor jedem Lesen und vor jedem Verbrauch aufgerufen. Der Schreibvorgang
 * ist idempotent: zweimal hintereinander aufgerufen aendert der zweite Aufruf
 * nichts, weil `updatedAt` nur um verbuchte Punkte weiterwandert.
 */
export function sync(ctx: AppContext, trainerId: string, now = Date.now()): EnergyState {
  const { cap, perHour } = limits(ctx, trainerId)
  const row = readRow(ctx, trainerId)
  const next = regenerateTrainerEnergy(row.energy, row.updatedAt, now, cap, perHour)

  if (next.energy !== row.energy || next.updatedAt !== row.updatedAt) {
    ctx.db.prepare('UPDATE trainers SET energy = ?, energy_updated_at = ? WHERE id = ?')
      .run(next.energy, next.updatedAt, trainerId)
  }
  return toState(next.energy, next.updatedAt, cap, perHour)
}

function toState(energy: number, updatedAt: number, cap: number, perHour: number): EnergyState {
  return {
    current: energy,
    cap,
    perHour,
    nextPointAt: nextPointAt(energy, updatedAt, cap, perHour),
    fullAt: fullAt(energy, updatedAt, cap, perHour),
  }
}

export function state(ctx: AppContext, trainerId: string, now = Date.now()): EnergyState {
  return sync(ctx, trainerId, now)
}

export const costOf = (action: EnergyAction): number => ENERGY_COSTS[action]

/**
 * Energie abbuchen oder die Aktion ablehnen.
 *
 * `reason` landet im Ereignisprotokoll, damit sich hinterher rekonstruieren
 * laesst, wofuer ein Konto leergelaufen ist — die haeufigste Supportfrage bei
 * so einer Waehrung.
 */
export function spend(
  ctx: AppContext,
  trainerId: string,
  amount: number,
  reason: string,
  now = Date.now(),
): number {
  if (amount <= 0) return sync(ctx, trainerId, now).current
  const current = sync(ctx, trainerId, now)
  if (current.current < amount) {
    throw new GameError('insufficient_energy', { need: amount, have: current.current }, 409)
  }
  // Bedingtes UPDATE: zwei parallele Anfragen koennen nicht beide dasselbe
  // letzte Guthaben ausgeben.
  const changed = ctx.db
    .prepare('UPDATE trainers SET energy = energy - ? WHERE id = ? AND energy >= ?')
    .run(amount, trainerId, amount).changes
  if (changed !== 1) {
    throw new GameError('insufficient_energy', { need: amount, have: current.current }, 409)
  }
  logEvent(ctx.db, trainerId, 'energy.spend', { amount, reason })
  return current.current - amount
}

export function spendFor(
  ctx: AppContext,
  trainerId: string,
  action: EnergyAction,
  now = Date.now(),
): number {
  return spend(ctx, trainerId, ENERGY_COSTS[action], action, now)
}

/**
 * Gutschrift. Darf ueber die persoenliche Obergrenze hinaus anhaeufen —
 * Belohnungen sollen nicht verfallen, nur weil das Konto gerade voll war.
 *
 * Ab `ENERGY_TO_GOLD_LIMIT` wird der Ueberschuss zu Gold. Vorher lief er gegen
 * eine harte Grenze und war dahinter weg; das kostete einen Spieler ueber
 * 16.000 Punkte, ohne dass es irgendwo stand.
 */
export function grant(
  ctx: AppContext,
  trainerId: string,
  amount: number,
  reason: string,
  now = Date.now(),
): number {
  if (amount <= 0) return sync(ctx, trainerId, now).current
  const before = sync(ctx, trainerId, now)
  const total = before.current + amount
  const next = clampEnergy(Math.min(total, ENERGY_TO_GOLD_LIMIT))
  const overflow = Math.max(0, total - next)

  ctx.db.prepare('UPDATE trainers SET energy = ? WHERE id = ?').run(next, trainerId)
  logEvent(ctx.db, trainerId, 'energy.grant', { amount: next - before.current, reason })

  if (overflow > 0) {
    const gold = overflow * ENERGY_TO_GOLD_RATE
    inventory.earnGold(ctx.db, trainerId, gold, von(ctx, 'energy.overflow'))
    logEvent(ctx.db, trainerId, 'energy.toGold', { energy: overflow, gold, reason })
  }
  return next
}

/** Was eine Gutschrift von `amount` gerade an Gold abwerfen wuerde. */
export function overflowGoldFor(ctx: AppContext, trainerId: string, amount: number): number {
  const current = sync(ctx, trainerId).current
  return Math.max(0, current + amount - ENERGY_TO_GOLD_LIMIT) * ENERGY_TO_GOLD_RATE
}

export function reward(
  ctx: AppContext,
  trainerId: string,
  source: EnergySource,
  times = 1,
  now = Date.now(),
): number {
  return grant(ctx, trainerId, ENERGY_REWARDS[source] * times, source, now)
}

export function overview(ctx: AppContext, trainer: Trainer): EnergyOverview {
  const steps = capStepsOf(ctx, trainer.id)
  return {
    state: sync(ctx, trainer.id),
    gold: inventory.goldOf(ctx.db, trainer.id),
    packs: packViews(),
    costs: { ...ENERGY_COSTS },
    rewards: { ...ENERGY_REWARDS },
    fillMinutes: ENERGY_FILL_MINUTES,
    expansion: {
      steps,
      maxSteps: ENERGY_CAP_MAX_STEPS,
      stepSize: ENERGY_CAP_STEP,
      nextPrice: energyCapPrice(steps),
    },
    toGoldLimit: ENERGY_TO_GOLD_LIMIT,
    toGoldRate: ENERGY_TO_GOLD_RATE,
  }
}

/**
 * Den Vorrat dauerhaft vergroessern.
 *
 * Anders als ein Energiepaket ist das kein Verbrauchsgut: es hebt die
 * Obergrenze und damit auch den Nachschub, dauerhaft. Der grosse Goldspeicher
 * im Spiel — und der Grund, warum sich Gold ueber die Levelgrenze hinaus noch
 * lohnt.
 */
export function expand(ctx: AppContext, trainer: Trainer): EnergyOverview {
  return tx(ctx.db, () => {
    const steps = capStepsOf(ctx, trainer.id)
    const price = energyCapPrice(steps)
    if (price === null) {
      throw new GameError('invalid_state', { reason: 'max_level', max: ENERGY_CAP_MAX_STEPS }, 409)
    }
    inventory.spendGold(ctx.db, trainer.id, price)
    const next = trainers.bumpEnergyCapStep(ctx.db, trainer.id)
    logEvent(ctx.db, trainer.id, 'energy.expand', { step: next, gold: price })
    return overview(ctx, trainer)
  })
}

export function packViews() {
  return ENERGY_PACKS.map((p) => ({
    ...p,
    pricePerPoint: Math.round((p.gold / p.energy) * 10) / 10,
  }))
}

/** Energie fuer Gold. Der einzige Weg, das Konto ueber die Obergrenze zu
 *  bringen, ohne dafuer etwas geleistet zu haben — und damit die Stelle, an der
 *  Gold aus dem Spiel wieder verschwindet. */
export function buy(ctx: AppContext, trainer: Trainer, packId: string): EnergyOverview {
  const pack = findEnergyPack(packId)
  if (!pack) throw new GameError('validation_failed', { field: 'packId' })

  inventory.spendGold(ctx.db, trainer.id, pack.gold)
  grant(ctx, trainer.id, pack.energy, `buy:${pack.id}`)
  logEvent(ctx.db, trainer.id, 'energy.buy', { packId: pack.id, gold: pack.gold, energy: pack.energy })
  return overview(ctx, trainer)
}
