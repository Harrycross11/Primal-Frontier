// The solid parts of the world that stop a bullet and that a survivor can hide behind: tree
// trunks, boulders, car wrecks and the walls of the landmarks. Shared so the server's shots
// and its bots see the same cover the client draws.

import type { Box } from './building.ts';
import { rayBox, type Vec3 } from './combat.ts';
import { landmarks, toWorld } from './landmarks.ts';
import { mulberry32 } from './terrain.ts';
import { generateDecor, type ResourceKind, type ResourceNode } from './world.ts';

/**
 * One piece of cover: an upright cylinder (`r`) or a box turned by `rot` about its middle
 * (`hx`, `hz` half its width and depth), from `y` up to `top`.
 */
export interface Cover {
  x: number;
  z: number;
  y: number;
  top: number;
  r?: number;
  hx?: number;
  hz?: number;
  rot?: number;
  /** A gatherable node: cover only while there is something left of it. */
  node?: ResourceNode;
}

/** How tall the five scanned boulders are, in the order of BOULDERS in client/src/models.ts. */
const BOULDER_TOPS = [0.75, 1.06, 1.68, 0.85, 1.18];

/**
 * How each kind of resource stands, per unit of its scale: how wide its solid core is and how
 * tall each of its drawn models is. Measured from the models (.smoke/measure.ts). Hemp,
 * mushrooms and barrels hide nobody.
 */
const SOLID: Partial<Record<ResourceKind, { r?: number; hx?: number; hz?: number; tops: number[]; pick: 'rand' | 'id' }>> = {
  tree: { r: 0.32, tops: [8.9, 7.9], pick: 'id' },
  deadTree: { r: 0.22, tops: [4.4, 5.9, 3.5, 4.5], pick: 'id' },
  stone: { r: 1, tops: BOULDER_TOPS, pick: 'rand' },
  metalOre: { r: 1, tops: BOULDER_TOPS, pick: 'rand' },
  sulfurOre: { r: 1, tops: BOULDER_TOPS, pick: 'rand' },
  hqmOre: { r: 1, tops: BOULDER_TOPS, pick: 'rand' },
  scrap: { hx: 2.4, hz: 1.1, tops: [1.44, 1.35, 1.3, 1.32, 1.69, 1.42], pick: 'rand' },
};

/**
 * Which of a kind's models the client draws for a node: trees go by id, boulders and wrecks by
 * the first number from the node's own random stream (see addResources in client/src/world.ts).
 */
function variant(n: ResourceNode, count: number, pick: 'rand' | 'id'): number {
  return pick === 'id' ? n.id % count : Math.floor(mulberry32(n.id * 7 + 3)() * count);
}

const CELL = 8;

export class CoverMap {
  private cells = new Map<number, Cover[]>();
  readonly all: Cover[] = [];

  constructor(seed: number, nodes: ResourceNode[]) {
    for (const n of nodes) {
      const s = SOLID[n.kind];
      if (!s) continue;
      const k = n.scale;
      const top = n.y + s.tops[variant(n, s.tops.length, s.pick)] * k;
      this.add({ x: n.x, z: n.z, y: n.y - 0.2, top, r: s.r && s.r * k, hx: s.hx && s.hx * k, hz: s.hz && s.hz * k, rot: n.rot, node: n });
    }
    // The bigger boulders strewn about, as solid as the client makes them.
    for (const d of generateDecor(seed)) {
      if (d.kind === 'rock' && d.scale > 1) this.add({ x: d.x, z: d.z, y: d.y - 1, top: d.y + d.scale * 0.8, r: d.scale * 0.7 });
    }
    // Each landmark's buildings and containers, box by box.
    for (const { site, landmark } of landmarks(seed)) {
      for (const prop of landmark.props) {
        const [px, pz] = toWorld(site, prop.x, prop.z);
        const turned = { ...site, x: px, z: pz, turn: prop.turn + site.turn };
        const y = site.y + (prop.y ?? 0);
        for (const [x0, x1, z0, z1, h] of prop.solid ?? []) {
          const a = toWorld(turned, x0, z0);
          const b = toWorld(turned, x1, z1);
          this.add({ x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, y: y - 0.5, top: y + h, hx: Math.abs(a[0] - b[0]) / 2, hz: Math.abs(a[1] - b[1]) / 2, rot: 0 });
        }
      }
    }
  }

  private add(c: Cover) {
    this.all.push(c);
    const reach = c.r ?? Math.hypot(c.hx!, c.hz!);
    for (let i = Math.floor((c.x - reach) / CELL); i <= Math.floor((c.x + reach) / CELL); i++) {
      for (let k = Math.floor((c.z - reach) / CELL); k <= Math.floor((c.z + reach) / CELL); k++) {
        const key = cellKey(i, k);
        const list = this.cells.get(key);
        if (list) list.push(c);
        else this.cells.set(key, [c]);
      }
    }
  }

  /** Cover standing within `range` of a point. */
  near(x: number, z: number, range: number): Cover[] {
    const out = new Set<Cover>();
    for (let i = Math.floor((x - range) / CELL); i <= Math.floor((x + range) / CELL); i++) {
      for (let k = Math.floor((z - range) / CELL); k <= Math.floor((z + range) / CELL); k++) {
        for (const c of this.cells.get(cellKey(i, k)) ?? []) {
          if (standing(c) && Math.hypot(c.x - x, c.z - z) < range + (c.r ?? Math.max(c.hx!, c.hz!))) out.add(c);
        }
      }
    }
    return [...out];
  }

  /** How far a ray goes before it meets cover, or null if it gets `max` metres clear. */
  ray(o: Vec3, d: Vec3, max: number): number | null {
    let best: number | null = null;
    const seen = new Set<Cover>();
    // Walk the cells the ray crosses, half a cell at a time, nearest first.
    let ci = NaN;
    let ck = NaN;
    for (let t = 0; t <= max + CELL / 2; t += CELL / 2) {
      if (best !== null && t > best + CELL) break;
      const s = Math.min(t, max);
      const i = Math.floor((o[0] + d[0] * s) / CELL);
      const k = Math.floor((o[2] + d[2] * s) / CELL);
      if (i === ci && k === ck) continue;
      ci = i;
      ck = k;
      for (let di = -1; di <= 1; di++) {
        for (let dk = -1; dk <= 1; dk++) {
          for (const c of this.cells.get(cellKey(i + di, k + dk)) ?? []) {
            if (seen.has(c)) continue;
            seen.add(c);
            if (!standing(c)) continue;
            const hit = rayCover(o, d, c, best ?? max);
            if (hit !== null) best = hit;
          }
        }
      }
    }
    return best;
  }

  /** True if (x, z) at feet height `y` is inside a piece of cover, with `pad` metres to spare. */
  solidAt(x: number, y: number, z: number, pad: number): boolean {
    for (const c of this.cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? []) {
      if (!standing(c) || y + 0.4 < c.y || y + 0.4 > c.top) continue;
      if (c.r !== undefined) {
        if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
        continue;
      }
      const [lx, lz] = local(c, x, z);
      if (Math.abs(lx) < c.hx! + pad && Math.abs(lz) < c.hz! + pad) return true;
    }
    return false;
  }
}

function cellKey(i: number, k: number): number {
  return (i + 4096) * 8192 + (k + 4096);
}

function standing(c: Cover): boolean {
  return !c.node || c.node.amount > 0;
}

/** A point in a box's own turned frame. */
function local(c: Cover, x: number, z: number): [number, number] {
  const cos = Math.cos(c.rot ?? 0);
  const sin = Math.sin(c.rot ?? 0);
  const dx = x - c.x;
  const dz = z - c.z;
  // Undo three.js's turn about y (x' = x cos + z sin, z' = -x sin + z cos).
  return [dx * cos - dz * sin, dx * sin + dz * cos];
}

/** Where a ray enters one piece of cover, or null if it misses within `max`. */
export function rayCover(o: Vec3, d: Vec3, c: Cover, max: number): number | null {
  if (c.r !== undefined) {
    // An upright cylinder: solve in x and z, then check the height where it goes in.
    const ox = o[0] - c.x;
    const oz = o[2] - c.z;
    const a = d[0] * d[0] + d[2] * d[2];
    const cc = ox * ox + oz * oz - c.r * c.r;
    // From inside it (a shot from someone standing in a tree's roots) it is no cover.
    if (cc <= 0 || a < 1e-9) return null;
    const b = ox * d[0] + oz * d[2];
    const disc = b * b - a * cc;
    if (disc < 0 || b > 0) return null;
    const t = (-b - Math.sqrt(disc)) / a;
    if (t > max) return null;
    const y = o[1] + d[1] * t;
    if (y >= c.y && y <= c.top) return t;
    // Over the top, it may still come down through it: where it crosses the top inside the circle.
    if (y > c.top && d[1] < 0) {
      const tp = (c.top - o[1]) / d[1];
      if (tp <= max && Math.hypot(ox + d[0] * tp, oz + d[2] * tp) <= c.r) return tp;
    }
    return null;
  }
  const [lx, lz] = local(c, o[0], o[2]);
  const [dx, dz] = local({ ...c, x: 0, z: 0 }, d[0], d[2]);
  if (Math.abs(lx) < c.hx! && Math.abs(lz) < c.hz! && o[1] > c.y && o[1] < c.top) return null;
  const box: Box = { min: [-c.hx!, c.y, -c.hz!], max: [c.hx!, c.top, c.hz!] };
  return rayBox([lx, o[1], lz], [dx, d[1], dz], box, max);
}

/** How far a piece of cover reaches out from its middle along the direction (ux, uz). */
export function coverExtent(c: Cover, ux: number, uz: number): number {
  if (c.r !== undefined) return c.r;
  const cos = Math.cos(c.rot ?? 0);
  const sin = Math.sin(c.rot ?? 0);
  // Its own x axis lies along (cos, -sin) in the world, its z axis along (sin, cos).
  return Math.abs(ux * cos - uz * sin) * c.hx! + Math.abs(ux * sin + uz * cos) * c.hz!;
}
