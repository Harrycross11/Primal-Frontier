// What turns up in crates: wooden crates at every landmark hold the basics, military crates
// better guns and ammo, and supply drops from the plane the best gear in the game. Each land
// adds a share of what it is known for. Shared so tests and the client agree on the tables.

import type { BiomeId } from './biomes.ts';
import { newStack, type ItemId, type Stack } from './items.ts';

export type LootKind = 'crate' | 'militaryCrate' | 'supplyDrop';

/** One thing a crate can hold: how many, and how likely it is next to the rest. */
interface Roll {
  item: ItemId;
  min: number;
  max: number;
  weight: number;
}

const r = (item: ItemId, min: number, max: number, weight: number): Roll => ({ item, min, max, weight });

export const LOOT: Record<LootKind, { rolls: [number, number]; table: Roll[] }> = {
  crate: {
    rolls: [3, 4],
    table: [
      r('scrap', 10, 25, 3),
      r('metal', 20, 50, 2),
      r('cloth', 10, 20, 2),
      r('gunpowder', 10, 30, 1),
      r('lowGradeFuel', 10, 30, 1.5),
      r('pistolAmmo', 8, 20, 2),
      r('handmadeShell', 8, 16, 1),
      r('shotgunShell', 4, 10, 1),
      r('arrow', 6, 12, 1),
      r('bandage', 1, 3, 2),
      r('cannedBeans', 1, 2, 1.5),
      r('bottledWater', 1, 1, 1.5),
      r('antiRadPills', 1, 2, 0.8),
      r('cornSeed', 2, 4, 1.2),
      r('pumpkinSeed', 1, 3, 1),
      r('hempSeed', 2, 4, 0.8),
      r('revolver', 1, 1, 0.6),
      r('eoka', 1, 1, 0.6),
      r('waterpipe', 1, 1, 0.5),
      r('doubleBarrel', 1, 1, 0.4),
      r('machete', 1, 1, 0.5),
      r('salvagedAxe', 1, 1, 0.4),
      r('salvagedPickaxe', 1, 1, 0.4),
      r('burlapHeadwrap', 1, 1, 0.4),
      r('burlapShirt', 1, 1, 0.4),
      r('burlapTrousers', 1, 1, 0.4),
      r('coffeeCanHelmet', 1, 1, 0.3),
      r('roadsignJacket', 1, 1, 0.2),
      r('roadsignKilt', 1, 1, 0.2),
    ],
  },
  militaryCrate: {
    rolls: [3, 5],
    table: [
      r('rifleAmmo', 20, 60, 3),
      r('pistolAmmo', 20, 40, 2),
      r('shotgunShell', 8, 16, 1.5),
      r('syringe', 1, 2, 2),
      r('hqm', 5, 15, 2),
      r('metal', 50, 100, 1.5),
      r('gunpowder', 30, 80, 1.5),
      r('lowGradeFuel', 20, 50, 1),
      r('beancan', 1, 2, 1),
      r('explosives', 1, 2, 0.4),
      r('antiRadPills', 1, 3, 1),
      r('supplySignal', 1, 1, 0.6),
      r('semiPistol', 1, 1, 0.5),
      r('m1911', 1, 1, 0.5),
      r('pumpShotgun', 1, 1, 0.5),
      r('thompson', 1, 1, 0.5),
      r('customSmg', 1, 1, 0.5),
      r('mp5', 1, 1, 0.4),
      r('semiRifle', 1, 1, 0.5),
      r('assaultRifle', 1, 1, 0.2),
      r('boltRifle', 1, 1, 0.2),
      r('roadsignJacket', 1, 1, 0.6),
      r('roadsignKilt', 1, 1, 0.6),
      r('metalFacemask', 1, 1, 0.3),
      r('metalChestplate', 1, 1, 0.25),
      r('metalLegPlates', 1, 1, 0.3),
    ],
  },
  supplyDrop: {
    rolls: [5, 6],
    table: [
      r('rifleAmmo', 60, 120, 3),
      r('syringe', 2, 4, 2),
      r('explosives', 2, 5, 1),
      r('c4', 1, 1, 0.4),
      r('satchel', 1, 2, 0.8),
      r('hqm', 20, 40, 1),
      r('assaultRifle', 1, 1, 0.8),
      r('lr300', 1, 1, 0.8),
      r('m4', 1, 1, 0.6),
      r('hk416', 1, 1, 0.5),
      r('aug', 1, 1, 0.5),
      r('scarH', 1, 1, 0.4),
      r('m14', 1, 1, 0.5),
      r('svd', 1, 1, 0.4),
      r('l96', 1, 1, 0.4),
      r('m249', 1, 1, 0.3),
      r('metalFacemask', 1, 1, 1),
      r('metalChestplate', 1, 1, 0.8),
      r('metalLegPlates', 1, 1, 1),
    ],
  },
};

/** What each land's crates hold extra of. */
export const LAND_LOOT: Record<BiomeId, Roll> = {
  ashlands: r('scrap', 15, 30, 0),
  deadwood: r('cloth', 15, 30, 0),
  mesa: r('metal', 40, 80, 0),
  flats: r('sulfur', 30, 60, 0),
  frost: r('hqm', 5, 12, 0),
};

/**
 * Fills a crate: a few different things from its table (never the same thing twice), plus its
 * land's share half the time.
 */
export function rollLoot(kind: LootKind, land: BiomeId | null, rand: () => number): Stack[] {
  const { rolls, table } = LOOT[kind];
  const left = [...table];
  const out: Stack[] = [];
  const count = rolls[0] + Math.floor(rand() * (rolls[1] - rolls[0] + 1));
  const take = (roll: Roll) => out.push(newStack(roll.item, roll.min + Math.floor(rand() * (roll.max - roll.min + 1))));
  for (let n = 0; n < count && left.length; n++) {
    let pick = rand() * left.reduce((s, x) => s + x.weight, 0);
    const i = left.findIndex((x) => (pick -= x.weight) < 0);
    take(left.splice(i < 0 ? left.length - 1 : i, 1)[0]);
  }
  if (land && rand() < 0.5) take(LAND_LOOT[land]);
  return out;
}
