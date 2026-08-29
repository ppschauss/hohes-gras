/**
 * Was in einem Freundschaftsgeschenk steckt.
 *
 * Nichts Seltenes: ein Trank, ein paar Beeren, eine Handvoll Bälle — der Wert
 * liegt in der Regelmäßigkeit, nicht im einzelnen Fund. Ein Ei ist die
 * Ausnahme, die den Blick in den Beutel lohnt.
 *
 * Die Mengen sind bewusst klein gehalten: ein Geschenk je Freund und Tag, bei
 * zehn Freunden also fünfzig bis hundert Bälle am Tag. Das ist spürbar, ohne
 * den Laden überflüssig zu machen.
 */
import type { Rng } from './rng.js'

export interface GiftContents {
  items: Array<{ itemId: string; quantity: number }>
  /** Ein Ei liegt bei — welche Art, entscheidet der Empfänger beim Öffnen. */
  egg: boolean
}

/** Wie oft ein Ei beiliegt. */
export const GIFT_EGG_CHANCE = 8

/** Wie viele ungeöffnete Geschenke jemand halten kann. */
export const GIFT_INBOX_LIMIT = 20

export function rollGift(rng: Rng): GiftContents {
  return {
    items: [
      { itemId: 'potion', quantity: 1 },
      { itemId: rng.pick(['oran-berry', 'razz-berry', 'nanab-berry', 'pinap-berry']), quantity: rng.int(1, 3) },
      { itemId: 'poke-ball', quantity: rng.int(5, 10) },
    ],
    egg: rng.chance(GIFT_EGG_CHANCE),
  }
}
