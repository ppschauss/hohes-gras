/**
 * Entwicklung durch Tausch.
 *
 * Elf Arten entwickeln sich im Vorbild nur, wenn sie den Besitzer wechseln.
 * In einer Runde von vier Leuten ist das kein Weg: es braucht nicht nur
 * jemanden, der tauscht, sondern jemanden, der *zurück*tauscht — sonst ist das
 * Machomei anschließend seines.
 *
 * Deshalb gibt es zwei Wege, und beide führen durch dieselbe Prüfung hier:
 *
 * 1. **Ein echter Tausch.** Löst es aus, sobald das Pokémon ankommt, ohne
 *    Kabel. Der Tausch soll der schönere Weg bleiben.
 * 2. **Das Verbindungskabel.** Simuliert einen Tausch — gebaut aus
 *    Expeditions-Werkstoffen, das Rezept will erst erforscht werden.
 *
 * Verlangt die Entwicklung zusätzlich einen Tragegegenstand (Metallmantel,
 * King-Stein, …), wird der auf beiden Wegen gebraucht und verbraucht.
 */

export const LINK_CABLE_ITEM_ID = 'link-cable'

/** Eine Entwicklung, die am Tausch hängt. Bewusst so schmal, dass die Engine
 *  kein Content-Paket kennen muss. */
export interface TradeEvolution {
  to: string
  /** Was zusätzlich getragen werden muss; fehlt bei den vier Klassikern. */
  heldItemId?: string
}

/**
 * Welche Tausch-Entwicklung jetzt möglich wäre.
 *
 * `bag` ist die Menge der Gegenstände, von denen mindestens einer da ist. Beim
 * echten Tausch braucht es kein Kabel, beim Kabel-Weg schon — mehr Unterschied
 * gibt es zwischen den beiden nicht.
 */
export function tradeEvolutionFor(
  evolutions: readonly TradeEvolution[],
  bag: ReadonlySet<string>,
  via: 'trade' | 'cable',
): TradeEvolution | null {
  if (via === 'cable' && !bag.has(LINK_CABLE_ITEM_ID)) return null
  return evolutions.find((e) => !e.heldItemId || bag.has(e.heldItemId)) ?? null
}
