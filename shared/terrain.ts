// Deterministic terrain: the client and server compute the same ground height from the same seed,
// so the map never has to be sent over the network.

import { HALF_WORLD } from './constants.ts';

/** Small fast seeded random generator (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(seed: number, x: number, z: number): number {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(z, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(seed: number, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fz = smooth(z - z0);
  const a = hash2(seed, x0, z0);
  const b = hash2(seed, x0 + 1, z0);
  const c = hash2(seed, x0, z0 + 1);
  const d = hash2(seed, x0 + 1, z0 + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export interface Crater {
  x: number;
  z: number;
  radius: number;
  depth: number;
}

/** Old blast sites: bowl-shaped dips with a raised rim. Positions depend only on the seed. */
export function craters(seed: number): Crater[] {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const list: Crater[] = [];
  for (let i = 0; i < 3; i++) {
    list.push({
      x: (rand() - 0.5) * (HALF_WORLD * 1.3),
      z: (rand() - 0.5) * (HALF_WORLD * 1.3),
      radius: 9 + rand() * 7,
      depth: 2.5 + rand() * 1.5,
    });
  }
  return list;
}

const craterCache = new Map<number, Crater[]>();

/** Ground height in metres at world position (x, z). */
export function terrainHeight(seed: number, x: number, z: number): number {
  let h = 0;
  let amp = 4;
  let freq = 1 / 40;
  for (let o = 0; o < 4; o++) {
    h += (valueNoise(seed + o * 1013, x * freq, z * freq) - 0.5) * 2 * amp;
    amp *= 0.45;
    freq *= 2.1;
  }
  h += 3;

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
  if (edge > 0.85) h += ((edge - 0.85) / 0.15) ** 2 * 14;
  return h;
}
