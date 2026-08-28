import { z } from 'zod'

/**
 * Trainer-Energie, so wie der Client sie sieht.
 *
 * Der Server rechnet die Regeneration nach; der Client bekommt zusaetzlich die
 * beiden Zeitstempel, aus denen er den Countdown selbst zeichnen kann, ohne
 * dafuer zu pollen.
 */
export const EnergyStateSchema = z.object({
  current: z.number().int().min(0),
  /** Bis hierher fuellt sich das Konto von selbst wieder auf. */
  cap: z.number().int().min(0),
  perHour: z.number().int().min(0),
  /** Wann der naechste Punkt gutgeschrieben wird; null, wenn voll. */
  nextPointAt: z.number().int().nullable(),
  /** Wann das Konto wieder voll ist; null, wenn es das schon ist. */
  fullAt: z.number().int().nullable(),
})
export type EnergyState = z.infer<typeof EnergyStateSchema>

export const EnergyPackSchema = z.object({
  id: z.string(),
  energy: z.number().int().min(1),
  gold: z.number().int().min(0),
  /** Gold je Energiepunkt — die Zahl, an der man Pakete vergleicht. */
  pricePerPoint: z.number(),
})
export type EnergyPackView = z.infer<typeof EnergyPackSchema>

/** Der kaufbare, dauerhafte Ausbau des Vorrats. */
export const EnergyExpansionSchema = z.object({
  steps: z.number().int().min(0),
  maxSteps: z.number().int().min(0),
  stepSize: z.number().int().min(1),
  /** Preis der naechsten Stufe; null, wenn voll ausgebaut. */
  nextPrice: z.number().int().min(0).nullable(),
})
export type EnergyExpansion = z.infer<typeof EnergyExpansionSchema>

export const EnergyOverviewSchema = z.object({
  state: EnergyStateSchema,
  gold: z.number().int().min(0),
  packs: z.array(EnergyPackSchema),
  costs: z.record(z.number().int()),
  /** Woher es Energie zurueckgibt, mit Betrag — als Erklaerung im UI. */
  rewards: z.record(z.number().int()),
  /** Minuten von leer bis voll — die Zahl, die den Spieler interessiert. */
  fillMinutes: z.number().int().min(1),
  expansion: EnergyExpansionSchema,
})
export type EnergyOverview = z.infer<typeof EnergyOverviewSchema>

export const BuyEnergyRequestSchema = z.object({ packId: z.string().min(1) })
export type BuyEnergyRequest = z.infer<typeof BuyEnergyRequestSchema>
