import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  AreaDefSchema, BadgeDefSchema, ChapterDefSchema, ItemDefSchema, MoveDefSchema, PackManifestSchema,
  RegionDefSchema, SpeciesDefSchema, TrainerDefSchema, TypeChartSchema, TypeDefSchema,
  type ContentPack,
} from './schema.js'

export class PackLoadError extends Error {
  constructor(readonly file: string, readonly issues: string[]) {
    super(`Content-Pack "${file}" ist ungültig:\n  - ${issues.join('\n  - ')}`)
    this.name = 'PackLoadError'
  }
}

async function readJson(dir: string, file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(join(dir, file), 'utf8'))
  } catch (err) {
    throw new PackLoadError(file, [(err as Error).message])
  }
}

function parseList<T>(file: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: unknown): T[] {
  const arr = z.array(z.unknown()).safeParse(raw)
  if (!arr.success) throw new PackLoadError(file, ['Datei muss ein JSON-Array enthalten'])
  const out: T[] = []
  const issues: string[] = []
  arr.data.forEach((entry, i) => {
    const r = schema.safeParse(entry)
    if (r.success) out.push(r.data)
    else issues.push(...r.error.issues.map((e) => `[${i}] ${e.path.join('.')}: ${e.message}`))
  })
  if (issues.length) throw new PackLoadError(file, issues.slice(0, 25))
  return out
}

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((e) => [e.id, e]))

/** Load and cross-validate one pack directory. Throws with a readable list of
 *  problems rather than half-loading — a broken pack must not boot the server. */
export async function loadPack(packDir: string): Promise<ContentPack> {
  const manifestRaw = await readJson(packDir, 'pack.json')
  const manifestResult = PackManifestSchema.safeParse(manifestRaw)
  if (!manifestResult.success) {
    throw new PackLoadError('pack.json', manifestResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`))
  }
  const manifest = manifestResult.data

  const [typesRaw, chartRaw, movesRaw, speciesRaw, itemsRaw, areasRaw, regionsRaw, trainersRaw, badgesRaw] =
    await Promise.all([
      readJson(packDir, 'types.json'),
      readJson(packDir, 'type-chart.json'),
      readJson(packDir, 'moves.json'),
      readJson(packDir, 'species.json'),
      readJson(packDir, 'items.json'),
      readJson(packDir, 'areas.json'),
      readJson(packDir, 'regions.json'),
      readJson(packDir, 'trainers.json'),
      readJson(packDir, 'badges.json'),
    ])

  // Kapitel sind optional: ein Pack ohne Story ist gueltig, es hat dann nur
  // keinen roten Faden.
  let chaptersRaw: unknown = []
  try {
    chaptersRaw = await readJson(packDir, 'chapters.json')
  } catch { chaptersRaw = [] }

  const types = byId(parseList('types.json', TypeDefSchema, typesRaw))
  const moves = byId(parseList('moves.json', MoveDefSchema, movesRaw))
  const species = byId(parseList('species.json', SpeciesDefSchema, speciesRaw))
  const items = byId(parseList('items.json', ItemDefSchema, itemsRaw))
  const areas = byId(parseList('areas.json', AreaDefSchema, areasRaw))
  const regions = byId(parseList('regions.json', RegionDefSchema, regionsRaw))
  const trainers = byId(parseList('trainers.json', TrainerDefSchema, trainersRaw))
  const badges = byId(parseList('badges.json', BadgeDefSchema, badgesRaw))
  const chapters = parseList('chapters.json', ChapterDefSchema, chaptersRaw)
    .sort((a, b) => a.order - b.order)

  const chartResult = TypeChartSchema.safeParse(chartRaw)
  if (!chartResult.success) {
    throw new PackLoadError('type-chart.json', chartResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`))
  }

  const pack: ContentPack = {
    manifest, types, typeChart: chartResult.data, moves, species, items, areas, regions, trainers, badges, chapters,
  }
  const refIssues = crossValidate(pack)
  if (refIssues.length) throw new PackLoadError(manifest.id, refIssues.slice(0, 40))
  return pack
}

/** Catch dangling references between files. A typo in a learnset would
 *  otherwise surface as an empty move list in the middle of a battle. */
export function crossValidate(pack: ContentPack): string[] {
  const issues: string[] = []
  const has = (m: Map<string, unknown>, id: string) => m.has(id)

  for (const s of pack.species.values()) {
    for (const t of s.types) if (!has(pack.types, t)) issues.push(`species/${s.id}: unbekannter Typ "${t}"`)
    for (const l of s.learnset) if (!has(pack.moves, l.moveId)) issues.push(`species/${s.id}: unbekannte Attacke "${l.moveId}"`)
    for (const e of s.evolutions) {
      if (!has(pack.species, e.to)) issues.push(`species/${s.id}: Entwicklung zu unbekannter Art "${e.to}"`)
      if (e.trigger === 'stone' && !has(pack.items, e.itemId)) issues.push(`species/${s.id}: Entwicklungsstein "${e.itemId}" fehlt`)
    }
    if (s.learnset.filter((l) => l.level <= 1).length === 0) {
      issues.push(`species/${s.id}: keine Attacke ab Level 1 lernbar`)
    }
  }

  for (const m of pack.moves.values()) {
    if (!has(pack.types, m.type)) issues.push(`move/${m.id}: unbekannter Typ "${m.type}"`)
    if (m.category !== 'status' && m.power === 0) issues.push(`move/${m.id}: Angriff ohne Stärke`)
  }

  for (const a of pack.areas.values()) {
    if (!has(pack.regions, a.regionId)) issues.push(`area/${a.id}: unbekannte Region "${a.regionId}"`)
    if (a.unlock.previousAreaId && !has(pack.areas, a.unlock.previousAreaId)) {
      issues.push(`area/${a.id}: Vorgängergebiet "${a.unlock.previousAreaId}" fehlt`)
    }
    for (const sp of a.spawns) {
      if (!has(pack.species, sp.speciesId)) issues.push(`area/${a.id}: unbekannte Art "${sp.speciesId}"`)
      if (sp.minLevel > sp.maxLevel) issues.push(`area/${a.id}/${sp.speciesId}: minLevel > maxLevel`)
    }
    if (a.spawns.reduce((sum, sp) => sum + sp.weight, 0) <= 0) issues.push(`area/${a.id}: Spawn-Gewichte summieren sich zu 0`)
  }

  /*
   * Jedes Legendaere braucht eine Region, und keines zwei.
   *
   * Genau hier lag der Fehler, der zweimal auftrat: zehn Arten gehoerten zu
   * keinem Fundort und waren damit unerreichbar, ohne dass irgendetwas
   * schiefging. Ein Pack, das eines vergisst, laedt jetzt nicht mehr.
   */
  const zugeordnet = new Map<string, string[]>()
  for (const r of pack.regions.values()) {
    for (const id of r.legendarySpeciesIds) {
      if (!has(pack.species, id)) issues.push(`region/${r.id}: unbekannte Art "${id}" in legendarySpeciesIds`)
      else if (pack.species.get(id)!.rarity !== 'legendary') issues.push(`region/${r.id}: "${id}" ist nicht legendaer`)
      zugeordnet.set(id, [...(zugeordnet.get(id) ?? []), r.id])
    }
  }
  for (const [id, regionen] of zugeordnet) {
    if (regionen.length > 1) issues.push(`species/${id}: in mehreren Regionen legendaer (${regionen.join(', ')})`)
  }
  for (const s of pack.species.values()) {
    if (s.rarity === 'legendary' && !s.event && !zugeordnet.has(s.id)) {
      issues.push(`species/${s.id}: legendaer, aber in keiner Region zu finden`)
    }
  }

  for (const t of pack.types.values()) {
    const row = pack.typeChart[t.id]
    if (!row) issues.push(`type-chart: Zeile für "${t.id}" fehlt`)
  }
  for (const [atk, row] of Object.entries(pack.typeChart)) {
    if (!has(pack.types, atk)) issues.push(`type-chart: unbekannter Angreifer-Typ "${atk}"`)
    for (const def of Object.keys(row)) {
      if (!has(pack.types, def)) issues.push(`type-chart/${atk}: unbekannter Verteidiger-Typ "${def}"`)
    }
  }

  for (const t of pack.trainers.values()) {
    if (t.badgeId && !has(pack.badges, t.badgeId)) issues.push(`trainer/${t.id}: unbekannter Orden "${t.badgeId}"`)
    for (const member of t.team) {
      if (!has(pack.species, member.speciesId)) issues.push(`trainer/${t.id}: unbekannte Art "${member.speciesId}"`)
      for (const mv of member.moves ?? []) {
        if (!has(pack.moves, mv)) issues.push(`trainer/${t.id}: unbekannte Attacke "${mv}"`)
      }
      if (member.heldItemId && !has(pack.items, member.heldItemId)) {
        issues.push(`trainer/${t.id}: unbekanntes Item "${member.heldItemId}"`)
      }
    }
  }

  /*
   * Freischaltbedingungen muessen unter den unguenstigsten Umstaenden
   * erfuellbar sein.
   *
   * Spawns koennen an Tageszeit oder Wetter haengen. Wer nur abends spielt,
   * sieht die Tag-Arten nie. Verlangt ein Gebiet mehr Faenge, als im
   * Vorgaenger *bedingungslos* vorkommen, ist es fuer manche Spieler
   * dauerhaft verschlossen — ein Fehler, der sich im Betrieb erst nach Wochen
   * zeigt und hier in Millisekunden auffaellt.
   */
  for (const a of pack.areas.values()) {
    const prevId = a.unlock.previousAreaId
    if (prevId && a.unlock.minCaughtInPrevious > 0) {
      const prev = pack.areas.get(prevId)
      if (prev) {
        const always = new Set(
          prev.spawns.filter((sp) => !sp.timeOfDay && !sp.weather).map((sp) => sp.speciesId),
        )
        if (a.unlock.minCaughtInPrevious > always.size) {
          issues.push(
            `area/${a.id}: verlangt ${a.unlock.minCaughtInPrevious} Faenge in "${prevId}", ` +
            `dort sind aber nur ${always.size} Arten jederzeit anzutreffen — ` +
            'fuer Spieler zu bestimmten Tageszeiten unerreichbar',
          )
        }
      }
    }
  }

  for (const a of pack.areas.values()) {
    for (const tid of a.trainerIds) {
      if (!has(pack.trainers, tid)) issues.push(`area/${a.id}: unbekannter Trainer "${tid}"`)
    }
    if (a.gymId && !has(pack.trainers, a.gymId)) issues.push(`area/${a.id}: unbekannte Arena "${a.gymId}"`)
    for (const b of a.unlock.requiredBadgeIds) {
      if (!has(pack.badges, b)) issues.push(`area/${a.id}: unbekannter Orden "${b}"`)
    }
  }

  for (const chapter of pack.chapters) {
    for (const req of chapter.requires) {
      if (req.kind === 'areaVisited' && !has(pack.areas, String(req.value))) {
        issues.push(`chapter/${chapter.id}: unbekanntes Gebiet "${req.value}"`)
      }
      if (req.kind === 'defeated' && !has(pack.trainers, String(req.value))) {
        issues.push(`chapter/${chapter.id}: unbekannter Trainer "${req.value}"`)
      }
    }
    const item = chapter.reward.itemId
    if (item && !has(pack.items, item)) issues.push(`chapter/${chapter.id}: unbekanntes Item "${item}"`)
  }

  for (const id of pack.manifest.starterSpeciesIds) {
    if (!has(pack.species, id)) issues.push(`pack.json: Starter "${id}" existiert nicht`)
  }
  for (const region of pack.regions.values()) {
    for (const id of region.starterSpeciesIds) {
      if (!has(pack.species, id)) issues.push(`region/${region.id}: Starter "${id}" existiert nicht`)
    }
  }
  if (!has(pack.areas, pack.manifest.startingArea)) {
    issues.push(`pack.json: Startgebiet "${pack.manifest.startingArea}" existiert nicht`)
  }
  return issues
}

export async function listPacks(packsRoot: string): Promise<string[]> {
  const entries = await readdir(packsRoot, { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
}
