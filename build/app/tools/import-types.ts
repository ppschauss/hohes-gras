import type { PokeApi } from './pokeapi-client.ts'
import { germanName } from './pokeapi-client.ts'

/** The 18 elemental types plus the chart. `shadow`, `unknown` and `stellar`
 *  exist in the API but are placeholders: nothing in a normal pack has them,
 *  and including them adds columns nobody can ever hit. */
const SKIP = new Set(['shadow', 'unknown', 'stellar'])

const TYPE_COLORS: Record<string, string> = {
  normal: '#9fa19f', fighting: '#ff8000', flying: '#81b9ef', poison: '#9141cb',
  ground: '#915121', rock: '#afa981', bug: '#91a119', ghost: '#704170',
  steel: '#60a1b8', fire: '#e62829', water: '#2980ef', grass: '#3fa129',
  electric: '#fac000', psychic: '#ef4179', ice: '#3dcef3', dragon: '#5060e1',
  dark: '#624d4e', fairy: '#ef70ef',
}

interface ApiType {
  name: string
  names: Array<{ name: string; language: { name: string } }>
  damage_relations: {
    double_damage_to: Array<{ name: string }>
    half_damage_to: Array<{ name: string }>
    no_damage_to: Array<{ name: string }>
  }
}

export interface TypeImport {
  types: Array<{ id: string; name: { de: string }; color: string }>
  chart: Record<string, Record<string, number>>
}

export async function importTypes(api: PokeApi, log: (m: string) => void): Promise<TypeImport> {
  const index = await api.get<{ results: Array<{ name: string; url: string }> }>('type?limit=100')
  const usable = index.results.filter((t) => !SKIP.has(t.name))

  const types: TypeImport['types'] = []
  const chart: TypeImport['chart'] = {}

  for (const entry of usable) {
    const t = await api.get<ApiType>(entry.url)
    types.push({
      id: t.name,
      name: { de: germanName(t.names, t.name) },
      color: TYPE_COLORS[t.name] ?? '#888888',
    })

    // Only non-neutral pairs are stored; the registry treats a missing entry
    // as 1, which keeps the file readable and the pack small.
    const row: Record<string, number> = {}
    for (const d of t.damage_relations.double_damage_to) if (!SKIP.has(d.name)) row[d.name] = 2
    for (const d of t.damage_relations.half_damage_to) if (!SKIP.has(d.name)) row[d.name] = 0.5
    for (const d of t.damage_relations.no_damage_to) if (!SKIP.has(d.name)) row[d.name] = 0
    chart[t.name] = row
  }

  log(`Typen: ${types.length}, Chart-Zeilen mit Abweichungen: ${Object.values(chart).filter((r) => Object.keys(r).length).length}`)
  return { types, chart }
}
