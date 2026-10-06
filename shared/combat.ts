// Combat rules shared by client and server: health, hit zones and ray tests. The server
// decides every hit; the client uses the same shapes to aim and to draw tracers.

import type { Box } from './building.ts';
import { PLAYER_HEIGHT, PLAYER_RADIUS } from './constants.ts';
import { ARMOUR_SLOTS, ITEMS, type ArmourSlot, type Slots } from './items.ts';
import { terrainHeight } from './terrain.ts';

export type Vec3 = [number, number, number];

export const MAX_HEALTH = 100;
/** Shots and swings start from the eyes, the same height the client aims from. */
export const EYE_HEIGHT = PLAYER_HEIGHT * 0.9;
/** Damage multiplier for a hit on the head. */
export const HEADSHOT = 1.75;
/** Damage from punching with empty hands. */
export const FIST = { damage: 6, delay: 0.5, range: 2 };
/** Seconds between two uses of a bandage or syringe. */
export const HEAL_COOLDOWN = 1;

const HEAD_RADIUS = 0.17;
const HEAD_Y = 1.62;
/** The body below the head, a little wider than the collision box so grazing shots count. */
const BODY_TOP = 1.46;
const BODY_PAD = 0.05;
/** Hits on the body below this height (the hips) land on the legs. */
const LEGS_TOP = 0.92;

export function headCentre(p: { x: number; y: number; z: number }): Vec3 {
  return [p.x, p.y + HEAD_Y, p.z];
}

export function bodyBox(p: { x: number; y: number; z: number }): Box {
  const r = PLAYER_RADIUS + BODY_PAD;
  return { min: [p.x - r, p.y, p.z - r], max: [p.x + r, p.y + BODY_TOP, p.z + r] };
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Distance along the ray to where it enters the box, or null if it misses within `max`. */
export function rayBox(o: Vec3, d: Vec3, b: Box, max: number): number | null {
  let t0 = 0;
  let t1 = max;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < b.min[a] || o[a] > b.max[a]) return null;
      continue;
    }
    let near = (b.min[a] - o[a]) / d[a];
    let far = (b.max[a] - o[a]) / d[a];
    if (near > far) [near, far] = [far, near];
    t0 = Math.max(t0, near);
    t1 = Math.min(t1, far);
    if (t0 > t1) return null;
  }
  return t0;
}

export function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number, max: number): number | null {
  const m = [o[0] - c[0], o[1] - c[1], o[2] - c[2]];
  const b = m[0] * d[0] + m[1] * d[1] + m[2] * d[2];
  const cc = m[0] * m[0] + m[1] * m[1] + m[2] * m[2] - r * r;
  if (cc > 0 && b > 0) return null;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = Math.max(0, -b - Math.sqrt(disc));
  return t <= max ? t : null;
}

/** Where a player's head, chest or legs are hit by the ray, if at all. */
export function rayPlayer(
  o: Vec3,
  d: Vec3,
  p: { x: number; y: number; z: number },
  max: number,
): { t: number; head: boolean; zone: ArmourSlot } | null {
  const head = raySphere(o, d, headCentre(p), HEAD_RADIUS, max);
  const body = rayBox(o, d, bodyBox(p), max);
  if (head === null && body === null) return null;
  if (body === null || (head !== null && head <= body)) return { t: head!, head: true, zone: 'head' };
  const y = o[1] + d[1] * body - p.y;
  return { t: body, head: false, zone: y < LEGS_TOP ? 'legs' : 'chest' };
}

/** The share of a hit on `zone` that gets through the armour worn in `wear`. */
export function armourFactor(wear: Slots, zone: ArmourSlot): number {
  const piece = wear[ARMOUR_SLOTS.indexOf(zone)];
  return 1 - (piece ? (ITEMS[piece.item].armour?.protection ?? 0) : 0);
}

/** First point where the ray dips under the ground, by marching in half-metre steps. */
export function rayTerrain(seed: number, o: Vec3, d: Vec3, max: number): number | null {
  const step = 0.5;
  for (let t = step; t <= max; t += step) {
    const x = o[0] + d[0] * t;
    const z = o[2] + d[2] * t;
    if (o[1] + d[1] * t < terrainHeight(seed, x, z)) return t - step / 2;
  }
  return null;
}

/** Turns a direction by a random angle up to `cone` radians, evenly over the cone's area. */
export function spreadDir(d: Vec3, cone: number, rand: () => number): Vec3 {
  if (cone <= 0) return d;
  const up: Vec3 = Math.abs(d[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize(cross(d, up));
  const v = cross(d, u);
  const angle = cone * Math.sqrt(rand());
  const around = rand() * Math.PI * 2;
  const s = Math.tan(angle);
  return normalize([
    d[0] + (u[0] * Math.cos(around) + v[0] * Math.sin(around)) * s,
    d[1] + (u[1] * Math.cos(around) + v[1] * Math.sin(around)) * s,
    d[2] + (u[2] * Math.cos(around) + v[2] * Math.sin(around)) * s,
  ]);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Guns keep full damage to half range, then fall off to half damage at full range. */
export function falloff(distance: number, range: number): number {
  if (distance <= range / 2) return 1;
  return 1 - 0.5 * Math.min(1, (distance - range / 2) / (range / 2));
}
