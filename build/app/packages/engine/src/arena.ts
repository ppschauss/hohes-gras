/**
 * Trainingsarena.
 *
 * Vier Kämpfe in Folge gegen Gegner eines einzigen Typs, der jeden Tag
 * wechselt. Anders als die Wildnis wartet sie nicht auf Zufall: man weiß
 * vorher, was kommt, und stellt sein Team danach auf. Genau das ist der Sinn —
 * ein Ort, an dem man die Aufstellung übt, statt Glück zu haben.
 *
 * Die drei Stufen unterscheiden sich nur im Levelabstand zum eigenen
 * Durchschnitt: fünf darunter, drei darunter, eins darunter. Das ist bewusst
 * relativ: eine feste Zahl wäre für den einen ein Spaziergang und für den
 * anderen eine Wand, und die Arena soll für jeden dasselbe bedeuten.
 */

export interface ArenaTier {
  id: 'easy' | 'even' | 'hard'
  /** Abstand zum eigenen Durchschnittslevel. */
  levelDelta: number
  /**
   * Wie weit entwickelt die Gegner sein dürfen: 0 = nur Grundformen.
   *
   * Das Level allein sagt wenig. Ein Ibitak auf Level 3 schlägt härter als ein
   * Taubsi auf Level 8, weil die Grundwerte den Unterschied machen — genau so
   * wurde es gemeldet. Die Stufe begrenzt deshalb auch die Entwicklungsstufe.
   */
  maxStage: number
  /**
   * Werte der Gegner, 0 bis 31.
   *
   * Unter dem Durchschnitt eines Spielerpokémon (etwa 15), damit die Arena
   * das Üben belohnt und nicht die Statistik.
   */
  foeIv: number
  /**
   * Wie viele Gegner antreten, gemessen am eigenen Team.
   *
   * Der wirksamste Hebel und der, der zuerst gefehlt hat: vier volle Teams
   * hintereinander sind auch mit schwachen Gegnern eine Wand. Gerechnet wird
   * nicht je Kampf, sondern je Durchlauf: bei fünf eigenen Mitgliedern waren
   * das sechzehn Gegner am Stück — genau so wurde es gemeldet („12 oder 16
   * Pokémon besiegt und noch welche vor mir"). Mit 0,4 sind es acht, mit 0,6
   * zwölf, und „schwer" bleibt die volle Wand.
   */
  foeShare: number
  /**
   * Obergrenze der Grundwertsumme; 0 heißt: keine.
   *
   * Die Entwicklungsstufe allein reicht nicht. Tauros und Kangama sind
   * Grundformen und trotzdem stark — auf „leicht" standen sie neben einem
   * Hoothoot, und der Unterschied war größer als die fünf Level Abstand.
   */
  maxBst: number
  /**
   * Faktor auf die Erfahrung.
   *
   * Gemessen: ein Durchlauf brachte gut ein halbes Level je Mitglied — für
   * acht Energie und vier Kämpfe der falsche Tausch, zumal die Arena der Ort
   * zum Trainieren *ist*. Mit dem Faktor ist ein Durchlauf etwa ein Level, auf
   * „schwer" anderthalb.
   */
  xpMultiplier: number
  /** Gold je gewonnenem Kampf. */
  goldPerWin: number
  /** Was ein vollständiger Durchlauf zusätzlich einbringt. */
  bonus: Array<{ itemId: string; quantity: number }>
  bonusGold: number
}

export const ARENA_TIERS: ArenaTier[] = [
  {
    id: 'easy', levelDelta: -5, maxStage: 0, maxBst: 330, foeIv: 0, foeShare: 0.4,
    xpMultiplier: 1.5, goldPerWin: 60,
    bonusGold: 400, bonus: [{ itemId: 'exp-candy-s', quantity: 2 }],
  },
  {
    id: 'even', levelDelta: -3, maxStage: 1, maxBst: 430, foeIv: 8, foeShare: 0.6,
    xpMultiplier: 2, goldPerWin: 120,
    bonusGold: 900, bonus: [{ itemId: 'exp-candy-l', quantity: 1 }],
  },
  {
    id: 'hard', levelDelta: -1, maxStage: 2, maxBst: 0, foeIv: 15, foeShare: 1,
    xpMultiplier: 3, goldPerWin: 240,
    bonusGold: 1800, bonus: [
      { itemId: 'exp-candy-l', quantity: 1 },
      { itemId: 'star-piece', quantity: 2 },
    ],
  },
]

export const findArenaTier = (id: string): ArenaTier | undefined => ARENA_TIERS.find((t) => t.id === id)

/** Wie viele Kämpfe ein Durchlauf hat. */
export const ARENA_ROUNDS = 4

/**
 * Was ein weiterer Durchlauf am selben Tag noch einbringt.
 *
 * Vorher: nichts. Die Prämie fiel einmal am Tag je Stufe, danach blieb nur das
 * Gold je Sieg — und das fühlte sich an wie eine Sackgasse, genau so gemeldet.
 *
 * Ein Viertel ist dieselbe Größenordnung, die Routentrainer für den zweiten
 * Anlauf bekommen (`repeatRewardRatio`). Die Arena bleibt damit einmal am Tag
 * klar am besten — sie hört nur auf, den zweiten Besuch zu bestrafen.
 */
export const ARENA_REPEAT_RATIO = 0.25

/**
 * Wie viel das Team zwischen zwei Kämpfen zurückbekommt.
 *
 * Zuerst standen hier zehn Prozent, und das war zu wenig: mit vier Kämpfen in
 * Folge blieb selbst auf der leichten Stufe kaum jemand übrig. Ein Viertel ist
 * spürbar, reicht aber immer noch nicht, um ohne Gegenstände durchzukommen —
 * der Beutel bleibt Teil der Übung.
 */
export const ARENA_HEAL_PERCENT = 25

/**
 * Wie viele Typen am selben Tag offenstehen.
 *
 * Drei. Einer war zu wenig: wer gegen den Typ des Tages kein passendes Team
 * hat, konnte die Arena schlicht nicht sinnvoll spielen und musste bis morgen
 * warten. Drei geben eine Wahl, ohne dass die Vorbereitung sinnlos wird — mit
 * allen achtzehn wäre der „Typ des Tages" keiner mehr.
 */
export const ARENA_TYPES_PER_DAY = 3

/**
 * Die Typen des Tages.
 *
 * Aus dem Datum gerechnet statt gewürfelt: alle Spieler treffen dieselben, und
 * wer morgen wiederkommt, kann sich heute darauf vorbereiten.
 *
 * Die drei liegen weit auseinander (Schrittweite `⌊n/3⌋`, ungerade gemacht),
 * damit nicht drei benachbarte Typen erscheinen — sonst wäre die Wahl keine.
 */
export function arenaTypesFor(date: string, typeIds: readonly string[]): string[] {
  if (typeIds.length === 0) return []
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000)
  const n = typeIds.length
  const start = ((days % n) + n) % n
  const wie_viele = Math.min(ARENA_TYPES_PER_DAY, n)

  // Eine Schrittweite, die teilerfremd zu n ist, trifft nie zweimal denselben.
  let schritt = Math.max(1, Math.floor(n / wie_viele))
  while (schritt > 1 && n % schritt === 0) schritt--

  const out: string[] = []
  for (let i = 0; i < wie_viele; i++) {
    const id = typeIds[(start + i * schritt) % n]!
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/** Der erste Typ des Tages. Bleibt für alles, was genau einen erwartet. */
export function arenaTypeFor(date: string, typeIds: readonly string[]): string | null {
  return arenaTypesFor(date, typeIds)[0] ?? null
}

/**
 * Das Level der Gegner in dieser Runde.
 *
 * Innerhalb eines Durchlaufs steigt es leicht an — der vierte Gegner steht
 * eine Stufe über dem ersten —, damit die Reihe eine Steigerung hat und nicht
 * viermal dasselbe ist.
 */
export function arenaLevel(averageLevel: number, tier: ArenaTier, round: number, cap: number): number {
  const base = Math.round(averageLevel) + tier.levelDelta
  const step = Math.max(0, Math.min(ARENA_ROUNDS - 1, round - 1))
  return Math.max(2, Math.min(cap, base + step))
}
