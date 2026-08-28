import { z } from 'zod'

/**
 * Poke-Center.
 *
 * Ein Besuch heilt immer; alles darueber hinaus ist Zufall. Der Client bekommt
 * deshalb zwei Dinge getrennt: was sicher passiert ist (`healed`) und was
 * darueber hinaus geschah (`event`).
 */
export const CenterItemSchema = z.object({
  itemId: z.string(),
  name: z.string(),
  icon: z.string(),
  quantity: z.number().int().min(1),
})
export type CenterItem = z.infer<typeof CenterItemSchema>

export const CenterOfferSchema = z.object({
  id: z.string(),
  npcName: z.string(),
  wanted: z.object({ speciesId: z.string(), name: z.string(), sprite: z.string() }),
  offered: z.object({
    speciesId: z.string(),
    name: z.string(),
    sprite: z.string(),
    level: z.number().int(),
    shiny: z.boolean(),
    types: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
  }),
  expiresAt: z.number().int(),
  /** Eigene Kreaturen der gesuchten Art — leer heisst: annehmbar ist es nicht. */
  candidates: z.array(z.object({
    id: z.string(),
    displayName: z.string(),
    level: z.number().int(),
    sprite: z.string(),
    inTeam: z.boolean(),
  })),
})
export type CenterOffer = z.infer<typeof CenterOfferSchema>

export const CenterEventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('gold'), gold: z.number().int().min(1) }),
  z.object({ kind: z.literal('gift'), item: CenterItemSchema }),
  z.object({ kind: z.literal('trade'), offer: CenterOfferSchema }),
])
export type CenterEvent = z.infer<typeof CenterEventSchema>

export const CenterStateSchema = z.object({
  ready: z.boolean(),
  readyAt: z.number().int(),
  cooldownMs: z.number().int(),
  /** Wie viele Teammitglieder gerade Heilung braeuchten. */
  hurt: z.number().int(),
  teamSize: z.number().int(),
  offer: CenterOfferSchema.nullable(),
})
export type CenterState = z.infer<typeof CenterStateSchema>

export const CenterVisitSchema = z.object({
  healed: z.number().int(),
  event: CenterEventSchema,
  state: CenterStateSchema,
})
export type CenterVisit = z.infer<typeof CenterVisitSchema>

export const AcceptTradeRequestSchema = z.object({
  offerId: z.string(),
  creatureId: z.string().uuid(),
})
export type AcceptTradeRequest = z.infer<typeof AcceptTradeRequestSchema>
