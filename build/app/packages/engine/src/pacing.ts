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
export const RHYTHM_SAMPLES = 8
/** Standardabweichung, unter der die Abstaende maschinell wirken. Menschliches
 *  Tippen streut um Dutzende Millisekunden, selbst bei voller Konzentration. */
export const RHYTHM_MIN_STDDEV_MS = 35
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

/** Erkunden ist absichtlich unbegrenzt — geschuetzt wird nur gegen Automatik. */
export const EXPLORE_PACING: PacingRules = {
  windowMs: CARE_WINDOW_MS,
  limit: null,
  minGapMs: MIN_GAP_MS,
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
export function checkPacing(history: number[], now: number, rules: PacingRules): PacingVerdict {
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

  if (looksAutomated(recent)) {
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
