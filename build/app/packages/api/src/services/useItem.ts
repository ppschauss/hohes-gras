import { GameError, STATS, type Trainer } from '@game/shared'
import { addEvs, computeStats, grantXpTo, IV_CAPS_PER_CREATURE, IV_MAX, xpForLevel } from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import * as battles from '../repos/battles.js'
import { logEvent } from '../repos/events.js'
import { capOf } from './travel.js'
import { useJammer } from './safari.js'

/**
 * Gegenstände aus dem Beutel benutzen.
 *
 * Es gab dafür keinen Weg: der Beutel war eine Liste, und Tränke ließen sich
 * nur im Kampf einsetzen. Wer nach einem verlorenen Kampf ein Team mit einem
 * Kraftpunkt hatte, konnte den Trank im Beutel ansehen und sonst nichts.
 *
 * Was hier *nicht* geht, sagt eine eigene Begründung statt einer allgemeinen
 * Absage — ein Lockduft etwa gehört in die Safari, nicht in den Beutel.
 */

export type UseKind = 'heal' | 'revive' | 'cure' | 'xp' | 'jammer' | 'ev' | 'iv'

export interface UseResult {
  kind: UseKind
  itemName: string
  creatureName?: string
  healed?: number
  xpGained?: number
  leveledUp?: boolean
  charges?: number
  /** Bei Fleissbeere und Erbgut-Serum: welcher Wert, und wie er jetzt steht. */
  stat?: string
  statValue?: number
}

export function useItem(
  ctx: AppContext, trainer: Trainer, itemId: string, creatureId?: string, stat?: string,
): UseResult {
  const item = ctx.registry.tryItem(itemId)
  if (!item) throw new GameError('not_found', { itemId }, 404)
  const name = ctx.registry.localized(item.name, trainer.locale)

  // Der Störsender ist der einzige Schlüsselgegenstand, den man auslöst.
  if (item.category === 'key') {
    if (typeof item.params.rocketCharges !== 'number') {
      throw new GameError('invalid_state', { reason: 'not_usable', itemId }, 409)
    }
    const { charges } = useJammer(ctx, trainer)
    return { kind: 'jammer', itemName: name, charges }
  }

  if (item.category === 'lure') {
    throw new GameError('invalid_state', { reason: 'use_in_safari', itemId }, 409)
  }
  if (item.category !== 'medicine' && item.category !== 'xp') {
    throw new GameError('invalid_state', { reason: 'not_usable', itemId }, 409)
  }

  return tx(ctx.db, () => {
    if (battles.activeOf(ctx.db, trainer.id)) {
      // Im Kampf gibt es den eigenen Weg — dort kostet der Einsatz den Zug.
      throw new GameError('invalid_state', { reason: 'battle_in_progress' }, 409)
    }
    if (!creatureId) throw new GameError('validation_failed', { field: 'creatureId' })
    const c = creatures.byId(ctx.db, creatureId)
    if (!c || c.ownerId !== trainer.id) throw new GameError('not_found', { creatureId }, 404)
    if (inventory.quantityOf(ctx.db, trainer.id, itemId) < 1) {
      throw new GameError('insufficient_items', { itemId }, 409)
    }

    const species = ctx.registry.species(c.speciesId)
    const stats = computeStats(species, c.level, c.ivs, c.evs, c.nature)
    const creatureName = c.nickname ?? ctx.registry.localized(species.name, trainer.locale)
    const p = item.params

    /*
     * Alles, was ein Pokemon dauerhaft aendert: Fleissbeeren, Vitamine,
     * Kronkorken.
     *
     * Sie stehen hier und nicht bei den Traenken, weil sie den Wert selbst
     * verschieben statt das Pokemon zu versorgen. Den Wert bringen bis auf
     * den Kronkorken alle selbst mit — nur er laesst die Wahl.
     */
    if (p.evPoints !== undefined || p.ivPerfect === true) {
      /*
       * Ein Vitamin bringt seinen Wert selbst mit.
       *
       * KP-Plus ist Kraftpunkte, Protein ist Angriff — da gibt es nichts zu
       * waehlen, und die Vorlage macht es genauso. Nur der Kronkorken laesst
       * die Wahl, weil er sie auch dort laesst.
       */
      const fest = typeof p.evStat === 'string' ? p.evStat : null
      const gewaehlt = fest ?? stat
      if (!gewaehlt || !STATS.includes(gewaehlt as (typeof STATS)[number])) {
        throw new GameError('validation_failed', { field: 'stat' })
      }
      const wert = gewaehlt as (typeof STATS)[number]

      if (p.ivPerfect === true) {
        if (c.ivs[wert] >= IV_MAX) {
          throw new GameError('invalid_state', { reason: 'already_perfect', stat: wert }, 409)
        }
        /*
         * Zwei je Pokemon, nicht sechs.
         *
         * Ohne diese Grenze setzten sechs Kronkorken alle sechs Werte auf das
         * Maximum — die Zucht war damit keine Abkuerzung wert, sondern
         * ueberfluessig. Zwei retten die beiden schwaechsten Werte; fuer die
         * uebrigen vier muss weiterhin gezuechtet werden.
         */
        if (c.ivCaps >= IV_CAPS_PER_CREATURE) {
          throw new GameError(
            'invalid_state',
            { reason: 'iv_cap_limit', used: c.ivCaps, max: IV_CAPS_PER_CREATURE },
            409,
          )
        }
        creatures.setIvs(ctx.db, c.id, { ...c.ivs, [wert]: IV_MAX })
        creatures.bumpIvCaps(ctx.db, c.id)
        inventory.consume(ctx.db, trainer.id, itemId, 1)
        logEvent(ctx.db, trainer.id, 'item.used', {
          itemId, creatureId, kind: 'iv', stat: wert, capsUsed: c.ivCaps + 1,
        })
        return { kind: 'iv' as const, itemName: name, creatureName, stat: wert, statValue: IV_MAX }
      }

      const punkte = Math.max(1, Math.floor(Number(p.evPoints ?? 0)))
      const neu = addEvs(c.evs, { [wert]: punkte })
      if (neu[wert] === c.evs[wert]) {
        throw new GameError('invalid_state', { reason: 'ev_full', stat: wert }, 409)
      }
      creatures.setEvs(ctx.db, c.id, neu)
      inventory.consume(ctx.db, trainer.id, itemId, 1)
      logEvent(ctx.db, trainer.id, 'item.used', { itemId, creatureId, kind: 'ev', stat: wert })
      return { kind: 'ev' as const, itemName: name, creatureName, stat: wert, statValue: neu[wert] }
    }

    /*
     * Das Sonderbonbon hebt um genau ein Level.
     *
     * Vorher gab es fuenfzig Erfahrungspunkte — bei Level 39 kostet ein
     * Aufstieg 4.681, bei Level 100 gut 30.000. Der Gegenstand tat damit ein
     * Achtzigstel dessen, was sein Name verspricht.
     *
     * Gerechnet wird die Luecke bis zur naechsten Stufe, nicht ein fester
     * Betrag: nur so heisst "ein Level" auf jeder Stufe dasselbe. Die
     * Reisegrenze gilt weiter — sie ist der Grund, warum ein Team nicht an
     * seinen Trainer vorbeiwaechst.
     */
    if (p.levelUp === true) {
      const cap = capOf(ctx, trainer)
      if (c.level >= cap) {
        throw new GameError('invalid_state', { reason: 'level_cap', level: c.level, cap }, 409)
      }
      const luecke = Math.max(1, xpForLevel(species.growthRate, c.level + 1) - c.xp)
      const result = grantXpTo(species.growthRate, c.xp, c.level, luecke, cap)
      creatures.setXp(ctx.db, c.id, result.totalXp, result.levelAfter)
      inventory.consume(ctx.db, trainer.id, itemId, 1)
      logEvent(ctx.db, trainer.id, 'item.used', { itemId, creatureId, kind: 'xp', levelUp: true })
      return {
        kind: 'xp' as const, itemName: name, creatureName,
        xpGained: result.totalXp - c.xp, leveledUp: result.levelsGained > 0,
      }
    }

    if (item.category === 'xp') {
      const amount = Math.max(1, Math.floor(Number(p.xp ?? 0)))
      if (amount <= 0) throw new GameError('invalid_state', { reason: 'not_usable', itemId }, 409)
      const scaled = Math.max(1, Math.round(amount / (species.xpFactor ?? 1)))
      const result = grantXpTo(species.growthRate, c.xp, c.level, scaled, capOf(ctx, trainer))
      creatures.setXp(ctx.db, c.id, result.totalXp, result.levelAfter)
      inventory.consume(ctx.db, trainer.id, itemId, 1)
      logEvent(ctx.db, trainer.id, 'item.used', { itemId, creatureId, kind: 'xp' })
      return {
        kind: 'xp' as const,
        itemName: name,
        creatureName,
        xpGained: result.totalXp - c.xp,
        leveledUp: result.levelsGained > 0,
      }
    }

    // Medizin. Was nicht passt, wird abgelehnt statt verbraucht: ein Trank auf
    // einem vollen Pokemon ist ein Fehlgriff, kein Verbrauch.
    const revive = typeof p.revive === 'number' ? p.revive : null
    if (revive !== null) {
      if (c.hpCurrent > 0) throw new GameError('invalid_state', { reason: 'not_fainted', creatureId }, 409)
      const hp = Math.max(1, Math.round(stats.hp * revive))
      creatures.setHp(ctx.db, c.id, hp)
      inventory.consume(ctx.db, trainer.id, itemId, 1)
      logEvent(ctx.db, trainer.id, 'item.used', { itemId, creatureId, kind: 'revive' })
      return { kind: 'revive' as const, itemName: name, creatureName, healed: hp }
    }

    if (c.hpCurrent <= 0) throw new GameError('invalid_state', { reason: 'fainted', creatureId }, 409)

    const heal = p.healFull === true ? stats.hp : Math.floor(Number(p.heal ?? 0))
    if (heal > 0) {
      if (c.hpCurrent >= stats.hp) {
        throw new GameError('invalid_state', { reason: 'already_full', creatureId }, 409)
      }
      const after = Math.min(stats.hp, c.hpCurrent + heal)
      creatures.setHp(ctx.db, c.id, after)
      inventory.consume(ctx.db, trainer.id, itemId, 1)
      logEvent(ctx.db, trainer.id, 'item.used', { itemId, creatureId, kind: 'heal' })
      return { kind: 'heal' as const, itemName: name, creatureName, healed: after - c.hpCurrent }
    }

    if (p.cureAll === true || p.energy !== undefined) {
      inventory.consume(ctx.db, trainer.id, itemId, 1)
      logEvent(ctx.db, trainer.id, 'item.used', { itemId, creatureId, kind: 'cure' })
      return { kind: 'cure' as const, itemName: name, creatureName }
    }

    throw new GameError('invalid_state', { reason: 'not_usable', itemId }, 409)
  })
}
