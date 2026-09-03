import { clamp } from './stats.js'

/**
 * Poké-Beet.
 *
 * Man vergräbt etwas — Beeren, Bonbons, Material oder Gold — und bekommt nach
 * der Wachstumszeit mehr zurück. Wie viel mehr, entscheidet die Pflege:
 *
 *  - **gar nichts tun:** 50 %. Das Beet wächst auch allein.
 *  - **selbst pflegen:** bis 100 %. Über die Wachstumszeit werden vier
 *    Pflegeschritte fällig (jäten, wässern, jäten, wässern); jeder erledigte
 *    Schritt hebt den Ertrag.
 *  - **ein Pflanzen-Pokémon abstellen:** 50 % plus ein halbes Prozent je Level.
 *    Auf Level 100 ist es damit genauso gut wie Handarbeit — und man muss
 *    nicht vorbeischauen. Das ist der Lohn dafür, eines großgezogen zu haben.
 *
 * Wer beides macht, bekommt den besseren der beiden Werte, nie die Summe:
 * sonst wäre ein hochgezogenes Pflanzen-Pokémon eine Einladung, trotzdem noch
 * viermal zu klicken.
 */

export const PLOT_COUNT = 4
export const PLOT_GROWTH_MS = 4 * 3_600_000
export const PLOT_PHASES = 4

/** Obergrenze für Gegenstände je Beet. */
/*
 * Wie viel in ein Beet passt.
 *
 * Die Zahl ist zweimal gewachsen, und beide Male aus demselben Grund: was
 * darueber haengt, wurde groesser. Dreissig galt, als nur Fangbeeren in der
 * Erde lagen; vierzig, als die Pharmazie dazukam. Hundert gilt jetzt, weil
 * die Kette zum Kronkorken sechs Beerensorten nebeneinander verlangt und ein
 * Beet je Sorte eine ganze Runde tragen soll — nicht nur einen Ansatz.
 *
 * Das ist die Absicht hinter allen drei Zahlen: die Kette soll an
 * Sternenstaub und Zeit haengen, nicht daran, dass der Acker zu klein ist.
 * Nach oben bleibt sie trotzdem begrenzt — ein Beet ist ein Beet, kein Lager.
 */
export const PLOT_MAX_ITEMS = 100

/**
 * Gold ist gedeckelt — und zwar zweifach.
 *
 * Der Ertrag ist ein Vielfaches des Einsatzes. Ohne Grenze waere das Beet die
 * einzige Einnahmequelle, die noch zaehlt, und jede andere Beschaeftigung im
 * Spiel waere daneben Zeitverschwendung. Die Tagessperre bleibt deshalb
 * bestehen: einmal je 24 Stunden, mehr nicht.
 *
 * 500 stand hier und ergab hoechstens 500 Gold Gewinn am Tag — neben einem
 * Ligatag mit ueber siebzehntausend war das keine Entscheidung, sondern eine
 * Randnotiz. 3333 macht daraus eine: von Hand gepflegt sind es 3333 Gewinn,
 * mit Pfleger und Duenger III bis zu 9166. Der obere Wert kostet allerdings
 * einen Duenger III, der dann keiner Beere zugutekommt — und genau das soll
 * die Ueberlegung sein, die man vor dem Vergraben anstellt.
 */
export const PLOT_MAX_GOLD = 3333
export const GOLD_PLANT_COOLDOWN_MS = 24 * 3_600_000

/** Wann wieder Gold vergraben werden darf. `null` heißt: sofort. */
export function goldPlantReadyAt(lastPlantedAt: number | null): number | null {
  return lastPlantedAt === null ? null : lastPlantedAt + GOLD_PLANT_COOLDOWN_MS
}

export function goldPlantReady(lastPlantedAt: number | null, now: number): boolean {
  const readyAt = goldPlantReadyAt(lastPlantedAt)
  return readyAt === null || now >= readyAt
}

/** Grundertrag ohne jede Pflege, in Prozent Aufschlag. */
export const PLOT_BASE_BONUS = 50
/** Was volle Handpflege obendrauf legt. */
export const PLOT_MANUAL_BONUS = 50
/** Prozentpunkte je Level des abgestellten Pflanzen-Pokémon. */
export const TENDER_LEVEL_FACTOR = 0.5

/**
 * Was sich vergraben laesst. Ein Pokeball keimt nicht.
 *
 * Nur noch Beeren — und Gold, das einen eigenen Weg hat. Erfahrungsbonbons
 * und Werkstoffe standen hier, weil "alles, was klein ist" die bequeme Regel
 * war; ein Beet, aus dem Eisensplitter wachsen, erklaert sich aber niemandem.
 * Beeren wachsen, alles andere wird gefunden oder gebaut.
 */
export const PLANTABLE_CATEGORIES = ['berry'] as const

/**
 * Die eine Beere, die nicht waechst.
 *
 * Sagenbeeren fallen bei Ueberfaellen und sind der einzige Hebel gegen ein
 * Legendaeres. Waeren sie anbaubar, waere der Hebel eine Frage der Geduld.
 */
export const UNPLANTABLE_ITEMS = new Set(['legendary-berry'])

/**
 * Duenger: drei Stufen, zwei Wirkungen.
 *
 * Er verkuerzt die Wachszeit **und** hebt den Ertrag, jeweils um denselben
 * Anteil. Das ist Absicht: eine Stufe, die nur schneller macht, ist bei einem
 * Beet mit vier Stunden Laufzeit kaum spuerbar, und eine, die nur mehr bringt,
 * laedt zum Liegenlassen ein. Zusammen belohnen sie das Bewirtschaften.
 *
 * Die Zeit wird geteilt, nicht abgezogen: 100 % heisst halb so lang, 200 %
 * heisst ein Drittel. Sonst waere Stufe III bei 200 % eine Ernte in null
 * Sekunden.
 */
export const FERTILISER_LEVELS = [
  { itemId: 'fertiliser-1', level: 1, percent: 50 },
  { itemId: 'fertiliser-2', level: 2, percent: 100 },
  { itemId: 'fertiliser-3', level: 3, percent: 200 },
] as const

export type FertiliserLevel = (typeof FERTILISER_LEVELS)[number]

export const fertiliserOf = (itemId: string | null): FertiliserLevel | null =>
  FERTILISER_LEVELS.find((f) => f.itemId === itemId) ?? null

/** Wie lange ein geduengtes Beet braucht. */
export function fertilisedGrowthMs(percent: number, base = PLOT_GROWTH_MS): number {
  return Math.max(60_000, Math.round(base / (1 + Math.max(0, percent) / 100)))
}

/** Wie viele Pflegeschritte bis jetzt fällig geworden sind. */
export function phasesDue(plantedAt: number, now: number, growthMs = PLOT_GROWTH_MS, phases = PLOT_PHASES): number {
  if (now <= plantedAt) return 0
  const perPhase = growthMs / phases
  return clamp(Math.floor((now - plantedAt) / perPhase), 0, phases)
}

/** Wann der nächste Schritt fällig wird; null, wenn alle durch sind. */
export function nextPhaseAt(
  plantedAt: number, phasesDone: number, growthMs = PLOT_GROWTH_MS, phases = PLOT_PHASES,
): number | null {
  if (phasesDone >= phases) return null
  return Math.round(plantedAt + (growthMs / phases) * (phasesDone + 1))
}

/** Jäten und wässern im Wechsel — reine Farbe, aber sie macht aus vier
 *  gleichen Knöpfen eine Abfolge. */
export const phaseKind = (index: number): 'weed' | 'water' => (index % 2 === 0 ? 'weed' : 'water')

export function manualBonus(phasesDone: number, phases = PLOT_PHASES): number {
  const share = phases <= 0 ? 0 : clamp(phasesDone / phases, 0, 1)
  return PLOT_BASE_BONUS + Math.round(PLOT_MANUAL_BONUS * share)
}

export function tenderBonus(level: number): number {
  return clamp(Math.round(PLOT_BASE_BONUS + level * TENDER_LEVEL_FACTOR), PLOT_BASE_BONUS, 100)
}

/**
 * Der Aufschlag in Prozent, den ein Beet gerade erreicht.
 *
 * Pflege und Pfleger schliessen einander aus — es gilt der bessere von beiden.
 * Der Duenger kommt obendrauf: er ersetzt keine Pflege, er lohnt sie.
 */
export function plotBonus(input: {
  phasesDone: number
  phases?: number
  tenderLevel: number | null
  fertiliserPercent?: number
}): number {
  const manual = manualBonus(input.phasesDone, input.phases ?? PLOT_PHASES)
  const tended = input.tenderLevel === null ? 0 : tenderBonus(input.tenderLevel)
  return Math.max(manual, tended) + Math.max(0, input.fertiliserPercent ?? 0)
}

/** Was am Ende herauskommt. Immer mindestens der Einsatz. */
export function harvestAmount(stake: number, bonusPercent: number): number {
  return Math.max(stake, Math.round(stake * (1 + bonusPercent / 100)))
}

export const plotReady = (plantedAt: number, now: number, growthMs = PLOT_GROWTH_MS): boolean =>
  now >= plantedAt + growthMs
