import type { Weather } from '@game/shared'
import type { MoveDef } from '@game/content'
import { createRng, deriveSeed, type Rng } from './rng.js'
import {
  accuracyCheck, applyStage, canApplyStatus, computeDamage, confusionDamage,
  effectiveStat, movesFirst, statusDamage, statusPreventsAction,
} from './battle-math.js'
import {
  MAX_TURNS, emptyStages,
  type BattleEvent, type BattleOutcome, type BattleState, type Fighter, type Lingering,
  type PlayerAction, type Side, type SideCondition, type Status,
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
  /*
   * Rueckenwind verdoppelt das Tempo der eigenen Seite.
   *
   * Umgesetzt als Kopie des Kaempfers mit doppelter Initiative statt als
   * Aenderung an ihm: die Reihenfolge ist eine Momentaufnahme, und ein
   * verdoppelter Wert, der im Zustand haengenbliebe, waere nach drei Runden
   * ein Fehler, den niemand mehr zuordnen kann.
   */
  const mitWind = (e: typeof entries[0]) => hatSchirm(state, e.side, 'tailwind')
    ? { ...e, fighter: { ...e.fighter, stats: { ...e.fighter.stats, spe: e.fighter.stats.spe * 2 } } }
    : e
  const aFirst = movesFirst(mitWind(a), mitWind(b), rng)
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

  /*
   * Aussetzer sperrt genau einen Zug, Zugabe erzwingt genau einen.
   *
   * Beide werden hier geprueft und nicht in der Zugwahl: die Zugwahl trifft
   * auch der Spieler, und der soll eine Ansage bekommen statt einer stumm
   * geaenderten Eingabe.
   */
  const gesperrt = (attacker.lingering ?? []).find((l) => l.kind === 'disable' && l.moveId === move.id)
  const zugabe = (attacker.lingering ?? []).find((l) => l.kind === 'encore' && l.moveId)
  if (gesperrt || (zugabe && zugabe.moveId !== move.id)) {
    slot.pp = Math.max(0, slot.pp - 1)
    attacker.turnsOnField = (attacker.turnsOnField ?? 0) + 1
    events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
    return
  }

  slot.pp--
  attacker.lastMoveId = move.id
  events.push({ type: 'move', side: sideIndex, fighter: attacker.id, moveId: move.id, moveName: move.id })

  if (!accuracyCheck(move, attacker, defender, rng)) {
    events.push({ type: 'miss', side: sideIndex, fighter: attacker.id })
    return
  }

  /*
   * Ein Schutzschild faengt alles ab, was auf den Traeger zielt.
   *
   * Geprueft nach dem Treffer und vor dem Schaden: der Zug ist verbraucht, der
   * PP weg, und der Angreifer erfaehrt es. Zuege auf sich selbst laufen
   * weiter — sonst koennte man sich nicht mehr heilen, waehrend man geschuetzt
   * ist.
   */
  const schuetzt = defender.protectedUntilTurn === state.turn
    || (defender.priorityGuardUntilTurn === state.turn && move.priority > 0)
  if (move.target === 'foe' && schuetzt) {
    events.push({ type: 'protected', side: sideIndex === 0 ? 1 : 0, fighter: defender.id })
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
    const roh = computeDamage(attacker, defender, move, effectiveness, state.weather, rng)
    /*
     * Reflektor gegen physische, Lichtschild gegen spezielle Angriffe.
     *
     * Nach der Formel und nicht in ihr: sie rechnet mit zwei Kaempfern und
     * kennt die Seiten nicht — und der Schirm liegt ueber der Seite, nicht
     * ueber dem, der gerade vorne steht.
     */
    const schirm = move.category === 'physical' ? 'reflect' : 'light_screen'
    const gegenseite = (sideIndex === 0 ? 1 : 0) as 0 | 1
    const gemildert = move.category !== 'status' && hatSchirm(state, gegenseite, schirm)
    const dmg = gemildert
      ? { ...roh, amount: Math.max(1, Math.floor(roh.amount / 2)) }
      : roh
    if (gemildert && roh.amount > 0) {
      events.push({ type: 'blocked', side: gegenseite, fighter: defender.id, by: schirm })
    }
    if (dmg.immune) {
      events.push({
        type: 'damage', side: sideIndex === 0 ? 1 : 0, fighter: defender.id,
        amount: 0, hpLeft: defender.hp, effectiveness: 0, critical: false,
      })
      return
    }
    if (dmg.amount > 0) {
      // Ausdauer laesst genau einen Kraftpunkt stehen — und nur, wenn vorher
      // ueberhaupt noch etwas da war.
      const haelt = defender.enduringUntilTurn === state.turn && defender.hp > 0
      const vorher = defender.hp
      defender.hp = haelt
        ? Math.max(1, defender.hp - dmg.amount)
        : Math.max(0, defender.hp - dmg.amount)
      totalDealt += vorher - defender.hp
      if (haelt && vorher - dmg.amount <= 0) {
        events.push({ type: 'endured', side: sideIndex === 0 ? 1 : 0, fighter: defender.id })
      }
      /*
       * Abgangsbund reisst den Angreifer mit — aber nur, wenn er selbst noch
       * steht. Sonst faellt jemand zweimal, und die Reihenfolge im Protokoll
       * ergaebe keinen Sinn mehr.
       */
      if (defender.hp <= 0 && defender.destinyBondUntilTurn === state.turn && attacker.hp > 0) {
        attacker.hp = 0
        events.push({ type: 'faint', side: sideIndex, fighter: attacker.id })
      }
      events.push({
        type: 'damage', side: sideIndex === 0 ? 1 : 0, fighter: defender.id,
        amount: vorher - defender.hp, hpLeft: defender.hp,
        effectiveness: dmg.effectiveness, critical: dmg.critical,
      })
    }
  }

  // Der sichere Volltreffer gilt fuer *einen* Angriff. Verbraucht wird er
  // hier und nicht in der Schadensformel: die soll rechnen, nicht aufraeumen.
  if (totalDealt > 0) attacker.sureCrit = false

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
      // Bodyguard haelt Zustaende von der ganzen Seite ab.
      if (hatSchirm(state, foeIndex, 'safeguard')) {
        events.push({ type: 'blocked', side: foeIndex, fighter: target.id, by: 'safeguard' })
        return
      }
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
      // Weissnebel schuetzt nur vor fremden *Senkungen* — eigene Zuwaechse
      // und eigene Abzuege bleiben die Entscheidung des Spielers.
      if (!onSelf && effect.stages < 0 && hatSchirm(state, foeIndex, 'mist')) {
        events.push({ type: 'blocked', side: foeIndex, fighter: target.id, by: 'mist' })
        return
      }
      const result = applyStage(target.stages, effect.stat, effect.stages)
      target.stages = result.stages
      events.push({
        type: 'stage', side: onSelf ? sideIndex : foeIndex, fighter: target.id,
        stat: effect.stat, delta: result.applied, capped: result.capped,
      })
      return
    }

    case 'protect': {
      // Nur fuer diese Runde. Ein Schild, das laenger haelt, waere kein Zug
      // mehr, sondern ein Zustand.
      if (effect.against === 'priority') {
        attacker.priorityGuardUntilTurn = state.turn
        events.push({ type: 'prepared', side: sideIndex, fighter: attacker.id, what: 'priority_guard' })
        return
      }
      attacker.protectedUntilTurn = state.turn
      events.push({ type: 'protected', side: sideIndex, fighter: attacker.id })
      return
    }

    case 'random_stat_up': {
      // Im Vorbild trifft es ein Teammitglied; im Einzelkampf ist das der
      // Traeger selbst.
      const waehlbar = ['atk', 'def', 'spa', 'spd', 'spe'] as const
      const stat = rng.pick(waehlbar)
      const ergebnis = applyStage(attacker.stages, stat, effect.stages)
      attacker.stages = ergebnis.stages
      events.push({
        type: 'stage', side: sideIndex, fighter: attacker.id,
        stat, delta: ergebnis.applied, capped: ergebnis.capped,
      })
      return
    }

    case 'destiny_bond': {
      attacker.destinyBondUntilTurn = state.turn
      events.push({ type: 'prepared', side: sideIndex, fighter: attacker.id, what: 'destiny_bond' })
      return
    }

    case 'lingering': {
      /*
       * Fluch ist zwei Zuege in einem: ein Geist zahlt die Haelfte seiner
       * Kraftpunkte und laesst das Ziel bluten, alle anderen tauschen Tempo
       * gegen Angriff und Verteidigung. Das steht so im Vorbild und ist der
       * einzige Zug, der sich nach dem Typ des Anwenders richtet.
       */
      if (effect.effect === 'curse' && !attacker.types.includes('ghost')) {
        for (const [stat, delta] of [['atk', 1], ['def', 1], ['spe', -1]] as const) {
          const r = applyStage(attacker.stages, stat, delta)
          attacker.stages = r.stages
          events.push({ type: 'stage', side: sideIndex, fighter: attacker.id, stat, delta: r.applied, capped: r.capped })
        }
        return
      }

      // Wer traegt ihn? Wasserring bleibt beim Anwender, alles andere geht
      // auf den Gegenueber.
      const traeger = effect.effect === 'aqua_ring' ? attacker : defender
      const seiteDesTraegers = (traeger === attacker ? sideIndex : foeIndex) as 0 | 1
      if (traeger.hp <= 0) return
      // Zweimal dasselbe waere kein zweiter Effekt, sondern ein verschenkter Zug.
      if ((traeger.lingering ?? []).some((l) => l.kind === effect.effect)) return
      // Nachtmahr braucht ein schlafendes Ziel; das steht schon als
      // `requiresTargetStatus` am Zug, hier nur die Sicherung.
      if (effect.effect === 'nightmare' && traeger.status !== 'sleep') return

      if (effect.effect === 'curse') {
        const preis = Math.max(1, Math.floor(attacker.hpMax / 2))
        attacker.hp = Math.max(1, attacker.hp - preis)
        events.push({ type: 'damage', side: sideIndex, fighter: attacker.id,
          amount: preis, hpLeft: attacker.hp, effectiveness: 1, critical: false })
      }

      traeger.lingering = [...(traeger.lingering ?? []), {
        kind: effect.effect,
        turns: effect.turns ?? null,
        ...(effect.effect === 'encore' || effect.effect === 'disable'
          ? { moveId: traeger.lastMoveId }
          : {}),
        ...(effect.effect === 'leech_seed' ? { from: sideIndex } : {}),
      }]
      events.push({ type: 'lingering', side: seiteDesTraegers, fighter: traeger.id, kind: effect.effect, started: true })
      return
    }

    case 'side_condition': {
      const seite = state.sides[sideIndex]!
      if ((seite.conditions ?? []).some((c) => c.kind === effect.condition)) return
      seite.conditions = [...(seite.conditions ?? []), { kind: effect.condition, turns: effect.turns }]
      events.push({ type: 'side_condition', side: sideIndex, kind: effect.condition, started: true })
      return
    }

    case 'endure': {
      attacker.enduringUntilTurn = state.turn
      events.push({ type: 'prepared', side: sideIndex, fighter: attacker.id, what: 'crit' })
      return
    }

    case 'rest': {
      /*
       * Voll heilen, dafuer zwei Runden schlafen.
       *
       * Der Schlaf ist der Preis und wird deshalb *gesetzt*, nicht angeboten:
       * `canApplyStatus` wuerde ihn ablehnen, wenn schon ein Leiden anliegt —
       * aber genau dann will man ihn.
       */
      if (attacker.hp >= attacker.hpMax && attacker.status === 'none') return
      const geheilt = attacker.hpMax - attacker.hp
      attacker.hp = attacker.hpMax
      attacker.status = 'sleep'
      attacker.statusCounter = 2
      events.push({ type: 'heal', side: sideIndex, fighter: attacker.id, amount: geheilt, hpLeft: attacker.hp })
      events.push({ type: 'status', side: sideIndex, fighter: attacker.id, status: 'sleep' })
      return
    }

    case 'cure': {
      const seite = state.sides[sideIndex]!
      const ziele = effect.scope === 'party'
        ? seite.party.filter((f) => f.hp > 0)
        : [attacker]
      for (const f of ziele) {
        if (f.status === 'none') continue
        const vorher = f.status
        f.status = 'none'
        f.statusCounter = 0
        events.push({ type: 'status_cured', side: sideIndex, fighter: f.id, status: vorher })
      }
      return
    }

    case 'crit_up': {
      if (effect.sure) {
        attacker.sureCrit = true
        events.push({ type: 'prepared', side: sideIndex, fighter: attacker.id, what: 'sure_crit' })
        return
      }
      attacker.critStage = Math.min(3, (attacker.critStage ?? 0) + effect.stages)
      events.push({ type: 'prepared', side: sideIndex, fighter: attacker.id, what: 'crit' })
      return
    }

    case 'haze': {
      // Beide Seiten, auch die eigene. Dunkelnebel ist ein Gleichmacher und
      // kein Angriff — wer ihn setzt, gibt seine eigenen Zuwaechse mit auf.
      for (const seite of state.sides) {
        for (const f of seite.party) f.stages = emptyStages()
      }
      events.push({ type: 'stages_cleared', side: sideIndex, fighter: attacker.id })
      return
    }

    case 'copy_stages': {
      attacker.stages = { ...defender.stages }
      events.push({ type: 'prepared', side: sideIndex, fighter: attacker.id, what: 'stats_copied' })
      return
    }

    case 'swap_stats': {
      const { atk, def } = attacker.stats
      attacker.stats = { ...attacker.stats, atk: def, def: atk }
      events.push({ type: 'prepared', side: sideIndex, fighter: attacker.id, what: 'stats_swapped' })
      return
    }

    case 'weather': {
      if (!triggers) return
      /*
       * Kein Ereignis, wenn sich nichts aendert.
       *
       * Sonst liest sich ein zweiter Regentanz wie ein Erfolg, obwohl er den
       * Zug verschenkt hat. Der Zug ist trotzdem verbraucht — das ist die
       * Entscheidung des Spielers, nicht ein Fehler des Spiels.
       */
      if (state.weather === effect.weather) return
      state.weather = effect.weather
      events.push({ type: 'weather', side: sideIndex, fighter: attacker.id, weather: effect.weather })
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

/** Liegt dieser Schirm ueber der Seite? */
const hatSchirm = (state: BattleState, side: 0 | 1, kind: SideCondition['kind']): boolean =>
  (state.sides[side]!.conditions ?? []).some((c) => c.kind === kind)

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
    tickLingering(state, sideIndex, fighter, events)
    fighter.flinched = false
  }
  tickSideConditions(state, events)
  void rng
}

/**
 * Was ueber Runden wirkt, wirkt hier.
 *
 * Nach dem Zustandsschaden und vor dem naechsten Zug: so trifft ein Egelsamen
 * denselben Kaempfer, der ihn diese Runde abbekommen hat, und ein Nachtmahr
 * endet in dem Moment, in dem das Ziel aufwacht.
 */
function tickLingering(
  state: BattleState, sideIndex: 0 | 1, fighter: Fighter, events: BattleEvent[],
): void {
  const bleibt: Lingering[] = []
  for (const l of fighter.lingering ?? []) {
    let weiter = true

    switch (l.kind) {
      case 'leech_seed': {
        const abzug = Math.max(1, Math.floor(fighter.hpMax / 8))
        const vorher = fighter.hp
        fighter.hp = Math.max(0, fighter.hp - abzug)
        events.push({ type: 'lingering_tick', side: sideIndex, fighter: fighter.id,
          kind: l.kind, amount: -(vorher - fighter.hp), hpLeft: fighter.hp })
        // Was abgezogen wird, kommt drueben an — das ist der ganze Zug.
        const nutzer = l.from !== undefined ? active(state.sides[l.from]!) : null
        if (nutzer && nutzer.hp > 0) {
          const zuwachs = Math.min(vorher - fighter.hp, nutzer.hpMax - nutzer.hp)
          if (zuwachs > 0) {
            nutzer.hp += zuwachs
            events.push({ type: 'heal', side: l.from!, fighter: nutzer.id, amount: zuwachs, hpLeft: nutzer.hp })
          }
        }
        break
      }
      case 'aqua_ring': {
        const zuwachs = Math.min(Math.max(1, Math.floor(fighter.hpMax / 16)), fighter.hpMax - fighter.hp)
        if (zuwachs > 0) {
          fighter.hp += zuwachs
          events.push({ type: 'lingering_tick', side: sideIndex, fighter: fighter.id,
            kind: l.kind, amount: zuwachs, hpLeft: fighter.hp })
        }
        break
      }
      case 'nightmare': {
        // Endet mit dem Aufwachen: ein Albtraum ohne Schlaf ist keiner.
        if (fighter.status !== 'sleep') { weiter = false; break }
        const abzug = Math.max(1, Math.floor(fighter.hpMax / 4))
        const vorher = fighter.hp
        fighter.hp = Math.max(0, fighter.hp - abzug)
        events.push({ type: 'lingering_tick', side: sideIndex, fighter: fighter.id,
          kind: l.kind, amount: -(vorher - fighter.hp), hpLeft: fighter.hp })
        break
      }
      case 'curse': {
        const abzug = Math.max(1, Math.floor(fighter.hpMax / 4))
        const vorher = fighter.hp
        fighter.hp = Math.max(0, fighter.hp - abzug)
        events.push({ type: 'lingering_tick', side: sideIndex, fighter: fighter.id,
          kind: l.kind, amount: -(vorher - fighter.hp), hpLeft: fighter.hp })
        break
      }
      case 'yawn': {
        // Erst am Ende der *naechsten* Runde: deshalb zaehlt er herunter und
        // schlaeft erst bei null ein.
        if (l.turns !== null && l.turns > 1) break
        if (fighter.status === 'none') {
          fighter.status = 'sleep'
          fighter.statusCounter = 2
          events.push({ type: 'status', side: sideIndex, fighter: fighter.id, status: 'sleep' })
        }
        weiter = false
        break
      }
      case 'encore':
      case 'disable':
        break
    }

    if (!weiter) {
      events.push({ type: 'lingering', side: sideIndex, fighter: fighter.id, kind: l.kind, started: false })
      continue
    }
    if (l.turns === null) { bleibt.push(l); continue }
    const rest = l.turns - 1
    if (rest <= 0) {
      events.push({ type: 'lingering', side: sideIndex, fighter: fighter.id, kind: l.kind, started: false })
      continue
    }
    bleibt.push({ ...l, turns: rest })
  }
  fighter.lingering = bleibt
}

/** Die Schirme laufen ab. */
function tickSideConditions(state: BattleState, events: BattleEvent[]): void {
  for (const sideIndex of [0, 1] as const) {
    const seite = state.sides[sideIndex]!
    if (!seite.conditions?.length) continue
    const bleibt = []
    for (const c of seite.conditions) {
      const rest = c.turns - 1
      if (rest <= 0) {
        events.push({ type: 'side_condition', side: sideIndex, kind: c.kind, started: false })
        continue
      }
      bleibt.push({ ...c, turns: rest })
    }
    seite.conditions = bleibt
  }
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
