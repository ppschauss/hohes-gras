/**
 * Balancing-Simulation.
 *
 *   node --experimental-strip-types tools/simulate.ts [--days 1000] [--trainers 50]
 *
 * Spielt viele Spieltage vieler Trainer gegen die *echte* Engine durch — ohne
 * Datenbank, ohne HTTP. Der Punkt ist nicht "läuft es durch", sondern: bleiben
 * die Kurven gesund? Wächst das Gold ins Absurde? Erreicht ein normal
 * spielender Mensch das Indigo-Plateau, und wie lange braucht er dafür?
 *
 * Ein Balancing-Problem, das man erst nach drei Monaten Spielzeit sieht, ist
 * hier in ein paar Sekunden sichtbar.
 */
import { loadPack } from '../packages/content/dist/loader.js'
import { Registry } from '../packages/content/dist/registry.js'
import {
  applyCare, attemptCatch, battleXpYield, catchReward, computeStats, createRng,
  DURATIONS, energyCost, grantXpTo, KINDS, levelForXp, partyRating, randomIvs,
  resolveExpedition, rollEncounter, xpForLevel,
  ENERGY_BASE_CAP, ENERGY_COSTS, ENERGY_PACKS, ENERGY_PER_HOUR, ENERGY_REWARDS,
  EXPEDITION_ENERGY, type CareCreature,
} from '../packages/engine/dist/index.js'
import { NATURES } from '../packages/shared/dist/index.js'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const arg = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag)
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback
}

const DAYS = Number(arg('--days', '1000'))
const TRAINERS = Number(arg('--trainers', '50'))
/** Wie in den beiden Importern: aus dem Ort dieser Datei statt fest verdrahtet. */
const PROJEKT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const DATA_DIR = resolve(arg('--data', join(PROJEKT, 'data')))
const PACK = arg('--pack', 'kanto')

/**
 * How thoroughly a simulated player engages.
 *
 * Die Zahlen sind seit dem Wegfall der Tageslimits *Absichten*, keine
 * Obergrenzen mehr: was ein Trainer davon umsetzt, entscheidet sein
 * Energiekonto. `buysEnergy` sagt, ob er dafuer Gold ausgibt — die Frage, an
 * der sich entscheidet, ob der Preis stimmt.
 */
type Style = 'casual' | 'regular' | 'grinder'
const STYLES: Array<{
  style: Style; careActions: number; explores: number; expeditions: number
  buysEnergy: boolean; share: number
}> = [
  { style: 'casual',  careActions: 4,  explores: 5,   expeditions: 1, buysEnergy: false, share: 0.5 },
  { style: 'regular', careActions: 12, explores: 25,  expeditions: 2, buysEnergy: true,  share: 0.35 },
  { style: 'grinder', careActions: 20, explores: 120, expeditions: 4, buysEnergy: true,  share: 0.15 },
]

interface SimCreature { id: string; speciesId: string; level: number; xp: number; friendship: number; energy: number }

interface SimTrainer {
  id: string
  style: Style
  gold: number
  team: SimCreature[]
  box: SimCreature[]
  dex: Set<string>
  balls: number
  berries: number
  areaIndex: number
  badges: number
  daysPlayed: number
  reachedLeagueOnDay: number | null
  /** Trainer-Energie: das eigentliche Tagesbudget. */
  energy: number
  /** Wofuer die Energie ueber die ganze Laufzeit draufging. */
  spent: Record<string, number>
  energyBought: number
  goldOnEnergy: number
  completedAreas: Set<string>
  /** Aktionen, die am leeren Konto gescheitert sind. */
  blocked: number
}

async function main(): Promise<void> {
  const registry = new Registry(await loadPack(join(DATA_DIR, 'packs', PACK)))
  const areas = registry.allAreas
  const starters = registry.manifest.starterSpeciesIds

  console.log(`Simulation: ${TRAINERS} Trainer × ${DAYS} Tage · Pack "${registry.manifest.id}" (${registry.speciesCount} Arten, ${areas.length} Gebiete)\n`)

  const trainers: SimTrainer[] = []
  for (let i = 0; i < TRAINERS; i++) {
    const rng = createRng(`sim-init-${i}`)
    const style = pickStyle(rng.next())
    const speciesId = rng.pick(starters)
    trainers.push({
      id: `t${i}`, style, gold: 500,
      team: [makeCreature(registry, speciesId, 5, rng)],
      box: [], dex: new Set([speciesId]),
      balls: 10, berries: 8, areaIndex: 0, badges: 0,
      daysPlayed: 0, reachedLeagueOnDay: null,
      energy: ENERGY_BASE_CAP,
      spent: {}, energyBought: 0, goldOnEnergy: 0, blocked: 0,
      completedAreas: new Set<string>(),
    })
  }

  const snapshots: Array<{ day: number; goldMedian: number; levelMedian: number; dexMedian: number; areaMedian: number }> = []
  let crashes = 0

  for (let day = 1; day <= DAYS; day++) {
    for (const trainer of trainers) {
      try {
        simulateDay(registry, trainer, day)
      } catch (err) {
        crashes++
        if (crashes <= 3) console.error(`  Absturz an Tag ${day} (${trainer.id}): ${(err as Error).message}`)
      }
    }
    if (day === 1 || day % Math.max(1, Math.floor(DAYS / 10)) === 0 || day === DAYS) {
      snapshots.push({
        day,
        goldMedian: median(trainers.map((t) => t.gold)),
        levelMedian: median(trainers.map((t) => Math.max(...t.team.map((c) => c.level), 0))),
        dexMedian: median(trainers.map((t) => t.dex.size)),
        areaMedian: median(trainers.map((t) => t.areaIndex + 1)),
      })
    }
  }

  report(registry, trainers, snapshots, crashes, areas.length)
}

function pickStyle(roll: number): Style {
  let acc = 0
  for (const s of STYLES) {
    acc += s.share
    if (roll <= acc) return s.style
  }
  return 'regular'
}

const styleOf = (style: Style) => STYLES.find((s) => s.style === style)!

function makeCreature(registry: Registry, speciesId: string, level: number, rng: ReturnType<typeof createRng>): SimCreature {
  const species = registry.species(speciesId)
  return {
    id: `${speciesId}-${rng.int(1, 1e9)}`,
    speciesId, level,
    xp: xpForLevel(species.growthRate, level),
    friendship: 70, energy: 100,
  }
}

/** Energie abbuchen, wenn sie reicht. Sonst zaehlt die Aktion als blockiert —
 *  das ist die Zahl, an der man sieht, ob das Budget zu knapp bemessen ist. */
function spend(trainer: SimTrainer, amount: number, reason: string): boolean {
  if (trainer.energy < amount) { trainer.blocked++; return false }
  trainer.energy -= amount
  trainer.spent[reason] = (trainer.spent[reason] ?? 0) + amount
  return true
}

function gain(trainer: SimTrainer, amount: number): void {
  trainer.energy = Math.min(9999, trainer.energy + amount)
}

/** Nachkaufen, wenn das Konto leer ist und Gold uebrig. Bewusst zurueckhaltend:
 *  ein Viertel des Vermoegens, nicht alles. */
function maybeBuyEnergy(trainer: SimTrainer): void {
  if (!styleOf(trainer.style).buysEnergy) return
  for (const pack of [...ENERGY_PACKS].reverse()) {
    while (trainer.energy < 20 && trainer.gold > pack.gold * 4) {
      trainer.gold -= pack.gold
      trainer.goldOnEnergy += pack.gold
      trainer.energyBought += pack.energy
      gain(trainer, pack.energy)
    }
  }
}

function simulateDay(registry: Registry, trainer: SimTrainer, day: number): void {
  const rng = createRng(`sim-${trainer.id}-${day}`)
  const style = styleOf(trainer.style)
  trainer.daysPlayed++

  // Ein Spieltag entspricht 24 Stunden Regeneration bis zur Obergrenze.
  trainer.energy = Math.max(trainer.energy, Math.min(ENERGY_BASE_CAP, trainer.energy + ENERGY_PER_HOUR * 24))
  maybeBuyEnergy(trainer)

  // --- Pflege ------------------------------------------------------------
  for (let i = 0; i < style.careActions && trainer.team.length > 0; i++) {
    const action = i % 3 === 0 && trainer.berries > 0 ? 'feed' : i % 3 === 1 ? 'play' : 'rest'
    const careTeam: CareCreature[] = trainer.team.map((c) => ({
      id: c.id, speciesId: c.speciesId, xp: c.xp, friendship: c.friendship, energy: c.energy, level: c.level,
    }))
    if (!spend(trainer, ENERGY_COSTS.care, 'care')) break
    const result = applyCare(action, careTeam, (id) => registry.species(id), trainer.berries)
    if (!result.ok) { gain(trainer, ENERGY_COSTS.care); continue }
    if (result.consumed) trainer.berries -= result.consumed.quantity
    for (const r of result.results) {
      const c = trainer.team.find((x) => x.id === r.creatureId)!
      c.xp = r.xp.totalXp
      c.level = r.xp.levelAfter
      c.friendship = r.friendshipAfter
      c.energy = r.energyAfter
    }
  }

  // --- Safari ------------------------------------------------------------
  const areas = registry.allAreas
  const area = areas[Math.min(trainer.areaIndex, areas.length - 1)]!
  const ball = registry.tryItem('poke-ball')!

  for (let i = 0; i < style.explores; i++) {
    if (trainer.balls <= 0) break
    if (!spend(trainer, ENERGY_COSTS.explore, 'explore')) break
    const encounter = rollEncounter(area, { timeOfDay: 'day', weather: 'clear' }, rng)
    if (!encounter) continue
    const species = registry.species(encounter.speciesId)

    trainer.balls--
    const attempt = attemptCatch(species, encounter.level, {
      ball, berry: null, turn: 0, timeOfDay: 'day',
      weakenStacks: 0, calmStacks: 0, badgeCount: trainer.badges,
    }, rng)

    if (attempt.caught) {
      const reward = catchReward(species, encounter.level, encounter.shiny)
      trainer.gold += reward.gold
      trainer.dex.add(species.id)
      const caught = makeCreature(registry, species.id, encounter.level, rng)
      if (trainer.team.length < 5) trainer.team.push(caught)
      else trainer.box.push(caught)
    }
  }

  // --- Expeditionen -------------------------------------------------------
  for (let i = 0; i < style.expeditions; i++) {
    const kind = rng.pick(KINDS)
    const duration = DURATIONS[Math.min(i, DURATIONS.length - 1)]!
    const party = trainer.team.slice(0, 3).map((c) => ({
      creatureId: c.id, speciesId: c.speciesId, level: c.level, energy: c.energy,
    }))
    if (party.length === 0) break
    if (!spend(trainer, EXPEDITION_ENERGY[duration.id] ?? ENERGY_COSTS.expedition, 'expedition')) break
    const cost = energyCost(duration)
    if (party.some((p) => p.energy < cost)) continue
    for (const p of party) {
      const c = trainer.team.find((x) => x.id === p.creatureId)!
      c.energy = Math.max(0, c.energy - cost)
    }
    const rating = partyRating(party, kind, (id) => registry.species(id))
    const outcome = resolveExpedition(kind, duration, rating, party, rng)
    trainer.gold += outcome.gold
    for (const loot of outcome.loot) {
      if (loot.itemId.includes('ball')) trainer.balls += loot.quantity
      if (loot.itemId.includes('berry')) trainer.berries += loot.quantity
    }
    for (const p of party) {
      const c = trainer.team.find((x) => x.id === p.creatureId)!
      const gained = grantXpTo(registry.species(c.speciesId).growthRate, c.xp, c.level, outcome.xpPerMember)
      c.xp = gained.totalXp
      c.level = gained.levelAfter
    }
  }

  // --- Einkaufen ----------------------------------------------------------
  const ballPrice = registry.tryItem('poke-ball')?.price ?? 30
  const berryPrice = registry.tryItem('oran-berry')?.price ?? 50
  while (trainer.balls < 20 && trainer.gold > ballPrice * 4) { trainer.gold -= ballPrice; trainer.balls++ }
  while (trainer.berries < 12 && trainer.gold > berryPrice * 4) { trainer.gold -= berryPrice; trainer.berries++ }

  // --- Arena und Fortschritt ---------------------------------------------
  tryAdvance(registry, trainer, rng, day)

  // Energie erholt sich ueber Nacht.
  for (const c of trainer.team) c.energy = Math.min(100, c.energy + 100)
}

/**
 * Kann der Trainer ins nächste Gebiet?
 *
 * Prüft dieselben Bedingungen wie die Weltkarte. Wenn eine Kurve zu steil ist,
 * bleibt hier die Hälfte der Simulation stecken — und genau das will man wissen.
 */
function tryAdvance(registry: Registry, trainer: SimTrainer, rng: ReturnType<typeof createRng>, day: number): void {
  const areas = registry.allAreas
  const current = areas[Math.min(trainer.areaIndex, areas.length - 1)]!

  // Arena versuchen, wenn das Team stark genug wirkt.
  if (current.gymId) {
    const gym = registry.allTrainers.find((t) => t.id === current.gymId)
    if (gym) {
      const gymLevel = Math.max(...gym.team.map((m) => m.level))
      const best = Math.max(...trainer.team.map((c) => c.level), 0)
      if (best >= gymLevel + 2 && trainer.badges < registry.allBadges.length) {
        trainer.badges++
        trainer.gold += gym.rewardGold
        gain(trainer, ENERGY_REWARDS.badge + ENERGY_REWARDS.battleWon)
        for (const c of trainer.team) {
          const yieldXp = battleXpYield(80, gymLevel, c.level)
          const gained = grantXpTo(registry.species(c.speciesId).growthRate, c.xp, c.level, yieldXp)
          c.xp = gained.totalXp
          c.level = gained.levelAfter
        }
      }
    }
  }

  const next = areas[trainer.areaIndex + 1]
  if (!next) {
    if (trainer.reachedLeagueOnDay === null) trainer.reachedLeagueOnDay = day
    return
  }

  const caughtHere = [...trainer.dex].filter((id) =>
    current.spawns.some((s) => s.speciesId === id)).length

  // Gebiet vollstaendig: die groesste einzelne Energiequelle im Spiel.
  const speciesHere = new Set(current.spawns.map((s) => s.speciesId))
  if (!trainer.completedAreas.has(current.id) && [...speciesHere].every((id) => trainer.dex.has(id))) {
    trainer.completedAreas.add(current.id)
    gain(trainer, ENERGY_REWARDS.areaCompleted)
  }
  const atLevel = trainer.team.concat(trainer.box)
    .filter((c) => c.level >= (next.unlock.minCreaturesAtLevel?.level ?? 0)).length

  const okCaught = caughtHere >= next.unlock.minCaughtInPrevious
  const okLevel = !next.unlock.minCreaturesAtLevel || atLevel >= next.unlock.minCreaturesAtLevel.count
  const okBadges = trainer.badges >= next.unlock.requiredBadgeIds.length

  if (okCaught && okLevel && okBadges) trainer.areaIndex++
  void rng
}

/* ------------------------------------------------------------------ Bericht */

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

function report(
  registry: Registry,
  trainers: SimTrainer[],
  snapshots: Array<{ day: number; goldMedian: number; levelMedian: number; dexMedian: number; areaMedian: number }>,
  crashes: number,
  areaCount: number,
): void {
  console.log('Tag      Gold(med)   Level(med)  Dex(med)  Gebiet(med)')
  for (const s of snapshots) {
    console.log(
      `${String(s.day).padStart(5)}  ${String(s.goldMedian).padStart(10)}  ` +
      `${String(s.levelMedian).padStart(10)}  ${String(s.dexMedian).padStart(8)}  ` +
      `${String(s.areaMedian).padStart(11)}`,
    )
  }

  console.log('\nNach Spielstil:')
  for (const style of STYLES) {
    const group = trainers.filter((t) => t.style === style.style)
    if (group.length === 0) continue
    const finished = group.filter((t) => t.reachedLeagueOnDay !== null)
    console.log(
      `  ${style.style.padEnd(8)} n=${String(group.length).padStart(3)}  ` +
      `Gold ${String(median(group.map((g) => g.gold))).padStart(8)}  ` +
      `Level ${String(median(group.map((g) => Math.max(...g.team.map((c) => c.level), 0)))).padStart(3)}  ` +
      `Dex ${String(median(group.map((g) => g.dex.size))).padStart(3)}  ` +
      `Gebiet ${String(median(group.map((g) => g.areaIndex + 1))).padStart(2)}/${areaCount}  ` +
      `durch: ${finished.length}/${group.length}` +
      (finished.length ? ` (Median Tag ${median(finished.map((f) => f.reachedLeagueOnDay!))})` : ''),
    )
  }

  console.log('\nEnergie:')
  for (const style of STYLES) {
    const group = trainers.filter((t) => t.style === style.style)
    if (group.length === 0) continue
    const spentTotal = median(group.map((g) => Object.values(g.spent).reduce((a, b) => a + b, 0)))
    console.log(
      `  ${style.style.padEnd(8)} verbraucht ${String(spentTotal).padStart(7)}  ` +
      `gekauft ${String(median(group.map((g) => g.energyBought))).padStart(6)}  ` +
      `dafür Gold ${String(median(group.map((g) => g.goldOnEnergy))).padStart(8)}  ` +
      `blockiert ${String(median(group.map((g) => g.blocked))).padStart(6)}`,
    )
  }

  const problems: string[] = []
  if (crashes > 0) problems.push(`${crashes} Abstürze in der Simulation`)

  // Energie soll bremsen, nicht sperren. Wenn ein normal spielender Trainer an
  // mehr Aktionen scheitert als er ausführt, ist das Budget zu knapp.
  for (const style of ['casual', 'regular'] as const) {
    const group = trainers.filter((t) => t.style === style)
    if (group.length === 0) continue
    const blocked = median(group.map((g) => g.blocked))
    const done = median(group.map((g) => Object.values(g.spent).reduce((a, b) => a + b, 0)))
    if (blocked > done) problems.push(`${style}: mehr blockierte als ausgeführte Aktionen (${blocked} vs. ${done} Energie)`)
  }

  const goldOnEnergy = median(trainers.map((t) => t.goldOnEnergy))
  const goldLeft = median(trainers.map((t) => t.gold))
  if (goldOnEnergy > 0 && goldLeft > 0 && goldOnEnergy > goldLeft * 20) {
    problems.push('Energie frisst praktisch das gesamte Gold — Preis zu hoch')
  }

  const goldMedian = median(trainers.map((t) => t.gold))
  if (goldMedian > 5_000_000) {
    problems.push(`Gold läuft aus dem Ruder (Median ${goldMedian.toLocaleString('de-DE')})`)
  }

  const stuck = trainers.filter((t) => t.areaIndex === 0)
  if (stuck.length > trainers.length * 0.1) {
    problems.push(`${stuck.length} Trainer kommen nie aus dem Startgebiet`)
  }

  const maxLevel = Math.max(...trainers.flatMap((t) => t.team.map((c) => c.level)))
  if (maxLevel >= 100) {
    const at100 = trainers.filter((t) => t.team.some((c) => c.level >= 100)).length
    if (at100 > trainers.length * 0.8) problems.push(`${at100} Trainer stehen auf Level 100 — Endgame zu schnell erreicht`)
  }

  const dexMedian = median(trainers.map((t) => t.dex.size))
  if (dexMedian >= registry.speciesCount) problems.push('Pokédex vollständig — keine Sammelziele mehr')

  console.log('')
  if (problems.length === 0) {
    console.log('✓ Keine Auffälligkeiten: keine Abstürze, Wirtschaft und Fortschritt bleiben im Rahmen.')
  } else {
    console.log('⚠ Auffälligkeiten:')
    for (const p of problems) console.log(`  · ${p}`)
  }
  process.exit(problems.length && crashes > 0 ? 1 : 0)
}

main().catch((err: Error) => {
  console.error('Simulation fehlgeschlagen:', err.message)
  process.exit(1)
})
