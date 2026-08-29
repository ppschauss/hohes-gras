import { GameError, NATURES, type Trainer } from '@game/shared'
import {
  attemptCatch, BOX_BASE_LIMIT, catchProbability, catchReward, computeStats, createRng, deriveSeed,
  rollCatchDrop,
  ENERGY_REWARDS, LEGENDARY_CATCH_RATE, LEGENDARY_LEVEL_BONUS, randomIvs, rollEncounter,
  isEventTrainer, LEGENDARY_BERRY_ID, LEGENDARY_MAX_BERRIES, isLegendaryCatchRate,
  legendaryCatchChance, rollEvent, rollLegendary, xpForLevel, type Rng,
  coinPurse, findQuantity, findValueCap, METAL_DETECTOR_ID, METAL_DETECTOR_CHARGES,
  rollFind, rollFindKind, rollWander, WANDER_PARTY_MAX, type FindKind,
  MAX_CALM_STACKS, MAX_WEAKEN_STACKS, ROCKET_BAIT_ID, ROCKET_BAIT_CHARGES,
  SHINY_BASE_ODDS, SHINY_CHAIN_AFTER_CATCH, SHINY_CHAIN_GUARANTEE,
  SHINY_CHAIN_PLATEAU, SHINY_PLATEAU_ODDS, shinyOdds,
  type CatchModifiers, type LureEffect,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as encounters from '../repos/encounters.js'
import * as world from '../repos/world.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import * as dex from '../repos/dex.js'
import { bumpCounter, counterValue } from '../repos/counters.js'
import * as energy from './energy.js'
import * as teams from './teams.js'
import { assertPace, recordPace } from './pacing.js'
import { areaOffset } from './scaling.js'
import { clearedRegions } from './league.js'
import { logEvent } from '../repos/events.js'
import { worldClock } from '../worldClock.js'
import { requireCurrentArea } from './world.js'
import { creatureView } from './views.js'
import { awardSeasonPoints, bonuses, bumpMetric } from './progression.js'
import { researchBonuses } from './research.js'

/**
 * Erkundungen sind unbegrenzt.
 *
 * Frueher gab es ein Tageskontingent und danach eine Goldgebuehr. Beides ist
 * weg: eine Begegnung kostet Trainer-Energie, sonst nichts. Der Zaehler bleibt,
 * weil er in den Seed jeder Begegnung eingeht und die Statistik traegt.
 */
export const EXPLORE_COUNTER = 'explore'

/**
 * Wie viele Pokemon jemand halten kann.
 *
 * Grundstock plus Depot. Frueher stand hier eine feste 300 — die reichte fuer
 * eine Region und wurde zur Wand, sobald es drei wurden.
 */
export function boxLimit(ctx: AppContext, trainerId: string): number {
  return BOX_BASE_LIMIT + bonuses(ctx, trainerId).boxSlotBonus
}

export interface EncounterView {
  /** Art schon im Dex — die Safari zeigt dann einen Ball neben dem Level. */
  caught: boolean
  active: boolean
  areaId: string
  areaName: string
  speciesId: string
  speciesName: string
  sprite: string
  types: Array<{ id: string; name: string; color: string }>
  level: number
  shiny: boolean
  rarity: string
  turn: number
  weakenStacks: number
  calmStacks: number
  maxWeaken: number
  maxCalm: number
  /** Catch chance with the currently selected ball and berry, 0..1. */
  probability: number
  chain: number
  /** Ein Legendaeres folgt eigenen Fangregeln. */
  legendary: boolean
  legendaryBerries: number
  maxLegendaryBerries: number
  /** Wie viele Sagenbeeren im Beutel liegen. */
  berriesOwned: number
}

export function encounterView(
  ctx: AppContext,
  trainer: Trainer,
  e: encounters.ActiveEncounter,
  ballId: string,
  berryId: string | null,
): EncounterView {
  const species = ctx.registry.species(e.speciesId)
  const area = ctx.registry.area(e.areaId)
  const legendary = isLegendaryCatchRate(species.catchRate)
  const mods = buildModifiers(ctx, trainer, e, ballId, berryId)
  return {
    active: true,
    areaId: e.areaId,
    areaName: ctx.registry.localized(area.name, trainer.locale),
    speciesId: e.speciesId,
    speciesName: ctx.registry.localized(species.name, trainer.locale),
    sprite: e.shiny ? species.spriteShiny : species.sprite,
    types: species.types.map((id) => {
      const t = ctx.registry.type(id)
      return { id: t.id, name: ctx.registry.localized(t.name, trainer.locale), color: t.color }
    }),
    level: e.level,
    shiny: e.shiny,
    // Schon im Dex? Dann muss man nicht ueberlegen, ob sich der Ball lohnt.
    caught: dex.isCaught(ctx.db, trainer.id, e.speciesId),
    rarity: species.rarity,
    turn: e.turn,
    weakenStacks: e.weakenStacks,
    calmStacks: e.calmStacks,
    maxWeaken: MAX_WEAKEN_STACKS,
    maxCalm: MAX_CALM_STACKS,
    probability: legendary
      ? legendaryCatchChance(e.legendaryBerries)
      : catchProbability(species, e.level, mods),
    chain: world.chainOf(ctx.db, trainer.id, e.speciesId),
    legendary,
    legendaryBerries: e.legendaryBerries,
    maxLegendaryBerries: LEGENDARY_MAX_BERRIES,
    berriesOwned: inventory.quantityOf(ctx.db, trainer.id, LEGENDARY_BERRY_ID),
  }
}

function buildModifiers(
  ctx: AppContext,
  trainer: Trainer,
  e: encounters.ActiveEncounter,
  ballId: string,
  berryId: string | null,
): CatchModifiers {
  const ball = ctx.registry.tryItem(ballId)
  if (!ball || ball.category !== 'ball') throw new GameError('validation_failed', { field: 'ballId' })
  // tryItem liefert undefined, CatchModifiers erwartet null — der Unterschied
  // ist hier nicht bedeutungstragend, also einmal sauber umwandeln.
  const berry = berryId ? (ctx.registry.tryItem(berryId) ?? null) : null
  if (berryId && (!berry || berry.category !== 'berry')) {
    throw new GameError('validation_failed', { field: 'berryId' })
  }
  // Das Labor zaehlt wie zusaetzliche Orden: derselbe kleine, spuerbare
  // Dauerbonus, statt eine weitere Zahl in die Fangformel einzubauen.
  // Labor und Forschung zaehlen beide wie zusaetzliche Orden: derselbe kleine,
  // spuerbare Dauerbonus, statt zwei weitere Zahlen in der Fangformel.
  const research = researchBonuses(ctx, trainer.id)
  const labBonus = Math.round((bonuses(ctx, trainer.id).catchRateBonus + research.catchRate) / 2)

  return {
    ball,
    berry,
    turn: e.turn,
    timeOfDay: worldClock().timeOfDay,
    weakenStacks: e.weakenStacks,
    calmStacks: e.calmStacks,
    badgeCount: world.badgesOf(ctx.db, trainer.id).size + labBonus,
  }
}

/**
 * Was beim Erkunden herauskommt.
 *
 * Drei Ausgaenge statt zwei: ausser einer Begegnung und dem leeren Gras gibt
 * es jetzt den Ueberfall — eine Begegnung mit einem Menschen statt mit einem
 * Pokemon. Diskriminiert ueber `kind`, damit der Client nicht raten muss.
 */
/** Was im Unterholz lag — schon eingesammelt, wenn es hier ankommt. */
export interface FindResult {
  what: FindKind
  /** Bei Ware und Fragmenten: was es war. Beim Muenzbeutel null. */
  itemId: string | null
  name: string
  icon: string | null
  quantity: number
  /** Beim Muenzbeutel das Gold, sonst 0. */
  gold: number
  /** Verbleibende Ladungen des Detektors; null, wenn es Zufall war. */
  detectorLeft: number | null
}

export type ExploreResult =
  | { kind: 'encounter'; encounter: EncounterView; legendary: boolean; lure: LureUse | null }
  | { kind: 'nothing'; lure: LureUse | null }
  | {
      kind: 'event'
      opponent: { id: string; name: string; title: string; kind: string; sprite: string; intro: string }
      /** Ein Streuner statt einer Bande: kleiner Kampf, kein Ueberfall. */
      wanderer: boolean
      lure: LureUse | null
    }
  | { kind: 'find'; find: FindResult; lure: LureUse | null }

export function explore(
  ctx: AppContext, trainer: Trainer, ballId: string, berryId: string | null,
  lureId: string | null = null,
): ExploreResult {
  // Erkunden bleibt unbegrenzt; geprueft wird nur, ob ein Mensch klickt.
  // Ausserhalb der Transaktion, damit die Zwangspause den Abbruch ueberlebt.
  assertPace(ctx, trainer, 'explore')
  return tx(ctx.db, () => {
    const area = requireCurrentArea(ctx, trainer)
    const used = counterValue(ctx.db, trainer.id, EXPLORE_COUNTER)
    energy.spendFor(ctx, trainer.id, 'explore')

    const clock = worldClock()
    // A fresh seed per encounter, derived from the trainer and a counter, so
    // two players exploring at the same second get different results and a
    // single player cannot replay the same roll.
    const seed = deriveSeed(trainer.id, area.id, Date.now(), used)
    const rng = createRng(seed)

    const chainSpecies = ctx.db
      .prepare('SELECT species_id AS s, streak FROM catch_chains WHERE trainer_id = ? ORDER BY streak DESC LIMIT 1')
      .get(trainer.id) as { s: string; streak: number } | undefined

    /*
     * Lockduft: verschiebt die Gewichte zugunsten eines Typs.
     *
     * Verbraucht wird er *vor* dem Wurf und unabhaengig vom Ergebnis — sonst
     * waere er ein Wunschautomat: fand man nichts Passendes, bliebe die
     * Anwendung erhalten und man wuerfelte gratis weiter.
     */
    const lureUsed: { current: LureUse | null } = { current: null }
    /* Ein Duft kann statt eines Typs eine Zusage tragen; siehe `useLure`. */
    const forced = { legendary: false }
    const lure = useLure(ctx, trainer, lureId, lureUsed, forced)
    const boni = researchBonuses(ctx, trainer.id)
    const rolled = rollEncounter(
      area, clock, rng,
      chainSpecies ? { speciesId: chainSpecies.s, streak: chainSpecies.streak } : null,
      areaOffset(ctx, trainer, area), lure, boni.shinyOdds,
    )
    bumpCounter(ctx.db, trainer.id, EXPLORE_COUNTER)
    recordPace(ctx, trainer, 'explore')
    world.visitArea(ctx.db, trainer.id, area.id)

    // Zuerst das Seltenste: ein Legendaeres schlaegt jede andere Begegnung.
    // Nur in einer Region, die vollstaendig bezwungen ist — sonst waere es
    // eine Abkuerzung statt einer Belohnung.
    if (forced.legendary || (clearedRegions(ctx, trainer).has(area.regionId) && rollLegendary(rng))) {
      // Der Prueflduft darf nicht ins Leere laufen: hat die Region selbst kein
      // Legendaeres, nimmt er eines aus dem Pack. Beim Zufallstreffer bleibt
      // es bei der Region — sonst waere die Regionsbindung nur Zierde.
      const legendary = pickLegendary(ctx, area.regionId, rng)
        ?? (forced.legendary ? pickAnyLegendary(ctx, rng) : null)
      if (legendary) {
        const level = Math.min(100, (rolled?.level ?? 60) + LEGENDARY_LEVEL_BONUS)
        dex.markSeen(ctx.db, trainer.id, legendary)
        const rare = encounters.start(ctx.db, {
          trainerId: trainer.id, areaId: area.id, speciesId: legendary,
          level, shiny: rng.chance(2), seed, startedAt: Date.now(),
        })
        logEvent(ctx.db, trainer.id, 'safari.legendary', { areaId: area.id, speciesId: legendary, level })
        return {
          kind: 'encounter' as const,
          encounter: encounterView(ctx, trainer, rare, ballId, berryId),
          legendary: true,
          lure: lureUsed.current,
        }
      }
    }

    /*
     * Dann der Ueberfall. Er verdraengt die Begegnung: beides gleichzeitig
     * waere ein Zustand, in dem der Spieler zwei Dinge offen haette.
     *
     * Ein laufender Stoersender ersetzt den Wurf durch eine Zusage. Die Ladung
     * wird nur verbraucht, wenn wirklich ein Gegner zustande kommt — sonst
     * zahlte man fuer eine Region, in der gar keine Bande unterwegs ist.
     */
    const jammed = jammerCharges(ctx, trainer) > 0
    if (jammed || rollEvent(rng)) {
      const opponent = pickEvent(ctx, trainer, area.regionId, jammed)
      if (opponent) {
        ctx.db.prepare('UPDATE trainers SET pending_event_id = ?, pending_event_area = ? WHERE id = ?')
          .run(opponent.id, area.id, trainer.id)
        if (jammed) spendJammerCharge(ctx, trainer)
        logEvent(ctx.db, trainer.id, 'safari.event', {
          areaId: area.id, opponentId: opponent.id, jammed,
        })
        return { kind: 'event' as const, opponent, wanderer: false, lure: lureUsed.current }
      }
    }

    /*
     * Dann das Fundstueck.
     *
     * Der Detektor ersetzt den Wurf; seine Ladung wird verbraucht, sobald
     * wirklich etwas herauskommt. Beides steht vor dem Streuner, weil ein
     * eingeschaltetes Geraet eine Ansage des Spielers ist und ein Streuner
     * blosser Zufall.
     */
    const detecting = detectorCharges(ctx, trainer) > 0
    if (detecting || rollFind(rng, boni.findChance)) {
      const find = grantFind(ctx, trainer, area, rng, detecting)
      if (find) {
        logEvent(ctx.db, trainer.id, 'safari.find', {
          areaId: area.id, what: find.what, itemId: find.itemId, quantity: find.quantity,
          gold: find.gold, detector: detecting,
        })
        return { kind: 'find' as const, find, lure: lureUsed.current }
      }
    }

    /*
     * Und der Streuner: ein gewoehnlicher Trainer mit hoechstens zwei
     * Pokemon, der einem den Weg abschneidet. Er verdraengt die Begegnung wie
     * ein Ueberfall — zwei offene Dinge gleichzeitig gibt es hier nicht.
     */
    if (rollWander(rng)) {
      const opponent = pickWanderer(ctx, trainer, area.regionId, rng)
      if (opponent) {
        ctx.db.prepare('UPDATE trainers SET pending_event_id = ?, pending_event_area = ? WHERE id = ?')
          .run(opponent.id, area.id, trainer.id)
        logEvent(ctx.db, trainer.id, 'safari.wanderer', { areaId: area.id, opponentId: opponent.id })
        return { kind: 'event' as const, opponent, wanderer: true, lure: lureUsed.current }
      }
    }

    if (!rolled) return { kind: 'nothing' as const, lure: lureUsed.current }

    world.bumpAreaStat(ctx.db, trainer.id, area.id, 'encounters')
    dex.markSeen(ctx.db, trainer.id, rolled.speciesId)

    const e = encounters.start(ctx.db, {
      trainerId: trainer.id,
      areaId: area.id,
      speciesId: rolled.speciesId,
      level: rolled.level,
      shiny: rolled.shiny,
      seed,
      startedAt: Date.now(),
    })
    logEvent(ctx.db, trainer.id, 'safari.encounter', {
      areaId: area.id, speciesId: rolled.speciesId, level: rolled.level, shiny: rolled.shiny,
    })
    return {
      kind: 'encounter' as const,
      encounter: encounterView(ctx, trainer, e, ballId, berryId),
      legendary: false,
      lure: lureUsed.current,
    }
  })
}

/**
 * Ein Legendaeres der Region.
 *
 * Welche das sind, steht nicht in einer Liste, sondern folgt aus dem Pack:
 * Legendaere haben die niedrigste Fangrate, und zu welcher Region sie gehoeren,
 * sagt ihre Dex-Nummer im Vergleich zu dem, was in der Region sonst vorkommt.
 * Damit funktioniert es auch fuer eine dritte Region, die niemand hier
 * eingetragen hat.
 */
function pickLegendary(ctx: AppContext, regionId: string, rng: Rng): string | null {
  const inRegion = new Set(
    ctx.registry.allAreas.filter((a) => a.regionId === regionId).flatMap((a) => a.spawns.map((sp) => sp.speciesId)),
  )
  const numbers = [...inRegion]
    .map((id) => ctx.registry.trySpecies(id)?.dexNumber)
    .filter((n): n is number => typeof n === 'number')
  if (numbers.length === 0) return null
  const low = Math.min(...numbers)
  const high = Math.max(...numbers)

  const candidates = ctx.registry.obtainableSpecies.filter(
    (sp) => sp.catchRate <= LEGENDARY_CATCH_RATE && sp.dexNumber >= low && sp.dexNumber <= high,
  )
  return candidates.length > 0 ? rng.pick(candidates).id : null
}

/** Der Ereignis-Gegner der Region, falls das Pack einen mitbringt. */
/**
 * Wer hier ueberfaellt.
 *
 * Normalerweise die Bande der Region. Mit laufendem Stoersender notfalls
 * irgendeine: wer zehntausend Gold ausgibt, soll nicht deshalb leer ausgehen,
 * weil ausgerechnet in dieser Region keine eigene Bande entworfen ist.
 */
function pickEvent(ctx: AppContext, trainer: Trainer, regionId: string, anyGang = false) {
  const events = ctx.registry.allTrainers.filter((t) => isEventTrainer(t.id))
  const def = events.find((t) => t.id.endsWith(regionId)) ?? (anyGang ? events[0] : undefined)
  if (!def) return null
  return {
    id: def.id,
    name: ctx.registry.localized(def.name, trainer.locale),
    title: ctx.registry.localized(def.title, trainer.locale),
    kind: def.kind,
    sprite: def.sprite,
    intro: ctx.registry.localized(def.dialogue.intro, trainer.locale),
  }
}

/**
 * Ein Streuner der Region.
 *
 * Kein eigener Gegner-Entwurf, sondern einer aus dem Pack: gewoehnliche
 * Trainer mit hoechstens zwei Pokemon gibt es dort schon, samt Bild, Namen und
 * Ansage. Damit gilt fuer sie auch die Tagesregel — der volle Siegbetrag
 * einmal, danach das Antrittsgeld. Ein frisch erfundener Gegner haette bei
 * jedem Treffen als "erster Sieg" gezahlt.
 */
function pickWanderer(ctx: AppContext, trainer: Trainer, regionId: string, rng: Rng) {
  const inRegion = new Set(
    ctx.registry.allAreas.filter((a) => a.regionId === regionId).flatMap((a) => a.trainerIds),
  )
  const pool = ctx.registry.allTrainers.filter(
    (t) => inRegion.has(t.id) && t.kind === 'trainer' && t.team.length <= WANDER_PARTY_MAX,
  )
  if (pool.length === 0) return null
  const def = rng.pick(pool)
  return {
    id: def.id,
    name: ctx.registry.localized(def.name, trainer.locale),
    title: ctx.registry.localized(def.title, trainer.locale),
    kind: def.kind,
    sprite: def.sprite,
    intro: ctx.registry.localized(def.dialogue.intro, trainer.locale),
  }
}

/**
 * Was in dieser Region im Boden liegen kann.
 *
 * Abgeleitet statt aufgezaehlt: der Verkaufspreis ist das einzige Wertmass,
 * das jeder Gegenstand traegt — auch die, die man nirgends kaufen kann —, und
 * die Region hebt die Grenze. Damit braucht eine vierte Region keine Zeile
 * Code, und ein neuer Werkstoff im Pack ist automatisch findbar.
 *
 * Seelenfragmente bleiben draussen: sie sind ein eigener Ausgang des Fundes.
 */
const FIND_CATEGORIES = new Set(['ball', 'berry', 'medicine', 'material', 'xp'])

function findPool(ctx: AppContext, regionId: string) {
  const cap = findValueCap(ctx.registry.region(regionId).order - 1)
  return ctx.registry.allItems.filter(
    (i) => FIND_CATEGORIES.has(i.category)
      && typeof i.sellPrice === 'number' && i.sellPrice > 0 && i.sellPrice <= cap
      && !i.params.soulType && !i.params.shinySoul,
  )
}

/**
 * Ein Fundstueck einsammeln.
 *
 * Es wandert sofort in Beutel oder Kasse. Ein Fund, den man erst noch
 * aufheben muss, waere ein zweiter Knopf fuer nichts — gemeldet wurde
 * ausdruecklich das Gegenteil.
 */
function grantFind(
  ctx: AppContext, trainer: Trainer, area: { id: string; regionId: string },
  rng: Rng, fromDetector: boolean,
): FindResult | null {
  const what = rollFindKind(rng, fromDetector)
  const spend = () => {
    if (!fromDetector) return null
    ctx.db.prepare('UPDATE trainers SET detector_charges = MAX(0, detector_charges - 1) WHERE id = ?')
      .run(trainer.id)
    return detectorCharges(ctx, trainer)
  }

  if (what === 'coins') {
    const gold = coinPurse(rng)
    inventory.earnGold(ctx.db, trainer.id, gold)
    return {
      what, itemId: null, name: 'coins', icon: null, quantity: 1, gold,
      detectorLeft: spend(),
    }
  }

  const pool = what === 'fragment'
    ? ctx.registry.allItems.filter((i) => Boolean(i.params.soulType))
    : findPool(ctx, area.regionId)
  if (pool.length === 0) return null

  const item = rng.pick(pool)
  const quantity = what === 'fragment'
    ? 1 + Math.floor(rng.next() * 2)
    : findQuantity(item.sellPrice ?? 1, findValueCap(ctx.registry.region(area.regionId).order - 1))
  inventory.grant(ctx.db, trainer.id, item.id, quantity)
  return {
    what,
    itemId: item.id,
    name: ctx.registry.localized(item.name, trainer.locale),
    icon: item.icon,
    quantity,
    gold: 0,
    detectorLeft: spend(),
  }
}

export function detectorCharges(ctx: AppContext, trainer: Trainer): number {
  const row = ctx.db.prepare('SELECT detector_charges AS n FROM trainers WHERE id = ?')
    .get(trainer.id) as { n: number } | undefined
  return row?.n ?? 0
}

/**
 * Metalldetektor einschalten.
 *
 * Wie beim Stoersender addieren sich die Ladungen, statt sich zu
 * ueberschreiben: wer zwei kauft, hat zwanzig Erkundungen.
 */
export function useDetector(ctx: AppContext, trainer: Trainer): { charges: number } {
  return tx(ctx.db, () => {
    const item = ctx.registry.tryItem(METAL_DETECTOR_ID)
    if (!item) throw new GameError('content_unavailable', { itemId: METAL_DETECTOR_ID }, 409)
    if (inventory.quantityOf(ctx.db, trainer.id, METAL_DETECTOR_ID) < 1) {
      throw new GameError('insufficient_items', { itemId: METAL_DETECTOR_ID }, 409)
    }
    inventory.consume(ctx.db, trainer.id, METAL_DETECTOR_ID, 1)
    const add = Math.max(1, Math.floor(Number(item.params.detectorCharges ?? METAL_DETECTOR_CHARGES)))
    ctx.db.prepare('UPDATE trainers SET detector_charges = detector_charges + ? WHERE id = ?')
      .run(add, trainer.id)
    logEvent(ctx.db, trainer.id, 'safari.detector', { charges: add })
    return { charges: detectorCharges(ctx, trainer) }
  })
}

/**
 * Die laufende Fangserie.
 *
 * Sie zählt nur für die Art, die man jagt — und ohne Anzeige weiß niemand, wie
 * weit er ist oder was die Serie überhaupt bringt. Deshalb kommt hier beides
 * heraus: der Stand und die Chance, die daraus folgt.
 */
export interface ChainView {
  speciesId: string
  speciesName: string
  sprite: string
  streak: number
  /** Ab hier bringt jede weitere Stufe nichts mehr. */
  cap: number
  /** Shiny-Chance für diese Art, als Anteil (0–1). */
  odds: number
  /** Was ohne Serie gälte — für den Vergleich. */
  baseOdds: number
  /** Ab dieser Serie steht die Chance auf ihrem Plateau. */
  plateau: number
  /** Und wie hoch das Plateau liegt, als Anteil (0–1). */
  plateauOdds: number
}

export function chainOf(ctx: AppContext, trainer: Trainer): ChainView | null {
  const row = ctx.db
    .prepare('SELECT species_id AS s, streak FROM catch_chains WHERE trainer_id = ? ORDER BY streak DESC LIMIT 1')
    .get(trainer.id) as { s: string; streak: number } | undefined
  if (!row || row.streak <= 0) return null
  const species = ctx.registry.species(row.s)
  return {
    speciesId: row.s,
    speciesName: ctx.registry.localized(species.name, trainer.locale),
    sprite: species.sprite,
    streak: row.streak,
    cap: SHINY_CHAIN_GUARANTEE,
    odds: shinyOdds(row.streak),
    baseOdds: SHINY_BASE_ODDS,
    /** Ab hier steht die Chance auf ihrem Plateau. */
    plateau: SHINY_CHAIN_PLATEAU,
    plateauOdds: SHINY_PLATEAU_ODDS,
  }
}

/* ------------------------------------------------------------ Störsender */

export function jammerCharges(ctx: AppContext, trainer: Trainer): number {
  const row = ctx.db.prepare('SELECT rocket_charges AS n FROM trainers WHERE id = ?')
    .get(trainer.id) as { n: number } | undefined
  return row?.n ?? 0
}

function spendJammerCharge(ctx: AppContext, trainer: Trainer): void {
  ctx.db.prepare('UPDATE trainers SET rocket_charges = MAX(0, rocket_charges - 1) WHERE id = ?')
    .run(trainer.id)
}

/**
 * Störsender einschalten.
 *
 * Die Ladungen addieren sich statt sich zu überschreiben: wer zwei kauft, hat
 * zehn Erkundungen — alles andere wäre ein stiller Verlust.
 */
export function useJammer(ctx: AppContext, trainer: Trainer): { charges: number } {
  return tx(ctx.db, () => {
    const item = ctx.registry.tryItem(ROCKET_BAIT_ID)
    if (!item) throw new GameError('content_unavailable', { itemId: ROCKET_BAIT_ID }, 409)
    if (inventory.quantityOf(ctx.db, trainer.id, ROCKET_BAIT_ID) < 1) {
      throw new GameError('insufficient_items', { itemId: ROCKET_BAIT_ID }, 409)
    }
    inventory.consume(ctx.db, trainer.id, ROCKET_BAIT_ID, 1)
    const add = Math.max(1, Math.floor(Number(item.params.rocketCharges ?? ROCKET_BAIT_CHARGES)))
    ctx.db.prepare('UPDATE trainers SET rocket_charges = rocket_charges + ? WHERE id = ?')
      .run(add, trainer.id)
    logEvent(ctx.db, trainer.id, 'safari.jammer', { charges: add })
    return { charges: jammerCharges(ctx, trainer) }
  })
}

/**
 * Eine Anwendung Lockduft verbrauchen und den Effekt zurückgeben.
 *
 * Kein Fehler, wenn keiner da ist: der Client kann eine leere Auswahl
 * mitschicken, und eine Erkundung soll nicht daran scheitern, dass die Packung
 * gerade leer geworden ist.
 */
export interface LureUse {
  itemId: string
  name: string
  typeName: string
  /** Wie viele Anwendungen nach dieser noch im Beutel liegen. */
  left: number
}

function useLure(
  ctx: AppContext, trainer: Trainer, lureId: string | null, used: { current: LureUse | null },
  forced: { legendary: boolean } = { legendary: false },
): LureEffect | null {
  if (!lureId) return null
  const item = ctx.registry.tryItem(lureId)
  if (!item || item.category !== 'lure') return null
  // Ein Duft zieht entweder einen Typ an oder gibt eine Zusage. Ohne beides
  // ist er keiner.
  const legendary = item.params.legendaryLure === true
  const typeId = String(item.params.lureType ?? '')
  if (!typeId && !legendary) return null
  if (inventory.quantityOf(ctx.db, trainer.id, lureId) <= 0) return null

  inventory.consume(ctx.db, trainer.id, lureId, 1)
  logEvent(ctx.db, trainer.id, 'safari.lure', { itemId: lureId, typeId, legendary })
  const type = typeId ? ctx.registry.tryType(typeId) : null
  used.current = {
    itemId: lureId,
    name: ctx.registry.localized(item.name, trainer.locale),
    typeName: type ? ctx.registry.localized(type.name, trainer.locale) : typeId,
    left: inventory.quantityOf(ctx.db, trainer.id, lureId),
  }
  forced.legendary = legendary
  return typeId ? { typeId, typesOf: (speciesId) => ctx.registry.species(speciesId).types } : null
}

/** Irgendein Legendaeres des Packs — die Notloesung des Prueflufts. */
function pickAnyLegendary(ctx: AppContext, rng: Rng): string | null {
  const candidates = ctx.registry.obtainableSpecies.filter((sp) => sp.catchRate <= LEGENDARY_CATCH_RATE)
  return candidates.length > 0 ? rng.pick(candidates).id : null
}

/**
 * Eine Sagenbeere einsetzen.
 *
 * Der einzige Hebel gegen ein Legendaeres. Bei allem anderen waere sie
 * wirkungslos, deshalb wird sie dort gar nicht erst angenommen — eine Beere,
 * die man versehentlich an ein Rattfratz verschwendet, waere ein bitterer
 * Verlust fuer nichts.
 */
export function useLegendaryBerry(
  ctx: AppContext, trainer: Trainer, ballId: string, berryId: string | null,
): EncounterView {
  return tx(ctx.db, () => {
    const e = encounters.activeOf(ctx.db, trainer.id)
    if (!e) throw new GameError('invalid_state', { reason: 'no_encounter' }, 409)

    const species = ctx.registry.species(e.speciesId)
    if (!isLegendaryCatchRate(species.catchRate)) {
      throw new GameError('invalid_state', { reason: 'not_legendary' }, 409)
    }
    if (e.legendaryBerries >= LEGENDARY_MAX_BERRIES) {
      throw new GameError('invalid_state', { reason: 'already_maxed', max: LEGENDARY_MAX_BERRIES }, 409)
    }

    inventory.consume(ctx.db, trainer.id, LEGENDARY_BERRY_ID, 1)
    if (!encounters.addLegendaryBerry(ctx.db, trainer.id, LEGENDARY_MAX_BERRIES)) {
      throw new GameError('invalid_state', { reason: 'already_maxed', max: LEGENDARY_MAX_BERRIES }, 409)
    }
    logEvent(ctx.db, trainer.id, 'safari.legendaryBerry', {
      speciesId: e.speciesId, used: e.legendaryBerries + 1,
    })
    return encounterView(ctx, trainer, encounters.activeOf(ctx.db, trainer.id)!, ballId, berryId)
  })
}

export type SoftenAction = 'weaken' | 'calm'

export function soften(ctx: AppContext, trainer: Trainer, action: SoftenAction, ballId: string, berryId: string | null): EncounterView {
  return tx(ctx.db, () => {
    const e = encounters.activeOf(ctx.db, trainer.id)
    if (!e) throw new GameError('invalid_state', { reason: 'no_encounter' }, 409)

    const max = action === 'weaken' ? MAX_WEAKEN_STACKS : MAX_CALM_STACKS
    const current = action === 'weaken' ? e.weakenStacks : e.calmStacks
    if (current >= max) throw new GameError('invalid_state', { reason: 'already_maxed', action }, 409)

    encounters.addStack(ctx.db, trainer.id, action, max)
    encounters.bumpTurn(ctx.db, trainer.id)
    return encounterView(ctx, trainer, encounters.activeOf(ctx.db, trainer.id)!, ballId, berryId)
  })
}

export interface ThrowResult {
  caught: boolean
  shakes: number
  probability: number
  fled: boolean
  /** Present on success. */
  creature: ReturnType<typeof creatureView> | null
  newDexEntry: boolean
  chain: number
  reward: { gold: number } | null
  /** Gesetzt, wenn mit diesem Fang das Gebiet vollstaendig wurde. */
  areaCompleted: { areaId: string; areaName: string; energy: number } | null
  encounter: EncounterView | null
}

/**
 * Ein Gebiet gilt als abgeschlossen, wenn jede dort vorkommende Art im Dex
 * steht — auch die, die nur nachts oder bei Regen erscheinen. Dafuer gibt es
 * einmalig Energie: die groesste einzelne Gutschrift im Spiel, weil sie den
 * groessten Aufwand belohnt.
 */
function completeArea(
  ctx: AppContext,
  trainer: Trainer,
  areaId: string,
): ThrowResult['areaCompleted'] {
  const already = ctx.db
    .prepare('SELECT 1 FROM area_completions WHERE trainer_id = ? AND area_id = ?')
    .get(trainer.id, areaId)
  if (already) return null

  const area = ctx.registry.tryArea(areaId)
  if (!area) return null
  const needed = new Set(area.spawns.map((sp) => sp.speciesId))
  const caught = dex.caughtSpeciesIds(ctx.db, trainer.id)
  for (const id of needed) if (!caught.has(id)) return null

  ctx.db.prepare('INSERT INTO area_completions (trainer_id, area_id, completed_at) VALUES (?, ?, ?)')
    .run(trainer.id, areaId, Date.now())
  const granted = ENERGY_REWARDS.areaCompleted
  energy.reward(ctx, trainer.id, 'areaCompleted')
  logEvent(ctx.db, trainer.id, 'area.completed', { areaId, energy: granted })
  return {
    areaId,
    areaName: ctx.registry.localized(area.name, trainer.locale),
    energy: granted,
  }
}

/** Chance the wild creature runs after a failed throw. Rises with the turn
 *  count so an encounter cannot be ground down forever with free actions. */
function fleeChance(turn: number): number {
  return Math.min(0.05 + turn * 0.04, 0.5)
}

/**
 * Der Wurf auf ein Legendaeres.
 *
 * Weder Ball noch Schwaechen noch Beruhigen spielen hinein — nur die
 * Sagenbeeren. Die Wackler leiten sich aus der Chance ab, damit die Animation
 * dasselbe erzaehlt wie die Rechnung.
 */
function legendaryAttempt(berries: number, rng: Rng): { caught: boolean; shakes: number; probability: number } {
  const probability = legendaryCatchChance(berries)
  const caught = rng.next() < probability
  const shakes = caught ? 3 : Math.min(3, Math.floor(probability * 4))
  return { caught, shakes, probability }
}

export function throwBall(
  ctx: AppContext,
  trainer: Trainer,
  ballId: string,
  berryId: string | null,
): ThrowResult {
  return tx(ctx.db, () => {
    const e = encounters.activeOf(ctx.db, trainer.id)
    if (!e) throw new GameError('invalid_state', { reason: 'no_encounter' }, 409)

    const species = ctx.registry.species(e.speciesId)
    const legendary = isLegendaryCatchRate(species.catchRate)
    const mods = buildModifiers(ctx, trainer, e, ballId, berryId)

    inventory.consume(ctx.db, trainer.id, ballId, 1)
    // Gegen ein Legendaeres wirkt keine gewoehnliche Beere — sie wird deshalb
    // auch nicht verbraucht.
    if (berryId && !legendary) inventory.consume(ctx.db, trainer.id, berryId, 1)

    // Seed includes the turn so each throw in one encounter differs, but the
    // whole encounter stays reproducible from its stored seed.
    const rng = createRng(deriveSeed(e.seed, 'throw', e.turn))
    const attempt = legendary
      ? legendaryAttempt(e.legendaryBerries, rng)
      : attemptCatch(species, e.level, mods, rng)
    encounters.bumpTurn(ctx.db, trainer.id)

    if (!attempt.caught) {
      const fled = rng.next() < fleeChance(e.turn)
      if (fled) {
        encounters.clear(ctx.db, trainer.id)
        world.breakChain(ctx.db, trainer.id)
      }
      logEvent(ctx.db, trainer.id, 'safari.throw', { caught: false, fled, speciesId: e.speciesId })
      return {
        caught: false, shakes: attempt.shakes, probability: attempt.probability, fled,
        creature: null, newDexEntry: false, chain: 0, reward: null, areaCompleted: null,
        encounter: fled ? null : encounterView(ctx, trainer, encounters.activeOf(ctx.db, trainer.id)!, ballId, berryId),
      }
    }

    const owned = creatures.countOwned(ctx.db, trainer.id).total
    const limit = boxLimit(ctx, trainer.id)
    if (owned >= limit) throw new GameError('invalid_state', { reason: 'box_full', limit }, 409)

    const catchRng = createRng(deriveSeed(e.seed, 'creature'))
    // Besondere Arten bringen eine Untergrenze mit; alle anderen haben 0.
    const ivs = randomIvs(catchRng, species.ivFloor ?? 0)
    const nature = catchRng.pick(NATURES)
    const stats = computeStats(species, e.level, ivs, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature)

    const created = creatures.insertCreature(ctx.db, {
      ownerId: trainer.id,
      speciesId: e.speciesId,
      level: e.level,
      xp: xpForLevel(species.growthRate, e.level),
      nature,
      ivs,
      friendship: 70,
      hpCurrent: stats.hp,
      shiny: e.shiny,
      moves: ctx.registry.learnableAt(e.speciesId, e.level).slice(0, 4),
      caughtAreaId: e.areaId,
      teamSlot: creatures.teamOf(ctx.db, trainer.id).length < 5 ? nextFreeSlot(ctx, trainer.id) : null,
    })

    const newDexEntry = dex.markCaught(ctx.db, trainer.id, e.speciesId)
    let chain = world.recordCatch(ctx.db, trainer.id, e.speciesId)
    /*
     * Ein Treffer setzt die Serie zurueck — auf die Zehn-Prozent-Marke.
     *
     * Vorher lief sie einfach weiter: wer einmal bei 49 stand, fing ab da
     * jedes Exemplar dieser Art schillernd. Die Jagd war nach dem ersten
     * Treffer vorbei.
     */
    if (e.shiny) {
      world.setChain(ctx.db, trainer.id, e.speciesId, SHINY_CHAIN_AFTER_CATCH)
      chain = SHINY_CHAIN_AFTER_CATCH
    }
    world.bumpAreaStat(ctx.db, trainer.id, e.areaId, 'catches')
    const reward = catchReward(species, e.level, e.shiny)
    inventory.earnGold(ctx.db, trainer.id, reward.gold)

    /*
     * Ein Fundstueck aus dem Gras.
     *
     * Gewuerfelt aus demselben Kern wie der Wurf, nur mit eigenem Anhaengsel:
     * derselbe Fang gibt damit reproduzierbar dasselbe Fundstueck, und ein
     * zweiter Wurf laesst sich nicht auf ein besseres hin wiederholen.
     */
    const dropId = rollCatchDrop(
      createRng(deriveSeed(e.seed, 'drop', String(e.startedAt))),
      researchBonuses(ctx, trainer.id).catchDrop,
    )
    const dropItem = dropId ? ctx.registry.tryItem(dropId) : null
    if (dropItem) inventory.grant(ctx.db, trainer.id, dropItem.id, 1)
    encounters.clear(ctx.db, trainer.id)

    teams.syncActiveFromGarden(ctx, trainer.id)
    awardSeasonPoints(ctx, trainer.id, 'catch')
    if (newDexEntry) awardSeasonPoints(ctx, trainer.id, 'newDexEntry')
    bumpMetric(ctx, trainer.id, 'catches')
    const areaCompleted = newDexEntry ? completeArea(ctx, trainer, e.areaId) : null
    logEvent(ctx.db, trainer.id, 'safari.catch', {
      speciesId: e.speciesId, level: e.level, shiny: e.shiny, chain, gold: reward.gold,
      drop: dropItem?.id ?? null,
    })

    return {
      caught: true,
      shakes: attempt.shakes,
      probability: attempt.probability,
      fled: false,
      creature: creatureView(ctx.registry, created, trainer.locale, worldClock().timeOfDay),
      newDexEntry,
      chain,
      reward: {
        gold: reward.gold,
        drop: dropItem
          ? {
              itemId: dropItem.id,
              name: ctx.registry.localized(dropItem.name, trainer.locale),
              icon: dropItem.icon,
            }
          : null,
      },
      areaCompleted,
      encounter: null,
    }
  })
}

function nextFreeSlot(ctx: AppContext, trainerId: string): number | null {
  const used = new Set(creatures.teamOf(ctx.db, trainerId).map((c) => c.teamSlot))
  for (let i = 0; i < 5; i++) if (!used.has(i)) return i
  return null
}

export function flee(ctx: AppContext, trainer: Trainer): void {
  encounters.clear(ctx.db, trainer.id)
  world.breakChain(ctx.db, trainer.id)
  logEvent(ctx.db, trainer.id, 'safari.flee', {})
}

export function currentEncounter(
  ctx: AppContext,
  trainer: Trainer,
  ballId: string,
  berryId: string | null,
): EncounterView | null {
  const e = encounters.activeOf(ctx.db, trainer.id)
  return e ? encounterView(ctx, trainer, e, ballId, berryId) : null
}
