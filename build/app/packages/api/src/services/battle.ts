import { GameError, NATURES, type Trainer } from '@game/shared'
import type { AreaDef, TrainerDef } from '@game/content'
import {
  activeFighter, battleXpYield, chooseAction, computeStats, createBattle, createRng,
  deriveSeed, ENERGY_REWARDS, eventGold, eventLevels, eventLoot, grantXpTo, isEventTrainer, makeSide,
  rollLureDrop,
  LEGENDARY_BERRY_ID, npcFighter, PERFECT_IV, resolveTurn, rollBerryDrop, rollPerfect,
  toFighter, xpForLevel,
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
import { worldClock } from '../worldClock.js'
import { refreshMoves } from './garden.js'
import { awardSeasonPoints, bumpMetric } from './progression.js'
import * as energy from './energy.js'
import { referenceOf, scaledLevel, trainerOffset } from './scaling.js'
import { gateFor } from './league.js'
import { capOf } from './travel.js'
import { contributeToGoal } from './guilds.js'

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
  }
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
    lastEvents,
    reward,
  }
}

/* ------------------------------------------------------------------ Starten */

export function opponentsIn(ctx: AppContext, trainer: Trainer, areaId: string) {
  const area = ctx.registry.area(areaId)
  const defeats = battles.defeatsOf(ctx.db, trainer.id)
  const badges = world.badgesOf(ctx.db, trainer.id)
  const reference = referenceOf(ctx, trainer)

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
    }
  }

  return {
    areaId,
    areaName: ctx.registry.localized(area.name, trainer.locale),
    trainers: area.trainerIds.map((id) => toEntry(id, false)),
    gym: area.gymId ? toEntry(area.gymId, true) : null,
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
    return beginBattle(ctx, trainer, def, area)
  })
}

export function start(ctx: AppContext, trainer: Trainer, opponentId: string): BattleView {
  return tx(ctx.db, () => {
    if (battles.activeOf(ctx.db, trainer.id)) {
      throw new GameError('invalid_state', { reason: 'battle_in_progress' }, 409)
    }

    const def = ctx.registry.allTrainers.find((t) => t.id === opponentId)
    if (!def) throw new GameError('not_found', { opponentId }, 404)

    const area = ctx.registry.allAreas.find(
      (a) => a.gymId === opponentId || a.trainerIds.includes(opponentId),
    )
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
function beginBattle(ctx: AppContext, trainer: Trainer, def: TrainerDef, area: AreaDef): BattleView {
  {
    if (battles.activeOf(ctx.db, trainer.id)) {
      throw new GameError('invalid_state', { reason: 'battle_in_progress' }, 409)
    }
    const busy = expeditions.busyCreatureIds(ctx.db, trainer.id)
    const team = creatures.teamOf(ctx.db, trainer.id).filter((c) => !busy.has(c.id))
    if (team.length === 0) throw new GameError('invalid_state', { reason: 'no_team' }, 409)
    const usable = team.filter((c) => c.hpCurrent > 0)
    if (usable.length === 0) throw new GameError('invalid_state', { reason: 'team_fainted' }, 409)

    // Nach allen Pruefungen: ein Kampf, der gar nicht erst zustande kommt,
    // kostet nichts.
    energy.spendFor(ctx, trainer.id, 'battle')

    const ppOf = (id: string) => ctx.registry.tryMove(id)?.pp ?? 10
    const playerParty = usable.map((c) => {
      const species = ctx.registry.species(c.speciesId)
      return toFighter(c, species, ctx.registry.localized(species.name, trainer.locale), ppOf)
    })

    // Der Gegner steigt mit, wenn das eigene Team ueber seinem Band liegt.
    // Die Attacken bleiben die des Entwurfs: ein Kaefersammler soll auch auf
    // Level 80 ein Kaefersammler sein und keine Arenaleiter-Attacken kennen.
    const offset = trainerOffset(ctx, trainer, area)

    /*
     * Ueberfaelle treten auf Augenhoehe an: eigener Teammedian ±3.
     *
     * Anders als ein Arenaleiter hat ein Ueberfall keinen Ort im Entwurf — er
     * passiert dort, wo man gerade erkundet, und quer durch alle Regionen.
     * Feste Level waeren deshalb immer fuer jemanden falsch. Das haengt an der
     * Skalierung: wer sie abschaltet, will die Entwurfswerte, auch hier.
     */
    const reference = referenceOf(ctx, trainer)
    const eventLevelsOf = isEventTrainer(def.id) && reference > 0
      ? eventLevels(def.team.length, reference)
      : null
    const cap = capOf(ctx, trainer)

    const foeParty = def.team.map((member, index) => {
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
      seed,
      state,
    })
    logEvent(ctx.db, trainer.id, 'battle.start', { opponentId: def.id, kind: state.kind })
    return view(ctx, trainer, record, [])
  }
}

/* -------------------------------------------------------------------- Zug */

export function submit(ctx: AppContext, trainer: Trainer, action: PlayerAction): BattleView {
  return tx(ctx.db, () => {
    const record = battles.activeOf(ctx.db, trainer.id)
    if (!record) throw new GameError('invalid_state', { reason: 'no_battle' }, 409)

    const content = battleContent(ctx)
    const def = record.opponentId
      ? ctx.registry.allTrainers.find((t) => t.id === record.opponentId)
      : undefined
    const ai = def ? AI_BY_KIND[def.kind] : 'basic'

    validateAction(record.state, action)

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
  const empty: BattleReward = {
    won, gold: 0, energy: 0, event: null, xpPerMember: 0, firstWin: false, badge: null, levelUps: [],
    dialogue: def
      ? ctx.registry.localized(won ? def.dialogue.lose : def.dialogue.win, trainer.locale)
      : '',
  }
  if (!def || !won) {
    if (!battles.markRewarded(ctx.db, record.id)) return empty
    logEvent(ctx.db, trainer.id, 'battle.end', { opponentId: def?.id, won })
    return empty
  }

  // markRewarded is the guard against paying twice for one victory.
  if (!battles.markRewarded(ctx.db, record.id)) return empty

  const firstWin = battles.recordWin(ctx.db, trainer.id, def.id)
  const gold = Math.round(def.rewardGold * (firstWin ? 1 : def.repeatRewardRatio))
  inventory.earnGold(ctx.db, trainer.id, gold)

  // Ein Sieg gibt Energie zurueck, ein erster Orden deutlich mehr: die beiden
  // Quellen, die das Kampfsystem selbsttragend machen.
  let energyBack = ENERGY_REWARDS.battleWon
  energy.reward(ctx, trainer.id, 'battleWon')

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
    const amount = battleXpYield(baseYield, foeLevel, stored.level) * (firstWin ? 1 : 0.5)
    xpPerMember = Math.round(amount)
    const gained = grantXpTo(species.growthRate, stored.xp, stored.level, amount, cap)
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

  awardSeasonPoints(ctx, trainer.id, def.badgeId ? 'gymWin' : 'battleWin')
  contributeToGoal(ctx, trainer.id, 'battles', 1)
  bumpMetric(ctx, trainer.id, 'badges')
  logEvent(ctx.db, trainer.id, 'battle.win', { opponentId: def.id, gold, firstWin, badge: badge?.id ?? null })
  const event = isEventTrainer(def.id) ? grantEventLoot(ctx, trainer, record.areaId) : null

  return {
    won: true, gold, energy: energyBack, event,
    xpPerMember, firstWin, badge, levelUps, dialogue: empty.dialogue,
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
  inventory.earnGold(ctx.db, trainer.id, gold)

  const pool = ctx.registry.allItems.filter((i) =>
    ['ball', 'berry', 'medicine', 'material', 'xp'].includes(i.category))
  const items: EventLoot['items'] = []
  for (const item of pool.length > 0 ? [rng.pick(pool), rng.pick(pool)] : []) {
    const quantity = eventLoot(rng)
    inventory.grant(ctx.db, trainer.id, item.id, quantity)
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
    inventory.grant(ctx.db, trainer.id, lure.id, 1)
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
    inventory.grant(ctx.db, trainer.id, LEGENDARY_BERRY_ID, 1)
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
    })
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
