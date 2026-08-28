import { z } from 'zod'
import { CARE_ACTIONS, NATURES, OwnedCreatureSchema } from './domain.js'
import { EnergyStateSchema } from './energy.js'

/** A creature enriched with everything the client needs to render it without
 *  knowing any game rules: computed stats, sprite paths, localized names. */
export const CreatureViewSchema = OwnedCreatureSchema.extend({
  speciesName: z.string(),
  displayName: z.string(),
  types: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
  sprite: z.string(),
  stats: z.object({ hp: z.number(), atk: z.number(), def: z.number(), spa: z.number(), spd: z.number(), spe: z.number() }),
  hpMax: z.number(),
  power: z.number(),
  ivPercent: z.number(),
  condition: z.number(),
  friendshipTier: z.string(),
  xpIntoLevel: z.number(),
  xpForNextLevel: z.number(),
  isMaxLevel: z.boolean(),
  moveNames: z.array(z.string()),
  /** Present when the creature meets an evolution condition right now. */
  canEvolveTo: z.array(z.object({ speciesId: z.string(), name: z.string(), how: z.string() })),
})
export type CreatureView = z.infer<typeof CreatureViewSchema>

export const CareActionRequestSchema = z.object({ action: z.enum(CARE_ACTIONS) })
export type CareActionRequest = z.infer<typeof CareActionRequestSchema>

export const GardenStateSchema = z.object({
  team: z.array(CreatureViewSchema),
  teamCapacity: z.number().int(),
  boxCount: z.number().int(),
  background: z.object({ id: z.string(), name: z.string() }),
  energy: EnergyStateSchema,
  care: z.object({
    usedToday: z.number().int(),
    /** Was eine Pflegeaktion an Trainer-Energie kostet. */
    energyCost: z.number().int(),
    actions: z.array(z.object({
      action: z.enum(CARE_ACTIONS),
      available: z.boolean(),
      /** Localization key explaining why it is unavailable, if it is. */
      blockedReason: z.string().nullable(),
      costItemId: z.string().nullable(),
      costQuantity: z.number().int(),
      have: z.number().int(),
    })),
  }),
  dex: z.object({ seen: z.number().int(), caught: z.number().int(), total: z.number().int() }),
})
export type GardenState = z.infer<typeof GardenStateSchema>

export const CareResponseSchema = z.object({
  garden: GardenStateSchema,
  gained: z.array(z.object({
    creatureId: z.string(),
    displayName: z.string(),
    xpGained: z.number().int(),
    leveledUp: z.boolean(),
    newLevel: z.number().int(),
    friendshipGained: z.number().int(),
  })),
})
export type CareResponse = z.infer<typeof CareResponseSchema>

export const SetTeamRequestSchema = z.object({
  creatureIds: z.array(z.string().uuid()).max(5),
})
export type SetTeamRequest = z.infer<typeof SetTeamRequestSchema>

export const ChooseStarterRequestSchema = z.object({ speciesId: z.string() })
export type ChooseStarterRequest = z.infer<typeof ChooseStarterRequestSchema>

export const StarterOptionSchema = z.object({
  speciesId: z.string(),
  name: z.string(),
  sprite: z.string(),
  types: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
  description: z.string(),
  baseStats: z.object({ hp: z.number(), atk: z.number(), def: z.number(), spa: z.number(), spd: z.number(), spe: z.number() }),
})
export type StarterOption = z.infer<typeof StarterOptionSchema>

export const DexRowSchema = z.object({
  speciesId: z.string(),
  dexNumber: z.number().int(),
  name: z.string(),
  sprite: z.string(),
  types: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
  rarity: z.string(),
  seen: z.boolean(),
  caught: z.boolean(),
  owned: z.number().int(),
})
export type DexRow = z.infer<typeof DexRowSchema>

export const ShopItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  price: z.number().int(),
  sellPrice: z.number().int().nullable(),
  icon: z.string(),
  owned: z.number().int(),
  /** Backgrounds are one-time purchases; the client hides the amount stepper. */
  oneTime: z.boolean(),
  alreadyOwned: z.boolean(),
})
export type ShopItem = z.infer<typeof ShopItemSchema>

export const ShopStateSchema = z.object({
  gold: z.number().int(),
  sections: z.array(z.object({
    category: z.string(),
    title: z.string(),
    items: z.array(ShopItemSchema),
  })),
})
export type ShopState = z.infer<typeof ShopStateSchema>

export const BuyRequestSchema = z.object({
  itemId: z.string(),
  quantity: z.number().int().min(1).max(99).default(1),
})
export type BuyRequest = z.infer<typeof BuyRequestSchema>

export const SellRequestSchema = z.object({
  itemId: z.string(),
  quantity: z.number().int().min(1).max(99).default(1),
})
export type SellRequest = z.infer<typeof SellRequestSchema>

export const NATURE_LIST = NATURES
