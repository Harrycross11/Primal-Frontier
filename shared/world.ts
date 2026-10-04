// Resources and blocks: the parts of the world that players change.

import { HALF_WORLD } from './constants.ts';
import { mulberry32, terrainHeight } from './terrain.ts';

export type ResourceKind = 'tree' | 'deadTree' | 'scrap';
export type Material = 'wood' | 'scrap';

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

export const RESOURCE_INFO: Record<ResourceKind, { material: Material; amount: number; perHit: number; radius: number }> = {
  tree: { material: 'wood', amount: 60, perHit: 6, radius: 0.45 },
  deadTree: { material: 'wood', amount: 24, perHit: 4, radius: 0.3 },
  scrap: { material: 'scrap', amount: 40, perHit: 4, radius: 0.9 },
};

export type Inventory = Record<Material, number>;

export function emptyInventory(): Inventory {
  return { wood: 0, scrap: 0 };
}

/**
 * Lays out the map's resources. Living trees only grow in one small "overgrowth" pocket;
 * everywhere else is dead stumps and scrap, so wood is scarce and worth fighting over.
 */
export function generateResources(seed: number): ResourceNode[] {
  const rand = mulberry32(seed);
  const nodes: ResourceNode[] = [];
  const span = HALF_WORLD * 0.8;
  const add = (kind: ResourceKind, x: number, z: number) => {
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

  const pocketX = (rand() - 0.5) * span;
  const pocketZ = (rand() - 0.5) * span;
  for (let i = 0; i < 14; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * 12;
    add('tree', pocketX + Math.cos(a) * r, pocketZ + Math.sin(a) * r);
  }
  for (let i = 0; i < 30; i++) add('deadTree', (rand() - 0.5) * 2 * span, (rand() - 0.5) * 2 * span);
  for (let i = 0; i < 26; i++) add('scrap', (rand() - 0.5) * 2 * span, (rand() - 0.5) * 2 * span);
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
  const span = HALF_WORLD * 0.8;
  const list: Decor[] = [];
  const add = (kind: DecorKind, x: number, z: number, scale = 1) =>
    list.push({ kind, x, y: terrainHeight(seed, x, z), z, rot: rand() * Math.PI * 2, scale, variant: Math.floor(rand() * 1000) });
  for (let i = 0; i < 7; i++) add('ruin', (rand() - 0.5) * 2 * span, (rand() - 0.5) * 2 * span);
  // A line of power poles crossing the map, like an old road.
  const angle = rand() * Math.PI;
  for (let d = -span; d <= span; d += 18) {
    add('pole', Math.cos(angle) * d + (rand() - 0.5) * 2, Math.sin(angle) * d + (rand() - 0.5) * 2);
  }
  for (let i = 0; i < 60; i++) add('rock', (rand() - 0.5) * 2 * span * 1.1, (rand() - 0.5) * 2 * span * 1.1, 0.4 + rand() * rand() * 2.2);
  for (let i = 0; i < 18; i++) add('barrel', (rand() - 0.5) * 2 * span, (rand() - 0.5) * 2 * span);
  return list;
}
