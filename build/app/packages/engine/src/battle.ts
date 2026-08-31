import type { Weather } from '@game/shared'
import type { MoveDef } from '@game/content'
import { createRng, deriveSeed, type Rng } from './rng.js'
import {
  accuracyCheck, applyStage, canApplyStatus, computeDamage, confusionDamage,
  effectiveStat, movesFirst, statusDamage, statusPreventsAction,
} from './battle-math.js'
import {
  MAX_TURNS, emptyStages,
  type BattleEvent, type BattleOutcome, type BattleState, type Fighter,
  type PlayerAction, type Side, type Status,
} from './battle-types.js'
import { clamp } from './stats.js'

/** Everything the battle loop needs from the content pack, passed in so the
 *  engine stays free of any content dependency at runtime. */
/**
 * Was ein Gegenstand im Kampf bewirkt.
 *
 * Die Engine kennt kein Content-Pack: der Aufrufer löst die Kennung auf und
 * reicht die Wirkung herein — genau wie bei Attacken.
 */
export interface BattleItemEffect {
  /** Feste Kraftpunkte. */
  heal?: number
  /** Ganz voll. */
  healFull?: boolean
  /** Alle Statusprobleme weg. */
  cureAll?: boolean
  /** Anteil der Maximal-KP, mit dem ein besiegtes Pokémon zurückkommt. */
  revive?: number
}

export interface BattleContent {
  move: (id: string) => MoveDef
  /** Wirkung eines Gegenstands; null heißt: im Kampf nutzlos. */
  item?: (id: string) => BattleItemEffect | null
  effectiveness: (attackingType: string, defenderTypes: readonly string[]) => number
}

export interface TurnResult {
  state: BattleState
  events: BattleEvent[]
}

const active = (side: Side): Fighter => side.party[side.activeIndex]!
const alive = (side: Side): Fighter[] => side.party.filter((f) => f.hp > 0)

export function createBattle(
  id: string,
  kind: BattleState['kind'],
  seed: string,
  playerSide: Side,
  foeSide: Side,
  weather: Weather,
): BattleState {
  return { id, kind, seed, turn: 0, sides: [playerSide, foeSide], weather, outcome: null }
}

/**
 * Resolve one turn.
 *
 * Both sides commit an action first, then the turn plays out — neither side can
 * react to the other's choice. That is what keeps an asynchronous PvP duel fair
 * even though the two players are never online at the same moment.
 *
 * The state is treated as immutable: a copy is made, mutated, and returned. It
 * makes the "compute, then persist" boundary explicit and lets a caller replay
 * a turn without corrupting the version it already stored.
 */
export function resolveTurn(
  state: BattleState,
  playerAction: PlayerAction,
  foeAction: PlayerAction,
  content: BattleContent,
): TurnResult {
  if (state.outcome) return { state, events: [] }

  const next = structuredClone(state) as BattleState
  const events: BattleEvent[] = []
  next.turn++
  const rng = createRng(deriveSeed(state.seed, 'turn', next.turn))

  if (playerAction.kind === 'forfeit') {
    return finish(next, events, { winner: 1, reason: 'forfeit' })
  }
  if (foeAction.kind === 'forfeit') {
    return finish(next, events, { winner: 0, reason: 'forfeit' })
  }

  /*
   * Gegenstände und Wechsel gehen jedem Angriff voraus.
   *
   * Beides kostet den Zug: wer heilt, greift in dieser Runde nicht an. Sonst
   * wäre ein Trank ein Gratiszug, und jeder Kampf endete in einer Heilschleife.
   */
  for (const [index, action] of ([[0, playerAction], [1, foeAction]] as const)) {
    if (action.kind === 'item') useItem(next, index, action, content, events)
    if (action.kind === 'switch') doSwitch(next, index, action.partyIndex, events)
  }

  const orders = buildOrder(next, playerAction, foeAction, content, rng)
  for (const entry of orders) {
    if (next.outcome) break
    const side = next.sides[entry.side]!
    const attacker = active(side)
    if (attacker.hp <= 0) continue
    /*
     * Wer besiegt wird, verliert seinen Zug.
     *
     * Vorher fuehrte der Nachrueckende den Zug des Gefallenen aus: das
     * Pokemon ging zu Boden und schlug im selben Moment noch zu. Ein
     * geschenkter Angriff, und fuer die Gegenseite genauso.
     */
    if (attacker.id !== entry.fighterId) continue
    performMove(next, entry.side, entry.moveIndex, content, rng, events)
    checkFaints(next, events)
  }

  if (!next.outcome) endOfTurn(next, rng, events)
  if (!next.outcome) checkFaints(next, events)

  if (!next.outcome && next.turn >= MAX_TURNS) {
    return finish(next, events, { winner: null, reason: 'turn_limit' })
  }
  return { state: next, events }
}

/**
 * Einen Gegenstand einsetzen.
 *
 * Ziel ist ein Mitglied der eigenen Mannschaft, auch ein besiegtes — dafür gibt
 * es Beleber. Was nicht passt, passiert einfach nicht: ein Trank auf einem
 * besiegten Pokémon oder ein Beleber auf einem gesunden verpufft, statt einen
 * Fehler zu werfen. Die Prüfung, ob der Gegenstand überhaupt sinnvoll ist,
 * gehört an die Oberfläche, nicht in die Kampfrunde.
 */
function useItem(
  state: BattleState,
  side: 0 | 1,
  action: { itemId: string; targetIndex: number },
  content: BattleContent,
  events: BattleEvent[],
): void {
  const party = state.sides[side]!.party
  const target = party[action.targetIndex]
  const effect = content.item?.(action.itemId) ?? null
  if (!target || !effect) return

  const before = target.hp
  if (target.hp <= 0) {
    if (!effect.revive) return
    target.hp = Math.max(1, Math.round(target.hpMax * effect.revive))
    target.status = 'none'
  } else {
    if (effect.healFull) target.hp = target.hpMax
    else if (effect.heal) target.hp = Math.min(target.hpMax, target.hp + effect.heal)
    if (effect.cureAll) {
      target.status = 'none'
      target.confused = false
      target.confusionTurns = 0
    }
  }

  events.push({
    type: 'item',
    side,
    itemId: action.itemId,
    fighter: target.name,
    healed: target.hp - before,
  })
}

interface OrderEntry {
  side: 0 | 1
  moveIndex: number
  /** Wer den Zug angesagt hat — nur der fuehrt ihn auch aus. */
  fighterId: string
}

function buildOrder(
  state: BattleState,
  playerAction: PlayerAction,
  foeAction: PlayerAction,
  content: BattleContent,
  rng: Rng,
): OrderEntry[] {
  const entries: Array<OrderEntry & { move: MoveDef | null; fighter: Fighter }> = []
  for (const [side, action] of ([[0, playerAction], [1, foeAction]] as const)) {
    if (action.kind !== 'move') continue
    const fighter = active(state.sides[side]!)
    const slot = fighter.moves[action.moveIndex]
    const move = slot ? safeMove(content, slot.id) : null
    entries.push({ side, moveIndex: action.moveIndex, move, fighter, fighterId: fighter.id })
  }
  if (entries.length < 2) {
    return entries.map(({ side, moveIndex, fighter }) => ({ side, moveIndex, fighterId: fighter.id }))
  }

  const [a, b] = entries as [typeof entries[0], typeof entries[0]]
  const aFirst = movesFirst(a, b, rng)
  return (aFirst ? [a, b] : [b, a])
    .map(({ side, moveIndex, fighter }) => ({ side, moveIndex, fighterId: fighter.id }))
}

/** A move id the pack does not know must not crash a battle in progress. */
function safeMove(content: BattleContent, id: string): MoveDef | null {
  try { return content.move(id) } catch { return null }
}

function doSwitch(state: BattleState, sideIndex: 0 | 1, partyIndex: number, events: BattleEvent[]): void {
  const side = state.sides[sideIndex]!
  const target = side.party[partyIndex]
  if (!target || target.hp <= 0 || partyIndex === side.activeIndex) return

  // Stat stages and confusion are properties of being on the field, not of the
  // creature, so they reset. Status does not — that is the point of status.
  const leaving = active(side)
  leaving.stages = emptyStages()
  leaving.confused = false
  leaving.confusionTurns = 0
  leaving.flinched = false

  side.activeIndex = partyIndex
  // Frisch im Feld: seine erste eigene Handlung steht noch aus.
  target.turnsOnField = 0
  events.push({ type: 'switch', side: sideIndex, fighter: target.id, name: target.name })
}

function performMove(
  state: BattleState,
  sideIndex: 0 | 1,
  moveIndex: number,
  content: BattleContent,
  rng: Rng,
  events: BattleEvent[],
): void {
  const side = state.sides[sideIndex]!
  const foeSide = state.sides[sideIndex === 0 ? 1 : 0]!
  const attacker = active(side)
  const defender = active(foeSide)

  if (attacker.flinched) {
    attacker.flinched = false
    events.push({ type: 'flinch', side: sideIndex, fighter: attacker.id })
    return
  }

  const blockage = statusPreventsAction(attacker, rng)
  if (blockage.cured) {
    events.push({ type: 'status_cured', side: sideIndex, fighter: attacker.id, status: attacker.status })
    attacker.status = 'none'
    attacker.statusCounter = 0
  } else if (blockage.blocked) {
    if (attacker.status === 'sleep') attacker.statusCounter--
    events.push({ type: 'status_blocked', side: sideIndex, fighter: attacker.id, status: attacker.status })
    return
  }

  if (attacker.confused) {
    attacker.confusionTurns--
    if (attacker.confusionTurns <= 0) {
      attacker.confused = false
      events.push({ type: 'status_cured', side: sideIndex, fighter: attacker.id, status: 'none' })
    } else if (rng.chance(33)) {
      const self = confusionDamage(attacker)
      attacker.hp = Math.max(0, attacker.hp - self)
      events.push({ type: 'confusion_hit', side: sideIndex, fighter: attacker.id, amount: self, hpLeft: attacker.hp })
      return
    }
  }

  const slot = attacker.moves[moveIndex]
  if (!slot || slot.pp <= 0) {
    events.push({ type: 'no_pp', side: sideIndex, fighter: attacker.id })
    return
  }
  const move = safeMove(content, slot.id)
  if (!move) {
    events.push({ type: 'no_pp', side: sideIndex, fighter: attacker.id })
    return
  }

  /*
   * Mogelhieb und Verwandte gehen nur direkt nach dem Einwechseln.
   *
   * Ohne diese Schranke setzt ein Mauzi ihn jede Runde ein — Vorrang 3 und
   * 100 % Zurueckschrecken heisst: der Gegenueber kommt nie zum Zug. Der PP
   * wird trotzdem verbraucht, sonst waere der Fehlversuch gratis.
   */
  if (move.firstTurnOnly && (attacker.turnsOnField ?? 0) > 0) {
    slot.pp = Math.max(0, slot.pp - 1)
    attacker.turnsOnField = (attacker.turnsOnField ?? 0) + 1
    events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
    return
  }

  /*
   * Manche Attacken wirken nur gegen einen bestimmten Zustand.
   *
   * Traumfresser ohne schlafendes Ziel ist der Fall, der gemeldet wurde: er
   * traf und saugte, obwohl niemand schlief. Der PP geht wie oben trotzdem
   * weg — ein Fehlversuch, der nichts kostet, waere keiner.
   */
  if (move.requiresTargetStatus && defender.status !== move.requiresTargetStatus) {
    slot.pp = Math.max(0, slot.pp - 1)
    attacker.turnsOnField = (attacker.turnsOnField ?? 0) + 1
    events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
    return
  }

  /*
   * Gezaehlt wird die eigene Handlung, nicht die Runde.
   *
   * Sonst haengt "erste Runde" davon ab, wann jemand hereinkam: wer nach einem
   * besiegten Vorgaenger nachrueckt, betritt das Feld mitten in der Runde und
   * haette seinen ersten Zug schon verbraucht, bevor er ihn hatte.
   */
  attacker.turnsOnField = (attacker.turnsOnField ?? 0) + 1

  slot.pp--
  events.push({ type: 'move', side: sideIndex, fighter: attacker.id, moveId: move.id, moveName: move.id })

  if (!accuracyCheck(move, attacker, defender, rng)) {
    events.push({ type: 'miss', side: sideIndex, fighter: attacker.id })
    return
  }

  const effectiveness = move.category === 'status'
    ? 1
    : content.effectiveness(move.type, defender.types)

  const hits = move.effect.kind === 'multi_hit' ? rng.int(move.effect.min, move.effect.max) : 1
  if (hits > 1) events.push({ type: 'multi_hit', side: sideIndex, fighter: attacker.id, hits })

  let totalDealt = 0
  for (let i = 0; i < hits; i++) {
    if (defender.hp <= 0) break
    const dmg = computeDamage(attacker, defender, move, effectiveness, state.weather, rng)
    if (dmg.immune) {
      events.push({
        type: 'damage', side: sideIndex === 0 ? 1 : 0, fighter: defender.id,
        amount: 0, hpLeft: defender.hp, effectiveness: 0, critical: false,
      })
      return
    }
    if (dmg.amount > 0) {
      defender.hp = Math.max(0, defender.hp - dmg.amount)
      totalDealt += dmg.amount
      events.push({
        type: 'damage', side: sideIndex === 0 ? 1 : 0, fighter: defender.id,
        amount: dmg.amount, hpLeft: defender.hp,
        effectiveness: dmg.effectiveness, critical: dmg.critical,
      })
    }
  }

  applyMoveEffect(state, sideIndex, move, attacker, defender, totalDealt, rng, events)
}

function applyMoveEffect(
  state: BattleState,
  sideIndex: 0 | 1,
  move: MoveDef,
  attacker: Fighter,
  defender: Fighter,
  damageDealt: number,
  rng: Rng,
  events: BattleEvent[],
): void {
  const foeIndex = (sideIndex === 0 ? 1 : 0) as 0 | 1
  const effect = move.effect
  const triggers = move.effectChance <= 0 ? effect.kind !== 'none' : rng.chance(move.effectChance)

  switch (effect.kind) {
    case 'none':
      return

    case 'status': {
      if (!triggers) return
      const status = effect.status
      if (status === 'confusion') {
        if (defender.confused || defender.hp <= 0) return
        defender.confused = true
        defender.confusionTurns = rng.int(2, 5)
        events.push({ type: 'confused', side: foeIndex, fighter: defender.id })
        return
      }
      const target = defender
      if (target.hp <= 0) return
      const check = canApplyStatus(target, status as Status)
      if (!check.applied) return
      target.status = status as Status
      target.statusCounter = status === 'sleep' ? rng.int(2, 4) : 1
      events.push({ type: 'status', side: foeIndex, fighter: target.id, status: target.status })
      return
    }

    case 'stat_stage': {
      if (!triggers) return
      const onSelf = effect.target === 'self'
      const target = onSelf ? attacker : defender
      if (target.hp <= 0) return
      const result = applyStage(target.stages, effect.stat, effect.stages)
      target.stages = result.stages
      events.push({
        type: 'stage', side: onSelf ? sideIndex : foeIndex, fighter: target.id,
        stat: effect.stat, delta: result.applied, capped: result.capped,
      })
      return
    }

    case 'drain': {
      if (damageDealt <= 0) return
      const healed = Math.max(1, Math.floor(damageDealt * effect.ratio))
      attacker.hp = clamp(attacker.hp + healed, 0, attacker.hpMax)
      events.push({ type: 'heal', side: sideIndex, fighter: attacker.id, amount: healed, hpLeft: attacker.hp })
      return
    }

    case 'recoil': {
      if (damageDealt <= 0) return
      const hurt = Math.max(1, Math.floor(damageDealt * effect.ratio))
      attacker.hp = Math.max(0, attacker.hp - hurt)
      events.push({
        type: 'damage', side: sideIndex, fighter: attacker.id,
        amount: hurt, hpLeft: attacker.hp, effectiveness: 1, critical: false,
      })
      return
    }

    case 'heal': {
      const healed = Math.max(1, Math.floor(attacker.hpMax * effect.ratio))
      const before = attacker.hp
      attacker.hp = clamp(attacker.hp + healed, 0, attacker.hpMax)
      events.push({ type: 'heal', side: sideIndex, fighter: attacker.id, amount: attacker.hp - before, hpLeft: attacker.hp })
      return
    }

    case 'flinch': {
      if (!triggers || defender.hp <= 0) return
      defender.flinched = true
      return
    }

    case 'multi_hit':
      return
  }
}

function endOfTurn(state: BattleState, rng: Rng, events: BattleEvent[]): void {
  for (const sideIndex of [0, 1] as const) {
    const fighter = active(state.sides[sideIndex]!)
    if (fighter.hp <= 0) continue

    if (fighter.status === 'toxic') fighter.statusCounter++
    const damage = statusDamage(fighter)
    if (damage > 0) {
      fighter.hp = Math.max(0, fighter.hp - damage)
      events.push({
        type: 'status_damage', side: sideIndex, fighter: fighter.id,
        status: fighter.status, amount: damage, hpLeft: fighter.hp,
      })
    }
    fighter.flinched = false
  }
  void rng
}

function checkFaints(state: BattleState, events: BattleEvent[]): void {
  for (const sideIndex of [0, 1] as const) {
    const side = state.sides[sideIndex]!
    const fighter = active(side)
    if (fighter.hp > 0) continue

    events.push({ type: 'faint', side: sideIndex, fighter: fighter.id })

    const replacement = side.party.findIndex((f) => f.hp > 0)
    if (replacement === -1) {
      const winner = (sideIndex === 0 ? 1 : 0) as 0 | 1
      state.outcome = { winner, reason: 'knockout' }
      events.push({ type: 'end', outcome: state.outcome })
      return
    }
    // Auto-send the next available party member. Letting the player choose
    // would need a second round trip mid-turn; the switch is free either way,
    // and they can change on their next action.
    side.activeIndex = replacement
    const incoming = side.party[replacement]!
    incoming.stages = emptyStages()
    // Auch der Nachrueckende faengt seine Zaehlung von vorn an.
    incoming.turnsOnField = 0
    events.push({ type: 'switch', side: sideIndex, fighter: incoming.id, name: incoming.name })
  }
}

function finish(state: BattleState, events: BattleEvent[], outcome: BattleOutcome): TurnResult {
  state.outcome = outcome
  events.push({ type: 'end', outcome })
  return { state, events }
}

export { active as activeFighter, alive as aliveFighters, effectiveStat }
