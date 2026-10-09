// The map's regions. Survivors wake in the Ashlands in the middle; round it lie four wilder
// lands, each richer in something and harder in some way. Shared so the client paints the same
// borders the server uses for resources, survival and spawns.

import { HALF_WORLD } from './constants.ts';
import { mulberry32, valueNoise } from './noise.ts';

export type BiomeId = 'ashlands' | 'deadwood' | 'mesa' | 'flats' | 'frost';
export const BIOME_IDS: BiomeId[] = ['ashlands', 'deadwood', 'mesa', 'flats', 'frost'];

export interface BiomeInfo {
  name: string;
  /** What it is good for, and what it costs you, as told on arrival. */
  perk: string;
  /** Colour on the map. */
  color: string;
  /** How much faster food and water run out there. */
  hunger: number;
  thirst: number;
}

export const BIOMES: Record<BiomeId, BiomeInfo> = {
  ashlands: { name: 'The Ashlands', perk: 'Wrecks full of scrap and old ruins. The safest ground', color: '#8f877a', hunger: 1, thirst: 1 },
  deadwood: { name: 'Deadwood Forest', perk: 'Living trees, hemp and mushrooms. Ashhound packs den here', color: '#5c6b44', hunger: 1, thirst: 1 },
  mesa: { name: 'Rust Mesa', perk: 'Metal ore three times as common, and plenty of stone', color: '#a35f3a', hunger: 1, thirst: 1.2 },
  flats: { name: 'Sulfur Flats', perk: 'Sulfur ore three times as common. Scorching: you get thirsty fast', color: '#d9cc9e', hunger: 1, thirst: 1.7 },
  frost: { name: 'Frostpeaks', perk: 'High quality metal ore all over. Freezing: you get hungry fast', color: '#e4eaee', hunger: 1.7, thirst: 1 },
};

/** The four outer lands, in order round the middle. */
const OUTER: BiomeId[] = ['deadwood', 'mesa', 'flats', 'frost'];
/** Radius of the Ashlands in the middle, before its edge wanders. */
export const CORE_RADIUS = HALF_WORLD * 0.38;
/** How wide the blend between two lands is: metres across the middle's edge, and share of a quarter turn. */
const CORE_BLEND = 60;
const SIDE_BLEND = 0.28;

const turnCache = new Map<number, number>();
/** How far round the outer lands are turned, so each seed lays them out differently. */
function turn(seed: number): number {
  let t = turnCache.get(seed);
  if (t === undefined) turnCache.set(seed, (t = mulberry32(seed ^ 0x2f6b9e1d)() * Math.PI * 2));
  return t;
}

function smooth01(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * How much each land claims a spot, in BIOME_IDS order, adding up to 1. Borders wander with
 * noise and blend over tens of metres, so the ground, grass and heights change gradually.
 */
export function biomeWeights(seed: number, x: number, z: number, out: number[] = [0, 0, 0, 0, 0]): number[] {
  const r = Math.hypot(x, z);
  const wobble = (valueNoise(seed + 77, x / 45, z / 45) - 0.5) * 44 + (valueNoise(seed + 79, x / 26, z / 26) - 0.5) * 26 + (valueNoise(seed + 78, x / 11, z / 11) - 0.5) * 8;
  const core = 1 - smooth01((r + wobble - CORE_RADIUS + CORE_BLEND / 2) / CORE_BLEND);
  out.fill(0);
  out[0] = core;
  if (core >= 1) return out;
  const warp = (valueNoise(seed + 99, x / 70, z / 70) - 0.5) * 1.1 + (valueNoise(seed + 96, x / 30, z / 30) - 0.5) * 0.35 + (valueNoise(seed + 98, x / 12, z / 12) - 0.5) * 0.12;
  let s = (Math.atan2(z, x) + turn(seed) + warp) / (Math.PI / 2);
  s = ((s % 4) + 4) % 4;
  const k = Math.floor(s);
  const f = s - k;
  const rest = 1 - core;
  if (f < SIDE_BLEND) {
    const w = smooth01((f + SIDE_BLEND) / (2 * SIDE_BLEND));
    out[1 + k] += rest * w;
    out[1 + ((k + 3) % 4)] += rest * (1 - w);
  } else if (f > 1 - SIDE_BLEND) {
    const w = smooth01((f - (1 - SIDE_BLEND)) / (2 * SIDE_BLEND));
    out[1 + ((k + 1) % 4)] += rest * w;
    out[1 + k] += rest * (1 - w);
  } else out[1 + k] += rest;
  return out;
}

const scratch = [0, 0, 0, 0, 0];

/** The land that holds a spot. */
export function biomeAt(seed: number, x: number, z: number): BiomeId {
  const w = biomeWeights(seed, x, z, scratch);
  let best = 0;
  for (let i = 1; i < 5; i++) if (w[i] > w[best]) best = i;
  return BIOME_IDS[best];
}

/** How a land's harder side wears on you at a spot: hunger and thirst multipliers. */
export function climateAt(seed: number, x: number, z: number): { hunger: number; thirst: number } {
  const w = biomeWeights(seed, x, z, scratch);
  let hunger = 0;
  let thirst = 0;
  BIOME_IDS.forEach((id, i) => {
    hunger += w[i] * BIOMES[id].hunger;
    thirst += w[i] * BIOMES[id].thirst;
  });
  return { hunger, thirst };
}

export { OUTER as OUTER_BIOMES };
