import type { Rng } from './rng.js'

/**
 * Liga, Ereignisse und Legendäre.
 *
 * Drei Regeln, die zusammengehören, weil sie alle an derselben Frage hängen:
 * *wie weit ist jemand in einer Region gekommen?*
 */

/* ------------------------------------------------------------- Top Vier */

/**
 * Die Top Vier werden der Reihe nach bestritten, der Champion zuletzt.
 *
 * Ohne diese Regel wäre die Reihenfolge Dekoration: man liefe an vier
 * Prüfungen vorbei und direkt zum Meister. Die vierte soll die schwerste sein,
 * und das ist sie nur, wenn die ersten drei davor liegen.
 */
export type LeagueGate =
  | { ok: true }
  | { ok: false; reason: 'elite_locked'; requires: string }
  | { ok: false; reason: 'champion_locked'; missing: number }

export function checkLeagueGate(
  target: string,
  eliteIdsInOrder: readonly string[],
  championId: string | null,
  defeated: ReadonlySet<string>,
): LeagueGate {
  const index = eliteIdsInOrder.indexOf(target)
  if (index > 0) {
    const previous = eliteIdsInOrder[index - 1]!
    if (!defeated.has(previous)) return { ok: false, reason: 'elite_locked', requires: previous }
  }
  if (championId !== null && target === championId && eliteIdsInOrder.length > 0) {
    const missing = eliteIdsInOrder.filter((id) => !defeated.has(id)).length
    if (missing > 0) return { ok: false, reason: 'champion_locked', missing }
  }
  return { ok: true }
}

/** Eine Region gilt als bezwungen, wenn alle ihre Orden da sind und ihr
 *  Meister gefallen ist. */
export function regionCleared(
  regionBadgeIds: readonly string[],
  earnedBadges: ReadonlySet<string>,
  championId: string | null,
  defeated: ReadonlySet<string>,
): boolean {
  if (regionBadgeIds.length === 0) return false
  if (!regionBadgeIds.every((id) => earnedBadges.has(id))) return false
  return championId !== null && defeated.has(championId)
}

/* ------------------------------------------------------------ Legendäre */

/**
 * Wahrscheinlichkeit je Erkundung, dass ein Legendäres auftaucht — aber erst
 * in einer Region, die man vollständig bezwungen hat.
 *
 * Ein Promille klingt nach nichts. Bei einem Energiepunkt je Erkundung sind es
 * im Schnitt tausend Erkundungen, also grob drei volle Energievorräte: selten
 * genug, dass es ein Ereignis bleibt, häufig genug, dass es passiert.
 */
export const LEGENDARY_ODDS = 0.001
export const LEGENDARY_LEVEL_BONUS = 6

export const rollLegendary = (rng: Rng): boolean => rng.next() < LEGENDARY_ODDS

/* --------------------------------------------------- Legendäre fangen */

/**
 * Ein Legendäres fängt man nicht mit einem besseren Ball.
 *
 * Für gewöhnliche Pokémon multiplizieren Ball, Beere, Schwächen und Beruhigen
 * eine Grundchance. Hier gilt nichts davon: die Chance beginnt fast bei null
 * und steigt ausschließlich durch Sagenbeeren, von denen höchstens drei in
 * eine Begegnung passen. Wer ohne kommt, geht mit leeren Händen — und genau
 * das soll ein Legendäres von allem anderen unterscheiden.
 */
export const LEGENDARY_BASE_CATCH = 0.05
export const LEGENDARY_BERRY_BONUS = 0.25
export const LEGENDARY_MAX_BERRIES = 3

export function legendaryCatchChance(berries: number): number {
  const used = Math.max(0, Math.min(berries, LEGENDARY_MAX_BERRIES))
  return LEGENDARY_BASE_CATCH + used * LEGENDARY_BERRY_BONUS
}

/** Ist diese Art ein Legendäres? Erkennbar an der Fangrate im Pack. */
/**
 * Ist diese Art legendaer?
 *
 * Nach der Seltenheit aus dem Pack, nicht nach dem Fangwert. Die Schwelle
 * "Fangwert hoechstens drei" war eine gute Naeherung und lag trotzdem daneben:
 * Tanhel, Metang und Metagross haben im Vorbild ebenfalls Fangwert 3. Sie
 * galten damit als legendaer — nur mit Sagenbeere zu fangen, aus Arena und
 * Kampfzone verbannt, und der Promille-Wurf konnte sie ziehen. Sie sind
 * nichts davon.
 *
 * Die Seltenheit steht im Pack und ist genau dafuer da.
 */
export const isLegendarySpecies = (species: { rarity: string }): boolean =>
  species.rarity === 'legendary'

/* ------------------------------------------------------------ Ereignisse */

/**
 * Der Störsender: fünf Erkundungen mit garantiertem Überfall.
 *
 * Die Kennung steht hier und nicht nur im Content-Pack, weil die Spiellogik
 * sie kennen muss — anders als ein Ball oder eine Beere wirkt dieser
 * Gegenstand nicht über Zahlen, sondern über eine Regel.
 */
export const ROCKET_BAIT_ID = 'rocket-bait'
export const ROCKET_BAIT_CHARGES = 5

/** Wahrscheinlichkeit je Erkundung, dass ein Überfall stattfindet. */
export const EVENT_ODDS = 0.04

/**
 * Wie viele Gegner ein Überfall aufbietet.
 *
 * Höchstens so viele, wie man selbst dabeihat. Der Entwurf sieht drei vor —
 * gegen ein Team aus zwei ist das kein knapper Kampf, sondern Überzahl, und
 * genau daran scheiterten die kleinen Teams: nicht am Level, sondern an der
 * Zahl.
 */
export const eventPartySize = (designed: number, teamSize: number): number =>
  Math.max(1, Math.min(designed, Math.max(1, Math.floor(teamSize))))

/** Wie oft ein besiegter Überfall eine Sagenbeere fallen lässt. */
export const BERRY_DROP_CHANCE = 0.5
export const LEGENDARY_BERRY_ID = 'legendary-berry'

export const rollBerryDrop = (rng: Rng): boolean => rng.next() < BERRY_DROP_CHANCE

/**
 * Chance auf ein Pokémon mit makellosen Werten als Beute.
 *
 * Bewusst klein: ein garantiert perfektes Pokémon aus einem Zufallsereignis
 * würde jede Zucht und jeden Tausch entwerten.
 */
export const EVENT_PERFECT_CHANCE = 0.03
export const PERFECT_IV = 31

export const rollEvent = (rng: Rng): boolean => rng.next() < EVENT_ODDS
export const rollPerfect = (rng: Rng): boolean => rng.next() < EVENT_PERFECT_CHANCE

/** Beutegold eines Überfalls, gemessen am Niveau des Gebiets. */
export function eventGold(areaLevel: number, rng: Rng): number {
  return Math.round((120 + areaLevel * 26) * (0.85 + rng.next() * 0.4))
}

/**
 * Lockdüfte als Beute eines Überfalls.
 *
 * Die Banden führen Köder mit sich — inhaltlich naheliegend, und spielerisch
 * schließt es einen Kreis: der Überfall wirft ab, was den nächsten Fang lenkt.
 * Verschiedene Arten statt eines Stapels, weil ein Stapel nur die eine Suche
 * verbilligt und ein Fächer die Wahl eröffnet.
 */
export const LURE_DROP_CHANCE = 0.7
export const LURE_DROP_MIN = 2
export const LURE_DROP_MAX = 5

/** Welche Lockduft-Typen ein besiegter Überfall abwirft — je einer je Art. */
export function rollLureDrop(rng: Rng, typeIds: readonly string[]): string[] {
  if (typeIds.length === 0 || rng.next() >= LURE_DROP_CHANCE) return []
  const pool = [...typeIds]
  const count = Math.min(pool.length, rng.int(LURE_DROP_MIN, LURE_DROP_MAX))
  const picked: string[] = []
  for (let i = 0; i < count; i++) {
    const idx = rng.int(0, pool.length - 1)
    picked.push(pool[idx]!)
    pool.splice(idx, 1)
  }
  return picked
}

/** Wie viele Stück eines Gegenstands ein Überfall abwirft. */
export function eventLoot(rng: Rng): number {
  return rng.int(2, 6)
}

/** Trainer, die nur als Ereignis auftauchen, tragen diesen Präfix. Damit
 *  bleiben sie aus der Gebietsliste heraus, ohne ein eigenes Feld im
 *  Content-Pack zu brauchen. */
export const EVENT_TRAINER_PREFIX = 'event-'
export const isEventTrainer = (id: string): boolean => id.startsWith(EVENT_TRAINER_PREFIX)

/** Wie weit ein Ueberfallteam um das eigene Niveau streut. */
export const EVENT_LEVEL_SPREAD = 3

/**
 * Wie weit die Mitte des Ueberfallteams unter dem eigenen Median liegt.
 *
 * Gemessen an simulierten Kaempfen: exakt auf dem Median gewann ein Team aus
 * vier Mitgliedern nur 36 % der Ueberfaelle, eines aus zweien 26 %. Ein
 * Ueberfall unterbricht das Erkunden — er soll ein Kampf sein, den man meistens
 * gewinnt, kein Boss. Zwei Level tiefer bringt dieselben Teams auf 47 %, und
 * zusammen mit der gedeckelten Truppgroesse (siehe unten) reicht das.
 */
export const EVENT_LEVEL_OFFSET = -2

/**
 * Die Level eines Ueberfallteams, gemessen am eigenen Team.
 *
 * Ein Ueberfall hat keinen Ort im Entwurf — er passiert dort, wo man gerade
 * erkundet. Feste Level waeren deshalb immer falsch: dieselbe Rocket-Truppe
 * traefe den einen als Wand und den anderen als Uebung. Gemessen wird am
 * Median des eigenen Teams, und die Mitglieder verteilen sich gleichmaessig
 * ueber ±3 — der Schwaechste liegt drei darunter, der Staerkste drei darueber.
 *
 * Die innere Reihenfolge des Entwurfs bleibt damit erhalten: der letzte im
 * Team ist weiterhin der haerteste.
 */
export function eventLevels(
  size: number, reference: number, spread = EVENT_LEVEL_SPREAD, offset = EVENT_LEVEL_OFFSET,
): number[] {
  const n = Math.max(0, Math.floor(size))
  if (n === 0) return []
  const ref = Math.max(1, Math.floor(reference) + offset)
  if (n === 1) return [ref]
  return Array.from({ length: n }, (_, i) =>
    Math.max(1, ref - spread + Math.round((2 * spread * i) / (n - 1))))
}
