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
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { LOGIN_REWARDS, RECIPES } from '../packages/engine/dist/index.js'
import { AUTHORED, lureItems, soulItems, SVG_ICONS } from './curated-items.ts'
import { EVENT_SPECIES } from './curated-event.ts'
import { AREAS, BADGES, REGIONS, TRAINERS } from './curated-kanto.ts'
import { regionChapters } from './curated-story.ts'
import { JOHTO_AREAS, JOHTO_BADGES, JOHTO_REGION, JOHTO_TRAINERS } from './curated-johto.ts'
import { HOENN_AREAS, HOENN_BADGES, HOENN_REGION, HOENN_TRAINERS } from './curated-hoenn.ts'

const args = process.argv.slice(2)
const arg = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback
}
const DATA_DIR = resolve(arg('--data', '/mnt/cache/appdata/telegram-pokemon/data'))
const PACK = arg('--pack', 'kanto')
const OUT = join(DATA_DIR, 'packs', PACK)
const MEDIA_DIR = join(DATA_DIR, 'media')

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
    // Eigene Attacken zuletzt: sie duerfen ein geerbtes Level unterbieten,
    // aber nie ueberschreiben, was schon frueher zu haben ist.
    for (const extra of ev.extraMoves ?? []) {
      const before = learnset.get(extra.moveId)
      if (before === undefined || extra.level < before) learnset.set(extra.moveId, extra.level)
    }
    const entry = {
      ...base,
      id: ev.id,
      dexNumber: ev.dexNumber,
      name: ev.name,
      description: ev.description,
      types: ev.types,
      /*
       * Besondere Arten pflanzen sich nicht fort.
       *
       * Sie erbten ihre Ei-Gruppen vom Vorbild und liessen sich damit
       * nachzuechten — aus einem Fund mit zwei Prozent auf einer einzigen
       * Route wurde eine Produktion. Gemeldet, und zu Recht: was man findet,
       * soll ein Fund bleiben. Die leere Gruppe ist derselbe Weg, den das Pack
       * fuer Legendaere schon geht.
       */
      eggGroups: [],
      evolutions: ev.evolvesTo ? [{ trigger: 'level', to: ev.evolvesTo.to, level: ev.evolvesTo.level }] : [],
      learnset: [...learnset].map(([moveId, level]) => ({ moveId, level })).sort((a, b) => a.level - b.level),
      xpFactor: ev.xpFactor,
      // Nur die unfangbaren sind Ereignis-Arten. Was man findet, gehoert in
      // den Dex und in die Summe — sonst bliebe er fuer alle unvollstaendig,
      // die es nicht gefunden haben, und fuer die Finder unlogisch.
      event: ev.eventOnly === true,
      ivFloor: ev.ivFloor ?? 0,
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
  /*
   * Eine Kapitelkette je Region, aus der Welt gebaut statt von Hand gepflegt.
   *
   * Die alten Listen (CHAPTERS, JOHTO_CHAPTERS, HOENN_CHAPTERS) waren eine
   * einzige Kette und setzten die Reihenfolge Kanto → Johto → Hoenn voraus.
   * Seit die Startregion frei ist, stimmt diese Annahme nicht mehr: Kapitel 2
   * verlangte den Vertania-Wald, und wer in Hoenn anfaengt, kommt dort erst
   * nach der halben Welt vorbei.
   */
  const guides: Record<string, string> = {
    kanto: 'Prof. Eich', johto: 'Prof. Lind', hoenn: 'Prof. Birk',
  }
  const allChapters = allRegions.flatMap((region, index) => {
    const own = allAreas
      .filter((a) => a.regionId === region.id)
      .sort((a, b) => a.order - b.order)
    const second = own[1] ?? own[0]!
    const badgeCount = own.filter((a) => a.gymId).length
    return regionChapters({
      regionId: region.id,
      regionName: region.name.de,
      guide: guides[region.id] ?? 'Der Professor',
      tier: index,
      secondAreaId: second.id,
      secondAreaName: second.name.de,
      badgeCount,
    })
  })
  log(`${allChapters.length} Kapitel über ${allRegions.length} Regionen`)

  /*
   * Wilde Vorkommen der besonderen Arten.
   *
   * Dieselbe Stelle in jeder Region — das zehnte Gebiet —, und der Anteil wird
   * aus den vorhandenen Gewichten gerechnet: `w = p/(100-p) * Summe`. Ein
   * festes Gewicht waere in jedem Gebiet ein anderer Prozentsatz.
   */
  let wildPlacements = 0
  for (const ev of EVENT_SPECIES) {
    if (!ev.wild) continue
    for (const region of allRegions) {
      const own = allAreas
        .filter((a) => a.regionId === region.id)
        .sort((a, b) => a.order - b.order)
      const area = own[ev.wild.areaOrder - 1] ?? own[own.length - 1]
      if (!area) continue
      if (area.spawns.some((sp) => sp.speciesId === ev.id)) continue
      const sum = area.spawns.reduce((n, sp) => n + sp.weight, 0)
      const band = area.spawns.reduce(
        (acc, sp) => ({ min: Math.min(acc.min, sp.minLevel), max: Math.max(acc.max, sp.maxLevel) }),
        { min: 99, max: 1 },
      )
      area.spawns.push({
        speciesId: ev.id,
        weight: Math.max(1, Math.round((ev.wild.chance / (100 - ev.wild.chance)) * sum)),
        minLevel: band.min,
        maxLevel: band.max,
      })
      wildPlacements++
    }
  }
  if (wildPlacements) log(`${wildPlacements} seltene Vorkommen gesetzt`)

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
  /*
   * Ein Anteil dessen, was erreichbar ist — keine feste Stufenzahl.
   *
   * Vorher stand hier je Region ein Schritt: Kanto sieben Arten je Gebiet,
   * Johto und Hoenn sechs. Nachgerechnet war das in Kanto ab dem fuenften
   * Gebiet *unloesbar* — die Schwelle verlangte mehr Arten, als in allen
   * vorherigen Gebieten zusammen ueberhaupt vorkommen, bis zu sieben mehr. Und
   * in Hoenn brauchte man 36 von 42 erreichbaren, also 86 Prozent: damit ist
   * jede wetter- oder tageszeitgebundene Art Pflicht. Genau daran haengen
   * Meldungen wie "34/36 Arten, das ist zu praesent".
   *
   * Zwei Drittel des Erreichbaren lassen Luft fuer das, was man nicht
   * erwischt: die seltenen, die bedingten, die uebersehenen. Und es rechnet
   * sich selbst nach, wenn sich der Inhalt aendert — eine neue Route mit
   * wenigen Arten hebt die Schwelle nur um wenig.
   */
  const DEX_GATE_SHARE = 2 / 3

  const byRegion = new Map<string, typeof repaired>()
  for (const a of repaired) {
    const list = byRegion.get(a.regionId) ?? []
    list.push(a)
    byRegion.set(a.regionId, list)
  }
  /** Je Gebiet: wie viele Arten in allen *vorherigen* Gebieten vorkommen. */
  const reachableBefore = new Map<string, number>()
  for (const list of byRegion.values()) {
    const seen = new Set<string>()
    for (const a of [...list].sort((x, y) => x.order - y.order)) {
      reachableBefore.set(a.id, seen.size)
      for (const sp of a.spawns) seen.add(sp.speciesId)
    }
  }

  /*
   * Das erste Gebiet einer Region verlangt nichts.
   *
   * Dort steht schon die Regionssperre — man kommt ohnehin nur herein, wenn
   * die vorige Region bezwungen ist. Eine Dex-Schwelle obendrauf hiesse: erst
   * die Liga gewinnen, dann noch hundert Arten nachsammeln, bevor man den Fuss
   * auf die erste Route setzen darf.
   */
  const dexGate = (areaId: string, order: number): number =>
    (order <= 1 ? 0 : Math.round((reachableBefore.get(areaId) ?? 0) * DEX_GATE_SHARE))

  const areaById = new Map(repaired.map((a) => [a.id, a]))
  const finalAreas = repaired.map((a) => ({
    ...a,
    unlock: {
      ...a.unlock,
      // Die alte Bedingung ist abgeloest; sie bleibt im Schema, damit
      // aeltere Packs weiter laden.
      minCaughtInPrevious: 0,
      minDexCaught: dexGate(a.id, a.order),
      requiredBadgeIds: a.unlock.requiredBadgeIds.filter((b) => knownBadges.has(b)),
    },
  }))
  log(`Dex-Schwellen: ${finalAreas.map((a) => a.unlock.minDexCaught).join(', ')}`)

  /*
   * Die geforderte Pokemon-Zahl darf entlang der Kette nie sinken.
   *
   * Im Pack stand hinter dem Indigo-Plateau (sechs Pokemon) das Kraftwerk mit
   * vier und die Unbekannte Hoehle mit fuenf — gemeldet mit den Worten "macht
   * iwie kein Sinn, spaeter brauchst du nur vier". Neun Gebiete ueber alle
   * Regionen hatten denselben Sprung nach unten. Die Kette ist die Wahrheit
   * darueber, was "spaeter" heisst, nicht die Reihenfolge in der Datei.
   */
  const kinder = new Map<string | null, string[]>()
  for (const a of finalAreas) {
    const vor = a.unlock.previousAreaId ?? null
    kinder.set(vor, [...(kinder.get(vor) ?? []), a.id])
  }
  const nachId = new Map(finalAreas.map((a) => [a.id, a]))
  const stapel = [...(kinder.get(null) ?? [])]
  let hoechste = 0
  let angehoben = 0
  while (stapel.length > 0) {
    const id = stapel.shift()!
    stapel.unshift(...(kinder.get(id) ?? []))
    const bedingung = nachId.get(id)?.unlock.minCreaturesAtLevel
    if (!bedingung) continue
    if (bedingung.count < hoechste) {
      bedingung.count = hoechste
      angehoben++
    }
    hoechste = Math.max(hoechste, bedingung.count)
  }
  if (angehoben) log(`${angehoben} Gebiete auf die vorige Pokemon-Zahl angehoben`)

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
      // Selbst gezeichnete Bilder liegen als Vektor vor; alles andere kommt
      // als PNG aus dem Sprite-Abgleich.
      icon: (before as { icon?: string } | undefined)?.icon
        ?? `/media/items/${a.id}.${SVG_ICONS.has(a.id) ? 'svg' : 'png'}`,
      stackable: true,
    })
  }
  // Lockduefte folgen den Typen des Packs; ein neuer Typ bringt seinen mit.
  const types = JSON.parse(await readFile(join(OUT, 'types.json'), 'utf8')) as Array<{ id: string; name: { de: string } }>
  for (const extra of [...lureItems(types), ...soulItems(types)]) {
    const before = byId.get(extra.id)
    if (!before) added++
    byId.set(extra.id, { ...before, ...extra })
  }

  /*
   * Ein selbst erzeugtes Vektor-Icon schlaegt das PNG — und zwar dadurch, dass
   * es da ist. So muss niemand eine Liste pflegen: Bild ablegen, `npm run
   * world` laufen lassen, fertig.
   */
  let svgIcons = 0
  for (const item of byId.values()) {
    const svg = join(MEDIA_DIR, 'items', `${item.id}.svg`)
    if (existsSync(svg)) { item.icon = `/media/items/${item.id}.svg`; svgIcons++ }
  }
  if (svgIcons) log(`${svgIcons} Vektor-Icons verknuepft`)

  /*
   * Rezepte gegen den Gegenstandskatalog pruefen.
   *
   * `craftingView` faellt bei einer unbekannten Id auf die Id selbst zurueck —
   * ein Tippfehler im Rezept waere im Spiel als Zeile "star-pice" sichtbar und
   * sonst nirgends. Hier faellt er auf, bevor das Pack geschrieben wird.
   */
  const known = new Set(byId.keys())
  const unknown = RECIPES.flatMap((r) => [r.output.itemId, ...r.inputs.map((i) => i.itemId)])
    .filter((id) => !known.has(id))
  if (unknown.length > 0) {
    throw new Error(`Rezepte nennen unbekannte Gegenstände: ${[...new Set(unknown)].join(', ')}`)
  }
  log(`${RECIPES.length} Rezepte geprüft`)

  // Dieselbe Falle wie bei den Rezepten: eine falsche Id faellt sonst erst
  // auf, wenn ein Spieler seine Tagesgabe abholt und nichts bekommt.
  const missing = LOGIN_REWARDS
    .filter((r) => r.kind === 'item')
    .map((r) => (r as { itemId: string }).itemId)
    .filter((id) => !known.has(id))
  if (missing.length > 0) {
    throw new Error(`Anmeldebelohnungen nennen unbekannte Gegenstände: ${[...new Set(missing)].join(', ')}`)
  }
  log(`${LOGIN_REWARDS.length} Anmeldetage geprüft`)

  const mergedItems = [...byId.values()].sort((x, y) => x.id.localeCompare(y.id))
  if (added) log(`${added} neue Gegenstände`)

  /*
   * Zuege, die nur direkt nach dem Einwechseln gehen.
   *
   * PokéAPI liefert die Regel als Satz in der Beschreibung, nicht als Feld.
   * Ohne die Auswertung setzt ein Mauzi den Mogelhieb jede Runde ein — Vorrang
   * 3 und hundert Prozent Zurueckschrecken, der Gegenueber kommt nie zum Zug.
   */
  const moves = JSON.parse(await readFile(join(OUT, 'moves.json'), 'utf8')) as Array<Record<string, any>>
  let firstTurn = 0
  for (const move of moves) {
    const text = String(move.description?.de ?? '')
    if (/only be used as the first move|first turn a Pokémon is in battle/i.test(text)) {
      move.firstTurnOnly = true
      firstTurn++
    }
  }
  /*
   * Zuege, die ein schlafendes Ziel brauchen.
   *
   * Dieselbe Lage wie oben: die Regel steht bei PokeAPI nur im Fliesstext.
   * Traumfresser kam deshalb als reiner Aussauger mit 100 Staerke herein und
   * war ohne jede Bedingung die beste Spezialattacke im Spiel — gemeldet nach
   * einem Kampf, in dem er traf, obwohl niemand schlief.
   */
  let brauchtSchlaf = 0
  for (const move of moves) {
    const text = String(move.description?.de ?? '')
    if (/only works? on sleeping/i.test(text)) {
      move.requiresTargetStatus = 'sleep'
      brauchtSchlaf++
    }
  }
  if (firstTurn || brauchtSchlaf) {
    await writeFile(join(OUT, 'moves.json'), JSON.stringify(moves, null, 1))
    if (firstTurn) log(`${firstTurn} Zuege nur in der ersten Runde`)
    if (brauchtSchlaf) log(`${brauchtSchlaf} Zuege nur gegen schlafende Ziele`)
  }

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
