import { z } from 'zod'

/**
 * Die hoechste Levelzahl, die in einem Pack stehen darf.
 *
 * Frueher stand hier ueberall 100 — die alte Levelkappe. Seit die Reisegrenze
 * mit jeder bezwungenen Region waechst, sind Regionen entworfen, die darueber
 * hinausgehen: Hoenn endet bei 150. Die Zahl gehoert bewusst nicht in die
 * Engine importiert, sonst haenge das Inhaltsschema an der Spiellogik.
 */
const MAX_CONTENT_LEVEL = 500
import { GROWTH_RATES, TIMES_OF_DAY, WEATHERS } from '@game/shared'

/* ---------------------------------------------------------------------------
 * Content packs
 *
 * The engine knows nothing about any particular franchise. Everything it can
 * name — creatures, types, moves, items, areas, story beats — comes from a pack
 * directory that is validated against these schemas at boot. Swapping the pack
 * swaps the whole game world without touching a line of code.
 * ------------------------------------------------------------------------- */

const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lowercase kebab-case')
const LocalizedText = z.record(z.string(), z.string()).refine((v) => 'de' in v, {
  message: 'every localized text needs at least a "de" entry',
})

export const TypeDefSchema = z.object({
  id: Id,
  name: LocalizedText,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
})
export type TypeDef = z.infer<typeof TypeDefSchema>

/** Effectiveness multipliers, keyed attacker -> defender. Missing pairs are 1. */
export const TypeChartSchema = z.record(Id, z.record(Id, z.number().min(0).max(4)))
export type TypeChart = z.infer<typeof TypeChartSchema>

export const MoveDefSchema = z.object({
  id: Id,
  name: LocalizedText,
  type: Id,
  category: z.enum(['physical', 'special', 'status']),
  power: z.number().int().min(0),
  accuracy: z.number().int().min(0).max(100),
  pp: z.number().int().min(1).max(64),
  priority: z.number().int().min(-7).max(5).default(0),
  /**
   * Nur in der ersten Runde nach dem Einwechseln einsetzbar.
   *
   * Mogelhieb hat Vorrang 3 und lässt den Gegner zu 100 % zurückschrecken.
   * Ohne diese Schranke setzt ein Mauzi ihn jede Runde ein, und der Gegenüber
   * kommt nie zum Zug — der Kampf sieht eingefroren aus. Genau so wurde es
   * gemeldet.
   */
  firstTurnOnly: z.boolean().default(false),
  /**
   * Der Zustand, in dem das Ziel sein muss, damit die Attacke ueberhaupt
   * wirkt.
   *
   * Traumfresser stand mit 100 Staerke und halbem Aussaugen im Pack, und
   * seine einzige Schranke — "only works on sleeping Pokemon" — stand im
   * Beschreibungstext, den niemand liest ausser Menschen. Damit war er die
   * beste Spezialattacke im Spiel ohne jede Bedingung; genau so wurde es
   * gemeldet. Die Bedingung gehoert hierher, nicht in die Beschreibung, und
   * sie ist bewusst allgemein: Schnarcher und Nachtmahr haben dieselbe.
   */
  requiresTargetStatus: z.enum(['burn', 'freeze', 'paralysis', 'poison', 'toxic', 'sleep']).optional(),
  /** Extra crit stages. 0 = normal (1/24), 1 = high crit (1/8), 3 = always. */
  critRate: z.number().int().min(0).max(3).default(0),
  /** Who the move acts on. Status moves need this; damage always hits the foe. */
  target: z.enum(['foe', 'self', 'field']).default('foe'),
  /** Chance in percent that `effect` triggers on a successful hit. */
  effectChance: z.number().int().min(0).max(100).default(0),
  effect: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('none') }),
      z.object({ kind: z.literal('status'), status: z.enum(['burn', 'freeze', 'paralysis', 'poison', 'toxic', 'sleep', 'confusion']) }),
      z.object({
        kind: z.literal('stat_stage'),
        target: z.enum(['self', 'foe']),
        stat: z.enum(['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion']),
        stages: z.number().int().min(-6).max(6),
      }),
      z.object({ kind: z.literal('drain'), ratio: z.number().min(0).max(1) }),
      z.object({ kind: z.literal('recoil'), ratio: z.number().min(0).max(1) }),
      z.object({ kind: z.literal('heal'), ratio: z.number().min(0).max(1) }),
      z.object({ kind: z.literal('multi_hit'), min: z.number().int(), max: z.number().int() }),
      z.object({ kind: z.literal('flinch') }),
      /*
       * Das Wetter im Kampf umstellen.
       *
       * Regentanz, Sonnentag, Sandsturm und Hagelsturm standen ohne Wirkung im
       * Pack — in 79 Attackenplaetzen lag damit ein toter Zug. Das Wetter
       * aendert den Schaden bereits (`weatherModifier`), es fehlte nur der
       * Weg, es absichtlich zu setzen.
       */
      z.object({
        kind: z.literal('weather'),
        weather: z.enum(['clear', 'rain', 'storm', 'snow', 'fog', 'sandstorm', 'heat']),
      }),
      /*
       * Schutzschild und Scanner fangen alles ab; Rapidschutz nur Zuege mit
       * Vorrang. Im Vorbild schuetzt er das ganze Team — im Einzelkampf ist
       * das genau einer, und der Zug bleibt sinnvoll.
       */
      z.object({ kind: z.literal('protect'), against: z.enum(['all', 'priority']).default('all') }),
      /** Akupressur: ein eigener Wert, zufaellig gewaehlt, um zwei Stufen. */
      z.object({ kind: z.literal('random_stat_up'), stages: z.number().int().min(1).max(3) }),
      /** Abgangsbund: wer den Traeger in dieser Runde faellt, faellt mit. */
      z.object({ kind: z.literal('destiny_bond') }),
      /*
       * Was ueber Runden wirkt.
       *
       * Der Zustand eines Pokemon kann nur eines auf einmal sein — Schlaf
       * *oder* Gift. Egelsamen, Wasserring, Nachtmahr und Fluch wirken daneben
       * und gleichzeitig; sie haengen deshalb an einer eigenen Liste.
       */
      z.object({
        kind: z.literal('lingering'),
        effect: z.enum([
          'leech_seed', 'aqua_ring', 'nightmare', 'curse', 'yawn', 'encore', 'disable',
          'magnet_rise', 'sure_hit', 'vulnerable',
          'trapped', 'ingrain', 'taunt', 'torment', 'imprison', 'heal_block',
          'perish', 'wish', 'grudge',
        ]),
        /** Wie viele Runden. Fehlt es, gilt der Effekt bis zum Einwechseln. */
        turns: z.number().int().min(1).max(10).optional(),
      }),
      /** Reflektor, Lichtschild, Bodyguard, Weissnebel, Rueckenwind. */
      z.object({
        kind: z.literal('side_condition'),
        condition: z.enum([
          'reflect', 'light_screen', 'safeguard', 'mist', 'tailwind', 'lucky_chant',
          'mud_sport', 'water_sport',
        ]),
        turns: z.number().int().min(1).max(10),
      }),
      /** Ausdauer: dieser Treffer laesst mindestens einen Kraftpunkt. */
      z.object({ kind: z.literal('endure') }),
      /** Erholung: voll heilen und dafuer zwei Runden schlafen. */
      z.object({ kind: z.literal('rest') }),
      /** Heilung, Vitalglocke: Zustandsleiden aufheben, bei sich oder im Team. */
      z.object({ kind: z.literal('cure'), scope: z.enum(['self', 'party']) }),
      /** Energiefokus, Konzentration: bessere oder sichere Volltreffer. */
      z.object({ kind: z.literal('crit_up'), stages: z.number().int().min(1).max(3), sure: z.boolean().default(false) }),
      /** Dunkelnebel: alle Wertveraenderungen auf beiden Seiten zurueck. */
      z.object({ kind: z.literal('haze') }),
      /** Psycho-Plus: die Wertveraenderungen des Ziels uebernehmen. */
      z.object({ kind: z.literal('copy_stages') }),
      /** Krafttrick: eigenen Angriff und eigene Verteidigung tauschen. */
      z.object({ kind: z.literal('swap_stats') }),
      /** Grasfeld, Elektrofeld, Nebelfeld: was auf dem Boden liegt. */
      z.object({
        kind: z.literal('terrain'),
        terrain: z.enum(['grassy', 'electric', 'misty']),
      }),
      /*
       * Wirbelwind, Brueller, Teleport: jemand muss das Feld raeumen.
       *
       * Wen es trifft, sagt `target`: die beiden ersten draengen den Gegner
       * hinaus, Teleport bringt den Anwender selbst weg. Wer keinen Ersatz auf
       * der Bank hat, bleibt stehen — der Zug scheitert dann sichtbar.
       */
      z.object({ kind: z.literal('force_switch') }),
      /*
       * Platscher.
       *
       * Ein eigener Eintrag fuer "tut nichts" statt `none`, weil die beiden
       * verschiedene Dinge heissen: `none` ist ein Zug, dessen Wirkung hier
       * noch fehlt, `nothing` ist einer, dessen Wirkung genau darin besteht,
       * keine zu haben. Nur so bleibt die Liste der offenen Zuege ehrlich.
       */
      z.object({ kind: z.literal('nothing') }),
      /*
       * Einstiegsfallen.
       *
       * Eigene Bauart und kein `side_condition`, weil sie sich anders
       * verhalten: sie laufen nicht ab, und ein zweiter Wurf verstaerkt sie,
       * statt die Uhr neu zu stellen.
       */
      z.object({
        kind: z.literal('hazard'),
        hazard: z.enum(['spikes', 'toxic_spikes', 'stealth_rock', 'sticky_web']),
      }),
      /*
       * Werte teilen oder tauschen.
       *
       * Fuenf Zuege, ein Muster: Schutztausch und Krafttausch tauschen die
       * *Veraenderungen*, Schutzteiler und Kraftteiler mitteln die Werte
       * selbst, Leidteiler mittelt die Kraftpunkte. Ein Feld statt fuenf
       * Bauarten, weil sich nur das Was unterscheidet.
       */
      z.object({
        kind: z.literal('share'),
        what: z.enum(['guard_stages', 'power_stages', 'guard', 'power', 'hp']),
      }),
      /** Groll: Kraftpunkte des zuletzt benutzten gegnerischen Zuges. */
      z.object({ kind: z.literal('pp_drain'), amount: z.number().int().min(1).max(8) }),
      /** Bauchtrommel: die Haelfte der Kraftpunkte fuer vollen Angriff. */
      z.object({ kind: z.literal('belly_drum') }),
      /** Heilopfer: der Anwender faellt, der Naechste kommt geheilt. */
      z.object({ kind: z.literal('healing_wish') }),
      /** Stafette: hinausgehen und alles Aufgebaute weiterreichen. */
      z.object({ kind: z.literal('baton_pass') }),
      /** Psybann: das eigene Leiden an den Gegenueber weitergeben. */
      z.object({ kind: z.literal('psycho_shift') }),
      /*
       * Zuege, die andere Zuege aufrufen.
       *
       * `foe_last` nimmt den letzten des Gegenuebers (Egotrip, Spiegeltrick,
       * Imitator), `own_random` einen eigenen (Schlafrede), `any_random`
       * irgendeinen (Metronom), `terrain` den, der zum Boden passt
       * (Natur-Kraft). Ein aufgerufener Zug darf selbst keinen aufrufen.
       */
      z.object({
        kind: z.literal('call_move'),
        source: z.enum(['foe_last', 'own_random', 'any_random', 'terrain']),
      }),
      /*
       * Mimikry und Nachahmer.
       *
       * Beide ersetzen den Platz, aus dem sie kamen. Nachahmer tut das im
       * Vorbild fuer immer — hier nur fuer diesen Kampf: die Attacken eines
       * Pokemon stehen in der Datenbank, und ein Kampf schreibt nicht hinein.
       */
      z.object({ kind: z.literal('copy_move') }),
      /*
       * Typwechsel.
       *
       * `water` ist Ueberflutung, `own_move` Umwandlung, `resist_last`
       * Umwandlung2, `target` Typenspiegel, `terrain` Tarnung.
       */
      z.object({
        kind: z.literal('type_change'),
        to: z.enum(['water', 'own_move', 'resist_last', 'target', 'terrain']),
      }),
      /** Delegator: ein Viertel der Kraftpunkte wird zur Puppe. */
      z.object({ kind: z.literal('substitute') }),
      /** Wandler: die Kopie des Gegenuebers, bis man das Feld verlaesst. */
      z.object({ kind: z.literal('transform') }),
      /** Magiemantel: der naechste Statuszug faellt auf den Absender zurueck. */
      z.object({ kind: z.literal('magic_coat') }),
      /** Erdanziehung, Wunderraum, Plasmaschauer. */
      z.object({
        kind: z.literal('field'),
        field: z.enum(['gravity', 'wonder_room', 'ion_deluge']),
        turns: z.number().int().min(1).max(10),
      }),
    ])
    .default({ kind: 'none' }),
})
export type MoveDef = z.infer<typeof MoveDefSchema>

export const EvolutionSchema = z.discriminatedUnion('trigger', [
  z.object({ trigger: z.literal('level'), to: Id, level: z.number().int().min(2).max(MAX_CONTENT_LEVEL) }),
  z.object({ trigger: z.literal('stone'), to: Id, itemId: Id }),
  z.object({ trigger: z.literal('friendship'), to: Id, minFriendship: z.number().int().min(1).max(255), timeOfDay: z.enum(TIMES_OF_DAY).optional() }),
  /* Kein Tragegegenstand: den gibt es im Spiel nicht, also kann er auch
     keine Bedingung sein. Das Verbindungskabel ist die ganze Bedingung. */
  z.object({ trigger: z.literal('trade'), to: Id }),
])
export type Evolution = z.infer<typeof EvolutionSchema>

export const SpeciesDefSchema = z.object({
  id: Id,
  dexNumber: z.number().int().min(1),
  name: LocalizedText,
  description: LocalizedText.default({ de: '' }),
  /** Drives spawn weighting, shop value and how loudly a catch is celebrated. */
  rarity: z.enum(['common', 'uncommon', 'rare', 'legendary']).default('common'),
  types: z.array(Id).min(1).max(2),
  baseStats: z.object({
    hp: z.number().int().min(1), atk: z.number().int().min(1), def: z.number().int().min(1),
    spa: z.number().int().min(1), spd: z.number().int().min(1), spe: z.number().int().min(1),
  }),
  growthRate: z.enum(GROWTH_RATES),
  /** Higher = easier to catch. Same scale as the classic 0..255 rate. */
  catchRate: z.number().int().min(1).max(255),
  baseXpYield: z.number().int().min(1),
  /** Steps-equivalent for hatching; the engine converts this to real minutes. */
  hatchCycles: z.number().int().min(1),
  eggGroups: z.array(Id),
  /** Moves the species can learn, with the level at which they unlock. */
  learnset: z.array(z.object({ moveId: Id, level: z.number().int().min(0).max(MAX_CONTENT_LEVEL) })),
  /**
   * Wie viel EP diese Art für einen Aufstieg braucht, relativ zur Kurve.
   *
   * 2 heißt: doppelt so viel. Kein zweiter Kurventyp, sondern ein Faktor —
   * damit bleibt die Kurve dieselbe und nur das Tempo ändert sich.
   */
  xpFactor: z.number().min(0.1).max(10).default(1),
  /**
   * Ereignis-Art: wird von Hand vergeben, taucht in keiner Spawn-Tabelle auf
   * und zählt nicht in die Pokédex-Summe. Sonst wäre der Dex für alle
   * unvollständig, die bei der Verteilung nicht dabei waren.
   */
  event: z.boolean().default(false),
  /**
   * Untergrenze für die Werte eines wild gefangenen Exemplars, 0 bis 31.
   *
   * Für besondere Arten, die man findet statt geschenkt zu bekommen: sie
   * sollen spürbar besser sein als der Durchschnitt, aber nicht makellos —
   * sonst wäre der Fund das Ende der Suche und nicht ihr Anfang.
   */
  ivFloor: z.number().int().min(0).max(31).default(0),
  evolutions: z.array(EvolutionSchema).default([]),
  sprite: z.string(),
  spriteShiny: z.string(),
})
export type SpeciesDef = z.infer<typeof SpeciesDefSchema>

export const ItemDefSchema = z.object({
  id: Id,
  name: LocalizedText,
  description: LocalizedText,
  category: z.enum(['ball', 'berry', 'medicine', 'xp', 'stone', 'lure', 'material', 'background', 'gear', 'key']),
  price: z.number().int().min(0).nullable(),
  sellPrice: z.number().int().min(0).nullable(),
  stackable: z.boolean().default(true),
  icon: z.string(),
  /** Category-specific numbers the engine reads. Kept loose on purpose so a
   *  pack can introduce a new berry without an engine change. */
  params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).default({}),
})
export type ItemDef = z.infer<typeof ItemDefSchema>

export const SpawnEntrySchema = z.object({
  speciesId: Id,
  weight: z.number().min(0),
  minLevel: z.number().int().min(1).max(MAX_CONTENT_LEVEL),
  maxLevel: z.number().int().min(1).max(MAX_CONTENT_LEVEL),
  timeOfDay: z.array(z.enum(TIMES_OF_DAY)).optional(),
  weather: z.array(z.enum(WEATHERS)).optional(),
})
export type SpawnEntry = z.infer<typeof SpawnEntrySchema>

export const AreaDefSchema = z.object({
  id: Id,
  regionId: Id,
  order: z.number().int().min(1),
  name: LocalizedText,
  description: LocalizedText,
  icon: z.string(),
  background: z.string(),
  /** What the trainer must have done elsewhere before this area opens. */
  unlock: z.object({
    previousAreaId: Id.nullable(),
    /**
   * Wie viele Arten insgesamt im Pokédex stehen müssen.
   *
   * Löst `minCaughtInPrevious` ab. Fänge im Vorgängergebiet zu verlangen hieß:
   * wer auf Route 1 ein Taubsi gefangen hat, muss auf Route 2 noch eins
   * fangen — dieselbe Art, nur woanders. Der Pokédex zählt, was man
   * tatsächlich erreicht hat, und zählt es einmal.
   */
  minDexCaught: z.number().int().min(0).default(0),
  minCaughtInPrevious: z.number().int().min(0).default(0),
    minCreaturesAtLevel: z.object({ count: z.number().int().min(0), level: z.number().int().min(1) }).nullable(),
    requiredBadgeIds: z.array(Id).default([]),
  }),
  spawns: z.array(SpawnEntrySchema).min(1),
  /** Trainer battles offered here, resolved against the pack's trainer defs. */
  trainerIds: z.array(Id).default([]),
  gymId: Id.nullable().default(null),
})
export type AreaDef = z.infer<typeof AreaDefSchema>

/** One creature on an NPC team. Moves may be omitted; the engine then picks
 *  the four most recent level-up moves for that level. */
export const NpcTeamMemberSchema = z.object({
  speciesId: Id,
  level: z.number().int().min(1).max(MAX_CONTENT_LEVEL),
  moves: z.array(Id).max(4).optional(),
  heldItemId: Id.optional(),
})
export type NpcTeamMember = z.infer<typeof NpcTeamMemberSchema>

export const BadgeDefSchema = z.object({
  id: Id,
  name: LocalizedText,
  description: LocalizedText,
  icon: z.string(),
  /** Creatures above this level stop obeying without the badge. */
  obedienceLevel: z.number().int().min(1).max(MAX_CONTENT_LEVEL),
})
export type BadgeDef = z.infer<typeof BadgeDefSchema>

export const TrainerDefSchema = z.object({
  id: Id,
  name: LocalizedText,
  title: LocalizedText,
  kind: z.enum(['trainer', 'gym', 'elite', 'champion', 'rival', 'raid']),
  sprite: z.string(),
  team: z.array(NpcTeamMemberSchema).min(1).max(6),
  /** Awarded on first win. Only gym and champion trainers carry one. */
  badgeId: Id.nullable().default(null),
  rewardGold: z.number().int().min(0),
  /**
   * Faktor auf die Erfahrung aus diesem Kampf.
   *
   * Für die Trainingsarena: dort ist die Erfahrung der Zweck, nicht ein
   * Nebenprodukt. Vier Kämpfe für ein halbes Level wären der falsche Tausch.
   */
  xpMultiplier: z.number().min(0).max(10).default(1),
  /** Repeat wins pay less, so grinding one easy trainer is not a strategy. */
  repeatRewardRatio: z.number().min(0).max(1).default(0.25),
  dialogue: z.object({
    intro: LocalizedText,
    win: LocalizedText,
    lose: LocalizedText,
  }),
})
export type TrainerDef = z.infer<typeof TrainerDefSchema>

export const RegionDefSchema = z.object({
  id: Id,
  order: z.number().int().min(1),
  name: LocalizedText,
  tagline: LocalizedText,
  /** Starter dieser Region. Leer heißt: es gelten die des Packs. Seit die
   *  Startregion frei wählbar ist, gehört die Wahl des ersten Partners zur
   *  Region — sonst begänne man Hoenn mit einem Kanto-Starter. */
  starterSpeciesIds: z.array(Id).default([]),
  /*
   * Welche Legendaeren hier zu finden sind.
   *
   * Eine ausgeschriebene Liste, kein Schluss aus Dex-Nummern. Der Versuch, es
   * herzuleiten, ist gescheitert und musste scheitern: Legendaere tragen die
   * hoechsten Nummern ihrer Generation, also liegen sie immer *ausserhalb* der
   * Spanne, die gewoehnliche Wildbegegnungen aufspannen. Kanto reichte bis
   * Dragonir 148 und verlor damit Mewtu und Mew.
   *
   * Leer heisst: diese Region hat keine. Der Prueflduft weicht dann auf das
   * ganze Paket aus, damit er nicht ins Leere laeuft.
   */
  legendarySpeciesIds: z.array(Id).default([]),
})
export type RegionDef = z.infer<typeof RegionDefSchema>

export const ChapterConditionSchema = z.object({
  /*
   * `regionBadges` und `regionDexCaught` zaehlen nur, was in *dieser* Region
   * erreicht wurde.
   *
   * Die globalen Varianten setzten eine Reihenfolge voraus, die es nicht mehr
   * gibt: das zweite Kapitel verlangte den Vertania-Wald, und wer in Hoenn
   * anfaengt, kommt dort erst nach der halben Welt vorbei.
   */
  kind: z.enum([
    'badges', 'dexCaught', 'areaVisited', 'highestLevel', 'defeated',
    'regionBadges', 'regionDexCaught',
  ]),
  value: z.union([z.number(), z.string()]),
})

export const ChapterDefSchema = z.object({
  id: Id,
  order: z.number().int().min(1),
  /** Zu welcher Region das Kapitel gehört. Leer heißt: regionsübergreifend. */
  regionId: Id.nullable().default(null),
  /** Wer durch dieses Kapitel führt. Leer heißt: der Name aus der Oberfläche.
   *  Gehört ins Pack, weil er zur Region gehört — Kanto hat einen anderen
   *  Professor als Hoenn. */
  guide: LocalizedText.optional(),
  title: LocalizedText,
  intro: LocalizedText,
  outro: LocalizedText,
  requires: z.array(ChapterConditionSchema).min(1),
  reward: z.object({
    gold: z.number().int().min(0),
    itemId: Id.optional(),
    quantity: z.number().int().min(1).optional(),
  }),
})
export type ChapterDef = z.infer<typeof ChapterDefSchema>

export const PackManifestSchema = z.object({
  id: Id,
  name: z.string(),
  version: z.string(),
  /** Free-text note the operator sees in the admin panel — e.g. licensing. */
  notice: z.string().default(''),
  defaultLocale: z.string().default('de'),
  starterSpeciesIds: z.array(Id).min(1),
  startingArea: Id,
})
export type PackManifest = z.infer<typeof PackManifestSchema>

/** The fully loaded, cross-referenced pack the engine receives. */
export interface ContentPack {
  manifest: PackManifest
  types: Map<string, TypeDef>
  typeChart: TypeChart
  moves: Map<string, MoveDef>
  species: Map<string, SpeciesDef>
  items: Map<string, ItemDef>
  areas: Map<string, AreaDef>
  regions: Map<string, RegionDef>
  trainers: Map<string, TrainerDef>
  badges: Map<string, BadgeDef>
  chapters: ChapterDef[]
}
