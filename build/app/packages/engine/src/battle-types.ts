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
  /*
   * Vier Merker fuer Zuege, die etwas *vorbereiten* statt sofort zu wirken.
   *
   * Alle vier sind wahlfrei: ein Kampf, der vor dieser Aenderung angefangen
   * hat, liegt als JSON in der Datenbank und kennt sie nicht. Fehlt der Wert,
   * gilt er als aus — so laeuft ein halb gekaempfter Kampf weiter, statt beim
   * naechsten Zug zu zerbrechen.
   */
  /** Bis einschliesslich dieser Runde prallt alles ab (Schutzschild). */
  protectedUntilTurn?: number
  /** Bis einschliesslich dieser Runde bleibt mindestens ein KP (Ausdauer). */
  enduringUntilTurn?: number
  /** Zusaetzliche Volltrefferstufen fuer den ganzen Kampf (Energiefokus). */
  critStage?: number
  /** Der naechste Angriff ist ein sicherer Volltreffer (Konzentration). */
  sureCrit?: boolean
  /** Bis einschliesslich dieser Runde prallen nur Vorrangzuege ab (Rapidschutz). */
  priorityGuardUntilTurn?: number
  /** Bis einschliesslich dieser Runde reisst ein Abgang den Gegner mit. */
  destinyBondUntilTurn?: number
  /**
   * Was ueber Runden an diesem Kaempfer haengt.
   *
   * Der Zustand (`status`) kann nur eines auf einmal sein — Schlaf *oder*
   * Gift. Egelsamen, Wasserring, Nachtmahr und Fluch wirken daneben und
   * gleichzeitig, brauchen also eine eigene Liste. Wahlfrei, damit ein Kampf,
   * der als JSON in der Datenbank liegt, ohne sie weiterlaeuft.
   */
  lingering?: Lingering[]
  /** Der zuletzt eingesetzte Zug — Zugabe und Aussetzer haengen daran. */
  lastMoveId?: string
  /**
   * Die Puppe.
   *
   * Ein Viertel der Kraftpunkte, das die Treffer schluckt und alles abhaelt,
   * was auf den Traeger zielt. Eine Zahl und kein eigener Kaempfer: sie hat
   * keine Werte, keinen Typ und keinen Zug — sie hat nur Ausdauer.
   */
  substitute?: number
  /** Bis einschliesslich dieser Runde faellt ein Statuszug auf den Absender zurueck. */
  magicCoatUntilTurn?: number
  /**
   * Wie es war, bevor etwas im Kampf daran gedreht hat.
   *
   * Krafttrick tauscht Werte, Umwandlung faerbt Typen, Wandler macht eine
   * Kopie — alles drei gilt "bis man das Feld verlaesst", so steht es auch am
   * Schema. Ohne einen Urzustand liesse sich das nicht zuruecknehmen, und ein
   * verwandeltes Ditto blieb Kopie, nachdem es laengst wieder auf der Bank
   * sass. Wird beim ersten Eingriff gesetzt und beim Abgang eingeloest.
   */
  urform?: { types: string[]; stats: StatBlock; speciesId: string; sprite: string; moves: Fighter['moves'] }
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
  /**
   * Was ueber der ganzen Seite liegt statt an einem Kaempfer.
   *
   * Reflektor und Lichtschild bleiben, wenn gewechselt wird — das ist der
   * Unterschied zu allem, was an einem Kaempfer haengt, und der Grund fuer
   * die zweite Liste.
   */
  conditions?: SideCondition[]
  /**
   * Ein Heilopfer wartet auf den Naechsten.
   *
   * Der Zug wirkt nicht auf den Anwender, sondern auf den, der nach ihm
   * kommt — und wer das ist, steht erst fest, wenn er gefallen ist. Also ein
   * Merker an der Seite statt einer Wirkung am Kaempfer.
   */
  healingWish?: boolean
}

/**
 * Ein Effekt, der an einem Kaempfer haengt und ueber Runden wirkt.
 *
 * `turns` zaehlt herunter und wird am Rundenende geprueft; `null` heisst: bis
 * zum Einwechseln oder bis die Bedingung entfaellt (Nachtmahr endet mit dem
 * Aufwachen).
 */
export const LINGERING_KINDS = [
  'leech_seed', 'aqua_ring', 'nightmare', 'curse', 'yawn', 'encore', 'disable',
  /** Magnetflug: haelt vom Boden ab, Bodenzuege gehen ins Leere. */
  'magnet_rise',
  /** Zielschuss, Willensleser: der naechste eigene Zug trifft, komme was wolle. */
  'sure_hit',
  /** Scharfblick, Telekinese: auf dieses Ziel trifft jeder. */
  'vulnerable',
  /** Horrorblick, Rueckentzug, Spinnennetz: das Feld bleibt, wo es ist. */
  'trapped',
  /** Verwurzler: schlaegt Wurzeln — heilt und haelt zugleich fest. */
  'ingrain',
  /** Verhoehner: nur noch Zuege, die Schaden machen. */
  'taunt',
  /** Folterknecht: nicht zweimal derselbe Zug. */
  'torment',
  /** Begrenzer: nichts, was der Anwender auch kann. */
  'imprison',
  /** Heilblockade: keine Heilung mehr. */
  'heal_block',
  /** Abgesang: drei Runden, dann faellt der Traeger. */
  'perish',
  /** Wunschtraum: naechste Runde die halben Kraftpunkte zurueck. */
  'wish',
  /** Nachspiel: wer den Traeger faellt, verliert dafuer seinen Zug. */
  'grudge',
] as const
export type LingeringKind = (typeof LINGERING_KINDS)[number]

export interface Lingering {
  kind: LingeringKind
  turns: number | null
  /** Bei Zugabe und Aussetzer: welcher Zug gemeint ist. */
  moveId?: string
  /** Bei Begrenzer: welche Zuege gesperrt sind — die des Anwenders. */
  moveIds?: string[]
  /** Wer ihn gesetzt hat — Egelsamen speist den Setzer. */
  from?: 0 | 1
}

export const SIDE_CONDITIONS = [
  'reflect', 'light_screen', 'safeguard', 'mist', 'tailwind',
  /** Beschwoerung: fuenf Runden ohne Volltreffer gegen diese Seite. */
  'lucky_chant',
  /*
   * Einstiegsfallen. Sie laufen nicht ab, sie liegen — bis der Kampf endet.
   * Deshalb `turns: null` und ein Zaehler `layers`: Stachler und Giftspitzen
   * werden staerker, wenn man sie mehrfach streut.
   */
  'spikes', 'toxic_spikes', 'stealth_rock', 'sticky_web',
  /*
   * Lehmsuhler und Nassmacher.
   *
   * Im Vorbild daempfen sie einen Typ auf dem ganzen Feld. Hier schuetzen sie
   * die Seite, die sie gestellt hat — genau wie Reflektor und Lichtschild,
   * nur nach Typ statt nach Kategorie. Ein zweites Feldsystem fuer zwei Zuege
   * waere mehr Maschine als Wirkung.
   */
  'mud_sport', 'water_sport',
] as const
export type SideConditionKind = (typeof SIDE_CONDITIONS)[number]

export interface SideCondition {
  kind: SideConditionKind
  /** `null` heisst: liegt, bis der Kampf endet. Das gilt fuer die Fallen. */
  turns: number | null
  /** Wie oft gestreut. Nur die Fallen zaehlen mit. */
  layers?: number
}

export type BattleKind = 'wild' | 'trainer' | 'gym' | 'pvp' | 'raid'

/**
 * Was auf dem Boden liegt.
 *
 * Anders als ein Schirm gehoert ein Feld keiner Seite: Grasfeld heilt beide,
 * Nebelfeld schuetzt beide. Es steht deshalb neben dem Wetter im Kampf und
 * nicht in einer der beiden Seiten — und wie das Wetter aendert es Schaden,
 * ohne selbst welchen zu machen.
 */
export const TERRAINS = ['grassy', 'electric', 'misty'] as const
export type TerrainKind = (typeof TERRAINS)[number]

export interface Terrain {
  kind: TerrainKind
  turns: number
}

/**
 * Was ueber dem ganzen Kampf liegt, ohne Boden zu sein.
 *
 * Getrennt vom Boden, weil beides zugleich gelten kann: Erdanziehung zieht
 * herunter, was fliegt, Wunderraum vertauscht die beiden Verteidigungen,
 * Plasmaschauer faerbt eine Runde lang alles Normale elektrisch. Eine Liste
 * statt dreier Merker, damit ein vierter nichts kostet.
 */
export const FIELD_EFFECTS = ['gravity', 'wonder_room', 'ion_deluge'] as const
export type FieldEffectKind = (typeof FIELD_EFFECTS)[number]

export interface FieldEffect {
  kind: FieldEffectKind
  turns: number
}

export interface BattleState {
  id: string
  kind: BattleKind
  seed: string
  turn: number
  sides: [Side, Side]
  weather: Weather
  /** Was gerade auf dem Boden liegt. Wahlfrei: ein Kampf, der vor dieser
   *  Aenderung begann, liegt als JSON in der Datenbank und kennt es nicht. */
  terrain?: Terrain | null
  /** Was sonst noch ueber dem Kampf liegt. Wahlfrei wie der Boden. */
  fields?: FieldEffect[]
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
  /** Ein Angriff ist an einem Schutz abgeprallt. */
  | { type: 'protected'; side: 0 | 1; fighter: string }
  /** Jemand hat einen Treffer mit einem Kraftpunkt ueberstanden. */
  | { type: 'endured'; side: 0 | 1; fighter: string }
  /** Alle Wertveraenderungen sind zurueckgesetzt (Dunkelnebel). */
  | { type: 'stages_cleared'; side: 0 | 1; fighter: string }
  /** Ein Zug bereitet etwas vor: Volltrefferchance, sicherer Treffer. */
  | { type: 'prepared'; side: 0 | 1; fighter: string; what: 'crit' | 'sure_crit' | 'stats_copied' | 'stats_swapped' | 'destiny_bond' | 'priority_guard' | 'endure' | 'magic_coat' }
  /** Ein anhaltender Effekt beginnt oder endet. */
  | { type: 'lingering'; side: 0 | 1; fighter: string; kind: Lingering['kind']; started: boolean }
  /** Ein anhaltender Effekt hat gewirkt: Abzug oder Zuwachs. */
  | { type: 'lingering_tick'; side: 0 | 1; fighter: string; kind: Lingering['kind']; amount: number; hpLeft: number }
  /** Ein Schirm liegt ueber einer Seite. */
  | { type: 'side_condition'; side: 0 | 1; kind: SideCondition['kind']; started: boolean }
  /** Ein Schirm hat etwas abgewehrt. */
  | { type: 'blocked'; side: 0 | 1; fighter: string; by: SideConditionKind | 'terrain' | 'heal_block' }
  /** Jemand hat den Boden umgestellt — oder er ist verflogen. */
  | { type: 'terrain'; side: 0 | 1; fighter: string; terrain: TerrainKind | null }
  /** Jemand wurde aus dem Kampf gedraengt. */
  | { type: 'forced_out'; side: 0 | 1; fighter: string }
  /** Der Zug tut, was er soll: nichts. */
  | { type: 'nothing'; side: 0 | 1; fighter: string }
  /** Der Rueckzug ist versperrt. */
  | { type: 'trapped'; side: 0 | 1; fighter: string }
  /** Eine Einstiegsfalle hat den Nachrueckenden erwischt. */
  | { type: 'hazard'; side: 0 | 1; fighter: string; kind: SideConditionKind }
  /** Werte wurden geteilt oder getauscht. */
  | { type: 'shared'; side: 0 | 1; fighter: string; what: 'guard' | 'power' | 'hp' | 'guard_stages' | 'power_stages' }
  /** Kraftpunkte eines Zuges sind verloren. */
  | { type: 'pp_drain'; side: 0 | 1; fighter: string; moveId: string; amount: number }
  /** Ein Zug hat einen anderen aufgerufen. */
  | { type: 'called'; side: 0 | 1; fighter: string; moveId: string }
  /** Die Puppe steht, schluckt oder zerbricht. */
  | { type: 'substitute'; side: 0 | 1; fighter: string; what: 'up' | 'hit' | 'broken' | 'failed' }
  /** Jemand hat seinen Typ gewechselt. */
  | { type: 'type_changed'; side: 0 | 1; fighter: string; types: string[] }
  /** Jemand ist zur Kopie seines Gegenuebers geworden. */
  | { type: 'transformed'; side: 0 | 1; fighter: string; into: string }
  /** Ein Statuszug ist auf den Absender zurueckgefallen. */
  | { type: 'reflected'; side: 0 | 1; fighter: string; moveId: string }
  /** Ein Feldeffekt beginnt oder endet. */
  | { type: 'field'; kind: FieldEffectKind; started: boolean }
  | { type: 'end'; outcome: BattleOutcome }

export type PlayerAction =
  | { kind: 'move'; moveIndex: number }
  | { kind: 'switch'; partyIndex: number }
  | { kind: 'item'; itemId: string; targetIndex: number }
  | { kind: 'forfeit' }

/** Hard cap so a battle between two defensive teams cannot run forever. */
export const MAX_TURNS = 200
