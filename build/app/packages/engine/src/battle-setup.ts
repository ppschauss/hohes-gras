import type { Nature, StatBlock } from '@game/shared'
import type { SpeciesDef } from '@game/content'
import { computeStats } from './stats.js'
import { emptyStages, type Fighter, type Side, type Status } from './battle-types.js'

export interface CreatureLike {
  id: string
  speciesId: string
  nickname: string | null
  level: number
  nature: Nature
  ivs: StatBlock
  evs: StatBlock
  hpCurrent: number
  moves: string[]
  shiny: boolean
  friendship: number
}

/** Turn a stored creature into a fighter. Current HP carries over from the
 *  garden, which is what makes healing items matter outside of battle. */
export function toFighter(
  c: CreatureLike,
  species: SpeciesDef,
  displayName: string,
  ppOf: (moveId: string) => number,
  status: Status = 'none',
  /**
   * Hoechstlevel fuer diesen Kampf. Ohne Angabe zaehlt das eigene.
   *
   * Gedeckelt wird nicht nur die Zahl, sondern auch die Werte, die daraus
   * folgen — sonst stuende ueber dem Kopf fuenfzig und darunter schluege ein
   * Hundertster zu. Die Kampfzone ist der einzige Ort, der das nutzt.
   */
  levelCap?: number,
): Fighter {
  const level = levelCap === undefined ? c.level : Math.min(c.level, levelCap)
  const stats = computeStats(species, level, c.ivs, c.evs, c.nature)
  return {
    id: c.id,
    speciesId: c.speciesId,
    name: c.nickname ?? displayName,
    level,
    types: [...species.types],
    nature: c.nature,
    ivs: c.ivs,
    evs: c.evs,
    stats,
    hp: Math.max(0, Math.min(c.hpCurrent, stats.hp)),
    hpMax: stats.hp,
    status,
    statusCounter: 0,
    stages: emptyStages(),
    confused: false,
    confusionTurns: 0,
    flinched: false,
    moves: c.moves.map((id) => ({ id, pp: ppOf(id), ppMax: ppOf(id) })),
    sprite: c.shiny ? species.spriteShiny : species.sprite,
    shiny: c.shiny,
    friendship: c.friendship,
  }
}

/** Build an NPC fighter at full health from a species and level. */
export function npcFighter(
  id: string,
  species: SpeciesDef,
  displayName: string,
  level: number,
  moves: string[],
  ppOf: (moveId: string) => number,
  nature: Nature = 'hardy',
  ivValue = 15,
): Fighter {
  const ivs: StatBlock = { hp: ivValue, atk: ivValue, def: ivValue, spa: ivValue, spd: ivValue, spe: ivValue }
  const evs: StatBlock = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 }
  const stats = computeStats(species, level, ivs, evs, nature)
  return {
    id, speciesId: species.id, name: displayName, level,
    types: [...species.types], nature, ivs, evs, stats,
    hp: stats.hp, hpMax: stats.hp,
    status: 'none', statusCounter: 0,
    stages: emptyStages(), confused: false, confusionTurns: 0, flinched: false,
    moves: moves.map((m) => ({ id: m, pp: ppOf(m), ppMax: ppOf(m) })),
    sprite: species.sprite, shiny: false, friendship: 70,
  }
}

export const makeSide = (trainerName: string, party: Fighter[]): Side => ({
  trainerName,
  party,
  activeIndex: Math.max(0, party.findIndex((f) => f.hp > 0)),
})
