// Farming: a planter box holds three plants, each grown from a seed. A plant grows by itself,
// faster in the forest's soft ground and barely at all up in the frost, and when it is ripe its
// crop and fresh seeds drop into the planter's harvest slots and the next seed starts.
// Shared so the client can draw how far along each plant is.

import { BIOME_IDS, biomeWeights, type BiomeId } from './biomes.ts';
import type { ItemId } from './items.ts';

/** What each seed grows into: seconds to ripen, and what it gives when it does. */
export const CROPS: Partial<Record<ItemId, { name: string; seconds: number; yields: [ItemId, number][] }>> = {
  hempSeed: { name: 'Hemp', seconds: 240, yields: [['cloth', 15], ['hempSeed', 2]] },
  cornSeed: { name: 'Corn', seconds: 360, yields: [['corn', 3], ['cornSeed', 2]] },
  pumpkinSeed: { name: 'Pumpkin', seconds: 480, yields: [['pumpkin', 2], ['pumpkinSeed', 2]] },
};

/** Planter slots: seeds go in 0-2 (one plant each), the harvest comes out in 3-8. */
export const PLANTER_SEED_SLOTS = [0, 1, 2];
export const PLANTER_OUTPUT_SLOTS = [3, 4, 5, 6, 7, 8];

/** How fast plants grow in each land, against the Ashlands. */
export const LAND_GROWTH: Record<BiomeId, number> = { ashlands: 1, deadwood: 1.4, mesa: 0.8, flats: 0.6, frost: 0.35 };

/** How fast plants grow at a spot, blending the lands near a border. */
export function growthAt(seed: number, x: number, z: number): number {
  const w = biomeWeights(seed, x, z);
  return BIOME_IDS.reduce((rate, id, i) => rate + w[i] * LAND_GROWTH[id], 0);
}

/** How far along a plant is, 0 (just sown) to 1 (ripe). */
export function ripeness(seedItem: ItemId, grown: number): number {
  const crop = CROPS[seedItem];
  return crop ? Math.min(1, Math.max(0, grown / crop.seconds)) : 0;
}

/** Chance of a hemp seed each time you pick wild hemp. */
export const WILD_HEMP_SEED = 0.35;
