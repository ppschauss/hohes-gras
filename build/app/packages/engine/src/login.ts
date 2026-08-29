/**
 * Tägliche Anmeldebelohnung.
 *
 * Vier Wochen, achtundzwanzig verschiedene Gaben, und am Ende jeder Woche ein
 * Schillerndes Seelenfragment. Der Reiz liegt nicht in der einzelnen Gabe —
 * dreihundert Gold sind nach einer Woche Spiel nichts — sondern darin, dass
 * die Kette weiterläuft: wer einen Tag auslässt, fängt wieder bei Tag 1 an und
 * verliert damit die Wochenprämie, auf die er zugelaufen ist.
 *
 * Die Wochenprämien wachsen (1, 2, 3, 5 Fragmente), damit die vierte Woche
 * mehr ist als die erste noch einmal. Fünfzehn Fragmente im Monat — elf von
 * hier, vier aus der Saison — sind zwei bis drei schillernde Eier.
 */

export type LoginReward =
  | { kind: 'gold'; amount: number }
  | { kind: 'item'; itemId: string; quantity: number }
  | { kind: 'energy'; amount: number }

/** Länge eines Durchlaufs. Danach beginnt die Leiter von vorn. */
export const LOGIN_CYCLE_DAYS = 28
/** Tage je Abschnitt; der letzte Tag jedes Abschnitts trägt die Prämie. */
export const LOGIN_WEEK_DAYS = 7

/**
 * Was es an Tag n gibt, 1-basiert.
 *
 * Bewusst in vier Abschnitten aufgebaut: die erste Woche gibt, was ein neuer
 * Trainer sofort braucht, die letzte, was ein fortgeschrittener sich sonst
 * erarbeiten müsste.
 */
export const LOGIN_REWARDS: LoginReward[] = [
  // --- Woche 1: ankommen ---------------------------------------------------
  { kind: 'gold', amount: 300 },
  { kind: 'item', itemId: 'poke-ball', quantity: 10 },
  { kind: 'energy', amount: 30 },
  { kind: 'item', itemId: 'oran-berry', quantity: 8 },
  { kind: 'item', itemId: 'exp-candy-s', quantity: 2 },
  { kind: 'item', itemId: 'great-ball', quantity: 10 },
  { kind: 'item', itemId: 'soul-shiny', quantity: 1 },

  // --- Woche 2: ausrüsten --------------------------------------------------
  { kind: 'gold', amount: 800 },
  { kind: 'item', itemId: 'razz-berry', quantity: 10 },
  { kind: 'energy', amount: 60 },
  { kind: 'item', itemId: 'super-potion', quantity: 5 },
  { kind: 'item', itemId: 'ultra-ball', quantity: 10 },
  { kind: 'item', itemId: 'star-piece', quantity: 3 },
  { kind: 'item', itemId: 'soul-shiny', quantity: 2 },

  // --- Woche 3: werkeln ----------------------------------------------------
  { kind: 'gold', amount: 1500 },
  { kind: 'item', itemId: 'dew-drop', quantity: 6 },
  { kind: 'energy', amount: 90 },
  { kind: 'item', itemId: 'exp-candy-l', quantity: 2 },
  { kind: 'item', itemId: 'golden-razz', quantity: 2 },
  { kind: 'item', itemId: 'iron-shard', quantity: 6 },
  { kind: 'item', itemId: 'soul-shiny', quantity: 3 },

  // --- Woche 4: meistern ---------------------------------------------------
  { kind: 'gold', amount: 2500 },
  { kind: 'item', itemId: 'revive', quantity: 3 },
  { kind: 'energy', amount: 120 },
  { kind: 'item', itemId: 'rare-candy', quantity: 1 },
  { kind: 'item', itemId: 'moon-stone', quantity: 1 },
  { kind: 'item', itemId: 'full-restore', quantity: 2 },
  { kind: 'item', itemId: 'soul-shiny', quantity: 5 },
]

/** Die Gabe für einen Tag der Leiter, 1-basiert. */
export function loginRewardFor(day: number): LoginReward {
  const index = Math.max(1, Math.min(LOGIN_CYCLE_DAYS, Math.floor(day))) - 1
  return LOGIN_REWARDS[index]!
}

/** Trägt dieser Tag eine Wochenprämie? */
export const isLoginBonusDay = (day: number): boolean => day % LOGIN_WEEK_DAYS === 0

export interface LoginState {
  /** Wo auf der Leiter, 1 bis 28. */
  day: number
  /** Wie viele Tage in Folge, ohne Obergrenze. */
  streak: number
  /** Spieldatum der letzten Abholung, `null` bei noch nie. */
  lastDate: string | null
}

/**
 * Was beim Abholen von heute wird.
 *
 * Rein und ohne Uhr: der Aufrufer reicht das heutige und das gestrige
 * Spieldatum herein. `null` heißt "heute schon abgeholt".
 *
 * Nach Tag 28 beginnt die Leiter wieder bei 1, die Serie läuft weiter — wer
 * zwei Monate durchhält, soll das an der Zahl sehen und nicht bei 28 stehen
 * bleiben.
 */
export function claimLogin(state: LoginState, today: string, yesterday: string): LoginState | null {
  if (state.lastDate === today) return null
  const continued = state.lastDate === yesterday
  return {
    day: continued ? (state.day % LOGIN_CYCLE_DAYS) + 1 : 1,
    streak: continued ? state.streak + 1 : 1,
    lastDate: today,
  }
}
