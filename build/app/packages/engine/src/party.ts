/**
 * Wer von einem Team wirklich antreten darf.
 *
 * Ein Legendaeres im Team, mehr nicht. Die Regel greift aber nicht bei der
 * Aufstellung, sondern beim Kampf: wer drei davon hineinstellt, bekommt keine
 * Fehlermeldung, sondern schickt nur eines ins Feld — und zwar das
 * *schwaechste*.
 *
 * Das ist Absicht und der Kern der Sache. Die Gegner richten sich weiterhin
 * nach dem Durchschnitt des ganzen Teams, auch nach den Legendaeren, die
 * zusehen. Wer stapelt, hebt damit die Gegnerstufe und verliert gleichzeitig
 * die Kraft, mit der er sie schlagen wollte. Die Regel muss niemanden
 * bestrafen; sie sorgt dafuer, dass Stapeln sich selbst bestraft.
 *
 * Eine Sperre bei der Aufstellung waere die naheliegende Loesung und die
 * schlechtere: sie muesste an jedem Weg ins Team haengen — Fang, Tausch,
 * Zucht, Ei, Verbund — und der erste vergessene Weg macht sie wirkungslos.
 * Hier steht sie an genau einer Stelle, dort, wo gekaempft wird.
 */

/** Wie viele Legendaere gleichzeitig kaempfen duerfen. */
export const LEGENDARY_TEAM_LIMIT = 1

export interface PartySplit<T> {
  /** Wer antritt, in der Reihenfolge des Teams. */
  antreten: T[]
  /** Wer zusehen muss. Leer, solange die Grenze eingehalten ist. */
  bank: T[]
}

/**
 * Teilt ein Team in Antretende und Zuschauer.
 *
 * `staerke` entscheidet, welches Legendaere bleibt — gemeint ist die Summe
 * seiner Werte, damit Level, Anlagen und Wesen alle mitzaehlen. Bei
 * Gleichstand bleibt das im Team weiter vorn stehende: eine Regel, die vom
 * Zufall abhinge, waere fuer den Spieler nicht nachvollziehbar.
 *
 * Nicht-Legendaere bleiben immer unberuehrt, und die Reihenfolge bleibt die
 * des Teams — sie entscheidet, wer den Kampf eroeffnet.
 */
export function splitParty<T>(
  team: readonly T[],
  istLegendaer: (mitglied: T) => boolean,
  staerke: (mitglied: T) => number,
): PartySplit<T> {
  const legendaere = team.filter(istLegendaer)
  if (legendaere.length <= LEGENDARY_TEAM_LIMIT) return { antreten: [...team], bank: [] }

  const bleibt = legendaere.reduce((a, b) => (staerke(b) < staerke(a) ? b : a))
  const bank = legendaere.filter((m) => m !== bleibt)
  return { antreten: team.filter((m) => !bank.includes(m)), bank }
}
