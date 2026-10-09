// Animal bodies and how they get about: the state the server keeps for each hound or other
// animal (all called hounds here, after the first of them), and steering over the ground
// around buildings. The decisions (who to chase, when to bite, taming)
// are in game.ts, which owns the players they hunt.

import { HALF_WORLD } from '../shared/constants.ts';
import { SPECIES, type CreatureAnim, type CreatureState, type Species, yawTowards } from '../shared/creatures.ts';
import { TILE, pieceBoxes, type Piece } from '../shared/building.ts';
import { terrainHeight } from '../shared/terrain.ts';

/** Someone a hound can go for: a player, or another hound. */
export type Prey = { kind: 'player' | 'hound'; id: number };

export interface Hound {
  id: number;
  species: Species;
  /** The pack it was born into (a tame hound has left it). */
  pack: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  anim: CreatureAnim;
  /** A one-off animation (a bite, a flinch, eating) plays until this time, in ms. */
  animUntil: number;
  target: Prey | null;
  /** Where it is wandering to, and when it next sets off. */
  wanderTo: [number, number] | null;
  restUntil: number;
  nextBiteAt: number;
  /** A wild hound badly hurt runs from this spot until the time given. */
  fleeFrom: [number, number] | null;
  fleeUntil: number;
  /** When it died (ms), or 0 while alive. */
  deadAt: number;
  owner: number | null;
  name: string | null;
  /** Cooked meat taken towards taming, from whom, and until when it stays calm towards them. */
  fed: number;
  fedBy: number | null;
  calmUntil: number;
  /** The player riding it. */
  rider: number | null;
}

/** A tame hound as it is saved: its owner keeps the same player id when they come back. */
export interface SavedHound {
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  owner: number;
  name: string;
  species?: Species;
}

const RADIUS = 0.35;
/** The height band a hound's body fills, above its feet. */
const BODY_LOW = 0.15;
const BODY_HIGH = 0.85;
/** Radians a second it can turn. */
const TURN = 7;

export function newHound(id: number, pack: number, x: number, z: number, seed: number, yaw = 0, species: Species = 'ashhound'): Hound {
  return {
    id,
    species,
    pack,
    x,
    y: terrainHeight(seed, x, z),
    z,
    yaw,
    hp: SPECIES[species].maxHp,
    anim: 'idle',
    animUntil: 0,
    target: null,
    wanderTo: null,
    restUntil: 0,
    nextBiteAt: 0,
    fleeFrom: null,
    fleeUntil: 0,
    deadAt: 0,
    owner: null,
    name: null,
    fed: 0,
    fedBy: null,
    calmUntil: 0,
    rider: null,
  };
}

/** How far an animal's body reaches out from its middle, for bumping into things. */
export function bodyRadius(species: Species): number {
  return species === 'ashhound' ? RADIUS : SPECIES[species].width * 0.6;
}

/** Would a hound standing here be inside a wall, floor or other building piece? */
export function blocked(pieces: Iterable<Piece>, x: number, y: number, z: number, radius = RADIUS): boolean {
  for (const piece of pieces) {
    // Each piece lies within its grid tile, so only the tiles around the hound can touch it.
    if (Math.abs((piece.i + 0.5) * TILE - x) > TILE || Math.abs((piece.k + 0.5) * TILE - z) > TILE) continue;
    for (const b of pieceBoxes(piece)) {
      if (b.max[1] < y + BODY_LOW || b.min[1] > y + BODY_HIGH) continue;
      const dx = Math.max(b.min[0] - x, 0, x - b.max[0]);
      const dz = Math.max(b.min[2] - z, 0, z - b.max[2]);
      if (dx * dx + dz * dz < radius * radius) return true;
    }
  }
  return false;
}

/**
 * Moves a hound up to `speed * dt` towards (tx, tz), stopping `stop` metres short, sliding
 * along walls it runs into. Returns how far it went.
 */
export function steer(h: Hound, tx: number, tz: number, speed: number, dt: number, stop: number, seed: number, pieces: Map<string, Piece>): number {
  const dx = tx - h.x;
  const dz = tz - h.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 0.05) turnTo(h, yawTowards(h.x, h.z, tx, tz), dt);
  const step = Math.min(speed * dt, dist - stop);
  if (step <= 0.001) return 0;
  const sx = (dx / dist) * step;
  const sz = (dz / dist) * step;
  for (const [mx, mz] of [
    [sx, sz],
    [sx, 0],
    [0, sz],
  ]) {
    const x = Math.max(-HALF_WORLD + 1, Math.min(HALF_WORLD - 1, h.x + mx));
    const z = Math.max(-HALF_WORLD + 1, Math.min(HALF_WORLD - 1, h.z + mz));
    const y = terrainHeight(seed, x, z);
    if (blocked(pieces.values(), x, y, z, bodyRadius(h.species))) continue;
    const moved = Math.hypot(x - h.x, z - h.z);
    h.x = x;
    h.y = y;
    h.z = z;
    return moved;
  }
  return 0;
}

/** Turns towards a heading at the hound's turning speed. */
export function turnTo(h: Hound, yaw: number, dt: number) {
  let d = yaw - h.yaw;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  h.yaw += Math.max(-TURN * dt, Math.min(TURN * dt, d));
}

/** Pushes hounds standing in each other apart. */
export function spread(hounds: Hound[]) {
  for (let a = 0; a < hounds.length; a++) {
    for (let b = a + 1; b < hounds.length; b++) {
      const p = hounds[a];
      const q = hounds[b];
      if (p.deadAt || q.deadAt) continue;
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const d = Math.hypot(dx, dz);
      const gap = p.species === 'ashhound' && q.species === 'ashhound' ? 0.9 : (bodyRadius(p.species) + bodyRadius(q.species)) * 1.4;
      if (d >= gap || d < 1e-4) continue;
      // A ridden animal goes where its rider steers it, so only the other one gives way.
      const push = (gap - d) / (p.rider !== null || q.rider !== null ? 1 : 2);
      if (p.rider !== null) {
        q.x += (dx / d) * push;
        q.z += (dz / d) * push;
        continue;
      }
      if (q.rider !== null) {
        p.x -= (dx / d) * push;
        p.z -= (dz / d) * push;
        continue;
      }
      p.x -= (dx / d) * push;
      p.z -= (dz / d) * push;
      q.x += (dx / d) * push;
      q.z += (dz / d) * push;
    }
  }
}

export function houndState(h: Hound): CreatureState {
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    id: h.id,
    x: r(h.x),
    y: r(h.y),
    z: r(h.z),
    yaw: r(h.yaw),
    hp: r(Math.max(0, h.hp) / SPECIES[h.species].maxHp),
    anim: h.anim,
    ...(h.species !== 'ashhound' && { species: h.species }),
    ...(h.owner !== null && { owner: h.owner, name: h.name ?? SPECIES[h.species].name }),
    ...(h.fed > 0 && h.owner === null && { fed: h.fed }),
    ...(h.rider !== null && { rider: h.rider }),
  };
}
