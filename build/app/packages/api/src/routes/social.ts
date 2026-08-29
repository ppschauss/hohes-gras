import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { rateLimit, requireTrainer } from './plugin.js'
import { findById } from '../repos/trainers.js'
import * as social from '../services/social.js'
import * as gifts from '../services/gifts.js'

const CodeSchema = z.object({ code: z.string().trim().min(4).max(16) })
const IdSchema = z.object({ trainerId: z.string().uuid() })
const RespondSchema = z.object({ fromId: z.string().uuid(), accept: z.boolean() })
const ListSchema = z.object({
  creatureId: z.string().uuid(),
  price: z.number().int().min(social.MIN_PRICE).max(social.MAX_PRICE),
  note: z.string().max(140).default(''),
})
const OfferSchema = z.object({
  toTrainerId: z.string().uuid(),
  offeredId: z.string().uuid(),
  requestedId: z.string().uuid().nullable().default(null),
  message: z.string().max(140).default(''),
})
const TradeRespondSchema = z.object({ tradeId: z.string().uuid(), accept: z.boolean() })
const PrivacySchema = z.object({
  hideFromLeaderboard: z.boolean().optional(),
  friendsOnlyInteractions: z.boolean().optional(),
  allowFriendRequests: z.boolean().optional(),
  reminders: z.boolean().optional(),
})

export function registerSocialRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'action')] }
  const write = { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'social')] }

  app.get('/api/friends', auth, async (req) => social.friendOverview(ctx, req.trainer!))

  app.post('/api/friends/request', write, async (req) => {
    const { code } = CodeSchema.parse(req.body)
    return social.requestFriend(ctx, req.trainer!, code)
  })

  app.post('/api/friends/respond', write, async (req) => {
    const { fromId, accept } = RespondSchema.parse(req.body)
    social.respondToRequest(ctx, req.trainer!, fromId, accept)
    return social.friendOverview(ctx, req.trainer!)
  })

  app.post('/api/friends/gift', write, async (req) => {
    const { trainerId } = z.object({ trainerId: z.string().uuid() }).parse(req.body)
    const sent = gifts.send(ctx, req.trainer!, trainerId)
    return { sent, friends: social.friendOverview(ctx, req.trainer!) }
  })

  app.post('/api/gifts/open', write, async (req) => {
    const { giftId } = z.object({ giftId: z.string().min(1) }).parse(req.body)
    const opened = gifts.open(ctx, req.trainer!, giftId)
    return { opened, friends: social.friendOverview(ctx, req.trainer!) }
  })

  app.post('/api/friends/remove', write, async (req) => {
    const { trainerId } = IdSchema.parse(req.body)
    social.removeFriend(ctx, req.trainer!, trainerId)
    return social.friendOverview(ctx, req.trainer!)
  })

  app.get('/api/card/:trainerId', auth, async (req) => {
    const { trainerId } = z.object({ trainerId: z.string().uuid() }).parse(req.params)
    return social.trainerCard(ctx, req.trainer!, trainerId)
  })

  app.get('/api/card', auth, async (req) => social.trainerCard(ctx, req.trainer!, req.trainer!.id))

  app.get('/api/market', auth, async (req) => social.marketOverview(ctx, req.trainer!))

  app.post('/api/market/list', write, async (req) => {
    const { creatureId, price, note } = ListSchema.parse(req.body)
    social.createListing(ctx, req.trainer!, creatureId, price, note)
    return social.marketOverview(ctx, findById(ctx.db, req.trainer!.id)!)
  })

  app.post('/api/market/cancel', write, async (req) => {
    const { listingId } = z.object({ listingId: z.string().uuid() }).parse(req.body)
    social.cancelListing(ctx, req.trainer!, listingId)
    return social.marketOverview(ctx, req.trainer!)
  })

  app.post('/api/market/buy', write, async (req) => {
    const { listingId } = z.object({ listingId: z.string().uuid() }).parse(req.body)
    const result = social.buyListing(ctx, req.trainer!, listingId)
    return { ...result, market: social.marketOverview(ctx, findById(ctx.db, req.trainer!.id)!) }
  })

  app.get('/api/trades', auth, async (req) => social.tradeOverview(ctx, req.trainer!))

  app.post('/api/trades/offer', write, async (req) => {
    const body = OfferSchema.parse(req.body)
    social.offerTrade(ctx, req.trainer!, body.toTrainerId, body.offeredId, body.requestedId, body.message)
    return social.tradeOverview(ctx, req.trainer!)
  })

  app.post('/api/trades/respond', write, async (req) => {
    const { tradeId, accept } = TradeRespondSchema.parse(req.body)
    const result = social.respondToTrade(ctx, req.trainer!, tradeId, accept)
    return { ...result, trades: social.tradeOverview(ctx, req.trainer!) }
  })

  app.get('/api/leaderboard', auth, async (req) => social.leaderboardView(ctx, req.trainer!))

  app.post('/api/privacy', write, async (req) => {
    const changes = PrivacySchema.parse(req.body)
    social.updatePrivacy(ctx, req.trainer!, changes)
    return findById(ctx.db, req.trainer!.id)!
  })
}
