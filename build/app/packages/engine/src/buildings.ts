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
}

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
