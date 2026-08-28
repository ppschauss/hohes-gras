/**
 * Crafting.
 *
 * Turns expedition materials into things that matter. Recipes exist so that
 * loot which would otherwise pile up unread has a destination — a bag full of
 * "Feinsand" is only interesting if it becomes something.
 */
export interface Recipe {
  id: string
  /** What it produces. */
  output: { itemId: string; quantity: number }
  inputs: Array<{ itemId: string; quantity: number }>
  goldCost: number
  /** Buildings are not required, but a lab makes some recipes available. */
  requiresBuilding?: { buildingId: string; level: number }
}

export const RECIPES: Recipe[] = [
  {
    id: 'craft-great-ball',
    output: { itemId: 'great-ball', quantity: 5 },
    inputs: [{ itemId: 'poke-ball', quantity: 8 }, { itemId: 'iron-shard', quantity: 2 }],
    goldCost: 120,
  },
  {
    id: 'craft-ultra-ball',
    output: { itemId: 'ultra-ball', quantity: 3 },
    inputs: [{ itemId: 'great-ball', quantity: 5 }, { itemId: 'iron-shard', quantity: 4 }, { itemId: 'star-piece', quantity: 1 }],
    goldCost: 400,
    requiresBuilding: { buildingId: 'lab', level: 2 },
  },
  {
    id: 'craft-golden-razz',
    output: { itemId: 'golden-razz', quantity: 1 },
    inputs: [{ itemId: 'razz-berry', quantity: 6 }, { itemId: 'star-piece', quantity: 1 }],
    goldCost: 200,
  },
  {
    id: 'craft-hyper-potion',
    output: { itemId: 'hyper-potion', quantity: 2 },
    inputs: [{ itemId: 'super-potion', quantity: 3 }, { itemId: 'dew-drop', quantity: 2 }],
    goldCost: 180,
  },
  {
    id: 'craft-exp-candy-l',
    output: { itemId: 'exp-candy-l', quantity: 1 },
    inputs: [{ itemId: 'exp-candy-s', quantity: 6 }, { itemId: 'star-piece', quantity: 2 }],
    goldCost: 500,
    requiresBuilding: { buildingId: 'lab', level: 1 },
  },
  {
    id: 'craft-oran-berries',
    output: { itemId: 'oran-berry', quantity: 10 },
    inputs: [{ itemId: 'silk-thread', quantity: 3 }, { itemId: 'soft-sand', quantity: 3 }],
    goldCost: 60,
    requiresBuilding: { buildingId: 'berry-farm', level: 1 },
  },
]

export const findRecipe = (id: string): Recipe | undefined => RECIPES.find((r) => r.id === id)

export type CraftCheck =
  | { ok: true }
  | { ok: false; reason: 'unknown_recipe' }
  | { ok: false; reason: 'missing_building'; buildingId: string; level: number }
  | { ok: false; reason: 'missing_items'; itemId: string; need: number; have: number }
  | { ok: false; reason: 'insufficient_gold'; need: number }

export function canCraft(
  recipe: Recipe,
  bag: Record<string, number>,
  gold: number,
  buildings: Array<{ buildingId: string; level: number }>,
): CraftCheck {
  if (recipe.requiresBuilding) {
    const have = buildings.find((b) => b.buildingId === recipe.requiresBuilding!.buildingId)
    if (!have || have.level < recipe.requiresBuilding.level) {
      return {
        ok: false, reason: 'missing_building',
        buildingId: recipe.requiresBuilding.buildingId,
        level: recipe.requiresBuilding.level,
      }
    }
  }
  for (const input of recipe.inputs) {
    const have = bag[input.itemId] ?? 0
    if (have < input.quantity) {
      return { ok: false, reason: 'missing_items', itemId: input.itemId, need: input.quantity, have }
    }
  }
  if (gold < recipe.goldCost) return { ok: false, reason: 'insufficient_gold', need: recipe.goldCost }
  return { ok: true }
}
