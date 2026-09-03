import {
  GameError, type Plantable, type PlotView, type PlotsState, type Trainer,
} from '@game/shared'
import {
  ENERGY_COSTS, GOLD_PLANT_COOLDOWN_MS, PLANTABLE_CATEGORIES, PLOT_COUNT, PLOT_GROWTH_MS,
  UNPLANTABLE_ITEMS, FERTILISER_LEVELS, fertiliserOf, fertilisedGrowthMs,
  PLOT_MAX_GOLD, PLOT_MAX_ITEMS, PLOT_PHASES, goldPlantReady, goldPlantReadyAt,
  harvestAmount, nextPhaseAt, phaseKind, phasesDue, plotBonus, plotReady, tenderBonus,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as plots from '../repos/plots.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import * as expeditions from '../repos/expeditions.js'
import { logEvent } from '../repos/events.js'
import * as energy from './energy.js'
import { assertPace, recordPace } from './pacing.js'
import { busyCreatureIds } from './busy.js'
import { von } from './ledger.js'

/**
 * Poké-Beet.
 *
 * Vergraben, pflegen, ernten. Die Rechnung selbst steckt in `engine/planting`;
 * hier geht es nur darum, wem was gehört und wann etwas abgebucht wird.
 */

const PLANTABLE = new Set<string>(PLANTABLE_CATEGORIES)

/** Ein Pfleger muss ein Pflanzen-Pokémon sein — das ist der ganze Witz daran. */
function isTender(ctx: AppContext, speciesId: string): boolean {
  return ctx.registry.trySpecies(speciesId)?.types.includes('grass') ?? false
}

function plotView(ctx: AppContext, trainer: Trainer, row: plots.PlotRow | null, slot: number, now: number): PlotView {
  if (!row) {
    return {
      slot, id: null, stake: null, plantedAt: null, readyAt: null, ready: false,
      phasesDone: 0, phasesTotal: PLOT_PHASES, phasesPending: 0,
      nextPhaseKind: null, nextPhaseAt: null, tender: null, fertiliser: null,
      bonusPercent: 0, payout: 0,
    }
  }

  const tenderRow = row.tenderId ? creatures.byId(ctx.db, row.tenderId) : null
  const tenderSpecies = tenderRow ? ctx.registry.trySpecies(tenderRow.speciesId) : null
  /*
   * Die Pflegeschritte richten sich nach der *tatsaechlichen* Laufzeit.
   *
   * Ein geduengtes Beet ist frueher fertig, also ruecken auch seine vier
   * Schritte zusammen. Rechnete man weiter mit der Grundzeit, waeren bei
   * Duenger III drei der vier Schritte erst faellig, wenn die Ernte laengst
   * bereitsteht — die Handpflege waere damit ausgerechnet auf dem besten Beet
   * unmoeglich.
   */
  const duenger = fertiliserOf(row.fertiliserId)
  const laufzeit = wachszeit(row)
  const due = phasesDue(row.plantedAt, now, laufzeit, PLOT_PHASES)
  const bonus = plotBonus({
    phasesDone: row.phasesDone,
    phases: PLOT_PHASES,
    tenderLevel: tenderRow ? tenderRow.level : null,
    fertiliserPercent: duenger?.percent ?? 0,
  })

  const item = row.itemId ? ctx.registry.tryItem(row.itemId) : null
  return {
    slot,
    id: row.id,
    stake: {
      kind: row.stakeKind,
      itemId: row.itemId,
      name: row.stakeKind === 'gold'
        ? 'Gold'
        : item ? ctx.registry.localized(item.name, trainer.locale) : (row.itemId ?? '?'),
      icon: item?.icon ?? '',
      amount: row.amount,
    },
    plantedAt: row.plantedAt,
    readyAt: row.readyAt,
    ready: plotReady(row.plantedAt, now, laufzeit),
    phasesDone: row.phasesDone,
    phasesTotal: PLOT_PHASES,
    // Ein abgestelltes Pokemon erledigt die Schritte selbst; dann steht nichts
    // offen, was der Spieler tun muesste.
    phasesPending: tenderRow ? 0 : Math.max(0, due - row.phasesDone),
    nextPhaseKind: row.phasesDone >= PLOT_PHASES ? null : phaseKind(row.phasesDone),
    nextPhaseAt: nextPhaseAt(row.plantedAt, row.phasesDone, laufzeit, PLOT_PHASES),
    tender: tenderRow && tenderSpecies
      ? {
          id: tenderRow.id,
          displayName: tenderRow.nickname ?? ctx.registry.localized(tenderSpecies.name, trainer.locale),
          sprite: tenderRow.shiny ? tenderSpecies.spriteShiny : tenderSpecies.sprite,
          level: tenderRow.level,
        }
      : null,
    fertiliser: duenger
      ? {
          itemId: duenger.itemId,
          name: ctx.registry.localized(
            ctx.registry.tryItem(duenger.itemId)?.name ?? { de: duenger.itemId }, trainer.locale,
          ),
          percent: duenger.percent,
        }
      : null,
    bonusPercent: bonus,
    payout: harvestAmount(row.amount, bonus),
  }
}

export function state(ctx: AppContext, trainer: Trainer, now = Date.now()): PlotsState {
  const open = new Map(plots.openOf(ctx.db, trainer.id).map((p) => [p.slot, p]))
  const bag = inventory.bagOf(ctx.db, trainer.id)
  const busy = plots.busyTenderIds(ctx.db, trainer.id)
  const away = busyCreatureIds(ctx, trainer.id)

  const plantable: Plantable[] = Object.entries(bag)
    .flatMap(([itemId, have]) => {
      const item = ctx.registry.tryItem(itemId)
      /*
       * Dieselbe Bedingung wie beim Pflanzen, und das ist der Punkt.
       *
       * Die Sperre stand nur im `plant`, nicht in dieser Liste: die Auswahl
       * bot die Sagenbeere weiter an, und wer sie waehlte, bekam eine Absage
       * statt gar keine Wahl. Eine Liste, die mehr zeigt, als der Knopf
       * annimmt, ist schlimmer als eine kurze.
       */
      if (!item || !PLANTABLE.has(item.category) || UNPLANTABLE_ITEMS.has(itemId) || have <= 0) return []
      return [{
        itemId,
        name: ctx.registry.localized(item.name, trainer.locale),
        icon: item.icon,
        category: item.category,
        have,
      }]
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))

  const tenders = creatures.teamOf(ctx.db, trainer.id)
    .concat(creatures.allBoxOf(ctx.db, trainer.id))
    .filter((c) => isTender(ctx, c.speciesId))
    .map((c) => {
      const species = ctx.registry.species(c.speciesId)
      return {
        id: c.id,
        displayName: c.nickname ?? ctx.registry.localized(species.name, trainer.locale),
        sprite: c.shiny ? species.spriteShiny : species.sprite,
        level: c.level,
        bonusPercent: tenderBonus(c.level),
        busy: busy.has(c.id) || away.has(c.id),
      }
    })
    .sort((a, b) => b.level - a.level)

  const lastGold = plots.lastGoldPlantAt(ctx.db, trainer.id)
  return {
    plots: Array.from({ length: PLOT_COUNT }, (_, slot) =>
      plotView(ctx, trainer, open.get(slot) ?? null, slot, now)),
    gold: inventory.goldOf(ctx.db, trainer.id),
    growthMinutes: Math.round(PLOT_GROWTH_MS / 60_000),
    maxItems: PLOT_MAX_ITEMS,
    maxGold: PLOT_MAX_GOLD,
    goldReady: goldPlantReady(lastGold, now),
    goldReadyAt: goldPlantReadyAt(lastGold),
    goldCooldownHours: Math.round(GOLD_PLANT_COOLDOWN_MS / 3_600_000),
    tendCost: ENERGY_COSTS.care,
    plantable,
    /*
     * Was an Duenger im Beutel liegt.
     *
     * Mit Bestand, damit die Auswahl beim Pflanzen zeigt, was zur Wahl steht —
     * eine Stufe, die man nicht hat, ist keine Entscheidung.
     */
    fertilisers: FERTILISER_LEVELS.flatMap((f) => {
      // `tryItem`, nicht `item`: ein Paket ohne Duenger ist ein Paket ohne
      // Duenger und darf nicht die ganze Beet-Ansicht umwerfen. Die Engine
      // kennt keine Inhalte, und diese Liste ist eine Behauptung ueber das
      // Paket, keine ueber das Spiel.
      const eintrag = ctx.registry.tryItem(f.itemId)
      if (!eintrag) return []
      return [{
        itemId: f.itemId,
        name: ctx.registry.localized(eintrag.name, trainer.locale),
        percent: f.percent,
        owned: inventory.quantityOf(ctx.db, trainer.id, f.itemId),
      }]
    }),
    tenders,
  }
}

/** Wie lange dieses Beet wirklich braucht — mit Duenger kuerzer. */
const wachszeit = (row: { fertiliserId: string | null }): number => {
  const d = fertiliserOf(row.fertiliserId)
  return d ? fertilisedGrowthMs(d.percent) : PLOT_GROWTH_MS
}

export interface PlantInput {
  slot: number
  kind: 'item' | 'gold'
  itemId?: string
  amount: number
  tenderId?: string | null
  /** Duenger, der beim Pflanzen eingesetzt wird. Null oder fehlend: ohne. */
  fertiliserId?: string | null
}

export function plant(ctx: AppContext, trainer: Trainer, input: PlantInput, now = Date.now()): PlotsState {
  return tx(ctx.db, () => {
    if (input.slot < 0 || input.slot >= PLOT_COUNT) {
      throw new GameError('validation_failed', { field: 'slot', max: PLOT_COUNT - 1 })
    }
    if (plots.atSlot(ctx.db, trainer.id, input.slot)) {
      throw new GameError('invalid_state', { reason: 'plot_busy', slot: input.slot }, 409)
    }

    if (input.kind === 'gold') {
      if (input.amount > PLOT_MAX_GOLD) {
        throw new GameError('validation_failed', { field: 'amount', max: PLOT_MAX_GOLD })
      }
      // Einmal am Tag, ueber alle Beete hinweg — sonst waeren vier Beete
      // einfach das Vierfache derselben Geldquelle.
      const lastGold = plots.lastGoldPlantAt(ctx.db, trainer.id)
      if (!goldPlantReady(lastGold, now)) {
        throw new GameError('invalid_state', {
          reason: 'gold_cooldown', readyAt: goldPlantReadyAt(lastGold),
        }, 409)
      }
      inventory.spendGold(ctx.db, trainer.id, input.amount)
    } else {
      const item = input.itemId ? ctx.registry.tryItem(input.itemId) : null
      if (!item) throw new GameError('not_found', { itemId: input.itemId }, 404)
      if (!PLANTABLE.has(item.category) || UNPLANTABLE_ITEMS.has(item.id)) {
        throw new GameError('invalid_state', { reason: 'not_plantable', itemId: item.id }, 409)
      }
      if (input.amount > PLOT_MAX_ITEMS) {
        throw new GameError('validation_failed', { field: 'amount', max: PLOT_MAX_ITEMS })
      }
      inventory.consume(ctx.db, trainer.id, item.id, input.amount)
    }

    /*
     * Duenger wird beim Pflanzen eingesetzt, nicht spaeter.
     *
     * Er verkuerzt die Wachszeit, und die steht als fester Zeitpunkt in der
     * Zeile. Spaeter aufgestreut muesste er eine Frist verkuerzen, die schon
     * halb abgelaufen ist — das ist entweder wirkungslos oder ein Weg, die
     * letzte Minute zu ueberspringen. Beim Pflanzen ist es eine Entscheidung.
     */
    const duenger = fertiliserOf(input.fertiliserId ?? null)
    if (input.fertiliserId && !duenger) {
      throw new GameError('validation_failed', { field: 'fertiliserId' })
    }
    if (duenger) inventory.consume(ctx.db, trainer.id, duenger.itemId, 1)

    const tenderId = resolveTender(ctx, trainer, input.tenderId ?? null, null)
    const created = plots.create(ctx.db, {
      trainerId: trainer.id,
      slot: input.slot,
      stakeKind: input.kind,
      itemId: input.kind === 'gold' ? null : (input.itemId ?? null),
      amount: input.amount,
      plantedAt: now,
      readyAt: now + (duenger ? fertilisedGrowthMs(duenger.percent) : PLOT_GROWTH_MS),
      tenderId,
      fertiliserId: duenger?.itemId ?? null,
    })
    logEvent(ctx.db, trainer.id, 'plot.plant', {
      slot: input.slot, kind: input.kind, itemId: created.itemId, amount: created.amount,
    })
    return state(ctx, trainer, now)
  })
}

/** Prüft einen Pfleger und gibt seine Id zurück; `null` bleibt `null`. */
function resolveTender(
  ctx: AppContext, trainer: Trainer, tenderId: string | null, ownPlotId: string | null,
): string | null {
  if (!tenderId) return null
  const c = creatures.byId(ctx.db, tenderId)
  if (!c) throw new GameError('not_found', { creatureId: tenderId }, 404)
  if (c.ownerId !== trainer.id) throw new GameError('not_owner', { creatureId: tenderId }, 403)
  if (!isTender(ctx, c.speciesId)) {
    throw new GameError('invalid_state', { reason: 'not_a_plant', creatureId: tenderId }, 409)
  }
  if (busyCreatureIds(ctx, trainer.id).has(tenderId)) {
    throw new GameError('invalid_state', { reason: 'on_expedition', creatureId: tenderId }, 409)
  }
  // Dasselbe Pokemon kann nicht zwei Beete pflegen — ausser es ist schon das
  // Pokemon genau dieses Beetes.
  const busy = plots.busyTenderIds(ctx.db, trainer.id)
  if (busy.has(tenderId)) {
    const own = ownPlotId ? plots.openOf(ctx.db, trainer.id).find((p) => p.id === ownPlotId) : null
    if (!own || own.tenderId !== tenderId) {
      throw new GameError('invalid_state', { reason: 'already_tending', creatureId: tenderId }, 409)
    }
  }
  return tenderId
}

export function setTender(
  ctx: AppContext, trainer: Trainer, slot: number, tenderId: string | null, now = Date.now(),
): PlotsState {
  return tx(ctx.db, () => {
    const row = plots.atSlot(ctx.db, trainer.id, slot)
    if (!row) throw new GameError('not_found', { slot }, 404)
    plots.setTender(ctx.db, row.id, resolveTender(ctx, trainer, tenderId, row.id))
    return state(ctx, trainer, now)
  })
}

export interface TendResult {
  kind: 'weed' | 'water'
  phasesDone: number
  bonusPercent: number
  state: PlotsState
}

/**
 * Einen Pflegeschritt erledigen.
 *
 * Nur was fällig ist: die vier Schritte verteilen sich über die Wachstumszeit.
 * Sonst wäre das Beet ein Knopf, den man viermal hintereinander drückt, und
 * die Pflege hätte keinen Bezug mehr zum Wachsen.
 */
export function tend(ctx: AppContext, trainer: Trainer, slot: number, now = Date.now()): TendResult {
  // Ausserhalb der Transaktion: siehe assertPace.
  assertPace(ctx, trainer, 'care', now)
  return tx(ctx.db, () => {

    const row = plots.atSlot(ctx.db, trainer.id, slot)
    if (!row) throw new GameError('not_found', { slot }, 404)
    if (row.tenderId) throw new GameError('invalid_state', { reason: 'tender_assigned' }, 409)
    if (row.phasesDone >= PLOT_PHASES) {
      throw new GameError('invalid_state', { reason: 'fully_tended' }, 409)
    }

    // Dieselbe Laufzeit wie in der Ansicht: ein geduengtes Beet ist frueher
    // fertig, also ruecken auch seine Pflegeschritte zusammen.
    const laufzeit = wachszeit(row)
    const due = phasesDue(row.plantedAt, now, laufzeit, PLOT_PHASES)
    if (due <= row.phasesDone) {
      throw new GameError('invalid_state', {
        reason: 'not_due',
        nextPhaseAt: nextPhaseAt(row.plantedAt, row.phasesDone, laufzeit, PLOT_PHASES),
      }, 409)
    }

    const kind = phaseKind(row.phasesDone)
    energy.spendFor(ctx, trainer.id, 'care', now)
    if (!plots.tend(ctx.db, row.id, row.phasesDone)) {
      throw new GameError('invalid_state', { reason: 'not_due' }, 409)
    }
    recordPace(ctx, trainer, 'care', now)

    const after = plots.atSlot(ctx.db, trainer.id, slot)!
    logEvent(ctx.db, trainer.id, 'plot.tend', { slot, kind, phasesDone: after.phasesDone })
    return {
      kind,
      phasesDone: after.phasesDone,
      bonusPercent: plotBonus({ phasesDone: after.phasesDone, tenderLevel: null }),
      state: state(ctx, trainer, now),
    }
  })
}

export interface HarvestResult {
  kind: 'item' | 'gold'
  itemId: string | null
  name: string
  icon: string
  staked: number
  received: number
  bonusPercent: number
  state: PlotsState
}

export function harvest(ctx: AppContext, trainer: Trainer, slot: number, now = Date.now()): HarvestResult {
  return tx(ctx.db, () => {
    const row = plots.atSlot(ctx.db, trainer.id, slot)
    if (!row) throw new GameError('not_found', { slot }, 404)
    if (!plotReady(row.plantedAt, now, wachszeit(row))) {
      throw new GameError('invalid_state', { reason: 'not_ready', readyAt: row.readyAt }, 409)
    }

    const view = plotView(ctx, trainer, row, slot, now)
    if (!plots.markHarvested(ctx.db, row.id, now)) {
      throw new GameError('invalid_state', { reason: 'already_collected' }, 409)
    }

    if (row.stakeKind === 'gold') inventory.earnGold(ctx.db, trainer.id, view.payout, von(ctx, 'plot.harvest'))
    else inventory.grant(ctx.db, trainer.id, row.itemId!, view.payout, von(ctx, 'plot.harvest'))

    logEvent(ctx.db, trainer.id, 'plot.harvest', {
      slot, kind: row.stakeKind, itemId: row.itemId,
      staked: row.amount, received: view.payout, bonus: view.bonusPercent,
    })

    return {
      kind: row.stakeKind,
      itemId: row.itemId,
      name: view.stake!.name,
      icon: view.stake!.icon,
      staked: row.amount,
      received: view.payout,
      bonusPercent: view.bonusPercent,
      state: state(ctx, trainer, now),
    }
  })
}
