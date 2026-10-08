// Resources and blocks: the parts of the world that players change.

import { HALF_WORLD } from './constants.ts';
import type { ItemId } from './items.ts';
import { BIOME_IDS, biomeAt, type BiomeId } from './biomes.ts';
import { atLandmark } from './landmarks.ts';
import { craters, mulberry32, slopeAt, terrainHeight } from './terrain.ts';

export type ResourceKind = 'tree' | 'deadTree' | 'scrap' | 'stone' | 'metalOre' | 'sulfurOre' | 'hqmOre' | 'hemp' | 'mushroom' | 'waterBarrel';
/** Building materials, weakest to strongest is wood, stone, scrap. Each is also an item. */
export type Material = 'wood' | 'stone' | 'scrap';
export const MATERIALS: Material[] = ['wood', 'stone', 'scrap'];

export interface ResourceNode {
  id: number;
  kind: ResourceKind;
  x: number;
  y: number;
  z: number;
  /** Units left to gather. 0 means depleted (hidden). */
  amount: number;
  /** Visual variety: rotation and size, decided by the seed. */
  rot: number;
  scale: number;
}

/**
 * yields: the item a node gives. tool: which tool multiplier applies ('pickup' nodes are
 * collected whole by hand). respawn: seconds until a used-up node comes back (0 = never).
 */
export const RESOURCE_INFO: Record<
  ResourceKind,
  { yields: ItemId; tool: 'wood' | 'stone' | 'scrap' | 'pickup'; amount: number; perHit: number; radius: number; respawn: number }
> = {
  tree: { yields: 'wood', tool: 'wood', amount: 60, perHit: 6, radius: 0.45, respawn: 0 },
  deadTree: { yields: 'wood', tool: 'wood', amount: 24, perHit: 4, radius: 0.3, respawn: 0 },
  scrap: { yields: 'scrap', tool: 'scrap', amount: 40, perHit: 4, radius: 0.9, respawn: 120 },
  stone: { yields: 'stone', tool: 'stone', amount: 120, perHit: 6, radius: 0.9, respawn: 180 },
  metalOre: { yields: 'metalOre', tool: 'stone', amount: 90, perHit: 4, radius: 0.85, respawn: 240 },
  sulfurOre: { yields: 'sulfurOre', tool: 'stone', amount: 90, perHit: 4, radius: 0.85, respawn: 240 },
  hqmOre: { yields: 'hqmOre', tool: 'stone', amount: 24, perHit: 1, radius: 0.85, respawn: 420 },
  hemp: { yields: 'cloth', tool: 'pickup', amount: 10, perHit: 10, radius: 0.2, respawn: 150 },
  mushroom: { yields: 'mushroom', tool: 'pickup', amount: 3, perHit: 3, radius: 0.2, respawn: 200 },
  // Rainwater: drunk on the spot rather than carried, a few gulps at a time. Refills slowly.
  waterBarrel: { yields: 'bottledWater', tool: 'pickup', amount: 100, perHit: 25, radius: 0.45, respawn: 240 },
};

/** Water you gain from one drink at a barrel. */
export const BARREL_DRINK = 25;
/** Chance per hit on a wreck of finding a can of beans, and a bottle of water, in the glove box. */
export const WRECK_LOOT = { cannedBeans: 0.1, bottledWater: 0.08 } as const;

/**
 * How common each resource is in each land, compared with the Ashlands. This is what makes a
 * trip worth it: metal on the mesa, sulfur on the flats, high quality ore up in the frost.
 */
export const BIOME_RESOURCES: Record<BiomeId, Partial<Record<ResourceKind, number>>> = {
  ashlands: { deadTree: 1, scrap: 1.8, stone: 1, metalOre: 1, sulfurOre: 1, hqmOre: 0.4, hemp: 1, waterBarrel: 1.3, mushroom: 0.7 },
  deadwood: { tree: 1, deadTree: 0.6, scrap: 0.5, stone: 0.8, metalOre: 0.5, sulfurOre: 0.4, hqmOre: 0.2, hemp: 2.5, waterBarrel: 1, mushroom: 3 },
  mesa: { deadTree: 0.3, scrap: 0.7, stone: 2.2, metalOre: 3, sulfurOre: 0.8, hqmOre: 1, hemp: 0.3, waterBarrel: 0.7, mushroom: 0.2 },
  flats: { deadTree: 0.15, scrap: 1.1, stone: 0.7, metalOre: 0.6, sulfurOre: 3, hqmOre: 0.8, hemp: 0.2, waterBarrel: 0.3, mushroom: 0.1 },
  frost: { deadTree: 0.9, scrap: 0.4, stone: 1.6, metalOre: 1, sulfurOre: 0.8, hqmOre: 3, hemp: 0.2, waterBarrel: 0.8, mushroom: 0.3 },
};

/**
 * Lays out the map's resources, land by land (see BIOME_RESOURCES). Living trees only grow in
 * Deadwood; everywhere else is dead stumps and scrap, so wood near the middle is scarce.
 */
export function generateResources(seed: number): ResourceNode[] {
  const rand = mulberry32(seed);
  const nodes: ResourceNode[] = [];
  const span = HALF_WORLD * 0.86;
  const add = (kind: ResourceKind, x: number, z: number) => {
    // The landmarks' ground is kept clear.
    if (atLandmark(seed, x, z, 3)) return;
    nodes.push({
      id: nodes.length,
      kind,
      x,
      y: terrainHeight(seed, x, z),
      z,
      amount: RESOURCE_INFO[kind].amount,
      rot: rand() * Math.PI * 2,
      scale: 0.8 + rand() * 0.5,
    });
  };
  /** A random spot, kept more often where `kind` is common, and never in the border ridge. */
  const spot = (kind: ResourceKind): [number, number] => {
    const most = Math.max(...BIOME_IDS.map((b) => BIOME_RESOURCES[b][kind] ?? 0));
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 60; tries++) {
      x = (rand() - 0.5) * 2 * span;
      z = (rand() - 0.5) * 2 * span;
      if (rand() * most < (BIOME_RESOURCES[biomeAt(seed, x, z)][kind] ?? 0) && slopeAt(seed, x, z) < 0.9) break;
    }
    return [x, z];
  };
  const scatter = (kind: ResourceKind, count: number) => {
    for (let i = 0; i < count; i++) add(kind, ...spot(kind));
  };
  const patches = (kind: ResourceKind, count: number, each: number, spread: number) => {
    for (let p = 0; p < count; p++) {
      const [px, pz] = spot(kind);
      for (let i = 0; i < each; i++) add(kind, px + (rand() - 0.5) * spread, pz + (rand() - 0.5) * spread);
    }
  };

  // Deadwood's trees grow in groves.
  for (let grove = 0; grove < 16; grove++) {
    const [gx, gz] = spot('tree');
    const trees = 7 + Math.floor(rand() * 6);
    for (let i = 0; i < trees; i++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * 13;
      add('tree', gx + Math.cos(a) * r, gz + Math.sin(a) * r);
    }
  }
  scatter('deadTree', 120);
  scatter('scrap', 110);
  scatter('stone', 110);
  scatter('metalOre', 80);
  scatter('sulfurOre', 70);
  scatter('hqmOre', 32);
  patches('hemp', 26, 4, 6);
  scatter('waterBarrel', 50);
  patches('mushroom', 30, 3, 4);
  // The richest ore sits in the hot craters: worth the radiation if you come prepared.
  for (const c of craters(seed)) {
    for (let i = 0; i < 2; i++) {
      const a = rand() * Math.PI * 2;
      add('hqmOre', c.x + Math.cos(a) * c.radius * 0.35, c.z + Math.sin(a) * c.radius * 0.35);
    }
  }
  return nodes;
}

export type DecorKind = 'ruin' | 'pole' | 'rock' | 'barrel';

export interface Decor {
  kind: DecorKind;
  x: number;
  y: number;
  z: number;
  rot: number;
  scale: number;
  /** Variety seed for the shape. */
  variant: number;
}

/**
 * Scenery that tells the story of the world: ruined concrete buildings, leaning power poles,
 * boulders and rusted barrels. Purely visual, plus collision for the big pieces on the client.
 */
export function generateDecor(seed: number): Decor[] {
  const rand = mulberry32(seed ^ 0x1b873593);
  const span = HALF_WORLD * 0.86;
  const list: Decor[] = [];
  const add = (kind: DecorKind, x: number, z: number, scale = 1) => {
    const rot = rand() * Math.PI * 2;
    const variant = Math.floor(rand() * 1000);
    if (!atLandmark(seed, x, z, kind === 'ruin' ? 14 : 2)) list.push({ kind, x, y: terrainHeight(seed, x, z), z, rot, scale, variant });
  };
  /** A random spot in one of `lands` (or anywhere if it can't find one). */
  const somewhere = (lands: BiomeId[] | null): [number, number] => {
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 40; tries++) {
      x = (rand() - 0.5) * 2 * span;
      z = (rand() - 0.5) * 2 * span;
      if (!lands || lands.includes(biomeAt(seed, x, z))) break;
    }
    return [x, z];
  };
  // Ruined houses: most in the old town in the middle, a few out on the flats and in the woods.
  for (let i = 0; i < 9; i++) add('ruin', ...somewhere(['ashlands']));
  for (let i = 0; i < 7; i++) add('ruin', ...somewhere(['flats', 'deadwood', 'ashlands']));
  // A line of power poles crossing the map, like an old road.
  const angle = rand() * Math.PI;
  for (let d = -span; d <= span; d += 18) {
    add('pole', Math.cos(angle) * d + (rand() - 0.5) * 2, Math.sin(angle) * d + (rand() - 0.5) * 2);
  }
  // Boulders everywhere, crowded on the mesa and the peaks.
  for (let i = 0; i < 140; i++) add('rock', ...somewhere(null), 0.4 + rand() * rand() * 2.2);
  for (let i = 0; i < 110; i++) add('rock', ...somewhere(['mesa', 'frost']), 0.5 + rand() * rand() * 2.8);
  for (let i = 0; i < 55; i++) add('barrel', ...somewhere(['ashlands', 'flats', 'mesa', 'deadwood']));
  return list;
}
