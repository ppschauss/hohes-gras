import type { CreatureView, DexRow, OwnedCreature, TimeOfDay } from '@game/shared'
import type { Registry } from '@game/content'
import {
  computeStats, condition, currentHpRatio, friendshipTier, ivPercent, levelProgress, powerRating,
  LINK_CABLE_ITEM_ID,
} from '@game/engine'
import type { DexEntry } from '../repos/dex.js'

/**
 * Turn stored rows into something the client can render.
 *
 * All derived numbers — stats, power, condition, evolution readiness — are
 * computed here rather than in the browser. The client is a renderer; if it
 * could compute stats it could also disagree with the server about them.
 */
export function creatureView(
  registry: Registry,
  c: OwnedCreature,
  locale: string,
  timeOfDay: TimeOfDay,
  /** Reisegrenze des Besitzers. Ohne sie zeigte der Balken einen naechsten
   *  Levelaufstieg an, den es fuer diesen Trainer noch gar nicht gibt. */
  levelCap?: number,
  /** Woran es gerade gebunden ist; siehe `busy.ts`. */
  busyReason: CreatureView['busyReason'] = null,
): CreatureView {
  const species = registry.species(c.speciesId)
  const stats = computeStats(species, c.level, c.ivs, c.evs, c.nature)
  const progress = levelProgress(species.growthRate, c.xp, levelCap)
  const speciesName = registry.localized(species.name, locale)

  // Gespeicherte KP koennen ueber dem Maximum liegen — etwa wenn ein Pokemon
  // sich in eine Form mit weniger KP entwickelt oder eine Zeile von aussen
  // gesetzt wurde. Die Ansicht darf nie mehr KP melden, als es geben kann.
  const hpCurrent = Math.max(0, Math.min(c.hpCurrent, stats.hp))

  return {
    ...c,
    hpCurrent,
    speciesName,
    dexNumber: species.dexNumber,
    displayName: c.nickname ?? speciesName,
    types: species.types.map((id) => typeInfo(registry, id, locale)),
    sprite: c.shiny ? species.spriteShiny : species.sprite,
    stats,
    hpMax: stats.hp,
    power: powerRating(stats, c.level),
    ivPercent: ivPercent(c.ivs),
    condition: condition(c.energy, c.friendship, currentHpRatio(hpCurrent, stats)),
    friendshipTier: friendshipTier(c.friendship),
    xpIntoLevel: progress.xpIntoLevel,
    xpForNextLevel: progress.xpForNextLevel,
    isMaxLevel: progress.isMaxLevel,
    moveNames: c.moves.map((id) => {
      const move = registry.tryMove(id)
      return move ? registry.localized(move.name, locale) : id
    }),
    busyReason,
    canEvolveTo: evolutionOptions(registry, c, locale, timeOfDay),
  }
}

function typeInfo(registry: Registry, id: string, locale: string) {
  const t = registry.type(id)
  return { id: t.id, name: registry.localized(t.name, locale), color: t.color }
}

/** Which evolutions are satisfied *right now*. Trade evolutions never appear
 *  here: they are triggered by the trade itself, not by opening the garden. */
export function evolutionOptions(
  registry: Registry,
  c: OwnedCreature,
  locale: string,
  timeOfDay: TimeOfDay,
  heldItems: Set<string> = new Set(),
): CreatureView['canEvolveTo'] {
  const species = registry.species(c.speciesId)
  const out: CreatureView['canEvolveTo'] = []

  for (const evo of species.evolutions) {
    const target = registry.trySpecies(evo.to)
    if (!target) continue
    const name = registry.localized(target.name, locale)

    switch (evo.trigger) {
      case 'level':
        if (c.level >= evo.level) out.push({ speciesId: evo.to, name, how: 'level' })
        break
      case 'friendship':
        if (c.friendship >= evo.minFriendship && (!evo.timeOfDay || evo.timeOfDay === timeOfDay)) {
          out.push({ speciesId: evo.to, name, how: 'friendship' })
        }
        break
      case 'stone':
        if (heldItems.has(evo.itemId)) out.push({ speciesId: evo.to, name, how: 'stone' })
        break
      case 'trade':
        /*
         * Elf Arten entwickeln sich im Vorbild nur durch einen Tausch. Hier
         * stand lange `break` — sie waren damit nicht erreichbar, und die
         * Eintraege im Pack blosse Zierde.
         *
         * Zwei Wege gibt es jetzt: ein echter Tausch loest es aus, oder ein
         * Verbindungskabel simuliert einen. Braucht die Entwicklung zusaetzlich
         * einen Tragegegenstand, muss auch der im Beutel liegen — beides wird
         * beim Entwickeln verbraucht.
         */
        if (heldItems.has(LINK_CABLE_ITEM_ID) && (!evo.heldItemId || heldItems.has(evo.heldItemId))) {
          out.push({ speciesId: evo.to, name, how: 'trade' })
        }
        break
    }
  }
  return out
}

export function dexRows(
  registry: Registry,
  entries: Map<string, DexEntry>,
  ownedCounts: Map<string, number>,
  locale: string,
): DexRow[] {
  return registry.obtainableSpecies.map((s) => {
    const entry = entries.get(s.id)
    return {
      speciesId: s.id,
      dexNumber: s.dexNumber,
      name: registry.localized(s.name, locale),
      sprite: s.sprite,
      types: s.types.map((id) => typeInfo(registry, id, locale)),
      rarity: s.rarity,
      seen: Boolean(entry?.seenAt),
      caught: Boolean(entry?.caughtAt),
      owned: ownedCounts.get(s.id) ?? 0,
    }
  })
}
