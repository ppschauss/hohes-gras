import type { Rng } from './rng.js'

/**
 * Was beim Erkunden sonst noch passiert.
 *
 * Bis hierher kannte eine Erkundung drei Ausgaenge: ein wildes Pokemon, ein
 * Ueberfall, oder nichts. Der dritte war der haeufigste und der langweiligste.
 * Zwei weitere kommen dazu — ein Streuner, der einem den Weg abschneidet, und
 * ein Fundstueck im Unterholz.
 *
 * Beide sind bewusst selten. Drei Prozent heisst: etwa jede dreiunddreissigste
 * Erkundung, also mehrmals am Tag, aber nie so oft, dass man aufhoert
 * hinzusehen.
 */

/** Wahrscheinlichkeit je Erkundung, dass ein Streuner den Weg kreuzt. */
export const WANDER_ODDS = 0.03
/** Wahrscheinlichkeit je Erkundung, dass etwas im Unterholz liegt. */
export const FIND_ODDS = 0.03

export const rollWander = (rng: Rng): boolean => rng.next() < WANDER_ODDS
/** @param bonus Erforschter Zuschlag in Prozentpunkten. */
export const rollFind = (rng: Rng, bonus = 0): boolean =>
  rng.next() < FIND_ODDS + Math.max(0, bonus) / 100

/**
 * Wie viele Pokemon ein Streuner dabeihat.
 *
 * Hoechstens zwei. Ein Streuner ist kein Arenaleiter: er kostet zwei Energie
 * und steht zwischen einem und der naechsten Erkundung, also darf er kein
 * halber Nachmittag sein.
 */
export const WANDER_PARTY_MAX = 2

/* ------------------------------------------------------------ Fundstuecke */

export type FindKind = 'item' | 'coins' | 'fragment'

/** Ein Beutel voll Muenzen. Die Spanne ist absichtlich weit — ein Fund, der */
/*  immer dasselbe abwirft, ist eine Auszahlung und kein Fund. */
export const COIN_PURSE_MIN = 55
export const COIN_PURSE_MAX = 789

export const coinPurse = (rng: Rng): number =>
  COIN_PURSE_MIN + Math.floor(rng.next() * (COIN_PURSE_MAX - COIN_PURSE_MIN + 1))

/**
 * Woraus ein Fund besteht.
 *
 * Zwei Verteilungen, und der Unterschied ist der Punkt: was man zufaellig
 * findet, ist oft ein Geldbeutel; was ein Metalldetektor ausgraebt, ist Schrott
 * und Fragmente. Sonst waere das Geraet ein Geldautomat — zehn Anwendungen fuer
 * 500 Gold, die im Schnitt ein Vielfaches davon ausspucken. So kauft es
 * Fortschritt statt Guthaben, und das ist auch das, wonach ein Detektor piept.
 */
const RANDOM_SHARES: Array<[FindKind, number]> = [['item', 0.6], ['coins', 0.28], ['fragment', 0.12]]
const DETECTOR_SHARES: Array<[FindKind, number]> = [['item', 0.72], ['coins', 0.1], ['fragment', 0.18]]

export function rollFindKind(rng: Rng, fromDetector = false): FindKind {
  const shares = fromDetector ? DETECTOR_SHARES : RANDOM_SHARES
  const roll = rng.next()
  let edge = 0
  for (const [kind, share] of shares) {
    edge += share
    if (roll < edge) return kind
  }
  return 'item'
}

/* ---------------------------------------------------------- Metalldetektor */

/**
 * Der Metalldetektor.
 *
 * Wie der Stoersender eine Regel und keine Zahl, deshalb steht seine Kennung
 * hier und nicht nur im Content-Pack: solange Ladungen uebrig sind, endet jede
 * Erkundung in einem Fund.
 */
export const METAL_DETECTOR_ID = 'metal-detector'
/*
 * Eine Anwendung, nicht zehn.
 *
 * Mit zehn war ein einziger Kauf ein halber Nachmittag garantierter Funde —
 * gemeldet als "zu stark", und das war es auch: der Zufall kam kaum noch vor.
 * Einer je Gerät macht daraus eine Entscheidung statt eines Modus.
 */
export const METAL_DETECTOR_CHARGES = 1

/**
 * Wieviel ein Fundstueck in dieser Region wert sein darf, gemessen am
 * Verkaufspreis.
 *
 * Der Verkaufspreis ist das einzige Wertmass, das jeder Gegenstand traegt —
 * auch die, die man nirgends kaufen kann. Damit haengt die Fundtabelle am
 * Inhalt statt an einer Liste von Kennungen, und eine vierte Region braucht
 * keine Zeile Code: 50 in der ersten, 150 in der zweiten, 450 in der dritten.
 */
export const findValueCap = (regionOrder: number): number =>
  50 * 3 ** Math.max(0, Math.floor(regionOrder))

/**
 * Wie viele Stueck ein Fund abwirft.
 *
 * Am Wert normiert: von billigen Sachen liegt ein kleiner Haufen da, von
 * teuren genau eines. Drei ist die Obergrenze, damit ein Fund ein Fund bleibt
 * und keine Lieferung.
 */
export const findQuantity = (sellPrice: number, cap: number): number =>
  Math.max(1, Math.min(3, Math.floor(cap / Math.max(1, sellPrice))))
