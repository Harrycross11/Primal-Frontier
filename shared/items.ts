// Items, inventories and crafting recipes, modelled on Rust: resources stack up in slots,
// tools gather faster and wear out, and better gear needs a workbench and smelted metal.
// Shared so the client shows exactly what the server will allow.

export type ItemId =
  | 'wood'
  | 'stone'
  | 'scrap'
  | 'metalOre'
  | 'metal'
  | 'cloth'
  | 'rock'
  | 'buildingPlan'
  | 'stoneHatchet'
  | 'stonePickaxe'
  | 'salvagedAxe'
  | 'salvagedPickaxe'
  | 'workbench'
  | 'furnace'
  | 'storageBox';

/** What a tool is good at: multipliers on the base amount per hit, for each kind of node. */
export interface ToolInfo {
  wood: number;
  stone: number;
  scrap: number;
  /** Hits before it breaks. */
  durability: number;
}

export interface ItemInfo {
  name: string;
  kind: 'resource' | 'tool' | 'plan' | 'deployable';
  stack: number;
  description: string;
  tool?: ToolInfo;
}

export const ITEMS: Record<ItemId, ItemInfo> = {
  wood: { name: 'Wood', kind: 'resource', stack: 1000, description: 'Chopped from trees. Builds, crafts and fuels furnaces.' },
  stone: { name: 'Stone', kind: 'resource', stack: 1000, description: 'Mined from boulders. Stronger walls and stone tools.' },
  scrap: { name: 'Scrap', kind: 'resource', stack: 1000, description: 'Salvaged from wrecks. Toughest walls and advanced gear.' },
  metalOre: { name: 'Metal Ore', kind: 'resource', stack: 1000, description: 'Mined from ore rocks. Smelt it in a furnace.' },
  metal: { name: 'Metal Fragments', kind: 'resource', stack: 1000, description: 'Smelted from ore. Needed for salvaged tools and the workbench.' },
  cloth: { name: 'Cloth', kind: 'resource', stack: 1000, description: 'Picked from hemp plants.' },
  rock: {
    name: 'Rock',
    kind: 'tool',
    stack: 1,
    description: 'Every survivor starts with one. Slowly chips wood, stone and scrap.',
    tool: { wood: 1, stone: 1, scrap: 1, durability: 400 },
  },
  buildingPlan: { name: 'Building Plan', kind: 'plan', stack: 1, description: 'Hold it to build walls, floors and stairs.' },
  stoneHatchet: {
    name: 'Stone Hatchet',
    kind: 'tool',
    stack: 1,
    description: 'Twice as fast at chopping wood.',
    tool: { wood: 2, stone: 0.5, scrap: 0.75, durability: 250 },
  },
  stonePickaxe: {
    name: 'Stone Pickaxe',
    kind: 'tool',
    stack: 1,
    description: 'Twice as fast at mining stone and ore.',
    tool: { wood: 0.5, stone: 2, scrap: 0.75, durability: 250 },
  },
  salvagedAxe: {
    name: 'Salvaged Axe',
    kind: 'tool',
    stack: 1,
    description: 'A sawblade on a pipe. Chops wood very fast.',
    tool: { wood: 3.5, stone: 0.5, scrap: 1.25, durability: 500 },
  },
  salvagedPickaxe: {
    name: 'Salvaged Pickaxe',
    kind: 'tool',
    stack: 1,
    description: 'Mines stone and ore very fast.',
    tool: { wood: 0.5, stone: 3.5, scrap: 1.25, durability: 500 },
  },
  workbench: { name: 'Workbench', kind: 'deployable', stack: 1, description: 'Stand near it to craft salvaged tools.' },
  furnace: { name: 'Furnace', kind: 'deployable', stack: 1, description: 'Burns wood to smelt metal ore into metal fragments.' },
  storageBox: { name: 'Storage Box', kind: 'deployable', stack: 1, description: 'Holds 12 stacks of items.' },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export interface Stack {
  item: ItemId;
  count: number;
  /** Remaining durability, for tools. */
  hp?: number;
}

export type Slots = (Stack | null)[];

/** Slots 0-5 are the belt (hotbar), the rest the backpack. */
export const BELT_SIZE = 6;
export const INVENTORY_SIZE = 30;

export function emptySlots(n: number): Slots {
  return Array.from({ length: n }, () => null);
}

export function newStack(item: ItemId, count = 1): Stack {
  const tool = ITEMS[item].tool;
  return tool ? { item, count, hp: tool.durability } : { item, count };
}

export function countItem(slots: Slots, item: ItemId): number {
  return slots.reduce((n, s) => n + (s?.item === item ? s.count : 0), 0);
}

/** Totals of every item held, for quick display and recipe checks. */
export function itemTotals(slots: Slots): Partial<Record<ItemId, number>> {
  const out: Partial<Record<ItemId, number>> = {};
  for (const s of slots) if (s) out[s.item] = (out[s.item] ?? 0) + s.count;
  return out;
}

/** How many of `item` would fit. */
export function roomFor(slots: Slots, item: ItemId, firstSlot = 0): number {
  const max = ITEMS[item].stack;
  let room = 0;
  for (let i = firstSlot; i < slots.length; i++) {
    const s = slots[i];
    if (!s) room += max;
    else if (s.item === item && max > 1) room += max - s.count;
  }
  return room;
}

/**
 * Adds items, topping up existing stacks first, then filling empty slots (belt first for
 * tools, backpack first for resources). Returns how many did not fit.
 */
export function addItem(slots: Slots, item: ItemId, count: number, hp?: number): number {
  const info = ITEMS[item];
  if (info.stack > 1) {
    for (const s of slots) {
      if (count <= 0) break;
      if (s?.item === item && s.count < info.stack) {
        const n = Math.min(count, info.stack - s.count);
        s.count += n;
        count -= n;
      }
    }
  }
  const order = [...slots.keys()];
  if (info.kind === 'resource') order.push(...order.splice(0, BELT_SIZE));
  for (const i of order) {
    if (count <= 0) break;
    if (slots[i]) continue;
    const n = Math.min(count, info.stack);
    slots[i] = { ...newStack(item, n), ...(hp !== undefined ? { hp } : {}) };
    count -= n;
  }
  return count;
}

/** Removes items from the last stacks first. Returns false (changing nothing) if there are not enough. */
export function removeItem(slots: Slots, item: ItemId, count: number): boolean {
  if (countItem(slots, item) < count) return false;
  for (let i = slots.length - 1; i >= 0 && count > 0; i--) {
    const s = slots[i];
    if (s?.item !== item) continue;
    const n = Math.min(count, s.count);
    s.count -= n;
    count -= n;
    if (s.count === 0) slots[i] = null;
  }
  return true;
}

export interface Recipe {
  item: ItemId;
  count: number;
  cost: Partial<Record<ItemId, number>>;
  /** Seconds to craft one. */
  time: number;
  /** Needs a workbench within reach. */
  workbench?: boolean;
  category: 'Tools' | 'Construction' | 'Items';
}

export const RECIPES: Recipe[] = [
  { item: 'rock', count: 1, cost: { stone: 10 }, time: 1, category: 'Tools' },
  { item: 'stoneHatchet', count: 1, cost: { wood: 60, stone: 30 }, time: 4, category: 'Tools' },
  { item: 'stonePickaxe', count: 1, cost: { wood: 60, stone: 40 }, time: 4, category: 'Tools' },
  { item: 'salvagedAxe', count: 1, cost: { wood: 100, metal: 75, scrap: 25 }, time: 8, workbench: true, category: 'Tools' },
  { item: 'salvagedPickaxe', count: 1, cost: { wood: 100, metal: 75, scrap: 25 }, time: 8, workbench: true, category: 'Tools' },
  { item: 'buildingPlan', count: 1, cost: { wood: 20 }, time: 2, category: 'Construction' },
  { item: 'storageBox', count: 1, cost: { wood: 100 }, time: 4, category: 'Construction' },
  { item: 'furnace', count: 1, cost: { stone: 150, wood: 50, cloth: 10 }, time: 6, category: 'Construction' },
  { item: 'workbench', count: 1, cost: { wood: 250, metal: 50, scrap: 50 }, time: 10, category: 'Construction' },
];

export function recipeFor(item: ItemId): Recipe | undefined {
  return RECIPES.find((r) => r.item === item);
}

export function canAfford(slots: Slots, recipe: Recipe, times = 1): boolean {
  return Object.entries(recipe.cost).every(([item, n]) => countItem(slots, item as ItemId) >= n! * times);
}
