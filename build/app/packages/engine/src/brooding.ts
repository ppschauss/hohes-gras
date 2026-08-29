import { clamp } from './stats.js'

/**
 * Das Brut-Beet.
 *
 * Ein Ei lag bisher da und lief ab. Man konnte nichts tun, und das war der
 * Punkt der Meldung: beim Poké-Beet lohnt sich Vorbeischauen, beim Ei nicht.
 *
 * Jetzt gilt dieselbe Mechanik wie im Beet — vier Pflegeschritte über die
 * Brutzeit, wärmen und wenden im Wechsel —, aber sie zahlt auf drei Dinge
 * gleichzeitig ein und deshalb auf jedes ein Stück schwächer:
 *
 *  - **Zeit:** bis zu einem Viertel schneller. Mehr wäre der dritte Hebel auf
 *    dieselbe Zahl, den die Brutkammer und der Schlupf-Bonus schon bedienen.
 *  - **Werte:** bis zu drei Punkte auf jeden Wert. Spürbar, aber kein Ersatz
 *    für gute Eltern.
 *  - **Schillernd:** die halbe Grundchance obendrauf, also anderthalbfach.
 *
 * Wer stattdessen ein Pokémon danebenlegt, bekommt dasselbe automatisch — ab
 * Level 100 in voller Höhe, darunter anteilig. Wie beim Beet gilt der bessere
 * der beiden Werte und nie die Summe: sonst wäre ein großgezogener Brüter eine
 * Einladung, trotzdem noch viermal zu klicken.
 */

export const BROOD_PHASES = 4

/** Wie viel Brutzeit die volle Pflege spart. */
export const BROOD_TIME_BONUS = 0.25
/** Wie viele Punkte je Wert sie höchstens dazugibt. */
export const BROOD_IV_BONUS = 3
/** Und um welchen Anteil sie die Shiny-Grundchance hebt. */
export const BROOD_SHINY_BONUS = 0.5

/** Ab welchem Level ein Brüter die Handarbeit vollständig ersetzt. */
export const BROODER_FULL_LEVEL = 100

/** Wie viele Pflegeschritte bis jetzt fällig geworden sind. */
export function broodPhasesDue(startedAt: number, now: number, totalMs: number): number {
  if (now <= startedAt || totalMs <= 0) return 0
  return clamp(Math.floor((now - startedAt) / (totalMs / BROOD_PHASES)), 0, BROOD_PHASES)
}

/** Wann der nächste Schritt fällig wird; null, wenn alle durch sind. */
export function nextBroodPhaseAt(startedAt: number, phasesDone: number, totalMs: number): number | null {
  if (phasesDone >= BROOD_PHASES) return null
  return Math.round(startedAt + (totalMs / BROOD_PHASES) * (phasesDone + 1))
}

/** Wärmen und wenden im Wechsel. Reine Farbe, aber sie macht aus vier
 *  gleichen Knöpfen eine Abfolge. */
export const broodPhaseKind = (index: number): 'warm' | 'turn' => (index % 2 === 0 ? 'warm' : 'turn')

/**
 * Wie gut ein Ei versorgt ist, als Anteil von 0 bis 1.
 *
 * Der bessere der beiden Wege zählt, nie die Summe.
 */
export function broodCare(phasesDone: number, brooderLevel: number | null): number {
  const manual = clamp(phasesDone / BROOD_PHASES, 0, 1)
  const auto = brooderLevel === null ? 0 : clamp(brooderLevel / BROODER_FULL_LEVEL, 0, 1)
  return Math.max(manual, auto)
}

/** Wie lange ein Ei mit dieser Pflege noch braucht, in Minuten. */
export const broodMinutes = (baseMinutes: number, care: number): number =>
  Math.max(1, Math.round(baseMinutes * (1 - BROOD_TIME_BONUS * clamp(care, 0, 1))))

/** Wie viele Punkte die Pflege auf jeden Wert legt. */
export const broodIvBonus = (care: number): number =>
  Math.round(BROOD_IV_BONUS * clamp(care, 0, 1))

/**
 * Die zusätzliche Shiny-Chance, die die Pflege bringt.
 *
 * Ein Zuschlag auf die Grundchance und kein zweiter voller Wurf: das Ei hat
 * seinen beim Legen schon hinter sich. Wer gepflegt hat, bekommt hier die
 * Differenz zwischen einfacher und anderthalbfacher Chance nachgereicht.
 */
export const broodShinyExtra = (baseOdds: number, care: number): number =>
  baseOdds * BROOD_SHINY_BONUS * clamp(care, 0, 1)
