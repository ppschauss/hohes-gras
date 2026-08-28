import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { rateLimit, requireTrainer, withEnergy } from './plugin.js'
import { findById } from '../repos/trainers.js'
import * as battle from '../services/battle.js'
import { requireCurrentArea } from '../services/world.js'

const StartSchema = z.object({ opponentId: z.string() })
const ActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('move'), moveIndex: z.number().int().min(0).max(3) }),
  z.object({ kind: z.literal('switch'), partyIndex: z.number().int().min(0).max(4) }),
  z.object({ kind: z.literal('forfeit') }),
])

export function registerBattleRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'action')] }
  const write = { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'write_heavy')] }

  app.get('/api/battle/opponents', auth, async (req) => {
    const trainer = req.trainer!
    const area = requireCurrentArea(ctx, trainer)
    return battle.opponentsIn(ctx, trainer, area.id)
  })

  app.get('/api/battle', auth, async (req) => ({ battle: battle.current(ctx, req.trainer!) }))

  app.post('/api/battle/event', write, async (req) => battle.startEvent(ctx, req.trainer!))

  app.post('/api/battle/start', write, async (req) => {
    const { opponentId } = StartSchema.parse(req.body)
    return withEnergy(ctx, req.trainer!.id, battle.start(ctx, req.trainer!, opponentId))
  })

  app.post('/api/battle/action', write, async (req) => {
    const action = ActionSchema.parse(req.body)
    return battle.submit(ctx, req.trainer!, action)
  })

  app.post('/api/battle/forfeit', write, async (req) => battle.forfeit(ctx, req.trainer!))

  app.post('/api/team/heal', write, async (req) => {
    const result = battle.healTeam(ctx, req.trainer!)
    const fresh = findById(ctx.db, req.trainer!.id)!
    return { ...result, gold: fresh.gold }
  })
}
