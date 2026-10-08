// Deterministic terrain: the client and server compute the same ground height from the same seed,
// so the map never has to be sent over the network.

import { HALF_WORLD } from './constants.ts';
import { CORE_RADIUS, biomeWeights } from './biomes.ts';
import { mulberry32, valueNoise } from './noise.ts';

export { mulberry32, valueNoise };

export interface Crater {
  x: number;
  z: number;
  radius: number;
  depth: number;
}

/** Old blast sites: bowl-shaped dips with a raised rim, out in the wilder lands round the middle. */
export function craters(seed: number): Crater[] {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const list: Crater[] = [];
  for (let i = 0; i < CRATERS; i++) {
    let x = 0;
    let z = 0;
    for (let tries = 0; tries < 40; tries++) {
      // Spread round the map, one per slice, and clear of the middle and of each other.
      const a = ((i + rand() * 0.8) / CRATERS) * Math.PI * 2;
      const r = CORE_RADIUS + 30 + rand() * (HALF_WORLD * 0.78 - CORE_RADIUS - 30);
      x = Math.cos(a) * r;
      z = Math.sin(a) * r;
      if (list.every((c) => Math.hypot(c.x - x, c.z - z) > 60)) break;
    }
    list.push({ x, z, radius: 9 + rand() * 7, depth: 2.5 + rand() * 1.5 });
  }
  return list;
}

/** How many blast craters the map has. */
export const CRATERS = 6;

const craterCache = new Map<number, Crater[]>();
const weights = [0, 0, 0, 0, 0];

function clamp01(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Ground height in metres at world position (x, z). */
export function terrainHeight(seed: number, x: number, z: number): number {
  let base = 0;
  let amp = 4;
  let freq = 1 / 40;
  for (let o = 0; o < 4; o++) {
    base += (valueNoise(seed + o * 1013, x * freq, z * freq) - 0.5) * 2 * amp;
    amp *= 0.45;
    freq *= 2.1;
  }

  // Each land shapes the ground its own way, blended across the borders.
  const w = biomeWeights(seed, x, z, weights);
  let h = w[0] * (base + 3);
  // Deadwood: rolling wooded hills.
  if (w[1] > 0) h += w[1] * (base * 1.3 + 3.5);
  // Rust Mesa: flat-topped tables of rock in two tiers, with steep sides.
  if (w[2] > 0) {
    const n = valueNoise(seed + 500, x / 46, z / 46) * 0.78 + valueNoise(seed + 501, x / 15, z / 15) * 0.22;
    const tiers = 8 * clamp01((n - 0.5) / 0.07) + 6 * clamp01((n - 0.66) / 0.06);
    h += w[2] * (base * 0.5 + 2.5 + tiers);
  }
  // Sulfur Flats: an old lake bed, nearly level.
  if (w[3] > 0) h += w[3] * (base * 0.14 + 1.8);
  // Frostpeaks: sharp ridges climbing towards the map's edge.
  if (w[4] > 0) {
    const ridge = 1 - Math.abs(valueNoise(seed + 600, x / 52, z / 52) * 2 - 1);
    const ridge2 = 1 - Math.abs(valueNoise(seed + 601, x / 21, z / 21) * 2 - 1);
    const out = clamp01((Math.hypot(x, z) - CORE_RADIUS) / (HALF_WORLD * 0.5));
    h += w[4] * (base * 0.8 + 4 + ridge * ridge * (6 + 12 * out) + ridge2 * ridge2 * 3.5);
  }

  let list = craterCache.get(seed);
  if (!list) {
    list = craters(seed);
    craterCache.set(seed, list);
  }
  for (const c of list) {
    const d = Math.hypot(x - c.x, z - c.z) / c.radius;
    if (d < 1) h -= c.depth * (1 - d * d);
    else if (d < 1.4) h += 0.8 * Math.sin(((d - 1) / 0.4) * Math.PI);
  }

  // Raise the edges into a ridge so the map has a natural boundary.
  const edge = Math.max(Math.abs(x), Math.abs(z)) / HALF_WORLD;
  if (edge > 0.9) h += ((edge - 0.9) / 0.1) ** 2 * 16;
  return h;
}

/** How steep the ground is at a spot: metres of rise per metre across. Cliffs are about 1 or more. */
export function slopeAt(seed: number, x: number, z: number): number {
  const y = terrainHeight(seed, x, z);
  return Math.hypot(terrainHeight(seed, x + 0.8, z) - y, terrainHeight(seed, x, z + 0.8) - y) / 0.8;
}
