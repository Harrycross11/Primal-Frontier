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

/**
 * A levelled pad of ground in one land where its landmark stands: `land` is the index into
 * BIOME_IDS, `turn` how many quarter turns the layout is rotated.
 */
export interface Site {
  land: number;
  x: number;
  z: number;
  y: number;
  turn: number;
}

/** Metres from a landmark's middle that the ground is dead level, and how far it then eases back. */
export const SITE_RADIUS = 24;
const SITE_BLEND = 14;

const siteCache = new Map<number, Site[]>();

/**
 * Where each land's landmark stands: the flattest spot found well inside that land, away from
 * the craters, the map's edge and the other landmarks. The Ashlands' sits near the middle.
 */
export function landmarkSites(seed: number): Site[] {
  const cached = siteCache.get(seed);
  if (cached) return cached;
  const rand = mulberry32(seed ^ 0x7f4a7c15);
  const holes = craters(seed);
  const sites: Site[] = [];
  const w = [0, 0, 0, 0, 0];
  const reach = SITE_RADIUS + SITE_BLEND;
  for (let land = 0; land < 5; land++) {
    let best: Site | null = null;
    let bestScore = Infinity;
    // If nowhere passes, look again less fussily about how deep inside the land it is.
    for (let tries = 0; tries < 1500 && !(best && tries >= 500); tries++) {
      const strict = tries < 500;
      const a = rand() * Math.PI * 2;
      const r = land === 0 ? 12 + rand() * 30 : CORE_RADIUS + 30 + rand() * (HALF_WORLD * 0.84 - CORE_RADIUS - 30 - SITE_RADIUS);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.max(Math.abs(x), Math.abs(z)) > HALF_WORLD * 0.84 - reach) continue;
      // Never on top of a crater; better well clear of one.
      const crater = Math.min(...holes.map((c) => Math.hypot(c.x - x, c.z - z) - c.radius * 1.4));
      if (crater < SITE_RADIUS + 4) continue;
      if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < (strict ? 90 : 60))) continue;
      // Well inside the land, all the way round.
      let pure = biomeWeights(seed, x, z, w)[land] > (strict ? 0.9 : 0.6);
      for (let k = 0; k < 6 && pure && strict; k++) {
        const b = (k / 6) * Math.PI * 2;
        pure = biomeWeights(seed, x + Math.cos(b) * SITE_RADIUS, z + Math.sin(b) * SITE_RADIUS, w)[land] > 0.6;
      }
      if (!pure) continue;
      // How much the ground would have to move: the spread of heights across the pad.
      const heights: number[] = [];
      for (const ring of [0, 0.5, 1]) {
        for (let k = 0; k < (ring ? 8 : 1); k++) {
          const b = (k / 8) * Math.PI * 2;
          heights.push(shape(seed, x + Math.cos(b) * SITE_RADIUS * ring, z + Math.sin(b) * SITE_RADIUS * ring));
        }
      }
      const mean = heights.reduce((s, h) => s + h, 0) / heights.length;
      const score = Math.sqrt(heights.reduce((s, h) => s + (h - mean) ** 2, 0) / heights.length) + (crater < reach + 10 ? 1 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { land, x, z, y: mean, turn: Math.floor(rand() * 4) };
      }
    }
    // Fall back to somewhere along the land's middle if nothing passed (never seen in practice).
    sites.push(best ?? { land, x: 0, z: 0, y: shape(seed, 0, 0), turn: 0 });
  }
  siteCache.set(seed, sites);
  return sites;
}

/** Ground height in metres at world position (x, z). */
export function terrainHeight(seed: number, x: number, z: number): number {
  let h = shape(seed, x, z);
  // Landmarks stand on levelled ground.
  for (const s of landmarkSites(seed)) {
    const d = Math.hypot(x - s.x, z - s.z);
    if (d >= SITE_RADIUS + SITE_BLEND) continue;
    h += (s.y - h) * (1 - clamp01((d - SITE_RADIUS) / SITE_BLEND));
  }
  return h;
}

/** The ground as nature made it, before any landmark's pad is levelled. */
function shape(seed: number, x: number, z: number): number {
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
