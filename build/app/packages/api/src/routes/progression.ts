import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { rateLimit, requireTrainer } from './plugin.js'
import { findById } from '../repos/trainers.js'
import * as progression from '../services/progression.js'
import * as story from '../services/story.js'
import * as login from '../services/login.js'
import * as research from '../services/research.js'
import * as boarding from '../services/boarding.js'
import * as quests from '../services/quests.js'

const EvolveSchema = z.object({ creatureId: z.string().uuid(), targetSpeciesId: z.string() })
const BuildingSchema = z.object({ buildingId: z.string() })
const RecipeSchema = z.object({ recipeId: z.string() })
const TierSchema = z.object({ tier: z.number().int().min(1).max(30) })
const AchievementSchema = z.object({ achievementId: z.string() })
const ResearchSchema = z.object({ projectId: z.string(), creatureId: z.string().uuid() })
const TrainSchema = z.object({
  creatureId: z.string().uuid(),
  stat: z.enum(['hp', 'atk', 'def', 'spa', 'spd', 'spe']),
})
const ResearchIdSchema = z.object({ id: z.string().uuid() })
const CreatureIdSchema = z.object({ creatureId: z.string().uuid() })

export function registerProgressionRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'action')] }
  const write = { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'write_heavy')] }

  app.get('/api/evolutions', auth, async (req) => ({ candidates: progression.evolvable(ctx, req.trainer!) }))

  app.post('/api/evolutions/evolve', write, async (req) => {
    const { creatureId, targetSpeciesId } = EvolveSchema.parse(req.body)
    return progression.evolve(ctx, req.trainer!, creatureId, targetSpeciesId)
  })

  app.get('/api/buildings', auth, async (req) => progression.buildingsView(ctx, req.trainer!))

  app.post('/api/buildings/upgrade', write, async (req) => {
    const { buildingId } = BuildingSchema.parse(req.body)
    const result = progression.upgrade(ctx, req.trainer!, buildingId)
    return { ...result, buildings: progression.buildingsView(ctx, findById(ctx.db, req.trainer!.id)!) }
  })

  app.get('/api/crafting', auth, async (req) => progression.craftingView(ctx, req.trainer!))

  app.post('/api/crafting/craft', write, async (req) => {
    const { recipeId } = RecipeSchema.parse(req.body)
    const result = progression.craft(ctx, req.trainer!, recipeId)
    return { ...result, crafting: progression.craftingView(ctx, findById(ctx.db, req.trainer!.id)!) }
  })

  app.get('/api/research', auth, async (req) => research.view(ctx, req.trainer!))

  app.post('/api/research/start', write, async (req) => {
    const { projectId, creatureId } = ResearchSchema.parse(req.body)
    research.start(ctx, req.trainer!, projectId, creatureId)
    return { research: research.view(ctx, findById(ctx.db, req.trainer!.id)!) }
  })

  app.post('/api/research/train', write, async (req) => {
    const { creatureId, stat } = TrainSchema.parse(req.body)
    research.train(ctx, req.trainer!, creatureId, stat)
    return { research: research.view(ctx, findById(ctx.db, req.trainer!.id)!) }
  })

  app.post('/api/research/collect', write, async (req) => {
    const { id } = ResearchIdSchema.parse(req.body)
    const result = research.collect(ctx, req.trainer!, id)
    return { result, research: research.view(ctx, findById(ctx.db, req.trainer!.id)!) }
  })

  app.post('/api/research/abort', write, async (req) => {
    const { id } = ResearchIdSchema.parse(req.body)
    research.abort(ctx, req.trainer!, id)
    return { research: research.view(ctx, findById(ctx.db, req.trainer!.id)!) }
  })

  app.get('/api/quests', auth, async (req) => quests.view(ctx, req.trainer!))

  app.post('/api/quests/claim', write, async (req) => {
    const { questId } = z.object({ questId: z.string() }).parse(req.body)
    const result = quests.claim(ctx, req.trainer!, questId)
    return { result, quests: quests.view(ctx, findById(ctx.db, req.trainer!.id)!) }
  })

  app.get('/api/boarding', auth, async (req) => boarding.view(ctx, req.trainer!))

  app.post('/api/boarding/drop', write, async (req) => {
    const { creatureId } = CreatureIdSchema.parse(req.body)
    boarding.drop(ctx, req.trainer!, creatureId)
    return { boarding: boarding.view(ctx, findById(ctx.db, req.trainer!.id)!) }
  })

  app.post('/api/boarding/pick', write, async (req) => {
    const { id } = ResearchIdSchema.parse(req.body)
    const result = boarding.pick(ctx, req.trainer!, id)
    return { result, boarding: boarding.view(ctx, findById(ctx.db, req.trainer!.id)!) }
  })

  app.get('/api/login', auth, async (req) => login.view(ctx, req.trainer!))

  app.post('/api/login/claim', write, async (req) => login.claim(ctx, req.trainer!))

  app.get('/api/season', auth, async (req) => progression.seasonView(ctx, req.trainer!))

  app.post('/api/season/claim', write, async (req) => {
    const { tier } = TierSchema.parse(req.body)
    const result = progression.claimSeasonTier(ctx, req.trainer!, tier)
    return { ...result, season: progression.seasonView(ctx, findById(ctx.db, req.trainer!.id)!) }
  })

  app.get('/api/story', auth, async (req) => story.storyView(ctx, req.trainer!))

  app.post('/api/story/claim', write, async (req) => {
    const { chapterId } = z.object({ chapterId: z.string() }).parse(req.body)
    const result = story.claimChapter(ctx, req.trainer!, chapterId)
    return { ...result, story: story.storyView(ctx, findById(ctx.db, req.trainer!.id)!) }
  })

  app.get('/api/achievements', auth, async (req) => progression.achievementsView(ctx, req.trainer!))

  app.post('/api/achievements/claim', write, async (req) => {
    const { achievementId } = AchievementSchema.parse(req.body)
    const result = progression.claimAchievement(ctx, req.trainer!, achievementId)
    return { ...result, achievements: progression.achievementsView(ctx, findById(ctx.db, req.trainer!.id)!) }
  })
}
