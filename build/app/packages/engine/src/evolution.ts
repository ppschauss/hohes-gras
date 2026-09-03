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
  /*
   * Kein Tragegegenstand mehr.
   *
   * Im Vorbild brauchen acht dieser Entwicklungen zusaetzlich etwas Getragenes.
   * Ein Pokemon kann hier aber nichts tragen — die Bedingung waere nie
   * erfuellbar, und die acht gaebe es nur auf dem Papier. Das Kabel ist die
   * ganze Bedingung.
   */

  /*
   * Bei zwei moeglichen Zielen entscheidet niemand automatisch.
   *
   * Perlu ist der einzige Fall: es kann zu Aalabyss *oder* zu Saganabyss
   * werden. Im Vorbild entscheidet der getragene Gegenstand — und weil der
   * hier weggefallen ist, blieb `evolutions[0]`, also immer Aalabyss.
   * Saganabyss war damit unerreichbar, obwohl beide Wege im Paket stehen.
   *
   * Ein Tausch ist keine Wahl: die beiden Spieler haben ein Pokemon getauscht,
   * nicht eine Entwicklung ausgesucht. Also entwickelt sich hier gar nichts,
   * und die Tausch-Station uebernimmt — dort stehen beide Ziele als eigene
   * Zeilen, und der Spieler zeigt auf eines. Lieber eine Entwicklung, die
   * einen zweiten Schritt braucht, als eine, die dem Spieler das falsche
   * Pokemon gibt.
   */
  if (evolutions.length > 1) return null
  return evolutions[0] ?? null
}
