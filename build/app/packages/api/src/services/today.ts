import type { Trainer } from '@game/shared'
import { ENERGY_COSTS, hatchProgress, phasesDue, plotReady, PLOT_GROWTH_MS, PLOT_PHASES } from '@game/engine'
import type { AppContext } from '../context.js'
import * as expeditions from '../repos/expeditions.js'
import * as plotsRepo from '../repos/plots.js'
import * as eggs from '../repos/eggs.js'
import * as pvp from '../repos/pvp.js'
import * as raids from '../repos/raids.js'
import * as guilds from '../repos/guilds.js'
import * as creatures from '../repos/creatures.js'
import * as dex from '../repos/dex.js'
import * as world from '../repos/world.js'
import * as energy from './energy.js'
import * as centerService from './center.js'

/**
 * Was gerade dran ist.
 *
 * Der Startbildschirm war eine Liste von Türen — jedes Mal dieselbe, egal was
 * dahinter los war. Diese Abfrage beantwortet stattdessen die einzige Frage,
 * mit der man eine Mini-App öffnet: *hat sich etwas getan?*
 *
 * Bewusst eine einzige Anfrage. Fünf parallele Abrufe für fünf Zahlen wären
 * auf einer Mobilverbindung deutlich langsamer als eine Abfrage über fünf
 * Tabellen, die alle ohnehin einen Index auf `trainer_id` haben.
 */
export type TaskKind =
  | 'expedition' | 'plot_harvest' | 'plot_tend' | 'center' | 'egg'
  | 'pvp' | 'raid' | 'care'

export interface TodayTask {
  kind: TaskKind
  /** Zielbildschirm für den Tipp auf die Karte. */
  screen: string
  /** Zahl für die Karte; 0, wenn es nichts zu zählen gibt. */
  count: number
  /** Je kleiner, desto weiter oben. Fertiges vor Wartendem. */
  order: number
}

export interface TodayView {
  tasks: TodayTask[]
  energy: ReturnType<typeof energy.state>
  gold: number
  teamSize: number
  /** Nächster Zeitpunkt, an dem von selbst etwas fertig wird. */
  nextAt: number | null
  /** Die drei Zahlen, an denen man den eigenen Fortschritt abliest. */
  journey: {
    areaName: string | null
    dexCaught: number
    dexTotal: number
    badges: number
    badgeTotal: number
  }
}

export function today(ctx: AppContext, trainer: Trainer, now = Date.now()): TodayView {
  const tasks: TodayTask[] = []
  const upcoming: number[] = []

  const open = expeditions.openOf(ctx.db, trainer.id)
  const doneExpeditions = open.filter((e) => now >= e.endsAt).length
  if (doneExpeditions > 0) tasks.push({ kind: 'expedition', screen: 'expeditions', count: doneExpeditions, order: 1 })
  for (const e of open) if (e.endsAt > now) upcoming.push(e.endsAt)

  const plots = plotsRepo.openOf(ctx.db, trainer.id)
  const ripe = plots.filter((p) => plotReady(p.plantedAt, now, PLOT_GROWTH_MS)).length
  if (ripe > 0) tasks.push({ kind: 'plot_harvest', screen: 'plots', count: ripe, order: 0 })
  const needsCare = plots.filter((p) =>
    !p.tenderId
    && !plotReady(p.plantedAt, now, PLOT_GROWTH_MS)
    && phasesDue(p.plantedAt, now, PLOT_GROWTH_MS, PLOT_PHASES) > p.phasesDone).length
  if (needsCare > 0) tasks.push({ kind: 'plot_tend', screen: 'plots', count: needsCare, order: 3 })
  for (const p of plots) if (p.readyAt > now) upcoming.push(p.readyAt)

  const hatchable = eggs.openOf(ctx.db, trainer.id)
    .filter((e) => hatchProgress(e.startedAt, e.hatchMinutes, now) >= 1).length
  if (hatchable > 0) tasks.push({ kind: 'egg', screen: 'eggs', count: hatchable, order: 2 })

  // Über den Center-Dienst statt über eine eigene Abfrage: "angeschlagen"
  // bedeutet dort unter vollen KP, und diese Regel soll an einer Stelle stehen.
  const centerState = centerService.state(ctx, trainer, now)
  if (centerState.ready) {
    if (centerState.hurt > 0) {
      tasks.push({ kind: 'center', screen: 'center', count: centerState.hurt, order: 1 })
    }
  } else {
    upcoming.push(centerState.readyAt)
  }

  const defended = pvp.unseenDefences(ctx.db, trainer.id)
  if (defended > 0) tasks.push({ kind: 'pvp', screen: 'coop', count: defended, order: 4 })

  const guild = guilds.guildOf(ctx.db, trainer.id)
  if (guild) {
    const active = raids.openForGuild(ctx.db, guild.id, now).length
    if (active > 0) tasks.push({ kind: 'raid', screen: 'coop', count: active, order: 2 })
  }

  const state = energy.state(ctx, trainer.id, now)
  const team = creatures.teamOf(ctx.db, trainer.id)
  if (team.length > 0 && state.current >= ENERGY_COSTS.care && tasks.length === 0) {
    // Nur wenn sonst nichts ansteht: eine Karte, die immer da ist, ist keine
    // Meldung mehr, sondern Möblierung.
    tasks.push({ kind: 'care', screen: 'garden', count: 0, order: 9 })
  }

  return {
    tasks: tasks.sort((a, b) => a.order - b.order),
    energy: state,
    gold: (ctx.db.prepare('SELECT gold AS g FROM trainers WHERE id = ?')
      .get(trainer.id) as { g: number }).g,
    teamSize: team.length,
    nextAt: upcoming.length > 0 ? Math.min(...upcoming) : null,
    journey: {
      areaName: trainer.currentAreaId
        ? (() => {
            const area = ctx.registry.tryArea(trainer.currentAreaId)
            return area ? ctx.registry.localized(area.name, trainer.locale) : null
          })()
        : null,
      dexCaught: dex.dexCounts(ctx.db, trainer.id).caught,
      dexTotal: ctx.registry.speciesCount,
      badges: world.badgesOf(ctx.db, trainer.id).size,
      badgeTotal: ctx.registry.allBadges.length,
    },
  }
}
