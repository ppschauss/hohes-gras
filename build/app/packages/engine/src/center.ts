import type { Rng } from './rng.js'
import { clamp } from './stats.js'

/**
 * Poke-Center.
 *
 * Alle 15 Minuten einmal: das Team wird kostenlos vollstaendig geheilt, und
 * gelegentlich passiert dabei etwas. Die Abklingzeit ist der Preis — deshalb
 * kostet der Besuch keine Energie.
 *
 * Die Ereignisse sind bewusst selten. Ein Fund, der bei jedem zweiten Besuch
 * kommt, ist kein Fund mehr, sondern eine Auszahlung.
 */

/**
 * Abklingzeit des Poké-Centers.
 *
 * Zehn Minuten statt fünfzehn, und mit der Schwesternstation weiter herunter:
 * das Center heilt, und Heilen ist Voraussetzung fürs Spielen, keine
 * Belohnung. Wer wartet, spielt nicht.
 */
export const CENTER_COOLDOWN_MS = 10 * 60_000

/** Wie viel Sekunden je Stufe der Schwesternstation abgehen. */
export const CENTER_COOLDOWN_STEP_MS = 90_000
/** Kürzer als drei Minuten wird es nicht: sonst ist die Abklingzeit weg statt
 *  kurz, und mit ihr der Grund, überhaupt Tränke zu kaufen. */
export const CENTER_COOLDOWN_FLOOR_MS = 3 * 60_000

export function centerCooldown(bonusSteps = 0): number {
  const steps = Math.max(0, Math.floor(bonusSteps))
  return Math.max(CENTER_COOLDOWN_FLOOR_MS, CENTER_COOLDOWN_MS - steps * CENTER_COOLDOWN_STEP_MS)
}

export type CenterEventKind = 'none' | 'gold' | 'gift' | 'trade'

/** Wahrscheinlichkeit je Besuch. Zusammen gut 11 % — im Schnitt also etwa
 *  jeder neunte Besuch. */
export const CENTER_EVENT_CHANCES: Record<Exclude<CenterEventKind, 'none'>, number> = {
  gold: 0.05,
  gift: 0.05,
  trade: 0.015,
}

/**
 * Genau ein Wurf entscheidet.
 *
 * Nicht drei Wuerfe hintereinander: dann haetten spaetere Ereignisse eine
 * geringere echte Chance als ihre Zahl behauptet, weil ein frueherer Treffer
 * sie verdraengt.
 */
export function rollCenterEvent(rng: Rng): CenterEventKind {
  const roll = rng.next()
  let edge = 0
  for (const kind of ['gold', 'gift', 'trade'] as const) {
    edge += CENTER_EVENT_CHANCES[kind]
    if (roll < edge) return kind
  }
  return 'none'
}

/** Was ein Gegenstand wert ist. Materialien haben keinen Kaufpreis, nur einen
 *  Verkaufserloes — der liegt bei etwa der Haelfte. */
export const itemValue = (price: number | null | undefined, sellPrice: number | null | undefined): number =>
  price && price > 0 ? price : Math.max(10, (sellPrice ?? 25) * 2)

/** Budget eines Geschenks in Gold. Bestimmt zusammen mit dem Wert des
 *  Gegenstands die Stueckzahl. */
export const GIFT_BUDGET = 450
export const GIFT_MAX = 15

/**
 * Stueckzahl nach Wertigkeit: von 15 Pokebaellen bis zu einem einzelnen
 * Entwicklungsstein. Die Zahl faellt aus dem Preis des Gegenstands, nicht aus
 * einer gepflegten Liste — ein neues Item im Content-Pack ist damit sofort
 * richtig einsortiert.
 */
export function giftQuantity(value: number): number {
  return clamp(Math.round(GIFT_BUDGET / Math.max(1, value)), 1, GIFT_MAX)
}

/** Billiges kommt haeufiger. Sonst waere jedes zweite Geschenk ein Stein. */
export function giftWeight(value: number): number {
  return clamp(Math.round(3000 / Math.max(1, value)), 1, 100)
}

/** Ein Geldfund waechst mit dem Fortschritt mit, sonst ist er ab Orden fuenf
 *  nicht mehr der Rede wert. */
export function foundGold(rng: Rng, badges: number): number {
  const base = rng.int(60, 400)
  return Math.round(base * (1 + badges * 0.25))
}

/**
 * Getauschte Pokemon sind spuerbar besser als gefangene: unter 18 faellt kein
 * Grundwert. Das ist der Grund, ein Angebot ueberhaupt anzunehmen.
 */
export const TRADE_IV_FLOOR = 18
/** Legendaere Arten (Fangrate 3) sind kein Tauschangebot. */
export const TRADE_MIN_CATCH_RATE = 25
/** Wie lange ein Angebot steht, bevor der Trainer weiterzieht. */
export const TRADE_OFFER_TTL_MS = 60 * 60_000

/** Der Tauschpartner bringt ein etwas hoeheres Level mit, aber nicht so viel,
 *  dass sich der Tausch als Abkuerzung durch die Gebiete missbrauchen laesst. */
export function tradeLevel(givenLevel: number, rng: Rng): number {
  return clamp(givenLevel + rng.int(0, 2), 1, 100)
}

export const centerReadyAt = (lastUsedAt: number, bonusSteps = 0): number =>
  lastUsedAt + centerCooldown(bonusSteps)
export const centerReady = (lastUsedAt: number, now: number, bonusSteps = 0): boolean =>
  now >= centerReadyAt(lastUsedAt, bonusSteps)
