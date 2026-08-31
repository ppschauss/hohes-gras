import type { AppContext } from '../context.js'
import * as expeditions from '../repos/expeditions.js'
import * as research from '../repos/research.js'
import * as boarding from '../repos/boarding.js'
import * as eggs from '../repos/eggs.js'

/**
 * Wer gerade nicht verfügbar ist.
 *
 * Es gab dafür eine Funktion im Expeditions-Repository, und jeder Dienst rief
 * sie direkt auf — solange Expeditionen der einzige Grund waren, war das auch
 * richtig. Seit das Labor Pokémon bindet, ist „unterwegs" mehr als eine
 * Expedition, und die Frage gehört an eine Stelle: sonst hätte ein
 * Forschungsassistent im Marktplatz verkauft werden können, während er noch
 * arbeitet. Dasselbe gilt für die Pension.
 */
export function busyCreatureIds(ctx: AppContext, trainerId: string): Set<string> {
  return new Set(busyReasons(ctx, trainerId).keys())
}

/** Woran genau jemand gebunden ist. */
export type BusyReason = 'expedition' | 'research' | 'boarding' | 'egg'

/**
 * Nicht nur *dass*, sondern *warum*.
 *
 * Es reichte lange, die Ids zu kennen: gebundene Pokémon fielen aus dem Kampf,
 * und fertig. Gemeldet wurde, wohin das führt — „bei jedem Fight kämpfen nur 2
 * Pokémon und die restlichen 3 werden einfach ignoriert". Drei Teammitglieder
 * saßen auf Eiern, und nichts im Spiel sagte es. Wer den Grund anzeigen will,
 * braucht ihn hier.
 */
export function busyReasons(ctx: AppContext, trainerId: string): Map<string, BusyReason> {
  const out = new Map<string, BusyReason>()
  // Reihenfolge = Rangfolge: die erste Bindung gewinnt die Anzeige. Mehr als
  // eine gleichzeitig kann es ohnehin nicht geben, jede prüft die anderen.
  for (const id of expeditions.busyCreatureIds(ctx.db, trainerId)) out.set(id, 'expedition')
  for (const id of research.busyCreatures(ctx.db, trainerId)) if (!out.has(id)) out.set(id, 'research')
  for (const id of boarding.busyCreatures(ctx.db, trainerId)) if (!out.has(id)) out.set(id, 'boarding')
  for (const id of eggs.brooders(ctx.db, trainerId)) if (!out.has(id)) out.set(id, 'egg')
  return out
}
