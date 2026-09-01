import { GameError, NATURES, type Trainer } from '@game/shared'
import { von } from './ledger.js'
import {
  createRng, GIFT_INBOX_LIMIT, produceEgg, randomIvs, rollGift, type GiftContents,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import { newId } from '../db/ids.js'
import * as social from '../repos/social.js'
import * as inventory from '../repos/inventory.js'
import * as eggs from '../repos/eggs.js'
import { findById } from '../repos/trainers.js'
import { logEvent } from '../repos/events.js'
import { gameDate } from '../worldClock.js'
import { eggSlots } from './breeding.js'
import { bonuses, bumpMetric } from './progression.js'

interface GiftRow {
  id: string
  fromId: string
  toId: string
  gameDate: string
  payload: string
  sentAt: number
  openedAt: number | null
}

const label = (ctx: AppContext, trainer: Trainer, contents: GiftContents): string =>
  contents.items
    .map((i) => {
      const item = ctx.registry.tryItem(i.itemId)
      return `${i.quantity}× ${item ? ctx.registry.localized(item.name, trainer.locale) : i.itemId}`
    })
    .join(', ')

/** Wem heute schon eines geschickt wurde. */
export function sentToday(ctx: AppContext, trainerId: string, date = gameDate()): Set<string> {
  const rows = ctx.db
    .prepare('SELECT to_id AS id FROM friend_gifts WHERE from_id = ? AND game_date = ?')
    .all(trainerId, date) as Array<{ id: string }>
  return new Set(rows.map((r) => r.id))
}

export function inbox(ctx: AppContext, trainer: Trainer) {
  const rows = ctx.db
    .prepare(
      `SELECT id, from_id AS fromId, to_id AS toId, game_date AS gameDate, payload, sent_at AS sentAt,
              opened_at AS openedAt
         FROM friend_gifts WHERE to_id = ? AND opened_at IS NULL ORDER BY sent_at`,
    )
    .all(trainer.id) as GiftRow[]

  return rows.map((row) => {
    const contents = JSON.parse(row.payload) as GiftContents
    const from = findById(ctx.db, row.fromId)
    return {
      id: row.id,
      fromName: from?.displayName ?? '—',
      sentAt: row.sentAt,
      egg: contents.egg,
      label: label(ctx, trainer, contents),
    }
  })
}

/**
 * Ein Geschenk schicken.
 *
 * Einmal am Tag je Freund; die Schranke steht als eindeutiger Index in der
 * Datenbank, damit zwei gleichzeitige Anfragen nicht beide durchkommen.
 */
export function send(ctx: AppContext, trainer: Trainer, toId: string) {
  return tx(ctx.db, () => {
    if (toId === trainer.id) throw new GameError('validation_failed', { reason: 'self' })
    if (!social.areFriends(ctx.db, trainer.id, toId)) {
      throw new GameError('invalid_state', { reason: 'not_friends' }, 409)
    }
    const target = findById(ctx.db, toId)
    if (!target || target.isBanned) throw new GameError('not_found', { trainerId: toId }, 404)

    const date = gameDate()
    if (sentToday(ctx, trainer.id, date).has(toId)) {
      throw new GameError('invalid_state', { reason: 'already_claimed' }, 409)
    }

    // Ein voller Briefkasten ist kein Fehler des Absenders, aber auch kein
    // Grund, unbegrenzt weiterzustapeln.
    const waiting = (ctx.db
      .prepare('SELECT COUNT(*) AS n FROM friend_gifts WHERE to_id = ? AND opened_at IS NULL')
      .get(toId) as { n: number }).n
    if (waiting >= GIFT_INBOX_LIMIT) {
      throw new GameError('invalid_state', { reason: 'already_full', limit: GIFT_INBOX_LIMIT }, 409)
    }

    const contents = rollGift(createRng(`gift:${trainer.id}:${toId}:${date}`))
    const id = newId()
    ctx.db.prepare(
      `INSERT INTO friend_gifts (id, from_id, to_id, game_date, payload, sent_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, trainer.id, toId, date, JSON.stringify(contents), Date.now())

    logEvent(ctx.db, trainer.id, 'gift.sent', { to: toId, egg: contents.egg })
    bumpMetric(ctx, trainer.id, 'gifts')
    return { id, to: target.displayName, egg: contents.egg, label: label(ctx, trainer, contents) }
  })
}

/**
 * Ein Geschenk öffnen.
 *
 * Das Ei entsteht erst hier: welche Art schlüpft, hängt am Empfänger, und ein
 * Ei, das beim Absender gewürfelt wurde, läge ohne freien Brutplatz seit Tagen
 * fest.
 */
export function open(ctx: AppContext, trainer: Trainer, giftId: string) {
  return tx(ctx.db, () => {
    const row = ctx.db
      .prepare('SELECT id, from_id AS fromId, payload, opened_at AS openedAt FROM friend_gifts WHERE id = ? AND to_id = ?')
      .get(giftId, trainer.id) as { id: string; fromId: string; payload: string; openedAt: number | null } | undefined
    if (!row) throw new GameError('not_found', { giftId }, 404)
    if (row.openedAt !== null) throw new GameError('invalid_state', { reason: 'already_claimed' }, 409)

    const contents = JSON.parse(row.payload) as GiftContents
    for (const item of contents.items) {
      if (ctx.registry.tryItem(item.itemId)) {
        inventory.grant(ctx.db, trainer.id, item.itemId, item.quantity, von(ctx, 'friend.gift'))
      }
    }

    let egg: { id: string; speciesId: string } | null = null
    if (contents.egg && eggs.openOf(ctx.db, trainer.id).length < eggSlots(ctx, trainer.id)) {
      egg = hatchGiftEgg(ctx, trainer, row.fromId)
    }

    ctx.db.prepare('UPDATE friend_gifts SET opened_at = ? WHERE id = ?').run(Date.now(), giftId)
    logEvent(ctx.db, trainer.id, 'gift.opened', { from: row.fromId, egg: egg !== null })

    return {
      label: label(ctx, trainer, contents),
      /** Ein Ei lag bei, war aber kein Platz frei — dann bleibt es beim Rest. */
      eggSkipped: contents.egg && egg === null,
      egg,
    }
  })
}

function hatchGiftEgg(ctx: AppContext, trainer: Trainer, fromId: string) {
  const pool = ctx.registry.obtainableSpecies.filter(
    (s) => !s.event && !ctx.registry.allSpecies.some((o) => o.evolutions.some((e) => e.to === s.id)),
  )
  if (pool.length === 0) return null

  const rng = createRng(`gift-egg:${trainer.id}:${fromId}:${Date.now()}`)
  const species = rng.pick(pool)
  const ivs = randomIvs(rng)
  const result = produceEgg(
    { speciesId: species.id, ivs, nature: rng.pick(NATURES), shiny: false },
    { speciesId: species.id, ivs, nature: rng.pick(NATURES), shiny: false },
    species, rng,
  )
  const speedUp = 1 - bonuses(ctx, trainer.id).hatchSpeedBonus / 100
  const created = eggs.create(ctx.db, {
    trainerId: trainer.id,
    speciesId: result.speciesId,
    nature: result.nature,
    ivs: result.ivs,
    shiny: result.shiny,
    hatchMinutes: Math.max(5, Math.round(result.hatchMinutes * Math.max(0.4, speedUp))),
    startedAt: Date.now(),
    parentA: null,
    parentB: null,
  })
  return { id: created.id, speciesId: created.speciesId }
}
