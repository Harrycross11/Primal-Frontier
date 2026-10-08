// The wildlife: Ashhounds, mutated wild dogs that hunt in packs, and one big animal native to
// each land that can be tamed and ridden. Shared so the client knows their size and speed, and
// can tell what a hit or a feed will do.

import { HALF_WORLD } from './constants.ts';
import { rayBox, type Vec3 } from './combat.ts';
import { CORE_RADIUS, biomeAt, type BiomeId } from './biomes.ts';
import type { ItemId } from './items.ts';
import { mulberry32 } from './terrain.ts';
import { generateDecor } from './world.ts';
import { atLandmark } from './landmarks.ts';

/** What a hound is doing, for its animation: `snarl` is squaring up to a fight between bites. */
export type CreatureAnim = 'idle' | 'snarl' | 'walk' | 'trot' | 'run' | 'attack' | 'hit' | 'eat' | 'dead';

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
  /** What it is (an Ashhound when left out). */
  species?: Species;
  /** The player riding it. */
  rider?: number;
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

/** The animals: Ashhounds, and the one big animal native to each land. */
export type Species = 'ashhound' | 'mule' | 'elk' | 'buffalo' | 'camel' | 'bear';

/**
 * How an animal takes to people: hunters go for anyone who comes near, defenders leave you be
 * until you hurt one of the herd, and skittish ones run from anyone who comes at them fast.
 */
export type Temper = 'hunter' | 'defender' | 'skittish';

export interface SpeciesInfo {
  name: string;
  /** The land it lives in, or null for the Ashhounds' packs (placed by packDens). */
  land: BiomeId | null;
  temper: Temper;
  maxHp: number;
  walk: number;
  run: number;
  /** Damage of a bite, gore or kick, how close it has to be and how often. */
  bite: number;
  biteRange: number;
  biteEvery: number;
  sight: number;
  leash: number;
  /** Below this share of its health a wild one runs off. */
  flee: number;
  respawn: number;
  /** What it will take from your hand, and how many to tame it. */
  food: ItemId;
  tameFeeds: number;
  meat: [number, number];
  /** Height of its back, and its length nose to tail, in metres: its body for hits and bumping. */
  height: number;
  length: number;
  width: number;
  /** How many wander together, and how many such herds there are. */
  herd: number;
  herds: number;
  /** Ridden: its pace at a walk and flat out, and how high the saddle sits. */
  ride?: { walk: number; sprint: number; seat: number };
  /** While you ride it you get thirsty this much slower or faster. */
  thirst?: number;
}

export const SPECIES: Record<Species, SpeciesInfo> = {
  ashhound: {
    name: 'Ashhound',
    land: null,
    temper: 'hunter',
    maxHp: ASHHOUND.maxHp,
    walk: ASHHOUND.walk,
    run: ASHHOUND.run,
    bite: ASHHOUND.bite,
    biteRange: ASHHOUND.biteRange,
    biteEvery: ASHHOUND.biteEvery,
    sight: ASHHOUND.sight,
    leash: ASHHOUND.leash,
    flee: ASHHOUND.flee,
    respawn: ASHHOUND.respawn,
    food: 'cookedMeat',
    tameFeeds: ASHHOUND.tameFeeds,
    meat: [...ASHHOUND.meat],
    height: 0.92,
    length: 1.5,
    width: 0.46,
    herd: 3,
    herds: 5,
  },
  // The Ashlands' scruffy donkeys, left behind by the traders who used to work the roads.
  mule: {
    name: 'Ash Mule',
    land: 'ashlands',
    temper: 'skittish',
    maxHp: 160,
    walk: 1.3,
    run: 7,
    bite: 14,
    biteRange: 2.2,
    biteEvery: 1.6,
    sight: 9,
    leash: 45,
    flee: 1,
    respawn: 300,
    food: 'feedSack',
    tameFeeds: 2,
    meat: [4, 6],
    height: 1.35,
    length: 2,
    width: 0.6,
    herd: 3,
    herds: 2,
    ride: { walk: 6, sprint: 10.5, seat: 1.25 },
  },
  // Big-antlered stags in the dead forest: hard to get near, the fastest thing to ride.
  elk: {
    name: 'Deadwood Elk',
    land: 'deadwood',
    temper: 'skittish',
    maxHp: 150,
    walk: 1.4,
    run: 11,
    bite: 16,
    biteRange: 2.4,
    biteEvery: 1.5,
    sight: 14,
    leash: 55,
    flee: 1,
    respawn: 360,
    food: 'feedSack',
    tameFeeds: 3,
    meat: [6, 9],
    height: 1.55,
    length: 2.4,
    width: 0.65,
    herd: 3,
    herds: 2,
    ride: { walk: 7, sprint: 14, seat: 1.5 },
  },
  // Horned buffalo on the red rock: they graze in peace until one is hurt, then the herd charges.
  buffalo: {
    name: 'Mesa Buffalo',
    land: 'mesa',
    temper: 'defender',
    maxHp: 320,
    walk: 1.2,
    run: 8,
    bite: 24,
    biteRange: 2.6,
    biteEvery: 1.6,
    sight: 16,
    leash: 45,
    flee: 0,
    respawn: 420,
    food: 'feedSack',
    tameFeeds: 4,
    meat: [8, 12],
    height: 1.7,
    length: 2.8,
    width: 0.9,
    herd: 4,
    herds: 2,
    ride: { walk: 5.5, sprint: 9.5, seat: 1.8 },
  },
  // Camels on the sulfur flats: slow to tire, and they carry water, so riders hardly get thirsty.
  camel: {
    name: 'Dune Camel',
    land: 'flats',
    temper: 'skittish',
    maxHp: 220,
    walk: 1.3,
    run: 8,
    bite: 12,
    biteRange: 2.4,
    biteEvery: 1.6,
    sight: 10,
    leash: 50,
    flee: 1,
    respawn: 360,
    food: 'feedSack',
    tameFeeds: 3,
    meat: [7, 10],
    height: 1.9,
    length: 2.6,
    width: 0.7,
    herd: 3,
    herds: 2,
    ride: { walk: 6, sprint: 11.5, seat: 2 },
    thirst: 0.25,
  },
  // Great bears in the snow: they hunt anyone who strays close, and fight for whoever tames one.
  bear: {
    name: 'Frost Bear',
    land: 'frost',
    temper: 'hunter',
    maxHp: 420,
    walk: 1.4,
    run: 9,
    bite: 30,
    biteRange: 2.5,
    biteEvery: 1.8,
    sight: 16,
    leash: 40,
    flee: 0.15,
    respawn: 480,
    food: 'cookedMeat',
    tameFeeds: 5,
    meat: [10, 14],
    height: 1.35,
    length: 2.3,
    width: 0.9,
    herd: 1,
    herds: 3,
    ride: { walk: 6, sprint: 11, seat: 1.35 },
  },
};

export const LAND_SPECIES = (Object.keys(SPECIES) as Species[]).filter((s) => SPECIES[s].land);

/** Tame animals each survivor can have at once that are ridden, besides their hounds. */
export const MAX_MOUNTS = 2;

/** How far you can be from your own animal to climb on. */
export const MOUNT_RANGE = 3.5;

/** A group of animals that live together: a hound pack round its den, or a herd on its range. */
export interface Herd {
  species: Species;
  x: number;
  z: number;
  size: number;
}

const herdCache = new Map<number, Herd[]>();

/**
 * Every pack and herd on the map: the Ashhound packs first (where packDens puts them), then
 * each land's herds, out in that land away from the ruins and landmarks.
 */
export function herds(seed: number): Herd[] {
  const cached = herdCache.get(seed);
  if (cached) return cached;
  const out: Herd[] = packDens(seed).map(([x, z]) => ({ species: 'ashhound' as Species, x, z, size: PACK_SIZE }));
  const rand = mulberry32(seed ^ 0x2545f491);
  for (const species of LAND_SPECIES) {
    const info = SPECIES[species];
    for (let n = 0; n < info.herds; n++) {
      let spot: [number, number] | null = null;
      for (let tries = 0; tries < 600 && !spot; tries++) {
        const angle = rand() * Math.PI * 2;
        const r = (info.land === 'ashlands' ? 30 : CORE_RADIUS + 25) + rand() * HALF_WORLD * 0.8;
        const x = Math.cos(angle) * r;
        const z = Math.sin(angle) * r;
        if (Math.abs(x) > HALF_WORLD * 0.88 || Math.abs(z) > HALF_WORLD * 0.88) continue;
        if (biomeAt(seed, x, z) !== info.land || !clearOfRuins(seed, x, z, 14)) continue;
        if (out.some((h) => Math.hypot(h.x - x, h.z - z) < 50)) continue;
        spot = [x, z];
      }
      if (spot) out.push({ species, x: spot[0], z: spot[1], size: info.herd });
    }
  }
  herdCache.set(seed, out);
  return out;
}

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

/** An animal's body and head boxes, in its own frame, scaled from its size. */
export function creatureBoxes(species: Species = 'ashhound'): { body: { min: Vec3; max: Vec3 }; head: { min: Vec3; max: Vec3 } } {
  if (species === 'ashhound') return { body: BODY, head: HEAD };
  const { height: h, length: l, width: w } = SPECIES[species];
  return {
    body: { min: [-w / 2, h * 0.3, -l * 0.55], max: [w / 2, h * 1.05, l * 0.3] },
    head: { min: [-w * 0.35, h * 0.6, l * 0.3], max: [w * 0.35, h * 1.3, l * 0.55] },
  };
}

/** Where a ray hits an animal, if it does, and whether on the head. */
export function rayCreature(o: Vec3, d: Vec3, c: { x: number; y: number; z: number; yaw: number; species?: Species }, max: number): { t: number; head: boolean } | null {
  const { body: BODY, head: HEAD } = creatureBoxes(c.species);
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
