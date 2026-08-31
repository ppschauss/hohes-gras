import { GameError, type TeamsState, type TeamView, type Trainer } from '@game/shared'
import { TEAM_CAPACITY } from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as teams from '../repos/teams.js'
import * as creatures from '../repos/creatures.js'
import * as expeditions from '../repos/expeditions.js'
import { logEvent } from '../repos/events.js'
import { worldClock } from '../worldClock.js'
import { creatureView } from './views.js'
import { capOf } from './travel.js'
import { busyCreatureIds } from './busy.js'

/**
 * Teams verwalten.
 *
 * Das aktive Team ist die Projektion eines Teams auf `creatures.team_slot`.
 * Alles andere im Spiel — Garten, Kampf, Pflege — liest weiterhin nur diese
 * Spalte und muss von Teams nichts wissen. Das ist der Grund fuer die
 * Doppelhaltung: sie haelt die Aenderung lokal statt sie durch zwanzig
 * Abfragen zu tragen.
 */

export const MAX_TEAMS = 8

/** Jeder Trainer hat mindestens ein Team. Bestandsspieler bekamen es per
 *  Migration; wer danach neu anfaengt, hier. */
export function ensureDefault(ctx: AppContext, trainerId: string): string {
  const existing = teams.listOf(ctx.db, trainerId)
  if (existing.length > 0) {
    const activeId = teams.activeIdOf(ctx.db, trainerId)
    if (!activeId || !existing.some((t) => t.id === activeId)) {
      teams.setActive(ctx.db, trainerId, existing[0]!.id)
      return existing[0]!.id
    }
    return activeId
  }

  const created = teams.create(ctx.db, trainerId, 'Team 1')
  // Was schon im Garten steht, ist das erste Team — nicht ein leeres daneben.
  teams.setMembers(ctx.db, created.id, creatures.teamOf(ctx.db, trainerId).map((c) => c.id))
  teams.setActive(ctx.db, trainerId, created.id)
  return created.id
}

export function overview(ctx: AppContext, trainer: Trainer): TeamsState {
  // Selbstheilend statt an jeder schreibenden Stelle nachgezogen: alles, was
  // eine Kreatur in einen Gartenslot setzt (Fang, Starter, spaetere Wege),
  // bleibt dadurch automatisch mit dem aktiven Team konsistent.
  syncActiveFromGarden(ctx, trainer.id)
  const activeId = ensureDefault(ctx, trainer.id)
  const clock = worldClock()
  const busy = busyCreatureIds(ctx, trainer.id)
  const cap = capOf(ctx, trainer)
  const view = (id: string) => {
    const c = creatures.byId(ctx.db, id)
    return c && c.ownerId === trainer.id
      ? creatureView(ctx.registry, c, trainer.locale, clock.timeOfDay, cap)
      : null
  }

  const list: TeamView[] = teams.listOf(ctx.db, trainer.id).map((t) => ({
    id: t.id,
    name: t.name,
    active: t.id === activeId,
    createdAt: t.createdAt,
    members: teams.membersOf(ctx.db, t.id)
      .map(view)
      .filter((c): c is NonNullable<typeof c> => c !== null),
  }))

  const inActive = new Set(list.find((t) => t.active)?.members.map((m) => m.id) ?? [])
  const all = creatures.teamOf(ctx.db, trainer.id)
    .concat(creatures.allBoxOf(ctx.db, trainer.id))

  return {
    teams: list,
    activeTeamId: activeId,
    capacity: TEAM_CAPACITY,
    maxTeams: MAX_TEAMS,
    box: all
      .filter((c) => !inActive.has(c.id))
      .map((c) => creatureView(ctx.registry, c, trainer.locale, clock.timeOfDay, cap)),
    busyCreatureIds: [...busy],
  }
}

function requireOwn(ctx: AppContext, trainer: Trainer, teamId: string): teams.TeamRow {
  const team = teams.byId(ctx.db, teamId)
  if (!team) throw new GameError('not_found', { teamId }, 404)
  if (team.trainerId !== trainer.id) throw new GameError('not_owner', { teamId }, 403)
  return team
}

export function create(ctx: AppContext, trainer: Trainer, name: string): TeamsState {
  return tx(ctx.db, () => {
    ensureDefault(ctx, trainer.id)
    if (teams.countOf(ctx.db, trainer.id) >= MAX_TEAMS) {
      throw new GameError('invalid_state', { reason: 'too_many_teams', max: MAX_TEAMS }, 409)
    }
    const created = teams.create(ctx.db, trainer.id, name)
    logEvent(ctx.db, trainer.id, 'team.create', { teamId: created.id, name: created.name })
    return overview(ctx, trainer)
  })
}

export function rename(ctx: AppContext, trainer: Trainer, teamId: string, name: string): TeamsState {
  return tx(ctx.db, () => {
    requireOwn(ctx, trainer, teamId)
    teams.rename(ctx.db, teamId, name)
    return overview(ctx, trainer)
  })
}

export function remove(ctx: AppContext, trainer: Trainer, teamId: string): TeamsState {
  return tx(ctx.db, () => {
    requireOwn(ctx, trainer, teamId)
    if (teams.countOf(ctx.db, trainer.id) <= 1) {
      throw new GameError('invalid_state', { reason: 'last_team' }, 409)
    }
    const wasActive = teams.activeIdOf(ctx.db, trainer.id) === teamId
    teams.remove(ctx.db, teamId)
    if (wasActive) {
      const next = teams.listOf(ctx.db, trainer.id)[0]!
      activateRow(ctx, trainer, next.id)
    }
    logEvent(ctx.db, trainer.id, 'team.delete', { teamId })
    return overview(ctx, trainer)
  })
}

export function setMembers(
  ctx: AppContext,
  trainer: Trainer,
  teamId: string,
  creatureIds: string[],
): TeamsState {
  return tx(ctx.db, () => {
    requireOwn(ctx, trainer, teamId)
    const unique = [...new Set(creatureIds)]
    if (unique.length !== creatureIds.length) {
      throw new GameError('validation_failed', { reason: 'duplicate_ids' })
    }
    if (unique.length > TEAM_CAPACITY) {
      throw new GameError('validation_failed', { field: 'creatureIds', max: TEAM_CAPACITY })
    }
    // Fremde Kreaturen: ohne diese Pruefung koennte man sich durch Raten einer
    // Id ein fremdes Pokemon ins Team holen.
    for (const id of unique) {
      const c = creatures.byId(ctx.db, id)
      if (!c) throw new GameError('not_found', { creatureId: id }, 404)
      if (c.ownerId !== trainer.id) throw new GameError('not_owner', { creatureId: id }, 403)
    }

    teams.setMembers(ctx.db, teamId, unique)
    // Das aktive Team bleibt mit dem Garten synchron, sonst kaempfte man mit
    // einer anderen Aufstellung als der angezeigten.
    if (teams.activeIdOf(ctx.db, trainer.id) === teamId) {
      creatures.setTeam(ctx.db, trainer.id, unique)
    }
    return overview(ctx, trainer)
  })
}

export function activate(ctx: AppContext, trainer: Trainer, teamId: string): TeamsState {
  return tx(ctx.db, () => {
    requireOwn(ctx, trainer, teamId)
    activateRow(ctx, trainer, teamId)
    return overview(ctx, trainer)
  })
}

function activateRow(ctx: AppContext, trainer: Trainer, teamId: string): void {
  const members = teams.membersOf(ctx.db, teamId)
  teams.setActive(ctx.db, trainer.id, teamId)
  creatures.setTeam(ctx.db, trainer.id, members)
  logEvent(ctx.db, trainer.id, 'team.activate', { teamId, members: members.length })
}

/**
 * Das Gartenteam als Team-Mitgliedschaft nachziehen.
 *
 * Ein gefangenes Pokemon rutscht direkt in einen freien Gartenslot. Ohne diesen
 * Abgleich stuende es im Garten, aber nicht im aktiven Team — und waere beim
 * naechsten Teamwechsel wieder weg.
 */
export function syncActiveFromGarden(ctx: AppContext, trainerId: string): void {
  const activeId = ensureDefault(ctx, trainerId)
  const inGarden = creatures.teamOf(ctx.db, trainerId).map((c) => c.id)
  const stored = teams.membersOf(ctx.db, activeId)
  if (inGarden.length === stored.length && inGarden.every((id, i) => id === stored[i])) return
  teams.setMembers(ctx.db, activeId, inGarden)
}
