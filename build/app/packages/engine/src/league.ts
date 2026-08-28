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
/** Legendäre erkennt man im Pack an ihrer Fangrate. */
export const LEGENDARY_CATCH_RATE = 3
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
export const isLegendaryCatchRate = (catchRate: number): boolean =>
  catchRate <= LEGENDARY_CATCH_RATE

/* ------------------------------------------------------------ Ereignisse */

/** Wahrscheinlichkeit je Erkundung, dass ein Überfall stattfindet. */
export const EVENT_ODDS = 0.04

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

/** Wie viele Stück eines Gegenstands ein Überfall abwirft. */
export function eventLoot(rng: Rng): number {
  return rng.int(2, 6)
}

/** Trainer, die nur als Ereignis auftauchen, tragen diesen Präfix. Damit
 *  bleiben sie aus der Gebietsliste heraus, ohne ein eigenes Feld im
 *  Content-Pack zu brauchen. */
export const EVENT_TRAINER_PREFIX = 'event-'
export const isEventTrainer = (id: string): boolean => id.startsWith(EVENT_TRAINER_PREFIX)
