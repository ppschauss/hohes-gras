/**
 * Baut ein Content-Pack aus PokéAPI-Daten plus kuratierten Spielinhalten.
 *
 *   node --experimental-strip-types tools/import-pokeapi.ts [--out DIR] [--dex 1-151]
 *
 * Idempotent: API-Antworten und Sprites landen in einem Cache, ein zweiter Lauf
 * ist deshalb schnell und belastet die öffentliche API nicht erneut.
 *
 * Rechtlicher Hinweis: Namen und Sprites sind fremdes Eigentum. Das erzeugte
 * Pack liegt in data/ und gehört bewusst nicht ins Repository.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { PokeApi } from './pokeapi-client.ts'
import { importTypes } from './import-types.ts'
import { importSpecies } from './import-species.ts'
import { importMoves } from './import-moves.ts'
import { buildItems, lureItems } from './curated-items.ts'
import { mirrorItemIcons, mirrorSprites } from './import-sprites.ts'
import { AREAS, BADGES, REGIONS, TRAINERS } from './curated-kanto.ts'
import { CHAPTERS } from './curated-story.ts'
import { JOHTO_AREAS, JOHTO_BADGES, JOHTO_CHAPTERS, JOHTO_REGION, JOHTO_TRAINERS } from './curated-johto.ts'
import { HOENN_AREAS, HOENN_BADGES, HOENN_CHAPTERS, HOENN_REGION, HOENN_TRAINERS } from './curated-hoenn.ts'

const args = process.argv.slice(2)
const argValue = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback
}

const DATA_DIR = resolve(argValue('--data', '/mnt/cache/appdata/telegram-pokemon/data'))
const PACK_ID = argValue('--pack', 'kanto')
const DEX_RANGE = argValue('--dex', '1-151')
const OUT_DIR = resolve(argValue('--out', join(DATA_DIR, 'packs', PACK_ID)))
const CACHE_DIR = join(DATA_DIR, '.cache', 'pokeapi')
const MEDIA_DIR = join(DATA_DIR, 'media')

const log = (m: string) => console.log(`  ${m}`)
const step = (m: string) => console.log(`\n▸ ${m}`)

function parseDex(range: string): number[] {
  const out: number[] = []
  for (const part of range.split(',')) {
    const [a, b] = part.split('-').map((n) => Number(n.trim()))
    if (!a) continue
    for (let i = a; i <= (b ?? a); i++) out.push(i)
  }
  return out
}

async function main(): Promise<void> {
  const dex = parseDex(DEX_RANGE)
  console.log(`Content-Pack "${PACK_ID}" — Pokédex ${DEX_RANGE} (${dex.length} Arten)`)
  console.log(`Ziel: ${OUT_DIR}`)

  await mkdir(CACHE_DIR, { recursive: true })
  await mkdir(OUT_DIR, { recursive: true })
  const api = new PokeApi(CACHE_DIR)

  step('Typen und Typentabelle')
  const { types, chart } = await importTypes(api, log)
  const knownTypes = new Set(types.map((t) => t.id))

  step('Arten, Entwicklungen und Lernsets')
  const { species, moveIds, stoneItemIds } = await importSpecies(api, dex, knownTypes, log)

  step('Attacken')
  const moves = await importMoves(api, moveIds, knownTypes, log)

  // Learnsets may reference moves the engine could not represent. Dropping the
  // reference here keeps the pack internally consistent; leaving it would fail
  // cross-validation at boot.
  const usableMoves = new Set(moves.map((m) => m.id))
  let prunedLearnset = 0
  let repaired = 0
  for (const sp of species) {
    const before = sp.learnset.length
    sp.learnset = sp.learnset.filter((l) => usableMoves.has(l.moveId))
    prunedLearnset += before - sp.learnset.length
    // Every species must be able to act on turn one.
    if (!sp.learnset.some((l) => l.level <= 1)) {
      const first = sp.learnset[0]
      if (first) { first.level = 1; repaired++ }
      else {
        const fallback = moves.find((m) => m.type === sp.types[0] && m.category !== 'status')
          ?? moves.find((m) => m.id === 'tackle') ?? moves[0]
        if (fallback) { sp.learnset.push({ moveId: fallback.id, level: 1 }); repaired++ }
      }
    }
  }
  log(`${prunedLearnset} Lernset-Einträge entfernt, ${repaired} Arten auf Level-1-Attacke korrigiert`)

  step('Items')
  const heldItemIds = new Set<string>()
  for (const sp of species) {
    for (const e of sp.evolutions as Array<{ heldItemId?: string }>) {
      if (e.heldItemId) heldItemIds.add(e.heldItemId)
    }
  }
  const items = [
    ...await buildItems(api, new Set([...stoneItemIds, ...heldItemIds]), log),
    // Ein Lockduft je Typ — aus den Typen des Packs erzeugt.
    ...lureItems(types),
  ]

  step('Sprites spiegeln')
  const sprites = await mirrorSprites(species, MEDIA_DIR, log)
  await mirrorItemIcons(items.map((i) => i.id), MEDIA_DIR, log)
  if (sprites.failed.length) {
    log(`Fehlgeschlagen: ${sprites.failed.slice(0, 5).join('; ')}${sprites.failed.length > 5 ? ' …' : ''}`)
  }

  step('Welt zusammensetzen')
  const inPack = new Set(species.map((s) => s.id))
  const missingSpawns = new Set<string>()
  // Eine Region kommt nur mit, wenn ihre Arten im Dex-Bereich liegen — sonst
  // waere sie ein leeres Versprechen: der Loader wirft ihre Spawn-Tabellen
  // heraus und uebrig blieben Gebiete ohne Bewohner.
  const withJohto = dex.some((n) => n > 151)
  const withHoenn = dex.some((n) => n > 251)
  const allAreas = [...AREAS, ...(withJohto ? JOHTO_AREAS : []), ...(withHoenn ? HOENN_AREAS : [])]
  const allTrainerDefs = [...TRAINERS, ...(withJohto ? JOHTO_TRAINERS : []), ...(withHoenn ? HOENN_TRAINERS : [])]
  const allBadges = [...BADGES, ...(withJohto ? JOHTO_BADGES : []), ...(withHoenn ? HOENN_BADGES : [])]
  const allRegions = [...REGIONS, ...(withJohto ? [JOHTO_REGION] : []), ...(withHoenn ? [HOENN_REGION] : [])]
  const allChapters = [...CHAPTERS, ...(withJohto ? JOHTO_CHAPTERS : []), ...(withHoenn ? HOENN_CHAPTERS : [])]

  const areas = allAreas.map((a) => ({
    ...a,
    spawns: a.spawns.filter((sp) => {
      if (inPack.has(sp.speciesId)) return true
      missingSpawns.add(sp.speciesId)
      return false
    }),
  }))
  const trainers = allTrainerDefs.map((t) => ({
    ...t,
    team: t.team.filter((m) => inPack.has(m.speciesId)),
  })).filter((t) => t.team.length > 0)

  if (missingSpawns.size) {
    log(`Nicht im Dex-Bereich, aus Spawn-Tabellen entfernt: ${[...missingSpawns].join(', ')}`)
  }
  const droppedTrainers = allTrainerDefs.length - trainers.length
  if (droppedTrainers) log(`${droppedTrainers} Trainer ohne verfügbares Team entfernt`)
  // Gebiete ohne verbliebene Spawns wuerden die Validierung sprengen.
  const usableAreas = areas.filter((a) => a.spawns.length > 0)
  const droppedAreas = areas.length - usableAreas.length
  if (droppedAreas) log(`${droppedAreas} Gebiete ohne verfügbare Spawns entfernt`)

  const knownAreas = new Set(usableAreas.map((a) => a.id))
  const knownTrainers = new Set(trainers.map((t) => t.id))
  const repairedAreas = usableAreas.map((a) => ({
    ...a,
    trainerIds: a.trainerIds.filter((id) => knownTrainers.has(id)),
    gymId: a.gymId && knownTrainers.has(a.gymId) ? a.gymId : null,
    unlock: {
      ...a.unlock,
      previousAreaId: a.unlock.previousAreaId && knownAreas.has(a.unlock.previousAreaId)
        ? a.unlock.previousAreaId : null,
    },
  }))

  const knownBadges = new Set(allBadges.map((b) => b.id))
  const chapters = allChapters.filter((c) =>
    c.requires.every((r) =>
      (r.kind !== 'areaVisited' || knownAreas.has(String(r.value))) &&
      (r.kind !== 'defeated' || knownTrainers.has(String(r.value)))))

  /*
   * Freischaltbedingungen auf das Erreichbare klemmen.
   *
   * Die kuratierten Zahlen sagen, wie viel Erkundung ein Gebiet *idealerweise*
   * verlangen soll. Ob das erreichbar ist, haengt aber davon ab, wie viele
   * Arten im Vorgaenger unabhaengig von Tageszeit und Wetter vorkommen — und
   * das aendert sich, sobald jemand eine Spawn-Tabelle anfasst. Die Absicht
   * bleibt in den Daten, die Erreichbarkeit garantiert die Pipeline.
   */
  const areaById = new Map(repairedAreas.map((a) => [a.id, a]))
  const clamped: string[] = []

  const finalAreas = repairedAreas.map((a) => {
    let minCaught = a.unlock.minCaughtInPrevious
    const prev = a.unlock.previousAreaId ? areaById.get(a.unlock.previousAreaId) : undefined
    if (prev && minCaught > 0) {
      const always = new Set(
        prev.spawns.filter((sp) => !sp.timeOfDay && !sp.weather).map((sp) => sp.speciesId),
      ).size
      if (minCaught > always) {
        clamped.push(`${a.id}: ${minCaught} → ${always} (${prev.id})`)
        minCaught = always
      }
    }
    return {
      ...a,
      unlock: {
        ...a.unlock,
        minCaughtInPrevious: minCaught,
        requiredBadgeIds: a.unlock.requiredBadgeIds.filter((b) => knownBadges.has(b)),
      },
    }
  })

  if (clamped.length) {
    log(`${clamped.length} Freischaltbedingungen auf das jederzeit Erreichbare geklemmt:`)
    for (const line of clamped) log(`  ${line}`)
  }

  log(`Regionen: ${allRegions.length}, Gebiete: ${finalAreas.length}, Trainer: ${trainers.length}, ` +
      `Orden: ${allBadges.length}, Kapitel: ${chapters.length}`)

  step('Schreiben')
  const write = async (name: string, value: unknown) => {
    await writeFile(join(OUT_DIR, name), JSON.stringify(value, null, 1))
    log(`${name}`)
  }
  await write('types.json', types)
  await write('type-chart.json', chart)
  await write('moves.json', moves)
  await write('species.json', species)
  await write('items.json', items)
  await write('areas.json', finalAreas)
  await write('regions.json', allRegions)
  await write('trainers.json', trainers)
  await write('badges.json', allBadges)
  await write('chapters.json', chapters)
  await write('pack.json', {
    id: PACK_ID,
    // Der Name folgt dem Inhalt, nicht dem Ordner: ein Pack mit zwei Regionen
    // "Kanto" zu nennen waere schlicht falsch.
    name: allRegions.map((r) => r.name.de).join(' & '),
    version: new Date().toISOString().slice(0, 10),
    notice:
      'Enthält Namen und Sprites aus PokéAPI. Diese sind Eigentum von Nintendo/Game Freak/The Pokémon Company. ' +
      'Nur für den privaten Betrieb. Nicht öffentlich verteilen.',
    defaultLocale: 'de',
    starterSpeciesIds: ['bulbasaur', 'charmander', 'squirtle'],
    startingArea: 'route-1',
  })

  step('Gegenprüfung: Pack laden')
  const { loadPack } = await import('../packages/content/dist/loader.js')
  const pack = await loadPack(OUT_DIR)
  console.log(
    `\n✓ Pack gültig — ${pack.species.size} Arten, ${pack.moves.size} Attacken, ${pack.types.size} Typen, ` +
    `${pack.items.size} Items, ${pack.areas.size} Gebiete, ${pack.trainers.size} Trainer, ` +
    `${pack.badges.size} Orden, ${pack.chapters.length} Kapitel`,
  )
}

main().catch((err: Error) => {
  console.error('\n✗ Import fehlgeschlagen:\n' + err.message)
  process.exit(1)
})
