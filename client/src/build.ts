// Works out where a building piece would go from where the player is looking, Fortnite style:
// walls snap to the tile edge you face, other pieces to the tile you aim at, and aiming at an
// existing piece builds onto it. Foundations sit level on the ground; roofs go on top of walls.

import * as THREE from 'three';
import { BUILD_RANGE } from '../../shared/constants.ts';
import {
  STOREY,
  TILE,
  buildBaseY,
  foundationTop,
  isSlope,
  pieceBounds,
  pieceKey,
  type Box,
  type Piece,
  type PieceKind,
} from '../../shared/building.ts';
import type { Material } from '../../shared/world.ts';
import type { World } from './world.ts';

export interface AimHit {
  point: THREE.Vector3;
  /** The piece under the crosshair, if any. */
  piece: Piece | null;
}

/** Distance from a point to the nearest point of a box. */
export function distanceToBox(p: THREE.Vector3, b: Box): number {
  const d = [p.x, p.y, p.z].map((v, a) => Math.max(b.min[a] - v, 0, v - b.max[a]));
  return Math.hypot(d[0], d[1], d[2]);
}

export function inReach(eye: THREE.Vector3, piece: Piece): boolean {
  return distanceToBox(eye, pieceBounds(piece)) <= BUILD_RANGE;
}

/**
 * Proposes a piece of the given kind for the current aim. Returns null if nothing sensible
 * is in reach. The server re-checks everything.
 */
export function proposePiece(
  world: World,
  kind: PieceKind,
  material: Material,
  aim: AimHit | null,
  eye: THREE.Vector3,
  lookDir: THREE.Vector3,
  feetY: number,
): Piece | null {
  // Aim point: what the crosshair hits, or a point in the air a few metres ahead.
  let point: THREE.Vector3;
  let baseY: number;
  if (aim && aim.point.distanceTo(eye) <= BUILD_RANGE + 1) {
    point = aim.point.clone().addScaledVector(lookDir, -0.15);
    baseY = aim.piece ? baseFromPiece(kind, aim.piece, aim.point) : buildBaseY(world.seed, point.x, point.z);
  } else {
    point = eye.clone().addScaledVector(lookDir, 4);
    baseY = Math.round(feetY);
  }

  // Facing: the main horizontal axis the player looks along.
  const alongX = Math.abs(lookDir.x) > Math.abs(lookDir.z);
  const sign = alongX ? Math.sign(lookDir.x) || 1 : Math.sign(lookDir.z) || 1;
  const facing = alongX ? (sign > 0 ? 1 : 3) : sign > 0 ? 0 : 2; // stairs direction code

  let i = Math.floor(point.x / TILE);
  let k = Math.floor(point.z / TILE);
  let dir = 0;
  if (kind === 'wall') {
    // A wall goes on the nearest tile edge across the direction you face.
    if (alongX) {
      i = Math.round(point.x / TILE);
      dir = 1;
    } else {
      k = Math.round(point.z / TILE);
      dir = 0;
    }
  } else if (kind === 'stairs' || kind === 'ramp') {
    dir = facing;
  }
  // A foundation on open ground levels itself over the tile, whatever the slope.
  if (kind === 'foundation' && aim?.piece?.kind !== 'foundation') baseY = foundationTop(world.seed, i, k);

  const make = (ii: number, yy: number, kk: number): Piece => ({
    kind,
    i: ii,
    y: yy,
    k: kk,
    dir,
    material,
    edit: 'solid',
    hp: 1,
  });
  const STEPS = [
    [0, 1],
    [1, 0],
    [0, -1],
    [-1, 0],
  ];
  // Aiming at stairs with stairs selected (or a ramp with a ramp) continues the flight upwards.
  if (isSlope({ kind }) && aim?.piece?.kind === kind) {
    dir = aim.piece.dir;
    const [di, dk] = STEPS[dir];
    i = aim.piece.i + di;
    k = aim.piece.k + dk;
  }
  let piece = make(i, baseY, k);

  // Aiming at a spot that is already built: extend the build instead.
  if (world.pieces.has(pieceKey(piece))) {
    if (kind === 'wall') piece = make(i, baseY + STOREY, k);
    else if (kind === 'floor' || kind === 'foundation') piece = make(alongX ? i + sign : i, baseY, alongX ? k : k + sign);
    else if (kind === 'roof') return null;
    else piece = make(i + STEPS[dir][0], baseY + STOREY, k + STEPS[dir][1]);
    if (world.pieces.has(pieceKey(piece))) return null;
  }
  return inReach(eye, piece) ? piece : null;
}

/** Which height to build at when aiming at an existing piece. */
function baseFromPiece(kind: PieceKind, target: Piece, hit: THREE.Vector3): number {
  // A roof caps whatever it is aimed at: the top of a wall, or a storey above anything else.
  if (kind === 'roof') return target.kind === 'roof' ? target.y : target.y + STOREY;
  // Everything builds on top of a foundation, and foundations extend at the same height.
  if (target.kind === 'foundation') return target.y;
  if (target.kind === 'roof') return target.y;
  if (target.kind === 'floor') return target.y;
  if (isSlope(target)) return kind === target.kind ? target.y + STOREY : target.y;
  // A wall: floors go on top when you aim at its upper half, everything else beside it.
  const upper = hit.y > target.y + STOREY / 2;
  if (kind === 'floor') return upper ? target.y + STOREY : target.y;
  return target.y;
}
