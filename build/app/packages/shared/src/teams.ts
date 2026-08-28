import { z } from 'zod'
import { CreatureViewSchema } from './garden.js'

/**
 * Mehrere benannte Teams je Trainer.
 *
 * Genau eines ist aktiv: es steht im Garten, kaempft, und ist das, was der Rest
 * des Spiels als "das Team" liest. Die uebrigen sind Voreinstellungen, die man
 * mit einem Tipp aktiviert — ein Kampfteam, ein Fangteam, ein Zuchtteam.
 */
export const TeamViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  active: z.boolean(),
  createdAt: z.number().int(),
  members: z.array(CreatureViewSchema),
})
export type TeamView = z.infer<typeof TeamViewSchema>

export const TeamsStateSchema = z.object({
  teams: z.array(TeamViewSchema),
  activeTeamId: z.string().nullable(),
  capacity: z.number().int(),
  maxTeams: z.number().int(),
  /** Alles, was gerade in keinem aktiven Team steht — die Box. */
  box: z.array(CreatureViewSchema),
  /** Kreaturen, die unterwegs sind und deshalb nicht getauscht werden sollten. */
  busyCreatureIds: z.array(z.string()),
})
export type TeamsState = z.infer<typeof TeamsStateSchema>

export const TeamNameRequestSchema = z.object({
  name: z.string().trim().min(1).max(24),
})
export type TeamNameRequest = z.infer<typeof TeamNameRequestSchema>

export const TeamMembersRequestSchema = z.object({
  creatureIds: z.array(z.string().uuid()).max(5),
})
export type TeamMembersRequest = z.infer<typeof TeamMembersRequestSchema>
