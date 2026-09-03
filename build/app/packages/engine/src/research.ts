/**
 * Forschung im Labor.
 *
 * Das Labor war bisher ein Gebäude mit einer Zahl daran: es hob die Fangrate
 * und schaltete ein paar Rezepte frei. Gebaut, vergessen. Forschung macht
 * daraus einen Ort, an dem man etwas *tut* — und zwar über Tage.
 *
 * Drei Dinge unterscheiden ein Projekt von einem Knopf im Laden:
 *
 *  1. Es kostet Werkstoffe. Was man beim Erkunden und Fangen einsammelt, hat
 *     damit ein Ziel jenseits der Werkbank.
 *  2. Es dauert. Ein Projekt läuft, während man etwas anderes macht, und
 *     belegt einen der wenigen Laborplätze.
 *  3. Es braucht ein Pokémon. Das ist so lange nicht verfügbar — und bekommt
 *     am Ende Erfahrung dafür. Damit hat auch das siebzehnte gefangene
 *     Exemplar plötzlich eine Aufgabe, statt sofort verwertet zu werden.
 *
 * Was dabei herauskommt, ist dauerhaft. Ein Projekt wird einmal erforscht und
 * gilt dann für immer; wiederholbar ist nur das Training.
 */

export type ResearchKind = 'recipe' | 'bonus' | 'training'

/** Worauf sich ein Bonusprojekt auswirkt. Die Dienste lesen genau diese Namen. */
export type ResearchBonus =
  | 'findChance'        // Fundstücke beim Erkunden, in Prozentpunkten
  | 'catchDrop'         // Werkstoff je Fang, in Prozentpunkten
  | 'expeditionLoot'    // Expeditionsbeute, in Prozent
  | 'battleXp'          // EP aus Kämpfen, in Prozent
  | 'battleGold'        // Gold aus Kämpfen, in Prozent
  | 'catchRate'         // Fangchance, in Prozent
  | 'shinyOdds'         // Shiny-Grundchance, in Prozentpunkten (×100)

export interface ResearchProject {
  id: string
  kind: ResearchKind
  /**
   * Wie viele Stufen es hat.
   *
   * Rezepte haben genau eine — ein Rezept kennt man oder nicht. Boni haben
   * mehrere, und jede kostet mehr als die vorige.
   */
  tiers: number
  /** Ab welcher Laborstufe das Projekt überhaupt erscheint. */
  lab: number
  /**
   * Welchen Bonus das Projekt hebt. Nur bei `kind: 'bonus'` gesetzt.
   *
   * Rezepte gehen den umgekehrten Weg: dort trägt das Rezept die Kennung
   * seines Projekts. Ein Projekt kann damit mehrere Rezepte auf einmal
   * freischalten — die sechs Entwicklungssteine sind eine Erkenntnis und
   * nicht sechs.
   */
  unlocks: ResearchBonus | null
  /** Was eine Stufe an Bonus bringt. Bei Rezepten ohne Bedeutung. */
  step: number
  /** Grunddauer in Stunden; Stufe n dauert das n-fache. */
  hours: number
  /** Grundkosten; Stufe n kostet das n-fache. */
  gold: number
  inputs: Array<{ itemId: string; quantity: number }>
  /**
   * Erfahrung für das eingesetzte Pokémon, je Stunde Laufzeit.
   *
   * An der Zeit bemessen und nicht am Projekt: sonst wäre das billigste
   * Projekt mit dem größten Ertrag die einzige Art, ein Pokémon großzuziehen.
   */
  xpPerHour: number
}

/**
 * Wie viele Projekte gleichzeitig laufen können.
 *
 * Ein Platz je Laborstufe. Das gibt dem Ausbau eine zweite, spürbarere Wirkung
 * als die halben Prozente auf die Fangrate — und macht die Entscheidung, was
 * zuerst erforscht wird, für lange Zeit zu einer echten.
 */
export const researchSlots = (labLevel: number): number => Math.max(1, Math.min(5, labLevel))

/** Was ein Trainingsdurchlauf an Fleißpunkten einbringt. */
export const EV_PER_TRAINING = 32
/** Und was er kostet und dauert. */
export const TRAINING_HOURS = 3
export const TRAINING_GOLD = 900
export const TRAINING_XP_PER_HOUR = 260
export const TRAINING_INPUTS = [
  { itemId: 'silk-thread', quantity: 8 },
  { itemId: 'soft-sand', quantity: 8 },
]

export const RESEARCH_PROJECTS: ResearchProject[] = [
  /* ------------------------------------------------------------- Rezepte */
  {
    id: 'res-ultra-ball', kind: 'recipe', tiers: 1, lab: 2, unlocks: null,
    step: 0, hours: 4, gold: 1500,
    inputs: [{ itemId: 'iron-shard', quantity: 12 }, { itemId: 'star-piece', quantity: 2 }],
    xpPerHour: 180,
  },
  {
    id: 'res-stones', kind: 'recipe', tiers: 1, lab: 2, unlocks: null,
    step: 0, hours: 8, gold: 3000,
    inputs: [{ itemId: 'star-piece', quantity: 6 }, { itemId: 'dew-drop', quantity: 16 }],
    xpPerHour: 200,
  },
  {
    /*
     * Das Verbindungskabel.
     *
     * Der Schluessel zu elf Arten, die es sonst in dieser Runde nicht gibt.
     * Deshalb liegt es auf Laborstufe 2 und nicht hoeher: es soll erreichbar
     * sein, sobald jemand ueberhaupt forscht. Teuer ist nicht die Forschung,
     * sondern jedes einzelne Kabel danach.
     */
    id: 'res-link-cable', kind: 'recipe', tiers: 1, lab: 2, unlocks: null,
    step: 0, hours: 6, gold: 2000,
    inputs: [{ itemId: 'iron-shard', quantity: 16 }, { itemId: 'silk-thread', quantity: 8 }],
    xpPerHour: 200,
  },
  /*
   * Die Pharmazie: drei Projekte, eine Kette.
   *
   * Duenger zuerst, weil er die Beete erst lohnend macht und alles Weitere
   * aus Beeren besteht. Dann die Fleissbeere, die aus dem Beet kommt. Und
   * zuletzt das Mittel, das aus Fleissbeeren gemacht wird — Endgame, teuer,
   * mit Wartezeit.
   *
   * Alle drei verlangen ein Labor der Stufe 3 oder hoeher: sie sind kein
   * frueher Weg, sondern das, was man mit einer laufenden Wirtschaft anfaengt.
   */
  {
    id: 'res-fertiliser', kind: 'recipe', tiers: 3, lab: 3, unlocks: null,
    step: 0, hours: 6, gold: 4000,
    inputs: [{ itemId: 'razz-berry', quantity: 12 }, { itemId: 'star-piece', quantity: 2 }],
    xpPerHour: 220,
  },
  {
    /*
     * Die Fleissbeeren stehen vor den Vitaminen — Labor 2 statt 3.
     *
     * Sie sind die Ernte, aus der beides entsteht: das Vitamin im Labor und
     * der Kronkorken am Ende. Wer sie nicht anbaut, kommt an keinem der
     * beiden vorbei, und genau darum ist das hier die erste Stufe der Kette
     * und nicht eine Abzweigung daneben.
     */
    id: 'res-ev-berries', kind: 'recipe', tiers: 1, lab: 2, unlocks: null,
    step: 0, hours: 4, gold: 2500,
    inputs: [{ itemId: 'oran-berry', quantity: 20 }, { itemId: 'star-piece', quantity: 3 }],
    xpPerHour: 200,
  },
  {
    id: 'res-vitamins', kind: 'recipe', tiers: 1, lab: 3, unlocks: null,
    step: 0, hours: 10, gold: 9000,
    inputs: [{ itemId: 'golden-razz', quantity: 4 }, { itemId: 'star-piece', quantity: 6 }],
    xpPerHour: 260,
  },
  {
    id: 'res-bottle-cap', kind: 'recipe', tiers: 1, lab: 4, unlocks: null,
    step: 0, hours: 24, gold: 40000,
    inputs: [{ itemId: 'protein', quantity: 2 }, { itemId: 'star-piece', quantity: 20 }],
    xpPerHour: 300,
  },
  {
    id: 'res-rare-candy', kind: 'recipe', tiers: 1, lab: 3, unlocks: null,
    step: 0, hours: 12, gold: 6000,
    inputs: [{ itemId: 'star-piece', quantity: 10 }, { itemId: 'iron-shard', quantity: 20 }],
    xpPerHour: 240,
  },

  {
    /*
     * Der Detektor aus eigener Werkstatt.
     *
     * Er kostet im Laden 500 Gold; hier kostet er Schrott, den er selbst
     * ausgraebt. Das schliesst den Kreis: wer einmal einen hat, kann sich den
     * naechsten verdienen, statt ihn zu kaufen.
     */
    id: 'res-detector', kind: 'recipe', tiers: 1, lab: 2, unlocks: null,
    step: 0, hours: 5, gold: 2000,
    inputs: [{ itemId: 'iron-shard', quantity: 20 }, { itemId: 'soft-sand', quantity: 10 }],
    xpPerHour: 180,
  },
  {
    /*
     * Sternenstaub herstellen.
     *
     * Er ist der Engpass fast jedes teuren Rezepts und faellt sonst nur
     * zufaellig an. Ein Weg, ihn aus gewoehnlichem Material zu machen, ist
     * teuer genug, dass der Zufall die bequemere Quelle bleibt.
     */
    id: 'res-star-piece', kind: 'recipe', tiers: 1, lab: 3, unlocks: null,
    step: 0, hours: 10, gold: 4500,
    inputs: [{ itemId: 'dew-drop', quantity: 24 }, { itemId: 'iron-shard', quantity: 24 }],
    xpPerHour: 220,
  },
  {
    id: 'res-exp-candy', kind: 'recipe', tiers: 1, lab: 1, unlocks: null,
    step: 0, hours: 3, gold: 1000,
    inputs: [{ itemId: 'silk-thread', quantity: 10 }, { itemId: 'dew-drop', quantity: 6 }],
    xpPerHour: 140,
  },
  {
    /*
     * Der Stoersender fuer den Hausgebrauch: 10.000 Gold im Laden, hier ein
     * Nachmittag Arbeit und eine Handvoll Sternenstaub.
     */
    id: 'res-bait', kind: 'recipe', tiers: 1, lab: 4, unlocks: null,
    step: 0, hours: 16, gold: 10000,
    inputs: [{ itemId: 'star-piece', quantity: 12 }, { itemId: 'iron-shard', quantity: 30 }],
    xpPerHour: 260,
  },

  /* --------------------------------------------------------------- Boni */
  {
    /*
     * Speist sich selbst: Material hinein, mehr Material heraus. Deshalb steht
     * es früh und ist billig — es ist das Projekt, das die anderen bezahlt.
     */
    id: 'res-find', kind: 'bonus', tiers: 3, lab: 1, unlocks: 'findChance',
    step: 1, hours: 3, gold: 1200,
    inputs: [{ itemId: 'iron-shard', quantity: 8 }, { itemId: 'soft-sand', quantity: 8 }],
    xpPerHour: 150,
  },
  {
    id: 'res-catch-drop', kind: 'bonus', tiers: 3, lab: 1, unlocks: 'catchDrop',
    step: 2.5, hours: 4, gold: 1600,
    inputs: [{ itemId: 'silk-thread', quantity: 12 }, { itemId: 'dew-drop', quantity: 6 }],
    xpPerHour: 160,
  },
  {
    id: 'res-expedition', kind: 'bonus', tiers: 3, lab: 2, unlocks: 'expeditionLoot',
    step: 10, hours: 6, gold: 2000,
    inputs: [{ itemId: 'dew-drop', quantity: 12 }, { itemId: 'soft-sand', quantity: 12 }],
    xpPerHour: 180,
  },
  {
    id: 'res-battle-xp', kind: 'bonus', tiers: 3, lab: 2, unlocks: 'battleXp',
    step: 5, hours: 8, gold: 3500,
    inputs: [{ itemId: 'iron-shard', quantity: 16 }, { itemId: 'star-piece', quantity: 3 }],
    xpPerHour: 220,
  },
  {
    id: 'res-battle-gold', kind: 'bonus', tiers: 3, lab: 2, unlocks: 'battleGold',
    step: 10, hours: 6, gold: 2800,
    inputs: [{ itemId: 'star-piece', quantity: 4 }],
    xpPerHour: 200,
  },
  {
    id: 'res-catch-rate', kind: 'bonus', tiers: 3, lab: 3, unlocks: 'catchRate',
    step: 3, hours: 10, gold: 5000,
    inputs: [{ itemId: 'golden-razz', quantity: 6 }, { itemId: 'star-piece', quantity: 5 }],
    xpPerHour: 240,
  },
  {
    /*
     * Der stärkste Hebel im Spiel und entsprechend teuer: zwei Stufen heben
     * die Grundchance von 0,20 auf 0,30 Prozent. Mehr wäre keine Jagd mehr.
     */
    id: 'res-shiny', kind: 'bonus', tiers: 2, lab: 4, unlocks: 'shinyOdds',
    step: 0.05, hours: 24, gold: 20000,
    inputs: [{ itemId: 'star-piece', quantity: 20 }, { itemId: 'golden-razz', quantity: 10 }],
    xpPerHour: 300,
  },

  /* ------------------------------------------------------------ Training */
  {
    /*
     * Fleißpunkte gab es in der Datenbank seit dem ersten Tag, aber nichts
     * hat sie je erhöht — bei jedem Pokémon standen sie auf null. Dieses
     * Projekt schaltet das Training frei, und danach ist es der Grund, ein
     * bestimmtes Exemplar zu behalten statt es zu verwerten.
     */
    id: 'res-training', kind: 'training', tiers: 1, lab: 2, unlocks: null,
    step: 0, hours: 6, gold: 2500,
    inputs: [{ itemId: 'dew-drop', quantity: 10 }, { itemId: 'iron-shard', quantity: 10 }],
    xpPerHour: 200,
  },
]

export const findResearch = (id: string): ResearchProject | undefined =>
  RESEARCH_PROJECTS.find((p) => p.id === id)

/** Kosten und Dauer einer Stufe. Stufe 1 ist der Grundwert, jede weitere das
 *  Vielfache — der zweite Schritt darf nicht so billig sein wie der erste. */
export const researchCost = (p: ResearchProject, tier: number) => ({
  gold: p.gold * tier,
  hours: p.hours * tier,
  inputs: p.inputs.map((i) => ({ ...i, quantity: i.quantity * tier })),
})

/** Was ein Bonus nach n erforschten Stufen wert ist. */
export const researchBonusAt = (p: ResearchProject, tiers: number): number =>
  p.step * Math.max(0, Math.min(p.tiers, tiers))
