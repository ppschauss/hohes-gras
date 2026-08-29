import type { AppContext } from '../context.js'
import * as expeditions from '../repos/expeditions.js'
import * as research from '../repos/research.js'

/**
 * Wer gerade nicht verfügbar ist.
 *
 * Es gab dafür eine Funktion im Expeditions-Repository, und jeder Dienst rief
 * sie direkt auf — solange Expeditionen der einzige Grund waren, war das auch
 * richtig. Seit das Labor Pokémon bindet, ist „unterwegs" mehr als eine
 * Expedition, und die Frage gehört an eine Stelle: sonst hätte ein
 * Forschungsassistent im Marktplatz verkauft werden können, während er noch
 * arbeitet.
 */
export function busyCreatureIds(ctx: AppContext, trainerId: string): Set<string> {
  const out = expeditions.busyCreatureIds(ctx.db, trainerId)
  for (const id of research.busyCreatures(ctx.db, trainerId)) out.add(id)
  return out
}
