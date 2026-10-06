// Items, inventories and crafting recipes, modelled on Rust: resources stack up in slots,
// tools gather faster and wear out, and better gear needs a workbench and smelted metal.
// Shared so the client shows exactly what the server will allow.

export type ItemId =
  // Resources
  | 'wood'
  | 'stone'
  | 'scrap'
  | 'metalOre'
  | 'metal'
  | 'sulfurOre'
  | 'sulfur'
  | 'hqmOre'
  | 'hqm'
  | 'charcoal'
  | 'gunpowder'
  | 'cloth'
  // Tools
  | 'rock'
  | 'buildingPlan'
  | 'stoneHatchet'
  | 'stonePickaxe'
  | 'salvagedAxe'
  | 'salvagedPickaxe'
  // Deployables
  | 'workbench'
  | 'workbench2'
  | 'workbench3'
  | 'furnace'
  | 'storageBox'
  // Melee weapons
  | 'woodenSpear'
  | 'stoneSpear'
  | 'machete'
  | 'salvagedSword'
  // Bows and guns
  | 'huntingBow'
  | 'crossbow'
  | 'eoka'
  | 'waterpipe'
  | 'revolver'
  | 'doubleBarrel'
  | 'semiPistol'
  | 'pumpShotgun'
  | 'thompson'
  | 'customSmg'
  | 'semiRifle'
  | 'mp5'
  | 'assaultRifle'
  | 'lr300'
  | 'boltRifle'
  | 'l96'
  | 'm249'
  // Ammo
  | 'arrow'
  | 'handmadeShell'
  | 'shotgunShell'
  | 'pistolAmmo'
  | 'rifleAmmo'
  // Medical
  | 'bandage'
  | 'syringe'
  | 'antiRadPills'
  | 'mushroom'
  | 'cannedBeans'
  | 'bottledWater'
  // Armour
  | 'burlapHeadwrap'
  | 'burlapShirt'
  | 'burlapTrousers'
  | 'coffeeCanHelmet'
  | 'roadsignJacket'
  | 'roadsignKilt'
  | 'metalFacemask'
  | 'metalChestplate'
  | 'metalLegPlates';

/** What a tool is good at: multipliers on the base amount per hit, for each kind of node. */
export interface ToolInfo {
  wood: number;
  stone: number;
  scrap: number;
  /** Hits before it breaks. */
  durability: number;
}

/**
 * How a weapon fights. Melee weapons (and tools, swung at people) hit what is in front of
 * them within `range`. Bows and guns fire `pellets` rays, spread by up to `spread` radians,
 * from a magazine of `mag` rounds of `ammo`.
 */
export interface WeaponInfo {
  class: 'melee' | 'bow' | 'gun';
  /** Damage per hit (per pellet for shotguns), before falloff and headshots. */
  damage: number;
  /** Seconds between attacks. */
  delay: number;
  /** Metres. Guns lose up to half their damage between half range and full range. */
  range: number;
  /** Fires while the button is held. */
  auto?: boolean;
  ammo?: ItemId;
  mag?: number;
  /** Seconds to reload. */
  reload?: number;
  /** Hip-fire cone half-angle in radians; halved when aiming, larger when moving. */
  spread?: number;
  pellets?: number;
  /** How far the view kicks up per shot, in radians. */
  recoil?: number;
  /** Shots or swings before it breaks (tools use their tool durability). */
  durability?: number;
}

/** Where armour is worn, and the part of the body it covers. */
export type ArmourSlot = 'head' | 'chest' | 'legs';
/** The three clothing slots, in order: slot 0 is the head, 1 the chest, 2 the legs. */
export const ARMOUR_SLOTS: ArmourSlot[] = ['head', 'chest', 'legs'];

/** Worn armour: which slot it goes in and how much of each hit on that part it stops. */
export interface ArmourInfo {
  slot: ArmourSlot;
  /** Fraction of damage blocked on hits to the part it covers, 0 to 1. */
  protection: number;
  /** Hits it absorbs before it falls apart. */
  durability: number;
  /** Fraction of radiation it keeps out, 0 to 1; pieces add up. */
  radiation: number;
}

/** What eating, drinking or swallowing something does: food and water gained, radiation removed. */
export interface ConsumeInfo {
  food?: number;
  water?: number;
  /** Radiation poisoning removed. */
  rads?: number;
}

export interface ItemInfo {
  name: string;
  kind: 'resource' | 'tool' | 'plan' | 'deployable' | 'weapon' | 'ammo' | 'medical' | 'armour' | 'food';
  stack: number;
  description: string;
  tool?: ToolInfo;
  weapon?: WeaponInfo;
  /** Medical items: health restored. */
  heal?: number;
  armour?: ArmourInfo;
  /** Food, drink and anti-rad pills. */
  consume?: ConsumeInfo;
}

const res = (name: string, description: string): ItemInfo => ({ name, kind: 'resource', stack: 1000, description });
const melee = (name: string, description: string, damage: number, delay: number, range: number, durability: number): ItemInfo => ({
  name,
  kind: 'weapon',
  stack: 1,
  description,
  weapon: { class: 'melee', damage, delay, range, durability },
});
const armour = (name: string, description: string, slot: ArmourSlot, protection: number, durability: number, radiation: number): ItemInfo => ({
  name,
  kind: 'armour',
  stack: 1,
  description,
  armour: { slot, protection, durability, radiation },
});
const gun = (name: string, description: string, weapon: Omit<WeaponInfo, 'class'> & { class?: 'bow' }): ItemInfo => ({
  name,
  kind: 'weapon',
  stack: 1,
  description,
  weapon: { class: 'gun', ...weapon },
});

export const ITEMS: Record<ItemId, ItemInfo> = {
  wood: res('Wood', 'Chopped from trees. Builds, crafts and fuels furnaces, leaving charcoal.'),
  stone: res('Stone', 'Mined from boulders. Stronger walls and stone tools.'),
  scrap: res('Scrap', 'Salvaged from wrecks. Toughest walls and advanced gear.'),
  metalOre: res('Metal Ore', 'Mined from rust-veined rocks. Smelt it in a furnace.'),
  metal: res('Metal Fragments', 'Smelted from metal ore. Salvaged tools, workbenches and guns.'),
  sulfurOre: res('Sulfur Ore', 'Mined from yellow-crusted rocks. Smelt it into sulfur.'),
  sulfur: res('Sulfur', 'Mix it with charcoal to make gunpowder.'),
  hqmOre: res('High Quality Metal Ore', 'Mined from rare blue-grey rocks. Smelts slowly.'),
  hqm: res('High Quality Metal', 'Needed for the better guns and workbench levels 2 and 3.'),
  charcoal: res('Charcoal', 'Left over when a furnace burns wood.'),
  gunpowder: res('Gunpowder', 'Made from charcoal and sulfur. Every bullet needs some.'),
  cloth: res('Cloth', 'Picked from hemp plants.'),
  rock: {
    name: 'Rock',
    kind: 'tool',
    stack: 1,
    description: 'Every survivor starts with one. Slowly chips wood, stone and scrap.',
    tool: { wood: 1, stone: 1, scrap: 1, durability: 400 },
    weapon: { class: 'melee', damage: 10, delay: 0.7, range: 2.2 },
  },
  buildingPlan: { name: 'Building Plan', kind: 'plan', stack: 1, description: 'Hold it to build walls, floors and stairs.' },
  stoneHatchet: {
    name: 'Stone Hatchet',
    kind: 'tool',
    stack: 1,
    description: 'Twice as fast at chopping wood.',
    tool: { wood: 2, stone: 0.5, scrap: 0.75, durability: 250 },
    weapon: { class: 'melee', damage: 16, delay: 0.7, range: 2.3 },
  },
  stonePickaxe: {
    name: 'Stone Pickaxe',
    kind: 'tool',
    stack: 1,
    description: 'Twice as fast at mining stone and ore.',
    tool: { wood: 0.5, stone: 2, scrap: 0.75, durability: 250 },
    weapon: { class: 'melee', damage: 16, delay: 0.8, range: 2.3 },
  },
  salvagedAxe: {
    name: 'Salvaged Axe',
    kind: 'tool',
    stack: 1,
    description: 'A sawblade on a pipe. Chops wood very fast.',
    tool: { wood: 3.5, stone: 0.5, scrap: 1.25, durability: 500 },
    weapon: { class: 'melee', damage: 25, delay: 0.75, range: 2.4 },
  },
  salvagedPickaxe: {
    name: 'Salvaged Pickaxe',
    kind: 'tool',
    stack: 1,
    description: 'Mines stone and ore very fast.',
    tool: { wood: 0.5, stone: 3.5, scrap: 1.25, durability: 500 },
    weapon: { class: 'melee', damage: 25, delay: 0.8, range: 2.4 },
  },
  workbench: { name: 'Workbench Level 1', kind: 'deployable', stack: 1, description: 'Stand near it to craft salvaged tools and the first guns.' },
  workbench2: { name: 'Workbench Level 2', kind: 'deployable', stack: 1, description: 'Unlocks pistols, SMGs, the pump shotgun and the semi-auto rifle.' },
  workbench3: { name: 'Workbench Level 3', kind: 'deployable', stack: 1, description: 'Unlocks the assault rifles, sniper rifles and the M249.' },
  furnace: { name: 'Furnace', kind: 'deployable', stack: 1, description: 'Burns wood to smelt metal, sulfur and high quality ore.' },
  storageBox: { name: 'Storage Box', kind: 'deployable', stack: 1, description: 'Holds 12 stacks of items.' },

  woodenSpear: melee('Wooden Spear', 'A sharpened stick with a long reach.', 30, 0.9, 3, 120),
  stoneSpear: melee('Stone Spear', 'A wooden spear with a stone tip. Hits harder.', 40, 0.9, 3, 160),
  machete: melee('Machete', 'Quick, light blade beaten from scrap metal.', 35, 0.55, 2.4, 200),
  salvagedSword: melee('Salvaged Sword', 'A heavy blade cut from a car leaf spring.', 50, 0.85, 2.6, 250),

  huntingBow: gun('Hunting Bow', 'Quiet and cheap. Fires wooden arrows.', {
    class: 'bow', damage: 50, delay: 0.9, range: 60, ammo: 'arrow', mag: 1, reload: 0.6, spread: 0.012, recoil: 0.01, durability: 150,
  }),
  crossbow: gun('Crossbow', 'Slow to load, but each bolt hits hard.', {
    class: 'bow', damage: 70, delay: 1, range: 80, ammo: 'arrow', mag: 1, reload: 3, spread: 0.006, recoil: 0.02, durability: 150,
  }),
  eoka: gun('Eoka Pistol', 'A pipe and a flint. Sometimes it even fires. Shotgun spread.', {
    damage: 9, delay: 1, range: 20, ammo: 'handmadeShell', mag: 1, reload: 2, spread: 0.07, pellets: 10, recoil: 0.06, durability: 60,
  }),
  waterpipe: gun('Waterpipe Shotgun', 'A single shell in a pipe. Brutal up close.', {
    damage: 10, delay: 1, range: 25, ammo: 'handmadeShell', mag: 1, reload: 3, spread: 0.06, pellets: 12, recoil: 0.07, durability: 100,
  }),
  revolver: gun('Revolver', 'Eight shots. The first real gun most survivors get.', {
    damage: 35, delay: 0.2, range: 60, ammo: 'pistolAmmo', mag: 8, reload: 3, spread: 0.015, recoil: 0.025, durability: 300,
  }),
  doubleBarrel: gun('Double Barrel Shotgun', 'Two barrels, two chances. Devastating at close range.', {
    damage: 12, delay: 0.3, range: 30, ammo: 'shotgunShell', mag: 2, reload: 4, spread: 0.055, pellets: 12, recoil: 0.08, durability: 200,
  }),
  semiPistol: gun('Semi-Automatic Pistol', 'Ten fast, accurate shots.', {
    damage: 40, delay: 0.15, range: 70, ammo: 'pistolAmmo', mag: 10, reload: 2.2, spread: 0.012, recoil: 0.025, durability: 400,
  }),
  pumpShotgun: gun('Pump Shotgun', 'Six shells and a slow pump.', {
    damage: 14, delay: 0.9, range: 35, ammo: 'shotgunShell', mag: 6, reload: 5, spread: 0.05, pellets: 12, recoil: 0.07, durability: 400,
  }),
  thompson: gun('Thompson', 'A classic drum-fed SMG. Steady at mid range.', {
    damage: 37, delay: 0.13, range: 70, auto: true, ammo: 'pistolAmmo', mag: 20, reload: 4, spread: 0.02, recoil: 0.018, durability: 600,
  }),
  customSmg: gun('Custom SMG', 'Welded from scrap. Fast and light.', {
    damage: 30, delay: 0.1, range: 60, auto: true, ammo: 'pistolAmmo', mag: 24, reload: 4, spread: 0.024, recoil: 0.016, durability: 500,
  }),
  semiRifle: gun('Semi-Automatic Rifle', 'Accurate rifle rounds, one shot per click.', {
    damage: 40, delay: 0.18, range: 150, ammo: 'rifleAmmo', mag: 16, reload: 4, spread: 0.01, recoil: 0.03, durability: 600,
  }),
  mp5: gun('MP5A4', 'A military SMG with a fast, controllable burst of fire.', {
    damage: 35, delay: 0.1, range: 80, auto: true, ammo: 'pistolAmmo', mag: 30, reload: 4, spread: 0.016, recoil: 0.014, durability: 800,
  }),
  assaultRifle: gun('Assault Rifle', 'The wasteland king. Thirty heavy rounds, hard to control.', {
    damage: 50, delay: 0.133, range: 180, auto: true, ammo: 'rifleAmmo', mag: 30, reload: 4.4, spread: 0.018, recoil: 0.03, durability: 1000,
  }),
  lr300: gun('LR-300 Assault Rifle', 'Lighter hits than the assault rifle but much steadier.', {
    damage: 40, delay: 0.12, range: 180, auto: true, ammo: 'rifleAmmo', mag: 30, reload: 4, spread: 0.012, recoil: 0.018, durability: 1000,
  }),
  boltRifle: gun('Bolt Action Rifle', 'A scoped rifle. One heavy, precise shot at a time.', {
    damage: 80, delay: 1.7, range: 300, ammo: 'rifleAmmo', mag: 4, reload: 4.5, spread: 0.002, recoil: 0.06, durability: 400,
  }),
  l96: gun('L96 Rifle', 'The longest reach in the wasteland. Headshots end fights.', {
    damage: 100, delay: 2.6, range: 400, ammo: 'rifleAmmo', mag: 5, reload: 5, spread: 0.001, recoil: 0.07, durability: 400,
  }),
  m249: gun('M249', 'A belt-fed machine gun with a hundred-round box.', {
    damage: 45, delay: 0.12, range: 160, auto: true, ammo: 'rifleAmmo', mag: 100, reload: 7, spread: 0.025, recoil: 0.02, durability: 2000,
  }),

  arrow: { name: 'Wooden Arrow', kind: 'ammo', stack: 64, description: 'For the hunting bow and crossbow.' },
  handmadeShell: { name: 'Handmade Shell', kind: 'ammo', stack: 64, description: 'Stones and gunpowder in a paper tube. For the Eoka and waterpipe.' },
  shotgunShell: { name: '12 Gauge Buckshot', kind: 'ammo', stack: 64, description: 'For the double barrel and pump shotguns.' },
  pistolAmmo: { name: 'Pistol Bullet', kind: 'ammo', stack: 128, description: 'For pistols, the Thompson and the SMGs.' },
  rifleAmmo: { name: '5.56 Rifle Ammo', kind: 'ammo', stack: 128, description: 'For every rifle and the M249.' },

  bandage: { name: 'Bandage', kind: 'medical', stack: 3, heal: 15, description: 'Heals 15 health. Left click to use.' },
  syringe: { name: 'Medical Syringe', kind: 'medical', stack: 2, heal: 35, description: 'Heals 35 health. Left click to use.' },

  burlapHeadwrap: armour('Burlap Headwrap', 'Sacking wound round the head. Keeps some fallout off your face.', 'head', 0.1, 60, 0.12),
  burlapShirt: armour('Burlap Shirt', 'A rough cloth shirt that takes the sting off a hit and keeps some fallout off.', 'chest', 0.1, 60, 0.12),
  burlapTrousers: armour('Burlap Trousers', 'Rough cloth trousers, padded at the knees.', 'legs', 0.1, 60, 0.12),
  coffeeCanHelmet: armour('Coffee Can Helmet', 'A dented can with a leather strap. Turns a few bullets.', 'head', 0.3, 120, 0.05),
  roadsignJacket: armour('Road Sign Jacket', 'Road signs riveted to a jacket. Heavy, loud and it works.', 'chest', 0.3, 120, 0.05),
  roadsignKilt: armour('Road Sign Kilt', 'Hammered road signs hung from a belt to guard the legs.', 'legs', 0.3, 120, 0.05),
  metalFacemask: armour('Metal Facemask', 'A welded steel face plate. Headshots stop being lucky.', 'head', 0.5, 200, 0.06),
  metalChestplate: armour('Metal Chest Plate', 'Thick steel front and back. The best a survivor can wear.', 'chest', 0.5, 200, 0.06),
  metalLegPlates: armour('Metal Leg Plates', 'Steel plates strapped over the thighs and shins.', 'legs', 0.45, 200, 0.06),

  antiRadPills: { name: 'Anti-Radiation Pills', kind: 'medical', stack: 10, consume: { rads: 40 }, description: 'Flushes out 40 radiation. Left click to take.' },
  mushroom: { name: 'Mushroom', kind: 'food', stack: 20, consume: { food: 10, water: 3 }, description: 'Grows in the shade of ruins. Chewy, but it is food. Left click to eat.' },
  cannedBeans: { name: 'Can of Beans', kind: 'food', stack: 10, consume: { food: 40, water: 5 }, description: 'Still sealed. Found in the glove boxes of old wrecks. Left click to eat.' },
  bottledWater: { name: 'Bottled Water', kind: 'food', stack: 10, consume: { water: 35 }, description: 'Clean water from before the bombs. Found in old wrecks. Left click to drink.' },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export interface Stack {
  item: ItemId;
  count: number;
  /** Remaining durability, for tools and weapons. */
  hp?: number;
  /** Rounds loaded, for bows and guns. */
  ammo?: number;
}

export type Slots = (Stack | null)[];

/** Slots 0-5 are the belt (hotbar), the rest the backpack. */
export const BELT_SIZE = 6;
export const INVENTORY_SIZE = 30;

export function emptySlots(n: number): Slots {
  return Array.from({ length: n }, () => null);
}

export function newStack(item: ItemId, count = 1): Stack {
  const durability = maxDurability(item);
  const weapon = ITEMS[item].weapon;
  const stack: Stack = { item, count };
  if (durability) stack.hp = durability;
  if (weapon?.mag) stack.ammo = 0;
  return stack;
}

/** Uses before an item breaks, or 0 if it never does. */
export function maxDurability(item: ItemId): number {
  const info = ITEMS[item];
  return info.tool?.durability ?? info.weapon?.durability ?? info.armour?.durability ?? 0;
}

/** Whether an item can be worn in clothing slot `i` (0 head, 1 chest, 2 legs). */
export function fitsArmourSlot(item: ItemId, i: number): boolean {
  const a = ITEMS[item].armour;
  return !!a && ARMOUR_SLOTS[i] === a.slot;
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
  if (info.kind === 'resource' || info.kind === 'ammo') order.push(...order.splice(0, BELT_SIZE));
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
  /** Needs a workbench of at least this level within reach. */
  workbench?: 1 | 2 | 3;
  category: RecipeCategory;
}

export type RecipeCategory = 'Tools' | 'Construction' | 'Weapons' | 'Ammo' | 'Armour' | 'Medical' | 'Resources';
export const RECIPE_CATEGORIES: RecipeCategory[] = ['Tools', 'Construction', 'Weapons', 'Ammo', 'Armour', 'Medical', 'Resources'];

export const RECIPES: Recipe[] = [
  { item: 'rock', count: 1, cost: { stone: 10 }, time: 1, category: 'Tools' },
  { item: 'stoneHatchet', count: 1, cost: { wood: 60, stone: 30 }, time: 4, category: 'Tools' },
  { item: 'stonePickaxe', count: 1, cost: { wood: 60, stone: 40 }, time: 4, category: 'Tools' },
  { item: 'salvagedAxe', count: 1, cost: { wood: 100, metal: 75, scrap: 25 }, time: 8, workbench: 1, category: 'Tools' },
  { item: 'salvagedPickaxe', count: 1, cost: { wood: 100, metal: 75, scrap: 25 }, time: 8, workbench: 1, category: 'Tools' },

  { item: 'buildingPlan', count: 1, cost: { wood: 20 }, time: 2, category: 'Construction' },
  { item: 'storageBox', count: 1, cost: { wood: 100 }, time: 4, category: 'Construction' },
  { item: 'furnace', count: 1, cost: { stone: 150, wood: 50, cloth: 10 }, time: 6, category: 'Construction' },
  { item: 'workbench', count: 1, cost: { wood: 250, metal: 50, scrap: 50 }, time: 10, category: 'Construction' },
  { item: 'workbench2', count: 1, cost: { metal: 500, hqm: 20, scrap: 200 }, time: 15, workbench: 1, category: 'Construction' },
  { item: 'workbench3', count: 1, cost: { metal: 1000, hqm: 100, scrap: 500 }, time: 20, workbench: 2, category: 'Construction' },

  { item: 'woodenSpear', count: 1, cost: { wood: 300 }, time: 5, category: 'Weapons' },
  { item: 'stoneSpear', count: 1, cost: { woodenSpear: 1, stone: 20 }, time: 3, category: 'Weapons' },
  { item: 'huntingBow', count: 1, cost: { wood: 200, cloth: 50 }, time: 6, category: 'Weapons' },
  { item: 'eoka', count: 1, cost: { wood: 75, metal: 30 }, time: 5, category: 'Weapons' },
  { item: 'machete', count: 1, cost: { metal: 40, wood: 20 }, time: 5, workbench: 1, category: 'Weapons' },
  { item: 'salvagedSword', count: 1, cost: { metal: 60, scrap: 20, wood: 20 }, time: 6, workbench: 1, category: 'Weapons' },
  { item: 'crossbow', count: 1, cost: { wood: 200, metal: 75, cloth: 20 }, time: 8, workbench: 1, category: 'Weapons' },
  { item: 'waterpipe', count: 1, cost: { wood: 150, metal: 75, scrap: 20 }, time: 8, workbench: 1, category: 'Weapons' },
  { item: 'revolver', count: 1, cost: { metal: 125, cloth: 30, scrap: 30 }, time: 10, workbench: 1, category: 'Weapons' },
  { item: 'doubleBarrel', count: 1, cost: { metal: 175, wood: 50, scrap: 40 }, time: 12, workbench: 1, category: 'Weapons' },
  { item: 'semiPistol', count: 1, cost: { metal: 150, hqm: 4, scrap: 40 }, time: 12, workbench: 2, category: 'Weapons' },
  { item: 'pumpShotgun', count: 1, cost: { metal: 200, hqm: 10, wood: 50 }, time: 15, workbench: 2, category: 'Weapons' },
  { item: 'customSmg', count: 1, cost: { metal: 175, hqm: 8, scrap: 60 }, time: 15, workbench: 2, category: 'Weapons' },
  { item: 'thompson', count: 1, cost: { metal: 200, hqm: 10, wood: 100 }, time: 15, workbench: 2, category: 'Weapons' },
  { item: 'semiRifle', count: 1, cost: { metal: 250, hqm: 15, scrap: 60 }, time: 18, workbench: 2, category: 'Weapons' },
  { item: 'mp5', count: 1, cost: { metal: 250, hqm: 20, scrap: 100 }, time: 20, workbench: 3, category: 'Weapons' },
  { item: 'lr300', count: 1, cost: { metal: 300, hqm: 45, scrap: 120 }, time: 25, workbench: 3, category: 'Weapons' },
  { item: 'assaultRifle', count: 1, cost: { metal: 300, hqm: 50, wood: 200 }, time: 25, workbench: 3, category: 'Weapons' },
  { item: 'boltRifle', count: 1, cost: { metal: 300, hqm: 40, wood: 100 }, time: 25, workbench: 3, category: 'Weapons' },
  { item: 'l96', count: 1, cost: { metal: 500, hqm: 75, scrap: 200 }, time: 30, workbench: 3, category: 'Weapons' },
  { item: 'm249', count: 1, cost: { metal: 500, hqm: 80, scrap: 250 }, time: 30, workbench: 3, category: 'Weapons' },

  { item: 'arrow', count: 2, cost: { wood: 25, stone: 10 }, time: 1, category: 'Ammo' },
  { item: 'handmadeShell', count: 2, cost: { stone: 5, gunpowder: 5 }, time: 1, category: 'Ammo' },
  { item: 'shotgunShell', count: 2, cost: { metal: 5, gunpowder: 10 }, time: 2, workbench: 1, category: 'Ammo' },
  { item: 'pistolAmmo', count: 4, cost: { metal: 10, gunpowder: 5 }, time: 2, workbench: 1, category: 'Ammo' },
  { item: 'rifleAmmo', count: 3, cost: { metal: 10, gunpowder: 5 }, time: 2, workbench: 2, category: 'Ammo' },

  { item: 'burlapHeadwrap', count: 1, cost: { cloth: 10 }, time: 3, category: 'Armour' },
  { item: 'burlapShirt', count: 1, cost: { cloth: 15 }, time: 3, category: 'Armour' },
  { item: 'burlapTrousers', count: 1, cost: { cloth: 15 }, time: 3, category: 'Armour' },
  { item: 'coffeeCanHelmet', count: 1, cost: { metal: 40, cloth: 10, scrap: 10 }, time: 6, workbench: 1, category: 'Armour' },
  { item: 'roadsignJacket', count: 1, cost: { metal: 80, cloth: 20, scrap: 30 }, time: 8, workbench: 1, category: 'Armour' },
  { item: 'roadsignKilt', count: 1, cost: { metal: 60, cloth: 15, scrap: 20 }, time: 8, workbench: 1, category: 'Armour' },
  { item: 'metalFacemask', count: 1, cost: { hqm: 15, metal: 50, cloth: 10 }, time: 12, workbench: 2, category: 'Armour' },
  { item: 'metalChestplate', count: 1, cost: { hqm: 25, metal: 100, cloth: 20 }, time: 15, workbench: 2, category: 'Armour' },
  { item: 'metalLegPlates', count: 1, cost: { hqm: 20, metal: 80, cloth: 15 }, time: 15, workbench: 2, category: 'Armour' },

  { item: 'bandage', count: 1, cost: { cloth: 4 }, time: 2, category: 'Medical' },
  { item: 'syringe', count: 1, cost: { cloth: 15, metal: 10 }, time: 4, workbench: 1, category: 'Medical' },
  { item: 'antiRadPills', count: 1, cost: { charcoal: 15, mushroom: 2 }, time: 3, category: 'Medical' },

  { item: 'gunpowder', count: 10, cost: { charcoal: 30, sulfur: 20 }, time: 3, category: 'Resources' },
];

export function recipeFor(item: ItemId): Recipe | undefined {
  return RECIPES.find((r) => r.item === item);
}

export function canAfford(slots: Slots, recipe: Recipe, times = 1): boolean {
  return Object.entries(recipe.cost).every(([item, n]) => countItem(slots, item as ItemId) >= n! * times);
}
