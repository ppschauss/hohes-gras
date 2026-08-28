import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  AcceptTradeRequestSchema, BuyEnergyRequestSchema, BuyRequestSchema, CareActionRequestSchema,
  ChooseStarterRequestSchema, PlantRequestSchema, PlotSlotRequestSchema,
  BuyThemeRequestSchema, SellRequestSchema, SetMovesRequestSchema, SetTeamRequestSchema,
  SetTenderRequestSchema, SetThemeModeRequestSchema, SetThemeRequestSchema,
  TeamMembersRequestSchema, TeamNameRequestSchema,
} from '@game/shared'
import type { AppContext } from '../context.js'
import { rateLimit, requireTrainer, withEnergy } from './plugin.js'
import * as garden from '../services/garden.js'
import * as souls from '../services/souls.js'
import { useItem } from '../services/useItem.js'
import * as shop from '../services/shop.js'
import * as safari from '../services/safari.js'
import * as teams from '../services/teams.js'
import * as energy from '../services/energy.js'
import * as moves from '../services/moves.js'
import * as center from '../services/center.js'
import * as plots from '../services/plots.js'
import * as themes from '../services/themes.js'
import * as travel from '../services/travel.js'
import * as creatures from '../repos/creatures.js'
import * as dexRepo from '../repos/dex.js'
import * as inventory from '../repos/inventory.js'
import { findById } from '../repos/trainers.js'
import { creatureView, dexRows } from '../services/views.js'
import { worldClock } from '../worldClock.js'

export function registerGardenRoutes(app: FastifyInstance, ctx: AppContext): void {
  const auth = { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'action')] }
  const write = { preHandler: [requireTrainer(ctx), rateLimit(ctx, 'write_heavy')] }

  app.get('/api/garden', auth, async (req) => {
    const trainer = req.trainer!
    garden.catchUpEnergy(ctx, trainer)
    return garden.gardenState(ctx, trainer)
  })

  app.post('/api/garden/care', write, async (req) => {
    const { action } = CareActionRequestSchema.parse(req.body)
    const gained = garden.performCare(ctx, req.trainer!, action)
    // Re-read the trainer: care can change gold and items indirectly.
    const fresh = findById(ctx.db, req.trainer!.id)!
    return withEnergy(ctx, fresh.id, { garden: garden.gardenState(ctx, fresh), gained })
  })

  app.get('/api/starter', auth, async (req) => {
    const owned = creatures.countOwned(ctx.db, req.trainer!.id).total
    const regionId = (req.query as { regionId?: string } | undefined)?.regionId
    return {
      needsStarter: owned === 0,
      options: garden.starterOptions(ctx, req.trainer!, regionId),
      regions: garden.startRegions(ctx, req.trainer!),
    }
  })

  app.post('/api/starter', write, async (req) => {
    const { speciesId, regionId } = ChooseStarterRequestSchema.parse(req.body)
    garden.chooseStarter(ctx, req.trainer!, speciesId, regionId)
    const fresh = findById(ctx.db, req.trainer!.id)!
    return garden.gardenState(ctx, fresh)
  })

  /* -------------------------------------------------------- Verwerten */

  app.get('/api/souls', auth, async (req) => ({ souls: souls.overview(ctx, req.trainer!) }))

  /* Einzeln oder als Auswahl — ein alter Client schickt weiter `creatureId`. */
  app.post('/api/souls/salvage', write, async (req) => {
    const { creatureId, creatureIds } = z.object({
      creatureId: z.string().uuid().optional(),
      creatureIds: z.array(z.string().uuid()).min(1).max(souls.SALVAGE_BATCH_LIMIT).optional(),
    }).refine((b) => b.creatureId || b.creatureIds, { message: 'creatureId oder creatureIds' })
      .parse(req.body)

    if (creatureIds) {
      const bulk = souls.salvageMany(ctx, req.trainer!, creatureIds)
      return { bulk, souls: souls.overview(ctx, req.trainer!) }
    }
    const result = souls.salvage(ctx, req.trainer!, creatureId!)
    return { result, souls: souls.overview(ctx, req.trainer!) }
  })

  app.post('/api/souls/redeem', write, async (req) => {
    const { typeId, shiny } = z.object({
      typeId: z.string().min(1).max(32),
      shiny: z.boolean().default(false),
    }).parse(req.body)
    const egg = souls.redeem(ctx, req.trainer!, typeId, shiny)
    return { egg, souls: souls.overview(ctx, req.trainer!) }
  })

  app.post('/api/items/use', write, async (req) => {
    const { itemId, creatureId } = z.object({
      itemId: z.string().min(1).max(64),
      creatureId: z.string().uuid().optional(),
    }).parse(req.body)
    const result = useItem(ctx, req.trainer!, itemId, creatureId)
    return withEnergy(ctx, req.trainer!.id, { result })
  })

  app.get('/api/box', auth, async (req) => {
    const trainer = req.trainer!
    const clock = worldClock()
    const box = creatures.boxOf(ctx.db, trainer.id)
    const cap = travel.capOf(ctx, trainer)
    return {
      creatures: box.map((c) => creatureView(ctx.registry, c, trainer.locale, clock.timeOfDay, cap)),
      teamCapacity: garden.TEAM_CAPACITY,
      // Die Box hat eine Grenze, und sie ist ausbaubar — dann gehoert sie auch
      // auf den Bildschirm und nicht erst in die Fehlermeldung.
      boxCapacity: safari.boxLimit(ctx, trainer.id),
      // Gezaehlt wird alles, was einem gehoert — die Grenze gilt fuer Box
      // *und* Team, sonst zeigte der Zaehler weniger an, als er verbraucht.
      boxUsed: creatures.countOwned(ctx.db, trainer.id).total,
    }
  })

  /** Kurzer Weg fuers Gartenteam: schreibt in das aktive Team, damit Garten und
   *  Teamverwaltung nie auseinanderlaufen. */
  app.post('/api/team', write, async (req) => {
    const { creatureIds } = SetTeamRequestSchema.parse(req.body)
    const trainer = req.trainer!
    const activeId = teams.ensureDefault(ctx, trainer.id)
    teams.setMembers(ctx, trainer, activeId, creatureIds)
    return garden.gardenState(ctx, trainer)
  })

  /* -------------------------------------------------------------- Teams */

  app.get('/api/teams', auth, async (req) => teams.overview(ctx, req.trainer!))

  app.post('/api/teams', write, async (req) => {
    const { name } = TeamNameRequestSchema.parse(req.body)
    return teams.create(ctx, req.trainer!, name)
  })

  app.patch('/api/teams/:teamId', write, async (req) => {
    const { teamId } = req.params as { teamId: string }
    const { name } = TeamNameRequestSchema.parse(req.body)
    return teams.rename(ctx, req.trainer!, teamId, name)
  })

  app.delete('/api/teams/:teamId', write, async (req) => {
    const { teamId } = req.params as { teamId: string }
    return teams.remove(ctx, req.trainer!, teamId)
  })

  app.put('/api/teams/:teamId/members', write, async (req) => {
    const { teamId } = req.params as { teamId: string }
    const { creatureIds } = TeamMembersRequestSchema.parse(req.body)
    return teams.setMembers(ctx, req.trainer!, teamId, creatureIds)
  })

  app.post('/api/teams/:teamId/activate', write, async (req) => {
    const { teamId } = req.params as { teamId: string }
    return teams.activate(ctx, req.trainer!, teamId)
  })

  /* ---------------------------------------------------------- Attacken */

  app.get('/api/creatures/:creatureId/moves', auth, async (req) => {
    const { creatureId } = req.params as { creatureId: string }
    return moves.moveSet(ctx, req.trainer!, creatureId)
  })

  app.put('/api/creatures/:creatureId/moves', write, async (req) => {
    const { creatureId } = req.params as { creatureId: string }
    const { moveIds } = SetMovesRequestSchema.parse(req.body)
    return moves.setMoves(ctx, req.trainer!, creatureId, moveIds)
  })

  /* ------------------------------------------------------------ Designs */

  app.get('/api/themes', auth, async (req) => themes.state(ctx, req.trainer!))

  app.post('/api/themes/buy', write, async (req) => {
    const { themeId } = BuyThemeRequestSchema.parse(req.body)
    return themes.buy(ctx, req.trainer!, themeId)
  })

  app.post('/api/themes/wear', write, async (req) => {
    const { themeId } = SetThemeRequestSchema.parse(req.body)
    return themes.wear(ctx, req.trainer!, themeId)
  })

  app.post('/api/themes/mode', write, async (req) => {
    const { mode } = SetThemeModeRequestSchema.parse(req.body)
    return themes.setMode(ctx, req.trainer!, mode)
  })

  /* ---------------------------------------------------------- Poke-Beet */

  app.get('/api/plots', auth, async (req) => plots.state(ctx, req.trainer!))

  app.post('/api/plots/plant', write, async (req) => {
    const body = PlantRequestSchema.parse(req.body)
    return plots.plant(ctx, req.trainer!, body)
  })

  app.post('/api/plots/tend', write, async (req) => {
    const { slot } = PlotSlotRequestSchema.parse(req.body)
    return withEnergy(ctx, req.trainer!.id, plots.tend(ctx, req.trainer!, slot))
  })

  app.post('/api/plots/harvest', write, async (req) => {
    const { slot } = PlotSlotRequestSchema.parse(req.body)
    return plots.harvest(ctx, req.trainer!, slot)
  })

  app.post('/api/plots/tender', write, async (req) => {
    const { slot, tenderId } = SetTenderRequestSchema.parse(req.body)
    return plots.setTender(ctx, req.trainer!, slot, tenderId)
  })

  /* -------------------------------------------------------- Poke-Center */

  app.get('/api/center', auth, async (req) => center.state(ctx, req.trainer!))

  app.post('/api/center/visit', write, async (req) => center.visit(ctx, req.trainer!))

  app.post('/api/center/trade/accept', write, async (req) => {
    const { offerId, creatureId } = AcceptTradeRequestSchema.parse(req.body)
    return center.acceptTrade(ctx, req.trainer!, offerId, creatureId)
  })

  app.post('/api/center/trade/decline', write, async (req) => {
    const { offerId } = z.object({ offerId: z.string() }).parse(req.body)
    return center.declineTrade(ctx, req.trainer!, offerId)
  })

  /* ------------------------------------------------------------ Energie */

  app.get('/api/energy', auth, async (req) => energy.overview(ctx, req.trainer!))

  app.post('/api/energy/buy', write, async (req) => {
    const { packId } = BuyEnergyRequestSchema.parse(req.body)
    return energy.buy(ctx, req.trainer!, packId)
  })

  app.post('/api/energy/expand', write, async (req) => energy.expand(ctx, req.trainer!))

  app.get('/api/dex', auth, async (req) => {
    const trainer = req.trainer!
    const entries = dexRepo.dexOf(ctx.db, trainer.id)
    const owned = ctx.db
      .prepare('SELECT species_id AS s, COUNT(*) AS n FROM creatures WHERE owner_id = ? GROUP BY species_id')
      .all(trainer.id) as Array<{ s: string; n: number }>
    const counts = new Map(owned.map((o) => [o.s, o.n]))
    return {
      rows: dexRows(ctx.registry, entries, counts, trainer.locale),
      counts: { ...dexRepo.dexCounts(ctx.db, trainer.id), total: ctx.registry.speciesCount },
    }
  })

  app.get('/api/bag', auth, async (req) => {
    const trainer = req.trainer!
    const bag = inventory.bagOf(ctx.db, trainer.id)
    return {
      gold: inventory.goldOf(ctx.db, trainer.id),
      items: Object.entries(bag).map(([id, quantity]) => {
        const item = ctx.registry.tryItem(id)
        return {
          id, quantity,
          name: item ? ctx.registry.localized(item.name, trainer.locale) : id,
          description: item ? ctx.registry.localized(item.description, trainer.locale) : '',
          category: item?.category ?? 'unknown',
          icon: item?.icon ?? '',
          sellPrice: item?.sellPrice ?? null,
        }
      }).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    }
  })

  app.get('/api/shop', auth, async (req) => shop.shopState(ctx, req.trainer!))

  app.post('/api/shop/buy', write, async (req) => {
    const { itemId, quantity } = BuyRequestSchema.parse(req.body)
    shop.buy(ctx, req.trainer!, itemId, quantity)
    return shop.shopState(ctx, findById(ctx.db, req.trainer!.id)!)
  })

  app.post('/api/shop/sell', write, async (req) => {
    const { itemId, quantity } = SellRequestSchema.parse(req.body)
    shop.sell(ctx, req.trainer!, itemId, quantity)
    return shop.shopState(ctx, findById(ctx.db, req.trainer!.id)!)
  })

  app.post('/api/garden/background', write, async (req) => {
    const { itemId } = BuyRequestSchema.pick({ itemId: true }).parse(req.body)
    shop.equipBackground(ctx, req.trainer!, itemId)
    return garden.gardenState(ctx, findById(ctx.db, req.trainer!.id)!)
  })
}
