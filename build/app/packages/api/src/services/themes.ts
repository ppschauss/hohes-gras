import { GameError, type ThemesState, type ThemeView, type Trainer } from '@game/shared'
import {
  DEFAULT_THEME, THEMES, findTheme, resolveMode, swatchesOf,
  type ThemeSetting,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as inventory from '../repos/inventory.js'
import { logEvent } from '../repos/events.js'
import { worldClock } from '../worldClock.js'

/**
 * Designs kaufen und tragen.
 *
 * Der Besitz liegt in `trainer_themes`, das getragene Design in
 * `trainers.theme_id`. Getrennt, weil beides verschiedene Fragen beantwortet:
 * was einem gehört, verliert man nie wieder; was man trägt, wechselt man
 * beliebig oft.
 */

function ownedIds(ctx: AppContext, trainerId: string): Set<string> {
  const rows = ctx.db
    .prepare('SELECT theme_id AS id FROM trainer_themes WHERE trainer_id = ?')
    .all(trainerId) as Array<{ id: string }>
  // Das Grunddesign gehört jedem, ohne dass es je gekauft werden müsste.
  return new Set([DEFAULT_THEME.id, ...rows.map((r) => r.id)])
}

export function state(ctx: AppContext, trainer: Trainer): ThemesState {
  const owned = ownedIds(ctx, trainer.id)
  const setting = trainer.themeMode as ThemeSetting
  const mode = resolveMode(setting, worldClock().timeOfDay)

  const themes: ThemeView[] = THEMES.map((theme) => ({
    id: theme.id,
    name: `theme.${theme.id}.name`,
    description: `theme.${theme.id}.hint`,
    group: theme.group,
    price: theme.price,
    owned: owned.has(theme.id),
    active: trainer.themeId === theme.id,
    preview: swatchesOf(theme, mode),
  }))

  return {
    themes,
    gold: inventory.goldOf(ctx.db, trainer.id),
    activeId: owned.has(trainer.themeId) ? trainer.themeId : DEFAULT_THEME.id,
    mode: setting,
    resolvedMode: mode,
  }
}

export function buy(ctx: AppContext, trainer: Trainer, themeId: string): ThemesState {
  return tx(ctx.db, () => {
    const theme = findTheme(themeId)
    if (!theme) throw new GameError('not_found', { themeId }, 404)
    if (ownedIds(ctx, trainer.id).has(themeId)) {
      throw new GameError('invalid_state', { reason: 'already_owned' }, 409)
    }
    inventory.spendGold(ctx.db, trainer.id, theme.price)
    ctx.db.prepare('INSERT INTO trainer_themes (trainer_id, theme_id, bought_at) VALUES (?, ?, ?)')
      .run(trainer.id, theme.id, Date.now())
    // Gekauft heißt getragen: niemand kauft ein Design, um es nicht zu sehen.
    ctx.db.prepare('UPDATE trainers SET theme_id = ? WHERE id = ?').run(theme.id, trainer.id)
    logEvent(ctx.db, trainer.id, 'theme.buy', { themeId: theme.id, gold: theme.price })
    return state(ctx, { ...trainer, themeId: theme.id })
  })
}

export function wear(ctx: AppContext, trainer: Trainer, themeId: string): ThemesState {
  const theme = findTheme(themeId)
  if (!theme) throw new GameError('not_found', { themeId }, 404)
  if (!ownedIds(ctx, trainer.id).has(themeId)) {
    throw new GameError('invalid_state', { reason: 'not_owned', themeId }, 409)
  }
  ctx.db.prepare('UPDATE trainers SET theme_id = ? WHERE id = ?').run(themeId, trainer.id)
  logEvent(ctx.db, trainer.id, 'theme.wear', { themeId })
  return state(ctx, { ...trainer, themeId })
}

export function setMode(ctx: AppContext, trainer: Trainer, mode: ThemeSetting): ThemesState {
  ctx.db.prepare('UPDATE trainers SET theme_mode = ? WHERE id = ?').run(mode, trainer.id)
  return state(ctx, { ...trainer, themeMode: mode })
}
