/**
 * Taktkontrolle gegen Automatik-Klicker.
 *
 * Drei Schranken, die verschiedene Dinge treffen:
 *
 *  1. Ein Fenster: hundert Pflegeaktionen in fünfzehn Minuten reichen jedem
 *     Menschen und deckeln, was ein Skript ueber die Zeit herausholt.
 *  2. Ein Mindestabstand: schneller als ein Mensch tippen kann, geht nicht.
 *  3. Der Rhythmus: ein Skript klickt metronomisch, ein Mensch nie. Genau das
 *     ist der Unterschied, den man messen kann — nicht die Geschwindigkeit.
 *
 * Der dritte Punkt ist der eigentliche Schutz. Ein Klicker, der langsam genug
 * eingestellt ist, um die ersten beiden zu unterlaufen, faellt hier auf, weil
 * seine Abstaende zu gleichmaessig sind.
 */

export const CARE_WINDOW_MS = 15 * 60_000
export const CARE_WINDOW_LIMIT = 100

/** Untergrenze zwischen zwei Aktionen. Schnelles menschliches Tippen liegt bei
 *  etwa 200–300 ms; darunter ist es keine Hand mehr. */
export const MIN_GAP_MS = 180

/** So viele Abstaende werden auf Gleichmaessigkeit geprueft. */
export const RHYTHM_SAMPLES = 12
/**
 * Standardabweichung, unter der die Abstaende maschinell wirken.
 *
 * Stand hier zuerst bei 35 ms, mit der Begruendung "menschliches Tippen streut
 * um Dutzende Millisekunden". Das ist am schnellen Ende falsch: wer so schnell
 * tippt, wie es geht, wird *gleichmaessiger*, nicht ungleichmaessiger. Ein
 * echter Spieler wurde damit als Skript eingestuft — gemessen an seinen
 * Daten 218 ms Mittel bei 33,5 ms Streuung, also knapp unter der Schwelle.
 *
 * 15 ms liegt unter allem, was eine Hand erzeugt, und weit ueber dem, was ein
 * Timer erzeugt (der streut praktisch gar nicht). Zusammen mit den zwoelf
 * statt acht Abstaenden braucht es jetzt eine lange, wirklich maschinelle
 * Serie.
 */
export const RHYTHM_MIN_STDDEV_MS = 15
/** Nur schnelle Folgen werden auf Rhythmus geprueft: wer alle zehn Sekunden
 *  einmal tippt, ist auch bei gleichmaessigen Abstaenden kein Skript. */
export const RHYTHM_MAX_MEAN_GAP_MS = 3_000
/** Zwangspause nach einem erkannten Muster. */
export const RHYTHM_PENALTY_MS = 30_000

export interface PacingRules {
  windowMs: number
  limit: number | null
  minGapMs: number
}

export const CARE_PACING: PacingRules = {
  windowMs: CARE_WINDOW_MS,
  limit: CARE_WINDOW_LIMIT,
  minGapMs: MIN_GAP_MS,
}

/**
 * Dieselben Regeln, nur mit groesserem Fenster.
 *
 * Die Pflegestation hebt allein die *Menge*. Mindestabstand und
 * Rhythmuspruefung bleiben, wie sie sind — sonst waere der Ausbau ein
 * kaeuflicher Freibrief fuer Automatik statt Luft fuer jemanden, der viel von
 * Hand spielt.
 */
export function carePacingWith(limitBonus: number): PacingRules {
  return { ...CARE_PACING, limit: CARE_WINDOW_LIMIT + Math.max(0, Math.floor(limitBonus)) }
}

/** Erkunden ist absichtlich unbegrenzt — geschuetzt wird nur gegen Automatik. */
export const EXPLORE_PACING: PacingRules = {
  windowMs: CARE_WINDOW_MS,
  limit: null,
  minGapMs: MIN_GAP_MS,
}

/**
 * Duelle: seltener als Erkunden, und mit spuerbarem Abstand.
 *
 * Gemessen im Protokoll: 258 Duelle in 31 Sekunden, Median 92 ms — acht Stueck
 * je Sekunde. Die Ertraege sind seitdem gedeckelt, die Frequenz war es nicht,
 * und ein Duell ist der teuerste Vorgang im Spiel: es rechnet einen ganzen
 * Kampf durch.
 *
 * Der Mindestabstand lag zuerst bei anderthalb Sekunden und war damit die
 * falsche Schraube. Gemessen im Betrieb: die Rhythmuspruefung hat *einmal*
 * ausgeloest, und zwar bei der Pflege; was bei Duellen wirklich biss, war
 * dieser Abstand. Der kleinste erfolgreiche Abstand zweier Spieler lag bei
 * 1.530 und 1.791 ms — beide standen also staendig an der Wand und bekamen
 * "Immer mit der Ruhe" zu lesen, genau so gemeldet.
 *
 * Sechshundert Millisekunden trennen weiterhin sauber von dem, was den Riegel
 * noetig machte (Median 92 ms, acht Duelle je Sekunde), lassen aber eine Hand
 * in Ruhe. Die eigentliche Menge deckelt ohnehin das Fenster: dreissig je
 * Viertelstunde, und bei drei Energie je Duell reicht ein volles Konto nur
 * fuer fuenfzig.
 */
export const DUEL_PACING: PacingRules = {
  windowMs: CARE_WINDOW_MS,
  limit: 30,
  minGapMs: 600,
}

export type PacingVerdict =
  | { ok: true }
  | { ok: false; reason: 'window'; retryAfterMs: number; limit: number }
  | { ok: false; reason: 'too_fast'; retryAfterMs: number }
  | { ok: false; reason: 'rhythm'; retryAfterMs: number }

/**
 * Darf jetzt geklickt werden?
 *
 * `history` sind die Zeitpunkte der letzten Aktionen im Fenster, aufsteigend.
 * Die Funktion selbst kennt weder Datenbank noch Uhr — dadurch laesst sich
 * jeder Grenzfall als reine Rechnung pruefen.
 */
export function checkPacing(
  history: number[], now: number, rules: PacingRules,
  /**
   * Ende der letzten Zwangspause. Aeltere Abstaende zaehlen fuer die
   * Rhythmusprobe nicht mehr mit.
   *
   * Ohne das ist die angekuendigte Pause eine Falschaussage: ein abgewiesener
   * Versuch wird nicht mitgeschrieben, also sieht die Probe nach dreissig
   * Sekunden dieselben zwoelf Abstaende wie vorher und weist wieder ab — und
   * wieder, bis die Zeitpunkte nach einer Viertelstunde aus dem Fenster
   * fallen. Angekuendigt waren dreissig Sekunden, gedauert hat es fuenfzehn
   * Minuten.
   */
  rhythmSince = 0,
): PacingVerdict {
  const recent = history.filter((t) => t > now - rules.windowMs).sort((a, b) => a - b)

  if (rules.limit !== null && recent.length >= rules.limit) {
    // Der aelteste Eintrag, der noch zaehlt, gibt den Zeitpunkt vor, an dem
    // wieder ein Platz frei wird.
    const oldest = recent[recent.length - rules.limit]!
    return {
      ok: false,
      reason: 'window',
      retryAfterMs: Math.max(0, oldest + rules.windowMs - now),
      limit: rules.limit,
    }
  }

  const last = recent[recent.length - 1]
  if (last !== undefined && now - last < rules.minGapMs) {
    return { ok: false, reason: 'too_fast', retryAfterMs: rules.minGapMs - (now - last) }
  }

  if (looksAutomated(recent.filter((t) => t > rhythmSince))) {
    return { ok: false, reason: 'rhythm', retryAfterMs: RHYTHM_PENALTY_MS }
  }

  return { ok: true }
}

/** Gleichmaessige Abstaende in schneller Folge: das Muster eines Skripts. */
export function looksAutomated(timestamps: number[]): boolean {
  if (timestamps.length < RHYTHM_SAMPLES + 1) return false
  const tail = timestamps.slice(-(RHYTHM_SAMPLES + 1))
  const gaps: number[] = []
  for (let i = 1; i < tail.length; i++) gaps.push(tail[i]! - tail[i - 1]!)

  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
  if (mean > RHYTHM_MAX_MEAN_GAP_MS) return false

  const variance = gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length
  return Math.sqrt(variance) < RHYTHM_MIN_STDDEV_MS
}
