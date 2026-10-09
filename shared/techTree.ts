// The tech tree, modelled on Rust's: anything that needs a workbench to craft must first be
// learned at one, by spending scrap. Each workbench level has its own tree of branches, and
// each step along a branch needs the one before it. What a survivor has learned stays through
// death and is wiped with the world.

import { ITEMS, recipeFor, type ItemId } from './items.ts';

export interface TechBranch {
  level: 1 | 2 | 3;
  name: string;
  /** Each step and its cost in scrap, in the order they unlock. */
  steps: [ItemId, number][];
}

export const TECH_BRANCHES: TechBranch[] = [
  { level: 1, name: 'Tools', steps: [['salvagedAxe', 30], ['salvagedPickaxe', 30]] },
  { level: 1, name: 'Blades', steps: [['machete', 20], ['nailBat', 25], ['salvagedSword', 35], ['combatKnife', 40]] },
  { level: 1, name: 'Doors', steps: [['metalDoor', 40], ['codeLock', 50]] },
  { level: 1, name: 'Early guns', steps: [['crossbow', 40], ['waterpipe', 60], ['revolver', 75], ['doubleBarrel', 100]] },
  { level: 1, name: 'Ammo', steps: [['pistolAmmo', 30], ['shotgunShell', 30]] },
  { level: 1, name: 'Explosives', steps: [['beancan', 60], ['satchel', 90]] },
  { level: 1, name: 'Armour', steps: [['coffeeCanHelmet', 30], ['roadsignKilt', 40], ['roadsignJacket', 60]] },
  { level: 1, name: 'Medical', steps: [['syringe', 40]] },

  { level: 2, name: 'Pistols and SMGs', steps: [['semiPistol', 125], ['m1911', 150], ['customSmg', 200], ['ump45', 250]] },
  { level: 2, name: 'Shotguns and rifles', steps: [['pumpShotgun', 175], ['thompson', 200], ['semiRifle', 250]] },
  { level: 2, name: 'Ammo and explosives', steps: [['rifleAmmo', 75], ['explosives', 300]] },
  { level: 2, name: 'Heavy melee', steps: [['fireAxe', 100], ['sledgehammer', 150]] },
  { level: 2, name: 'Bows', steps: [['compoundBow', 150]] },
  { level: 2, name: 'Metal armour', steps: [['metalFacemask', 150], ['metalChestplate', 200], ['metalLegPlates', 200]] },

  { level: 3, name: 'SMGs', steps: [['mp5', 300], ['vector', 400], ['p90', 450]] },
  { level: 3, name: 'Assault rifles', steps: [['assaultRifle', 500], ['lr300', 500], ['m4', 550], ['aug', 600], ['hk416', 650], ['scarH', 700]] },
  { level: 3, name: 'Marksman rifles', steps: [['boltRifle', 500], ['m14', 600], ['svd', 650], ['l96', 750], ['m82', 900]] },
  { level: 3, name: 'Shotguns', steps: [['spas12', 400], ['saiga12', 500]] },
  { level: 3, name: 'Pistols', steps: [['deagle', 400]] },
  { level: 3, name: 'Heavy guns', steps: [['m249', 750], ['m60', 850]] },
  { level: 3, name: 'Explosives', steps: [['c4', 750]] },
];

export interface TechNode {
  item: ItemId;
  level: 1 | 2 | 3;
  scrap: number;
  /** The step that must be learned first, if any. */
  after?: ItemId;
}

export const TECH: ReadonlyMap<ItemId, TechNode> = new Map(
  TECH_BRANCHES.flatMap((b) => b.steps.map(([item, scrap], i) => [item, { item, level: b.level, scrap, ...(i > 0 && { after: b.steps[i - 1][0] }) }] as const)),
);

/** Whether crafting this item needs it learned first. Workbenches themselves never do. */
export function needsLearning(item: ItemId): boolean {
  return TECH.has(item);
}

/**
 * Why this item can't be learned right now, or null if it can: what is in the way out of the
 * workbench in reach, the step before it, and the scrap to pay.
 */
export function learnBlock(item: ItemId, learned: ReadonlySet<ItemId>, bench: number, scrap: number): string | null {
  const node = TECH.get(item);
  if (!node) return recipeFor(item) ? 'You already know how to make that' : 'That cannot be learned';
  if (learned.has(item)) return 'You already know how to make that';
  if (bench < node.level) return `Stand near a level ${node.level} workbench to learn this`;
  if (node.after && !learned.has(node.after)) return `Learn the ${ITEMS[node.after].name} first`;
  if (scrap < node.scrap) return `You need ${node.scrap} scrap to learn this`;
  return null;
}
