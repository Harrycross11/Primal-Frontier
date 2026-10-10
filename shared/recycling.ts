// The recycler at each landmark: put salvage parts, or anything that can be crafted, in its
// top row, switch it on, and it breaks them down one at a time into the bottom row. Parts give
// set amounts; crafted things give back half of what they cost, less wood and stone.

import { recipeFor, type ItemId } from './items.ts';

export const RECYCLER_INPUT = [0, 1, 2, 3, 4, 5];
export const RECYCLER_OUTPUT = [6, 7, 8, 9, 10, 11];
/** Seconds to break down one item. */
export const RECYCLE_SECONDS = 4;

const PARTS: Partial<Record<ItemId, [ItemId, number][]>> = {
  gears: [['scrap', 10], ['metal', 13]],
  metalPipe: [['scrap', 5], ['hqm', 2]],
  rope: [['cloth', 15]],
  sheetMetal: [['scrap', 8], ['metal', 100], ['hqm', 1]],
};

/** What one of an item breaks down into, or null if the recycler won't take it. */
export function recycleYield(item: ItemId): [ItemId, number][] | null {
  const part = PARTS[item];
  if (part) return part;
  const recipe = recipeFor(item);
  if (!recipe) return null;
  const out = (Object.entries(recipe.cost) as [ItemId, number][])
    .filter(([res]) => res !== 'wood' && res !== 'stone')
    .map(([res, n]) => [res, Math.floor(n / recipe.count / 2)] as [ItemId, number])
    .filter(([, n]) => n > 0);
  return out.length ? out : null;
}
