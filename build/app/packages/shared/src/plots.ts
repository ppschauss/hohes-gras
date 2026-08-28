import { z } from 'zod'

/**
 * Poké-Beet.
 *
 * Ein Beet ist entweder leer oder bepflanzt. Bepflanzt trägt es alles, was der
 * Client zum Zeichnen braucht — was drinsteckt, wie weit es ist, was gerade zu
 * tun wäre und was am Ende herauskäme.
 */
export const PlotStakeSchema = z.object({
  kind: z.enum(['item', 'gold']),
  itemId: z.string().nullable(),
  name: z.string(),
  icon: z.string(),
  amount: z.number().int().min(1),
})
export type PlotStake = z.infer<typeof PlotStakeSchema>

export const PlotViewSchema = z.object({
  slot: z.number().int().min(0),
  id: z.string().nullable(),
  stake: PlotStakeSchema.nullable(),
  plantedAt: z.number().int().nullable(),
  readyAt: z.number().int().nullable(),
  ready: z.boolean(),
  phasesDone: z.number().int().min(0),
  phasesTotal: z.number().int().min(1),
  /** Fällige, aber noch nicht erledigte Pflegeschritte. */
  phasesPending: z.number().int().min(0),
  /** 'weed' oder 'water' — was als Nächstes ansteht. */
  nextPhaseKind: z.enum(['weed', 'water']).nullable(),
  nextPhaseAt: z.number().int().nullable(),
  tender: z.object({
    id: z.string(),
    displayName: z.string(),
    sprite: z.string(),
    level: z.number().int(),
  }).nullable(),
  /** Aufschlag in Prozent, den das Beet gerade erreicht. */
  bonusPercent: z.number().int(),
  /** Was bei sofortiger Ernte herauskäme. */
  payout: z.number().int(),
})
export type PlotView = z.infer<typeof PlotViewSchema>

export const PlantableSchema = z.object({
  itemId: z.string(),
  name: z.string(),
  icon: z.string(),
  category: z.string(),
  have: z.number().int().min(0),
})
export type Plantable = z.infer<typeof PlantableSchema>

export const PlotsStateSchema = z.object({
  plots: z.array(PlotViewSchema),
  gold: z.number().int().min(0),
  growthMinutes: z.number().int().min(1),
  maxItems: z.number().int().min(1),
  maxGold: z.number().int().min(1),
  /** Darf gerade Gold vergraben werden? Nur einmal je 24 Stunden. */
  goldReady: z.boolean(),
  /** Wann wieder; null, wenn noch nie Gold vergraben wurde. */
  goldReadyAt: z.number().int().nullable(),
  goldCooldownHours: z.number().int().min(1),
  /** Energie je Pflegeschritt. */
  tendCost: z.number().int().min(0),
  plantable: z.array(PlantableSchema),
  /** Pflanzen-Pokémon, die gerade abgestellt werden könnten. */
  tenders: z.array(z.object({
    id: z.string(),
    displayName: z.string(),
    sprite: z.string(),
    level: z.number().int(),
    bonusPercent: z.number().int(),
    busy: z.boolean(),
  })),
})
export type PlotsState = z.infer<typeof PlotsStateSchema>

export const PlantRequestSchema = z.object({
  slot: z.number().int().min(0),
  kind: z.enum(['item', 'gold']),
  itemId: z.string().optional(),
  amount: z.number().int().min(1),
  tenderId: z.string().uuid().nullable().optional(),
})
export type PlantRequest = z.infer<typeof PlantRequestSchema>

export const PlotSlotRequestSchema = z.object({ slot: z.number().int().min(0) })
export type PlotSlotRequest = z.infer<typeof PlotSlotRequestSchema>

export const SetTenderRequestSchema = z.object({
  slot: z.number().int().min(0),
  tenderId: z.string().uuid().nullable(),
})
export type SetTenderRequest = z.infer<typeof SetTenderRequestSchema>
