import { GameError, type Trainer } from '@game/shared'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import { eventsOf, logEvent } from '../repos/events.js'
import { revokeSessionsOf } from '../auth/session.js'

/**
 * Data export and deletion.
 *
 * A player who asks what is stored about them should get everything, in a form
 * they can actually read, without asking a human. And deletion has to mean
 * deletion — not a flag that hides the rows.
 */

/** Tables holding personal data, in an order that respects foreign keys.
 *  Listing them explicitly rather than relying on cascades makes the promise
 *  auditable: what is in this list is what gets exported and erased. */
const PERSONAL_TABLES: Array<{ table: string; column: string }> = [
  { table: 'creatures', column: 'owner_id' },
  { table: 'inventory', column: 'trainer_id' },
  { table: 'dex_entries', column: 'trainer_id' },
  { table: 'daily_counters', column: 'trainer_id' },
  { table: 'trainer_badges', column: 'trainer_id' },
  { table: 'area_progress', column: 'trainer_id' },
  { table: 'area_completions', column: 'trainer_id' },
  { table: 'center_offers', column: 'trainer_id' },
  // team_members haengt per Kaskade an teams und creatures und braucht deshalb
  // keinen eigenen Eintrag — aber die Teamnamen sind selbst Nutzerdaten.
  { table: 'teams', column: 'trainer_id' },
  { table: 'active_encounter', column: 'trainer_id' },
  { table: 'catch_chains', column: 'trainer_id' },
  { table: 'expeditions', column: 'trainer_id' },
  { table: 'eggs', column: 'trainer_id' },
  { table: 'battles', column: 'trainer_id' },
  { table: 'trainer_defeats', column: 'trainer_id' },
  { table: 'market_listings', column: 'seller_id' },
  { table: 'guild_members', column: 'trainer_id' },
  { table: 'raid_participants', column: 'trainer_id' },
  { table: 'pvp_ratings', column: 'trainer_id' },
  { table: 'tournament_entries', column: 'trainer_id' },
  { table: 'buildings', column: 'trainer_id' },
  { table: 'season_progress', column: 'trainer_id' },
  { table: 'achievements', column: 'trainer_id' },
  { table: 'story_progress', column: 'trainer_id' },
  { table: 'leaderboard_stats', column: 'trainer_id' },
  { table: 'notifications', column: 'trainer_id' },
  { table: 'sessions', column: 'trainer_id' },
]

export function exportData(ctx: AppContext, trainer: Trainer): Record<string, unknown> {
  const data: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    note:
      'Vollständiger Auszug aller zu diesem Trainer gespeicherten Daten. ' +
      'Spielinhalte (Arten, Attacken, Gebiete) sind nicht enthalten — die sind für alle gleich.',
    trainer: {
      ...trainer,
      // The Telegram id is the account link; it belongs in the export.
      telegramId: trainer.telegramId,
    },
  }

  for (const { table, column } of PERSONAL_TABLES) {
    try {
      data[table] = ctx.db.prepare(`SELECT * FROM ${table} WHERE ${column} = ?`).all(trainer.id)
    } catch {
      // A table from a migration that has not run yet is simply absent.
      data[table] = []
    }
  }

  // Friendships are stored once for the pair, so they need their own query.
  data.friendships = ctx.db
    .prepare('SELECT * FROM friendships WHERE low_id = ? OR high_id = ?')
    .all(trainer.id, trainer.id)
  data.trades = ctx.db
    .prepare('SELECT * FROM trade_offers WHERE from_id = ? OR to_id = ?')
    .all(trainer.id, trainer.id)
  data.duels = ctx.db
    .prepare('SELECT id, challenger_id, defender_id, winner, rating_delta, fought_at FROM pvp_duels WHERE challenger_id = ? OR defender_id = ?')
    .all(trainer.id, trainer.id)
  data.eventLog = eventsOf(ctx.db, trainer.id, 2000)

  return data
}

export interface DeletionResult {
  deletedRows: number
  tables: number
}

/**
 * Erase everything.
 *
 * Two different treatments, chosen per table by what the other party keeps:
 *
 * - Rows that merely *reference* the leaver are detached (`buyer_id`,
 *   `event_log.trainer_id` are nullable): the creature someone bought stays
 *   theirs, the audit entry stays countable, only the name is gone.
 * - Rows that *are* a two-party record — a duel — are removed with the account.
 *   Their columns are NOT NULL by design, and half a duel is not history worth
 *   keeping. What the opponent keeps is what actually mattered: their rating,
 *   wins and losses, which live in `pvp_ratings` and are untouched.
 */
export function deleteAccount(ctx: AppContext, trainer: Trainer): DeletionResult {
  return tx(ctx.db, () => {
    let deletedRows = 0
    let tables = 0

    // Detach what can be detached ...
    ctx.db.prepare('UPDATE market_listings SET buyer_id = NULL WHERE buyer_id = ?').run(trainer.id)
    ctx.db.prepare('UPDATE event_log SET trainer_id = NULL WHERE trainer_id = ?').run(trainer.id)

    // ... and remove what cannot. The opponent's rating is not touched.
    deletedRows += ctx.db
      .prepare('DELETE FROM pvp_duels WHERE challenger_id = ? OR defender_id = ?')
      .run(trainer.id, trainer.id).changes

    for (const { table, column } of PERSONAL_TABLES) {
      try {
        const result = ctx.db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(trainer.id)
        deletedRows += result.changes
        tables++
      } catch { /* Tabelle existiert nicht */ }
    }

    ctx.db.prepare('DELETE FROM friendships WHERE low_id = ? OR high_id = ?').run(trainer.id, trainer.id)
    ctx.db.prepare('DELETE FROM friend_requests WHERE from_id = ? OR to_id = ?').run(trainer.id, trainer.id)
    ctx.db.prepare('DELETE FROM trade_offers WHERE from_id = ? OR to_id = ?').run(trainer.id, trainer.id)
    ctx.db.prepare('DELETE FROM invite_redemptions WHERE trainer_id = ?').run(trainer.id)
    revokeSessionsOf(ctx.db, trainer.id)

    const gone = ctx.db.prepare('DELETE FROM trainers WHERE id = ?').run(trainer.id)
    deletedRows += gone.changes

    logEvent(ctx.db, null, 'account.deleted', { at: Date.now() })
    return { deletedRows, tables }
  })
}

/** Deletion is irreversible, so it needs an explicit confirmation phrase
 *  rather than a button that could be hit by accident. */
export const DELETE_CONFIRMATION = 'LÖSCHEN'

export function assertConfirmation(phrase: string): void {
  if (phrase.trim().toUpperCase() !== DELETE_CONFIRMATION) {
    throw new GameError('validation_failed', { field: 'confirm', expected: DELETE_CONFIRMATION })
  }
}
