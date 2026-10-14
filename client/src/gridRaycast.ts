// A fast raycast for the ground. The terrain is one big grid of 352,800 triangles, and three.js
// would test every one of them for every ray (the aim, the camera, each bullet), which alone held
// the game near 25 frames a second. This walks only the grid squares under the ray instead, and
// tests their two triangles each: the same answer for a tiny fraction of the work.

import * as THREE from 'three';

const local = new THREE.Ray();
const inverse = new THREE.Matrix4();
const a = new THREE.Vector3();
const b = new THREE.Vector3();
const c = new THREE.Vector3();
const hit = new THREE.Vector3();
const triangle = new THREE.Triangle();

/**
 * Makes `mesh` (a PlaneGeometry of `size` metres and `segments` squares a side, laid flat with
 * rotateX(-PI/2) and then given heights) raycast square by square.
 */
export function gridRaycast(mesh: THREE.Mesh, size: number, segments: number) {
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const index = geo.index!;
  const cell = size / segments;
  const half = size / 2;
  mesh.raycast = (raycaster: THREE.Raycaster, out: THREE.Intersection[]) => {
    const material = mesh.material as THREE.Material;
    if (material === undefined) return;
    inverse.copy(mesh.matrixWorld).invert();
    local.copy(raycaster.ray).applyMatrix4(inverse);
    const o = local.origin;
    const d = local.direction;
    // The part of the ray inside the square of ground, as distances along it.
    let t0 = raycaster.near;
    let t1 = raycaster.far;
    for (const [p, v] of [
      [o.x, d.x],
      [o.z, d.z],
    ]) {
      if (Math.abs(v) < 1e-12) {
        if (p < -half || p > half) return;
        continue;
      }
      let enter = (-half - p) / v;
      let exit = (half - p) / v;
      if (enter > exit) [enter, exit] = [exit, enter];
      t0 = Math.max(t0, enter);
      t1 = Math.min(t1, exit);
    }
    if (!(t0 <= t1)) return;
    // Walk the squares the ray passes over, nearest first (a 2D DDA).
    const gx = (o.x + d.x * t0 + half) / cell;
    const gz = (o.z + d.z * t0 + half) / cell;
    let ix = Math.min(segments - 1, Math.max(0, Math.floor(gx)));
    let iz = Math.min(segments - 1, Math.max(0, Math.floor(gz)));
    const stepX = d.x > 0 ? 1 : -1;
    const stepZ = d.z > 0 ? 1 : -1;
    const dtX = Math.abs(d.x) < 1e-12 ? Infinity : cell / Math.abs(d.x);
    const dtZ = Math.abs(d.z) < 1e-12 ? Infinity : cell / Math.abs(d.z);
    let nextX = Math.abs(d.x) < 1e-12 ? Infinity : t0 + ((d.x > 0 ? ix + 1 - gx : gx - ix) * cell) / Math.abs(d.x);
    let nextZ = Math.abs(d.z) < 1e-12 ? Infinity : t0 + ((d.z > 0 ? iz + 1 - gz : gz - iz) * cell) / Math.abs(d.z);
    const side = material.side;
    for (let guard = 0; guard < segments * 2 + 4; guard++) {
      // PlaneGeometry's two triangles for square (ix, iz) sit at 6 * (iz * segments + ix).
      const first = 6 * (iz * segments + ix);
      let best: THREE.Intersection | null = null;
      for (let tri = first; tri < first + 6; tri += 3) {
        const ia = index.getX(tri);
        const ib = index.getX(tri + 1);
        const ic = index.getX(tri + 2);
        a.fromBufferAttribute(pos, ia);
        b.fromBufferAttribute(pos, ib);
        c.fromBufferAttribute(pos, ic);
        const found = side === THREE.BackSide ? local.intersectTriangle(c, b, a, true, hit) : local.intersectTriangle(a, b, c, side === THREE.FrontSide, hit);
        if (!found) continue;
        const world = hit.clone().applyMatrix4(mesh.matrixWorld);
        const distance = raycaster.ray.origin.distanceTo(world);
        if (distance < raycaster.near || distance > raycaster.far) continue;
        const normal = new THREE.Vector3();
        triangle.set(a, b, c).getNormal(normal);
        if (!best || distance < best.distance) best = { distance, point: world, object: mesh, face: { a: ia, b: ib, c: ic, normal, materialIndex: 0 }, faceIndex: tri / 3 };
      }
      // Squares come nearest first, so the first square hit holds the nearest hit.
      if (best) {
        out.push(best);
        return;
      }
      if (Math.min(nextX, nextZ) > t1) return;
      if (nextX < nextZ) {
        ix += stepX;
        nextX += dtX;
        if (ix < 0 || ix >= segments) return;
      } else {
        iz += stepZ;
        nextZ += dtZ;
        if (iz < 0 || iz >= segments) return;
      }
    }
  };
}
