import { GameError, type MoveOption, type MoveSet, type Trainer } from '@game/shared'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as creatures from '../repos/creatures.js'
import * as battles from '../repos/battles.js'
import { logEvent } from '../repos/events.js'
import { MOVE_SLOTS } from './garden.js'

/**
 * Attacken einer Kreatur waehlen.
 *
 * Bis hierher wurden Attacken ausschliesslich automatisch vergeben: bei jedem
 * Levelaufstieg bekam ein Pokemon die vier zuletzt erlernbaren, alles aeltere
 * fiel heraus. Wer eine bestimmte Attacke behalten wollte, konnte das nicht.
 * Jetzt entscheidet der Spieler, und die Automatik fuellt nur noch leere
 * Plaetze — siehe `refreshMoves` im Garten-Dienst.
 */

/** Kurzes Schlagwort statt der ganzen Effektstruktur: im UI steht dafuer eine
 *  Zeile zur Verfuegung, nicht drei. */
function effectLabel(effect: { kind: string; [k: string]: unknown }): string {
  switch (effect.kind) {
    case 'status': return `status:${String(effect.status)}`
    case 'stat_stage': return `stat:${String(effect.stat)}:${Number(effect.stages) > 0 ? 'up' : 'down'}`
    case 'drain': return 'drain'
    case 'recoil': return 'recoil'
    case 'heal': return 'heal'
    case 'multi_hit': return 'multi_hit'
    case 'flinch': return 'flinch'
    default: return 'none'
  }
}

function optionOf(
  ctx: AppContext,
  trainer: Trainer,
  moveId: string,
  level: number,
  selected: boolean,
): MoveOption | null {
  const move = ctx.registry.tryMove(moveId)
  if (!move) return null
  const type = ctx.registry.tryType(move.type)
  return {
    id: move.id,
    name: ctx.registry.localized(move.name, trainer.locale),
    type: {
      id: move.type,
      name: type ? ctx.registry.localized(type.name, trainer.locale) : move.type,
      color: type?.color ?? '#888888',
    },
    category: move.category,
    power: move.power,
    accuracy: move.accuracy,
    pp: move.pp,
    level,
    effect: effectLabel(move.effect),
    selected,
  }
}

function requireOwn(ctx: AppContext, trainer: Trainer, creatureId: string) {
  const creature = creatures.byId(ctx.db, creatureId)
  if (!creature) throw new GameError('not_found', { creatureId }, 404)
  if (creature.ownerId !== trainer.id) throw new GameError('not_owner', { creatureId }, 403)
  return creature
}

export function moveSet(ctx: AppContext, trainer: Trainer, creatureId: string): MoveSet {
  const creature = requireOwn(ctx, trainer, creatureId)
  const species = ctx.registry.species(creature.speciesId)

  // Level, ab dem die Art die jeweilige Attacke kann — fuer die Anzeige
  // "ab Lv. 24" und damit die Liste nach Neuheit sortiert bleibt.
  const levelOf = new Map<string, number>()
  for (const entry of species.learnset) {
    const known = levelOf.get(entry.moveId)
    if (known === undefined || entry.level < known) levelOf.set(entry.moveId, entry.level)
  }

  const selected = new Set(creature.moves)
  const options = ctx.registry
    .learnableAt(creature.speciesId, creature.level)
    .filter((id, index, all) => all.indexOf(id) === index)
    .map((id) => optionOf(ctx, trainer, id, levelOf.get(id) ?? 0, selected.has(id)))
    .filter((o): o is MoveOption => o !== null)

  const byId = new Map(options.map((o) => [o.id, o]))
  const slots = creature.moves.flatMap((id) => {
    const known = byId.get(id)
    // Eine Attacke aus einer frueheren Entwicklungsstufe steht womoeglich nicht
    // mehr in der Lernliste. Sie bleibt trotzdem sichtbar — sonst verschwaende
    // sie stillschweigend aus der Anzeige, obwohl sie im Kampf wirkt.
    return known ? [known] : (optionOf(ctx, trainer, id, levelOf.get(id) ?? 0, true) ?? [])
  })

  return {
    creature: {
      id: creature.id,
      displayName: creature.nickname ?? ctx.registry.localized(species.name, trainer.locale),
      sprite: creature.shiny ? species.spriteShiny : species.sprite,
      level: creature.level,
    },
    capacity: MOVE_SLOTS,
    slots,
    options,
  }
}

export function setMoves(
  ctx: AppContext,
  trainer: Trainer,
  creatureId: string,
  moveIds: string[],
): MoveSet {
  return tx(ctx.db, () => {
    const creature = requireOwn(ctx, trainer, creatureId)

    // Mitten im Kampf: der Kampfzustand haelt eine Momentaufnahme der Attacken
    // samt AP. Ein Wechsel jetzt wuerde beides auseinanderlaufen lassen.
    if (battles.activeOf(ctx.db, trainer.id)) {
      throw new GameError('invalid_state', { reason: 'battle_in_progress' }, 409)
    }

    const unique = [...new Set(moveIds)]
    if (unique.length !== moveIds.length) {
      throw new GameError('validation_failed', { reason: 'duplicate_moves' })
    }
    if (unique.length > MOVE_SLOTS) {
      throw new GameError('validation_failed', { field: 'moveIds', max: MOVE_SLOTS })
    }

    // Nur was die Art auf ihrem Level kann. Ohne diese Pruefung liesse sich
    // jede Attacke des Packs auf jedes Pokemon schreiben.
    const learnable = new Set(ctx.registry.learnableAt(creature.speciesId, creature.level))
    for (const id of unique) {
      if (!ctx.registry.tryMove(id)) throw new GameError('not_found', { moveId: id }, 404)
      if (!learnable.has(id)) {
        throw new GameError('invalid_state', { reason: 'not_learnable', moveId: id }, 409)
      }
    }

    creatures.setMoves(ctx.db, creature.id, unique)
    logEvent(ctx.db, trainer.id, 'creature.moves', { creatureId: creature.id, moves: unique })
    return moveSet(ctx, trainer, creature.id)
  })
}
