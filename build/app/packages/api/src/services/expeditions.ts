import { GameError, type Trainer } from '@game/shared'
import {
  createRng, energyCost, findDuration, findKind, partyRating, resolveExpedition,
  grantXpTo, computeStats, DURATIONS, ENERGY_COSTS, EXPEDITION_ENERGY, KINDS,
  MAX_PARTY, MIN_PARTY, rushCost, expectedOutcome, fitsExpedition, type ExpeditionParty,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as expeditions from '../repos/expeditions.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import { logEvent } from '../repos/events.js'
import { requireCurrentArea } from './world.js'
import * as energy from './energy.js'
import { capOf } from './travel.js'
import { awardSeasonPoints, bonuses } from './progression.js'
import { busyCreatureIds } from './busy.js'
import { catchUpEnergy } from './garden.js'
import { researchBonuses } from './research.js'

/**
 * Wie viele Erkundungen gleichzeitig laufen duerfen: beliebig viele.
 *
 * Frueher waren es drei. Die eigentliche Grenze zieht ohnehin das Material —
 * jede Expedition kostet Trainer-Energie, verbraucht die Ausdauer ihrer
 * Teilnehmer und bindet sie fuer die Laufzeit. Eine zusaetzliche Zahl obendrauf
 * hat nur genervt.
 */

export interface ExpeditionView {
  id: string
  kind: string
  kindName: string
  duration: string
  areaName: string
  startedAt: number
  endsAt: number
  ready: boolean
  /** Energie, um den Rest zu ueberspringen; 0, wenn sie ohnehin fertig ist. */
  rushCost: number
  members: Array<{ id: string; name: string; sprite: string; level: number }>
}

const KIND_NAMES: Record<string, string> = {
  forage: 'expedition.kind.forage',
  dig: 'expedition.kind.dig',
  dive: 'expedition.kind.dive',
  patrol: 'expedition.kind.patrol',
}

function toView(ctx: AppContext, trainer: Trainer, e: expeditions.Expedition, now: number): ExpeditionView {
  const area = ctx.registry.tryArea(e.areaId)
  const members = e.party.map((id) => {
    const c = creatures.byId(ctx.db, id)
    if (!c) return { id, name: '?', sprite: '', level: 0 }
    const species = ctx.registry.species(c.speciesId)
    return {
      id,
      name: c.nickname ?? ctx.registry.localized(species.name, trainer.locale),
      sprite: c.shiny ? species.spriteShiny : species.sprite,
      level: c.level,
    }
  })
  return {
    id: e.id,
    kind: e.kind,
    kindName: KIND_NAMES[e.kind] ?? e.kind,
    duration: e.duration,
    areaName: area ? ctx.registry.localized(area.name, trainer.locale) : e.areaId,
    startedAt: e.startedAt,
    endsAt: e.endsAt,
    ready: now >= e.endsAt,
    /** Was es kostet, den Rest zu ueberspringen. */
    rushCost: now >= e.endsAt ? 0 : rushCost(e.endsAt - now),
    members,
  }
}

/** Trainer-Energie je Dauer. Laengere Reisen bringen mehr und kosten mehr. */
export const trainerEnergyFor = (durationId: string): number =>
  EXPEDITION_ENERGY[durationId] ?? ENERGY_COSTS.expedition

export function overview(ctx: AppContext, trainer: Trainer) {
  const now = Date.now()
  // Erst erholen, dann anzeigen. Sonst steht hier die Ausdauer von zuletzt,
  // und ein Pokemon sieht zu erschoepft aus, obwohl es laengst wieder kann.
  catchUpEnergy(ctx, trainer, now)
  const open = expeditions.openOf(ctx.db, trainer.id)
  const busy = busyCreatureIds(ctx, trainer.id)

  return {
    open: open.map((e) => toView(ctx, trainer, e, now)),
    /** null = unbegrenzt. Das Feld bleibt, damit der Client eine Zahl anzeigen
     *  koennte, falls je wieder eine Grenze noetig wird. */
    maxOpen: null as number | null,
    energy: energy.state(ctx, trainer.id),
    kinds: KINDS.map((k) => ({
      id: k.id,
      name: KIND_NAMES[k.id] ?? k.id,
      // Die Expeditionsarten nennen Typen fest; ein kleineres Content-Pack
      // kennt womoeglich nicht alle. Unbekannte werden ausgelassen statt den
      // ganzen Bildschirm scheitern zu lassen.
      favouredTypes: k.favouredTypes
        .map((t) => ctx.registry.tryType(t))
        .filter((t): t is NonNullable<typeof t> => t !== undefined)
        .map((type) => ({ id: type.id, name: ctx.registry.localized(type.name, trainer.locale), color: type.color })),
    })),
    durations: DURATIONS.map((d) => ({
      id: d.id,
      minutes: d.minutes,
      /** Ausdauer, die jedes mitgeschickte Pokemon kostet. */
      energyCost: energyCost(d),
      /** Trainer-Energie, die der Start kostet. */
      trainerEnergyCost: trainerEnergyFor(d.id),
    })),
    /*
     * Was ungefaehr herauskommt — je Art und Dauer, bei vollem Team.
     *
     * Gerechnet aus derselben Tabelle, aus der auch gezogen wird. Vorher stand
     * nirgends, was eine Expedition einbringt; man waehlte zwischen "Graben"
     * und "Tauchen", ohne den Unterschied sehen zu koennen.
     *
     * Angegeben wird der beste Fall. Die Alternative waere, es an die gerade
     * angetippte Auswahl zu binden — dann aendert sich die Zahl bei jedem
     * Tipp, und man vergleicht Aepfel mit dem, was man gerade anhat.
     */
    expected: KINDS.flatMap((k) =>
      DURATIONS.map((d) => {
        const e = expectedOutcome(k, d, 1, MAX_PARTY)
        return {
          kindId: k.id,
          durationId: d.id,
          gold: e.gold,
          xpPerMember: e.xpPerMember,
          loot: e.loot
            .sort((a, b) => b.quantity - a.quantity)
            .map((l) => {
              const item = ctx.registry.tryItem(l.itemId)
              return {
                itemId: l.itemId,
                name: item ? ctx.registry.localized(item.name, trainer.locale) : l.itemId,
                icon: item?.icon ?? '',
                quantity: l.quantity,
              }
            }),
        }
      })),
    available: creatures.teamOf(ctx.db, trainer.id)
      .concat(creatures.boxOf(ctx.db, trainer.id, 500))
      .filter((c) => !busy.has(c.id))
      .map((c) => {
        const species = ctx.registry.species(c.speciesId)
        return {
          id: c.id,
          name: c.nickname ?? ctx.registry.localized(species.name, trainer.locale),
          sprite: c.shiny ? species.spriteShiny : species.sprite,
          level: c.level,
          energy: c.energy,
          types: species.types,
          /** Auf welche Arten von Expedition dieses Pokemon ueberhaupt darf. */
          fitsKinds: KINDS.filter((k) => fitsExpedition(species.types, k)).map((k) => k.id),
        }
      }),
    partyRange: { min: MIN_PARTY, max: MAX_PARTY },
  }
}

export function start(
  ctx: AppContext,
  trainer: Trainer,
  kindId: string,
  durationId: string,
  creatureIds: string[],
): ExpeditionView {
  const kind = findKind(kindId)
  const duration = findDuration(durationId)
  if (!kind || !duration) throw new GameError('validation_failed', { field: 'kind/duration' })

  const unique = [...new Set(creatureIds)]
  if (unique.length < MIN_PARTY || unique.length > MAX_PARTY) {
    throw new GameError('validation_failed', { field: 'creatureIds', min: MIN_PARTY, max: MAX_PARTY })
  }

  return tx(ctx.db, () => {
    // Und erst recht vor dem Start: an einer veralteten Zahl darf niemand
    // scheitern.
    catchUpEnergy(ctx, trainer)
    const busy = busyCreatureIds(ctx, trainer.id)
    const cost = energyCost(duration)

    for (const id of unique) {
      const c = creatures.byId(ctx.db, id)
      if (!c) throw new GameError('not_found', { creatureId: id }, 404)
      if (c.ownerId !== trainer.id) throw new GameError('not_owner', { creatureId: id }, 403)
      if (busy.has(id)) throw new GameError('invalid_state', { reason: 'already_away', creatureId: id }, 409)
      // Der Typ ist die Eintrittskarte. Der Client blendet Unpassende schon
      // aus; hier steht die Regel, denn der Client ist nur eine Anzeige.
      if (!fitsExpedition(ctx.registry.species(c.speciesId).types, kind)) {
        throw new GameError('invalid_state', { reason: 'wrong_type', creatureId: id, kindId: kind.id }, 409)
      }
      if (c.energy < cost) {
        throw new GameError('invalid_state', { reason: 'too_tired', creatureId: id, need: cost, have: c.energy }, 409)
      }
    }

    // Erst die Trainer-Energie: schlaegt sie fehl, ist noch nichts veraendert.
    energy.spend(ctx, trainer.id, trainerEnergyFor(duration.id), `expedition:${duration.id}`)

    // Energy is spent up front, so a player cannot queue three expeditions with
    // the same exhausted creature by starting them in quick succession.
    for (const id of unique) {
      ctx.db.prepare('UPDATE creatures SET energy = MAX(0, energy - ?) WHERE id = ?').run(cost, id)
    }

    const area = requireCurrentArea(ctx, trainer)
    const now = Date.now()
    const created = expeditions.create(ctx.db, {
      trainerId: trainer.id,
      kind: kind.id,
      duration: duration.id,
      areaId: area.id,
      party: unique,
      seed: `${trainer.id}:${now}:${kind.id}`,
      startedAt: now,
      endsAt: now + duration.minutes * 60_000,
    })
    logEvent(ctx.db, trainer.id, 'expedition.start', { kind: kind.id, duration: duration.id, party: unique })
    return toView(ctx, trainer, created, now)
  })
}

export interface CollectResult {
  loot: Array<{ itemId: string; name: string; quantity: number; icon: string; category: string }>
  gold: number
  xpPerMember: number
  levelUps: Array<{ creatureId: string; name: string; newLevel: number }>
}

/**
 * Eine laufende Expedition vorziehen.
 *
 * Die Energie ist der Preis für die Zeit — und weil sie sich von selbst füllt,
 * ist das kein Verkauf von Fortschritt, sondern eine Umschichtung: wer
 * beschleunigt, erkundet in der Zwischenzeit weniger.
 */
export function rush(
  ctx: AppContext, trainer: Trainer, expeditionId: string, now = Date.now(),
): { cost: number; endsAt: number } {
  return tx(ctx.db, () => {
    const e = expeditions.byId(ctx.db, expeditionId)
    if (!e || e.trainerId !== trainer.id) throw new GameError('not_found', { expeditionId }, 404)
    if (e.collectedAt !== null) throw new GameError('invalid_state', { reason: 'already_collected' }, 409)
    if (now >= e.endsAt) throw new GameError('invalid_state', { reason: 'already_ready' }, 409)

    const cost = rushCost(e.endsAt - now)
    energy.spend(ctx, trainer.id, cost, `rush:${expeditionId}`, now)
    expeditions.setEndsAt(ctx.db, e.id, now)
    logEvent(ctx.db, trainer.id, 'expedition.rush', { expeditionId, cost })
    return { cost, endsAt: now }
  })
}

export function collect(ctx: AppContext, trainer: Trainer, expeditionId: string): CollectResult {
  return tx(ctx.db, () => {
    const e = expeditions.byId(ctx.db, expeditionId)
    if (!e || e.trainerId !== trainer.id) throw new GameError('not_found', { expeditionId }, 404)
    if (e.collectedAt) throw new GameError('invalid_state', { reason: 'already_collected' }, 409)

    const now = Date.now()
    if (now < e.endsAt) {
      throw new GameError('invalid_state', { reason: 'not_ready', endsAt: e.endsAt, now }, 409)
    }

    const kind = findKind(e.kind)
    const duration = findDuration(e.duration)
    if (!kind || !duration) throw new GameError('invalid_state', { reason: 'unknown_expedition' }, 409)

    const party: ExpeditionParty[] = e.party.flatMap((id) => {
      const c = creatures.byId(ctx.db, id)
      // A creature released while away simply does not contribute.
      return c ? [{ creatureId: c.id, speciesId: c.speciesId, level: c.level, energy: c.energy }] : []
    })

    const rating = partyRating(party, kind, (id) => ctx.registry.species(id))
    // The seed was fixed at start time, so the outcome was already determined
    // then: collecting late or early cannot change it.
    const outcome = resolveExpedition(kind, duration, rating, party, createRng(e.seed))

    if (!expeditions.markCollected(ctx.db, e.id, now)) {
      throw new GameError('invalid_state', { reason: 'already_collected' }, 409)
    }

    // Die Beerenfarm erhoeht die Ausbeute anteilig, nicht die Wuerfe selbst —
    // so bleibt das Ergebnis der Expedition durch ihren Seed festgelegt.
    const lootBonus = 1
      + (bonuses(ctx, trainer.id).expeditionLootBonus
        + researchBonuses(ctx, trainer.id).expeditionLoot) / 100
    for (const l of outcome.loot) {
      inventory.grant(ctx.db, trainer.id, l.itemId, Math.max(1, Math.round(l.quantity * lootBonus)))
    }
    inventory.earnGold(ctx.db, trainer.id, Math.round(outcome.gold * lootBonus))
    awardSeasonPoints(ctx, trainer.id, 'expeditionCollect')

    const levelUps: CollectResult['levelUps'] = []
    const cap = capOf(ctx, trainer)
    for (const member of party) {
      const c = creatures.byId(ctx.db, member.creatureId)!
      const species = ctx.registry.species(c.speciesId)
      const share = Math.max(1, Math.round(outcome.xpPerMember / (species.xpFactor ?? 1)))
      const gained = grantXpTo(species.growthRate, c.xp, c.level, share, cap)
      ctx.db.prepare('UPDATE creatures SET xp = ?, level = ? WHERE id = ?')
        .run(gained.totalXp, gained.levelAfter, c.id)
      if (gained.levelsGained > 0) {
        const before = computeStats(species, gained.levelBefore, c.ivs, c.evs, c.nature)
        const after = computeStats(species, gained.levelAfter, c.ivs, c.evs, c.nature)
        creatures.setHp(ctx.db, c.id, Math.min(after.hp, c.hpCurrent + (after.hp - before.hp)))
        levelUps.push({
          creatureId: c.id,
          name: c.nickname ?? ctx.registry.localized(species.name, trainer.locale),
          newLevel: gained.levelAfter,
        })
      }
    }

    logEvent(ctx.db, trainer.id, 'expedition.collect', { kind: e.kind, gold: outcome.gold, loot: outcome.loot })

    return {
      gold: outcome.gold,
      xpPerMember: outcome.xpPerMember,
      levelUps,
      loot: outcome.loot.map((l) => {
        const item = ctx.registry.tryItem(l.itemId)
        return {
          itemId: l.itemId,
          quantity: l.quantity,
          name: item ? ctx.registry.localized(item.name, trainer.locale) : l.itemId,
          icon: item?.icon ?? '',
          category: item?.category ?? 'material',
        }
      }),
    }
  })
}
