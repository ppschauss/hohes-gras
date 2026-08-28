/**
 * Ereignis-Wesen.
 *
 * Arten, die niemand fangen kann: sie stehen in keiner Spawn-Tabelle und
 * werden von Hand vergeben (`/event` im Bot). Sie zählen deshalb auch nicht in
 * die Pokédex-Summe — sonst bliebe der Dex für alle unvollständig, die bei der
 * Verteilung nicht dabei waren.
 */

export interface EventSpecies {
  id: string
  dexNumber: number
  name: { de: string }
  description: { de: string }
  /** Von welcher Art die Werte, Typen und Lernsets stammen. */
  basedOn: string[]
  types: string[]
  xpFactor: number
  sprite: string
}

export const EVENT_SPECIES: EventSpecies[] = [
  {
    /*
     * Prisma-Abra.
     *
     * Ein Abra, das nie erwachsen wird: keine Entwicklung, dafür von Anfang an
     * das ganze Repertoire der Linie bis Simsala. Bezahlt wird das mit der
     * doppelten EP-Kurve — es kann alles, nur eben langsam.
     */
    id: 'abra-prisma',
    dexNumber: 9001,
    name: { de: 'Prisma-Abra' },
    description: {
      de: 'Schläft zwanzig Stunden am Tag und träumt dabei die Attacken seiner '
        + 'ganzen Linie. Wachsen will es nicht — es hat ja schon alles.',
    },
    basedOn: ['abra', 'kadabra', 'alakazam'],
    types: ['psychic'],
    xpFactor: 2,
    sprite: '/media/sprites/abra-prisma.svg',
  },
]
