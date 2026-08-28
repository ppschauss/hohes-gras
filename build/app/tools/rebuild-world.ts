/**
 * Welt neu erzeugen — ohne PokéAPI.
 *
 *   node --experimental-strip-types tools/rebuild-world.ts [--data /pfad] [--pack kanto]
 *
 * Arten, Attacken und Sprites bleiben, wie sie sind; neu geschrieben werden
 * nur Gebiete, Regionen, Trainer, Orden und Kapitel aus den kuratierten
 * Dateien. Der vollständige Import zieht dafür Tausende Anfragen an eine
 * fremde API — für eine Änderung an einer Spawn-Tabelle ist das absurd, und
 * absurd langsame Werkzeuge benutzt man dann eben nicht.
 *
 * Dieselben Reparaturen wie im Import: unbekannte Arten fliegen aus
 * Spawn-Tabellen, Trainer ohne Team fallen weg, und Freischaltbedingungen
 * werden auf das geklemmt, was im Vorgängergebiet jederzeit erreichbar ist.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { AUTHORED } from './curated-items.ts'
import { AREAS, BADGES, REGIONS, TRAINERS } from './curated-kanto.ts'
import { CHAPTERS } from './curated-story.ts'
import { JOHTO_AREAS, JOHTO_BADGES, JOHTO_CHAPTERS, JOHTO_REGION, JOHTO_TRAINERS } from './curated-johto.ts'

const args = process.argv.slice(2)
const arg = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback
}
const DATA_DIR = resolve(arg('--data', '/mnt/cache/appdata/telegram-pokemon/data'))
const PACK = arg('--pack', 'kanto')
const OUT = join(DATA_DIR, 'packs', PACK)

const log = (msg: string) => console.log(`  ${msg}`)

async function main(): Promise<void> {
  const species = JSON.parse(await readFile(join(OUT, 'species.json'), 'utf8')) as Array<{ id: string }>
  const inPack = new Set(species.map((s) => s.id))
  console.log(`Welt neu erzeugen · Pack "${PACK}" · ${inPack.size} bekannte Arten\n`)

  const allAreas = [...AREAS, ...JOHTO_AREAS]
  const allRegions = [...REGIONS, JOHTO_REGION]
  const allBadges = [...BADGES, ...JOHTO_BADGES]
  const allTrainerDefs = [...TRAINERS, ...JOHTO_TRAINERS]
  const allChapters = [...CHAPTERS, ...JOHTO_CHAPTERS]

  const missingSpawns = new Set<string>()
  const areas = allAreas.map((a) => ({
    ...a,
    spawns: a.spawns.filter((sp) => {
      if (inPack.has(sp.speciesId)) return true
      missingSpawns.add(sp.speciesId)
      return false
    }),
  }))
  const trainers = allTrainerDefs
    .map((t) => ({ ...t, team: t.team.filter((m) => inPack.has(m.speciesId)) }))
    .filter((t) => t.team.length > 0)

  if (missingSpawns.size) log(`Nicht im Pack, aus Spawn-Tabellen entfernt: ${[...missingSpawns].join(', ')}`)
  const dropped = allTrainerDefs.length - trainers.length
  if (dropped) log(`${dropped} Trainer ohne verfügbares Team entfernt`)

  const usableAreas = areas.filter((a) => a.spawns.length > 0)
  const knownAreas = new Set(usableAreas.map((a) => a.id))
  const knownTrainers = new Set(trainers.map((t) => t.id))
  const knownBadges = new Set(allBadges.map((b) => b.id))

  const repaired = usableAreas.map((a) => ({
    ...a,
    trainerIds: a.trainerIds.filter((id) => knownTrainers.has(id)),
    gymId: a.gymId && knownTrainers.has(a.gymId) ? a.gymId : null,
    unlock: {
      ...a.unlock,
      previousAreaId: a.unlock.previousAreaId && knownAreas.has(a.unlock.previousAreaId)
        ? a.unlock.previousAreaId : null,
    },
  }))

  const areaById = new Map(repaired.map((a) => [a.id, a]))
  const clamped: string[] = []
  const finalAreas = repaired.map((a) => {
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
    log(`${clamped.length} Freischaltbedingungen geklemmt:`)
    for (const line of clamped) log(`  ${line}`)
  }

  const chapters = allChapters.filter((c) =>
    c.requires.every((r) =>
      (r.kind !== 'areaVisited' || knownAreas.has(String(r.value))) &&
      (r.kind !== 'defeated' || knownTrainers.has(String(r.value)))))

  /*
   * Gegenstände zusammenführen statt neu bauen.
   *
   * `buildItems` fragt für Entwicklungssteine Namen bei der PokéAPI ab — genau
   * das soll hier nicht passieren. Die kuratierten Einträge überschreiben also
   * die vorhandenen, alles Abgeleitete bleibt unangetastet.
   */
  const existing = JSON.parse(await readFile(join(OUT, 'items.json'), 'utf8')) as Array<{ id: string }>
  const byId = new Map(existing.map((i) => [i.id, i]))
  let added = 0
  for (const a of AUTHORED) {
    const before = byId.get(a.id)
    if (!before) added++
    byId.set(a.id, {
      ...before,
      id: a.id,
      category: a.category,
      price: a.price,
      sellPrice: a.sellPrice,
      params: a.params ?? {},
      ...(a.name ? { name: { de: a.name } } : {}),
      ...(a.description ? { description: { de: a.description } } : {}),
      icon: (before as { icon?: string } | undefined)?.icon ?? `/media/items/${a.id}.png`,
      stackable: true,
    })
  }
  const mergedItems = [...byId.values()].sort((x, y) => x.id.localeCompare(y.id))
  if (added) log(`${added} neue Gegenstände`)

  const write = async (name: string, value: unknown) => {
    await writeFile(join(OUT, name), JSON.stringify(value, null, 1))
    log(name)
  }
  await write('items.json', mergedItems)
  await write('areas.json', finalAreas)
  await write('regions.json', allRegions)
  await write('trainers.json', trainers)
  await write('badges.json', allBadges)
  await write('chapters.json', chapters)

  console.log(`\n✓ ${allRegions.length} Regionen, ${finalAreas.length} Gebiete, ` +
    `${trainers.length} Trainer, ${allBadges.length} Orden, ${chapters.length} Kapitel`)
}

main().catch((err: Error) => {
  console.error('Fehlgeschlagen:', err.message)
  process.exit(1)
})
