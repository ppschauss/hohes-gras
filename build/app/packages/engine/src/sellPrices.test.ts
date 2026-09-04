import { describe, expect, it } from 'vitest'
import { SOUL_SELL_PRICE } from './breeding.js'

/*
 * Die Preise sind gerechnet, nicht gefuehlt — und diese Rechnung soll nicht
 * still veralten. Die Zahlen stammen aus echtem Spielbetrieb: aus 460
 * Begegnungen der Bot-Spieler wurden 425 Faenge, das sind 1,08 Baelle je Fang;
 * ein Pokemon traegt im Schnitt 1,47 Typen und laesst beim Verwerten je Typ ein
 * Fragment zurueck.
 */
const BALL_PREIS = 30
const BAELLE_JE_FANG = 1.08
const FRAGMENTE_JE_FANG = 1.47

/** Was blosses Erkunden je Energie einbringt — der Massstab, gegen den sich
 *  jede andere Goldquelle messen lassen muss. */
const ERKUNDEN_JE_ENERGIE = 24

describe('Was ein Seelenfragment wert sein darf', () => {
  it('macht das Farmen von Fragmenten nicht lohnender als Erkunden', () => {
    const einnahme = FRAGMENTE_JE_FANG * SOUL_SELL_PRICE
    const kosten = BAELLE_JE_FANG * BALL_PREIS
    // Eine Begegnung kostet eine Energie; die Baelle je Fang sind zugleich die
    // Begegnungen je Fang.
    const jeEnergie = (einnahme - kosten) / BAELLE_JE_FANG
    expect(jeEnergie).toBeLessThan(ERKUNDEN_JE_ENERGIE / 4)
  })

  /*
   * Die andere Richtung, und sie ist genauso wichtig: waere der Preis unter
   * den Ballkosten, waere Verwerten ein Verlustgeschaeft und der Verkauf eine
   * Falle statt eines Angebots.
   */
  it('bleibt in Reichweite dessen, was ein Fragment an Baellen kostet', () => {
    const kostenJeFragment = (BAELLE_JE_FANG * BALL_PREIS) / FRAGMENTE_JE_FANG
    expect(SOUL_SELL_PRICE).toBeGreaterThan(kostenJeFragment * 0.8)
    expect(SOUL_SELL_PRICE).toBeLessThan(kostenJeFragment * 1.5)
  })
})
