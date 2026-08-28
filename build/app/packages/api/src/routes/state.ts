import type { FastifyInstance } from 'fastify'
import type { Bootstrap } from '@game/shared'
import type { AppContext } from '../context.js'
import { worldClock } from '../worldClock.js'
import { rateLimit, requireTrainer } from './plugin.js'
import * as energy from '../services/energy.js'
import * as todayService from '../services/today.js'
import * as travel from '../services/travel.js'
import { ENERGY_COSTS } from '@game/engine'

/** Which feature slices the client should render. Later phases flip these on as
 *  they land, so a half-built tab never shows up in the UI by accident. */
export const FEATURES: Record<string, boolean> = {
  garden: true,
  worldmap: true,
  safari: true,
  shop: true,
  battle: true,
  social: true,
  guilds: true,
  story: true,
  teams: true,
  energy: true,
  center: true,
  plots: true,
  themes: true,
}

export function registerStateRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get(
    '/api/today',
    { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'action')] },
    async (req) => todayService.today(ctx, req.trainer!),
  )

  app.get('/api/health', async () => ({
    ok: true,
    uptimeSeconds: Math.floor((Date.now() - ctx.startedAt) / 1000),
    pack: ctx.registry.manifest.id,
    species: ctx.registry.speciesCount,
  }))

  app.get(
    '/api/state',
    { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'action')] },
    async (req): Promise<Bootstrap> => ({
      trainer: req.trainer!,
      clock: worldClock(),
      energy: energy.state(ctx, req.trainer!.id),
      travel: travel.viewOf(ctx, req.trainer!),
      energyCosts: { ...ENERGY_COSTS },
      energyPacks: energy.packViews(),
      contentPack: {
        id: ctx.registry.manifest.id,
        name: ctx.registry.manifest.name,
        version: ctx.registry.manifest.version,
      },
      features: FEATURES,
      serverTime: Date.now(),
    }),
  )
}
