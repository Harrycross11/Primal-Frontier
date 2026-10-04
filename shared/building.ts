// Fortnite-style building: walls, floors and stairs snapped to a grid of 3 m tiles.
// Walls can be edited into windows, doors and half walls. Shared by client and server so
// both agree on where pieces sit, what they cost and what space they take up.

import { HALF_WORLD } from './constants.ts';
import { terrainHeight } from './terrain.ts';
import type { Material } from './world.ts';

/** Width of one building tile, in metres. */
export const TILE = 3;
/** Height of one wall or one flight of stairs, in metres. */
export const STOREY = 3;
/** Thickness of walls and floors. */
export const THICK = 0.2;

export type PieceKind = 'wall' | 'floor' | 'stairs';
export type WallEdit = 'solid' | 'window' | 'door' | 'half';
export const WALL_EDITS: WallEdit[] = ['solid', 'window', 'door', 'half'];

/**
 * A placed piece. (i, k) is the tile, y is the bottom height in whole metres.
 * dir: for walls 0 = runs along x on the tile's -z edge, 1 = runs along z on the tile's -x edge;
 * for stairs, the direction they rise towards: 0 = +z, 1 = +x, 2 = -z, 3 = -x.
 */
export interface Piece {
  kind: PieceKind;
  i: number;
  y: number;
  k: number;
  dir: number;
  material: Material;
  edit: WallEdit;
  hp: number;
}

export type Box = { min: [number, number, number]; max: [number, number, number] };

export const PIECE_COST = 10;
export const MAX_HP: Record<Material, number> = { wood: 150, scrap: 300 };
/** Damage a bare-handed hit does to a building piece. */
export const HIT_DAMAGE = 50;

export function pieceKey(p: Pick<Piece, 'kind' | 'i' | 'y' | 'k' | 'dir'>): string {
  const dir = p.kind === 'floor' ? 0 : p.dir;
  return `${p.kind}:${p.i},${p.y},${p.k},${dir}`;
}

function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Box {
  return { min: [x0, y0, z0], max: [x1, y1, z1] };
}

/** The solid boxes a wall is made of, along its length a (0..TILE) and height h (0..STOREY). */
function wallParts(edit: WallEdit): [number, number, number, number][] {
  const S = TILE;
  const H = STOREY;
  switch (edit) {
    case 'solid':
      return [[0, 0, S, H]];
    case 'half':
      return [[0, 0, S, H / 2]];
    case 'window':
      return [
        [0, 0, S, 1.1],
        [0, 2.1, S, H],
        [0, 1.1, 0.9, 2.1],
        [S - 0.9, 1.1, S, 2.1],
      ];
    case 'door':
      return [
        [0, 0, S / 2 - 0.65, H],
        [S / 2 + 0.65, 0, S, H],
        [S / 2 - 0.65, 2.3, S / 2 + 0.65, H],
      ];
  }
}

/** Solid boxes used for collision and drawing. Stairs return their steps. */
export function pieceBoxes(p: Piece): Box[] {
  const x0 = p.i * TILE;
  const z0 = p.k * TILE;
  const t = THICK / 2;
  if (p.kind === 'floor') return [box(x0, p.y - THICK, z0, x0 + TILE, p.y, z0 + TILE)];
  if (p.kind === 'wall') {
    return wallParts(p.edit).map(([a0, h0, a1, h1]) =>
      p.dir === 0
        ? box(x0 + a0, p.y + h0, z0 - t, x0 + a1, p.y + h1, z0 + t)
        : box(x0 - t, p.y + h0, z0 + a0, x0 + t, p.y + h1, z0 + a1),
    );
  }
  // Stairs: steps rising across the tile.
  const steps = 6;
  const out: Box[] = [];
  for (let s = 0; s < steps; s++) {
    const a0 = (s / steps) * TILE;
    const a1 = ((s + 1) / steps) * TILE;
    const top = p.y + ((s + 1) / steps) * STOREY;
    const [u0, u1] = p.dir === 0 || p.dir === 1 ? [a0, a1] : [TILE - a1, TILE - a0];
    out.push(
      p.dir % 2 === 0
        ? box(x0, p.y, z0 + u0, x0 + TILE, top, z0 + u1)
        : box(x0 + u0, p.y, z0, x0 + u1, top, z0 + TILE),
    );
  }
  return out;
}

/** The space a piece occupies, as one box. */
export function pieceBounds(p: Piece): Box {
  const boxes = pieceBoxes(p);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], b.min[a]);
      max[a] = Math.max(max[a], b.max[a]);
    }
  }
  if (p.kind === 'wall') {
    // An edited wall still claims its whole frame, so it connects to neighbours the same way.
    max[1] = Math.max(max[1], p.y + STOREY);
  }
  return { min, max };
}

/** Height of a stairs surface at (x, z), or null when (x, z) is outside the stairs. */
export function stairsHeight(p: Piece, x: number, z: number): number | null {
  const x0 = p.i * TILE;
  const z0 = p.k * TILE;
  if (x < x0 || x > x0 + TILE || z < z0 || z > z0 + TILE) return null;
  const u = [(z - z0) / TILE, (x - x0) / TILE, 1 - (z - z0) / TILE, 1 - (x - x0) / TILE][p.dir];
  return p.y + Math.min(Math.max(u, 0), 1) * STOREY;
}

export function boxesTouch(a: Box, b: Box, pad = 0.05): boolean {
  for (let i = 0; i < 3; i++) {
    if (a.min[i] > b.max[i] + pad || b.min[i] > a.max[i] + pad) return false;
  }
  return true;
}

export function validPieceShape(p: Piece): boolean {
  const ints = [p.i, p.y, p.k, p.dir].every(Number.isInteger);
  const dirOk = p.kind === 'wall' ? p.dir === 0 || p.dir === 1 : p.kind === 'stairs' ? p.dir >= 0 && p.dir < 4 : true;
  const limit = HALF_WORLD * 0.85;
  return (
    ints &&
    dirOk &&
    ['wall', 'floor', 'stairs'].includes(p.kind) &&
    ['wood', 'scrap'].includes(p.material) &&
    WALL_EDITS.includes(p.edit) &&
    Math.abs(p.i * TILE) < limit &&
    Math.abs(p.k * TILE) < limit &&
    p.y > -20 &&
    p.y < 60
  );
}

/**
 * A piece must rest on the ground or touch another piece, and must not be buried.
 */
export function pieceSupported(seed: number, p: Piece, others: Iterable<Piece>): boolean {
  const b = pieceBounds(p);
  const samples: number[] = [];
  for (const fx of [0, 0.5, 1]) {
    for (const fz of [0, 0.5, 1]) {
      samples.push(terrainHeight(seed, b.min[0] + (b.max[0] - b.min[0]) * fx, b.min[2] + (b.max[2] - b.min[2]) * fz));
    }
  }
  const lowest = Math.min(...samples);
  const highest = Math.max(...samples);
  if (b.max[1] < highest - 0.1 && p.kind !== 'floor') return false; // fully buried
  if (p.kind === 'floor' && p.y < lowest - 0.5) return false;
  if (b.min[1] <= highest + 0.6) return true;
  for (const o of others) if (boxesTouch(b, pieceBounds(o))) return true;
  return false;
}

/** Ground height to build from at a point: whole metres, so neighbouring pieces line up. */
export function buildBaseY(seed: number, x: number, z: number): number {
  return Math.round(terrainHeight(seed, x, z));
}
