import { GameError, type Trainer } from '@game/shared'
import {
  canBreed, computeStats, createRng, hatchProgress, produceEgg, xpForLevel,
  MIN_BREEDING_LEVEL,
} from '@game/engine'
import type { SpeciesDef } from '@game/content'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as eggs from '../repos/eggs.js'
import * as creatures from '../repos/creatures.js'
import * as dex from '../repos/dex.js'
import { logEvent } from '../repos/events.js'
import { worldClock } from '../worldClock.js'
import { creatureView } from './views.js'
import { awardSeasonPoints, bonuses, bumpMetric } from './progression.js'

const HATCH_LEVEL = 1

/**
 * The base form of an evolution line.
 *
 * Content packs describe evolutions forwards (A becomes B), so the base form
 * has to be found by inverting that map. Doing it once per call is fine: the
 * species table is small and this runs on an explicit player action.
 */
export function baseFormOf(ctx: AppContext, speciesId: string): string {
  const parents = new Map<string, string>()
  for (const s of ctx.registry.obtainableSpecies) {
    for (const evo of s.evolutions) parents.set(evo.to, s.id)
  }
  let current = speciesId
  const seen = new Set<string>([current])
  // The guard is not paranoia: a pack could describe a cycle, and an infinite
  // loop inside a request is far worse than an odd-looking baby.
  while (parents.has(current)) {
    const parent = parents.get(current)!
    if (seen.has(parent)) break
    seen.add(parent)
    current = parent
  }
  return current
}

export interface EggView {
  id: string
  speciesKnown: boolean
  speciesName: string | null
  sprite: string | null
  shiny: boolean
  progress: number
  hatchMinutes: number
  minutesLeft: number
  ready: boolean
  ivPercentHint: string
}

/** IVs are hinted, not revealed: knowing the exact roll before hatching would
 *  turn breeding into a spreadsheet exercise. */
function ivHint(percent: number): string {
  if (percent >= 85) return 'egg.hint.excellent'
  if (percent >= 60) return 'egg.hint.good'
  if (percent >= 35) return 'egg.hint.fair'
  return 'egg.hint.modest'
}

export function eggView(ctx: AppContext, trainer: Trainer, egg: eggs.Egg, now = Date.now()): EggView {
  const progress = hatchProgress(egg.startedAt, egg.hatchMinutes, now)
  const ready = progress >= 1
  const species = ctx.registry.trySpecies(egg.speciesId)
  const ivTotal = Object.values(egg.ivs).reduce((a, b) => a + b, 0)
  return {
    id: egg.id,
    // The species stays hidden until it hatches — that is the whole appeal.
    speciesKnown: ready,
    speciesName: ready && species ? ctx.registry.localized(species.name, trainer.locale) : null,
    sprite: ready && species ? (egg.shiny ? species.spriteShiny : species.sprite) : null,
    shiny: ready ? egg.shiny : false,
    progress,
    hatchMinutes: egg.hatchMinutes,
    minutesLeft: Math.max(0, Math.ceil(egg.hatchMinutes * (1 - progress))),
    ready,
    ivPercentHint: ivHint(Math.round((ivTotal / (31 * 6)) * 100)),
  }
}

export function overview(ctx: AppContext, trainer: Trainer) {
  const now = Date.now()
  const open = eggs.openOf(ctx.db, trainer.id)
  const all = creatures.teamOf(ctx.db, trainer.id).concat(creatures.boxOf(ctx.db, trainer.id, 100))

  return {
    eggs: open.map((e) => eggView(ctx, trainer, e, now)),
    maxEggs: eggs.MAX_OPEN_EGGS,
    minLevel: MIN_BREEDING_LEVEL,
    candidates: all
      .filter((c) => c.level >= MIN_BREEDING_LEVEL)
      .map((c) => {
        const species = ctx.registry.species(c.speciesId)
        return {
          id: c.id,
          name: c.nickname ?? ctx.registry.localized(species.name, trainer.locale),
          sprite: c.shiny ? species.spriteShiny : species.sprite,
          level: c.level,
          eggGroups: species.eggGroups,
          shiny: c.shiny,
        }
      }),
  }
}

export function pair(ctx: AppContext, trainer: Trainer, idA: string, idB: string): EggView {
  return tx(ctx.db, () => {
    if (eggs.openOf(ctx.db, trainer.id).length >= eggs.MAX_OPEN_EGGS) {
      throw new GameError('invalid_state', { reason: 'too_many_eggs', max: eggs.MAX_OPEN_EGGS }, 409)
    }

    const a = creatures.byId(ctx.db, idA)
    const b = creatures.byId(ctx.db, idB)
    if (!a || !b) throw new GameError('not_found', {}, 404)
    if (a.ownerId !== trainer.id || b.ownerId !== trainer.id) throw new GameError('not_owner', {}, 403)

    const speciesA = ctx.registry.species(a.speciesId)
    const speciesB = ctx.registry.species(b.speciesId)
    const check = canBreed(speciesA, speciesB, a.level, b.level, a.id === b.id)
    if (!check.ok) throw new GameError('invalid_state', { reason: check.reason }, 409)

    const rng = createRng(`egg:${trainer.id}:${a.id}:${b.id}:${Date.now()}`)
    const childId = rng.next() < 0.5 ? baseFormOf(ctx, a.speciesId) : baseFormOf(ctx, b.speciesId)
    const child: SpeciesDef = ctx.registry.species(childId)

    const result = produceEgg(
      { speciesId: a.speciesId, ivs: a.ivs, nature: a.nature, shiny: a.shiny },
      { speciesId: b.speciesId, ivs: b.ivs, nature: b.nature, shiny: b.shiny },
      child, rng,
    )

    // Die Brutstation verkuerzt die Wartezeit; sie wird beim Anlegen des Eis
    // verrechnet, damit ein spaeterer Ausbau laufende Eier nicht rueckwirkend
    // beschleunigt.
    const speedUp = 1 - bonuses(ctx, trainer.id).hatchSpeedBonus / 100
    const created = eggs.create(ctx.db, {
      trainerId: trainer.id,
      speciesId: result.speciesId,
      nature: result.nature,
      ivs: result.ivs,
      shiny: result.shiny,
      hatchMinutes: Math.max(5, Math.round(result.hatchMinutes * Math.max(0.4, speedUp))),
      startedAt: Date.now(),
      parentA: a.id,
      parentB: b.id,
    })
    logEvent(ctx.db, trainer.id, 'egg.created', { speciesId: result.speciesId, parents: [a.id, b.id] })
    return eggView(ctx, trainer, created)
  })
}

export function hatch(ctx: AppContext, trainer: Trainer, eggId: string) {
  return tx(ctx.db, () => {
    const egg = eggs.byId(ctx.db, eggId)
    if (!egg || egg.trainerId !== trainer.id) throw new GameError('not_found', { eggId }, 404)
    if (egg.hatchedAt) throw new GameError('invalid_state', { reason: 'already_hatched' }, 409)

    const now = Date.now()
    if (hatchProgress(egg.startedAt, egg.hatchMinutes, now) < 1) {
      throw new GameError('invalid_state', { reason: 'not_ready', minutesLeft: Math.ceil(egg.hatchMinutes * (1 - hatchProgress(egg.startedAt, egg.hatchMinutes, now))) }, 409)
    }
    if (!eggs.markHatched(ctx.db, egg.id, now)) {
      throw new GameError('invalid_state', { reason: 'already_hatched' }, 409)
    }

    const species = ctx.registry.species(egg.speciesId)
    const stats = computeStats(species, HATCH_LEVEL, egg.ivs, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, egg.nature)

    const created = creatures.insertCreature(ctx.db, {
      ownerId: trainer.id,
      speciesId: egg.speciesId,
      level: HATCH_LEVEL,
      xp: xpForLevel(species.growthRate, HATCH_LEVEL),
      nature: egg.nature,
      ivs: egg.ivs,
      // Hatched creatures start attached — they have known you since birth.
      friendship: 120,
      hpCurrent: stats.hp,
      shiny: egg.shiny,
      moves: ctx.registry.learnableAt(egg.speciesId, HATCH_LEVEL).slice(0, 4),
      caughtAreaId: null,
      teamSlot: null,
    })
    const newDexEntry = dex.markCaught(ctx.db, trainer.id, egg.speciesId)
    awardSeasonPoints(ctx, trainer.id, 'eggHatch')
    if (newDexEntry) awardSeasonPoints(ctx, trainer.id, 'newDexEntry')
    bumpMetric(ctx, trainer.id, 'eggsHatched')
    logEvent(ctx.db, trainer.id, 'egg.hatched', { speciesId: egg.speciesId, shiny: egg.shiny })

    return {
      creature: creatureView(ctx.registry, created, trainer.locale, worldClock().timeOfDay),
      newDexEntry,
    }
  })
}
