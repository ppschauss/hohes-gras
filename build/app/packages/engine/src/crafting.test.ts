import { describe, expect, it } from 'vitest'
import { canCraft, findRecipe, RECIPES } from './crafting.js'

/** Ein Labor auf Stufe 5 — hoch genug fuer alles, was hier geprueft wird. */
const LABOR = [{ buildingId: 'lab', level: 5 }]

/** Genug von allem, damit nie die Zutaten der Grund sind. */
const vollerBeutel = (recipeId: string): Record<string, number> =>
  Object.fromEntries(findRecipe(recipeId)!.inputs.map((i) => [i.itemId, i.quantity * 10]))

describe('canCraft — Forschung', () => {
  it('sperrt ein Rezept, dessen Projekt gar nicht erforscht ist', () => {
    const r = findRecipe('craft-fertiliser-1')!
    const check = canCraft(r, vollerBeutel(r.id), 999_999, LABOR, new Map())
    expect(check).toMatchObject({ ok: false, reason: 'missing_research', projectId: 'res-fertiliser' })
  })

  it('gibt Duenger I schon mit der ersten Forschungsstufe frei', () => {
    const r = findRecipe('craft-fertiliser-1')!
    expect(canCraft(r, vollerBeutel(r.id), 999_999, LABOR, new Map([['res-fertiliser', 1]]))).toEqual({ ok: true })
  })

  /*
   * Der eigentliche Punkt: vor dieser Regel hat Stufe 1 alle drei Duenger
   * geoeffnet, und die Stufen 2 und 3 waren reine Goldsenken ohne Wirkung.
   */
  it('haelt Duenger II und III hinter ihren eigenen Stufen zurueck', () => {
    const zwei = findRecipe('craft-fertiliser-2')!
    const drei = findRecipe('craft-fertiliser-3')!
    const stufe1 = new Map([['res-fertiliser', 1]])
    expect(canCraft(zwei, vollerBeutel(zwei.id), 999_999, LABOR, stufe1))
      .toMatchObject({ ok: false, reason: 'research_tier', tier: 2, have: 1 })
    expect(canCraft(drei, vollerBeutel(drei.id), 999_999, LABOR, stufe1))
      .toMatchObject({ ok: false, reason: 'research_tier', tier: 3, have: 1 })

    const stufe3 = new Map([['res-fertiliser', 3]])
    expect(canCraft(zwei, vollerBeutel(zwei.id), 999_999, LABOR, stufe3)).toEqual({ ok: true })
    expect(canCraft(drei, vollerBeutel(drei.id), 999_999, LABOR, stufe3)).toEqual({ ok: true })
  })

  it('unterscheidet "noch nichts erforscht" von "Stufe zu niedrig"', () => {
    const r = findRecipe('craft-fertiliser-3')!
    const nichts = canCraft(r, vollerBeutel(r.id), 999_999, LABOR, new Map())
    const zuwenig = canCraft(r, vollerBeutel(r.id), 999_999, LABOR, new Map([['res-fertiliser', 2]]))
    expect(nichts).toMatchObject({ reason: 'missing_research' })
    expect(zuwenig).toMatchObject({ reason: 'research_tier' })
  })

  it('laesst offene Rezepte ohne jede Forschung zu', () => {
    const offen = RECIPES.filter((r) => !r.research && !r.requiresBuilding)
    expect(offen.length).toBeGreaterThan(0)
    for (const r of offen) {
      expect(canCraft(r, vollerBeutel(r.id), 999_999, [], new Map())).toEqual({ ok: true })
    }
  })

  it('nennt jede Stufe eines mehrstufigen Projekts genau ein Rezept', () => {
    const stufen = RECIPES.filter((r) => r.research === 'res-fertiliser')
      .map((r) => r.researchTier ?? 1).sort()
    expect(stufen).toEqual([1, 2, 3])
  })

  it('bindet alle sechs Fleissbeeren an ihre eigene Forschung', () => {
    const beeren = RECIPES.filter((r) => r.research === 'res-ev-berries')
    expect(beeren).toHaveLength(6)
    for (const r of beeren) {
      expect(canCraft(r, vollerBeutel(r.id), 999_999, LABOR, new Map()))
        .toMatchObject({ ok: false, reason: 'missing_research' })
      expect(canCraft(r, vollerBeutel(r.id), 999_999, LABOR, new Map([['res-ev-berries', 1]])))
        .toEqual({ ok: true })
    }
  })
})

describe('Die Kette von der Beere zum Kronkorken', () => {
  const EV_BEEREN = ['pomeg-berry', 'kelpsy-berry', 'qualot-berry', 'hondew-berry', 'apicot-berry', 'tamato-berry']

  it('gibt jeder Fleissbeere ein eigenes Rezept mit eigenem Ergebnis', () => {
    const ausgaben = RECIPES.filter((r) => r.research === 'res-ev-berries').map((r) => r.output.itemId)
    expect([...ausgaben].sort()).toEqual([...EV_BEEREN].sort())
  })

  /*
   * Der Punkt der ganzen Umstellung: vorher zogen die Vitamine beliebige
   * Beeren aus dem Laden. Damit war die Kette an dieser Stelle offen — man
   * konnte sie mit Gold abkuerzen, ohne je ein Beet bestellt zu haben.
   */
  it('laesst jedes Vitamin genau seine eigene Fleissbeere verlangen', () => {
    const paare: Array<[string, string]> = [
      ['craft-hp-up', 'pomeg-berry'], ['craft-protein', 'kelpsy-berry'],
      ['craft-iron', 'qualot-berry'], ['craft-calcium', 'hondew-berry'],
      ['craft-zinc', 'apicot-berry'], ['craft-carbos', 'tamato-berry'],
    ]
    for (const [rezept, beere] of paare) {
      const zutaten = findRecipe(rezept)!.inputs.map((i) => i.itemId)
      expect(zutaten).toContain(beere)
      // Und keine andere Fleissbeere, sonst waere die Zuordnung Zufall.
      expect(zutaten.filter((z) => EV_BEEREN.includes(z))).toEqual([beere])
    }
  })

  it('verlangt fuer den Kronkorken alle sechs Sorten, nicht eine in Menge', () => {
    const zutaten = findRecipe('craft-bottle-cap')!.inputs
    const beeren = zutaten.filter((i) => EV_BEEREN.includes(i.itemId))
    expect(beeren.map((b) => b.itemId).sort()).toEqual([...EV_BEEREN].sort())
    expect(new Set(beeren.map((b) => b.quantity)).size).toBe(1)
  })

  it('haelt die Reihenfolge der Laborstufen ein: Beere vor Vitamin vor Kronkorken', () => {
    const stufe = (id: string) => findRecipe(id)!.requiresBuilding!.level
    expect(stufe('craft-pomeg-berry')).toBeLessThan(stufe('craft-hp-up'))
    expect(stufe('craft-hp-up')).toBeLessThan(stufe('craft-bottle-cap'))
  })
})
