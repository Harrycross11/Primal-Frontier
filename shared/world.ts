// Resources and blocks: the parts of the world that players change.

import { HALF_WORLD, MAX_BUILD_HEIGHT } from './constants.ts';
import { mulberry32, terrainHeight } from './terrain.ts';

export type ResourceKind = 'tree' | 'deadTree' | 'scrap';
export type Material = 'wood' | 'scrap';
export type BlockType = 'wood' | 'scrap';

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
  tree: { material: 'wood', amount: 12, perHit: 2, radius: 0.45 },
  deadTree: { material: 'wood', amount: 5, perHit: 1, radius: 0.3 },
  scrap: { material: 'scrap', amount: 8, perHit: 1, radius: 0.9 },
};

export const BLOCK_COST: Record<BlockType, { material: Material; amount: number }> = {
  wood: { material: 'wood', amount: 2 },
  scrap: { material: 'scrap', amount: 2 },
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

export function blockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export interface Block {
  x: number;
  y: number;
  z: number;
  type: BlockType;
}

/** Blocks sit on a 1 m grid; cell (x, y, z) covers [x, x+1) x [y, y+1) x [z, z+1). */
export function cellInBounds(x: number, y: number, z: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    Number.isInteger(z) &&
    Math.abs(x + 0.5) < HALF_WORLD * 0.9 &&
    Math.abs(z + 0.5) < HALF_WORLD * 0.9 &&
    y >= -10 &&
    y < MAX_BUILD_HEIGHT
  );
}

/** A block must touch the ground or another block, so nobody builds floating sky bases. */
export function cellIsSupported(seed: number, blocks: Map<string, Block>, x: number, y: number, z: number): boolean {
  const ground = Math.max(
    terrainHeight(seed, x, z),
    terrainHeight(seed, x + 1, z),
    terrainHeight(seed, x, z + 1),
    terrainHeight(seed, x + 1, z + 1),
    terrainHeight(seed, x + 0.5, z + 0.5),
  );
  if (y <= ground + 0.25) return true;
  const n: [number, number, number][] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  return n.some(([dx, dy, dz]) => blocks.has(blockKey(x + dx, y + dy, z + dz)));
}
