import { GameError, type Trainer } from '@game/shared'
import type { AreaDef } from '@game/content'
import { areaBand, availableSpawns, isLegendarySpecies, shiftLevel } from '@game/engine'
import type { AppContext } from '../context.js'
import * as world from '../repos/world.js'
import * as dex from '../repos/dex.js'
import * as regionEntries from '../repos/regions.js'
import * as creatures from '../repos/creatures.js'
import { worldClock } from '../worldClock.js'
import { areaOffset, recordRegionEntry, referenceOf, scaledLevel } from './scaling.js'
import { clearedRegions, progressOf } from './league.js'
import * as travelService from './travel.js'

export interface UnlockRequirement {
  kind: 'previous_area' | 'dex_caught' | 'creatures_at_level' | 'badges' | 'region_cleared'
  met: boolean
  label: string
  have: number
  need: number
  /** Ids the client can show as icons, e.g. missing badges. */
  detail?: string[]
}

export interface AreaView {
  id: string
  regionId: string
  order: number
  name: string
  description: string
  icon: string
  unlocked: boolean
  visited: boolean
  isCurrent: boolean
  requirements: UnlockRequirement[]
  caughtHere: number
  speciesHere: number
  encounters: number
  gymId: string | null
  gymCleared: boolean
  trainerCount: number
  /** What can actually appear right now — the reason to come back at night. */
  spawnableNow: number
  /** Levelband, wie es sich gerade zeigt — inklusive Skalierung. */
  levels: { min: number; max: number }
  /** Wie viele Level die Skalierung draufgelegt hat. 0 = Entwurfswerte. */
  levelBoost: number
}

/**
 * Die Sperre zwischen zwei Regionen.
 *
 * Eine neue Region betritt nur, wer seine aktuelle bezwungen hat — alle Orden
 * plus Top Vier und Meister. Ohne das waeren die Regionen ein Buffet: man
 * pickt sich aus jeder die leichten Gebiete und laesst die Ligen liegen.
 *
 * Die Startregion bleibt frei waehlbar; gesperrt ist nur der *Wechsel*. Und
 * eine Region, die man schon betreten hat, bleibt offen — sonst spuerre man
 * jemanden aus, der zurueckreisen will.
 */
export function regionGateFor(
  ctx: AppContext, trainer: Trainer, area: AreaDef,
): UnlockRequirement | null {
  const entered = regionEntries.entriesOf(ctx.db, trainer.id)
  if (entered.has(area.regionId)) return null
  // Wer noch gar nichts betreten hat, waehlt gerade seine Startregion.
  if (entered.size === 0) return null

  const cleared = clearedRegions(ctx, trainer)
  const open = [...entered.keys()].filter((id) => !cleared.has(id))
  if (open.length === 0) return null

  const name = ctx.registry.allRegions.find((r) => r.id === open[0])
  return {
    kind: 'region_cleared',
    met: false,
    label: name ? ctx.registry.localized(name.name, trainer.locale) : open[0]!,
    have: cleared.size,
    need: entered.size,
  }
}

/**
 * Decide whether an area is open.
 *
 * Every condition is returned with its current and required value, not just a
 * boolean. A locked door that does not say what it wants is the single most
 * common way a progression system feels arbitrary.
 */
export function evaluateArea(
  ctx: AppContext,
  trainer: Trainer,
  area: AreaDef,
  caughtPerArea: Map<string, number>,
  badges: Set<string>,
  levelCounts: number[],
  dexCaught = 0,
  regionGate: UnlockRequirement | null = null,
  levelOffset = 0,
): UnlockRequirement[] {
  const reqs: UnlockRequirement[] = []
  const unlock = area.unlock

  /*
   * Der Pokédex, nicht die Fänge im Vorgängergebiet — und je Region gezählt.
   *
   * Erst zählte das Vorgängergebiet: wer auf Route 1 ein Taubsi gefangen hatte,
   * musste auf Route 2 noch eins fangen. Dann zählte der ganze Dex, und das
   * ging schief, sobald jemand eine spätere Region als *Startregion* wählte:
   * Hoenns zweites Gebiet verlangte 150 Einträge, die es dort noch gar nicht
   * geben konnte.
   *
   * Gezählt werden jetzt die gefangenen Arten, die in dieser Region überhaupt
   * vorkommen. Damit trägt sich jede Region selbst — egal, in welcher
   * Reihenfolge man die Welt bereist —, und wer eine Art schon anderswo
   * gefangen hat, bekommt sie angerechnet.
   */
  if (unlock.minDexCaught > 0) {
    reqs.push({
      kind: 'dex_caught',
      met: dexCaught >= unlock.minDexCaught,
      label: '',
      have: dexCaught,
      need: unlock.minDexCaught,
    })
  }

  // Eine neue Region betritt nur, wer seine aktuelle bezwungen hat.
  if (regionGate) reqs.push(regionGate)

  if (unlock.minCreaturesAtLevel) {
    /*
     * Die Levelforderung folgt der Skalierung des Gebiets.
     *
     * Im Pack ist Hoenn fuer spaete Trainer entworfen: die Granitgrotte
     * verlangt vier Pokemon ab Level 104. Wer Hoenn als Startregion waehlt,
     * spielt dieselbe Grotte auf Level 10 — und stand vor einer Bedingung, die
     * seine Reisegrenze von 100 gar nicht zulaesst. Die Wildnis dort wird
     * bereits verschoben; die Bedingung muss mit.
     */
    const { count } = unlock.minCreaturesAtLevel
    const level = scaledLevel(unlock.minCreaturesAtLevel.level, levelOffset)
    const have = levelCounts.filter((l) => l >= level).length
    reqs.push({ kind: 'creatures_at_level', met: have >= count, label: String(level), have, need: count })
  }

  if (unlock.requiredBadgeIds.length > 0) {
    const missing = unlock.requiredBadgeIds.filter((b) => !badges.has(b))
    reqs.push({
      kind: 'badges',
      met: missing.length === 0,
      label: '',
      have: unlock.requiredBadgeIds.length - missing.length,
      need: unlock.requiredBadgeIds.length,
      detail: missing,
    })
  }

  return reqs
}

/**
 * Gefangene Arten je Region.
 *
 * Eine Art zaehlt fuer jede Region, in der sie vorkommt — Pikachu in Kanto und
 * Johto zaehlt in beiden. Sonst muesste man dieselbe Art zweimal fangen, und
 * genau das war der Grund, vom Vorgaengergebiet auf den Dex umzustellen.
 */
function regionDexCounts(ctx: AppContext, caught: Set<string>): Map<string, number> {
  const perRegion = new Map<string, Set<string>>()
  for (const area of ctx.registry.allAreas) {
    let seen = perRegion.get(area.regionId)
    if (!seen) { seen = new Set(); perRegion.set(area.regionId, seen) }
    for (const spawn of area.spawns) if (caught.has(spawn.speciesId)) seen.add(spawn.speciesId)
  }
  return new Map([...perRegion].map(([id, set]) => [id, set.size]))
}

export function worldMap(ctx: AppContext, trainer: Trainer): {
  regions: Array<{
    id: string; name: string; tagline: string; areas: AreaView[]
    /** Betreten — die Region, in der man gerade unterwegs ist. */
    entered: boolean
    /** Bezwungen: Top Vier und Champion liegen hinter einem. */
    cleared: boolean
    /** Verschlossen, weil die laufende Region noch offen ist. */
    locked: boolean
  }>
  clock: ReturnType<typeof worldClock>
  currentAreaId: string | null
  badges: string[]
  levelScaling: boolean
  referenceLevel: number
  league: ReturnType<typeof progressOf>
  travel: travelService.TravelView
} {
  const clock = worldClock()
  const caughtPerArea = world.caughtPerArea(ctx.db, trainer.id)
  const badges = world.badgesOf(ctx.db, trainer.id)
  const progress = world.progressOf(ctx.db, trainer.id)
  const levelCounts = ctx.db
    .prepare('SELECT level FROM creatures WHERE owner_id = ?')
    .all(trainer.id)
    .map((r) => (r as { level: number }).level)
  const caughtSpecies = dex.caughtSpeciesIds(ctx.db, trainer.id)
  const caughtInRegion = regionDexCounts(ctx, caughtSpecies)

  const reference = referenceOf(ctx, trainer)
  const areasByRegion = new Map<string, AreaView[]>()
  for (const area of ctx.registry.allAreas) {
    const offset = areaOffset(ctx, trainer, area, reference)
    const band = areaBand(area)
    const reqs = evaluateArea(
      ctx, trainer, area, caughtPerArea, badges, levelCounts,
      caughtInRegion.get(area.regionId) ?? 0, regionGateFor(ctx, trainer, area), offset,
    )
    const prog = progress.get(area.id)
    const view: AreaView = {
      id: area.id,
      regionId: area.regionId,
      order: area.order,
      name: ctx.registry.localized(area.name, trainer.locale),
      description: ctx.registry.localized(area.description, trainer.locale),
      icon: area.icon,
      /*
       * Wer schon dort war, kommt wieder hinein.
       *
       * Die Bedingungen werden bei jedem Aufruf neu gerechnet, nicht einmal
       * vermerkt. Damit sperrt jede spaetere Aenderung am Pack Spieler aus
       * Gebieten aus, die sie laengst offen hatten — beim Geraderuecken der
       * Pokemon-Zahlen waere genau das passiert. Der Besuch ist die
       * Quittung; die Bedingungen bleiben daneben trotzdem ehrlich stehen.
       */
      unlocked: Boolean(prog) || reqs.every((r) => r.met),
      visited: Boolean(prog),
      isCurrent: trainer.currentAreaId === area.id,
      requirements: reqs,
      /*
       * Wie viel vom Bestand dieses Gebiets man hat — nicht, wie viel man
       * *hier* gefangen hat.
       *
       * Das waren zwei verschiedene Zahlen, und die Karte zeigte die andere
       * als die Gebietsansicht: "4/7 gefangen" auf der Karte, "6 gefangen" im
       * Gebiet. Gemeldet, und der Fehler lag auf der Karte — die
       * Gebietsansicht und die Belohnung fuers Vervollstaendigen zaehlen beide
       * ueber den Pokedex. Wo man eine Art gefangen hat, sagt nichts darueber,
       * ob man sie hat.
       */
      caughtHere: [...new Set(area.spawns.map((sp) => sp.speciesId))]
        .filter((id) => caughtSpecies.has(id)).length,
      speciesHere: new Set(area.spawns.map((s) => s.speciesId)).size,
      encounters: prog?.encounters ?? 0,
      gymId: area.gymId,
      gymCleared: area.gymId ? badges.has(ctx.registry.trainer(area.gymId).badgeId ?? '') : false,
      trainerCount: area.trainerIds.length,
      spawnableNow: new Set(availableSpawns(area, clock).map((s) => s.speciesId)).size,
      levels: { min: band.min + offset, max: band.max + offset },
      levelBoost: offset,
    }
    const list = areasByRegion.get(area.regionId) ?? []
    list.push(view)
    areasByRegion.set(area.regionId, list)
  }

  return {
    clock,
    currentAreaId: trainer.currentAreaId,
    badges: [...badges],
    levelScaling: trainer.levelScaling,
    referenceLevel: reference,
    league: progressOf(ctx, trainer),
    travel: travelService.viewOf(ctx, trainer),
    /*
     * Der Zustand je Region gehoert an die Region, nicht nur an ihre Gebiete.
     *
     * Die Karte zeigt sie als Auswahlfeld; ohne diese drei Angaben muesste die
     * Oberflaeche aus 38 Gebietszeilen zurueckrechnen, ob eine Region offen
     * ist — und dabei die Regel verdoppeln.
     */
    regions: ctx.registry.allRegions.map((r) => {
      const entered = regionEntries.entriesOf(ctx.db, trainer.id).has(r.id)
      const first = (areasByRegion.get(r.id) ?? []).sort((a, b) => a.order - b.order)[0]
      const locked = !entered && Boolean(
        first?.requirements.some((req) => req.kind === 'region_cleared' && !req.met),
      )
      return {
        id: r.id,
        name: ctx.registry.localized(r.name, trainer.locale),
        tagline: ctx.registry.localized(r.tagline, trainer.locale),
        areas: (areasByRegion.get(r.id) ?? []).sort((a, b) => a.order - b.order),
        entered,
        cleared: clearedRegions(ctx, trainer).has(r.id),
        locked,
      }
    }),
  }
}

/** Travel to an area, refusing if its conditions are not met. */
export function travelTo(ctx: AppContext, trainer: Trainer, areaId: string): void {
  const area = ctx.registry.tryArea(areaId)
  if (!area) throw new GameError('not_found', { areaId }, 404)

  const reqs = evaluateArea(
    ctx, trainer, area,
    world.caughtPerArea(ctx.db, trainer.id),
    world.badgesOf(ctx.db, trainer.id),
    ctx.db.prepare('SELECT level FROM creatures WHERE owner_id = ?').all(trainer.id)
      .map((r) => (r as { level: number }).level),
    regionDexCounts(ctx, dex.caughtSpeciesIds(ctx.db, trainer.id)).get(area.regionId) ?? 0,
    regionGateFor(ctx, trainer, area),
    areaOffset(ctx, trainer, area, referenceOf(ctx, trainer)),
  )
  const unmet = reqs.filter((r) => !r.met)
  // Dieselbe Regel wie in der Ansicht: ein einmal betretenes Gebiet bleibt
  // offen, auch wenn seine Bedingungen spaeter steigen.
  if (unmet.length > 0 && !world.progressOf(ctx.db, trainer.id).has(areaId)) {
    throw new GameError('invalid_state', { reason: 'area_locked', requirements: unmet }, 409)
  }

  ctx.db.prepare('UPDATE trainers SET current_area_id = ? WHERE id = ?').run(areaId, trainer.id)
  world.visitArea(ctx.db, trainer.id, areaId)
  // Vor dem ersten Schritt in eine Region festhalten, auf welchem Niveau sie
  // einen empfaengt. Danach waechst sie nicht mehr mit.
  recordRegionEntry(ctx, trainer, area.regionId)
}

export function requireCurrentArea(ctx: AppContext, trainer: Trainer): AreaDef {
  const id = trainer.currentAreaId ?? ctx.registry.manifest.startingArea
  const area = ctx.registry.tryArea(id)
  if (!area) throw new GameError('invalid_state', { reason: 'no_area' }, 409)
  return area
}

/** Team members that are not away on an expedition and still standing. */
export function availableTeam(ctx: AppContext, trainer: Trainer, busy: Set<string>) {
  return creatures.teamOf(ctx.db, trainer.id).filter((c) => !busy.has(c.id))
}

/**
 * Wer hier lebt — soweit man es weiß.
 *
 * Gemeldet: man sieht nicht, was in einem Gebiet vorkommt, und weiß deshalb
 * nie, ob sich das Bleiben lohnt.
 *
 * Zuerst standen hier nur die schon gesehenen Arten, damit das Entdecken nicht
 * vorweggenommen wird. Das war zu streng: wer nicht weiß, dass da noch etwas
 * ist und *wann* es erscheint, sucht nicht danach — er hört auf. Jetzt steht
 * jede Art da; die unbekannten ohne Namen und Bild, aber mit ihrer Bedingung.
 *
 * Die Anteile gelten für *jetzt*: Arten, die nur nachts oder bei Regen
 * erscheinen, zählen bei Sonne nicht mit — sonst stünde dort eine Chance, die
 * es gerade nicht gibt.
 */
/**
 * Wo eine Art vorkommt.
 *
 * Die Umkehrung von `spawnsOf`: dort steht, was in einem Gebiet lebt, hier,
 * in welchen Gebieten eine Art lebt. Gemeldet wurde, dass der Pokedex zwar
 * sagt, was es gibt, aber nicht, wo man es findet — und ohne das ist ein
 * fehlender Eintrag eine Aufgabe ohne Anleitung.
 *
 * Nur fuer Arten, die man schon gesehen hat. Ein Pokedex, der die Fundorte von
 * allem verraet, was es gibt, nimmt dem Entdecken den Sinn.
 */
export function habitatsOf(ctx: AppContext, trainer: Trainer, speciesId: string) {
  const entry = dex.dexOf(ctx.db, trainer.id).get(speciesId)
  const species = ctx.registry.trySpecies(speciesId)
  if (!species) throw new GameError('not_found', { speciesId }, 404)
  if (!entry) {
    return { speciesId, known: false, name: null, sprite: null, areas: [] as HabitatArea[], legendaryRegion: null }
  }

  const clock = worldClock()
  const visited = new Set(world.progressOf(ctx.db, trainer.id).keys())
  const reference = referenceOf(ctx, trainer)

  const areas: HabitatArea[] = []
  for (const area of ctx.registry.allAreas) {
    const spawn = area.spawns.find((sp) => sp.speciesId === speciesId)
    if (!spawn) continue
    const total = area.spawns.reduce((sum, sp) => sum + sp.weight, 0)
    const offset = areaOffset(ctx, trainer, area, reference)
    const availableNow = availableSpawns(area, clock).some((sp) => sp.speciesId === speciesId)
    areas.push({
      areaId: area.id,
      areaName: ctx.registry.localized(area.name, trainer.locale),
      regionId: area.regionId,
      regionName: ctx.registry.localized(ctx.registry.region(area.regionId).name, trainer.locale),
      /** Anteil an allem, was das Gebiet ueberhaupt hervorbringt. */
      chance: total > 0 ? Math.round((spawn.weight / total) * 1000) / 10 : 0,
      minLevel: shiftLevel(spawn.minLevel, offset),
      maxLevel: shiftLevel(spawn.maxLevel, offset),
      timeOfDay: spawn.timeOfDay ?? null,
      weather: spawn.weather ?? null,
      /** Schon einmal dort gewesen — sonst ist der Ort selbst noch ein Ziel. */
      visited: visited.has(area.id),
      availableNow,
    })
  }
  areas.sort((a, b) => b.chance - a.chance)

  /*
   * Legendaere stehen in keiner Spawn-Tabelle.
   *
   * Der Pokedex sagte deshalb, sie kaemen "in freier Wildbahn nirgends vor" —
   * was gerade fuer sie am wenigsten stimmt. Sie kommen ueberall in ihrer
   * Region vor, nur mit einem Promille und erst, wenn die Region bezwungen
   * ist. Das ist eine Auskunft, keine Fehlanzeige.
   */
  const heimat = isLegendarySpecies(species)
    ? ctx.registry.allRegions.find((r) => r.legendarySpeciesIds.includes(speciesId)) ?? null
    : null

  return {
    speciesId,
    known: true,
    name: ctx.registry.localized(species.name, trainer.locale),
    sprite: entry.caughtAt ? species.sprite : species.sprite,
    areas,
    legendaryRegion: heimat ? ctx.registry.localized(heimat.name, trainer.locale) : null,
  }
}

export interface HabitatArea {
  areaId: string
  areaName: string
  regionId: string
  regionName: string
  chance: number
  minLevel: number
  maxLevel: number
  timeOfDay: string[] | null
  weather: string[] | null
  visited: boolean
  availableNow: boolean
}

export function spawnsOf(ctx: AppContext, trainer: Trainer, areaId: string) {
  const area = ctx.registry.area(areaId)
  const clock = worldClock()
  const seen = dex.dexOf(ctx.db, trainer.id)
  const offset = areaOffset(ctx, trainer, area, referenceOf(ctx, trainer))

  const now = availableSpawns(area, clock)
  const total = now.reduce((sum, s) => sum + s.weight, 0)
  const nowIds = new Set(now.map((s) => s.speciesId))

  const entries = area.spawns.map((spawn) => {
    const entry = seen.get(spawn.speciesId)
    const species = ctx.registry.trySpecies(spawn.speciesId)
    const availableNow = nowIds.has(spawn.speciesId)
    return {
      speciesId: spawn.speciesId,
      known: Boolean(entry),
      caught: Boolean(entry?.caughtAt),
      name: entry && species ? ctx.registry.localized(species.name, trainer.locale) : null,
      sprite: entry && species ? species.sprite : null,
      types: entry && species ? [...species.types] : [],
      // Anteil an dem, was gerade erscheinen kann.
      chance: availableNow && total > 0 ? Math.round((spawn.weight / total) * 1000) / 10 : 0,
      availableNow,
      minLevel: shiftLevel(spawn.minLevel, offset),
      maxLevel: shiftLevel(spawn.maxLevel, offset),
      timeOfDay: spawn.timeOfDay ?? null,
      weather: spawn.weather ?? null,
    }
  })

  const known = entries.filter((e) => e.known)
  return {
    areaId: area.id,
    areaName: ctx.registry.localized(area.name, trainer.locale),
    clock,
    total: entries.length,
    unknown: entries.length - known.length,
    caught: known.filter((e) => e.caught).length,
    // Das Häufigste zuerst; was gerade nicht erscheinen kann, ans Ende.
    species: entries.sort(
      (a, b) => Number(b.availableNow) - Number(a.availableNow)
        || b.chance - a.chance
        || Number(b.known) - Number(a.known),
    ),
  }
}
