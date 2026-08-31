/**
 * Garden buildings.
 *
 * Passive upgrades a player invests in once and benefits from forever. They are
 * the answer to "what do I spend gold on at level 60", and each one makes an
 * existing system a little kinder rather than adding a new one to learn.
 */
export interface BuildingSpec {
  id: string
  maxLevel: number
  /** Cost of raising it from `level` to `level + 1`. */
  cost: (level: number) => number
  /** What the building does, evaluated at a given level. */
  effect: (level: number) => number
  effectKind:
    | 'careXpBonus'        // Prozent zusaetzliche EP je Pflegeaktion
    | 'hatchSpeedBonus'    // Prozent schnelleres Bruetgen
    | 'expeditionLootBonus'// Prozent mehr Beute
    | 'catchRateBonus'     // Prozent bessere Fangchance
    | 'energyRegenBonus'   // Prozent schnellere Energieerholung
    | 'energyCapBonus'     // hoehere Obergrenze der Trainer-Energie
    | 'careLimitBonus'     // zusaetzliche Pflegeaktionen je Viertelstunde
    | 'centerSpeedBonus'   // Stufen, um die die Abklingzeit des Centers sinkt
    | 'boxSlotBonus'       // zusaetzliche Plaetze in der Box
    | 'eggSlotBonus'       // zusaetzliche Brutplaetze
    | 'expeditionSlotBonus'// zusaetzliche gleichzeitige Expeditionen
}

/**
 * Was die Box ohne jeden Ausbau fasst.
 *
 * Verdreifacht von 300, weil aus einer Region drei geworden sind: wer Kanto,
 * Johto und Hoenn bereist, sammelt dreimal so viele Arten und stand sonst nach
 * der ersten Region vor einer vollen Box.
 */
export const BOX_BASE_LIMIT = 900

export const BUILDINGS: BuildingSpec[] = [
  {
    id: 'dojo', maxLevel: 5, effectKind: 'careXpBonus',
    cost: (level) => 1500 * level ** 2,
    effect: (level) => level * 8,
  },
  {
    id: 'hatchery', maxLevel: 5, effectKind: 'hatchSpeedBonus',
    cost: (level) => 1200 * level ** 2,
    effect: (level) => level * 10,
  },
  {
    id: 'berry-farm', maxLevel: 5, effectKind: 'expeditionLootBonus',
    cost: (level) => 1800 * level ** 2,
    effect: (level) => level * 9,
  },
  {
    id: 'lab', maxLevel: 5, effectKind: 'catchRateBonus',
    cost: (level) => 2400 * level ** 2,
    effect: (level) => level * 5,
  },
  {
    id: 'rest-house', maxLevel: 5, effectKind: 'energyRegenBonus',
    cost: (level) => 1000 * level ** 2,
    effect: (level) => level * 15,
  },
  {
    /*
     * Pflegestation: mehr Pflegeaktionen je Viertelstunde.
     *
     * Das Fenster von hundert Aktionen ist kein Balancewert, sondern eine
     * Schranke gegen Automatik — und wer viel von Hand spielt, stiess daran,
     * ohne je etwas automatisiert zu haben. Der Ausbau hebt genau diese
     * Schranke, nicht den Ertrag: der Rhythmuswaechter und der Mindestabstand
     * bleiben unangetastet, ein Skript gewinnt hier also nichts.
     *
     * Gestaffelt in Fuenfziger-Schritten: +50 je Stufe bis 350 auf Stufe 5.
     */
    id: 'care-station', maxLevel: 5, effectKind: 'careLimitBonus',
    cost: (level) => 2000 * level ** 2,
    effect: (level) => level * 50,
  },
  {
    /*
     * Schwesternstation: kuerzere Abklingzeit im Poke-Center.
     *
     * Bewusst der billigste Ausbau im Spiel. Das Center heilt, und Heilen ist
     * Voraussetzung fuers Spielen, keine Belohnung — wer darauf wartet, spielt
     * nicht. Vier Stufen zu je 90 Sekunden fuehren von zehn auf vier Minuten.
     */
    id: 'nurse-station', maxLevel: 4, effectKind: 'centerSpeedBonus',
    cost: (level) => 600 * level ** 2,
    effect: (level) => level,
  },
  {
    /*
     * Depot: mehr Platz in der Box.
     *
     * Der einzige Ausbau mit gleichbleibendem Preis. Die anderen wachsen
     * quadratisch, weil ihre Wirkung sich auf alles Kommende legt — Platz
     * dagegen ist eine Ware: fuenfzig Plaetze sind fuenfzig Plaetze, egal ob
     * es die ersten oder die letzten sind. 5.000 Gold je Stufe, 25 Stufen,
     * am Ende 1.250 zusaetzliche Plaetze.
     */
    id: 'storage', maxLevel: 25, effectKind: 'boxSlotBonus',
    cost: () => 5000,
    effect: (level) => level * 50,
  },
  {
    /*
     * Das Expeditionsbuero.
     *
     * Gleichzeitige Expeditionen waren unbegrenzt — die einzige Schranke war
     * die Zahl der eigenen Pokemon. Wer zweihundert hatte, schickte zwanzig
     * Trupps gleichzeitig los und flutete die Werkbank im Alleingang; im
     * Spielstand nachgezaehlt standen 20 offene gegen 4 und 2 bei den anderen.
     *
     * Drei sind der Grundstock, sechs Stufen heben ihn auf neun. Neun ist die
     * Grenze, weil ein Trupp bis zu sechs Pokemon bindet: darueber hinaus ist
     * nicht mehr die Zahl der Plaetze der Engpass, sondern die Box.
     */
    id: 'expedition-office', maxLevel: 6, effectKind: 'expeditionSlotBonus',
    cost: (level) => 3000 * level ** 2,
    effect: (level) => level,
  },
  {
    /*
     * Brutkammer: ein Brutplatz mehr je Stufe.
     *
     * Drei offene Eier sind der Grundstock, und wer viel verwertet, steht
     * schnell davor. Anders als beim Depot waechst der Preis quadratisch: ein
     * Platz mehr heisst nicht nur mehr Ablage, sondern eine weitere Brut, die
     * *gleichzeitig* laeuft — die Wirkung legt sich auf alles Kommende.
     */
    id: 'hatch-chamber', maxLevel: 5, effectKind: 'eggSlotBonus',
    cost: (level) => 2500 * level ** 2,
    effect: (level) => level,
  },
  {
    id: 'greenhouse', maxLevel: 3, effectKind: 'energyCapBonus',
    // Der teuerste Ausbau im Spiel: ein groesseres Energiekonto wirkt auf
    // jedes andere System gleichzeitig.
    cost: (level) => 6000 * level ** 2,
    effect: (level) => level * 20,
  },
]

export const findBuilding = (id: string): BuildingSpec | undefined => BUILDINGS.find((b) => b.id === id)

export interface OwnedBuilding { buildingId: string; level: number }

/** Total value of one effect across everything the player has built. */
export function bonusOf(owned: OwnedBuilding[], kind: BuildingSpec['effectKind']): number {
  return owned.reduce((sum, b) => {
    const spec = findBuilding(b.buildingId)
    if (!spec || spec.effectKind !== kind) return sum
    return sum + spec.effect(Math.min(b.level, spec.maxLevel))
  }, 0)
}

export function upgradeCost(buildingId: string, currentLevel: number): number | null {
  const spec = findBuilding(buildingId)
  if (!spec) return null
  if (currentLevel >= spec.maxLevel) return null
  return spec.cost(currentLevel + 1)
}
