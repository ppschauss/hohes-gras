import { GameError, type Trainer } from '@game/shared'
import { von } from './ledger.js'
import {
  canBreed, computeStats, createRng, hatchProgress, produceEgg, xpForLevel,
  BROOD_PHASES, BROOD_SHINY_BONUS, broodCare, broodIvBonus, broodMinutes, UNBREEDABLE_GROUPS,
  broodPhaseKind, broodPhasesDue, broodShinyExtra, nextBroodPhaseAt,
  IV_MAX, ivPercent, SHINY_BASE_ODDS, MIN_BREEDING_LEVEL,
} from '@game/engine'
import type { SpeciesDef } from '@game/content'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as eggs from '../repos/eggs.js'
import * as creatures from '../repos/creatures.js'
import * as dex from '../repos/dex.js'
import * as inventory from '../repos/inventory.js'
import { logEvent } from '../repos/events.js'
import { worldClock } from '../worldClock.js'
import { creatureView } from './views.js'
import { awardSeasonPoints, bonuses, bumpMetric } from './progression.js'
import { busyCreatureIds } from './busy.js'

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
  /* ---------------------------------------------------------- Brut-Beet */
  /** Erledigte Pflegeschritte, und wie viele es insgesamt sind. */
  phasesDone: number
  phases: number
  /** Ist gerade einer fällig? */
  phaseDue: boolean
  /** Wärmen oder wenden — der nächste Handgriff. */
  phaseKind: 'warm' | 'turn'
  /** Wann der nächste fällig wird; null, wenn alle durch sind. */
  nextPhaseAt: number | null
  /** Wer das Ei automatisch wärmt. */
  brooder: { id: string; name: string; sprite: string; level: number } | null
  /** Wie gut versorgt es ist, 0 bis 1 — daraus folgen die drei Boni. */
  care: number
  /** Was die Pflege gerade wert ist. */
  minutesSaved: number
  ivBonus: number
  shinyFactor: number
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
  /*
   * Die Pflege verkuerzt die Brutzeit, also muss sie vor dem Fortschritt
   * stehen: sonst zeigte der Balken eine Zeit an, die gar nicht mehr gilt.
   */
  const brooder = egg.brooderId ? creatures.byId(ctx.db, egg.brooderId) : null
  const care = broodCare(egg.phasesDone, brooder?.level ?? null)
  const minutes = broodMinutes(egg.hatchMinutes, care)
  const totalMs = egg.hatchMinutes * 60_000
  const progress = hatchProgress(egg.startedAt, minutes, now)
  const ready = progress >= 1
  const due = broodPhasesDue(egg.startedAt, now, totalMs)
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
    hatchMinutes: minutes,
    minutesLeft: Math.max(0, Math.ceil(minutes * (1 - progress))),
    ready,
    ivPercentHint: ivHint(Math.round((ivTotal / (31 * 6)) * 100)),
    phasesDone: egg.phasesDone,
    phases: BROOD_PHASES,
    // Ein Schritt ist faellig, wenn die Zeit ihn freigegeben hat und er noch
    // nicht erledigt ist — und solange ein Brueter danebenliegt, gar nicht:
    // der macht die Arbeit.
    phaseDue: !brooder && !ready && due > egg.phasesDone,
    phaseKind: broodPhaseKind(egg.phasesDone),
    nextPhaseAt: brooder ? null : nextBroodPhaseAt(egg.startedAt, egg.phasesDone, totalMs),
    brooder: brooder
      ? {
          id: brooder.id,
          name: brooder.nickname
            ?? ctx.registry.localized(ctx.registry.species(brooder.speciesId).name, trainer.locale),
          sprite: brooder.shiny
            ? ctx.registry.species(brooder.speciesId).spriteShiny
            : ctx.registry.species(brooder.speciesId).sprite,
          level: brooder.level,
        }
      : null,
    care,
    minutesSaved: egg.hatchMinutes - minutes,
    ivBonus: broodIvBonus(care),
    shinyFactor: 1 + BROOD_SHINY_BONUS * care,
  }
}

/**
 * Einen Pflegeschritt erledigen.
 *
 * Kostet nichts ausser Aufmerksamkeit — wie im Poke-Beet. Der Preis ist, dass
 * man da sein muss: die Schritte werden ueber die Brutzeit verteilt faellig,
 * und wer erst am Ende vorbeikommt, holt nur noch einen davon nach.
 */
export function tend(ctx: AppContext, trainer: Trainer, eggId: string): EggView {
  return tx(ctx.db, () => {
    const egg = eggs.byId(ctx.db, eggId)
    if (!egg || egg.trainerId !== trainer.id) throw new GameError('not_found', { eggId }, 404)
    if (egg.hatchedAt) throw new GameError('invalid_state', { reason: 'already_hatched' }, 409)
    if (egg.brooderId) throw new GameError('invalid_state', { reason: 'already_tended' }, 409)

    const totalMs = egg.hatchMinutes * 60_000
    const due = broodPhasesDue(egg.startedAt, Date.now(), totalMs)
    if (due <= egg.phasesDone) {
      throw new GameError('invalid_state', {
        reason: 'not_ready',
        nextAt: nextBroodPhaseAt(egg.startedAt, egg.phasesDone, totalMs),
      }, 409)
    }
    if (!eggs.tend(ctx.db, egg.id, egg.phasesDone)) {
      throw new GameError('invalid_state', { reason: 'already_tended' }, 409)
    }
    logEvent(ctx.db, trainer.id, 'egg.tended', { eggId, phase: egg.phasesDone + 1 })
    return eggView(ctx, trainer, eggs.byId(ctx.db, egg.id)!)
  })
}

/**
 * Ein Pokemon ans Ei legen — oder wieder wegnehmen.
 *
 * Es ist danach nicht mehr verfuegbar, genau wie ein Beetpfleger. Das ist der
 * Preis dafuer, nicht selbst vorbeischauen zu muessen.
 */
export function setBrooder(
  ctx: AppContext, trainer: Trainer, eggId: string, creatureId: string | null,
): EggView {
  return tx(ctx.db, () => {
    const egg = eggs.byId(ctx.db, eggId)
    if (!egg || egg.trainerId !== trainer.id) throw new GameError('not_found', { eggId }, 404)
    if (egg.hatchedAt) throw new GameError('invalid_state', { reason: 'already_hatched' }, 409)

    if (creatureId !== null) {
      const c = creatures.byId(ctx.db, creatureId)
      if (!c || c.ownerId !== trainer.id) throw new GameError('not_found', { creatureId }, 404)
      if (creatureId !== egg.brooderId && busyCreatureIds(ctx, trainer.id).has(creatureId)) {
        throw new GameError('invalid_state', { reason: 'creature_busy', creatureId }, 409)
      }
    }
    eggs.setBrooder(ctx.db, egg.id, creatureId)
    logEvent(ctx.db, trainer.id, 'egg.brooder', { eggId, creatureId })
    return eggView(ctx, trainer, eggs.byId(ctx.db, egg.id)!)
  })
}

export function overview(ctx: AppContext, trainer: Trainer) {
  const now = Date.now()
  const open = eggs.openOf(ctx.db, trainer.id)
  const all = creatures.teamOf(ctx.db, trainer.id).concat(creatures.allBoxOf(ctx.db, trainer.id))

  return {
    eggs: open.map((e) => eggView(ctx, trainer, e, now)),
    maxEggs: eggSlots(ctx, trainer.id),
    minLevel: MIN_BREEDING_LEVEL,
    /*
     * Was die Brutstation gerade abzieht — und fuer wen.
     *
     * Gemeldet: "Brutstation geupgraded, die Zeit fuers Ei ist immer noch auf
     * 2 Stunden". Sie war es nicht: 240 Minuten Grundzeit waren durch den
     * Ausbau schon auf 120 gefallen. Nur stand das nirgends, und ein bereits
     * gelegtes Ei behaelt seine Zeit ohnehin. Beides sagt der Bildschirm
     * jetzt, statt es den Spieler an den Zahlen ablesen zu lassen.
     */
    hatchSpeedBonus: bonuses(ctx, trainer.id).hatchSpeedBonus,
    candidates: all
      /*
       * Wer keine Ei-Gruppe hat, gehoert nicht in die Auswahl.
       *
       * Er stand vorher drin und wurde bei jedem Versuch abgelehnt — eine
       * Liste, die Dinge anbietet, die nie gehen, ist eine Falle. Betrifft
       * Legendaere und die besonderen Arten.
       */
      .filter((c) => {
        const groups = ctx.registry.species(c.speciesId).eggGroups
        return groups.some((g) => !UNBREEDABLE_GROUPS.has(g))
      })
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
          /*
           * Wesen und Veranlagung stehen jetzt auch hier.
           *
           * Beides wird vererbt, und beides entscheidet, welches Paar sich
           * lohnt — bei der Zucht mehr als irgendwo sonst. Sichtbar war es
           * bisher nur im Garten und in der Box, also musste man vor der Wahl
           * den Bildschirm wechseln und sich Zahlen merken.
           */
          nature: c.nature,
          ivs: c.ivs,
          ivPercent: ivPercent(c.ivs),
          stats: computeStats(species, c.level, c.ivs, c.evs, c.nature),
        }
      }),
  }
}

export function pair(ctx: AppContext, trainer: Trainer, idA: string, idB: string): EggView {
  return tx(ctx.db, () => {
    const max = eggSlots(ctx, trainer.id)
    if (eggs.openOf(ctx.db, trainer.id).length >= max) {
      throw new GameError('invalid_state', { reason: 'too_many_eggs', max }, 409)
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

/**
 * Ein Ei sofort fertig machen.
 *
 * Nur mit dem Brutbeschleuniger, und den gibt es ausschliesslich ueber
 * `/gegenstand` beim Admin. Verschoben wird der Startzeitpunkt, nicht der
 * Fortschritt: damit greift alles Weitere — Pflegephasen, IV-Bonus, Shiny-
 * Faktor — unveraendert, statt dass hier eine zweite Rechnung entsteht.
 */
export function rushEgg(ctx: AppContext, trainer: Trainer, eggId: string): EggView {
  return tx(ctx.db, () => {
    const egg = eggs.byId(ctx.db, eggId)
    if (!egg || egg.trainerId !== trainer.id) throw new GameError('not_found', { eggId }, 404)
    if (egg.hatchedAt !== null) throw new GameError('invalid_state', { reason: 'already_claimed' }, 409)
    if (inventory.quantityOf(ctx.db, trainer.id, EGG_WARMER_ID) < 1) {
      throw new GameError('insufficient_items', { itemId: EGG_WARMER_ID }, 409)
    }
    inventory.consume(ctx.db, trainer.id, EGG_WARMER_ID, 1)
    // Weit genug zurueck, dass auch die volle Brutzeit ohne Pflege vorbei ist.
    ctx.db.prepare('UPDATE eggs SET started_at = ? WHERE id = ?')
      .run(Date.now() - egg.hatchMinutes * 60_000 - 1000, eggId)
    logEvent(ctx.db, trainer.id, 'egg.rushed', { eggId })
    return eggView(ctx, trainer, eggs.byId(ctx.db, eggId)!)
  })
}

/** Der Prüfgegenstand, der `rushEgg` freischaltet. */
export const EGG_WARMER_ID = 'egg-warmer'

export function hatch(ctx: AppContext, trainer: Trainer, eggId: string) {
  return tx(ctx.db, () => {
    const egg = eggs.byId(ctx.db, eggId)
    if (!egg || egg.trainerId !== trainer.id) throw new GameError('not_found', { eggId }, 404)
    if (egg.hatchedAt) throw new GameError('invalid_state', { reason: 'already_hatched' }, 409)

    const now = Date.now()
    const brooder = egg.brooderId ? creatures.byId(ctx.db, egg.brooderId) : null
    const care = broodCare(egg.phasesDone, brooder?.level ?? null)
    const minutes = broodMinutes(egg.hatchMinutes, care)
    if (hatchProgress(egg.startedAt, minutes, now) < 1) {
      throw new GameError('invalid_state', {
        reason: 'not_ready',
        minutesLeft: Math.ceil(minutes * (1 - hatchProgress(egg.startedAt, minutes, now))),
      }, 409)
    }
    if (!eggs.markHatched(ctx.db, egg.id, now)) {
      throw new GameError('invalid_state', { reason: 'already_hatched' }, 409)
    }

    const species = ctx.registry.species(egg.speciesId)
    /*
     * Was die Pflege eingebracht hat.
     *
     * Die Werte steigen hier und nicht beim Legen: sonst stuende das Ergebnis
     * schon fest, bevor sich jemand gekuemmert hat. Der Shiny-Zuschlag ist ein
     * eigener, kleiner Wurf — das Ei hatte seinen beim Legen, und wer gepflegt
     * hat, bekommt die Differenz nachgereicht.
     */
    const bonus = broodIvBonus(care)
    const ivs = Object.fromEntries(
      Object.entries(egg.ivs).map(([k, v]) => [k, Math.min(IV_MAX, v + bonus)]),
    ) as typeof egg.ivs
    const shiny = egg.shiny || (care > 0 && createRng(`brood:${egg.id}`)
      .chance(broodShinyExtra(SHINY_BASE_ODDS, care) * 100))
    const stats = computeStats(species, HATCH_LEVEL, ivs, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, egg.nature)

    const created = creatures.insertCreature(ctx.db, {
      ownerId: trainer.id,
      speciesId: egg.speciesId,
      level: HATCH_LEVEL,
      xp: xpForLevel(species.growthRate, HATCH_LEVEL),
      nature: egg.nature,
      ivs,
      // Hatched creatures start attached — they have known you since birth.
      friendship: 120,
      hpCurrent: stats.hp,
      shiny,
      moves: ctx.registry.learnableAt(egg.speciesId, HATCH_LEVEL).slice(0, 4),
      caughtAreaId: null,
      teamSlot: null,
    }, von(ctx, 'egg.hatch'))
    const newDexEntry = dex.markCaught(ctx.db, trainer.id, egg.speciesId)
    awardSeasonPoints(ctx, trainer.id, 'eggHatch')
    if (newDexEntry) awardSeasonPoints(ctx, trainer.id, 'newDexEntry')
    bumpMetric(ctx, trainer.id, 'eggsHatched')
    logEvent(ctx.db, trainer.id, 'egg.hatched', {
      speciesId: egg.speciesId, shiny, care, ivBonus: bonus,
    })

    return {
      creature: creatureView(ctx.registry, created, trainer.locale, worldClock().timeOfDay),
      newDexEntry,
      /** Was die Pflege am Ende ausgemacht hat — sonst sieht man sie nie. */
      care: { share: care, ivBonus: bonus, shinyByCare: shiny && !egg.shiny },
    }
  })
}

/**
 * Wie viele Eier gleichzeitig offen sein duerfen.
 *
 * Grundstock plus Brutkammer. Alle Stellen fragen hier — eine zweite, fest
 * verdrahtete Zahl waere beim Ausbau zurueckgeblieben.
 */
export function eggSlots(ctx: AppContext, trainerId: string): number {
  return eggs.MAX_OPEN_EGGS + bonuses(ctx, trainerId).eggSlotBonus
}
