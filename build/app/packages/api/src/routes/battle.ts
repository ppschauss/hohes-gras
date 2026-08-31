import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import type { AppContext } from '../context.js'
import { rateLimit, requireTrainer, withEnergy } from './plugin.js'
import { findById } from '../repos/trainers.js'
import * as battle from '../services/battle.js'
import * as arena from '../services/arena.js'
import * as gauntlet from '../services/gauntlet.js'
import { requireCurrentArea } from '../services/world.js'

const StartSchema = z.object({ opponentId: z.string() })
const ActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('move'), moveIndex: z.number().int().min(0).max(3) }),
  z.object({ kind: z.literal('switch'), partyIndex: z.number().int().min(0).max(4) }),
  z.object({
    kind: z.literal('item'),
    itemId: z.string().min(1).max(64),
    targetIndex: z.number().int().min(0).max(4),
  }),
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

  app.get('/api/battle', auth, async (req) => ({
    battle: battle.current(ctx, req.trainer!),
    arena: arena.contextFor(ctx, req.trainer!),
    gauntlet: gauntlet.contextFor(ctx, req.trainer!),
  }))

  app.post('/api/battle/event', write, async (req) => battle.startEvent(ctx, req.trainer!))

  app.post('/api/battle/start', write, async (req) => {
    const { opponentId } = StartSchema.parse(req.body)
    return withEnergy(ctx, req.trainer!.id, battle.start(ctx, req.trainer!, opponentId))
  })

  app.post('/api/battle/action', write, async (req) => {
    const action = ActionSchema.parse(req.body)
    const view = battle.submit(ctx, req.trainer!, action)

    /*
     * Im Arenadurchlauf geht es von selbst weiter.
     *
     * Vorher musste der Bildschirm den naechsten Kampf anfordern — und wer
     * stattdessen zurueckging, stand vor einem beendeten Kampf und den alten
     * Gegnern. Der Wechsel gehoert an dieselbe Stelle wie der letzte Zug:
     * gewonnen, geheilt, naechster Gegner, eine Antwort.
     */
    if (view.finished && view.winner === 0 && arena.contextFor(ctx, req.trainer!)) {
      const step = arena.next(ctx, req.trainer!)
      if (step.battle) {
        return {
          ...step.battle,
          arena: arena.contextFor(ctx, req.trainer!),
          arenaAdvance: { healed: step.healed, round: step.arena.run?.round ?? null },
          previous: { winner: view.winner, reward: view.reward },
        }
      }
      return { ...view, arena: null, arenaDone: { payout: step.payout } }
    }

    /*
     * In der Kampfzone genauso — nur ohne Ende.
     *
     * Gewonnen heisst: Serie plus eins, vielleicht eine Stufe, naechster
     * Gegner. Verloren beendet den Lauf, und die Antwort sagt, wie weit man
     * gekommen ist.
     */
    if (view.finished && gauntlet.contextFor(ctx, req.trainer!)) {
      const step = gauntlet.next(ctx, req.trainer!, view.reward)
      if (step.battle) {
        return {
          ...step.battle,
          gauntlet: gauntlet.contextFor(ctx, req.trainer!),
          gauntletAdvance: {
            healed: step.healed, streak: step.streak, payout: step.payout, drops: step.drops,
          },
          previous: { winner: view.winner, reward: view.reward },
        }
      }
      return { ...view, gauntlet: null, gauntletDone: { streak: step.streak, summary: step.summary } }
    }

    return {
      ...view,
      arena: arena.contextFor(ctx, req.trainer!),
      gauntlet: gauntlet.contextFor(ctx, req.trainer!),
    }
  })

  app.post('/api/battle/forfeit', write, async (req) => battle.forfeit(ctx, req.trainer!))

  /* ---------------------------------------------------- Trainingsarena */

  app.get('/api/arena', auth, async (req) => arena.view(ctx, req.trainer!))

  app.post('/api/arena/start', write, async (req) => {
    const { tier, typeId } = z.object({
      tier: z.enum(['easy', 'even', 'hard']),
      /** Welcher der drei Typen des Tages. Ohne Angabe der erste. */
      typeId: z.string().optional(),
    }).parse(req.body)
    return arena.start(ctx, req.trainer!, tier, typeId)
  })

  app.post('/api/arena/next', write, async (req) => arena.next(ctx, req.trainer!))

  app.post('/api/arena/abandon', write, async (req) => ({ arena: arena.abandon(ctx, req.trainer!) }))

  /* ------------------------------------------------------- Kampfzone */

  app.get('/api/gauntlet', auth, async (req) => gauntlet.view(ctx, req.trainer!))

  app.post('/api/gauntlet/start', write, async (req) => {
    const { regionId } = z.object({ regionId: z.string() }).parse(req.body)
    return gauntlet.start(ctx, req.trainer!, regionId)
  })

  app.post('/api/gauntlet/abandon', write, async (req) => gauntlet.abandon(ctx, req.trainer!))

  app.post('/api/team/heal', write, async (req) => {
    const result = battle.healTeam(ctx, req.trainer!)
    const fresh = findById(ctx.db, req.trainer!.id)!
    return { ...result, gold: fresh.gold }
  })
}
