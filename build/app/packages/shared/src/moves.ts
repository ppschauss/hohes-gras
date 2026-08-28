import { z } from 'zod'

/**
 * Attackenauswahl.
 *
 * Vier Plaetze, frei belegbar aus allem, was die Art bis zum aktuellen Level
 * lernen kann. Kein Attacken-Lehrer, keine Gebuehr: das waere kuenstliche
 * Reibung in einem Spiel, das unter Freunden laeuft.
 */
export const MoveOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.object({ id: z.string(), name: z.string(), color: z.string() }),
  category: z.enum(['physical', 'special', 'status']),
  power: z.number().int(),
  accuracy: z.number().int(),
  pp: z.number().int(),
  /** Level, ab dem die Art diese Attacke kann. 0 = von Anfang an. */
  level: z.number().int(),
  /** Kurzform der Nebenwirkung, als Schlagwort fuer die Anzeige. */
  effect: z.string(),
  /** Steht die Attacke gerade in einem der vier Plaetze? */
  selected: z.boolean(),
})
export type MoveOption = z.infer<typeof MoveOptionSchema>

export const MoveSetSchema = z.object({
  creature: z.object({
    id: z.string(),
    displayName: z.string(),
    sprite: z.string(),
    level: z.number().int(),
  }),
  capacity: z.number().int(),
  /** Belegte Plaetze in Reihenfolge. Kann kuerzer als `capacity` sein. */
  slots: z.array(MoveOptionSchema),
  /** Alles Lernbare, neueste zuerst — inklusive der belegten Attacken. */
  options: z.array(MoveOptionSchema),
})
export type MoveSet = z.infer<typeof MoveSetSchema>

export const SetMovesRequestSchema = z.object({
  moveIds: z.array(z.string()).min(1).max(4),
})
export type SetMovesRequest = z.infer<typeof SetMovesRequestSchema>
