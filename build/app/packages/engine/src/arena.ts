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
   * hintereinander mit zehn Prozent Erholung dazwischen sind auch mit
   * schwachen Gegnern eine Wand. Auf „leicht" tritt die Haelfte an.
   */
  foeShare: number
  /** Gold je gewonnenem Kampf. */
  goldPerWin: number
  /** Was ein vollständiger Durchlauf zusätzlich einbringt. */
  bonus: Array<{ itemId: string; quantity: number }>
  bonusGold: number
}

export const ARENA_TIERS: ArenaTier[] = [
  {
    id: 'easy', levelDelta: -5, maxStage: 0, foeIv: 0, foeShare: 0.5, goldPerWin: 60,
    bonusGold: 400, bonus: [{ itemId: 'exp-candy-s', quantity: 2 }],
  },
  {
    id: 'even', levelDelta: -3, maxStage: 1, foeIv: 8, foeShare: 0.75, goldPerWin: 120,
    bonusGold: 900, bonus: [{ itemId: 'exp-candy-l', quantity: 1 }],
  },
  {
    id: 'hard', levelDelta: -1, maxStage: 2, foeIv: 15, foeShare: 1, goldPerWin: 240,
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
 * Wie viel das Team zwischen zwei Kämpfen zurückbekommt.
 *
 * Zuerst standen hier zehn Prozent, und das war zu wenig: mit vier Kämpfen in
 * Folge blieb selbst auf der leichten Stufe kaum jemand übrig. Ein Viertel ist
 * spürbar, reicht aber immer noch nicht, um ohne Gegenstände durchzukommen —
 * der Beutel bleibt Teil der Übung.
 */
export const ARENA_HEAL_PERCENT = 25

/**
 * Der Typ des Tages.
 *
 * Aus dem Datum gerechnet statt gewürfelt: alle Spieler treffen denselben Typ,
 * und wer morgen wiederkommt, kann sich heute darauf vorbereiten.
 */
export function arenaTypeFor(date: string, typeIds: readonly string[]): string | null {
  if (typeIds.length === 0) return null
  const days = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000)
  const index = ((days % typeIds.length) + typeIds.length) % typeIds.length
  return typeIds[index]!
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
