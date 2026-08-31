/**
 * Die Kampfzone.
 *
 * Eine Serie gegen wilde Pokémon derselben Region, ohne festes Ende: man
 * kämpft, solange man steht. Anders als die Trainingsarena hat sie keine vier
 * Runden und keine Stufen — sie hat eine **Serie**, und die Belohnung hängt
 * daran, wie weit man kommt.
 *
 * Warum es sie neben der Arena gibt: die Arena ist ein Ort zum *Üben*, mit
 * bekanntem Typ und vier Kämpfen. Die Kampfzone ist der Ort zum *Farmen* — sie
 * ist die verlässlichste Quelle für Werkstoffe, und zwar für die der jeweiligen
 * Region. Wer Eisensplitter braucht, weiß danach, wohin er reist.
 *
 * Drei Regeln halten sie ehrlich:
 *
 *  - **Die Gegner stehen auf dem eigenen Durchschnittslevel.** Kein Grund,
 *    ein Anfangsgebiet leerzuräumen; ein Kampf ist überall gleich viel wert.
 *  - **Eine Niederlage beendet den Lauf.** Die Serie ist das, was man riskiert.
 *  - **Die Energie wird einmal bezahlt**, beim Antritt, nicht je Kampf — wie
 *    in der Arena, und aus demselben Grund.
 */

/* Was der Antritt kostet, steht bei den uebrigen Energiekosten in
 * `energy.ts` (`ENERGY_COSTS.gauntlet`) — an zwei Stellen waere es eine
 * zweite Wahrheit. */

/**
 * Wie viel Erfahrung ein Kampf hier einbringt.
 *
 * Der Faktor allein sagt wenig — entscheidend ist, dass **jeder** Gegner als
 * „erster Sieg" zählt, weil jeder eine eigene Kennung hat. Ein Routentrainer
 * gibt beim ersten Mal 371 und danach 186; die Kampfzone gab bei 2,5 volle
 * 928 — jeden Kampf, unbegrenzt oft. 33 Kämpfe waren 30.000 EP.
 *
 * Gemeldet als „24k exp ist vielleicht doch etwas arg viel", und das stimmt.
 */
export const GAUNTLET_XP_MULTIPLIER = 1.2

/**
 * Wie schnell die Erfahrung über die Serie abflacht.
 *
 * `Faktor / (1 + Serie / 60)`. Ohne das wäre eine Serie von zweihundert
 * schlicht zweihundertmal der erste Kampf, und die einzige sinnvolle
 * Spielweise wäre, ewig weiterzukämpfen.
 *
 * Mit ihr sind die ersten Kämpfe die wertvollsten und die späten der Preis
 * für die Stufen bei 50 und 100 — die tragen sich über Gold und Werkstoffe,
 * nicht über Erfahrung.
 */
export const GAUNTLET_XP_TAPER = 60

/** Der Faktor für den Kampf bei diesem Stand der Serie. */
export const gauntletXpMultiplier = (streak: number): number =>
  GAUNTLET_XP_MULTIPLIER / (1 + Math.max(0, streak) / GAUNTLET_XP_TAPER)

/**
 * Alle wie viel Stufen das Team vollstaendig geheilt und belebt wird.
 *
 * Fuenfundzwanzig, und dazwischen gar nichts. Vorher gab es nach jedem Sieg
 * zwoelf Prozent zurueck und an jeder Praemienstufe — also schon bei zehn und
 * fuenfzehn — eine volle Heilung. Das war zu viel und vor allem zu beliebig:
 * "die Pokemon werden mitten drin geheilt, teilweise auch voll", gemeldet mit
 * dem Vorschlag, den ich hier uebernehme.
 *
 * Der Preis dafuer ist echt: fuenfundzwanzig Kaempfe auf Augenhoehe ohne einen
 * einzigen Kraftpunkt zurueck sind nur mit dem Beutel zu schaffen. Genau das
 * macht die Fuenfundzwanzig aber zu einer Marke statt zu einer Zwischenzahl.
 */
export const GAUNTLET_FULL_HEAL_EVERY = 25

/** Wird das Team bei diesem Stand vollstaendig geheilt? */
export const gauntletHeals = (streak: number): boolean =>
  streak > 0 && streak % GAUNTLET_FULL_HEAL_EVERY === 0

/**
 * Wie viele Pokémon gleichzeitig antreten.
 *
 * Eins. Es ist eine Kette von Einzelkämpfen, keine Reihe von Teams — sonst
 * wäre eine Serie von hundert eine Frage von Stunden statt von Ausdauer.
 */
export const GAUNTLET_FOES_PER_FIGHT = 1

/**
 * Die Stufen, an denen es etwas gibt.
 *
 * Zehn, fünfzehn, fünfundzwanzig, fünfzig, hundert. Die ersten beiden liegen
 * dicht beieinander, damit auch ein kurzer Besuch etwas abwirft; danach zieht
 * es sich, damit hundert eine Zahl bleibt, die man erzählt.
 *
 * Geheilt wird hier nicht mehr: das haengt seit der Meldung "die Pokemon
 * werden mitten drin geheilt" allein an `gauntletHeals`, alle fünfundzwanzig
 * Stufen. Prämie und Rastplatz fallen deshalb nur bei 25, 50 und 100
 * zusammen — bei zehn und fünfzehn gibt es Gold und Werkstoffe, aber keine
 * Erholung.
 */
export interface GauntletMilestone {
  at: number
  gold: number
  /** Wie viele Einheiten der Regionsbeute es gibt. */
  materials: number
}

export const GAUNTLET_MILESTONES: GauntletMilestone[] = [
  { at: 10, gold: 400, materials: 3 },
  { at: 15, gold: 700, materials: 4 },
  { at: 25, gold: 1500, materials: 7 },
  { at: 50, gold: 4000, materials: 15 },
  { at: 100, gold: 12000, materials: 35 },
]

/** Die höchste Stufe. Darüber hinaus gibt es keine Prämien mehr — die Serie
 *  läuft weiter, aber hundert ist die Zahl, die zählt. */
export const GAUNTLET_MAX_MILESTONE = GAUNTLET_MILESTONES[GAUNTLET_MILESTONES.length - 1]!.at

/** Welche Stufe mit genau diesem Stand erreicht wurde — oder keine. */
export const milestoneAt = (streak: number): GauntletMilestone | null =>
  GAUNTLET_MILESTONES.find((m) => m.at === streak) ?? null

/** Die nächste Stufe über dem aktuellen Stand. */
export const nextMilestone = (streak: number): GauntletMilestone | null =>
  GAUNTLET_MILESTONES.find((m) => m.at > streak) ?? null

/**
 * Das Level des nächsten Gegners.
 *
 * Auf dem eigenen Durchschnitt, und mit der Serie steigend: nach fünfzig
 * Kämpfen steht der Gegner fünf Level darüber. Langsam genug, dass es nicht
 * abbricht, deutlich genug, dass hundert kein Selbstläufer ist.
 */
export function gauntletLevel(averageLevel: number, streak: number, cap: number): number {
  const step = Math.floor(streak / 10)
  return Math.max(2, Math.min(cap, Math.round(averageLevel) + GAUNTLET_START_DELTA + step))
}

/**
 * Wie weit der erste Gegner unter dem eigenen Durchschnitt steht.
 *
 * Drei Level. Der Einstieg soll ein Aufwärmen sein und keine Prüfung — auf dem
 * eigenen Niveau anzufangen klingt fair, ist es aber nicht: das eigene Team
 * kämpft die ganze Serie durch, der Gegner tritt jedes Mal frisch an. Ab Serie
 * 30 steht er wieder auf Augenhöhe, ab 100 sieben Level darüber.
 */
export const GAUNTLET_START_DELTA = -3

/**
 * Wie stark die Gegner höchstens sein dürfen — als Grundwertsumme.
 *
 * Der wichtigste Regler, und der einzige, der zuverlässig funktioniert.
 * Gemeldet nach dem ersten Lauf: **Rayquaza als erster Gegner.** Der Filter
 * hatte auf den Fangwert gesetzt (`catchRate > 3`), und im Content-Pack steht
 * bei Rayquaza 45 — der Fangwert taugt nicht als Maß für „legendär". Bei
 * Brutalanda (600 Grundwerte, Fangwert 45) genauso.
 *
 * Die Grundwertsumme misst, was man tatsächlich spürt. Dieselbe Lehre wie in
 * der Trainingsarena, wo ein Tauros auf „leicht" neben einem Hoothoot stand.
 *
 * 0 heißt: keine Grenze. Ab Serie 50 tritt an, was die Region hergibt — wer
 * so weit kommt, hat es sich verdient.
 */
export function gauntletMaxBst(streak: number): number {
  if (streak < 10) return 400
  if (streak < 25) return 470
  if (streak < 50) return 540
  return 0
}

/**
 * Wie gut die Werte des Gegners sind, 0 bis 31.
 *
 * Steigt mit der Serie von acht auf einunddreißig. Das ist der zweite Hebel
 * neben dem Level und wirkt anders: ein Gegner mit makellosen Werten trifft
 * härter, ohne dass die Zahl über seinem Kopf abschreckend aussieht.
 */
export function gauntletIv(streak: number): number {
  return Math.max(0, Math.min(31, 8 + Math.floor(streak / 4)))
}

/**
 * Was eine Serie an Gold einbringt, ohne die Stufen.
 *
 * Je Sieg und mit der Serie wachsend, damit auch die Kämpfe zwischen zwei
 * Stufen etwas wert sind.
 */
export function gauntletGoldPerWin(streak: number): number {
  return 30 + streak * 4
}


/**
 * Was eine Region an Werkstoffen hergibt.
 *
 * Der Grund, warum die Kampfzone regional ist: wer Eisensplitter braucht, soll
 * wissen, wohin er reist. Ein Ort, der überall dasselbe abwirft, ist kein Ort,
 * sondern ein Knopf.
 *
 * Die Zuordnung nennt Regionen beim Namen — sie gehört damit strenggenommen
 * zum Inhalt und nicht zur Regel. Sie steht trotzdem hier, weil ein Pack ohne
 * eigene Zuordnung sonst gar keine Beute hätte; `GAUNTLET_DROPS_FALLBACK`
 * fängt jede unbekannte Region auf.
 */
export const GAUNTLET_DROPS: Record<string, string[]> = {
  kanto: ['iron-shard', 'soft-sand'],
  johto: ['silk-thread', 'dew-drop'],
  hoenn: ['dew-drop', 'star-piece'],
}

export const GAUNTLET_DROPS_FALLBACK = ['iron-shard', 'silk-thread']

export const dropsForRegion = (regionId: string): string[] =>
  GAUNTLET_DROPS[regionId] ?? GAUNTLET_DROPS_FALLBACK

/**
 * Wie sich `materials` einer Stufe auf die Sorten der Region verteilt.
 *
 * Gleichmäßig, Rest auf die erste Sorte. Ausdrücklich als Funktion, damit
 * Anzeige und Auszahlung dieselbe Rechnung benutzen und nicht auseinander-
 * laufen können.
 */
export function splitDrops(regionId: string, total: number): Array<{ itemId: string; quantity: number }> {
  const sorten = dropsForRegion(regionId)
  if (sorten.length === 0 || total <= 0) return []
  const je = Math.floor(total / sorten.length)
  const rest = total - je * sorten.length
  return sorten
    .map((itemId, i) => ({ itemId, quantity: je + (i === 0 ? rest : 0) }))
    .filter((d) => d.quantity > 0)
}


/**
 * Was ein besiegtes Pokémon fallen lässt.
 *
 * Jeder einzelne Kampf soll etwas abwerfen — nicht nur die Stufen. Ohne das
 * sind neun Siege in Folge neun Kämpfe für nichts, und die Zehn ist eine
 * Klippe statt eines Meilensteins.
 *
 * Zwei getrennte Würfe, weil sie verschiedenes bedeuten: **Bälle** sind der
 * Nachschub, den man beim Fangen verbraucht, **Werkstoffe** sind das, wofür
 * man überhaupt herkommt. Beide zusammen fallen selten, eines von beiden
 * meistens.
 */
export const GAUNTLET_BALL_CHANCE = 0.35
export const GAUNTLET_MATERIAL_CHANCE = 0.3

/**
 * Ab welcher Serie der bessere Ball fällt.
 *
 * Nicht als zusätzliche Menge, sondern als bessere Sorte: zwanzig Pokébälle
 * mehr ändern nichts, drei Superbälle schon.
 */
export const GAUNTLET_GREAT_BALL_FROM = 20
export const GAUNTLET_ULTRA_BALL_FROM = 50

export interface GauntletDropRoll {
  next(): number
  int(min: number, max: number): number
  pick<T>(items: readonly T[]): T
}

export function rollGauntletDrops(
  rng: GauntletDropRoll, regionId: string, streak: number,
): Array<{ itemId: string; quantity: number }> {
  const out: Array<{ itemId: string; quantity: number }> = []

  if (rng.next() < GAUNTLET_BALL_CHANCE) {
    const ball = streak >= GAUNTLET_ULTRA_BALL_FROM
      ? 'ultra-ball'
      : streak >= GAUNTLET_GREAT_BALL_FROM ? 'great-ball' : 'poke-ball'
    out.push({ itemId: ball, quantity: rng.int(1, 3) })
  }

  if (rng.next() < GAUNTLET_MATERIAL_CHANCE) {
    const sorten = dropsForRegion(regionId)
    if (sorten.length > 0) {
      // Mit der Serie etwas mehr, aber flach: die Stufen sollen der grosse
      // Sprung bleiben, der Einzelkampf das stete Rinnsal.
      const menge = 1 + Math.floor(streak / 25)
      out.push({ itemId: rng.pick(sorten), quantity: rng.int(1, Math.max(1, menge)) })
    }
  }

  return out
}
