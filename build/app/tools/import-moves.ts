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
  | { kind: 'weather'; weather: 'clear' | 'rain' | 'storm' | 'snow' | 'fog' | 'sandstorm' | 'heat' }
  | { kind: 'protect'; against: 'all' | 'priority' } | { kind: 'endure' } | { kind: 'rest' } | { kind: 'haze' }
  | { kind: 'random_stat_up'; stages: number } | { kind: 'destiny_bond' }
  | { kind: 'lingering'; effect: 'leech_seed' | 'aqua_ring' | 'nightmare' | 'curse' | 'yawn' | 'encore' | 'disable'; turns?: number }
  | { kind: 'side_condition'; condition: 'reflect' | 'light_screen' | 'safeguard' | 'mist' | 'tailwind'; turns: number }
  | { kind: 'copy_stages' } | { kind: 'swap_stats' }
  | { kind: 'cure'; scope: 'self' | 'party' }
  | { kind: 'crit_up'; stages: number; sure: boolean }
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
 * Zuege, die das Wetter umstellen.
 *
 * PokeAPI fuehrt das nicht als Feld, sondern nur im Fliesstext — dieselbe
 * Lage wie bei Traumfresser. Ohne die Tabelle fielen die vier durch die
 * Ableitung und standen wirkungslos im Pack; gemessen lagen sie in 79
 * Attackenplaetzen und verschenkten dort jedes Mal einen Zug.
 */
/**
 * Zuege, deren Wirkung PokeAPI nur im Fliesstext fuehrt.
 *
 * Dieselbe Lage wie beim Wetter und bei Traumfresser: die Metadaten kennen
 * keine Felder dafuer. Was hier steht, ist bewusst die *kurze* Liste — nur
 * Zuege, deren Wirkung die Engine wirklich abbildet. Alles andere bleibt
 * lieber ohne Wirkung, als eine halbe vorzutaeuschen.
 */
const SPECIAL_MOVES: Record<string, Effect> = {
  protect: { kind: 'protect', against: 'all' },
  detect: { kind: 'protect', against: 'all' },
  'quick-guard': { kind: 'protect', against: 'priority' },
  acupressure: { kind: 'random_stat_up', stages: 2 },
  'destiny-bond': { kind: 'destiny_bond' },
  'leech-seed': { kind: 'lingering', effect: 'leech_seed' },
  'aqua-ring': { kind: 'lingering', effect: 'aqua_ring' },
  nightmare: { kind: 'lingering', effect: 'nightmare' },
  curse: { kind: 'lingering', effect: 'curse' },
  yawn: { kind: 'lingering', effect: 'yawn', turns: 2 },
  encore: { kind: 'lingering', effect: 'encore', turns: 3 },
  disable: { kind: 'lingering', effect: 'disable', turns: 4 },
  reflect: { kind: 'side_condition', condition: 'reflect', turns: 5 },
  'light-screen': { kind: 'side_condition', condition: 'light_screen', turns: 5 },
  safeguard: { kind: 'side_condition', condition: 'safeguard', turns: 5 },
  mist: { kind: 'side_condition', condition: 'mist', turns: 5 },
  tailwind: { kind: 'side_condition', condition: 'tailwind', turns: 3 },
  endure: { kind: 'endure' },
  rest: { kind: 'rest' },
  refresh: { kind: 'cure', scope: 'self' },
  'heal-bell': { kind: 'cure', scope: 'party' },
  aromatherapy: { kind: 'cure', scope: 'party' },
  'focus-energy': { kind: 'crit_up', stages: 2, sure: false },
  'laser-focus': { kind: 'crit_up', stages: 3, sure: true },
  haze: { kind: 'haze' },
  'psych-up': { kind: 'copy_stages' },
  'power-trick': { kind: 'swap_stats' },

  // Was auf dem Boden liegt: fuenf Runden, beide Seiten.
  'grassy-terrain': { kind: 'terrain', terrain: 'grassy' },
  'electric-terrain': { kind: 'terrain', terrain: 'electric' },
  'misty-terrain': { kind: 'terrain', terrain: 'misty' },

  /*
   * Zwangswechsel.
   *
   * Im Vorbild beenden die ersten beiden einen wilden Kampf. Hier gibt es
   * keinen: gefangen wird in der Safari, gekaempft wird gegen Trainer. Also
   * bleibt die zweite Haelfte ihrer Beschreibung, und die ist die
   * interessantere — der Gegner verliert sein aufgebautes Pokemon.
   */
  whirlwind: { kind: 'force_switch' },
  roar: { kind: 'force_switch' },
  teleport: { kind: 'force_switch' },

  // Magnetflug, Beschwoerung.
  'magnet-rise': { kind: 'lingering', effect: 'magnet_rise', turns: 5 },
  'lucky-chant': { kind: 'side_condition', condition: 'lucky_chant', turns: 5 },

  /*
   * Sichere Treffer.
   *
   * Zwei Runden und nicht eine: der Merker wird am Ende der Runde aelter, in
   * der er gesetzt wurde. Mit einer Runde waere er weg, bevor der Zug kommt,
   * den er treffen lassen soll.
   */
  'lock-on': { kind: 'lingering', effect: 'sure_hit', turns: 2 },
  'mind-reader': { kind: 'lingering', effect: 'sure_hit', turns: 2 },
  telekinesis: { kind: 'lingering', effect: 'vulnerable', turns: 3 },
  // Scharfblick und Verwandte halten bis zum Einwechseln — daher ohne Runden.
  foresight: { kind: 'lingering', effect: 'vulnerable' },
  'odor-sleuth': { kind: 'lingering', effect: 'vulnerable' },
  'miracle-eye': { kind: 'lingering', effect: 'vulnerable' },

  // Platscher tut nichts. Das ist keine Luecke, das ist der Zug.
  splash: { kind: 'nothing' },
}

const WEATHER_MOVES: Record<string, Extract<Effect, { kind: 'weather' }>['weather']> = {
  'rain-dance': 'rain',
  'sunny-day': 'heat',
  sandstorm: 'sandstorm',
  hail: 'snow',
}

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

  const besonders = SPECIAL_MOVES[m.name]
  if (besonders) return { effect: besonders, chance: 100 }

  const wetter = WEATHER_MOVES[m.name]
  if (wetter) return { effect: { kind: 'weather', weather: wetter }, chance: 100 }

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
/**
 * Zuege, die ohne Doppelkaempfe nichts bedeuten koennen.
 *
 * Doppelkaempfe wird es in diesem Spiel nicht geben — das ist entschieden.
 * Wer einen Verbuendeten staerkt, schuetzt oder mit ihm den Platz tauscht,
 * haette hier also fuer immer einen leeren Zug. Sie kommen deshalb gar nicht
 * erst herein, statt wirkungslos im Pack zu stehen.
 *
 * Bewusst kurz: Rapidschutz gehoert *nicht* dazu. Er zielt auf die eigene
 * Seite, und die ist im Einzelkampf man selbst — ein Schild gegen
 * Vorrangattacken bleibt sinnvoll.
 */
const DOUBLES_ONLY = new Set([
  'wide-guard', 'helping-hand', 'ally-switch',
  // Umlenkung und Zugreihenfolge ergeben nur mit einem Partner Sinn.
  'after-you', 'follow-me', 'rage-powder', 'spotlight', 'quash', 'snatch',
])

/**
 * Zuege, die an Mechanik haengen, die es in diesem Spiel nicht gibt.
 *
 * Faehigkeiten, Tragegegenstaende und Geschlecht kommen im Spiel nicht vor:
 * `held_item` ist eine Spalte, die nie beschrieben wird, Faehigkeiten gibt es
 * gar nicht. Wer sie kopiert, tauscht, sperrt oder aufhebt, haette hier fuer
 * immer einen leeren Zug.
 */
const NO_MECHANIC = new Set([
  'worry-seed', 'gastro-acid', 'role-play', 'entrainment', 'simple-beam', 'skill-swap',
  'bestow', 'embargo', 'magic-room', 'recycle',
  'assist', 'attract',
  // Gegenstaende tauschen setzt voraus, dass jemand einen traegt.
  'trick', 'switcheroo',
])

function isUsable(m: ApiMove, knownTypes: Set<string>): boolean {
  if (DOUBLES_ONLY.has(m.name) || NO_MECHANIC.has(m.name)) return false
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
