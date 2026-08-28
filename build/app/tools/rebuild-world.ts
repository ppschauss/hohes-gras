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
import { AUTHORED, lureItems } from './curated-items.ts'
import { EVENT_SPECIES } from './curated-event.ts'
import { AREAS, BADGES, REGIONS, TRAINERS } from './curated-kanto.ts'
import { CHAPTERS } from './curated-story.ts'
import { JOHTO_AREAS, JOHTO_BADGES, JOHTO_CHAPTERS, JOHTO_REGION, JOHTO_TRAINERS } from './curated-johto.ts'
import { HOENN_AREAS, HOENN_BADGES, HOENN_CHAPTERS, HOENN_REGION, HOENN_TRAINERS } from './curated-hoenn.ts'

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
  const species = JSON.parse(await readFile(join(OUT, 'species.json'), 'utf8')) as Array<Record<string, any>>

  /*
   * Ereignis-Arten aus ihren Vorbildern zusammensetzen.
   *
   * Werte und Typen vom ersten Vorbild, Lernset aus allen dreien vereinigt —
   * je Attacke das niedrigste Level, damit wirklich alles lernbar ist. Keine
   * Entwicklung: das ist der Witz an der Sache.
   */
  const speciesById = new Map(species.map((sp) => [sp.id as string, sp]))
  let eventCount = 0
  for (const ev of EVENT_SPECIES) {
    const base = speciesById.get(ev.basedOn[0]!)
    if (!base) continue
    const learnset = new Map<string, number>()
    for (const source of ev.basedOn) {
      for (const l of (speciesById.get(source)?.learnset ?? []) as Array<{ moveId: string; level: number }>) {
        const before = learnset.get(l.moveId)
        if (before === undefined || l.level < before) learnset.set(l.moveId, l.level)
      }
    }
    const entry = {
      ...base,
      id: ev.id,
      dexNumber: ev.dexNumber,
      name: ev.name,
      description: ev.description,
      types: ev.types,
      evolutions: [],
      learnset: [...learnset].map(([moveId, level]) => ({ moveId, level })).sort((a, b) => a.level - b.level),
      xpFactor: ev.xpFactor,
      event: true,
      sprite: ev.sprite,
      spriteShiny: ev.sprite,
    }
    const index = species.findIndex((sp) => sp.id === ev.id)
    if (index >= 0) species[index] = entry
    else { species.push(entry); eventCount++ }
    speciesById.set(ev.id, entry)
  }
  if (eventCount) log(`${eventCount} Ereignis-Arten ergaenzt`)
  await writeFile(join(OUT, 'species.json'), JSON.stringify(species, null, 1))

  const inPack = new Set(species.map((s) => s.id as string))
  console.log(`Welt neu erzeugen · Pack "${PACK}" · ${inPack.size} bekannte Arten\n`)

  const allAreas = [...AREAS, ...JOHTO_AREAS, ...HOENN_AREAS]
  const allRegions = [...REGIONS, JOHTO_REGION, HOENN_REGION]
  const allBadges = [...BADGES, ...JOHTO_BADGES, ...HOENN_BADGES]
  const allTrainerDefs = [...TRAINERS, ...JOHTO_TRAINERS, ...HOENN_TRAINERS]
  const allChapters = [...CHAPTERS, ...JOHTO_CHAPTERS, ...HOENN_CHAPTERS]

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

  /*
   * Die Dex-Schwelle je Gebiet — als Formel, nicht als 38 Handzahlen.
   *
   * Gefordert wird, was im Pokédex steht, nicht was im Vorgängergebiet
   * gefangen wurde: sonst muss man dasselbe Taubsi auf jeder Route neu fangen.
   * Je Region ein Sockel und ein Schritt je Gebiet — Kantos fünfzehntes Gebiet
   * landet so bei knapp hundert Arten, und die späteren Regionen setzen dort
   * an, wo die vorige aufgehört hat.
   */
  const DEX_GATE: Record<string, { base: number; step: number }> = {
    kanto: { base: 0, step: 7 },
    johto: { base: 80, step: 6 },
    hoenn: { base: 150, step: 6 },
  }
  /*
   * Das erste Gebiet einer Region verlangt nichts.
   *
   * Dort steht schon die Regionssperre — man kommt ohnehin nur herein, wenn
   * die vorige Region bezwungen ist. Eine Dex-Schwelle obendrauf hiesse: erst
   * die Liga gewinnen, dann noch hundert Arten nachsammeln, bevor man den Fuss
   * auf die erste Route setzen darf.
   */
  const dexGate = (regionId: string, order: number): number => {
    if (order <= 1) return 0
    const g = DEX_GATE[regionId] ?? { base: 0, step: 6 }
    return g.base + (order - 2) * g.step
  }

  const areaById = new Map(repaired.map((a) => [a.id, a]))
  const finalAreas = repaired.map((a) => ({
    ...a,
    unlock: {
      ...a.unlock,
      // Die alte Bedingung ist abgeloest; sie bleibt im Schema, damit
      // aeltere Packs weiter laden.
      minCaughtInPrevious: 0,
      minDexCaught: dexGate(a.regionId, a.order),
      requiredBadgeIds: a.unlock.requiredBadgeIds.filter((b) => knownBadges.has(b)),
    },
  }))
  log(`Dex-Schwellen: ${finalAreas.map((a) => a.unlock.minDexCaught).join(', ')}`)

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
  // Lockduefte folgen den Typen des Packs; ein neuer Typ bringt seinen mit.
  const types = JSON.parse(await readFile(join(OUT, 'types.json'), 'utf8')) as Array<{ id: string; name: { de: string } }>
  for (const lure of lureItems(types)) {
    const before = byId.get(lure.id)
    if (!before) added++
    byId.set(lure.id, { ...before, ...lure })
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
