// Survival rules both sides share: hunger, thirst and radiation. The craters left by the bombs
// are still hot, so the radiation zones come from the same seed as the terrain.

import { craters } from './terrain.ts';

export const MAX_FOOD = 100;
export const MAX_WATER = 100;
export const MAX_RADS = 100;
/** What you respawn with: enough to get going, not enough to ignore. */
export const SPAWN_FOOD = 60;
export const SPAWN_WATER = 60;

/** Food lost per second: a full stomach lasts about 55 minutes standing still. */
export const FOOD_DRAIN = MAX_FOOD / (55 * 60);
/** Water lost per second: a full canteen lasts about 35 minutes standing still. */
export const WATER_DRAIN = MAX_WATER / (35 * 60);
/** Moving burns food and water this many times faster. */
export const MOVING_DRAIN = 1.4;
/** Health lost per second with an empty stomach, and with nothing to drink. */
export const STARVE_DAMAGE = 0.5;
export const THIRST_DAMAGE = 0.8;
/** Health regained per second when well fed, watered and clean. */
export const REGEN = 0.15;
/** Food, water (each at least this) and radiation (at most this) needed to heal on your own. */
export const REGEN_FED = 50;
export const REGEN_RADS = 10;

/** Radiation poisoning lost per second outside the zones. */
export const RADS_DECAY = 0.35;
/** Radiation poisoning starts to hurt above this. */
export const RADS_HARMLESS = 25;
/** Health lost per second at full radiation poisoning. */
export const RADS_DAMAGE = 2;

export interface RadZone {
  x: number;
  z: number;
  /** Radiation reaches this far from the centre, fading to nothing at the edge. */
  radius: number;
  /** Radiation per second at the centre. */
  strength: number;
}

/** Each blast crater is a radiation zone that spills out past its rim; deeper ones are hotter. */
export function radZones(seed: number): RadZone[] {
  return craters(seed).map((c) => ({ x: c.x, z: c.z, radius: c.radius * 1.5, strength: 1.5 + c.depth * 1.2 }));
}

const zoneCache = new Map<number, RadZone[]>();

/** Radiation per second at a spot, before protection: 0 outside every zone. */
export function radiationAt(seed: number, x: number, z: number): number {
  let zones = zoneCache.get(seed);
  if (!zones) zoneCache.set(seed, (zones = radZones(seed)));
  let level = 0;
  for (const zone of zones) {
    const d = Math.hypot(x - zone.x, z - zone.z) / zone.radius;
    if (d < 1) level = Math.max(level, zone.strength * Math.min(1, (1 - d) * 1.6));
  }
  return level;
}

export interface Vitals {
  food: number;
  water: number;
  rads: number;
}

/** Why survival hurt someone this tick, worst first, or null. */
export type SurvivalCause = 'radiation' | 'thirst' | 'starvation';

/**
 * Advances hunger, thirst and radiation by `dt` seconds for someone standing at a spot with
 * `level` radiation and `protection` (0 to 1) from what they wear. Changes `v` in place and
 * returns the health change (negative is damage) and what caused any damage.
 */
export function tickVitals(v: Vitals, dt: number, moving: boolean, level: number, protection: number, hp: number, maxHp: number): { hp: number; cause: SurvivalCause | null } {
  const burn = moving ? MOVING_DRAIN : 1;
  v.food = Math.max(0, v.food - FOOD_DRAIN * burn * dt);
  v.water = Math.max(0, v.water - WATER_DRAIN * burn * dt);
  if (level > 0) v.rads = Math.min(MAX_RADS, v.rads + level * (1 - Math.min(0.9, protection)) * dt);
  else v.rads = Math.max(0, v.rads - RADS_DECAY * dt);

  let change = 0;
  let cause: SurvivalCause | null = null;
  let worst = 0;
  const hurt = (amount: number, why: SurvivalCause) => {
    change -= amount;
    if (amount > worst) {
      worst = amount;
      cause = why;
    }
  };
  if (v.food <= 0) hurt(STARVE_DAMAGE * dt, 'starvation');
  if (v.water <= 0) hurt(THIRST_DAMAGE * dt, 'thirst');
  if (v.rads > RADS_HARMLESS) hurt(((v.rads - RADS_HARMLESS) / (MAX_RADS - RADS_HARMLESS)) * RADS_DAMAGE * dt, 'radiation');
  if (change === 0 && v.food >= REGEN_FED && v.water >= REGEN_FED && v.rads <= REGEN_RADS && hp < maxHp) change = REGEN * dt;
  return { hp: change, cause };
}
