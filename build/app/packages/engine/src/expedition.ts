import type { SpeciesDef } from '@game/content'
import type { Rng } from './rng.js'
import { clamp } from './stats.js'

/**
 * Expeditions: send creatures away, get loot back later.
 *
 * The idle half of the game. Nothing here needs the player present, which is
 * exactly the point — it gives someone who opens the app twice a day a reason
 * to have opened it the first time.
 */

export interface ExpeditionDuration {
  id: string
  minutes: number
  /** Multiplies gold and XP. Longer trips pay better per minute, which
   *  rewards planning over compulsive checking. */
  yieldFactor: number
  /**
   * Wie oft aus der Beutetabelle gezogen wird, bei perfektem Team.
   *
   * Ausdrücklich hingeschrieben statt aus `yieldFactor` gerechnet. Vorher war
   * es abgeleitet (`1 + yieldFactor / 6`), und bei der kurzen Reise kamen für
   * ein mieses und ein perfektes Team dieselben 1,17 bzw. 1,0 heraus — beide
   * runden auf 1. Wen man mitschickte, war also völlig gleich, und das war der
   * Mechanik nicht anzusehen. Zwei Züge sind das Minimum, damit die Hälfte
   * noch ein Unterschied ist.
   */
  baseDraws: number
}

export const DURATIONS: ExpeditionDuration[] = [
  { id: 'short', minutes: 30, yieldFactor: 1, baseDraws: 2 },
  { id: 'medium', minutes: 120, yieldFactor: 4.6, baseDraws: 5 },
  { id: 'long', minutes: 480, yieldFactor: 20, baseDraws: 10 },
]

export interface ExpeditionKind {
  id: string
  /**
   * Wer hier mitdarf.
   *
   * Früher war das ein Bonus, kein Tor: jeder durfte überall hin, passende
   * Typen bekamen 1,4×. Jetzt ist es eine Bedingung — eine Expedition ist eine
   * Aufgabe, und ein Karpador gräbt nicht.
   *
   * Deshalb müssen die vier Listen zusammen **alle achtzehn Typen** abdecken.
   * Vorher taten sie das nicht: Feuer, Gift, Geist, Drache, Unlicht und Fee
   * kamen in keiner vor, und eine Sperre hätte 58 der 390 Arten ausgesperrt —
   * darunter jeden Feuer-Starter. Gezählt, nicht geschätzt. Wer die Listen
   * ändert, prüft das mit `expedition.test.ts`, das genau darauf besteht.
   */
  favouredTypes: string[]
  lootTable: Array<{ itemId: string; weight: number; min: number; max: number }>
  goldPerFactor: number
}

export const KINDS: ExpeditionKind[] = [
  {
    // Sammeln im Unterholz: dort ist auch zu Hause, was giftig ist oder sich
    // im Feenkreis herumtreibt.
    id: 'forage', favouredTypes: ['grass', 'bug', 'ground', 'poison', 'fairy'],
    goldPerFactor: 26,
    lootTable: [
      { itemId: 'oran-berry', weight: 30, min: 2, max: 5 },
      { itemId: 'razz-berry', weight: 22, min: 2, max: 4 },
      { itemId: 'silk-thread', weight: 20, min: 2, max: 5 },
      { itemId: 'soft-sand', weight: 16, min: 2, max: 4 },
      { itemId: 'nanab-berry', weight: 12, min: 1, max: 3 },
    ],
  },
  {
    // Unter Tage: Gestein, Metall — und was im Dunkeln oder in der Glut lebt.
    id: 'dig', favouredTypes: ['ground', 'rock', 'steel', 'fire', 'dark'],
    goldPerFactor: 34,
    lootTable: [
      { itemId: 'iron-shard', weight: 34, min: 2, max: 6 },
      { itemId: 'soft-sand', weight: 26, min: 2, max: 5 },
      { itemId: 'star-piece', weight: 8, min: 1, max: 2 },
      { itemId: 'potion', weight: 18, min: 2, max: 4 },
      { itemId: 'poke-ball', weight: 14, min: 4, max: 9 },
    ],
  },
  {
    // Weites Wasser und weiter Himmel — der Ort für alles, was zieht.
    id: 'dive', favouredTypes: ['water', 'ice', 'flying', 'dragon'],
    goldPerFactor: 30,
    lootTable: [
      { itemId: 'dew-drop', weight: 32, min: 2, max: 5 },
      { itemId: 'great-ball', weight: 20, min: 2, max: 4 },
      { itemId: 'pinap-berry', weight: 18, min: 1, max: 3 },
      { itemId: 'super-potion', weight: 18, min: 1, max: 3 },
      { itemId: 'star-piece', weight: 12, min: 1, max: 2 },
    ],
  },
  {
    // Streife durch bewohntes Land, auch nachts — daher der Geist.
    id: 'patrol', favouredTypes: ['normal', 'fighting', 'electric', 'psychic', 'ghost'],
    goldPerFactor: 44,
    lootTable: [
      { itemId: 'poke-ball', weight: 26, min: 5, max: 12 },
      { itemId: 'potion', weight: 24, min: 2, max: 4 },
      { itemId: 'exp-candy-s', weight: 18, min: 1, max: 2 },
      { itemId: 'full-heal', weight: 14, min: 1, max: 2 },
      { itemId: 'star-piece', weight: 10, min: 1, max: 2 },
      { itemId: 'golden-razz', weight: 8, min: 1, max: 1 },
    ],
  },
]

export interface ExpeditionParty {
  creatureId: string
  speciesId: string
  level: number
  energy: number
}

export const MIN_PARTY = 1
/** Bis zu sechs Kreaturen pro Expedition. Mehr Koepfe heben die Bewertung und
 *  damit die Ausbeute — dafuer sind sie waehrenddessen anderswo nicht nutzbar,
 *  was die eigentliche Kostenseite ist. */
export const MAX_PARTY = 6
export const ENERGY_COST_PER_HOUR = 6

/**
 * Ab wie vielen Köpfen die Bewertung voll ist.
 *
 * Vorher wurde durch `MAX_PARTY` geteilt, also brauchte man sechs passende
 * Pokémon für die volle Ausbeute. Zusammen mit der Typensperre wäre das früh
 * im Spiel unerreichbar: wer vier Wasser-Pokémon hat, hat selten sechs. Vier
 * reichen, sechs schaden nicht — die Bewertung ist ohnehin bei 1 gedeckelt.
 */
export const PARTY_FOR_FULL_RATING = 4

/** Darf dieses Pokémon auf diese Art von Expedition? */
export const fitsExpedition = (types: readonly string[], kind: ExpeditionKind): boolean =>
  types.some((t) => kind.favouredTypes.includes(t))

/** 0..1. Drives loot quantity, not success/failure — an expedition never comes
 *  back empty-handed, because a wasted eight-hour wait is not a fun outcome. */
export function partyRating(
  party: ExpeditionParty[],
  kind: ExpeditionKind,
  speciesOf: (id: string) => SpeciesDef,
): number {
  if (party.length === 0) return 0
  let score = 0
  for (const member of party) {
    const species = speciesOf(member.speciesId)
    // Der Typ ist kein Bonus mehr, sondern die Eintrittskarte — geprueft wird
    // er beim Start. Wer hier steht, passt; es zaehlen Level und Ausdauer.
    if (!fitsExpedition(species.types, kind)) continue
    const levelScore = clamp(member.level / 60, 0.1, 1)
    const energyScore = clamp(member.energy / 100, 0.2, 1)
    score += levelScore * energyScore
  }
  return clamp(score / PARTY_FOR_FULL_RATING, 0, 1)
}

export function energyCost(duration: ExpeditionDuration): number {
  return Math.round((duration.minutes / 60) * ENERGY_COST_PER_HOUR)
}

/**
 * Wie oft aus der Beutetabelle gezogen wird.
 *
 * Ein halbes Team zieht halb so oft. Gemessen an der alten Rechnung: eine
 * achtstuendige Grabung mit perfektem Team gab **2,5 Eisensplitter** — ein
 * Verbindungskabel braucht sechs, also zwanzig Stunden Graben fuer ein Kabel.
 */
export function drawsFor(duration: ExpeditionDuration, rating: number): number {
  return Math.max(1, Math.round(duration.baseDraws * (0.5 + clamp(rating, 0, 1) * 0.5)))
}

/**
 * Was ungefaehr herauskommt — vor dem Start.
 *
 * Aus derselben Tabelle gerechnet, aus der auch gezogen wird: der Erwartungs-
 * wert je Gegenstand ist `Zuege x Anteil x Mittelwert`. Damit kann die Vorschau
 * nicht von der Wirklichkeit abweichen, ohne dass jemand beide Stellen aendert
 * — und das faellt auf, weil ein Test beide vergleicht.
 */
export function expectedOutcome(
  kind: ExpeditionKind, duration: ExpeditionDuration, rating: number,
  partySize: number,
): { loot: Array<{ itemId: string; quantity: number }>; gold: number; xpPerMember: number } {
  const quality = 0.5 + clamp(rating, 0, 1) * 0.5
  const draws = drawsFor(duration, rating)
  const total = kind.lootTable.reduce((sum, e) => sum + e.weight, 0)
  return {
    loot: kind.lootTable.map((e) => ({
      itemId: e.itemId,
      quantity: Math.round(draws * (e.weight / total) * ((e.min + e.max) / 2) * 10) / 10,
    })).filter((e) => e.quantity > 0),
    gold: Math.round(kind.goldPerFactor * duration.yieldFactor * quality),
    xpPerMember: Math.round(24 * duration.yieldFactor * quality / Math.max(1, partySize)),
  }
}

export interface ExpeditionOutcome {
  loot: Array<{ itemId: string; quantity: number }>
  gold: number
  xpPerMember: number
}

export function resolveExpedition(
  kind: ExpeditionKind,
  duration: ExpeditionDuration,
  rating: number,
  party: ExpeditionParty[],
  rng: Rng,
): ExpeditionOutcome {
  // A weak party still gets half; a strong one gets everything plus an extra
  // draw. The spread is deliberately narrow so sending anyone beats sending
  // nobody, which keeps the feature usable early.
  const quality = 0.5 + rating * 0.5
  const draws = drawsFor(duration, rating)

  const merged = new Map<string, number>()
  for (let i = 0; i < draws; i++) {
    const entry = rng.weighted(kind.lootTable, (e) => e.weight)
    const amount = rng.int(entry.min, entry.max)
    merged.set(entry.itemId, (merged.get(entry.itemId) ?? 0) + amount)
  }

  const gold = Math.round(kind.goldPerFactor * duration.yieldFactor * quality)
  const xpPerMember = Math.round(24 * duration.yieldFactor * quality / Math.max(1, party.length))

  return {
    loot: [...merged.entries()].map(([itemId, quantity]) => ({ itemId, quantity })),
    gold,
    xpPerMember,
  }
}

/**
 * Energie als Beschleuniger.
 *
 * Eine Expedition wartet — das ist ihr Wesen. Wer nicht warten will, zahlt mit
 * dem einzigen Vorrat, der sich von selbst füllt: **zehn Minuten je Punkt**.
 * Damit kostet die kurze Reise (30 min) drei Punkte, die lange (8 h) achtund-
 * vierzig — teuer genug, dass es eine Entscheidung bleibt, und billig genug,
 * dass es die letzte Viertelstunde vor dem Schlafengehen rettet.
 */
export const RUSH_MINUTES_PER_ENERGY = 10

/** Wie viel Energie es kostet, `remainingMs` zu überspringen. */
export function rushCost(remainingMs: number): number {
  if (remainingMs <= 0) return 0
  return Math.max(1, Math.ceil(remainingMs / 60_000 / RUSH_MINUTES_PER_ENERGY))
}

export const findDuration = (id: string): ExpeditionDuration | undefined => DURATIONS.find((d) => d.id === id)
export const findKind = (id: string): ExpeditionKind | undefined => KINDS.find((k) => k.id === id)
