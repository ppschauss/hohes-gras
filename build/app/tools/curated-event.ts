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
  /**
   * Eigene Attacken über das geerbte Lernset hinaus.
   *
   * Gemessen: die Prisma-Glumanda-Linie kam auf 11 Attacken, der Median im
   * Pack liegt bei 15 und Prisma-Abra bei 20 — für eine Art, die man auf einer
   * einzigen Route mit zwei Prozent findet, war das zu wenig. Gemeldet wurde
   * genau das.
   *
   * Sie füllen zugleich die Lücken der Vorlage: Glumandas Kurve springt von 10
   * auf 19 und von 28 auf 34, und dazwischen passierte gar nichts.
   */
  extraMoves?: Array<{ moveId: string; level: number }>
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
    /*
     * Signaturattacken der Linie.
     *
     * Nach dem Thema gewählt, nicht nach Stärke: ein Prisma bricht Licht,
     * also Metallklaue, Juwelenkraft und Lichtkanone. Der Drachenanteil
     * kommt vom Vorbild, das am Ende ohnehin Flügel bekommt. Die Level
     * liegen in den Lücken der Vorlage — 13, 22 und 31 sind genau die
     * Stellen, an denen sonst nichts passierte.
     */
    extraMoves: [
      { moveId: 'metal-claw', level: 13 },
      { moveId: 'power-gem', level: 22 },
      { moveId: 'dragon-breath', level: 31 },
      { moveId: 'flash-cannon', level: 40 },
    ],

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
    /*
     * Zwei Vorbilder, damit die Linie ihrem Namen gerecht wird.
     *
     * Werte und Typen kommen vom ersten, das Lernset aus beiden — je Attacke
     * das niedrigere Level. Damit lernt die Prisma-Linie durchgehend im Takt
     * eines Glumanda statt im spaeteren eines Glutexo: Feuerzahn mit 25 statt
     * 28, Feuersturm mit 43 statt 50. Gemeldet wurde die Luecke dazwischen —
     * zwischen 22 und 28 kam gar nichts.
     */
    basedOn: ['charmeleon', 'charmander'],
    types: ['fire'],
    xpFactor: 1,
    sprite: '/media/sprites/charmeleon-prisma.svg',
    evolvesTo: { to: 'charizard-prisma', level: 36 },
    // Dieselben wie in der Vorstufe, damit nichts beim Entwickeln verschwindet
    // — plus die eigene, die es zur Entwicklung dazubekommt.
    extraMoves: [
      { moveId: 'metal-claw', level: 13 },
      { moveId: 'power-gem', level: 22 },
      { moveId: 'dragon-breath', level: 31 },
      { moveId: 'flash-cannon', level: 40 },
    
      { moveId: 'dragon-claw', level: 36 },
    ],
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
    // Wie oben: Werte vom Glurak, Zeitpunkte vom Glumanda.
    basedOn: ['charizard', 'charmander'],
    types: ['fire', 'flying'],
    xpFactor: 1,
    sprite: '/media/sprites/charizard-prisma.svg',
    extraMoves: [
      { moveId: 'metal-claw', level: 13 },
      { moveId: 'power-gem', level: 22 },
      { moveId: 'dragon-breath', level: 31 },
      { moveId: 'flash-cannon', level: 40 },
    
      { moveId: 'dragon-claw', level: 36 },
      { moveId: 'ancient-power', level: 48 },
    ],
    ivFloor: 20,
  },
]
