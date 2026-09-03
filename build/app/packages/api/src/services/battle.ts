import { GameError, NATURES, type Trainer } from '@game/shared'
import { von } from './ledger.js'
import { battleParty } from './party.js'
import type { AreaDef, TrainerDef } from '@game/content'
import {
  activeFighter, battleXpYield, chooseAction, computeStats, createBattle, createRng,
  deriveSeed, ENERGY_COSTS, ENERGY_REWARDS, eventGold, eventLevels, eventLoot, eventPartySize,
  GOLD_PER_ENERGY_FLOOR, grantXpTo,
  isEventTrainer, makeSide, referenceLevel,
  rollLureDrop,
  LEGENDARY_BERRY_ID, npcFighter, PERFECT_IV, resolveTurn, rollBerryDrop, rollPerfect,
  toFighter, xpForLevel, checkLeagueGate,
  type AiLevel, type BattleContent, type BattleEvent, type BattleState,
  type Fighter, type PlayerAction,
} from '@game/engine'
import type { AppContext } from '../context.js'
import { tx } from '../db/index.js'
import * as battles from '../repos/battles.js'
import * as creatures from '../repos/creatures.js'
import * as inventory from '../repos/inventory.js'
import * as world from '../repos/world.js'
import * as dex from '../repos/dex.js'
import * as expeditions from '../repos/expeditions.js'
import { logEvent } from '../repos/events.js'
import { worldClock, dayStart } from '../worldClock.js'
import { refreshMoves } from './garden.js'
import { awardSeasonPoints, bumpMetric } from './progression.js'
import * as energy from './energy.js'
import { referenceOf, scaledLevel, trainerOffset } from './scaling.js'
import { gateFor, leagueOf } from './league.js'
import { capOf } from './travel.js'
import { contributeToGoal } from './guilds.js'
import { busyCreatureIds } from './busy.js'
import { researchBonuses } from './research.js'

/** How well an opponent plays, by kind. Route trainers are beatable by
 *  attacking; gym leaders punish a bad matchup; the champion does not slip. */
const AI_BY_KIND: Record<TrainerDef['kind'], AiLevel> = {
  trainer: 'basic',
  rival: 'skilled',
  gym: 'skilled',
  elite: 'expert',
  champion: 'expert',
  raid: 'skilled',
}

export function battleContent(ctx: AppContext): BattleContent {
  return {
    move: (id) => ctx.registry.move(id),
    effectiveness: (attackingType, defTypes) => ctx.registry.effectiveness(attackingType, defTypes),
    item: (id) => battleItemEffect(ctx, id),
    // Metronom und Umwandlung2 schlagen im Paket nach. Jedes Mal frisch
    // gelesen: das Paket wechselt beim Neustart, nicht mitten im Kampf.
    moveIds: () => ctx.registry.allMoves.map((m) => m.id),
    types: () => ctx.registry.allTypes.map((t) => t.id),
  }
}

/**
 * Was ein Gegenstand im Kampf tut — oder null, wenn er dort nichts tut.
 *
 * Nur Medizin: Bälle fangen keine Trainerpokémon, und ein Entwicklungsstein
 * mitten im Kampf wäre eine andere Baustelle. Die Zahlen stehen im Pack, nicht
 * hier — ein Trank heilt so viel, wie sein `heal` sagt.
 */
export function battleItemEffect(ctx: AppContext, itemId: string) {
  const item = ctx.registry.tryItem(itemId)
  if (!item || item.category !== 'medicine') return null
  const p = item.params
  const effect = {
    heal: typeof p.heal === 'number' ? p.heal : undefined,
    healFull: p.healFull === true,
    cureAll: p.cureAll === true,
    revive: typeof p.revive === 'number' ? p.revive : undefined,
  }
  const usable = effect.heal !== undefined || effect.healFull || effect.cureAll || effect.revive !== undefined
  return usable ? effect : null
}

/* ------------------------------------------------------------------- Views */

export interface FighterView {
  id: string
  name: string
  level: number
  hp: number
  hpMax: number
  status: string
  sprite: string
  shiny: boolean
  types: Array<{ id: string; name: string; color: string }>
  stages: Record<string, number>
  confused: boolean
  fainted: boolean
}

export interface BattleView {
  id: string
  kind: string
  turn: number
  weather: string
  finished: boolean
  winner: number | null
  opponentName: string
  player: {
    active: FighterView
    party: FighterView[]
    moves: Array<{ index: number; id: string; name: string; type: string; typeColor: string; category: string; power: number; accuracy: number; pp: number; ppMax: number; effectiveness: number }>
  }
  foe: { active: FighterView; party: FighterView[] }
  /** Events from the most recent turn only — the client animates these. */
  lastEvents: BattleEvent[]
  reward: BattleReward | null
}

function fighterView(ctx: AppContext, f: Fighter, locale: string): FighterView {
  const species = ctx.registry.trySpecies(f.speciesId)
  return {
    id: f.id,
    name: f.name,
    level: f.level,
    hp: f.hp,
    hpMax: f.hpMax,
    status: f.status,
    sprite: f.sprite,
    shiny: f.shiny,
    types: (species?.types ?? f.types).map((id) => {
      const t = ctx.registry.tryType(id)
      return t
        ? { id: t.id, name: ctx.registry.localized(t.name, locale), color: t.color }
        : { id, name: id, color: '#888888' }
    }),
    stages: f.stages as unknown as Record<string, number>,
    confused: f.confused,
    fainted: f.hp <= 0,
  }
}

export function view(
  ctx: AppContext,
  trainer: Trainer,
  record: battles.BattleRecord,
  lastEvents: BattleEvent[],
  reward: BattleReward | null = null,
): BattleView {
  const state = record.state
  const player = state.sides[0]!
  const foe = state.sides[1]!
  const self = activeFighter(player)
  const target = activeFighter(foe)

  /*
   * Attackennamen uebersetzen, bevor die Ereignisse hinausgehen.
   *
   * Die Engine kennt keine Sprachen — sie schreibt die Kennung der Attacke in
   * das Ereignis, also "flame-burst". Im Kampfprotokoll stand damit Englisch
   * zwischen deutschen Saetzen; genau so gemeldet. Uebersetzt wird hier, wo
   * die Registry und die Sprache des Trainers bekannt sind, und nicht dort,
   * wo die Regeln stehen.
   */
  const named = lastEvents.map((e) => {
    /*
     * Nicht nur `move` traegt eine Attackenkennung.
     *
     * `called` (Metronom, Spiegeltrick), `pp_drain` (Groll, Nachspiel) und
     * `reflected` (Magiemantel) ebenso — und ihre Saetze setzen sie direkt
     * ein. Ohne diese Zeilen stand im Protokoll "Pikachu setzt thunder-shock
     * ein!" mitten im deutschen Text.
     */
    if (e.type === 'move') {
      const move = ctx.registry.tryMove(e.moveId)
      return { ...e, moveName: move ? ctx.registry.localized(move.name, trainer.locale) : e.moveId }
    }
    if (e.type === 'called' || e.type === 'pp_drain' || e.type === 'reflected') {
      const move = ctx.registry.tryMove(e.moveId)
      return { ...e, moveId: move ? ctx.registry.localized(move.name, trainer.locale) : e.moveId }
    }
    return e
  })

  return {
    id: record.id,
    kind: record.kind,
    turn: state.turn,
    weather: state.weather,
    finished: state.outcome !== null,
    winner: state.outcome?.winner ?? null,
    opponentName: foe.trainerName,
    player: {
      active: fighterView(ctx, self, trainer.locale),
      party: player.party.map((f) => fighterView(ctx, f, trainer.locale)),
      moves: self.moves.map((slot, index) => {
        const move = ctx.registry.tryMove(slot.id)
        const type = move ? ctx.registry.tryType(move.type) : undefined
        return {
          index,
          id: slot.id,
          name: move ? ctx.registry.localized(move.name, trainer.locale) : slot.id,
          type: move?.type ?? 'normal',
          typeColor: type?.color ?? '#888888',
          category: move?.category ?? 'physical',
          power: move?.power ?? 0,
          accuracy: move?.accuracy ?? 100,
          pp: slot.pp,
          ppMax: slot.ppMax,
          // Shown as a hint on the move button so type matchups are learnable
          // rather than memorised from a wiki.
          effectiveness: move && move.category !== 'status'
            ? ctx.registry.effectiveness(move.type, target.types)
            : 1,
        }
      }),
    },
    foe: {
      active: fighterView(ctx, target, trainer.locale),
      party: foe.party.map((f) => fighterView(ctx, f, trainer.locale)),
    },
    lastEvents: named,
    reward,
  }
}

/* ------------------------------------------------------------------ Starten */

export function opponentsIn(ctx: AppContext, trainer: Trainer, areaId: string) {
  const area = ctx.registry.area(areaId)
  const defeats = battles.defeatsOf(ctx.db, trainer.id)
  const badges = world.badgesOf(ctx.db, trainer.id)
  const reference = referenceOf(ctx, trainer)
  const defeatedIds = new Set(defeats.keys())
  // Die Liga der Region, aus der einen Stelle, die sie kennt.
  const league = area.regionId ? leagueOf(ctx, area.regionId) : null

  const toEntry = (id: string, isGym: boolean) => {
    const def = ctx.registry.trainer(id)
    const defeat = defeats.get(id)
    const offset = trainerOffset(ctx, trainer, area, reference)
    return {
      id: def.id,
      name: ctx.registry.localized(def.name, trainer.locale),
      title: ctx.registry.localized(def.title, trainer.locale),
      kind: def.kind,
      isGym,
      sprite: def.sprite,
      teamSize: def.team.length,
      maxLevel: scaledLevel(Math.max(...def.team.map((m) => m.level)), offset),
      /** Wie viele Level die Skalierung gerade draufgelegt hat. */
      levelBoost: offset,
      rewardGold: def.rewardGold,
      defeated: Boolean(defeat),
      wins: defeat?.wins ?? 0,
      badgeId: def.badgeId,
      badgeEarned: def.badgeId ? badges.has(def.badgeId) : false,
      intro: ctx.registry.localized(def.dialogue.intro, trainer.locale),
      /*
       * Warum gerade nicht — oder null, wenn es geht.
       *
       * Der Grund gehoert an den Gegner und nicht in eine Fehlermeldung nach
       * dem Antippen: eine Liste, in der vier Knoepfe gleich aussehen und drei
       * davon scheitern, ist keine Liste, sondern ein Ratespiel.
       */
      locked: (() => {
        if (!league) return null
        const gate = checkLeagueGate(id, league.eliteIds, league.championId, defeatedIds)
        if (gate.ok) return null
        return gate.reason === 'elite_locked'
          ? {
              reason: gate.reason,
              requiresName: ctx.registry.localized(ctx.registry.trainer(gate.requires).name, trainer.locale),
            }
          : { reason: gate.reason, missing: gate.missing }
      })(),
    }
  }

  const entries = area.trainerIds.map((id) => toEntry(id, false))
  const gymEntry = area.gymId ? toEntry(area.gymId, true) : null
  return {
    areaId,
    areaName: ctx.registry.localized(area.name, trainer.locale),
    /*
     * Drei Listen statt einer.
     *
     * Vorher standen die Top Vier und der Champion zwischen den Streunern der
     * Route, unter der Ueberschrift „Training". Ein Champion, der neben einem
     * Taucher steht, ist kein Champion — und „Training" war fuer die Liga
     * schlicht das falsche Wort.
     */
    trainers: entries.filter((e) => e.kind !== 'elite' && e.kind !== 'champion'),
    elites: entries.filter((e) => e.kind === 'elite'),
    // Der Champion sitzt im Arena-Platz des Gebiets, nicht in der Trainerliste
    // — deshalb kommt er von dort und nicht aus `entries`.
    champion: gymEntry?.kind === 'champion' ? gymEntry : null,
    gym: gymEntry?.kind === 'champion' ? null : gymEntry,
  }
}

/**
 * Den anstehenden Ueberfall austragen.
 *
 * Eigener Einstieg statt `start`: der Ereignis-Gegner steht in keinem Gebiet,
 * und genau das ist Absicht — er taucht beim Erkunden auf, nicht auf der
 * Karte. Die Vormerkung am Trainer ist zugleich die Berechtigung: ohne sie
 * laesst sich der Kampf nicht starten.
 */
export function startEvent(ctx: AppContext, trainer: Trainer): BattleView {
  return tx(ctx.db, () => {
    const row = ctx.db
      .prepare('SELECT pending_event_id AS id, pending_event_area AS areaId FROM trainers WHERE id = ?')
      .get(trainer.id) as { id: string | null; areaId: string | null } | undefined
    if (!row?.id) throw new GameError('invalid_state', { reason: 'no_event' }, 409)

    const def = ctx.registry.allTrainers.find((t) => t.id === row.id)
    const area = row.areaId ? ctx.registry.tryArea(row.areaId) : null
    if (!def || !area) {
      ctx.db.prepare('UPDATE trainers SET pending_event_id = NULL, pending_event_area = NULL WHERE id = ?')
        .run(trainer.id)
      throw new GameError('invalid_state', { reason: 'no_event' }, 409)
    }

    // Die Vormerkung wird beim Start verbraucht: wer wegläuft, verliert sie.
    ctx.db.prepare('UPDATE trainers SET pending_event_id = NULL, pending_event_area = NULL WHERE id = ?')
      .run(trainer.id)
    // Alles, was beim Erkunden auftaucht, tritt auf Augenhoehe an — Ueberfall
    // wie Streuner.
    return beginBattle(ctx, trainer, def, area, { onEyeLevel: true })
  })
}

export function start(ctx: AppContext, trainer: Trainer, opponentId: string): BattleView {
  return tx(ctx.db, () => {
    if (battles.activeOf(ctx.db, trainer.id)) {
      throw new GameError('invalid_state', { reason: 'battle_in_progress' }, 409)
    }

    const def = ctx.registry.allTrainers.find((t) => t.id === opponentId)
    if (!def) throw new GameError('not_found', { opponentId }, 404)

    /*
     * Erst hier nachsehen, dann anderswo.
     *
     * Vorher stand hier `allAreas.find(...)` — das erste Gebiet aus dem Pack,
     * das diesen Gegner fuehrt. Sechs Trainer stehen aber in *zwei* Gebieten:
     * Bernd der Wanderer am Azuria-Kap und im Felstunnel, der Rocket-Ruepel in
     * zwei, und so weiter. Wer im zweiten stand und ihn antippte, bekam „dafuer
     * musst du erst dorthin reisen" — waehrend er direkt davor stand. Genau so
     * gemeldet.
     */
    const placedIn = (a: AreaDef) => a.gymId === opponentId || a.trainerIds.includes(opponentId)
    const current = trainer.currentAreaId ? ctx.registry.tryArea(trainer.currentAreaId) : null
    const area = current && placedIn(current) ? current : ctx.registry.allAreas.find(placedIn)
    if (!area) throw new GameError('invalid_state', { reason: 'opponent_not_placed' }, 409)
    if (trainer.currentAreaId !== area.id) {
      throw new GameError('invalid_state', { reason: 'wrong_area', areaId: area.id }, 409)
    }

    // Die Top Vier der Reihe nach, der Meister zuletzt.
    const gate = gateFor(ctx, trainer, def.id)
    if (!gate.ok) throw new GameError('invalid_state', { ...gate, ok: undefined }, 409)

    return beginBattle(ctx, trainer, def, area)
  })
}

/**
 * Der gemeinsame Teil von Gebiets- und Ereigniskampf.
 *
 * Kreaturen auf Expedition kaempfen nicht mit; ein besiegtes Team kaempft gar
 * nicht.
 */
export function beginBattle(
  ctx: AppContext, trainer: Trainer, def: TrainerDef, area: AreaDef,
  /*
   * `exactLevels` heisst: die Level im Entwurf sind schon die richtigen.
   *
   * Ein Arenagegner wird aus dem eigenen Durchschnittslevel gebaut; ihn danach
   * noch einmal ueber den Gebietsversatz zu schieben, waere zweimal dieselbe
   * Rechnung — und im Ergebnis stuende die Stufe "leicht" mal fuenf Level
   * darueber statt darunter.
   */
  /*
   * `freeEnergy` heisst: die Gebuehr ist schon bezahlt.
   *
   * Ein Arenadurchlauf zahlt einmal fuer alle vier Kaempfe; die einzelnen
   * Runden duerfen danach nicht noch einmal abbuchen.
   */
  opts: {
    exactLevels?: boolean; storeDef?: boolean; foeIv?: number; freeEnergy?: boolean
    /**
     * Auf Augenhoehe antreten, unabhaengig vom Entwurf.
     *
     * Fuer alles, was beim Erkunden auftaucht: Ueberfaelle *und* Streuner. Sie
     * haben keinen Ort im Entwurf, also waeren feste Level immer fuer jemanden
     * falsch — zu hart fuer die einen, wirkungslos fuer die anderen.
     */
    onEyeLevel?: boolean
  } = {},
): BattleView {
  {
    if (battles.activeOf(ctx.db, trainer.id)) {
      throw new GameError('invalid_state', { reason: 'battle_in_progress' }, 409)
    }
    const busy = busyCreatureIds(ctx, trainer.id)
    const team = creatures.teamOf(ctx.db, trainer.id).filter((c) => !busy.has(c.id))
    if (team.length === 0) throw new GameError('invalid_state', { reason: 'no_team' }, 409)
    const usable = team.filter((c) => c.hpCurrent > 0)
    if (usable.length === 0) throw new GameError('invalid_state', { reason: 'team_fainted' }, 409)

    // Nach allen Pruefungen: ein Kampf, der gar nicht erst zustande kommt,
    // kostet nichts.
    if (!opts.freeEnergy) energy.spendFor(ctx, trainer.id, 'battle')

    /*
     * Ein Legendaeres kaempft, die uebrigen sehen zu.
     *
     * Die Bezugsgroesse fuer die Gegner bleibt bewusst `usable`, also das
     * ganze aufgestellte Team — die Zuschauer heben die Gegnerstufe mit.
     * Genau das ist die Regel: Stapeln macht den Kampf schwerer und die
     * eigene Mannschaft kleiner.
     */
    const { antreten } = battleParty(ctx, usable)

    const ppOf = (id: string) => ctx.registry.tryMove(id)?.pp ?? 10
    const playerParty = antreten.map((c) => {
      const species = ctx.registry.species(c.speciesId)
      return toFighter(c, species, ctx.registry.localized(species.name, trainer.locale), ppOf)
    })

    // Der Gegner steigt mit, wenn das eigene Team ueber seinem Band liegt.
    // Die Attacken bleiben die des Entwurfs: ein Kaefersammler soll auch auf
    // Level 80 ein Kaefersammler sein und keine Arenaleiter-Attacken kennen.
    const offset = opts.exactLevels ? 0 : trainerOffset(ctx, trainer, area)

    /*
     * Ueberfaelle treten auf Augenhoehe an: eigener Teammedian ±3.
     *
     * Anders als ein Arenaleiter hat ein Ueberfall keinen Ort im Entwurf — er
     * passiert dort, wo man gerade erkundet, und quer durch alle Regionen.
     * Feste Level waeren deshalb immer fuer jemanden falsch.
     *
     * Das galt bisher nur fuer Spieler mit eingeschalteter Skalierung, mit der
     * Begruendung "wer sie abschaltet, will die Entwurfswerte". Fuer einen Ort
     * stimmt das; fuer einen Ueberfall nicht, denn er hat keinen. Das Ergebnis
     * war eine Rocket-Truppe auf Level 42 bis 46 vor einem Team auf 25 — genau
     * so gemeldet, und ohne jede Moeglichkeit, ihr auszuweichen.
     *
     * Der Bezug kommt deshalb direkt aus dem antretenden Team und nicht aus
     * `referenceOf`, das bei abgeschalteter Skalierung null liefert.
     */
    // Ueber das ganze Team, nicht ueber die Antretenden: wer drei Legendaere
    // aufstellt, bekommt auch Gegner fuer drei.
    const reference = referenceLevel(usable.map((c) => c.level))
    /*
     * Auch der Streuner tritt auf Augenhoehe an.
     *
     * `isEventTrainer` erkennt nur den Praefix `event-`, also die Ueberfaelle.
     * Ein Streuner ist dagegen ein ganz gewoehnlicher Routentrainer, zufaellig
     * aus der Region gezogen — und behielt damit die Entwurfslevel seiner
     * Heimatroute. Wer mit Level 56 unterwegs war, traf einen Kaefersammler,
     * der fuer Level 8 entworfen wurde; genau so gemeldet.
     *
     * Die Begruendung von oben gilt fuer ihn Wort fuer Wort: er hat keinen Ort
     * im Entwurf, sondern passiert dort, wo man gerade erkundet. `onEyeLevel`
     * setzt `startEvent` fuer alles, was beim Erkunden auftaucht.
     */
    const isEvent = !opts.exactLevels && (opts.onEyeLevel || isEventTrainer(def.id)) && reference > 0
    // Nie mehr Gegner als eigene Mitglieder: drei gegen zwei ist keine knappe
    // Sache, sondern Ueberzahl.
    const foeCount = isEvent
      ? eventPartySize(def.team.length, playerParty.length)
      : def.team.length
    const eventLevelsOf = isEvent ? eventLevels(foeCount, reference) : null
    const cap = capOf(ctx, trainer)

    const foeParty = def.team.slice(0, foeCount).map((member, index) => {
      const species = ctx.registry.species(member.speciesId)
      const level = eventLevelsOf
        ? Math.min(cap, Math.max(2, eventLevelsOf[index] ?? reference))
        : scaledLevel(member.level, offset)
      const moves = member.moves ?? ctx.registry.learnableAt(member.speciesId, level).slice(0, 4)
      return npcFighter(
        `npc-${def.id}-${index}`,
        species,
        ctx.registry.localized(species.name, trainer.locale),
        level,
        moves,
        ppOf,
        'hardy',
        opts.foeIv,
      )
    })

    const seed = deriveSeed(trainer.id, def.id, String(Date.now()))
    const state = createBattle(
      seed, def.kind === 'gym' || def.kind === 'elite' || def.kind === 'champion' ? 'gym' : 'trainer',
      seed,
      makeSide(trainer.displayName, playerParty),
      makeSide(ctx.registry.localized(def.name, trainer.locale), foeParty),
      worldClock().weather,
    )

    const record = battles.create(ctx.db, {
      trainerId: trainer.id,
      kind: state.kind,
      opponentId: def.id,
      areaId: area.id,
      opponentDef: opts.storeDef ? def : undefined,
      seed,
      state,
    })
    logEvent(ctx.db, trainer.id, 'battle.start', { opponentId: def.id, kind: state.kind })
    return view(ctx, trainer, record, [])
  }
}

/* -------------------------------------------------------------------- Zug */

/**
 * Der Gegner einer Kampfzeile.
 *
 * Aus dem Pack, wenn er dort steht — sonst aus der Kopie, die beim Start
 * mitgeschrieben wurde. Arenagegner gibt es nur in dieser zweiten Form.
 */
export function opponentOf(ctx: AppContext, record: battles.BattleRecord): TrainerDef | undefined {
  if (record.opponentDef) return JSON.parse(record.opponentDef) as TrainerDef
  return record.opponentId
    ? ctx.registry.allTrainers.find((t) => t.id === record.opponentId)
    : undefined
}

export function submit(ctx: AppContext, trainer: Trainer, action: PlayerAction): BattleView {
  return tx(ctx.db, () => {
    const record = battles.activeOf(ctx.db, trainer.id)
    if (!record) throw new GameError('invalid_state', { reason: 'no_battle' }, 409)

    const content = battleContent(ctx)
    const def = opponentOf(ctx, record)
    const ai = def ? AI_BY_KIND[def.kind] : 'basic'

    validateAction(record.state, action)

    /*
     * Gegenstand aus dem Beutel nehmen, bevor die Runde laeuft.
     *
     * Verbraucht wird er auch dann, wenn er nichts bewirkt — wer einen Trank
     * auf ein volles Pokemon kippt, hat ihn ausgegeben. Die Oberflaeche zeigt
     * deshalb nur an, was gerade sinnvoll ist.
     */
    if (action.kind === 'item') {
      if (!battleItemEffect(ctx, action.itemId)) {
        throw new GameError('validation_failed', { field: 'itemId' })
      }
      if (inventory.quantityOf(ctx.db, trainer.id, action.itemId) < 1) {
        throw new GameError('insufficient_items', { itemId: action.itemId }, 409)
      }
      inventory.consume(ctx.db, trainer.id, action.itemId, 1)
    }

    // The AI commits before the turn resolves and cannot see the player's
    // choice — the rng stream is derived from the turn number, so the same
    // battle always plays out the same way.
    const aiRng = createRng(deriveSeed(record.seed, 'ai', record.state.turn + 1))
    const foeAction = chooseAction(record.state, 1, ai, content, aiRng)

    const { state, events } = resolveTurn(record.state, action, foeAction, content)
    const allEvents = [...record.events, ...events]
    battles.update(ctx.db, record.id, state, allEvents)

    let reward: BattleReward | null = null
    if (state.outcome) {
      battles.finish(ctx.db, record.id, state.outcome.winner)
      reward = applyOutcome(ctx, trainer, { ...record, state }, def)
    } else {
      persistTeamHp(ctx, trainer, state)
    }

    return view(ctx, trainer, { ...record, state, events: allEvents }, events, reward)
  })
}

function validateAction(state: BattleState, action: PlayerAction): void {
  const side = state.sides[0]!
  if (action.kind === 'move') {
    const fighter = activeFighter(side)
    const slot = fighter.moves[action.moveIndex]
    if (!slot) throw new GameError('validation_failed', { field: 'moveIndex' })
    if (slot.pp <= 0) throw new GameError('invalid_state', { reason: 'no_pp' }, 409)
  }
  if (action.kind === 'item') {
    const target = side.party[action.targetIndex]
    if (!target) throw new GameError('validation_failed', { field: 'targetIndex' })
  }
  if (action.kind === 'switch') {
    const target = side.party[action.partyIndex]
    if (!target) throw new GameError('validation_failed', { field: 'partyIndex' })
    if (target.hp <= 0) throw new GameError('invalid_state', { reason: 'fainted' }, 409)
    if (action.partyIndex === side.activeIndex) {
      throw new GameError('invalid_state', { reason: 'already_active' }, 409)
    }
  }
}

/** Battle HP is authoritative for the garden too, so a hard-won victory leaves
 *  a hurt team that needs potions rather than resetting for free. */
function persistTeamHp(ctx: AppContext, trainer: Trainer, state: BattleState): void {
  for (const fighter of state.sides[0]!.party) {
    creatures.setHp(ctx.db, fighter.id, fighter.hp)
  }
  void trainer
}

/* ---------------------------------------------------------------- Belohnung */

export interface EventLoot {
  gold: number
  items: Array<{ itemId: string; name: string; icon: string; quantity: number }>
  /** Gesetzt, wenn der seltene Wurf getroffen hat. */
  perfect: { speciesId: string; name: string; sprite: string; level: number } | null
}

export interface BattleReward {
  won: boolean
  gold: number
  /** Zusatzbeute aus einem Ueberfall. */
  event: EventLoot | null
  /** Trainer-Energie aus Sieg und ggf. Orden. */
  energy: number
  xpPerMember: number
  firstWin: boolean
  /** Erster Sieg des Tages ueber diesen Gegner — nur er zahlt Saisonpunkte. */
  firstToday: boolean
  badge: { id: string; name: string } | null
  levelUps: Array<{ creatureId: string; name: string; newLevel: number }>
  dialogue: string
}

function applyOutcome(
  ctx: AppContext,
  trainer: Trainer,
  record: battles.BattleRecord,
  def: TrainerDef | undefined,
): BattleReward {
  persistTeamHp(ctx, trainer, record.state)

  const won = record.state.outcome?.winner === 0
  /*
   * Antrittsgeld: jeder ausgefochtene Kampf zahlt etwas.
   *
   * Bemessen an der Energie, die er gekostet hat, nicht am Ansehen des
   * Gegners — sonst waere der zehnte Kampf gegen einen Arenaleiter wieder die
   * beste Goldquelle des Spiels. Es gibt ihn auch bei einer Niederlage: die
   * Energie ist so oder so weg.
   *
   * Nur beim Aufgeben nicht. Sonst waere Kampf anfangen und sofort aufgeben
   * der schnellste Weg zum Antrittsgeld, und das waere kein Kampf mehr.
   */
  const gaveUp = record.state.outcome?.reason === 'forfeit' && record.state.outcome.winner === 1
  const showUp = def && !gaveUp ? ENERGY_COSTS.battle * GOLD_PER_ENERGY_FLOOR : 0
  const empty: BattleReward = {
    won, gold: showUp, energy: 0, event: null, xpPerMember: 0, firstWin: false, firstToday: false, badge: null, levelUps: [],
    dialogue: def
      ? ctx.registry.localized(won ? def.dialogue.lose : def.dialogue.win, trainer.locale)
      : '',
  }
  if (!def || !won) {
    if (!battles.markRewarded(ctx.db, record.id)) return { ...empty, gold: 0 }
    inventory.earnGold(ctx.db, trainer.id, showUp, von(ctx, 'battle.showUp'))
    logEvent(ctx.db, trainer.id, 'battle.end', { opponentId: def?.id, won })
    return empty
  }

  // markRewarded is the guard against paying twice for one victory.
  if (!battles.markRewarded(ctx.db, record.id)) return { ...empty, gold: 0 }

  /*
   * Saisonpunkte gibt es einmal am Tag je Gegner.
   *
   * Ein Arenaleiter zahlte 60 Punkte, und Arenen lassen sich beliebig oft
   * herausfordern: mit einem ausgewachsenen Team sind das 30 Punkte je
   * Energie, waehrend ein Fang 4 gibt und eine Pflegeaktion 2. Die ganze
   * Saisonleiter waere damit ein Nachmittag gegen denselben Gegner. Gemeldet
   * als Verdacht, im Protokoll bestaetigt: 250 Wiederholungssiege gegen einen
   * einzigen Kaefersammler.
   *
   * Der Zeitpunkt muss vor `recordWin` gelesen werden — der Aufruf schreibt
   * ihn neu.
   */
  const lastWin = battles.lastWinAt(ctx.db, trainer.id, def.id)
  /*
   * Arena und Kampfzone stellen **Kunstgegner**: jeder Kampf hat eine eigene
   * Kennung (`arena-2026-08-31-hard-3`, `gauntlet-hoenn-42`). Sie dauerhaft zu
   * vermerken laesst `trainer_defeats` unbegrenzt wachsen — gemessen standen
   * dort schon 119 solcher Zeilen gegen 39 echte Trainer, und keine davon
   * wird je wieder gelesen.
   *
   * Ein erster Sieg sind sie trotzdem: jeder von ihnen tritt genau einmal an.
   */
  const fluechtig = def.id.startsWith('arena-') || def.id.startsWith('gauntlet-')
  const firstWin = fluechtig ? true : battles.recordWin(ctx.db, trainer.id, def.id)
  const firstToday = firstWin || (lastWin !== null && lastWin < dayStart())
  /*
   * Gold gibt es einmal am Tag je Gegner.
   *
   * Der erste Sieg ueberhaupt zahlt voll, der erste an einem spaeteren Tag den
   * Wiederholungsanteil, jeder weitere am selben Tag nichts. Vorher zahlte
   * *jede* Wiederholung ihre 15 bis 50 Prozent: 250 Siege gegen denselben
   * Kaefersammler waren 88.445 Gold, und das war kein Kampf mehr, sondern eine
   * Kurbel. Kaempfen bleibt erlaubt und bringt weiter EP — nur nicht mehr
   * Gold aus derselben Quelle.
   */
  const boni = researchBonuses(ctx, trainer.id)
  const gold = Math.round((showUp + (!firstToday
    ? 0
    : def.rewardGold * (firstWin ? 1 : def.repeatRewardRatio))) * (1 + boni.battleGold / 100))
  inventory.earnGold(ctx.db, trainer.id, gold, von(ctx, 'battle.win'))

  /*
   * Energie gibt es einmal je Gegner, nicht je Kampf.
   *
   * Ein Kampf kostet 2 und gab 4 zurueck — auch beim hundertsten Mal gegen
   * denselben Trainer. Wer die Skalierung nach unten drueckte und in einem
   * Anfangsgebiet alles mit einem Schlag erledigte, machte daraus einen
   * Energie-Automaten; genau so wurde es gemeldet. Der erste Sieg zahlt
   * weiterhin, die Wiederholung ist ein Zuschuss und kein Geschaeft.
   */
  /*
   * Arena und Kampfzone zahlen keine Energie zurueck.
   *
   * Ihre Kunstgegner gelten oben als Erstsieg, damit das Gold stimmt — und
   * damit fiel hier auch die Energie an, je Kampf. Beide Modi bezahlen ihren
   * Einsatz aber *vorne*, einmal je Durchlauf, genau damit die Rechnung nicht
   * mitten in einer Serie zuschlaegt. Ein Zuschuss je Sieg hebt diese
   * Entscheidung wieder auf: gemessen kosteten zwoelf Kampfzonen-Laeufe 120
   * Energie und brachten 1712 zurueck. Das war kein Kampfmodus mehr, sondern
   * ein Energiedrucker; genau so wurde es gemeldet.
   */
  const zahltEnergie = firstWin && !fluechtig
  let energyBack = zahltEnergie ? ENERGY_REWARDS.battleWon : 0
  if (zahltEnergie) energy.reward(ctx, trainer.id, 'battleWon')

  let badge: BattleReward['badge'] = null
  if (def.badgeId && world.awardBadge(ctx.db, trainer.id, def.badgeId)) {
    const b = ctx.registry.badge(def.badgeId)
    badge = { id: b.id, name: ctx.registry.localized(b.name, trainer.locale) }
    energy.reward(ctx, trainer.id, 'badge')
    energyBack += ENERGY_REWARDS.badge
  }

  // XP goes to the creatures that actually took part, scaled by the strongest
  // opponent — beating a gym is worth more than farming a route trainer.
  // Nach dem skalierten Level, nicht nach dem Entwurf: sonst gaebe ein
  // hochskalierter Kampf die EP eines Level-12-Gegners.
  const foeLevel = Math.max(...record.state.sides[1]!.party.map((f) => f.level))
  const baseYield = def.team.reduce((sum, m) => {
    const species = ctx.registry.trySpecies(m.speciesId)
    return sum + (species?.baseXpYield ?? 60)
  }, 0) / def.team.length

  const levelUps: BattleReward['levelUps'] = []
  const participants = record.state.sides[0]!.party
  const cap = capOf(ctx, trainer)
  let xpPerMember = 0

  for (const fighter of participants) {
    const stored = creatures.byId(ctx.db, fighter.id)
    if (!stored) continue
    const species = ctx.registry.species(stored.speciesId)
    // Die Menge der Gegner zaehlt mit — gemessen an dem, was wirklich
    // angetreten ist, nicht am Entwurf: ein Ueberfall stellt je nach eigenem
    // Team eine kleinere Truppe.
    const amount = battleXpYield(baseYield, foeLevel, stored.level, record.state.sides[1]!.party.length)
      * (firstWin ? 1 : 0.5)
      * (def.xpMultiplier ?? 1)
      * (1 + boni.battleXp / 100)
    xpPerMember = Math.round(amount)
    // Ereignis-Arten steigen langsamer; siehe `xpFactor` im Pack.
    const scaled = Math.max(1, Math.round(amount / (species.xpFactor ?? 1)))
    const gained = grantXpTo(species.growthRate, stored.xp, stored.level, scaled, cap)
    ctx.db.prepare('UPDATE creatures SET xp = ?, level = ? WHERE id = ?')
      .run(gained.totalXp, gained.levelAfter, stored.id)

    if (gained.levelsGained > 0) {
      const before = computeStats(species, gained.levelBefore, stored.ivs, stored.evs, stored.nature)
      const after = computeStats(species, gained.levelAfter, stored.ivs, stored.evs, stored.nature)
      creatures.setHp(ctx.db, stored.id, Math.min(after.hp, fighter.hp + (after.hp - before.hp)))
      refreshMoves(ctx, stored.id, stored.speciesId, gained.levelAfter, stored.moves)
      levelUps.push({
        creatureId: stored.id,
        name: stored.nickname ?? ctx.registry.localized(species.name, trainer.locale),
        newLevel: gained.levelAfter,
      })
    }
  }

  if (firstToday) awardSeasonPoints(ctx, trainer.id, def.badgeId ? 'gymWin' : 'battleWin')
  bumpMetric(ctx, trainer.id, 'battles')
  /*
   * Wofuer dieser Sieg zaehlt.
   *
   * Die Wochenaufgaben zaehlen **jeden** Sieg, auch den fuenften ueber
   * denselben Arenaleiter. Das ist der Gegenpol zur Tagesregel beim Gold: die
   * bezahlt Wiederholung absichtlich nicht mehr, und ohne einen anderen Grund
   * lohnte sich der Weg zurueck in ein altes Gebiet nicht.
   */
  if (def.badgeId) bumpMetric(ctx, trainer.id, 'gymWins')
  else if (isEventTrainer(def.id)) bumpMetric(ctx, trainer.id, 'rocketWins')
  // Arenagegner tragen `kind: 'trainer'`, stehen aber auf keiner Route. Der
  // Durchlauf zaehlt als Ganzes, gemeldet aus dem Arena-Dienst.
  else if (def.kind === 'trainer' && !def.id.startsWith('arena-')) {
    bumpMetric(ctx, trainer.id, 'routeTrainerWins')
  }
  bumpMetric(ctx, trainer.id, 'badges')
  logEvent(ctx.db, trainer.id, 'battle.win', {
    opponentId: def.id, gold, firstWin, firstToday, badge: badge?.id ?? null,
  })
  const event = isEventTrainer(def.id) ? grantEventLoot(ctx, trainer, record.areaId) : null

  return {
    won: true, gold, energy: energyBack, event,
    xpPerMember, firstWin, firstToday, badge, levelUps, dialogue: empty.dialogue,
  }
}

/**
 * Was ein Ueberfall abwirft.
 *
 * Gold und ein Stapel Gegenstaende sind sicher; das makellose Pokemon ist der
 * seltene Wurf. Bewusst selten: waere es die Regel, waeren Zucht und Tausch
 * entwertet, und beides ist mehr wert als ein Zufallsfund.
 */
function grantEventLoot(ctx: AppContext, trainer: Trainer, areaId: string | null): EventLoot {
  const area = areaId ? ctx.registry.tryArea(areaId) : null
  const rng = createRng(deriveSeed(trainer.id, 'event', String(Date.now())))
  const level = area
    ? Math.max(...area.spawns.map((sp) => sp.maxLevel))
    : Math.max(...creatures.teamOf(ctx.db, trainer.id).map((c) => c.level), 10)

  const gold = eventGold(level, rng)
  inventory.earnGold(ctx.db, trainer.id, gold, von(ctx, 'battle.eventLoot'))

  const pool = ctx.registry.allItems.filter((i) =>
    ['ball', 'berry', 'medicine', 'material', 'xp'].includes(i.category))
  const items: EventLoot['items'] = []
  for (const item of pool.length > 0 ? [rng.pick(pool), rng.pick(pool)] : []) {
    const quantity = eventLoot(rng)
    inventory.grant(ctx.db, trainer.id, item.id, quantity, von(ctx, 'battle.eventLoot'))
    const existing = items.find((x) => x.itemId === item.id)
    if (existing) existing.quantity += quantity
    else items.push({
      itemId: item.id, quantity,
      name: ctx.registry.localized(item.name, trainer.locale),
      icon: item.icon,
    })
  }

  /*
   * Lockduefte: die Banden fuehren Koeder mit sich.
   *
   * Verschiedene Arten statt eines Stapels — ein Stapel verbilligt nur die
   * eine Suche, ein Faecher eroeffnet die Wahl.
   */
  for (const typeId of rollLureDrop(rng, ctx.registry.allItems
    .filter((i) => i.category === 'lure')
    .map((i) => String(i.params.lureType)))) {
    const lure = ctx.registry.tryItem(`lure-${typeId}`)
    if (!lure) continue
    inventory.grant(ctx.db, trainer.id, lure.id, 1, von(ctx, 'battle.eventLoot'))
    const existing = items.find((x) => x.itemId === lure.id)
    if (existing) existing.quantity += 1
    else items.push({
      itemId: lure.id, quantity: 1,
      name: ctx.registry.localized(lure.name, trainer.locale),
      icon: lure.icon,
    })
  }

  // Die Sagenbeere: der einzige Weg, an sie heranzukommen.
  if (rollBerryDrop(rng)) {
    inventory.grant(ctx.db, trainer.id, LEGENDARY_BERRY_ID, 1, von(ctx, 'battle.eventLoot'))
    const berry = ctx.registry.tryItem(LEGENDARY_BERRY_ID)
    items.push({
      itemId: LEGENDARY_BERRY_ID,
      quantity: 1,
      name: berry ? ctx.registry.localized(berry.name, trainer.locale) : LEGENDARY_BERRY_ID,
      icon: berry?.icon ?? '',
    })
  }

  let perfect: EventLoot['perfect'] = null
  if (rollPerfect(rng) && area && area.spawns.length > 0) {
    const spawn = rng.pick(area.spawns)
    const species = ctx.registry.species(spawn.speciesId)
    const ivs = { hp: PERFECT_IV, atk: PERFECT_IV, def: PERFECT_IV, spa: PERFECT_IV, spd: PERFECT_IV, spe: PERFECT_IV }
    const nature = rng.pick(NATURES)
    const stats = computeStats(species, spawn.maxLevel, ivs, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }, nature)
    const created = creatures.insertCreature(ctx.db, {
      ownerId: trainer.id, speciesId: species.id, level: spawn.maxLevel,
      xp: xpForLevel(species.growthRate, spawn.maxLevel),
      nature, ivs, friendship: 70, hpCurrent: stats.hp, shiny: rng.chance(2),
      moves: ctx.registry.learnableAt(species.id, spawn.maxLevel).slice(0, 4),
      caughtAreaId: area.id, teamSlot: null,
    }, von(ctx, 'battle.eventCreature'))
    dex.markCaught(ctx.db, trainer.id, species.id)
    perfect = {
      speciesId: species.id,
      name: ctx.registry.localized(species.name, trainer.locale),
      sprite: created.shiny ? species.spriteShiny : species.sprite,
      level: created.level,
    }
  }

  logEvent(ctx.db, trainer.id, 'event.loot', {
    gold, items: items.map((i) => i.itemId), perfect: perfect?.speciesId ?? null,
  })
  return { gold, items, perfect }
}

export function current(ctx: AppContext, trainer: Trainer): BattleView | null {
  const record = battles.activeOf(ctx.db, trainer.id)
  return record ? view(ctx, trainer, record, []) : null
}

export function forfeit(ctx: AppContext, trainer: Trainer): BattleView {
  return submit(ctx, trainer, { kind: 'forfeit' })
}

/** Restore the whole team to full health for a price. Without this, one bad
 *  gym attempt would lock a player out until potions were farmed. */
export const HEAL_COST_PER_LEVEL = 3

export function healTeam(ctx: AppContext, trainer: Trainer): { cost: number; healed: number } {
  return tx(ctx.db, () => {
    if (battles.activeOf(ctx.db, trainer.id)) {
      throw new GameError('invalid_state', { reason: 'battle_in_progress' }, 409)
    }
    const team = creatures.teamOf(ctx.db, trainer.id)
    const needing = team.filter((c) => {
      const species = ctx.registry.species(c.speciesId)
      const stats = computeStats(species, c.level, c.ivs, c.evs, c.nature)
      return c.hpCurrent < stats.hp
    })
    if (needing.length === 0) return { cost: 0, healed: 0 }

    const cost = needing.reduce((sum, c) => sum + c.level * HEAL_COST_PER_LEVEL, 0)
    inventory.spendGold(ctx.db, trainer.id, cost)
    for (const c of needing) {
      const species = ctx.registry.species(c.speciesId)
      const stats = computeStats(species, c.level, c.ivs, c.evs, c.nature)
      creatures.setHp(ctx.db, c.id, stats.hp)
    }
    logEvent(ctx.db, trainer.id, 'team.heal', { cost, count: needing.length })
    return { cost, healed: needing.length }
  })
}
