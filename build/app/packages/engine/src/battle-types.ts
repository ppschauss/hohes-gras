import type { Nature, StatBlock, Weather } from '@game/shared'

/** Non-volatile status. A creature has at most one at a time. */
export const STATUSES = ['none', 'burn', 'freeze', 'paralysis', 'poison', 'toxic', 'sleep'] as const
export type Status = (typeof STATUSES)[number]

/** Stat stages range -6..+6 and include the two battle-only stats. */
export const STAGE_KEYS = ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'] as const
export type StageKey = (typeof STAGE_KEYS)[number]
export type Stages = Record<StageKey, number>

export const emptyStages = (): Stages =>
  ({ atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 })

/** One creature as it exists inside a battle. Separate from the stored row on
 *  purpose: a battle mutates HP, PP and status constantly, and none of that
 *  should touch the database until the fight is over. */
export interface Fighter {
  /** Stable id — a creature id for the player, a synthetic one for NPCs. */
  id: string
  speciesId: string
  name: string
  level: number
  types: string[]
  nature: Nature
  ivs: StatBlock
  evs: StatBlock
  stats: StatBlock
  hp: number
  hpMax: number
  status: Status
  /** Turns remaining for sleep; toxic counter for poison damage ramp. */
  statusCounter: number
  stages: Stages
  confused: boolean
  confusionTurns: number
  flinched: boolean
  /** Runden seit dem Einwechseln. 0 heißt: gerade erst hereingekommen. */
  turnsOnField?: number
  moves: Array<{ id: string; pp: number; ppMax: number }>
  sprite: string
  shiny: boolean
  friendship: number
}

export interface Side {
  /** Whose side this is. Index 0 is always the player. */
  trainerName: string
  party: Fighter[]
  activeIndex: number
}

export type BattleKind = 'wild' | 'trainer' | 'gym' | 'pvp' | 'raid'

export interface BattleState {
  id: string
  kind: BattleKind
  seed: string
  turn: number
  sides: [Side, Side]
  weather: Weather
  /** Set once the battle ends. */
  outcome: BattleOutcome | null
}

export type BattleOutcome =
  | { winner: 0 | 1; reason: 'knockout' }
  | { winner: 0 | 1; reason: 'forfeit' }
  | { winner: null; reason: 'turn_limit' }

/** Everything that happened in one turn, in order. The client replays this
 *  list; it never derives events itself, so what the player sees is exactly
 *  what the server computed. */
export type BattleEvent =
  | { type: 'move'; side: 0 | 1; fighter: string; moveId: string; moveName: string }
  | { type: 'damage'; side: 0 | 1; fighter: string; amount: number; hpLeft: number; effectiveness: number; critical: boolean }
  | { type: 'miss'; side: 0 | 1; fighter: string }
  | { type: 'heal'; side: 0 | 1; fighter: string; amount: number; hpLeft: number }
  | { type: 'status'; side: 0 | 1; fighter: string; status: Status }
  | { type: 'status_damage'; side: 0 | 1; fighter: string; status: Status; amount: number; hpLeft: number }
  | { type: 'status_blocked'; side: 0 | 1; fighter: string; status: Status }
  | { type: 'status_cured'; side: 0 | 1; fighter: string; status: Status }
  | { type: 'stage'; side: 0 | 1; fighter: string; stat: StageKey; delta: number; capped: boolean }
  | { type: 'confused'; side: 0 | 1; fighter: string }
  | { type: 'confusion_hit'; side: 0 | 1; fighter: string; amount: number; hpLeft: number }
  | { type: 'flinch'; side: 0 | 1; fighter: string }
  | { type: 'faint'; side: 0 | 1; fighter: string }
  | { type: 'switch'; side: 0 | 1; fighter: string; name: string }
  | { type: 'item'; side: 0 | 1; itemId: string; fighter: string; healed: number }
  | { type: 'no_pp'; side: 0 | 1; fighter: string }
  /** Der Zug war diesmal nicht erlaubt — etwa Mogelhieb nach der ersten Runde. */
  | { type: 'move_failed'; side: 0 | 1; fighter: string; move: string }
  | { type: 'multi_hit'; side: 0 | 1; fighter: string; hits: number }
  /** Jemand hat das Wetter umgestellt. */
  | { type: 'weather'; side: 0 | 1; fighter: string; weather: Weather }
  | { type: 'end'; outcome: BattleOutcome }

export type PlayerAction =
  | { kind: 'move'; moveIndex: number }
  | { kind: 'switch'; partyIndex: number }
  | { kind: 'item'; itemId: string; targetIndex: number }
  | { kind: 'forfeit' }

/** Hard cap so a battle between two defensive teams cannot run forever. */
export const MAX_TURNS = 200
