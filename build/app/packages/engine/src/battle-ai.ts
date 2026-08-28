import type { MoveDef } from '@game/content'
import type { BattleState, Fighter, PlayerAction } from './battle-types.js'
import type { BattleContent } from './battle.js'
import type { Rng } from './rng.js'
import { effectiveStat } from './battle-math.js'

export type AiLevel = 'wild' | 'basic' | 'skilled' | 'expert'

/**
 * Choose the opponent's action.
 *
 * Difficulty is expressed as how often the AI takes its best option rather than
 * as a stat bonus. A gym leader that plays well is a fair challenge; one that
 * cheats on numbers is just a wall, and losing to it teaches nothing.
 */
export function chooseAction(
  state: BattleState,
  sideIndex: 0 | 1,
  level: AiLevel,
  content: BattleContent,
  rng: Rng,
): PlayerAction {
  const side = state.sides[sideIndex]!
  const foeSide = state.sides[sideIndex === 0 ? 1 : 0]!
  const self = side.party[side.activeIndex]!
  const foe = foeSide.party[foeSide.activeIndex]!

  const usable = self.moves
    .map((slot, index) => ({ index, slot, move: tryMove(content, slot.id) }))
    .filter((m): m is { index: number; slot: typeof self.moves[0]; move: MoveDef } =>
      m.move !== null && m.slot.pp > 0)

  if (usable.length === 0) return { kind: 'move', moveIndex: 0 }

  // A wild creature has no trainer: it attacks at random and never switches.
  if (level === 'wild') return { kind: 'move', moveIndex: rng.pick(usable).index }

  if (level !== 'basic' && shouldSwitch(side, self, foe, content)) {
    const better = bestSwitchTarget(side, foe, content)
    if (better !== null) return { kind: 'switch', partyIndex: better }
  }

  const scored = usable.map((m) => ({ ...m, score: scoreMove(m.move, self, foe, content) }))
  scored.sort((a, b) => b.score - a.score)

  const mistakeChance = { wild: 100, basic: 45, skilled: 18, expert: 4 }[level]
  if (rng.chance(mistakeChance)) return { kind: 'move', moveIndex: rng.pick(scored).index }
  return { kind: 'move', moveIndex: scored[0]!.index }
}

function tryMove(content: BattleContent, id: string): MoveDef | null {
  try { return content.move(id) } catch { return null }
}

/** Rough expected value of a move this turn. Not a simulation — a simulation
 *  would be slower and, worse, would make the AI unbeatable in a way that is
 *  not fun. */
function scoreMove(move: MoveDef, self: Fighter, foe: Fighter, content: BattleContent): number {
  if (move.category === 'status') {
    // Status moves are worth something only while they can still do their job.
    if (move.effect.kind === 'status' && foe.status !== 'none') return 5
    if (move.effect.kind === 'stat_stage') {
      const stat = move.effect.stat
      const current = move.effect.target === 'self' ? self.stages[stat] : foe.stages[stat]
      return Math.abs(current) >= 4 ? 4 : 30
    }
    if (move.effect.kind === 'heal') return self.hp / self.hpMax < 0.5 ? 60 : 8
    return 20
  }

  const effectiveness = content.effectiveness(move.type, foe.types)
  if (effectiveness === 0) return 0

  const stab = self.types.includes(move.type) ? 1.5 : 1
  const physical = move.category === 'physical'
  const atk = effectiveStat(self, physical ? 'atk' : 'spa')
  const def = effectiveStat(foe, physical ? 'def' : 'spd')

  const estimate = (move.power * stab * effectiveness * atk) / Math.max(1, def)
  const accuracy = move.accuracy / 100
  // A move that would knock the target out is worth taking even at low
  // accuracy; otherwise expected damage is the right currency.
  const lethalBonus = estimate * accuracy >= foe.hp ? 60 : 0
  return estimate * accuracy + lethalBonus + move.priority * 8
}

/** Switch out when the active creature is badly outmatched and a clearly
 *  better answer is on the bench. */
function shouldSwitch(side: BattleState['sides'][0], self: Fighter, foe: Fighter, content: BattleContent): boolean {
  if (side.party.filter((f) => f.hp > 0).length <= 1) return false
  if (self.hp / self.hpMax > 0.35) return false
  const incomingThreat = worstIncoming(self, foe, content)
  return incomingThreat >= 2
}

function worstIncoming(self: Fighter, foe: Fighter, content: BattleContent): number {
  let worst = 0
  for (const slot of foe.moves) {
    const move = tryMove(content, slot.id)
    if (!move || move.category === 'status') continue
    worst = Math.max(worst, content.effectiveness(move.type, self.types))
  }
  return worst
}

function bestSwitchTarget(side: BattleState['sides'][0], foe: Fighter, content: BattleContent): number | null {
  // Eine gewoehnliche Schleife statt forEach: TypeScript verengt eine in einer
  // Closure zugewiesene Variable sonst auf `never`.
  let bestIndex = -1
  let bestScore = Number.NEGATIVE_INFINITY

  for (let index = 0; index < side.party.length; index++) {
    const candidate = side.party[index]!
    if (candidate.hp <= 0 || index === side.activeIndex) continue

    const threat = worstIncoming(candidate, foe, content)
    const offence = Math.max(
      0,
      ...candidate.moves.map((slot) => {
        const move = tryMove(content, slot.id)
        return move && move.category !== 'status' ? content.effectiveness(move.type, foe.types) : 0
      }),
    )
    const score = offence - threat
    if (score > bestScore) { bestScore = score; bestIndex = index }
  }
  return bestIndex >= 0 && bestScore > 0 ? bestIndex : null
}
