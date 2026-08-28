import type { Trainer } from '@game/shared'
import { checkLeagueGate, regionCleared, type LeagueGate } from '@game/engine'
import type { AppContext } from '../context.js'
import * as battles from '../repos/battles.js'
import * as world from '../repos/world.js'

/**
 * Liga-Fortschritt je Region.
 *
 * Alles hier ist abgeleitet, nichts gespeichert: welche Orden zu einer Region
 * gehören, steht im Content-Pack, und wer besiegt wurde, steht ohnehin schon in
 * `trainer_defeats`. Eine zusätzliche Tabelle wäre eine zweite Wahrheit, die
 * beim nächsten Content-Wechsel falsch wird.
 */

export interface RegionLeague {
  regionId: string
  eliteIds: string[]
  championId: string | null
  badgeIds: string[]
}

/** Top Vier, Meister und Orden einer Region, in der Reihenfolge des Packs. */
export function leagueOf(ctx: AppContext, regionId: string): RegionLeague {
  const areas = ctx.registry.allAreas.filter((a) => a.regionId === regionId)
  const eliteIds: string[] = []
  let championId: string | null = null
  const badgeIds: string[] = []

  for (const area of areas) {
    for (const id of area.trainerIds) {
      const def = ctx.registry.allTrainers.find((t) => t.id === id)
      if (def?.kind === 'elite') eliteIds.push(id)
    }
    if (!area.gymId) continue
    const gym = ctx.registry.allTrainers.find((t) => t.id === area.gymId)
    if (!gym) continue
    if (gym.kind === 'champion') championId = gym.id
    if (gym.badgeId) badgeIds.push(gym.badgeId)
  }
  return { regionId, eliteIds, championId, badgeIds }
}

/** Zu welcher Region ein Trainer gehört — über das Gebiet, in dem er steht. */
export function regionOfTrainer(ctx: AppContext, trainerId: string): string | null {
  const area = ctx.registry.allAreas.find(
    (a) => a.gymId === trainerId || a.trainerIds.includes(trainerId),
  )
  return area?.regionId ?? null
}

/** Darf dieser Kampf jetzt stattfinden? */
export function gateFor(ctx: AppContext, trainer: Trainer, opponentId: string): LeagueGate {
  const regionId = regionOfTrainer(ctx, opponentId)
  if (!regionId) return { ok: true }
  const league = leagueOf(ctx, regionId)
  if (!league.eliteIds.includes(opponentId) && league.championId !== opponentId) return { ok: true }

  const defeated = new Set(battles.defeatsOf(ctx.db, trainer.id).keys())
  return checkLeagueGate(opponentId, league.eliteIds, league.championId, defeated)
}

/** Regionen, die der Trainer vollständig bezwungen hat. */
export function clearedRegions(ctx: AppContext, trainer: Trainer): Set<string> {
  const badges = world.badgesOf(ctx.db, trainer.id)
  const defeated = new Set(battles.defeatsOf(ctx.db, trainer.id).keys())
  const done = new Set<string>()
  for (const region of ctx.registry.allRegions) {
    const league = leagueOf(ctx, region.id)
    if (regionCleared(league.badgeIds, badges, league.championId, defeated)) done.add(region.id)
  }
  return done
}

export interface LeagueProgress {
  regionId: string
  regionName: string
  cleared: boolean
  badges: { have: number; need: number }
  elites: Array<{ id: string; name: string; defeated: boolean; locked: boolean }>
  champion: { id: string; name: string; defeated: boolean; locked: boolean } | null
}

/** Was die Weltkarte und der Gebietsbildschirm über die Liga anzeigen. */
export function progressOf(ctx: AppContext, trainer: Trainer): LeagueProgress[] {
  const badges = world.badgesOf(ctx.db, trainer.id)
  const defeated = new Set(battles.defeatsOf(ctx.db, trainer.id).keys())

  return ctx.registry.allRegions.map((region) => {
    const league = leagueOf(ctx, region.id)
    const nameOf = (id: string) => {
      const def = ctx.registry.allTrainers.find((t) => t.id === id)
      return def ? ctx.registry.localized(def.name, trainer.locale) : id
    }
    return {
      regionId: region.id,
      regionName: ctx.registry.localized(region.name, trainer.locale),
      cleared: regionCleared(league.badgeIds, badges, league.championId, defeated),
      badges: {
        have: league.badgeIds.filter((b) => badges.has(b)).length,
        need: league.badgeIds.length,
      },
      elites: league.eliteIds.map((id) => ({
        id,
        name: nameOf(id),
        defeated: defeated.has(id),
        locked: !checkLeagueGate(id, league.eliteIds, league.championId, defeated).ok,
      })),
      champion: league.championId
        ? {
            id: league.championId,
            name: nameOf(league.championId),
            defeated: defeated.has(league.championId),
            locked: !checkLeagueGate(league.championId, league.eliteIds, league.championId, defeated).ok,
          }
        : null,
    }
  })
}
