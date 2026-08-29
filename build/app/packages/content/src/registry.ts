import type { AreaDef, BadgeDef, ChapterDef, ContentPack, ItemDef, MoveDef, RegionDef, SpeciesDef, TrainerDef, TypeDef } from './schema.js'

/** Read-only view over a loaded pack. Every lookup that the engine performs
 *  goes through here, so a missing id fails loudly at the call site instead of
 *  silently producing `undefined` three layers deeper. */
export class Registry {
  constructor(private readonly pack: ContentPack) {}

  get manifest() { return this.pack.manifest }
  get allSpecies(): SpeciesDef[] { return [...this.pack.species.values()].sort((a, b) => a.dexNumber - b.dexNumber) }

  /**
   * Alles, was sich erspielen laesst.
   *
   * Ereignis-Arten werden von Hand vergeben und stehen in keiner Spawn-Tabelle.
   * Zaehlte man sie mit, waere der Pokedex fuer jeden unvollstaendig, der bei
   * der Verteilung nicht dabei war.
   */
  get obtainableSpecies(): SpeciesDef[] { return this.allSpecies.filter((s) => !s.event) }
  get allItems(): ItemDef[] { return [...this.pack.items.values()] }
  get allTypes(): TypeDef[] { return [...this.pack.types.values()] }
  /** Areas in the order a player travels them: region by region, and inside a
   *  region by its own order. Sorting by `order` alone interleaves two regions
   *  into a sequence that exists nowhere in the game. */
  get allAreas(): AreaDef[] {
    const regionOrder = new Map([...this.pack.regions.values()].map((r) => [r.id, r.order]))
    return [...this.pack.areas.values()].sort((a, b) => {
      const regionDelta = (regionOrder.get(a.regionId) ?? 0) - (regionOrder.get(b.regionId) ?? 0)
      return regionDelta !== 0 ? regionDelta : a.order - b.order
    })
  }
  get allRegions(): RegionDef[] { return [...this.pack.regions.values()].sort((a, b) => a.order - b.order) }
  get allBadges(): BadgeDef[] { return [...this.pack.badges.values()] }
  get allTrainers(): TrainerDef[] { return [...this.pack.trainers.values()] }
  get chapters(): ChapterDef[] { return this.pack.chapters }
  /** Zaehlt nur, was sich erspielen laesst — siehe `obtainableSpecies`. */
  get speciesCount() { return this.obtainableSpecies.length }

  species(id: string): SpeciesDef { return req(this.pack.species.get(id), 'species', id) }
  move(id: string): MoveDef { return req(this.pack.moves.get(id), 'move', id) }
  item(id: string): ItemDef { return req(this.pack.items.get(id), 'item', id) }
  area(id: string): AreaDef { return req(this.pack.areas.get(id), 'area', id) }
  region(id: string): RegionDef { return req(this.pack.regions.get(id), 'region', id) }
  trainer(id: string): TrainerDef { return req(this.pack.trainers.get(id), 'trainer', id) }
  badge(id: string): BadgeDef { return req(this.pack.badges.get(id), 'badge', id) }

  type(id: string): TypeDef { return req(this.pack.types.get(id), 'type', id) }

  trySpecies(id: string): SpeciesDef | undefined { return this.pack.species.get(id) }
  tryMove(id: string): MoveDef | undefined { return this.pack.moves.get(id) }
  tryType(id: string): TypeDef | undefined { return this.pack.types.get(id) }
  tryBadge(id: string): BadgeDef | undefined { return this.pack.badges.get(id) }
  tryItem(id: string): ItemDef | undefined { return this.pack.items.get(id) }
  tryArea(id: string): AreaDef | undefined { return this.pack.areas.get(id) }

  areasOfRegion(regionId: string): AreaDef[] {
    return this.allAreas.filter((a) => a.regionId === regionId)
  }

  /** Damage multiplier of `attackingType` against a defender with `defTypes`.
   *  Missing chart entries mean "neutral", which keeps packs small. */
  effectiveness(attackingType: string, defTypes: readonly string[]): number {
    const row = this.pack.typeChart[attackingType] ?? {}
    return defTypes.reduce((mult, d) => mult * (row[d] ?? 1), 1)
  }

  /** Moves a species knows at a given level, most recent four first. */
  learnableAt(speciesId: string, level: number): string[] {
    return this.species(speciesId).learnset
      .filter((l) => l.level <= level)
      .sort((a, b) => b.level - a.level)
      .map((l) => l.moveId)
  }

  localized(text: Record<string, string>, locale: string): string {
    return text[locale] ?? text[this.pack.manifest.defaultLocale] ?? text['de'] ?? Object.values(text)[0] ?? ''
  }
}

function req<T>(value: T | undefined, kind: string, id: string): T {
  if (value === undefined) throw new Error(`Content-Pack kennt ${kind} "${id}" nicht`)
  return value
}
