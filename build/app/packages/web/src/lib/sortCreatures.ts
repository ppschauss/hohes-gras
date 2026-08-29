/**
 * Sortierung der Box.
 *
 * Eine Box mit ueber tausend Plaetzen ist ohne Ordnung ein Haufen. Fuenf
 * Schluessel decken ab, wonach man tatsaechlich sucht: die Nummer (welche Art
 * fehlt noch), der Name (ein bestimmtes Pokemon), das Level (wer taugt fuers
 * Team), der Typ (wer passt gegen den Gegner von heute) und schillernd zuerst
 * (die Stuecke, die man nie verwertet).
 *
 * Bei Gleichstand entscheidet immer dasselbe: Nummer, dann Name. Ohne festen
 * Ausgleich springen Zeilen bei jedem Neuladen, und eine Liste, die sich unter
 * dem Finger bewegt, ist schlimmer als eine unsortierte.
 */

export const SORT_KEYS = ['dex', 'name', 'level', 'type', 'shiny'] as const
export type SortKey = (typeof SORT_KEYS)[number]

export interface SortableCreature {
  dexNumber: number
  displayName: string
  level: number
  shiny: boolean
  types: Array<{ name: string }>
}

const byName = (a: SortableCreature, b: SortableCreature): number =>
  a.displayName.localeCompare(b.displayName, 'de')

const firstType = (c: SortableCreature): string => c.types[0]?.name ?? ''

/** Die jeweils naheliegende Richtung steckt schon im Vergleich: Level und
 *  schillernd zaehlen von oben, alles andere von vorn. */
const PRIMARY: Record<SortKey, (a: SortableCreature, b: SortableCreature) => number> = {
  dex: (a, b) => a.dexNumber - b.dexNumber,
  name: byName,
  level: (a, b) => b.level - a.level,
  type: (a, b) => firstType(a).localeCompare(firstType(b), 'de'),
  shiny: (a, b) => Number(b.shiny) - Number(a.shiny),
}

const tiebreak = (a: SortableCreature, b: SortableCreature): number =>
  a.dexNumber - b.dexNumber || byName(a, b)

export function sortCreatures<T extends SortableCreature>(
  list: readonly T[],
  key: SortKey,
  reversed = false,
): T[] {
  return [...list].sort((a, b) => {
    const primary = PRIMARY[key](a, b)
    // Der Ausgleich dreht sich nicht mit: sonst stuende bei "Level aufsteigend"
    // dieselbe Stufe in umgekehrter Nummernfolge da.
    return primary !== 0 ? (reversed ? -primary : primary) : tiebreak(a, b)
  })
}
