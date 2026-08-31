import type { PokeApi } from './pokeapi-client.ts'
import { germanName, germanText } from './pokeapi-client.ts'

interface ApiMove {
  id: number
  name: string
  names: Array<{ name: string; language: { name: string } }>
  type: { name: string }
  damage_class: { name: 'physical' | 'special' | 'status' }
  power: number | null
  accuracy: number | null
  pp: number | null
  priority: number
  effect_chance: number | null
  target: { name: string }
  stat_changes: Array<{ change: number; stat: { name: string } }>
  meta: {
    ailment: { name: string }
    ailment_chance: number
    drain: number
    healing: number
    flinch_chance: number
    stat_chance: number
    crit_rate: number
    min_hits: number | null
    max_hits: number | null
  } | null
  effect_entries: Array<{ effect: string; short_effect: string; language: { name: string } }>
}

type Effect =
  | { kind: 'none' }
  | { kind: 'status'; status: 'burn' | 'freeze' | 'paralysis' | 'poison' | 'toxic' | 'sleep' | 'confusion' }
  | { kind: 'stat_stage'; target: 'self' | 'foe'; stat: 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'accuracy' | 'evasion'; stages: number }
  | { kind: 'drain'; ratio: number }
  | { kind: 'recoil'; ratio: number }
  | { kind: 'heal'; ratio: number }
  | { kind: 'multi_hit'; min: number; max: number }
  | { kind: 'flinch' }

const AILMENTS: Record<string, Extract<Effect, { kind: 'status' }>['status']> = {
  burn: 'burn', freeze: 'freeze', paralysis: 'paralysis',
  poison: 'poison', 'bad-poison': 'toxic', sleep: 'sleep', confusion: 'confusion',
}

const STATS: Record<string, Extract<Effect, { kind: 'stat_stage' }>['stat']> = {
  attack: 'atk', defense: 'def', 'special-attack': 'spa', 'special-defense': 'spd',
  speed: 'spe', accuracy: 'accuracy', evasion: 'evasion',
}

const SELF_TARGETS = new Set(['user', 'users-field', 'user-and-allies', 'all-allies', 'ally'])

/**
 * Collapse PokéAPI's rich move metadata into the single effect the engine
 * models.
 *
 * Real moves can do several things at once (damage + lower a stat + flinch).
 * Modelling all of it would mean an effect interpreter; modelling one keeps the
 * battle loop small and readable. The order below is by how much the effect
 * changes the outcome of a turn, so the most consequential one survives.
 */
function deriveEffect(m: ApiMove): { effect: Effect; chance: number } {
  const meta = m.meta

  if (meta?.min_hits && meta.max_hits) {
    return { effect: { kind: 'multi_hit', min: meta.min_hits, max: meta.max_hits }, chance: 100 }
  }
  if (meta && meta.drain > 0) {
    return { effect: { kind: 'drain', ratio: meta.drain / 100 }, chance: 100 }
  }
  if (meta && meta.drain < 0) {
    return { effect: { kind: 'recoil', ratio: Math.abs(meta.drain) / 100 }, chance: 100 }
  }
  if (meta && meta.healing > 0) {
    return { effect: { kind: 'heal', ratio: meta.healing / 100 }, chance: 100 }
  }
  const ailment = meta ? AILMENTS[meta.ailment.name] : undefined
  if (ailment) {
    const chance = meta!.ailment_chance > 0 ? meta!.ailment_chance : (m.effect_chance ?? 100)
    return { effect: { kind: 'status', status: ailment }, chance }
  }
  const change = m.stat_changes[0]
  if (change && STATS[change.stat.name]) {
    const chance = meta && meta.stat_chance > 0 ? meta.stat_chance : (m.effect_chance ?? 100)
    return {
      effect: {
        kind: 'stat_stage',
        target: SELF_TARGETS.has(m.target.name) ? 'self' : 'foe',
        stat: STATS[change.stat.name]!,
        stages: Math.max(-6, Math.min(6, change.change)),
      },
      chance,
    }
  }
  if (meta && meta.flinch_chance > 0) {
    return { effect: { kind: 'flinch' }, chance: meta.flinch_chance }
  }
  return { effect: { kind: 'none' }, chance: 0 }
}

export interface MoveOut {
  id: string
  name: { de: string }
  type: string
  category: 'physical' | 'special' | 'status'
  power: number
  accuracy: number
  pp: number
  priority: number
  critRate: number
  target: 'foe' | 'self' | 'field'
  effectChance: number
  effect: Effect
  description: { de: string }
}

/** Moves the engine cannot represent are dropped rather than imported as
 *  no-ops: a move that visibly does nothing is worse than one that is absent. */
function isUsable(m: ApiMove, knownTypes: Set<string>): boolean {
  if (!knownTypes.has(m.type.name)) return false
  if (m.pp === null || m.pp < 1) return false
  if (m.damage_class.name !== 'status' && (m.power ?? 0) <= 0) return false
  return true
}

export async function importMoves(
  api: PokeApi,
  moveIds: Set<string>,
  knownTypes: Set<string>,
  log: (m: string) => void,
): Promise<MoveOut[]> {
  const out: MoveOut[] = []
  let skipped = 0

  const batch = [...moveIds]
  const results = await Promise.all(batch.map((name) => api.get<ApiMove>(`move/${name}`)))

  for (const m of results) {
    if (!isUsable(m, knownTypes)) { skipped++; continue }
    const { effect, chance } = deriveEffect(m)
    /*
     * Eine Statusattacke ohne darstellbare Wirkung ist ein leerer Zug.
     *
     * Der Filter oben laeuft *vor* dem Ableiten und kann deshalb nicht wissen,
     * was herauskommt. Genau daran ist der Vorsatz gescheitert, den der
     * Kommentar bei `isUsable` formuliert: gemessen standen 117 solcher
     * Attacken im Pack, und zwoelf Prozent aller belegten Attackenplaetze im
     * laufenden Spiel waren damit tote Zuege. Wer eine davon einsetzt,
     * verliert die Runde, ohne dass irgendwo steht, warum.
     */
    if (m.damage_class.name === 'status' && effect.kind === 'none') { skipped++; continue }
    out.push({
      id: m.name,
      name: { de: germanName(m.names, m.name) },
      type: m.type.name,
      category: m.damage_class.name,
      power: m.power ?? 0,
      // A null accuracy means "never misses" in the games.
      accuracy: m.accuracy ?? 100,
      pp: m.pp!,
      priority: Math.max(-7, Math.min(5, m.priority)),
      critRate: Math.max(0, Math.min(3, m.meta?.crit_rate ?? 0)),
      target: SELF_TARGETS.has(m.target.name) ? 'self' : m.target.name.includes('field') ? 'field' : 'foe',
      effectChance: Math.max(0, Math.min(100, Math.round(chance))),
      effect,
      description: { de: germanText(m.effect_entries) },
    })
  }

  out.sort((a, b) => a.id.localeCompare(b.id))
  log(`Attacken: ${out.length} übernommen, ${skipped} übersprungen (nicht abbildbar)`)
  return out
}
