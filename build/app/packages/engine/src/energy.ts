import { clamp } from './stats.js'

/**
 * Trainer-Energie.
 *
 * Die eine Ressource, die fast jede Aktion kostet. Sie ersetzt die frueheren
 * Tageslimits: statt "zwoelf Pflegeaktionen, dann ist Schluss bis morgen"
 * entscheidet der Spieler selbst, wofuer er sein Budget ausgibt — und kann es
 * jederzeit mit Gold oder durch Spielerfolge aufstocken.
 *
 * Wichtig: das ist NICHT die Ausdauer einer einzelnen Kreatur (`creature.energy`,
 * im UI "Ausdauer"). Die bleibt, weil sie eine andere Frage beantwortet: wen
 * schicke ich los. Diese hier beantwortet: wie oft.
 */

/** Bis hierher fuellt sich die Energie von selbst wieder auf. */
export const ENERGY_BASE_CAP = 150
/** Belohnungen und Kaeufe duerfen darueber hinaus anhaeufen, aber nicht endlos. */
export const ENERGY_HARD_CAP = 9999

/**
 * Ab hier wird Energie zu Gold.
 *
 * Bis hierher stapelte sie sich bis 9.999 und war darueber schlicht weg: ein
 * Spieler hat fuer 170.000 Gold Energie gekauft, von der ueber die Haelfte im
 * Moment der Gutschrift verschwand, ohne dass irgendwo etwas davon stand. Was
 * ueber diese Grenze hinausgeht, wird jetzt eins zu eins in Gold verwandelt —
 * ein schlechter Kurs gemessen am Kaufpreis, aber ein Kurs statt eines Lochs.
 *
 * Tausend ist mit Abstand mehr, als je jemand halten muss: die groesste
 * persoenliche Obergrenze liegt bei 150 + 12 x 25 + Gewaechshaus, also unter
 * 520. Was darueber liegt, ist Vorrat fuer mehrere Tage — und ab hier eben
 * Gold.
 */
export const ENERGY_TO_GOLD_LIMIT = 1000
/** Wie viel Gold ein ueberzaehliger Energiepunkt bringt. */
export const ENERGY_TO_GOLD_RATE = 1

/**
 * Wie viele Entwicklungen am Tag Energie einbringen.
 *
 * Im Code stand einmal, eine Entwicklung sei "eine ehrliche Energiequelle: sie
 * laesst sich nicht farmen". Das stimmte nur, solange Entwicklungen selten
 * waren. Mit Eiern, Bonbons und einer vollen Box entwickelt man zwanzig Stueck
 * am Stueck — und jede gab fuenfzehn Punkte. Ab der elften gibt es am selben
 * Tag keine Energie mehr; die Entwicklung selbst bleibt natuerlich erlaubt.
 */
export const EVOLUTION_ENERGY_PER_DAY = 10
/**
 * Wie lange ein leeres Konto braucht, bis es wieder voll ist.
 *
 * Die Regeneration haengt an dieser Zeit, nicht an einer festen Punktzahl je
 * Stunde. Zwei Gruende: die Zahl, die den Spieler interessiert, ist "in gut
 * einer Stunde bin ich wieder da" — und ein groesserer Vorrat fuellt sich
 * dadurch automatisch schneller, statt sich mit jedem Ausbau laenger zu ziehen.
 *
 * 75 Minuten auf den Grundvorrat von 150 sind glatt zwei Punkte je Minute.
 */
export const ENERGY_FILL_MINUTES = 75

/** Regeneration pro Stunde fuer einen gegebenen Vorrat. */
export const energyPerHour = (cap: number = ENERGY_BASE_CAP): number =>
  Math.max(1, Math.ceil((cap * 60) / ENERGY_FILL_MINUTES))

/** Grundwert ohne Ausbauten — 120 Punkte je Stunde, also zwei je Minute. */
export const ENERGY_PER_HOUR = Math.max(1, Math.ceil((ENERGY_BASE_CAP * 60) / ENERGY_FILL_MINUTES))

/* ------------------------------------------------------- Vorrat vergroessern */

/** Wie viel ein gekaufter Ausbau dem Vorrat hinzufuegt. */
export const ENERGY_CAP_STEP = 25
/** So oft laesst er sich kaufen. */
export const ENERGY_CAP_MAX_STEPS = 12

/**
 * Preis des naechsten Ausbaus.
 *
 * Linear steigend: der erste kostet 2.000, der zwoelfte 24.000. Zusammen rund
 * 156.000 Gold — genug, um ueber Monate ein Ziel zu sein, ohne je unerreichbar
 * zu wirken.
 */
export function energyCapPrice(stepsBought: number): number | null {
  if (stepsBought >= ENERGY_CAP_MAX_STEPS) return null
  return 2_000 * (stepsBought + 1)
}

export type EnergyAction =
  | 'care' | 'explore' | 'expedition' | 'battle' | 'duel' | 'raid'
  /* Nur fuers Abbrechen: Anfangen kostet Material und Gold, nicht Energie. */
  | 'research' | 'boarding'
  /* Der ganze Arenadurchlauf auf einmal. */
  | 'arena'

/**
 * Was eine Aktion kostet.
 *
 * Bewusst klein gehalten: ein volles Konto traegt 150 Begegnungen, und ueber
 * einen Tag verteilt kommen noch einmal 360 nach. Das Konto soll ein Rhythmus
 * sein, keine Sperre — wer trotzdem an die Grenze stoesst, kauft fuer 10 Gold
 * je Punkt nach, ein Bruchteil dessen, was eine Expedition einbringt.
 */
export const ENERGY_COSTS: Record<EnergyAction, number> = {
  care: 1,
  explore: 1,
  expedition: 3,
  battle: 2,
  duel: 3,
  raid: 2,
  /*
   * Abbruchgebuehren.
   *
   * Ohne Preis waere das Abbrechen die beste Art, einen Laborplatz oder eine
   * Pension zu verwalten: anfangen, umentscheiden, kostenlos zurueck. Mit
   * Preis ist es eine Entscheidung.
   */
  research: 2,
  boarding: 4,
  /*
   * Ein Arenadurchlauf kostet einmal, nicht viermal.
   *
   * Vorher zahlte jeder der vier Kaempfe seine zwei Energie einzeln — acht im
   * Ganzen, und wer mit sechs anfing, stand nach dem dritten Kampf vor einem
   * Durchlauf, den er nicht zu Ende bringen konnte. Das ist die eigentliche
   * Aenderung: die Rechnung faellt vorne an, damit sie nie mittendrin
   * scheitert. Sechs statt acht ist der kleine Nachlass dafuer, dass man sich
   * im Voraus festlegt.
   */
  arena: 6,
}

/**
 * Was eine Stunde Energie mindestens wert ist, in Gold.
 *
 * Aus diesem Wert wird das Antrittsgeld gerechnet: der Betrag, den ein Kampf
 * abwirft, wenn die eigentliche Belohnung fuer heute schon abgeholt ist. Er
 * liegt bewusst am unteren Ende der Wirtschaft — ein erster Arenadurchlauf
 * bringt je Energie das Achtfache, ein erster Sieg ueber einen Trainer ein
 * Vielfaches davon. So bleibt jeder Kampf etwas wert, ohne dass Wiederholen
 * je die beste Art wird, an Gold zu kommen.
 *
 * Vorher gab es fuer den zweiten Kampf am selben Tag exakt nichts, und das
 * fuehlte sich falsch an: gekaempft hat man trotzdem.
 */
export const GOLD_PER_ENERGY_FLOOR = 10

/** Expeditionen skalieren mit der Dauer: acht Stunden Ertrag kosten mehr als
 *  eine halbe Stunde. */
export const EXPEDITION_ENERGY: Record<string, number> = {
  short: 2,
  medium: 4,
  long: 6,
}

export type EnergySource =
  | 'evolution' | 'badge' | 'battleWon' | 'areaCompleted' | 'raidVictory' | 'duelWon'

/** Wofuer es Energie zurueckgibt. Alles hier ist ein Fortschritt, den man nicht
 *  beliebig oft wiederholen kann — sonst waere die Ressource wertlos. */
/*
 * Was das Spiel an Energie zurueckgibt.
 *
 * Zwei Zahlen darin sind bewusst kleiner als ihre Kosten: ein Duell kostet 3
 * und zahlt 2, ein Kampf kostet 2 und zahlt nur beim ersten Sieg ueber einen
 * Gegner. Beides war vorher ein Plusgeschaeft und damit eine Maschine, die
 * Energie druckt, statt sie zu einer Entscheidung zu machen.
 */
export const ENERGY_REWARDS: Record<EnergySource, number> = {
  evolution: 15,
  badge: 60,
  battleWon: 4,
  areaCompleted: 120,
  raidVictory: 20,
  duelWon: 2,
}

export interface EnergyPack {
  id: string
  energy: number
  gold: number
}

/** Kaufbare Pakete. Der Grundpreis liegt bei 10 Gold je Energie, groessere
 *  Pakete werden guenstiger — ein angenehmer Preis gemessen an dem, was eine
 *  lange Expedition oder ein Arenakampf einbringt. */
/*
 * Energie fuer Gold.
 *
 * Der Preis je Punkt faellt mit der Menge — 13, 11,5 und 10 Gold —, damit die
 * grosse Packung eine Entscheidung bleibt und nicht bloss die kleine mal
 * zwanzig. Angehoben von 10/9/8: Energie war das billigste Mittel gegen jede
 * Wartezeit, und was jede Wartezeit aufhebt, darf ruhig etwas kosten.
 */
export const ENERGY_PACKS: EnergyPack[] = [
  { id: 'energy-small', energy: 10, gold: 130 },
  { id: 'energy-medium', energy: 50, gold: 575 },
  { id: 'energy-large', energy: 200, gold: 2000 },
]

export const findEnergyPack = (id: string): EnergyPack | undefined =>
  ENERGY_PACKS.find((p) => p.id === id)

export interface EnergyRegen {
  energy: number
  /** Zeitstempel, ab dem weitergerechnet wird. */
  updatedAt: number
}

/**
 * Energie bis `now` nachfuehren.
 *
 * Der Rest einer angefangenen Minute geht nicht verloren: `updatedAt` wandert
 * nur um die tatsaechlich gutgeschriebenen Punkte weiter. Wer alle zwei Minuten
 * die App oeffnet, bekommt damit genauso viel wie jemand, der einmal am Tag
 * hereinschaut — bei einer naiven Rechnung waere jeder Aufruf ein Rundungsverlust.
 */
export function regenerateTrainerEnergy(
  energy: number,
  updatedAt: number,
  now: number,
  cap: number = ENERGY_BASE_CAP,
  perHour: number = ENERGY_PER_HOUR,
): EnergyRegen {
  if (energy >= cap) return { energy, updatedAt: now }
  if (now <= updatedAt || perHour <= 0) return { energy, updatedAt: Math.min(updatedAt, now) }

  const msPerPoint = 3_600_000 / perHour
  const earned = Math.floor((now - updatedAt) / msPerPoint)
  if (earned <= 0) return { energy, updatedAt }

  const next = Math.min(cap, energy + earned)
  // Nur die Zeit verbuchen, die auch in Punkte geflossen ist. Wird die
  // Obergrenze erreicht, laeuft die Uhr bis jetzt weiter — gestaut wird nichts.
  //
  // `msPerPoint` ist nur bei glatten Teilern von 3.600.000 ganzzahlig, und mit
  // einem Ausbau-Bonus (15 → 17 Punkte/Stunde) ist es das nicht. Ein
  // gebrochener Zeitstempel laesst sich in einer STRICT-Tabelle nicht
  // speichern — abgerundet wird zugunsten des Spielers: der Rest der
  // angefangenen Millisekunde bleibt stehen und zaehlt beim naechsten Mal mit.
  const consumed = next >= cap ? now - updatedAt : Math.floor(earned * msPerPoint)
  return { energy: next, updatedAt: Math.floor(updatedAt + consumed) }
}

/** Wann der naechste Punkt faellt — fuer den Countdown im UI. */
export function nextPointAt(
  energy: number,
  updatedAt: number,
  cap: number = ENERGY_BASE_CAP,
  perHour: number = ENERGY_PER_HOUR,
): number | null {
  if (energy >= cap || perHour <= 0) return null
  return Math.round(updatedAt + 3_600_000 / perHour)
}

/** Wann das Konto wieder voll ist. `null`, wenn es das schon ist. */
export function fullAt(
  energy: number,
  updatedAt: number,
  cap: number = ENERGY_BASE_CAP,
  perHour: number = ENERGY_PER_HOUR,
): number | null {
  if (energy >= cap || perHour <= 0) return null
  return Math.round(updatedAt + (cap - energy) * (3_600_000 / perHour))
}

export const clampEnergy = (value: number): number => clamp(Math.floor(value), 0, ENERGY_HARD_CAP)
