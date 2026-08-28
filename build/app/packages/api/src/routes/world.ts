import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ENERGY_COSTS } from '@game/engine'
import type { AppContext } from '../context.js'
import { rateLimit, requireTrainer, withEnergy } from './plugin.js'
import { findById, setLevelScaling } from '../repos/trainers.js'
import * as worldService from '../services/world.js'
import * as safari from '../services/safari.js'
import * as energy from '../services/energy.js'
import * as expeditionService from '../services/expeditions.js'
import * as breeding from '../services/breeding.js'
import { counterValue } from '../repos/counters.js'

const TravelSchema = z.object({ areaId: z.string() })
/** Ball and berry ride along on every safari call so the displayed catch
 *  chance always reflects the player's current selection. */
const SafariSelectionSchema = z.object({
  ballId: z.string().default('poke-ball'),
  berryId: z.string().nullable().default(null),
})
const SoftenSchema = SafariSelectionSchema.extend({ action: z.enum(['weaken', 'calm']) })
const StartExpeditionSchema = z.object({
  kind: z.string(),
  duration: z.string(),
  creatureIds: z.array(z.string().uuid()).min(1).max(3),
})
const IdSchema = z.object({ id: z.string() })
const PairSchema = z.object({ creatureIdA: z.string().uuid(), creatureIdB: z.string().uuid() })

export function registerWorldRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'action')] }
  const write = { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'write_heavy')] }

  app.get('/api/world', auth, async (req) => worldService.worldMap(ctx, req.trainer!))

  app.post('/api/world/scaling', write, async (req) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body)
    setLevelScaling(ctx.db, req.trainer!.id, enabled)
    return worldService.worldMap(ctx, findById(ctx.db, req.trainer!.id)!)
  })

  app.post('/api/world/travel', write, async (req) => {
    const { areaId } = TravelSchema.parse(req.body)
    worldService.travelTo(ctx, req.trainer!, areaId)
    return worldService.worldMap(ctx, findById(ctx.db, req.trainer!.id)!)
  })

  app.get('/api/safari', auth, async (req) => {
    const q = SafariSelectionSchema.parse(req.query ?? {})
    const trainer = req.trainer!
    return {
      encounter: safari.currentEncounter(ctx, trainer, q.ballId, q.berryId),
      exploresUsed: counterValue(ctx.db, trainer.id, safari.EXPLORE_COUNTER),
      energy: energy.state(ctx, trainer.id),
      energyCost: ENERGY_COSTS.explore,
    }
  })

  app.post('/api/safari/explore', write, async (req) => {
    const { ballId, berryId } = SafariSelectionSchema.parse(req.body ?? {})
    return withEnergy(ctx, req.trainer!.id, safari.explore(ctx, req.trainer!, ballId, berryId))
  })

  app.post('/api/safari/berry', write, async (req) => {
    const { ballId, berryId } = SafariSelectionSchema.parse(req.body ?? {})
    return safari.useLegendaryBerry(ctx, req.trainer!, ballId, berryId)
  })

  app.post('/api/safari/soften', write, async (req) => {
    const { action, ballId, berryId } = SoftenSchema.parse(req.body)
    return safari.soften(ctx, req.trainer!, action, ballId, berryId)
  })

  app.post('/api/safari/throw', write, async (req) => {
    const { ballId, berryId } = SafariSelectionSchema.parse(req.body ?? {})
    return safari.throwBall(ctx, req.trainer!, ballId, berryId)
  })

  app.post('/api/safari/flee', write, async (req) => {
    safari.flee(ctx, req.trainer!)
    return { ok: true }
  })

  app.get('/api/expeditions', auth, async (req) => expeditionService.overview(ctx, req.trainer!))

  app.post('/api/expeditions', write, async (req) => {
    const body = StartExpeditionSchema.parse(req.body)
    const started = expeditionService.start(ctx, req.trainer!, body.kind, body.duration, body.creatureIds)
    return { expedition: started, overview: expeditionService.overview(ctx, findById(ctx.db, req.trainer!.id)!) }
  })

  app.post('/api/expeditions/collect', write, async (req) => {
    const { id } = IdSchema.parse(req.body)
    const result = expeditionService.collect(ctx, req.trainer!, id)
    return { result, overview: expeditionService.overview(ctx, findById(ctx.db, req.trainer!.id)!) }
  })

  app.get('/api/eggs', auth, async (req) => breeding.overview(ctx, req.trainer!))

  app.post('/api/eggs/pair', write, async (req) => {
    const { creatureIdA, creatureIdB } = PairSchema.parse(req.body)
    const egg = breeding.pair(ctx, req.trainer!, creatureIdA, creatureIdB)
    return { egg, overview: breeding.overview(ctx, req.trainer!) }
  })

  app.post('/api/eggs/hatch', write, async (req) => {
    const { id } = IdSchema.parse(req.body)
    const result = breeding.hatch(ctx, req.trainer!, id)
    return { ...result, overview: breeding.overview(ctx, req.trainer!) }
  })
}
