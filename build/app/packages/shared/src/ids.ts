/** Branded id types. They are plain strings at runtime; the brand only exists
 *  during type-checking so a CreatureId can never be passed where a TrainerId
 *  is expected. */
declare const brand: unique symbol
type Branded<T, B extends string> = T & { readonly [brand]: B }

export type TrainerId = Branded<string, 'TrainerId'>
export type CreatureId = Branded<string, 'CreatureId'>
export type SpeciesId = Branded<string, 'SpeciesId'>
export type MoveId = Branded<string, 'MoveId'>
export type ItemId = Branded<string, 'ItemId'>
export type AreaId = Branded<string, 'AreaId'>
export type RegionId = Branded<string, 'RegionId'>
export type GuildId = Branded<string, 'GuildId'>
export type BattleId = Branded<string, 'BattleId'>

export const asTrainerId = (v: string) => v as TrainerId
export const asCreatureId = (v: string) => v as CreatureId
export const asSpeciesId = (v: string) => v as SpeciesId
export const asMoveId = (v: string) => v as MoveId
export const asItemId = (v: string) => v as ItemId
export const asAreaId = (v: string) => v as AreaId
export const asRegionId = (v: string) => v as RegionId
