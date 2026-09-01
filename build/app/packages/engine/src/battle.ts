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
  type FieldEffectKind, type PlayerAction, type Side, type SideCondition, type Status,
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
  /*
   * Zwei Nachschlagewerke, die nur zwei Zuege brauchen.
   *
   * Metronom wuerfelt aus allen Attacken, Umwandlung2 sucht einen Typ, der
   * gegen den letzten Treffer haelt. Beide wahlfrei: fehlt das Verzeichnis,
   * scheitert der Zug sichtbar, statt den Kampf mitzureissen — und jeder
   * bestehende Aufrufer bleibt gueltig.
   */
  moveIds?: () => readonly string[]
  types?: () => readonly string[]
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
    if (action.kind === 'switch') doSwitch(next, index, action.partyIndex, events, content)
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
    checkFaints(next, events, content)
  }

  if (!next.outcome) endOfTurn(next, rng, events)
  if (!next.outcome) checkFaints(next, events, content)

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

function doSwitch(
  state: BattleState, sideIndex: 0 | 1, partyIndex: number, events: BattleEvent[],
  content: BattleContent, erzwungen = false,
): void {
  const side = state.sides[sideIndex]!
  const target = side.party[partyIndex]
  if (!target || target.hp <= 0 || partyIndex === side.activeIndex) return

  /*
   * Wer festgehalten wird, geht nicht.
   *
   * Nur der freiwillige Rueckzug ist gemeint: ein Wirbelwind draengt auch
   * einen Gefesselten hinaus, und der Nachrueckende nach einem Abgang hat
   * ohnehin keine Wahl. Sonst waere Horrorblick eine Sperre gegen das Spiel
   * statt gegen den Gegner.
   */
  if (!erzwungen && (hatEffekt(active(side), 'trapped') || hatEffekt(active(side), 'ingrain'))) {
    events.push({ type: 'trapped', side: sideIndex, fighter: active(side).id })
    return
  }

  // Stat stages and confusion are properties of being on the field, not of the
  // creature, so they reset. Status does not — that is the point of status.
  const leaving = active(side)
  leaving.stages = emptyStages()
  leaving.confused = false
  leaving.confusionTurns = 0
  leaving.flinched = false
  /*
   * Auch was ueber Runden hing, bleibt auf dem Feld zurueck.
   *
   * Egelsamen, Zugabe, Magnetflug: alles davon beschreibt eine Lage im Kampf,
   * nicht einen Schaden am Pokemon — anders als der Zustand, der genau darum
   * bleibt. Wer sich zurueckzieht, schuettelt es ab; das ist der Grund, warum
   * man sich zurueckzieht.
   */
  leaving.lingering = []
  // Die Puppe steht auf dem Feld, nicht am Pokemon — sie bleibt zurueck.
  leaving.substitute = undefined

  side.activeIndex = partyIndex
  // Frisch im Feld: seine erste eigene Handlung steht noch aus.
  target.turnsOnField = 0
  events.push({ type: 'switch', side: sideIndex, fighter: target.id, name: target.name })
  betreteFeld(state, sideIndex, target, events, content)
}

/**
 * Was den empfaengt, der neu hereinkommt.
 *
 * Fallen liegen auf der Seite, die sie abbekommen hat, und warten. Beide
 * Wege ins Feld — freiwilliger Wechsel und Nachruecken nach einem Abgang —
 * fuehren hier durch, sonst waere eine Falle davon abhaengig, *wie* jemand
 * hereinkommt.
 */
function betreteFeld(
  state: BattleState, sideIndex: 0 | 1, ankommend: Fighter,
  events: BattleEvent[], content: BattleContent,
): void {
  const seite = state.sides[sideIndex]!

  // Ein Heilopfer wartet: der Naechste kommt frisch herein, einmalig.
  if (seite.healingWish) {
    seite.healingWish = false
    ankommend.hp = ankommend.hpMax
    ankommend.status = 'none'
    ankommend.statusCounter = 0
    events.push({ type: 'heal', side: sideIndex, fighter: ankommend.id, amount: ankommend.hpMax, hpLeft: ankommend.hp })
  }

  // Wer fliegt, tritt nicht hinein. Tarnsteine treffen trotzdem — sie
  // schweben, und genau darin liegt ihr Sinn.
  const amBoden = !ankommend.types.includes('flying')

  for (const c of seite.conditions ?? []) {
    if (ankommend.hp <= 0) break
    const lagen = c.layers ?? 1

    if (c.kind === 'stealth_rock') {
      const anteil = content.effectiveness('rock', ankommend.types)
      const abzug = Math.max(1, Math.floor((ankommend.hpMax / 8) * anteil))
      ankommend.hp = Math.max(0, ankommend.hp - abzug)
      events.push({ type: 'hazard', side: sideIndex, fighter: ankommend.id, kind: c.kind })
      events.push({ type: 'damage', side: sideIndex, fighter: ankommend.id,
        amount: abzug, hpLeft: ankommend.hp, effectiveness: anteil, critical: false })
      continue
    }
    if (!amBoden) continue

    if (c.kind === 'spikes') {
      const abzug = Math.max(1, Math.floor(ankommend.hpMax / [8, 8, 6, 4][Math.min(lagen, 3)]!))
      ankommend.hp = Math.max(0, ankommend.hp - abzug)
      events.push({ type: 'hazard', side: sideIndex, fighter: ankommend.id, kind: c.kind })
      events.push({ type: 'damage', side: sideIndex, fighter: ankommend.id,
        amount: abzug, hpLeft: ankommend.hp, effectiveness: 1, critical: false })
    } else if (c.kind === 'toxic_spikes') {
      /*
       * Ein Giftpokemon raeumt sie beim Hereinkommen auf.
       *
       * Das steht so im Vorbild und ist die einzige Art, Giftspitzen wieder
       * loszuwerden — ohne sie waere die Falle eine Einbahnstrasse.
       */
      if (ankommend.types.includes('poison')) {
        seite.conditions = (seite.conditions ?? []).filter((x) => x !== c)
        events.push({ type: 'side_condition', side: sideIndex, kind: c.kind, started: false })
        continue
      }
      const gift = canApplyStatus(ankommend, lagen >= 2 ? 'toxic' : 'poison')
      if (!gift.applied) continue
      ankommend.status = lagen >= 2 ? 'toxic' : 'poison'
      ankommend.statusCounter = 1
      events.push({ type: 'hazard', side: sideIndex, fighter: ankommend.id, kind: c.kind })
      events.push({ type: 'status', side: sideIndex, fighter: ankommend.id, status: ankommend.status })
    } else if (c.kind === 'sticky_web') {
      const res = applyStage(ankommend.stages, 'spe', -1)
      ankommend.stages = res.stages
      events.push({ type: 'hazard', side: sideIndex, fighter: ankommend.id, kind: c.kind })
      events.push({ type: 'stage', side: sideIndex, fighter: ankommend.id,
        stat: 'spe', delta: res.applied, capped: res.capped })
    }
  }
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
  /*
   * Drei weitere Sperren, dieselbe Stelle, derselbe Ausgang.
   *
   * Verhoehner nimmt die Statuszuege, Folterknecht die Wiederholung,
   * Begrenzer alles, was der Anwender selbst kann. Alle drei kosten den PP:
   * ein Fehlversuch, der nichts kostet, waere keiner — und der Spieler
   * bekommt eine Ansage statt einer stumm geaenderten Eingabe.
   */
  const verhoehnt = move.category === 'status' && hatEffekt(attacker, 'taunt')
  const wiederholt = attacker.lastMoveId === move.id && hatEffekt(attacker, 'torment')
  const begrenzt = (attacker.lingering ?? [])
    .some((l) => l.kind === 'imprison' && (l.moveIds ?? []).includes(move.id))
  if (gesperrt || verhoehnt || wiederholt || begrenzt || (zugabe && zugabe.moveId !== move.id)) {
    slot.pp = Math.max(0, slot.pp - 1)
    attacker.turnsOnField = (attacker.turnsOnField ?? 0) + 1
    events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
    return
  }

  slot.pp--
  fuehreZugAus(state, sideIndex, move, content, rng, events, slot)
}

/**
 * Was ein Zug tut, nachdem feststeht, dass er ueberhaupt stattfindet.
 *
 * Herausgeloest aus `performMove`, damit ein kopierter Zug denselben Weg
 * nimmt: Egotrip, Spiegeltrick und Metronom sollen nicht *aehnlich* wirken
 * wie das Original, sondern gleich. Alles davor — Kraftpunkte, Sperren,
 * Zurueckschrecken, Verwirrung — gehoert zur Zugwahl und bleibt drueben.
 *
 * `slot` ist der Platz, aus dem der Zug kam; bei einem kopierten Zug gibt es
 * keinen, und dann kann ein Nachspiel ihn auch nicht leeren. `tiefe` bricht
 * die Kette: ein Metronom, das ein Metronom wuerfelt, waere sonst ein Kampf,
 * der nie endet.
 */
function fuehreZugAus(
  state: BattleState,
  sideIndex: 0 | 1,
  move: MoveDef,
  content: BattleContent,
  rng: Rng,
  events: BattleEvent[],
  slot: { id: string; pp: number; ppMax: number } | null,
  tiefe = 0,
): void {
  const side = state.sides[sideIndex]!
  const foeSide = state.sides[sideIndex === 0 ? 1 : 0]!
  const attacker = active(side)
  const defender = active(foeSide)

  /*
   * Ein Plasmaschauer faerbt alles Normale elektrisch — fuer eine Runde.
   *
   * Umgesetzt als Kopie des Zuges und nicht als Sonderfall in jeder Rechnung:
   * Typenvorteil, Angriffsbonus, Wetter, Boden und Suhle fragen alle nach dem
   * Typ, und keiner von ihnen soll wissen muessen, dass es einen Schauer gibt.
   */
  if (move.type === 'normal' && hatFeld(state, 'ion_deluge')) {
    move = { ...move, type: 'electric' }
  }

  attacker.lastMoveId = move.id
  events.push({ type: 'move', side: sideIndex, fighter: attacker.id, moveId: move.id, moveName: move.id })

  /*
   * Zwei Wege an der Trefferwahrscheinlichkeit vorbei.
   *
   * `sure_hit` haengt am Angreifer und gilt fuer genau einen Zug — Zielschuss
   * und Willensleser versprechen den *naechsten* Treffer, also wird der Merker
   * hier verbraucht. `vulnerable` haengt am Ziel und gilt fuer alles, was auf
   * es einschlaegt, bis es ablaeuft: ein Scharfblick nuetzt der ganzen Seite,
   * nicht nur dem, der ihn eingesetzt hat.
   */
  const sichererTreffer = hatEffekt(attacker, 'sure_hit') || hatEffekt(defender, 'vulnerable')
    // Wer am Boden klebt, weicht nicht mehr aus.
    || hatFeld(state, 'gravity')
  if (hatEffekt(attacker, 'sure_hit')) {
    attacker.lingering = (attacker.lingering ?? []).filter((l) => l.kind !== 'sure_hit')
  }
  if (!sichererTreffer && !accuracyCheck(move, attacker, defender, rng)) {
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
  /*
   * Ein Magiemantel schickt den Statuszug zurueck.
   *
   * Dieselbe Wirkung, nur mit vertauschten Rollen: der Absender wird zum
   * Ziel. Deshalb ein zweiter Aufruf mit getauschten Seiten und nicht ein
   * Sonderweg — sonst muesste jede Wirkung zweimal geschrieben werden.
   */
  if (move.category === 'status' && move.target === 'foe'
    && defender.magicCoatUntilTurn === state.turn && tiefe === 0) {
    events.push({ type: 'reflected', side: sideIndex, fighter: attacker.id, moveId: move.id })
    applyMoveEffect(state, (sideIndex === 0 ? 1 : 0) as 0 | 1, move, defender, attacker, 0, content, rng, events, 1, null)
    return
  }

  const schuetzt = defender.protectedUntilTurn === state.turn
    || (defender.priorityGuardUntilTurn === state.turn && move.priority > 0)
  if (move.target === 'foe' && schuetzt) {
    events.push({ type: 'protected', side: sideIndex === 0 ? 1 : 0, fighter: defender.id })
    return
  }

  const gegenseite = (sideIndex === 0 ? 1 : 0) as 0 | 1

  /*
   * Magnetflug hebt vom Boden ab.
   *
   * Behandelt wie eine Typ-Immunitaet und nicht wie ein Fehlschlag: fuer den
   * Angreifer sieht beides gleich aus, der Zug ist so oder so verbraucht — und
   * "wirkungslos" ist die Ansage, die zur Sache passt.
   */
  if (move.category !== 'status' && move.type === 'ground' && hatEffekt(defender, 'magnet_rise')) {
    events.push({
      type: 'damage', side: gegenseite, fighter: defender.id,
      amount: 0, hpLeft: defender.hp, effectiveness: 0, critical: false,
    })
    return
  }

  /*
   * Erdanziehung holt herunter, was fliegt.
   *
   * Nur fuer Bodenzuege und nur fuer diese eine Rechnung: der Typ des Ziels
   * aendert sich nicht, es steht nur waehrenddessen auf dem Boden.
   */
  const amBoden = hatFeld(state, 'gravity') && move.type === 'ground'
    ? defender.types.filter((t) => t !== 'flying')
    : defender.types

  const effectiveness = move.category === 'status'
    ? 1
    : content.effectiveness(move.type, amBoden.length ? amBoden : ['normal'])

  const hits = move.effect.kind === 'multi_hit' ? rng.int(move.effect.min, move.effect.max) : 1
  if (hits > 1) events.push({ type: 'multi_hit', side: sideIndex, fighter: attacker.id, hits })

  let totalDealt = 0
  for (let i = 0; i < hits; i++) {
    if (defender.hp <= 0) break
    const roh = computeDamage(attacker, defender, move, effectiveness, state.weather, rng, {
      // Beschwoerung nimmt der Gegenseite die Volltreffer, das Feld faerbt den
      // Schaden. Beides gehoert zum Feld und nicht zu den beiden Kaempfern.
      noCrit: hatSchirm(state, gegenseite, 'lucky_chant'),
      terrain: state.terrain?.kind ?? null,
      swapDefenses: hatFeld(state, 'wonder_room'),
    })
    /*
     * Reflektor gegen physische, Lichtschild gegen spezielle Angriffe.
     *
     * Nach der Formel und nicht in ihr: sie rechnet mit zwei Kaempfern und
     * kennt die Seiten nicht — und der Schirm liegt ueber der Seite, nicht
     * ueber dem, der gerade vorne steht.
     */
    const schirm = move.category === 'physical' ? 'reflect' : 'light_screen'
    // Lehmsuhler und Nassmacher: dieselbe Halbierung, nur nach Typ statt
    // nach Kategorie. Beides kann gleichzeitig greifen.
    const suhle = move.type === 'electric' ? 'mud_sport' : move.type === 'fire' ? 'water_sport' : null
    const gedaempft = suhle !== null && hatSchirm(state, gegenseite, suhle)
    const gemildert = move.category !== 'status' && hatSchirm(state, gegenseite, schirm)
    const teiler = (gemildert ? 2 : 1) * (gedaempft ? 2 : 1)
    const dmg = teiler > 1
      ? { ...roh, amount: Math.max(1, Math.floor(roh.amount / teiler)) }
      : roh
    if (gedaempft && roh.amount > 0) {
      events.push({ type: 'blocked', side: gegenseite, fighter: defender.id, by: suhle! })
    }
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
    /*
     * Vor dem Traeger steht die Puppe.
     *
     * Sie hat nur Ausdauer: kein Wert, kein Typ, keine Erholung. Was auf sie
     * einschlaegt, kommt nicht durch — und wenn sie faellt, faellt nur sie.
     * Der Rest des Zuges bricht ab, damit ein Nebeneffekt nicht doch noch am
     * Traeger landet.
     */
    if (dmg.amount > 0 && (defender.substitute ?? 0) > 0 && move.target === 'foe') {
      const rest = defender.substitute! - dmg.amount
      defender.substitute = Math.max(0, rest)
      events.push({ type: 'substitute', side: gegenseite, fighter: defender.id,
        what: rest <= 0 ? 'broken' : 'hit' })
      if (rest <= 0) defender.substitute = undefined
      continue
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
      /*
       * Nachspiel kostet den Zug, der den Traeger gefaellt hat.
       *
       * Nicht den Angreifer, wie beim Abgangsbund, sondern seinen Zug: der
       * bleibt fuer den Rest des Kampfes leer. Das trifft haerter, wenn es
       * der einzige gute war — und genau darauf zielt der Zug.
       */
      if (defender.hp <= 0 && hatEffekt(defender, 'grudge') && slot) {
        const verloren = slot.pp
        slot.pp = 0
        events.push({ type: 'pp_drain', side: sideIndex, fighter: attacker.id, moveId: move.id, amount: verloren })
      }
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

  applyMoveEffect(state, sideIndex, move, attacker, defender, totalDealt, content, rng, events, tiefe, slot)
}

function applyMoveEffect(
  state: BattleState,
  sideIndex: 0 | 1,
  move: MoveDef,
  attacker: Fighter,
  defender: Fighter,
  damageDealt: number,
  content: BattleContent,
  rng: Rng,
  events: BattleEvent[],
  tiefe: number,
  /** Der Platz, aus dem der Zug kam — Mimikry ersetzt genau diesen. */
  slot: { id: string; pp: number; ppMax: number } | null = null,
): void {
  const foeIndex = (sideIndex === 0 ? 1 : 0) as 0 | 1
  const effect = move.effect
  const triggers = move.effectChance <= 0 ? effect.kind !== 'none' : rng.chance(move.effectChance)

  /*
   * Was auf den Gegenueber zielt, erreicht ihn hinter einer Puppe nicht.
   *
   * Der Schaden wird schon vorher abgefangen; hier geht es um alles andere —
   * Zustand, Wertesenkung, Egelsamen, Zwangswechsel. Genau dafuer stellt man
   * sie auf, und ohne diese Liste waere sie nur ein Kraftpunkte-Puffer.
   */
  const AUF_DEN_GEGNER = new Set([
    'status', 'flinch', 'lingering', 'share', 'pp_drain', 'psycho_shift',
    'force_switch', 'type_change', 'copy_move',
  ])
  const hinterPuppe = (defender.substitute ?? 0) > 0
    && (AUF_DEN_GEGNER.has(effect.kind)
      || (effect.kind === 'stat_stage' && effect.target === 'foe'))
  if (hinterPuppe) {
    events.push({ type: 'substitute', side: foeIndex, fighter: defender.id, what: 'hit' })
    return
  }

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
      /*
       * Der Boden haelt mit ab.
       *
       * Nebelfeld gegen alles, Elektrofeld nur gegen Schlaf — beides gilt fuer
       * beide Seiten, denn ein Feld gehoert keiner. Vor dem Bodyguard geprueft,
       * weil ein Feld auch dann wirkt, wenn niemand einen Schirm gestellt hat.
       */
      if (state.terrain?.kind === 'misty' || (state.terrain?.kind === 'electric' && status === 'sleep')) {
        events.push({ type: 'blocked', side: foeIndex, fighter: target.id, by: 'terrain' })
        return
      }
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

      /*
       * Wer traegt ihn?
       *
       * Drei bleiben beim Anwender: Wasserring heilt ihn, Magnetflug hebt ihn
       * an, Zielschuss schaerft seinen naechsten Zug. Alles andere legt man
       * dem Gegenueber auf — das ist der Normalfall, und die Ausnahmen stehen
       * deshalb als Liste da statt als Kette von Wenns.
       */
      const beimAnwender = new Set([
        'aqua_ring', 'magnet_rise', 'sure_hit', 'ingrain', 'wish', 'grudge',
      ])
      const traeger = beimAnwender.has(effect.effect) ? attacker : defender
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
        // Begrenzer sperrt, was der Anwender selbst beherrscht — die Liste
        // muss jetzt festgehalten werden, sie kann sich noch aendern.
        ...(effect.effect === 'imprison' ? { moveIds: attacker.moves.map((m) => m.id) } : {}),
      }]
      events.push({ type: 'lingering', side: seiteDesTraegers, fighter: traeger.id, kind: effect.effect, started: true })

      /*
       * Abgesang singt fuer alle.
       *
       * Der einzige anhaltende Effekt, der beide Seiten gleichzeitig trifft —
       * das ist sein ganzer Sinn: er ist kein Angriff, sondern eine Frist,
       * und sie laeuft fuer den Anwender genauso.
       */
      if (effect.effect === 'perish' && attacker.hp > 0 && !hatEffekt(attacker, 'perish')) {
        attacker.lingering = [...(attacker.lingering ?? []), { kind: 'perish', turns: effect.turns ?? 3 }]
        events.push({ type: 'lingering', side: sideIndex, fighter: attacker.id, kind: 'perish', started: true })
      }
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
      // Eine Heilblockade nimmt jede Form der Erholung, nicht nur die eine.
      if (hatEffekt(attacker, 'heal_block')) {
        events.push({ type: 'blocked', side: sideIndex, fighter: attacker.id, by: 'heal_block' })
        return
      }
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

    case 'terrain': {
      state.terrain = { kind: effect.terrain, turns: 5 }
      events.push({ type: 'terrain', side: sideIndex, fighter: attacker.id, terrain: effect.terrain })
      return
    }

    /*
     * Jemand muss das Feld raeumen.
     *
     * Wirbelwind und Brueller draengen den Gegner hinaus, Teleport bringt den
     * Anwender weg — welcher Fall vorliegt, sagt das Ziel des Zuges, nicht ein
     * zweiter Effekt. Der Ersatz wird gewuerfelt und nicht gewaehlt: das ist
     * der Sinn des Zuges, sonst waere er ein Geschenk an die Gegenseite.
     */
    case 'force_switch': {
      const zielSeite = move.target === 'self' ? sideIndex : foeIndex
      const seite = state.sides[zielSeite]!
      const bank = seite.party
        .map((f, i) => ({ f, i }))
        .filter(({ f, i }) => f.hp > 0 && i !== seite.activeIndex)
      const raus = seite.party[seite.activeIndex]!
      if (bank.length === 0) {
        events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
        return
      }
      events.push({ type: 'forced_out', side: zielSeite, fighter: raus.id })
      doSwitch(state, zielSeite, bank[rng.int(0, bank.length - 1)]!.i, events, content, true)
      return
    }

    case 'hazard': {
      /*
       * Fallen liegen bei der Gegenseite und laufen nicht ab.
       *
       * Ein zweiter Wurf verstaerkt statt die Uhr neu zu stellen; Tarnsteine
       * und Klebenetz kennen nur eine Lage, Stachler drei, Giftspitzen zwei.
       */
      const grenze = effect.hazard === 'spikes' ? 3 : effect.hazard === 'toxic_spikes' ? 2 : 1
      const seite = state.sides[foeIndex]!
      const liegt = (seite.conditions ?? []).find((c) => c.kind === effect.hazard)
      if (liegt && (liegt.layers ?? 1) >= grenze) {
        events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
        return
      }
      if (liegt) liegt.layers = (liegt.layers ?? 1) + 1
      else seite.conditions = [...(seite.conditions ?? []), { kind: effect.hazard, turns: null, layers: 1 }]
      events.push({ type: 'side_condition', side: foeIndex, kind: effect.hazard, started: true })
      return
    }

    /*
     * Werte teilen oder tauschen.
     *
     * Die beiden Tauscher nehmen die *Veraenderungen* mit — ein Schutztausch
     * gegen einen ungebufften Gegner schenkt ihm die eigenen Zuwaechse. Die
     * beiden Teiler mitteln die Werte selbst; das hilft dem Schwaecheren und
     * schadet dem Staerkeren, und darum setzt man sie ein.
     */
    case 'share': {
      if (defender.hp <= 0) return
      const mitteln = (a: number, b: number) => Math.floor((a + b) / 2)
      switch (effect.what) {
        case 'guard_stages':
        case 'power_stages': {
          const paar = effect.what === 'guard_stages' ? (['def', 'spd'] as const) : (['atk', 'spa'] as const)
          for (const k of paar) {
            const merk = attacker.stages[k]
            attacker.stages[k] = defender.stages[k]
            defender.stages[k] = merk
          }
          break
        }
        case 'guard':
        case 'power': {
          const paar = effect.what === 'guard' ? (['def', 'spd'] as const) : (['atk', 'spa'] as const)
          for (const k of paar) {
            const wert = mitteln(attacker.stats[k], defender.stats[k])
            attacker.stats[k] = wert
            defender.stats[k] = wert
          }
          break
        }
        case 'hp': {
          const wert = mitteln(attacker.hp, defender.hp)
          for (const [f, seite] of [[attacker, sideIndex], [defender, foeIndex]] as const) {
            const vorher = f.hp
            f.hp = Math.min(f.hpMax, Math.max(1, wert))
            if (f.hp === vorher) continue
            const art = f.hp > vorher ? 'heal' : 'damage'
            events.push(art === 'heal'
              ? { type: 'heal', side: seite, fighter: f.id, amount: f.hp - vorher, hpLeft: f.hp }
              : { type: 'damage', side: seite, fighter: f.id, amount: vorher - f.hp, hpLeft: f.hp, effectiveness: 1, critical: false })
          }
          break
        }
      }
      events.push({ type: 'shared', side: sideIndex, fighter: attacker.id, what: effect.what })
      return
    }

    case 'pp_drain': {
      const ziel = defender.lastMoveId
      const slot = ziel ? defender.moves.find((m) => m.id === ziel) : undefined
      if (!slot || slot.pp <= 0) {
        events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
        return
      }
      const weg = Math.min(slot.pp, effect.amount)
      slot.pp -= weg
      events.push({ type: 'pp_drain', side: foeIndex, fighter: defender.id, moveId: slot.id, amount: weg })
      return
    }

    case 'belly_drum': {
      /*
       * Die Haelfte der Kraftpunkte fuer den vollen Angriff.
       *
       * Der Preis ist die Wirkung: wer ihn zahlt und dann nicht durchkommt,
       * hat den Kampf verloren. Unter der Haelfte geht er deshalb gar nicht
       * erst — sonst waere er ein Selbstmord mit Zusatzschritt.
       */
      const preis = Math.floor(attacker.hpMax / 2)
      if (attacker.hp <= preis || attacker.stages.atk >= 6) {
        events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
        return
      }
      attacker.hp -= preis
      events.push({ type: 'damage', side: sideIndex, fighter: attacker.id,
        amount: preis, hpLeft: attacker.hp, effectiveness: 1, critical: false })
      const res = applyStage(attacker.stages, 'atk', 6)
      attacker.stages = res.stages
      events.push({ type: 'stage', side: sideIndex, fighter: attacker.id, stat: 'atk', delta: res.applied, capped: res.capped })
      return
    }

    case 'healing_wish': {
      // Ohne jemanden auf der Bank waere es ein Abgang ohne Gegenwert.
      const bank = state.sides[sideIndex]!.party.some((f, i) => f.hp > 0 && i !== state.sides[sideIndex]!.activeIndex)
      if (!bank) {
        events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
        return
      }
      attacker.hp = 0
      state.sides[sideIndex]!.healingWish = true
      return
    }

    case 'baton_pass': {
      /*
       * Hinausgehen und alles Aufgebaute weiterreichen.
       *
       * Der einzige Wechsel, der die Wertveraenderungen mitnimmt — deshalb
       * nicht ueber `doSwitch`, der sie ja gerade loeschen soll. Wer der
       * Naechste ist, entscheidet hier das Spiel und nicht der Spieler: eine
       * Wahl mitten in der Runde braeuchte einen zweiten Weg zum Server.
       */
      const seite = state.sides[sideIndex]!
      const naechster = seite.party.findIndex((f, i) => f.hp > 0 && i !== seite.activeIndex)
      if (naechster === -1) {
        events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
        return
      }
      const erbe = seite.party[naechster]!
      erbe.stages = { ...attacker.stages }
      erbe.lingering = (attacker.lingering ?? []).filter((l) => l.kind !== 'trapped' && l.kind !== 'ingrain')
      attacker.stages = emptyStages()
      attacker.lingering = []
      seite.activeIndex = naechster
      erbe.turnsOnField = 0
      events.push({ type: 'switch', side: sideIndex, fighter: erbe.id, name: erbe.name })
      betreteFeld(state, sideIndex, erbe, events, content)
      return
    }

    case 'psycho_shift': {
      if (attacker.status === 'none' || defender.status !== 'none' || defender.hp <= 0) {
        events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
        return
      }
      if (!canApplyStatus(defender, attacker.status).applied) {
        events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
        return
      }
      defender.status = attacker.status
      defender.statusCounter = attacker.statusCounter
      events.push({ type: 'status', side: foeIndex, fighter: defender.id, status: defender.status })
      events.push({ type: 'status_cured', side: sideIndex, fighter: attacker.id, status: attacker.status })
      attacker.status = 'none'
      attacker.statusCounter = 0
      return
    }

    /*
     * Einen anderen Zug aufrufen.
     *
     * Der aufgerufene nimmt denselben Weg wie ein echter — Treffprobe,
     * Schaden, Wirkung. Nur die Zugwahl davor faellt weg: seine Kraftpunkte
     * gehoeren einem anderen Platz, und einen zweiten Aufruf darf er nicht
     * mehr ausloesen.
     */
    case 'call_move': {
      if (tiefe > 0) {
        events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
        return
      }
      const gewaehlt = waehleZug(state, sideIndex, effect.source, attacker, defender, content, rng)
      const kopie = gewaehlt ? safeMove(content, gewaehlt) : null
      if (!kopie) {
        events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
        return
      }
      events.push({ type: 'called', side: sideIndex, fighter: attacker.id, moveId: kopie.id })
      fuehreZugAus(state, sideIndex, kopie, content, rng, events, null, 1)
      return
    }

    case 'copy_move': {
      const vorbild = defender.lastMoveId
      if (!slot || !vorbild || attacker.moves.some((m) => m.id === vorbild)) {
        events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
        return
      }
      const gelernt = safeMove(content, vorbild)
      if (!gelernt) {
        events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
        return
      }
      slot.id = gelernt.id
      slot.pp = Math.min(gelernt.pp, 5)
      slot.ppMax = slot.pp
      events.push({ type: 'called', side: sideIndex, fighter: attacker.id, moveId: gelernt.id })
      return
    }

    case 'type_change': {
      /*
       * Wen es faerbt, sagt das Ziel des Zuges.
       *
       * Ueberflutung macht den *Gegner* zu Wasser, Umwandlung und Typenspiegel
       * aendern den Anwender. Derselbe Effekt, zwei Richtungen — und ohne
       * diese Zeile faerbte Ueberflutung den Falschen.
       */
      const wer = move.target === 'foe' ? defender : attacker
      const werSeite = wer === attacker ? sideIndex : foeIndex
      if (wer.hp <= 0) return
      const neu = waehleTyp(state, effect.to, attacker, defender, content, rng)
      if (!neu.length || (neu.length === wer.types.length && neu.every((t, i) => t === wer.types[i]))) {
        events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
        return
      }
      wer.types = neu
      events.push({ type: 'type_changed', side: werSeite, fighter: wer.id, types: neu })
      return
    }

    case 'substitute': {
      const preis = Math.floor(attacker.hpMax / 4)
      if (attacker.hp <= preis || (attacker.substitute ?? 0) > 0) {
        events.push({ type: 'substitute', side: sideIndex, fighter: attacker.id, what: 'failed' })
        return
      }
      attacker.hp -= preis
      attacker.substitute = preis
      events.push({ type: 'damage', side: sideIndex, fighter: attacker.id,
        amount: preis, hpLeft: attacker.hp, effectiveness: 1, critical: false })
      events.push({ type: 'substitute', side: sideIndex, fighter: attacker.id, what: 'up' })
      return
    }

    /*
     * Die Kopie des Gegenuebers.
     *
     * Alles ausser den Kraftpunkten: die bleiben, sonst waere der Zug je nach
     * Gegner eine Heilung oder ein Selbstmord. Die uebernommenen Attacken
     * bekommen fuenf Kraftpunkte — geliehen, nicht besessen.
     */
    case 'transform': {
      if (defender.hp <= 0) {
        events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
        return
      }
      attacker.speciesId = defender.speciesId
      attacker.types = [...defender.types]
      attacker.stats = { ...defender.stats, hp: attacker.stats.hp }
      attacker.stages = { ...defender.stages }
      attacker.moves = defender.moves.map((m) => ({ id: m.id, pp: 5, ppMax: 5 }))
      attacker.sprite = defender.sprite
      events.push({ type: 'transformed', side: sideIndex, fighter: attacker.id, into: defender.name })
      return
    }

    case 'magic_coat': {
      attacker.magicCoatUntilTurn = state.turn
      events.push({ type: 'prepared', side: sideIndex, fighter: attacker.id, what: 'priority_guard' })
      return
    }

    case 'field': {
      if (hatFeld(state, effect.field)) {
        events.push({ type: 'move_failed', side: sideIndex, fighter: attacker.id, move: move.id })
        return
      }
      state.fields = [...(state.fields ?? []), { kind: effect.field, turns: effect.turns }]
      events.push({ type: 'field', kind: effect.field, started: true })
      return
    }

    case 'nothing': {
      events.push({ type: 'nothing', side: sideIndex, fighter: attacker.id })
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
      // Eine Heilblockade nimmt jede Form der Erholung, nicht nur die eine.
      if (hatEffekt(attacker, 'heal_block')) {
        events.push({ type: 'blocked', side: sideIndex, fighter: attacker.id, by: 'heal_block' })
        return
      }
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
      // Eine Heilblockade nimmt jede Form der Erholung, nicht nur die eine.
      if (hatEffekt(attacker, 'heal_block')) {
        events.push({ type: 'blocked', side: sideIndex, fighter: attacker.id, by: 'heal_block' })
        return
      }
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

/** Ob ein Feldeffekt gerade ueber dem Kampf liegt. */
const hatFeld = (state: BattleState, kind: FieldEffectKind): boolean =>
  (state.fields ?? []).some((f) => f.kind === kind)

/** Ob an einem Kaempfer ein bestimmter anhaltender Effekt haengt. */
const hatEffekt = (f: Fighter, kind: Lingering['kind']): boolean =>
  (f.lingering ?? []).some((l) => l.kind === kind)

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
    /*
     * Grasfeld heilt beide Seiten.
     *
     * Nach dem Zustandsschaden und nach den anhaltenden Effekten: so sieht man
     * am Protokoll, was abgezogen und was zurueckgegeben wurde, statt nur die
     * Differenz. Wer voll ist, bekommt keine Zeile — sonst stuende in jeder
     * Runde eine Heilung um null.
     */
    if (state.terrain?.kind === 'grassy' && fighter.hp > 0 && fighter.hp < fighter.hpMax
      && !hatEffekt(fighter, 'heal_block')) {
      const zuwachs = Math.min(fighter.hpMax - fighter.hp, Math.max(1, Math.floor(fighter.hpMax / 16)))
      fighter.hp += zuwachs
      events.push({ type: 'heal', side: sideIndex, fighter: fighter.id, amount: zuwachs, hpLeft: fighter.hp })
    }
    fighter.flinched = false
  }
  tickSideConditions(state, events)
  tickTerrain(state, events)
  tickFields(state, events)
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
      /*
       * Diese wirken nicht *im* Rundenende, sondern werden dort nur aelter.
       *
       * Zugabe und Aussetzer greifen in die Zugwahl, Magnetflug in die
       * Typenrechnung, Zielschuss und Scharfblick in die Treffprobe. Der
       * gemeinsame Zaehler unten ist alles, was sie hier brauchen.
       */
      /*
       * Verwurzler heilt und haelt zugleich; das Festhalten steht beim
       * Wechsel, das Heilen hier.
       */
      case 'ingrain': {
        if (fighter.hp >= fighter.hpMax || hatEffekt(fighter, 'heal_block')) break
        const zuwachs = Math.min(fighter.hpMax - fighter.hp, Math.max(1, Math.floor(fighter.hpMax / 16)))
        fighter.hp += zuwachs
        events.push({ type: 'lingering_tick', side: sideIndex, fighter: fighter.id, kind: 'ingrain', amount: zuwachs, hpLeft: fighter.hp })
        break
      }

      /*
       * Wunschtraum wirkt beim Ablaufen, nicht waehrend er laeuft.
       *
       * Genau das ist der Zug: man bezahlt eine Runde im Voraus und bekommt
       * die Heilung erst, wenn sie vielleicht zu spaet ist.
       */
      case 'wish': {
        if (l.turns !== null && l.turns > 1) break
        if (fighter.hp >= fighter.hpMax || hatEffekt(fighter, 'heal_block')) break
        const zuwachs = Math.min(fighter.hpMax - fighter.hp, Math.max(1, Math.floor(fighter.hpMax / 2)))
        fighter.hp += zuwachs
        events.push({ type: 'lingering_tick', side: sideIndex, fighter: fighter.id, kind: 'wish', amount: zuwachs, hpLeft: fighter.hp })
        break
      }

      /*
       * Abgesang: die Frist laeuft ab, und dann faellt der Traeger.
       *
       * Kein Schadensereignis — es ist kein Treffer. Dass jemand gefallen
       * ist, meldet ohnehin die Pruefung nach dem Rundenende.
       */
      case 'perish': {
        if (l.turns !== null && l.turns > 1) break
        fighter.hp = 0
        break
      }

      case 'encore':
      case 'disable':
      case 'magnet_rise':
      case 'sure_hit':
      case 'vulnerable':
      case 'trapped':
      case 'taunt':
      case 'torment':
      case 'imprison':
      case 'heal_block':
      case 'grudge':
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
      // Fallen liegen, bis der Kampf endet — sie zaehlen nicht mit.
      if (c.turns === null) { bleibt.push(c); continue }
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

/**
 * Welchen Zug ein Zugkopierer aufruft.
 *
 * `null` heisst: es gibt keinen — dann scheitert der Kopierer sichtbar,
 * statt still nichts zu tun.
 */
function waehleZug(
  state: BattleState, sideIndex: 0 | 1, quelle: 'foe_last' | 'own_random' | 'any_random' | 'terrain',
  attacker: Fighter, defender: Fighter, content: BattleContent, rng: Rng,
): string | null {
  if (quelle === 'foe_last') return defender.lastMoveId ?? null

  if (quelle === 'own_random') {
    // Schlafrede: nur im Schlaf, und nie den Zug, der gerade laeuft.
    if (attacker.status !== 'sleep') return null
    const andere = attacker.moves.filter((m) => m.id !== attacker.lastMoveId)
    return andere.length ? andere[rng.int(0, andere.length - 1)]!.id : null
  }

  if (quelle === 'terrain') {
    const zumBoden: Record<string, string> = {
      grassy: 'energy-ball', electric: 'thunderbolt', misty: 'moonblast',
    }
    return zumBoden[state.terrain?.kind ?? ''] ?? 'tri-attack'
  }

  /*
   * Metronom.
   *
   * Aus allem, was das Paket kennt — ausser aus Zuegen, die selbst aufrufen.
   * Zehn Versuche und dann Schluss: eine Schleife, die auf einen brauchbaren
   * Wurf wartet, waere ein Kampf, der haengen kann.
   */
  const alle = content.moveIds?.()
  if (!alle?.length) return null
  for (let i = 0; i < 10; i++) {
    const id = alle[rng.int(0, alle.length - 1)]!
    const m = safeMove(content, id)
    if (m && m.effect.kind !== 'call_move' && m.effect.kind !== 'copy_move') return id
  }
  return null
}

/** Auf welchen Typ ein Typwechsel fuehrt. Leer heisst: er fuehrt auf keinen. */
function waehleTyp(
  state: BattleState, ziel: 'water' | 'own_move' | 'resist_last' | 'target' | 'terrain',
  attacker: Fighter, defender: Fighter, content: BattleContent, rng: Rng,
): string[] {
  if (ziel === 'water') return ['water']
  if (ziel === 'target') return [...defender.types]
  if (ziel === 'terrain') {
    const zumBoden: Record<string, string> = { grassy: 'grass', electric: 'electric', misty: 'fairy' }
    return [zumBoden[state.terrain?.kind ?? ''] ?? 'normal']
  }
  if (ziel === 'own_move') {
    const eigene = attacker.moves.map((m) => safeMove(content, m.id)?.type).filter((t): t is string => !!t)
    return eigene.length ? [eigene[rng.int(0, eigene.length - 1)]!] : []
  }

  // Umwandlung2: irgendein Typ, der gegen den letzten Treffer haelt.
  const letzter = defender.lastMoveId ? safeMove(content, defender.lastMoveId) : null
  const alle = content.types?.()
  if (!letzter || !alle?.length) return []
  const haltend = alle.filter((t) => content.effectiveness(letzter.type, [t]) < 1)
  return haltend.length ? [haltend[rng.int(0, haltend.length - 1)]!] : []
}

/** Feldeffekte werden aelter wie alles andere. */
function tickFields(state: BattleState, events: BattleEvent[]): void {
  if (!state.fields?.length) return
  const bleibt: typeof state.fields = []
  for (const f of state.fields) {
    const rest = f.turns - 1
    if (rest <= 0) { events.push({ type: 'field', kind: f.kind, started: false }); continue }
    bleibt.push({ ...f, turns: rest })
  }
  state.fields = bleibt
}

/** Der Boden haelt fuenf Runden. Danach ist er wieder nur Boden. */
function tickTerrain(state: BattleState, events: BattleEvent[]): void {
  if (!state.terrain) return
  const rest = state.terrain.turns - 1
  if (rest > 0) {
    state.terrain = { ...state.terrain, turns: rest }
    return
  }
  state.terrain = null
  events.push({ type: 'terrain', side: 0, fighter: '', terrain: null })
}

function checkFaints(state: BattleState, events: BattleEvent[], content: BattleContent): void {
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
    betreteFeld(state, sideIndex, incoming, events, content)
  }
}

function finish(state: BattleState, events: BattleEvent[], outcome: BattleOutcome): TurnResult {
  state.outcome = outcome
  events.push({ type: 'end', outcome })
  return { state, events }
}

export { active as activeFighter, alive as aliveFighters, effectiveStat }
