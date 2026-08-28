import { z } from 'zod'

/** The six battle stats. Order matters: it is the storage order for IV/EV arrays. */
export const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const
export type StatKey = (typeof STATS)[number]
export type StatBlock = Record<StatKey, number>

/** Natures raise one stat by 10% and lower another by 10%. A nature whose
 *  plus and minus stat are equal is neutral. `hp` is never affected. */
export const NATURES = [
  'hardy', 'lonely', 'brave', 'adamant', 'naughty',
  'bold', 'docile', 'relaxed', 'impish', 'lax',
  'timid', 'hasty', 'serious', 'jolly', 'naive',
  'modest', 'mild', 'quiet', 'bashful', 'rash',
  'calm', 'gentle', 'sassy', 'careful', 'quirky',
] as const
export type Nature = (typeof NATURES)[number]

export const GROWTH_RATES = ['fast', 'medium_fast', 'medium_slow', 'slow', 'erratic', 'fluctuating'] as const
export type GrowthRate = (typeof GROWTH_RATES)[number]

export const TIMES_OF_DAY = ['dawn', 'day', 'dusk', 'night'] as const
export type TimeOfDay = (typeof TIMES_OF_DAY)[number]

export const WEATHERS = ['clear', 'rain', 'storm', 'snow', 'fog', 'sandstorm', 'heat'] as const
export type Weather = (typeof WEATHERS)[number]

export const CARE_ACTIONS = ['feed', 'play', 'wash', 'rest'] as const
export type CareAction = (typeof CARE_ACTIONS)[number]

export const CURRENCIES = ['gold', 'shards', 'tickets'] as const
export type Currency = (typeof CURRENCIES)[number]

/** A creature as it exists in a trainer's collection. */
export const OwnedCreatureSchema = z.object({
  id: z.string(),
  ownerId: z.string(),
  speciesId: z.string(),
  nickname: z.string().max(24).nullable(),
  level: z.number().int().min(1).max(100),
  xp: z.number().int().min(0),
  nature: z.enum(NATURES),
  ivs: z.object({ hp: z.number(), atk: z.number(), def: z.number(), spa: z.number(), spd: z.number(), spe: z.number() }),
  evs: z.object({ hp: z.number(), atk: z.number(), def: z.number(), spa: z.number(), spd: z.number(), spe: z.number() }),
  friendship: z.number().int().min(0).max(255),
  energy: z.number().int().min(0).max(100),
  hpCurrent: z.number().int().min(0),
  shiny: z.boolean(),
  moves: z.array(z.string()).max(4),
  heldItem: z.string().nullable(),
  caughtAt: z.number().int(),
  caughtAreaId: z.string().nullable(),
  /** null = in a box, 0..4 = slot in the active garden team */
  teamSlot: z.number().int().min(0).max(4).nullable(),
})
export type OwnedCreature = z.infer<typeof OwnedCreatureSchema>

export const TrainerSchema = z.object({
  id: z.string(),
  telegramId: z.string(),
  displayName: z.string(),
  trainerCode: z.string(),
  createdAt: z.number().int(),
  lastSeenAt: z.number().int(),
  locale: z.string(),
  gold: z.number().int().min(0),
  shards: z.number().int().min(0),
  tickets: z.number().int().min(0),
  currentAreaId: z.string().nullable(),
  gardenBackground: z.string(),
  /** Rohwert aus der Datenbank. Was das UI zeigt, steht in `EnergyState`:
   *  dort ist die Regeneration bis jetzt bereits eingerechnet. */
  energy: z.number().int().min(0),
  energyUpdatedAt: z.number().int(),
  activeTeamId: z.string().nullable(),
  /** Heben Gebiete und Trainer ihr Level auf die Staerke des Teams? */
  levelScaling: z.boolean(),
  /** Gekaufte Ausbaustufen des Energievorrats. */
  energyCapSteps: z.number().int().min(0),
  themeId: z.string(),
  themeMode: z.enum(['auto', 'day', 'night']),
  isAdmin: z.boolean(),
  isBanned: z.boolean(),
  privacy: z.object({
    hideFromLeaderboard: z.boolean(),
    friendsOnlyInteractions: z.boolean(),
    allowFriendRequests: z.boolean(),
    reminders: z.boolean(),
  }),
})
export type Trainer = z.infer<typeof TrainerSchema>

/** World clock derived from the server's wall time. Drives spawn tables and
 *  a handful of battle modifiers, so it is computed server-side only. */
export const WorldClockSchema = z.object({
  timeOfDay: z.enum(TIMES_OF_DAY),
  weather: z.enum(WEATHERS),
  /** Local date in Europe/Berlin, `YYYY-MM-DD`. Daily limits reset on change. */
  gameDate: z.string(),
})
export type WorldClock = z.infer<typeof WorldClockSchema>
