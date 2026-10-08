// The wildlife: Ashhounds, mutated wild dogs that hunt in packs. Shared so the client knows
// their size and speed, and can tell what a hit or a feed will do.

import { HALF_WORLD } from './constants.ts';
import { rayBox, type Vec3 } from './combat.ts';
import { CORE_RADIUS, biomeAt } from './biomes.ts';
import { mulberry32 } from './terrain.ts';
import { generateDecor } from './world.ts';
import { atLandmark } from './landmarks.ts';

/** What a hound is doing, for its animation: `snarl` is squaring up to a fight between bites. */
export type CreatureAnim = 'idle' | 'snarl' | 'walk' | 'run' | 'attack' | 'hit' | 'eat' | 'dead';

/** What everyone is told about a creature each tick. */
export interface CreatureState {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Which way it faces: it looks along (sin yaw, cos yaw). */
  yaw: number;
  /** Health left, 0 to 1. */
  hp: number;
  anim: CreatureAnim;
  /** The player who tamed it, if anyone has. */
  owner?: number;
  name?: string;
  /** Feeds so far towards taming it. */
  fed?: number;
}

export const ASHHOUND = {
  maxHp: 110,
  /** Metres a second: wandering, and chasing (a little slower than a sprinting player). */
  walk: 1.6,
  run: 8.4,
  bite: 9,
  /** From its centre to the target's. */
  biteRange: 1.9,
  biteEvery: 1.4,
  /** How far off it notices someone, and how far from its den it will chase them. */
  sight: 18,
  leash: 40,
  /** Below this share of its health a wild hound runs off. */
  flee: 0.3,
  /** Seconds after dying before a new one joins the pack. */
  respawn: 180,
  /** Seconds a body lies before it is gone (its meat is in a bag beside it). */
  corpse: 25,
  /** Cooked meat it takes to tame one, fed within reach. */
  tameFeeds: 3,
  feedRange: 2.6,
  /** Tame hounds each survivor can have at once. */
  maxPets: 2,
  /** Seconds a hound being fed stays calm towards whoever fed it. */
  calm: 30,
  /** Raw meat its body gives. */
  meat: [3, 5] as [number, number],
} as const;

/** Packs on the map and how many hounds in each. */
export const PACKS = 5;
export const PACK_SIZE = 3;
/** The packs that den in Deadwood; the rest roam the other wild lands. */
const FOREST_PACKS = 3;

/** Where each pack makes its den: out in the wild lands, away from the middle and the ruins. */
export function packDens(seed: number): [number, number][] {
  const rand = mulberry32(seed ^ 0x68e31da4);
  const dens: [number, number][] = [];
  for (let n = 0; n < PACKS; n++) {
    let den: [number, number] = [0, 0];
    for (let tries = 0; tries < 300; tries++) {
      const angle = rand() * Math.PI * 2;
      const r = CORE_RADIUS + 25 + rand() * (HALF_WORLD * 0.8 - CORE_RADIUS - 25);
      den = [Math.cos(angle) * r, Math.sin(angle) * r];
      const land = biomeAt(seed, den[0], den[1]);
      const right = n < FOREST_PACKS ? land === 'deadwood' : land !== 'ashlands' && land !== 'deadwood';
      const apart = dens.every(([x, z]) => Math.hypot(x - den[0], z - den[1]) > 60);
      if (right && apart && clearOfRuins(seed, den[0], den[1], 18)) break;
    }
    dens.push(den);
  }
  return dens;
}

const ruinCache = new Map<number, [number, number][]>();

/** True if a spot is at least `gap` metres from the ruined buildings (which hounds walk round). */
export function clearOfRuins(seed: number, x: number, z: number, gap = 8): boolean {
  let ruins = ruinCache.get(seed);
  if (!ruins) {
    ruins = generateDecor(seed)
      .filter((d) => d.kind === 'ruin')
      .map((d) => [d.x, d.z]);
    ruinCache.set(seed, ruins);
  }
  return ruins.every(([rx, rz]) => Math.hypot(rx - x, rz - z) >= gap) && !atLandmark(seed, x, z, gap);
}

// The hound's body in its own frame (facing +z, feet at 0): a box for the body and legs, and
// one for the head, which takes extra damage.
const BODY = { min: [-0.23, 0.2, -0.72] as Vec3, max: [0.23, 0.8, 0.35] as Vec3 };
const HEAD = { min: [-0.15, 0.5, 0.35] as Vec3, max: [0.15, 0.92, 0.8] as Vec3 };

/** Where a ray hits a hound, if it does, and whether on the head. */
export function rayCreature(o: Vec3, d: Vec3, c: { x: number; y: number; z: number; yaw: number }, max: number): { t: number; head: boolean } | null {
  // Turn the ray into the hound's frame, so its boxes can stay lined up with the axes.
  const cos = Math.cos(c.yaw);
  const sin = Math.sin(c.yaw);
  const rx = o[0] - c.x;
  const rz = o[2] - c.z;
  const lo: Vec3 = [rx * cos - rz * sin, o[1] - c.y, rx * sin + rz * cos];
  const ld: Vec3 = [d[0] * cos - d[2] * sin, d[1], d[0] * sin + d[2] * cos];
  const head = rayBox(lo, ld, HEAD, max);
  const body = rayBox(lo, ld, BODY, max);
  if (head === null && body === null) return null;
  if (body === null || (head !== null && head <= body)) return { t: head!, head: true };
  return { t: body, head: false };
}

/** The direction a hound faces when looking from (x, z) towards (tx, tz). */
export function yawTowards(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}
