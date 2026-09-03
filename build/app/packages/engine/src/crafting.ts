/**
 * Crafting.
 *
 * Turns expedition materials into things that matter. Recipes exist so that
 * loot which would otherwise pile up unread has a destination — a bag full of
 * "Feinsand" is only interesting if it becomes something.
 */
/**
 * Eine Chargengröße.
 *
 * `factor` ist nicht `count / erste Charge` — darin steckt der Mengenrabatt.
 * Fünfzig Bälle kosten das Vierfache von zehn, nicht das Fünffache: wer auf
 * Vorrat baut, bindet Material lange im Voraus und soll dafür etwas bekommen.
 * Das ist auch der Grund, warum die Chargen überhaupt existieren — zehnmal
 * denselben Knopf zu drücken ist keine Entscheidung, sondern Arbeit.
 */
export interface RecipeBatch {
  /** Wie viele Stück herauskommen. */
  count: number
  /** Womit Zutaten und Gold multipliziert werden. */
  factor: number
}

/** Zehn, fünfundzwanzig, fünfzig — mit 10 % bzw. 20 % Nachlass. */
export const BALL_BATCHES: RecipeBatch[] = [
  { count: 10, factor: 1 },
  { count: 25, factor: 2.25 },
  { count: 50, factor: 4 },
]

export interface Recipe {
  id: string
  /** What it produces. Bei Chargen gilt das für die kleinste. */
  output: { itemId: string; quantity: number }
  /**
   * Wählbare Mengen. Fehlt das Feld, gibt es genau eine — das ist der
   * Normalfall und bleibt für alles außer Bällen so.
   */
  batches?: RecipeBatch[]
  inputs: Array<{ itemId: string; quantity: number }>
  goldCost: number
  /** Buildings are not required, but a lab makes some recipes available. */
  requiresBuilding?: { buildingId: string; level: number }
  /**
   * Kennung des Forschungsprojekts, das dieses Rezept freischaltet.
   *
   * Ohne Eintrag kann man es von Anfang an. Die Grundrezepte bleiben deshalb
   * offen — wer heute Baelle und Traenke baut, soll das morgen noch koennen;
   * gesperrt wird nur, was ohnehin ein Labor verlangte, und was neu dazukommt.
   */
  research?: string
  /**
   * Welche Stufe des Projekts noetig ist. Ohne Eintrag genuegt Stufe 1.
   *
   * Duenger wird in drei Stufen erforscht, und jede Stufe soll genau einen
   * Duenger freischalten. Ohne dieses Feld haette die erste Stufe alle drei
   * geoeffnet, und die beiden weiteren waeren reine Goldsenken gewesen.
   */
  researchTier?: number
}

export const RECIPES: Recipe[] = [
  {
    /*
     * Der Pokeball aus eigener Hand.
     *
     * Er stand lange nur im Laden, und damit war die ganze Ballkette an Gold
     * gebunden: jedes andere Ballrezept verbraucht Pokebaelle, also kaufte man
     * sie. Jetzt gibt es den Weg ueber Werkstoffe — fuenfzig Stueck kosten
     * 16 Eisensplitter statt 1.500 Gold. Wer faehrt, zahlt weniger als wer
     * nur reich ist, und genau darum geht es bei den Expeditionen.
     */
    id: 'craft-poke-ball',
    output: { itemId: 'poke-ball', quantity: 10 },
    batches: BALL_BATCHES,
    inputs: [{ itemId: 'iron-shard', quantity: 4 }, { itemId: 'silk-thread', quantity: 2 }],
    goldCost: 100,
  },
  {
    id: 'craft-great-ball',
    output: { itemId: 'great-ball', quantity: 10 },
    batches: BALL_BATCHES,
    inputs: [{ itemId: 'poke-ball', quantity: 12 }, { itemId: 'iron-shard', quantity: 3 }],
    goldCost: 200,
  },
  {
    id: 'craft-ultra-ball', research: 'res-ultra-ball',
    output: { itemId: 'ultra-ball', quantity: 10 },
    batches: BALL_BATCHES,
    inputs: [
      { itemId: 'great-ball', quantity: 12 },
      { itemId: 'iron-shard', quantity: 8 },
      // Nur einer je zehn: Sternenstaub faellt am seltensten von allem
      // (etwa einer je langer Reise) und waere sonst der heimliche Deckel
      // ueber der ganzen Kette.
      { itemId: 'star-piece', quantity: 1 },
    ],
    goldCost: 900,
    requiresBuilding: { buildingId: 'lab', level: 2 },
  },
  {
    /*
     * Ein Kabel je Entwicklung.
     *
     * Sechs Eisensplitter sind etwa zwei bis drei Expeditionen in die Ruine,
     * der Sternenstaub kommt aus den langen. Das ist bewusst spuerbar: elf
     * Arten haengen daran, und wer sie alle will, faehrt dafuer eine Weile.
     */
    id: 'craft-link-cable', research: 'res-link-cable',
    output: { itemId: 'link-cable', quantity: 1 },
    inputs: [
      { itemId: 'iron-shard', quantity: 6 },
      { itemId: 'silk-thread', quantity: 3 },
      { itemId: 'star-piece', quantity: 1 },
    ],
    goldCost: 800,
    requiresBuilding: { buildingId: 'lab', level: 2 },
  },
  /*
   * Duenger, drei Stufen.
   *
   * Jede Stufe nimmt die Beere der vorigen und legt eine bessere dazu — so
   * haengt Stufe III an einem Beet, das schon mit Stufe II bewirtschaftet
   * wurde. Der Sternenstaub ist die Bremse: er faellt in der Kampfzone erst
   * ab Serie 50 und macht den Duenger damit zu etwas, das man sich verdient.
   */
  {
    id: 'craft-fertiliser-1', research: 'res-fertiliser',
    output: { itemId: 'fertiliser-1', quantity: 3 },
    inputs: [
      { itemId: 'oran-berry', quantity: 10 },
      { itemId: 'iron-shard', quantity: 4 },
      { itemId: 'star-piece', quantity: 1 },
    ],
    goldCost: 1200,
    requiresBuilding: { buildingId: 'lab', level: 3 },
  },
  {
    id: 'craft-fertiliser-2', research: 'res-fertiliser',
    researchTier: 2,
    output: { itemId: 'fertiliser-2', quantity: 2 },
    inputs: [
      { itemId: 'razz-berry', quantity: 12 },
      { itemId: 'fertiliser-1', quantity: 3 },
      { itemId: 'star-piece', quantity: 3 },
    ],
    goldCost: 4000,
    requiresBuilding: { buildingId: 'lab', level: 3 },
  },
  {
    id: 'craft-fertiliser-3', research: 'res-fertiliser',
    researchTier: 3,
    output: { itemId: 'fertiliser-3', quantity: 1 },
    inputs: [
      { itemId: 'golden-razz', quantity: 6 },
      { itemId: 'fertiliser-2', quantity: 2 },
      { itemId: 'star-piece', quantity: 8 },
    ],
    goldCost: 15000,
    requiresBuilding: { buildingId: 'lab', level: 4 },
  },
  /*
   * Die sechs Vitamine — je eines fuer einen Wert, je eines mit eigenem
   * Rezept.
   *
   * Alle sechs teilen sich eine Forschung und dieselbe Grundform: eine Beere
   * aus dem eigenen Beet, ein Werkstoff, der zum Wert passt, und ein
   * Sternenstaub. Nur die Zutat in der Mitte unterscheidet sie — so bleibt
   * die Kette lesbar, und trotzdem baut man jedes einzeln.
   *
   * 32 Fleisspunkte je Flasche, genau ein Trainingslauf: das Vitamin ist ein
   * Training in der Flasche. Teurer, aber sofort und ohne das Pokemon drei
   * Stunden zu binden.
   */
  /*
   * Die sechs Fleissbeeren.
   *
   * Zwei Stueck je Ansatz, und das ist Absicht: es reicht zum Anpflanzen,
   * nicht zum Verbrauchen. Wer Fleisspunkte will, zieht sie im Beet nach —
   * das Labor liefert nur die Aussaat.
   */
  {
    id: 'craft-pomeg-berry', research: 'res-ev-berries',
    output: { itemId: 'pomeg-berry', quantity: 2 },
    inputs: [
      { itemId: 'oran-berry', quantity: 10 },
      { itemId: 'soul-normal', quantity: 2 },
      { itemId: 'star-piece', quantity: 1 },
    ],
    goldCost: 1800,
    requiresBuilding: { buildingId: 'lab', level: 2 },
  },
  {
    id: 'craft-kelpsy-berry', research: 'res-ev-berries',
    output: { itemId: 'kelpsy-berry', quantity: 2 },
    inputs: [
      { itemId: 'razz-berry', quantity: 10 },
      { itemId: 'soul-fighting', quantity: 2 },
      { itemId: 'star-piece', quantity: 1 },
    ],
    goldCost: 1800,
    requiresBuilding: { buildingId: 'lab', level: 2 },
  },
  {
    id: 'craft-qualot-berry', research: 'res-ev-berries',
    output: { itemId: 'qualot-berry', quantity: 2 },
    inputs: [
      { itemId: 'nanab-berry', quantity: 10 },
      { itemId: 'iron-shard', quantity: 2 },
      { itemId: 'star-piece', quantity: 1 },
    ],
    goldCost: 1800,
    requiresBuilding: { buildingId: 'lab', level: 2 },
  },
  {
    id: 'craft-hondew-berry', research: 'res-ev-berries',
    output: { itemId: 'hondew-berry', quantity: 2 },
    inputs: [
      { itemId: 'pinap-berry', quantity: 10 },
      { itemId: 'soul-psychic', quantity: 2 },
      { itemId: 'star-piece', quantity: 1 },
    ],
    goldCost: 1800,
    requiresBuilding: { buildingId: 'lab', level: 2 },
  },
  {
    id: 'craft-apicot-berry', research: 'res-ev-berries',
    output: { itemId: 'apicot-berry', quantity: 2 },
    inputs: [
      { itemId: 'nanab-berry', quantity: 10 },
      { itemId: 'soul-fairy', quantity: 2 },
      { itemId: 'star-piece', quantity: 1 },
    ],
    goldCost: 1800,
    requiresBuilding: { buildingId: 'lab', level: 2 },
  },
  {
    id: 'craft-tamato-berry', research: 'res-ev-berries',
    output: { itemId: 'tamato-berry', quantity: 2 },
    inputs: [
      { itemId: 'pinap-berry', quantity: 10 },
      { itemId: 'soul-flying', quantity: 2 },
      { itemId: 'star-piece', quantity: 1 },
    ],
    goldCost: 1800,
    requiresBuilding: { buildingId: 'lab', level: 2 },
  },
  {
    id: 'craft-hp-up', research: 'res-vitamins',
    output: { itemId: 'hp-up', quantity: 1 },
    inputs: [
      { itemId: 'pomeg-berry', quantity: 8 },
      { itemId: 'soul-normal', quantity: 3 },
      { itemId: 'star-piece', quantity: 1 },
    ],
    goldCost: 4000,
    requiresBuilding: { buildingId: 'lab', level: 3 },
  },
  {
    id: 'craft-protein', research: 'res-vitamins',
    output: { itemId: 'protein', quantity: 1 },
    inputs: [
      { itemId: 'kelpsy-berry', quantity: 8 },
      { itemId: 'soul-fighting', quantity: 3 },
      { itemId: 'star-piece', quantity: 1 },
    ],
    goldCost: 4000,
    requiresBuilding: { buildingId: 'lab', level: 3 },
  },
  {
    id: 'craft-iron', research: 'res-vitamins',
    output: { itemId: 'iron', quantity: 1 },
    inputs: [
      { itemId: 'qualot-berry', quantity: 8 },
      { itemId: 'iron-shard', quantity: 3 },
      { itemId: 'star-piece', quantity: 1 },
    ],
    goldCost: 4000,
    requiresBuilding: { buildingId: 'lab', level: 3 },
  },
  {
    id: 'craft-calcium', research: 'res-vitamins',
    output: { itemId: 'calcium', quantity: 1 },
    inputs: [
      { itemId: 'hondew-berry', quantity: 8 },
      { itemId: 'soul-psychic', quantity: 3 },
      { itemId: 'star-piece', quantity: 1 },
    ],
    goldCost: 4000,
    requiresBuilding: { buildingId: 'lab', level: 3 },
  },
  {
    id: 'craft-zinc', research: 'res-vitamins',
    output: { itemId: 'zinc', quantity: 1 },
    inputs: [
      { itemId: 'apicot-berry', quantity: 8 },
      { itemId: 'soul-water', quantity: 3 },
      { itemId: 'star-piece', quantity: 1 },
    ],
    goldCost: 4000,
    requiresBuilding: { buildingId: 'lab', level: 3 },
  },
  {
    id: 'craft-carbos', research: 'res-vitamins',
    output: { itemId: 'carbos', quantity: 1 },
    inputs: [
      { itemId: 'tamato-berry', quantity: 8 },
      { itemId: 'silk-thread', quantity: 3 },
      { itemId: 'star-piece', quantity: 1 },
    ],
    goldCost: 4000,
    requiresBuilding: { buildingId: 'lab', level: 3 },
  },
  /*
   * Der Kronkorken.
   *
   * Der teuerste Gegenstand im Spiel, und das mit Absicht: er hebt eine
   * Veranlagung auf den Hoechstwert und ist damit der letzte Schritt zu einem
   * makellosen Pokemon, den die Zucht allein nicht mehr schafft. Sechs
   * Vitamine stecken darin — eines je Wert, also die ganze Reihe.
   */
  {
    id: 'craft-bottle-cap', research: 'res-bottle-cap',
    output: { itemId: 'bottle-cap', quantity: 1 },
    /*
     * Alle sechs Fleissbeeren, nicht eine davon in Menge.
     *
     * Eine einzelne Sorte waere eine Zahl, die man hochzieht; sechs Sorten
     * sind sechs Beete, die man ueber Tage nebeneinander betreibt. Der
     * Unterschied ist das, was den Gegenstand zum Abschluss der Kette macht
     * und nicht zum naechsten Posten auf einer Einkaufsliste.
     */
    inputs: [
      { itemId: 'pomeg-berry', quantity: 4 },
      { itemId: 'kelpsy-berry', quantity: 4 },
      { itemId: 'qualot-berry', quantity: 4 },
      { itemId: 'hondew-berry', quantity: 4 },
      { itemId: 'apicot-berry', quantity: 4 },
      { itemId: 'tamato-berry', quantity: 4 },
      { itemId: 'fertiliser-3', quantity: 1 },
      { itemId: 'star-piece', quantity: 12 },
    ],
    goldCost: 100000,
    requiresBuilding: { buildingId: 'lab', level: 4 },
  },
  {
    id: 'craft-golden-razz',
    output: { itemId: 'golden-razz', quantity: 1 },
    inputs: [{ itemId: 'razz-berry', quantity: 6 }, { itemId: 'star-piece', quantity: 1 }],
    goldCost: 200,
  },
  {
    id: 'craft-hyper-potion',
    output: { itemId: 'hyper-potion', quantity: 2 },
    inputs: [{ itemId: 'super-potion', quantity: 3 }, { itemId: 'dew-drop', quantity: 2 }],
    goldCost: 180,
  },
  {
    id: 'craft-exp-candy-l',
    output: { itemId: 'exp-candy-l', quantity: 1 },
    inputs: [{ itemId: 'exp-candy-s', quantity: 6 }, { itemId: 'star-piece', quantity: 2 }],
    goldCost: 500,
    requiresBuilding: { buildingId: 'lab', level: 1 },
  },
  {
    id: 'craft-oran-berries',
    output: { itemId: 'oran-berry', quantity: 10 },
    inputs: [{ itemId: 'silk-thread', quantity: 3 }, { itemId: 'soft-sand', quantity: 3 }],
    goldCost: 60,
    requiresBuilding: { buildingId: 'berry-farm', level: 1 },
  },

  /*
   * Ab hier: Rezepte, die aus dem entstehen, was Erkunden abwirft.
   *
   * Werkstoffe kamen bisher nur von Expeditionen, und die laufen nebenbei.
   * Seit jeder achte Fang einen Werkstoff mitbringt, hat die haeufigste
   * Handlung des Spiels ein Ziel ausserhalb der Box.
   */
  {
    id: 'craft-net-ball',
    output: { itemId: 'net-ball', quantity: 10 },
    batches: BALL_BATCHES,
    inputs: [{ itemId: 'poke-ball', quantity: 10 }, { itemId: 'silk-thread', quantity: 6 }],
    goldCost: 250,
  },
  {
    id: 'craft-dusk-ball',
    output: { itemId: 'dusk-ball', quantity: 10 },
    batches: BALL_BATCHES,
    inputs: [{ itemId: 'poke-ball', quantity: 10 }, { itemId: 'soft-sand', quantity: 6 }],
    goldCost: 250,
  },
  {
    id: 'craft-timer-ball',
    output: { itemId: 'timer-ball', quantity: 10 },
    batches: BALL_BATCHES,
    inputs: [{ itemId: 'great-ball', quantity: 6 }, { itemId: 'iron-shard', quantity: 5 }],
    goldCost: 350,
  },
  {
    id: 'craft-revive',
    output: { itemId: 'revive', quantity: 2 },
    inputs: [{ itemId: 'dew-drop', quantity: 4 }, { itemId: 'soft-sand', quantity: 3 }],
    goldCost: 300,
  },
  {
    id: 'craft-full-restore',
    output: { itemId: 'full-restore', quantity: 1 },
    inputs: [
      { itemId: 'hyper-potion', quantity: 2 },
      { itemId: 'dew-drop', quantity: 3 },
      { itemId: 'star-piece', quantity: 1 },
    ],
    goldCost: 400,
    requiresBuilding: { buildingId: 'lab', level: 1 },
  },
  {
    id: 'craft-energy-drink',
    output: { itemId: 'energy-drink', quantity: 2 },
    inputs: [{ itemId: 'dew-drop', quantity: 5 }, { itemId: 'oran-berry', quantity: 4 }],
    goldCost: 150,
    requiresBuilding: { buildingId: 'rest-house', level: 1 },
  },
  {
    id: 'craft-rare-candy', research: 'res-rare-candy',
    output: { itemId: 'rare-candy', quantity: 1 },
    inputs: [{ itemId: 'exp-candy-l', quantity: 2 }, { itemId: 'star-piece', quantity: 3 }],
    goldCost: 900,
    requiresBuilding: { buildingId: 'lab', level: 3 },
  },
  /*
   * Steine aus Seelenfragmenten.
   *
   * Der Kreis schliesst sich: fangen, verwerten, den Stein bauen, entwickeln.
   * Im Laden kosten sie 1.500 Gold — hier kostet es 500 und acht Fragmente der
   * passenden Sorte, also Arbeit statt Kontostand.
   */
  {
    id: 'craft-fire-stone', research: 'res-stones',
    output: { itemId: 'fire-stone', quantity: 1 },
    inputs: [{ itemId: 'soul-fire', quantity: 8 }, { itemId: 'star-piece', quantity: 2 }],
    goldCost: 500,
    requiresBuilding: { buildingId: 'lab', level: 2 },
  },
  {
    id: 'craft-water-stone', research: 'res-stones',
    output: { itemId: 'water-stone', quantity: 1 },
    inputs: [{ itemId: 'soul-water', quantity: 8 }, { itemId: 'star-piece', quantity: 2 }],
    goldCost: 500,
    requiresBuilding: { buildingId: 'lab', level: 2 },
  },
  {
    id: 'craft-thunder-stone', research: 'res-stones',
    output: { itemId: 'thunder-stone', quantity: 1 },
    inputs: [{ itemId: 'soul-electric', quantity: 8 }, { itemId: 'star-piece', quantity: 2 }],
    goldCost: 500,
    requiresBuilding: { buildingId: 'lab', level: 2 },
  },
  {
    id: 'craft-leaf-stone', research: 'res-stones',
    output: { itemId: 'leaf-stone', quantity: 1 },
    inputs: [{ itemId: 'soul-grass', quantity: 8 }, { itemId: 'star-piece', quantity: 2 }],
    goldCost: 500,
    requiresBuilding: { buildingId: 'lab', level: 2 },
  },
  {
    id: 'craft-moon-stone', research: 'res-stones',
    output: { itemId: 'moon-stone', quantity: 1 },
    inputs: [{ itemId: 'soul-fairy', quantity: 8 }, { itemId: 'star-piece', quantity: 2 }],
    goldCost: 500,
    requiresBuilding: { buildingId: 'lab', level: 2 },
  },
  {
    id: 'craft-sun-stone', research: 'res-stones',
    output: { itemId: 'sun-stone', quantity: 1 },
    inputs: [
      { itemId: 'soul-fire', quantity: 4 },
      { itemId: 'soul-grass', quantity: 4 },
      { itemId: 'star-piece', quantity: 2 },
    ],
    goldCost: 500,
    requiresBuilding: { buildingId: 'lab', level: 2 },
  },
  /*
   * Ab hier: Rezepte, die erst erforscht werden wollen. Sie schliessen
   * Kreislaeufe, statt neue aufzumachen — der Detektor baut sich aus dem
   * Schrott, den er ausgraebt, und Sternenstaub wird aus dem, was sonst
   * liegen bleibt.
   */
  {
    id: 'craft-metal-detector', research: 'res-detector',
    // Fuenf aus eigener Werkstatt: einzeln waere das Rezept nach dem ersten
    // Bauen wieder so muehsam wie der Gang zum Laden.
    output: { itemId: 'metal-detector', quantity: 5 },
    inputs: [{ itemId: 'iron-shard', quantity: 8 }, { itemId: 'soft-sand', quantity: 4 }],
    goldCost: 150,
    requiresBuilding: { buildingId: 'lab', level: 2 },
  },
  {
    id: 'craft-star-piece', research: 'res-star-piece',
    output: { itemId: 'star-piece', quantity: 1 },
    inputs: [
      { itemId: 'dew-drop', quantity: 6 },
      { itemId: 'iron-shard', quantity: 6 },
      { itemId: 'silk-thread', quantity: 6 },
    ],
    goldCost: 700,
    requiresBuilding: { buildingId: 'lab', level: 3 },
  },
  {
    id: 'craft-exp-candy-s', research: 'res-exp-candy',
    output: { itemId: 'exp-candy-s', quantity: 3 },
    inputs: [{ itemId: 'silk-thread', quantity: 4 }, { itemId: 'dew-drop', quantity: 2 }],
    goldCost: 200,
    requiresBuilding: { buildingId: 'lab', level: 1 },
  },
  {
    id: 'craft-rocket-bait', research: 'res-bait',
    output: { itemId: 'rocket-bait', quantity: 1 },
    inputs: [{ itemId: 'star-piece', quantity: 4 }, { itemId: 'iron-shard', quantity: 12 }],
    goldCost: 2500,
    requiresBuilding: { buildingId: 'lab', level: 4 },
  },
]

export const findRecipe = (id: string): Recipe | undefined => RECIPES.find((r) => r.id === id)

export type CraftCheck =
  | { ok: true }
  | { ok: false; reason: 'unknown_recipe' }
  | { ok: false; reason: 'missing_research'; projectId: string; tier: number }
  | { ok: false; reason: 'research_tier'; projectId: string; tier: number; have: number }
  | { ok: false; reason: 'missing_building'; buildingId: string; level: number }
  | { ok: false; reason: 'missing_items'; itemId: string; need: number; have: number }
  | { ok: false; reason: 'insufficient_gold'; need: number }

/** Die Chargen eines Rezepts; ohne eigene ist es genau eine zum Grundpreis. */
export const batchesOf = (recipe: Recipe): RecipeBatch[] =>
  recipe.batches ?? [{ count: recipe.output.quantity, factor: 1 }]

/** Die Charge zu einer Stückzahl. Unbekannte Zahlen gibt es nicht — sonst
 *  könnte der Client sich seinen eigenen Rabatt ausdenken. */
export const findBatch = (recipe: Recipe, count?: number): RecipeBatch | undefined => {
  const list = batchesOf(recipe)
  return count === undefined ? list[0] : list.find((b) => b.count === count)
}

/**
 * Was eine Charge kostet.
 *
 * Aufgerundet, damit der Rabatt nie eine Zutat verschluckt: 3 × 2,25 = 6,75
 * wird zu 7, nicht zu 6.
 */
export function batchCost(recipe: Recipe, batch: RecipeBatch): {
  inputs: Array<{ itemId: string; quantity: number }>; goldCost: number
} {
  return {
    inputs: recipe.inputs.map((i) => ({ itemId: i.itemId, quantity: Math.ceil(i.quantity * batch.factor) })),
    goldCost: Math.ceil(recipe.goldCost * batch.factor),
  }
}

export function canCraft(
  recipe: Recipe,
  bag: Record<string, number>,
  gold: number,
  buildings: Array<{ buildingId: string; level: number }>,
  /** Abgeschlossene Forschung als Projekt -> hoechste erreichte Stufe. Leer heisst: nichts erforscht. */
  researched: ReadonlyMap<string, number> = new Map(),
  /** Welche Menge geprüft wird; ohne Angabe die kleinste. */
  batch: RecipeBatch = batchesOf(recipe)[0]!,
): CraftCheck {
  // Die Forschung steht vor dem Gebaeude: wer das Labor hat, aber die
  // Erkenntnis nicht, soll das auch als Grund genannt bekommen.
  if (recipe.research) {
    const noetig = recipe.researchTier ?? 1
    const haben = researched.get(recipe.research) ?? 0
    // Zwei verschiedene Lagen, zwei verschiedene Saetze: wer nichts erforscht
    // hat, muss ins Labor; wer Stufe 1 hat und Stufe 2 braucht, wuerde sich
    // ueber "Erst erforschen" wundern, weil das Projekt dort abgehakt ist.
    if (haben === 0) {
      return { ok: false, reason: 'missing_research', projectId: recipe.research, tier: noetig }
    }
    if (haben < noetig) {
      return { ok: false, reason: 'research_tier', projectId: recipe.research, tier: noetig, have: haben }
    }
  }
  if (recipe.requiresBuilding) {
    const have = buildings.find((b) => b.buildingId === recipe.requiresBuilding!.buildingId)
    if (!have || have.level < recipe.requiresBuilding.level) {
      return {
        ok: false, reason: 'missing_building',
        buildingId: recipe.requiresBuilding.buildingId,
        level: recipe.requiresBuilding.level,
      }
    }
  }
  const cost = batchCost(recipe, batch)
  for (const input of cost.inputs) {
    const have = bag[input.itemId] ?? 0
    if (have < input.quantity) {
      return { ok: false, reason: 'missing_items', itemId: input.itemId, need: input.quantity, have }
    }
  }
  if (gold < cost.goldCost) return { ok: false, reason: 'insufficient_gold', need: cost.goldCost }
  return { ok: true }
}
