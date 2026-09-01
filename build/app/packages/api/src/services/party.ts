import { STATS, type Nature, type StatBlock } from '@game/shared'
import { computeStats, isLegendarySpecies, splitParty, type PartySplit } from '@game/engine'
import type { AppContext } from '../context.js'

/**
 * Die Ein-Legendaeres-Regel, angewandt auf echte Kreaturen.
 *
 * Die Regel selbst steht in der Engine und kennt weder Arten noch Datenbank.
 * Hier kommt nur dazu, was sie von aussen braucht: ob eine Art legendaer ist,
 * und wie stark ein bestimmtes Pokemon gerade wirklich ist.
 *
 * Bewusst eine Stelle fuer alle Kampfarten. Es gibt vier Orte, an denen ein
 * Team zu Kaempfern wird — Trainerkampf, Raid, Turnier und Duell —, und eine
 * Regel, die an dreien haengt, ist keine Regel, sondern eine Empfehlung.
 */

/**
 * Wie stark ein Pokemon gerade ist: die Summe seiner Werte.
 *
 * Nicht das Level allein. Zwei Mewtu auf Level 70 koennen fuenfzig Punkte
 * auseinanderliegen, und "das schwaechste" soll das schwaechste heissen und
 * nicht "das mit der kleineren Zahl auf der Karte".
 */
export interface Bewertbar {
  speciesId: string
  level: number
  ivs: StatBlock
  evs: StatBlock
  nature: Nature
}

export function strengthOf(ctx: AppContext, c: Bewertbar): number {
  const stats = computeStats(ctx.registry.species(c.speciesId), c.level, c.ivs, c.evs, c.nature)
  return STATS.reduce((sum, s) => sum + stats[s], 0)
}

/** Teilt ein Team in die, die antreten, und die, die zusehen. */
export function battleParty<T extends Bewertbar>(ctx: AppContext, team: readonly T[]): PartySplit<T> {
  return splitParty(
    team,
    (c) => isLegendarySpecies(ctx.registry.species(c.speciesId)),
    (c) => strengthOf(ctx, c),
  )
}
