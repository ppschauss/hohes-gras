/**
 * Tages- und Wochenaufgaben.
 *
 * Das Spiel hatte lange nur zwei Rhythmen: die Anmeldebelohnung (kommt von
 * allein) und das Gildenziel (kommt nur mit einer Gilde). Wer allein spielte,
 * hatte keinen Grund, heute etwas anderes zu tun als gestern.
 *
 * Aufgaben geben dem Tag eine Form. Drei am Tag, drei in der Woche, und beide
 * Sätze wechseln — nicht zufällig je Spieler, sondern aus dem Datum abgeleitet,
 * damit alle über dieselben reden können.
 *
 * Der Entwurf hat eine Absicht, die über „mehr zu tun" hinausgeht: die
 * Wochenaufgaben zählen **jeden** Sieg, auch den fünften über denselben
 * Arenaleiter. Das ist der Gegenpol zur Tagesregel beim Gold, die das
 * Wiederholen absichtlich nicht mehr bezahlt. Zusammen ergibt das: Wiederholen
 * bringt kein Vermögen, aber es bringt die Woche voran — und damit lohnt sich
 * der Weg zurück in ein altes Gebiet.
 */

export type QuestCadence = 'daily' | 'weekly'

/**
 * Woran eine Aufgabe misst.
 *
 * Die Namen sind dieselben, die `bumpMetric` schon durchs Spiel trägt. Neue
 * Aufgaben brauchen deshalb selten neuen Code an der Stelle, wo etwas
 * passiert — nur hier einen Eintrag.
 */
export type QuestMetric =
  | 'catches' | 'explores' | 'careActions' | 'battles' | 'crafted'
  | 'eggsHatched' | 'evolutions' | 'duelsWon' | 'dexNew' | 'gifts'
  | 'research' | 'raidsWon'
  /* Kampfaufgaben, die auf Wiederholung zielen. */
  | 'gymWins' | 'routeTrainerWins' | 'rocketWins' | 'arenaRuns'
  /** Siege in der Kampfzone — jeder einzelne, nicht der Lauf. */
  | 'gauntletWins'

export interface QuestReward {
  gold: number
  items?: Array<{ itemId: string; quantity: number }>
}

export interface QuestSpec {
  id: string
  cadence: QuestCadence
  metric: QuestMetric
  target: number
  reward: QuestReward
}

/**
 * Die Tagesaufgaben.
 *
 * Klein genug, dass drei davon nebenbei passieren — wer ohnehin spielt,
 * erledigt sie, ohne den Tag danach auszurichten. Das ist Absicht: eine
 * Tagesaufgabe, für die man extra etwas tun muss, ist eine Pflicht.
 */
export const DAILY_QUESTS: QuestSpec[] = [
  { id: 'd-catch', cadence: 'daily', metric: 'catches', target: 5, reward: { gold: 300, items: [{ itemId: 'poke-ball', quantity: 5 }] } },
  { id: 'd-explore', cadence: 'daily', metric: 'explores', target: 20, reward: { gold: 250, items: [{ itemId: 'potion', quantity: 2 }] } },
  { id: 'd-care', cadence: 'daily', metric: 'careActions', target: 6, reward: { gold: 200, items: [{ itemId: 'oran-berry', quantity: 3 }] } },
  { id: 'd-battle', cadence: 'daily', metric: 'battles', target: 4, reward: { gold: 350, items: [{ itemId: 'super-potion', quantity: 1 }] } },
  { id: 'd-route', cadence: 'daily', metric: 'routeTrainerWins', target: 3, reward: { gold: 300, items: [{ itemId: 'great-ball', quantity: 3 }] } },
  { id: 'd-craft', cadence: 'daily', metric: 'crafted', target: 2, reward: { gold: 300, items: [{ itemId: 'iron-shard', quantity: 2 }] } },
  { id: 'd-evolve', cadence: 'daily', metric: 'evolutions', target: 1, reward: { gold: 250, items: [{ itemId: 'exp-candy-s', quantity: 1 }] } },
  { id: 'd-hatch', cadence: 'daily', metric: 'eggsHatched', target: 1, reward: { gold: 300, items: [{ itemId: 'dew-drop', quantity: 2 }] } },
  { id: 'd-gift', cadence: 'daily', metric: 'gifts', target: 1, reward: { gold: 200, items: [{ itemId: 'silk-thread', quantity: 2 }] } },
  { id: 'd-dex', cadence: 'daily', metric: 'dexNew', target: 2, reward: { gold: 400, items: [{ itemId: 'soft-sand', quantity: 2 }] } },
  { id: 'd-arena', cadence: 'daily', metric: 'arenaRuns', target: 1, reward: { gold: 400, items: [{ itemId: 'exp-candy-s', quantity: 2 }] } },
  { id: 'd-gauntlet', cadence: 'daily', metric: 'gauntletWins', target: 10, reward: { gold: 450, items: [{ itemId: 'iron-shard', quantity: 3 }] } },
  { id: 'd-duel', cadence: 'daily', metric: 'duelsWon', target: 2, reward: { gold: 350, items: [{ itemId: 'razz-berry', quantity: 3 }] } },
]

/**
 * Die Wochenaufgaben — der Kampfteil.
 *
 * Sie sind der Grund, warum sich Arenen wieder lohnen: seit der volle
 * Siegbetrag nur einmal am Tag je Gegner faellt, hat ein zweiter Kampf gegen
 * Rocko kein Gold mehr gebracht. Für die Woche zählt er trotzdem.
 */
export const WEEKLY_QUESTS: QuestSpec[] = [
  { id: 'w-gym', cadence: 'weekly', metric: 'gymWins', target: 6, reward: { gold: 2500, items: [{ itemId: 'star-piece', quantity: 3 }] } },
  { id: 'w-route', cadence: 'weekly', metric: 'routeTrainerWins', target: 20, reward: { gold: 2000, items: [{ itemId: 'exp-candy-l', quantity: 1 }] } },
  { id: 'w-rocket', cadence: 'weekly', metric: 'rocketWins', target: 5, reward: { gold: 2500, items: [{ itemId: 'legendary-berry', quantity: 1 }] } },
  { id: 'w-arena', cadence: 'weekly', metric: 'arenaRuns', target: 5, reward: { gold: 2200, items: [{ itemId: 'exp-candy-l', quantity: 1 }] } },
  { id: 'w-gauntlet', cadence: 'weekly', metric: 'gauntletWins', target: 60, reward: { gold: 2600, items: [{ itemId: 'star-piece', quantity: 3 }] } },
  { id: 'w-battle', cadence: 'weekly', metric: 'battles', target: 30, reward: { gold: 2000, items: [{ itemId: 'star-piece', quantity: 2 }] } },
  { id: 'w-catch', cadence: 'weekly', metric: 'catches', target: 40, reward: { gold: 2000, items: [{ itemId: 'ultra-ball', quantity: 3 }] } },
  { id: 'w-explore', cadence: 'weekly', metric: 'explores', target: 150, reward: { gold: 1800, items: [{ itemId: 'golden-razz', quantity: 2 }] } },
  { id: 'w-duel', cadence: 'weekly', metric: 'duelsWon', target: 8, reward: { gold: 2200, items: [{ itemId: 'star-piece', quantity: 2 }] } },
  { id: 'w-raid', cadence: 'weekly', metric: 'raidsWon', target: 3, reward: { gold: 2500, items: [{ itemId: 'legendary-berry', quantity: 1 }] } },
  { id: 'w-research', cadence: 'weekly', metric: 'research', target: 2, reward: { gold: 2000, items: [{ itemId: 'star-piece', quantity: 3 }] } },
]

/** Wie viele gleichzeitig laufen. */
export const QUESTS_PER_DAY = 3
export const QUESTS_PER_WEEK = 3

/**
 * Welche Aufgaben ein Zeitraum stellt.
 *
 * Aus dem Schlüssel abgeleitet und damit für alle Spieler gleich — und für
 * denselben Tag immer dieselben. Der Abstand von vier sorgt dafür, dass die
 * drei aus verschiedenen Ecken der Liste kommen; drei Fangaufgaben an einem
 * Tag wären keine Abwechslung.
 */
export function questsFor(cadence: QuestCadence, key: string): QuestSpec[] {
  const pool = cadence === 'daily' ? DAILY_QUESTS : WEEKLY_QUESTS
  const count = cadence === 'daily' ? QUESTS_PER_DAY : QUESTS_PER_WEEK
  let seed = 0
  for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) % 100_000
  const out: QuestSpec[] = []
  for (let i = 0; i < count; i++) out.push(pool[(seed + i * 4) % pool.length]!)
  // Doppelte koennen bei kleinen Listen entstehen; dann rutscht der naechste
  // Eintrag nach, statt zweimal dasselbe zu stellen.
  const seen = new Set<string>()
  return out.map((q, i) => {
    let pick = q
    let step = 0
    while (seen.has(pick.id) && step < pool.length) {
      step++
      pick = pool[(seed + i * 4 + step) % pool.length]!
    }
    seen.add(pick.id)
    return pick
  })
}

export const findQuest = (id: string): QuestSpec | undefined =>
  [...DAILY_QUESTS, ...WEEKLY_QUESTS].find((q) => q.id === id)
