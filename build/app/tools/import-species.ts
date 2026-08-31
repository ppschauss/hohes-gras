import type { PokeApi } from './pokeapi-client.ts'
import { germanName, germanText, idFromUrl } from './pokeapi-client.ts'

interface ApiSpecies {
  id: number
  name: string
  names: Array<{ name: string; language: { name: string } }>
  growth_rate: { name: string }
  capture_rate: number
  hatch_counter: number
  egg_groups: Array<{ name: string }>
  evolution_chain: { url: string }
  flavor_text_entries: Array<{ flavor_text: string; language: { name: string } }>
  is_legendary: boolean
  is_mythical: boolean
}

interface ApiPokemon {
  id: number
  name: string
  base_experience: number | null
  types: Array<{ slot: number; type: { name: string } }>
  stats: Array<{ base_stat: number; stat: { name: string } }>
  moves: Array<{
    move: { name: string }
    version_group_details: Array<{
      level_learned_at: number
      move_learn_method: { name: string }
      version_group: { name: string }
    }>
  }>
}

interface ApiEvolutionChain {
  chain: EvoNode
}
interface EvoNode {
  species: { name: string; url: string }
  evolves_to: EvoNode[]
  evolution_details: Array<{
    trigger: { name: string }
    min_level: number | null
    item: { name: string } | null
    held_item: { name: string } | null
    min_happiness: number | null
    time_of_day: string
    known_move: { name: string } | null
    location: { name: string } | null
    gender: number | null
  }>
}

/**
 * Arten, die PokeAPI mit einem gewoehnlichen Fangwert fuehrt, hier aber
 * legendaer sein sollen.
 *
 * Die Reihe gibt Mew, Celebi und Rayquaza einen Fangwert von 45 — sie sind
 * dort Ereignis-Pokemon, die man ueberhaupt nur einmal trifft. Bei uns stehen
 * sie in Spawn-Tabellen, und die Legendaeren-Regeln haengen allein am Fangwert
 * (`isLegendaryCatchRate`, Schwelle 3). Mit 45 galten die drei als
 * gewoehnlich: ohne Sagenbeere fangbar, und Rayquaza durfte in der Kampfzone
 * als Gegner auftreten. Beides war nicht gemeint.
 */
const LEGENDAER_TROTZ_POKEAPI = new Set(['mew', 'celebi', 'rayquaza'])

const GROWTH: Record<string, string> = {
  fast: 'fast', 'medium-fast': 'medium_fast', 'medium-slow': 'medium_slow',
  slow: 'slow', erratic: 'erratic', fluctuating: 'fluctuating',
}

const STAT_KEYS: Record<string, 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe'> = {
  hp: 'hp', attack: 'atk', defense: 'def',
  'special-attack': 'spa', 'special-defense': 'spd', speed: 'spe',
}

/**
 * Aus welchen Spielen die Lernsaetze stammen.
 *
 * Frueher gewann die erste Version, in der eine Art ueberhaupt vier Attacken
 * per Levelaufstieg lernte — und alles andere fiel weg. Gemessen kostete das
 * ueber ein Drittel: 14,2 Attacken je Art statt 19,5, und Arten wie Woingenau
 * standen mit zweien da. Gemeldet als "die Pokemon lernen nicht alle Attacken,
 * die sie eigentlich lernen koennten", und das stimmte.
 *
 * Jetzt zaehlen *alle* Versionen zusammen, je Attacke das niedrigste Level.
 * Eine Auswahl von fuenf waere zu wenig gewesen — die ueberschneiden sich fast
 * vollstaendig und brachten gemessen nur 0,3 Attacken je Art. Ueber alle
 * Generationen sind es fuenf.
 *
 * Das bleibt kanonisch und bleibt gestaffelt: jede Attacke traegt weiterhin
 * das Level, ab dem irgendein Spiel sie vergibt. Nur Maschinen- und
 * Lehrer-Attacken bleiben draussen — sie tragen kein Level und wuerden die
 * Staffelung ersetzen statt sie zu fuellen.
 */

export interface SpeciesOut {
  id: string
  dexNumber: number
  name: { de: string }
  description: { de: string }
  types: string[]
  baseStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number }
  growthRate: string
  catchRate: number
  baseXpYield: number
  hatchCycles: number
  eggGroups: string[]
  learnset: Array<{ moveId: string; level: number }>
  evolutions: unknown[]
  rarity: 'common' | 'uncommon' | 'rare' | 'legendary'
  sprite: string
  spriteShiny: string
}

function pickLearnset(p: ApiPokemon): Array<{ moveId: string; level: number }> {
  const lowest = new Map<string, number>()
  for (const m of p.moves) {
    for (const d of m.version_group_details) {
      if (d.move_learn_method.name !== 'level-up') continue
      const level = Math.max(1, d.level_learned_at)
      const before = lowest.get(m.move.name)
      if (before === undefined || level < before) lowest.set(m.move.name, level)
    }
  }
  if (lowest.size >= 4) {
    return [...lowest]
      .map(([moveId, level]) => ({ moveId, level }))
      .sort((a, b) => a.level - b.level || a.moveId.localeCompare(b.moveId))
  }
  // Last resort: whatever the species can learn at all, treated as level 1.
  return p.moves.slice(0, 4).map((m) => ({ moveId: m.move.name, level: 1 }))
}

/** Walk the evolution tree and record the transitions the engine supports. */
function collectEvolutions(node: EvoNode, out: Map<string, unknown[]>): void {
  for (const child of node.evolves_to) {
    const detail = child.evolution_details[0]
    if (detail) {
      const list = out.get(node.species.name) ?? []
      const to = child.species.name
      switch (detail.trigger.name) {
        case 'level-up':
          if (detail.min_happiness) {
            list.push({
              trigger: 'friendship', to, minFriendship: detail.min_happiness,
              ...(detail.time_of_day ? { timeOfDay: detail.time_of_day === 'day' ? 'day' : 'night' } : {}),
            })
          } else if (detail.min_level) {
            list.push({ trigger: 'level', to, level: detail.min_level })
          } else {
            // Location or move based; approximate with a level so the line is
            // still completable instead of silently dead-ending.
            list.push({ trigger: 'level', to, level: 30 })
          }
          break
        case 'use-item':
          if (detail.item) list.push({ trigger: 'stone', to, itemId: detail.item.name })
          break
        case 'trade':
          list.push({ trigger: 'trade', to, ...(detail.held_item ? { heldItemId: detail.held_item.name } : {}) })
          break
        default:
          list.push({ trigger: 'level', to, level: detail.min_level ?? 35 })
      }
      if (list.length) out.set(node.species.name, list)
    }
    collectEvolutions(child, out)
  }
}

/**
 * How special a catch feels.
 *
 * Catch rate alone is a bad proxy: every starter sits at 45, which would make
 * the three creatures a player is handed the rarest things in the game. Power
 * carries more signal, so the stat total leads and the catch rate only breaks
 * ties at the extremes.
 */
function rarityOf(species: ApiSpecies, statTotal: number): SpeciesOut['rarity'] {
  if (species.is_legendary || species.is_mythical) return 'legendary'
  if (statTotal >= 500 || species.capture_rate <= 30) return 'rare'
  if (statTotal >= 400 || species.capture_rate <= 90) return 'uncommon'
  return 'common'
}

export async function importSpecies(
  api: PokeApi,
  dexNumbers: number[],
  knownTypes: Set<string>,
  log: (m: string) => void,
): Promise<{ species: SpeciesOut[]; moveIds: Set<string>; stoneItemIds: Set<string> }> {
  const species: SpeciesOut[] = []
  const moveIds = new Set<string>()
  const stoneItemIds = new Set<string>()
  const evoCache = new Map<string, Map<string, unknown[]>>()

  const pairs = await Promise.all(
    dexNumbers.map(async (n) => ({
      s: await api.get<ApiSpecies>(`pokemon-species/${n}`),
      p: await api.get<ApiPokemon>(`pokemon/${n}`),
    })),
  )

  const inPack = new Set(pairs.map(({ s }) => s.name))

  for (const { s, p } of pairs) {
    const chainId = idFromUrl(s.evolution_chain.url)
    if (!evoCache.has(String(chainId))) {
      const chain = await api.get<ApiEvolutionChain>(`evolution-chain/${chainId}`)
      const map = new Map<string, unknown[]>()
      collectEvolutions(chain.chain, map)
      evoCache.set(String(chainId), map)
    }
    // Only keep evolutions whose target is part of this pack, otherwise the
    // cross-validation in the loader would fail on a dangling reference.
    const evolutions = (evoCache.get(String(chainId))!.get(s.name) ?? []).filter(
      (e) => inPack.has((e as { to: string }).to),
    )
    for (const e of evolutions) {
      const item = (e as { itemId?: string }).itemId
      if (item) stoneItemIds.add(item)
    }

    const baseStats = { hp: 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }
    for (const st of p.stats) {
      const key = STAT_KEYS[st.stat.name]
      if (key) baseStats[key] = st.base_stat
    }
    const statTotal = Object.values(baseStats).reduce((a, b) => a + b, 0)

    const learnset = pickLearnset(p).filter((l) => l.moveId)
    for (const l of learnset) moveIds.add(l.moveId)

    species.push({
      id: s.name,
      dexNumber: s.id,
      name: { de: germanName(s.names, s.name) },
      description: { de: germanText(s.flavor_text_entries) },
      types: p.types.sort((a, b) => a.slot - b.slot).map((t) => t.type.name).filter((t) => knownTypes.has(t)),
      baseStats,
      growthRate: GROWTH[s.growth_rate.name] ?? 'medium_fast',
      catchRate: LEGENDAER_TROTZ_POKEAPI.has(s.name) ? 3 : Math.max(1, Math.min(255, s.capture_rate)),
      baseXpYield: p.base_experience ?? 60,
      hatchCycles: Math.max(1, s.hatch_counter),
      eggGroups: s.egg_groups.map((g) => g.name),
      learnset,
      evolutions,
      rarity: rarityOf(s, statTotal),
      sprite: `/media/sprites/${s.name}.png`,
      spriteShiny: `/media/sprites/${s.name}-shiny.png`,
    })
  }

  species.sort((a, b) => a.dexNumber - b.dexNumber)
  log(`Arten: ${species.length}, referenzierte Attacken: ${moveIds.size}, Entwicklungssteine: ${stoneItemIds.size}`)
  return { species, moveIds, stoneItemIds }
}
