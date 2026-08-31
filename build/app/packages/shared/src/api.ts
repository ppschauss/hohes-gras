import { z } from 'zod'
import { TrainerSchema, WorldClockSchema } from './domain.js'
import { EnergyPackSchema, EnergyStateSchema } from './energy.js'

/** POST /api/auth/session — exchange Telegram initData for a session token. */
export const AuthRequestSchema = z.object({
  initData: z.string().min(1),
})
export type AuthRequest = z.infer<typeof AuthRequestSchema>

export const AuthResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.number().int(),
  trainer: TrainerSchema,
  isNewTrainer: z.boolean(),
})
export type AuthResponse = z.infer<typeof AuthResponseSchema>

/** GET /api/state — everything the shell needs on boot. Feature slices are
 *  fetched per tab; this stays small so the app paints fast. */
export const BootstrapSchema = z.object({
  trainer: TrainerSchema,
  clock: WorldClockSchema,
  energy: EnergyStateSchema,
  /** Reisegrenze: 50 Level je bezwungener Region, plus die erste. */
  travel: z.object({
    cap: z.number().int(),
    clearedRegions: z.number().int(),
    totalRegions: z.number().int(),
    levelsPerRegion: z.number().int(),
    nextCap: z.number().int().nullable(),
  }),
  /** Konstant fuer alle Spieler; einmal beim Start geladen statt bei jeder
   *  Aktion mitgeschickt. */
  energyCosts: z.record(z.number().int()),
  energyPacks: z.array(EnergyPackSchema),
  contentPack: z.object({ id: z.string(), name: z.string(), version: z.string() }),
  features: z.record(z.boolean()),
  serverTime: z.number().int(),
})
export type Bootstrap = z.infer<typeof BootstrapSchema>

export const ApiErrorSchema = z.object({
  error: z.string(),
  detail: z.record(z.unknown()).optional(),
})
export type ApiError = z.infer<typeof ApiErrorSchema>
