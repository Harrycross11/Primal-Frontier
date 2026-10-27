// A check for things that hover over the ground or sink into it: for each object, how high its
// lowest point is above the drawn ground, and how high the worst corner of its footprint is
// (one side in the air on a slope). Called from the test hooks (window.__pf.ground) by the
// screenshot scripts; players never run it.

import * as THREE from 'three';
import { WORLD_SIZE } from '../../shared/constants.ts';
import { terrainHeight } from '../../shared/terrain.ts';

/** The terrain mesh's grid (world.ts): its height is flat between these points, not the curve. */
export const TERRAIN_SEGMENTS = 420;

/**
 * The height of the ground as drawn: the terrain mesh's triangle under (x, z), which can sit a
 * little off the smooth curve it was sampled from on rough ground.
 */
export function drawnGround(seed: number, x: number, z: number): number {
  const cell = WORLD_SIZE / TERRAIN_SEGMENTS;
  const gx = (x + WORLD_SIZE / 2) / cell;
  const gz = (z + WORLD_SIZE / 2) / cell;
  const ix = Math.floor(gx);
  const iz = Math.floor(gz);
  const u = gx - ix;
  const v = gz - iz;
  const h = (i: number, k: number) => terrainHeight(seed, -WORLD_SIZE / 2 + i * cell, -WORLD_SIZE / 2 + k * cell);
  const a = h(ix, iz);
  const b = h(ix, iz + 1);
  const c = h(ix + 1, iz + 1);
  const d = h(ix + 1, iz);
  // PlaneGeometry splits each square from (ix, iz + 1) to (ix + 1, iz).
  return u + v <= 1 ? a + (d - a) * u + (b - a) * v : c + (b - c) * (1 - u) + (d - c) * (1 - v);
}

export interface GroundRow {
  label: string;
  x: number;
  z: number;
  /** How far its lowest point is above the ground: above 0 it floats. */
  lift: number;
  /** The highest of its footprint's four corners' lowest points: one side floating. */
  edge: number;
  /** How far the ground rises over its lowest point, deepest: a side buried. */
  sunk: number;
}

const v = new THREE.Vector3();

/** Gaps under each object; `every` thins the vertices looked at on big meshes. */
export function groundGaps(objects: { label: string; root: THREE.Object3D }[], seed: number, every = 2000): GroundRow[] {
  const out: GroundRow[] = [];
  for (const { label, root } of objects) {
    root.updateMatrixWorld(true);
    const pts: THREE.Vector3[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.visible || m.userData.noGround) return;
      const pos = m.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / every));
      const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh) : null;
      const mat = new THREE.Matrix4();
      for (let c = 0; c < (inst ? inst.count : 1); c++) {
        if (inst) inst.getMatrixAt(c, mat);
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i);
          if (inst) v.applyMatrix4(mat);
          pts.push(v.clone().applyMatrix4(m.matrixWorld));
        }
      }
    });
    if (!pts.length) continue;
    const box = new THREE.Box3().setFromPoints(pts);
    const mid = box.getCenter(new THREE.Vector3());
    const corners = [Infinity, Infinity, Infinity, Infinity];
    let lift = Infinity;
    let sunk = 0;
    // A footprint corner is judged by its low parts only, not a tree's crown above it.
    const low = box.min.y + Math.min(1.5, (box.max.y - box.min.y) * 0.5);
    for (const p of pts) {
      const gap = p.y - drawnGround(seed, p.x, p.z);
      lift = Math.min(lift, gap);
      if (p.y > low) continue;
      const q = (p.x > mid.x ? 1 : 0) + (p.z > mid.z ? 2 : 0);
      corners[q] = Math.min(corners[q], gap);
    }
    // Buried: the ground above the bottom of the object, measured at its lowest points.
    const bottom = pts.filter((p) => p.y < box.min.y + 0.05);
    for (const p of bottom) sunk = Math.max(sunk, drawnGround(seed, p.x, p.z) - p.y);
    const seen = corners.filter((c) => c < Infinity);
    out.push({ label, x: +mid.x.toFixed(1), z: +mid.z.toFixed(1), lift: +lift.toFixed(3), edge: +Math.max(...seen).toFixed(3), sunk: +sunk.toFixed(3) });
  }
  return out.sort((a, b) => b.edge - a.edge);
}

/** A geometry's lowest points, in its own space: what touches the ground when it stands upright. */
const lows = new WeakMap<THREE.BufferGeometry, THREE.Vector3[]>();
function lowPoints(geo: THREE.BufferGeometry): THREE.Vector3[] {
  let out = lows.get(geo);
  if (out) return out;
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const band = box.min.y + Math.max(0.05, (box.max.y - box.min.y) * 0.06);
  const pos = geo.attributes.position;
  const all: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) <= band) all.push(new THREE.Vector3().fromBufferAttribute(pos, i));
  // A few dozen spread through the band are plenty.
  const step = Math.max(1, Math.floor(all.length / 24));
  out = all.filter((_, i) => i % step === 0);
  lows.set(geo, out);
  return out;
}

/**
 * Lowers something stood on the ground until the side of its base furthest off the ground
 * touches, by at most `most` metres, so on a slope no side of it hangs in the air. The
 * uphill side goes a little into the ground instead, as a real one would have settled.
 */
export function settle(root: THREE.Object3D, seed: number, most: number): number {
  root.updateMatrixWorld(true);
  const pts: THREE.Vector3[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh) return;
    // Lighter levels of detail stand on the same base as the full one.
    const lod = m.parent as THREE.LOD | null;
    if (lod?.isLOD && lod.levels[0]?.object !== m) return;
    for (const p of lowPoints(m.geometry)) pts.push(p.clone().applyMatrix4(m.matrixWorld));
  });
  if (!pts.length) return 0;
  const bottom = Math.min(...pts.map((p) => p.y));
  // The ground is looked up for two dozen of them at most: this runs for every tree and rock.
  const near = pts.filter((p) => p.y < bottom + 0.15);
  const base = near.filter((_, i) => i % Math.max(1, Math.floor(near.length / 24)) === 0);
  const mid = base.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(base.length);
  const corners = [Infinity, Infinity, Infinity, Infinity];
  for (const p of base) {
    const q = (p.x > mid.x ? 1 : 0) + (p.z > mid.z ? 2 : 0);
    corners[q] = Math.min(corners[q], p.y - drawnGround(seed, p.x, p.z));
  }
  const drop = THREE.MathUtils.clamp(Math.max(...corners.filter((c) => c < Infinity)), 0, most);
  root.position.y -= drop;
  return drop;
}
