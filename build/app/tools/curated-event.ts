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
  /**
   * Wohin sie sich entwickelt — leer heißt: gar nicht.
   *
   * Prisma-Abra bleibt, was es ist. Die Prisma-Glumanda-Linie dagegen wächst
   * wie ihr Vorbild: das ist der Unterschied zwischen einem Scherz und einem
   * Fund.
   */
  evolvesTo?: { to: string; level: number }
  /** Untergrenze der Werte beim Fangen; 0 heißt: ganz normal gewürfelt. */
  ivFloor?: number
  /**
   * Wo sie wild vorkommt.
   *
   * `areaOrder` ist das wievielte Gebiet einer Region — dieselbe Stelle in
   * jeder Region, damit niemand die Welt umkrempeln muss, um sie zu suchen.
   * `chance` ist der Anteil an allen Begegnungen dort, in Prozent.
   */
  wild?: { areaOrder: number; chance: number }
  /** Zählt sie als Ereignis-Art (nicht fangbar, nicht im Dex-Nenner)? */
  eventOnly?: boolean
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
    eventOnly: true,
  },

  /*
   * Die Prisma-Glumanda-Linie.
   *
   * Anders als das Abra ist sie kein Geschenk, sondern ein Fund: zwei Prozent
   * im zehnten Gebiet jeder Region. Und anders als das Abra wächst sie — durch
   * dieselbe Kette wie ihr Vorbild, mit denselben Levelgrenzen.
   *
   * Die Werte sind spürbar besser als der Durchschnitt, aber nicht makellos:
   * mindestens 20 von 31 je Wert. Ein makelloser Fund wäre das Ende der Suche
   * und nicht ihr Anfang.
   */
  {
    id: 'charmander-prisma',
    dexNumber: 9002,
    name: { de: 'Prisma-Glumanda' },
    description: {
      de: 'Seine Schuppen brechen das Licht wie geschliffenes Glas. Wo es '
        + 'schläft, liegt am Morgen ein Regenbogen auf dem Boden.',
    },
    basedOn: ['charmander'],
    types: ['fire'],
    xpFactor: 1,
    sprite: '/media/sprites/charmander-prisma.svg',
    evolvesTo: { to: 'charmeleon-prisma', level: 16 },
    ivFloor: 20,
    wild: { areaOrder: 10, chance: 2 },
  },
  {
    id: 'charmeleon-prisma',
    dexNumber: 9003,
    name: { de: 'Prisma-Glutexo' },
    description: {
      de: 'Die Kanten sind schärfer geworden, das Licht darin unruhiger. Es '
        + 'sucht den Streit, nicht die Sonne.',
    },
    basedOn: ['charmeleon'],
    types: ['fire'],
    xpFactor: 1,
    sprite: '/media/sprites/charmeleon-prisma.svg',
    evolvesTo: { to: 'charizard-prisma', level: 36 },
    ivFloor: 20,
  },
  {
    id: 'charizard-prisma',
    dexNumber: 9004,
    name: { de: 'Prisma-Glurak' },
    description: {
      de: 'Im Flug wirft es Farben über ganze Täler. Wer es einmal gesehen '
        + 'hat, sucht danach jeden Sonnenaufgang ab.',
    },
    basedOn: ['charizard'],
    types: ['fire', 'flying'],
    xpFactor: 1,
    sprite: '/media/sprites/charizard-prisma.svg',
    ivFloor: 20,
  },
]
