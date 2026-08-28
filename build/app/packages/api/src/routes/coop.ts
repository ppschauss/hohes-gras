import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { RaidTier } from '@game/engine'
import type { AppContext } from '../context.js'
import { rateLimit, requireTrainer } from './plugin.js'
import { findById } from '../repos/trainers.js'
import * as guilds from '../services/guilds.js'
import * as raids from '../services/raids.js'
import * as pvp from '../services/pvp.js'
import * as tournament from '../services/tournament.js'

const FoundSchema = z.object({
  name: z.string().trim().min(3).max(24),
  tag: z.string().trim().min(2).max(5),
  motto: z.string().max(120).default(''),
})
const GuildIdSchema = z.object({ guildId: z.string().uuid() })
const TierSchema = z.object({ tier: z.union([z.literal(1), z.literal(3), z.literal(5)]) })
const RaidIdSchema = z.object({ raidId: z.string().uuid() })
const OpponentSchema = z.object({ opponentId: z.string().uuid() })

export function registerCoopRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'action')] }
  const write = { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'social')] }
  const heavy = { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'write_heavy')] }

  app.get('/api/guild', auth, async (req) => guilds.overview(ctx, req.trainer!))

  app.post('/api/guild/found', write, async (req) => {
    const body = FoundSchema.parse(req.body)
    guilds.found(ctx, req.trainer!, body.name, body.tag, body.motto)
    return guilds.overview(ctx, findById(ctx.db, req.trainer!.id)!)
  })

  app.post('/api/guild/join', write, async (req) => {
    const { guildId } = GuildIdSchema.parse(req.body)
    guilds.join(ctx, req.trainer!, guildId)
    return guilds.overview(ctx, req.trainer!)
  })

  app.post('/api/guild/leave', write, async (req) => {
    guilds.leave(ctx, req.trainer!)
    return guilds.overview(ctx, req.trainer!)
  })

  app.post('/api/guild/claim', write, async (req) => {
    const result = guilds.claimWeeklyReward(ctx, req.trainer!)
    return { ...result, guild: guilds.overview(ctx, findById(ctx.db, req.trainer!.id)!) }
  })

  app.get('/api/raids', auth, async (req) => raids.overview(ctx, req.trainer!))

  app.post('/api/raids/summon', heavy, async (req) => {
    const { tier } = TierSchema.parse(req.body)
    raids.summon(ctx, req.trainer!, tier as RaidTier)
    return raids.overview(ctx, req.trainer!)
  })

  app.post('/api/raids/attack', heavy, async (req) => {
    const { raidId } = RaidIdSchema.parse(req.body)
    return raids.attack(ctx, req.trainer!, raidId)
  })

  app.get('/api/pvp', auth, async (req) => pvp.findMatches(ctx, req.trainer!))
  app.get('/api/pvp/ladder', auth, async (req) => pvp.ladderView(ctx, req.trainer!))
  app.get('/api/pvp/history', auth, async (req) => ({ duels: pvp.history(ctx, req.trainer!) }))

  app.post('/api/pvp/duel', heavy, async (req) => {
    const { opponentId } = OpponentSchema.parse(req.body)
    return pvp.duel(ctx, req.trainer!, opponentId)
  })

  app.get('/api/tournament', auth, async (req) => tournament.overview(ctx, req.trainer!))

  app.post('/api/tournament/enter', write, async (req) => tournament.enter(ctx, req.trainer!))
}
