// Builds the survivor's body as one continuous, smooth skinned mesh.
//
// The body is described as a signed distance field: rounded shapes for the pelvis, chest,
// limbs, hands, boots and head, blended together with a smooth minimum so there are no
// seams or gaps between them. The field is turned into triangles once with surface nets,
// and each vertex is weighted to the nearby bones so shoulders, elbows, hips and knees
// bend smoothly instead of rotating as separate pieces.

import * as THREE from 'three';

/** Arms are modelled raised 35 degrees from the body (an A-pose) so the armpits stay open. */
export const ARM_REST = THREE.MathUtils.degToRad(35);
const UPPER_ARM = 0.27;
const FOREARM = 0.24;

export type BoneName =
  | 'root'
  | 'pelvis'
  | 'hipL'
  | 'kneeL'
  | 'hipR'
  | 'kneeR'
  | 'torso'
  | 'neck'
  | 'head'
  | 'shoulderL'
  | 'elbowL'
  | 'shoulderR'
  | 'elbowR';

type V3 = [number, number, number];

const armDir = (side: number): V3 => [side * Math.sin(ARM_REST), -Math.cos(ARM_REST), 0];
const along = (p: V3, d: V3, t: number): V3 => [p[0] + d[0] * t, p[1] + d[1] * t, p[2] + d[2] * t];
const SHOULDER = (side: number): V3 => [side * 0.19, 1.4, 0];
const ELBOW = (side: number) => along(SHOULDER(side), armDir(side), UPPER_ARM);
const WRIST = (side: number) => along(ELBOW(side), armDir(side), FOREARM);
export const HAND = (side: number) => along(WRIST(side), armDir(side), 0.055);

/** Bones with their parent and bind-pose position in avatar space (feet at 0, facing +z). */
export const BONES: [BoneName, BoneName | null, V3][] = [
  ['root', null, [0, 0, 0]],
  ['pelvis', 'root', [0, 0.95, 0]],
  ['hipL', 'pelvis', [-0.092, 0.92, 0]],
  ['kneeL', 'hipL', [-0.092, 0.5, 0]],
  ['hipR', 'pelvis', [0.092, 0.92, 0]],
  ['kneeR', 'hipR', [0.092, 0.5, 0]],
  ['torso', 'pelvis', [0, 1.0, 0]],
  ['neck', 'torso', [0, 1.45, 0]],
  ['head', 'neck', [0, 1.6, 0]],
  ['shoulderL', 'torso', SHOULDER(-1)],
  ['elbowL', 'shoulderL', ELBOW(-1)],
  ['shoulderR', 'torso', SHOULDER(1)],
  ['elbowR', 'shoulderR', ELBOW(1)],
];

/** Clothing regions, coloured per survivor. */
export const Region = { Jacket: 0, Trousers: 1, Boots: 2, Gloves: 3, Skin: 4, Belt: 5 } as const;
export type Region = (typeof Region)[keyof typeof Region];

interface Shape {
  d: (x: number, y: number, z: number) => number;
  bone: BoneName;
  region: (y: number) => Region;
  /** How softly this shape blends into what came before it, in metres. */
  blend: number;
}

function roundCone(a: V3, b: V3, ra: number, rb: number) {
  const bx = b[0] - a[0];
  const by = b[1] - a[1];
  const bz = b[2] - a[2];
  const bb = bx * bx + by * by + bz * bz;
  return (x: number, y: number, z: number) => {
    const px = x - a[0];
    const py = y - a[1];
    const pz = z - a[2];
    const t = Math.min(1, Math.max(0, (px * bx + py * by + pz * bz) / bb));
    const dx = px - bx * t;
    const dy = py - by * t;
    const dz = pz - bz * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - (ra + (rb - ra) * t);
  };
}

function ellipsoid(c: V3, r: V3) {
  const smallest = Math.min(...r);
  return (x: number, y: number, z: number) => {
    const qx = (x - c[0]) / r[0];
    const qy = (y - c[1]) / r[1];
    const qz = (z - c[2]) / r[2];
    const k0 = Math.sqrt(qx * qx + qy * qy + qz * qz);
    const wx = qx / r[0];
    const wy = qy / r[1];
    const wz = qz / r[2];
    const k1 = Math.sqrt(wx * wx + wy * wy + wz * wz);
    return k1 === 0 ? -smallest : (k0 * (k0 - 1)) / k1;
  };
}

function roundBox(c: V3, h: V3, r: number) {
  return (x: number, y: number, z: number) => {
    const qx = Math.abs(x - c[0]) - h[0] + r;
    const qy = Math.abs(y - c[1]) - h[1] + r;
    const qz = Math.abs(z - c[2]) - h[2] + r;
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    const oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - r;
  };
}

/** Torso pieces are jacket above the belt, belt at the waist, trousers below. */
const torsoRegion = (y: number) => (y > 0.975 ? Region.Jacket : y > 0.925 ? Region.Belt : Region.Trousers);
const fixed = (r: Region) => () => r;

function shapes(): Shape[] {
  const list: Shape[] = [
    { d: ellipsoid([0, 0.95, 0], [0.16, 0.11, 0.115]), bone: 'pelvis', region: torsoRegion, blend: 0 },
    { d: ellipsoid([0, 1.08, 0], [0.15, 0.14, 0.11]), bone: 'torso', region: torsoRegion, blend: 0.06 },
    { d: ellipsoid([0, 1.26, 0.005], [0.172, 0.17, 0.122]), bone: 'torso', region: torsoRegion, blend: 0.06 },
    { d: roundCone([-0.14, 1.39, -0.01], [0.14, 1.39, -0.01], 0.066, 0.066), bone: 'torso', region: fixed(Region.Jacket), blend: 0.05 },
    // A raised collar where the jacket meets the neck.
    { d: roundCone([0, 1.4, -0.005], [0, 1.47, -0.01], 0.085, 0.07), bone: 'torso', region: fixed(Region.Jacket), blend: 0.03 },
    { d: roundCone([0, 1.44, 0], [0, 1.6, 0.01], 0.052, 0.048), bone: 'neck', region: fixed(Region.Skin), blend: 0.02 },
    { d: ellipsoid([0, 1.69, 0.005], [0.092, 0.112, 0.102]), bone: 'head', region: fixed(Region.Skin), blend: 0.03 },
  ];
  for (const side of [-1, 1]) {
    const s = side < 0 ? 'L' : 'R';
    const hip: V3 = [side * 0.092, 0.92, 0];
    const knee: V3 = [side * 0.092, 0.5, 0.005];
    const ankle: V3 = [side * 0.092, 0.11, 0];
    const legRegion = (y: number) => (y < 0.25 ? Region.Boots : Region.Trousers);
    list.push(
      { d: roundCone(hip, knee, 0.086, 0.062), bone: `hip${s}` as BoneName, region: fixed(Region.Trousers), blend: 0.05 },
      { d: roundCone(knee, ankle, 0.062, 0.05), bone: `knee${s}` as BoneName, region: legRegion, blend: 0.03 },
      { d: roundCone([side * 0.092, 0.26, 0], [side * 0.092, 0.08, 0], 0.062, 0.06), bone: `knee${s}` as BoneName, region: fixed(Region.Boots), blend: 0.015 },
      { d: roundBox([side * 0.092, 0.06, 0.04], [0.058, 0.055, 0.125], 0.035), bone: `knee${s}` as BoneName, region: fixed(Region.Boots), blend: 0.03 },
    );
    const sh = SHOULDER(side);
    const el = ELBOW(side);
    const wr = WRIST(side);
    const dir = armDir(side);
    list.push(
      { d: roundCone(sh, el, 0.062, 0.05), bone: `shoulder${s}` as BoneName, region: fixed(Region.Jacket), blend: 0.035 },
      { d: roundCone(el, wr, 0.05, 0.044), bone: `elbow${s}` as BoneName, region: fixed(Region.Jacket), blend: 0.03 },
      { d: roundCone(along(wr, dir, 0.01), along(wr, dir, 0.09), 0.036, 0.03), bone: `elbow${s}` as BoneName, region: fixed(Region.Gloves), blend: 0.015 },
    );
  }
  return list;
}

function smin(a: number, b: number, k: number) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

export interface SurvivorGeometry {
  geometry: THREE.BufferGeometry;
  regions: Uint8Array;
}

let cached: SurvivorGeometry | null = null;

/** The shared body mesh. Built once (a few tens of milliseconds) and reused by every avatar. */
export function survivorGeometry(): SurvivorGeometry {
  if (cached) return cached;
  const list = shapes();
  const field = (x: number, y: number, z: number) => {
    let d = list[0].d(x, y, z);
    for (let i = 1; i < list.length; i++) d = smin(d, list[i].d(x, y, z), list[i].blend);
    return d;
  };

  // Sample the field on a grid around the body.
  const h = 0.011;
  const min: V3 = [-0.62, -0.02, -0.22];
  const max: V3 = [0.62, 1.84, 0.26];
  const nx = Math.ceil((max[0] - min[0]) / h) + 1;
  const ny = Math.ceil((max[1] - min[1]) / h) + 1;
  const nz = Math.ceil((max[2] - min[2]) / h) + 1;
  const idx = (i: number, j: number, k: number) => i + nx * (j + ny * k);
  // A coarse pass first: fine samples near a coarse sample that is clearly inside or outside
  // reuse its value, so the detailed field is only evaluated close to the surface.
  const C = 4;
  const cx = Math.ceil(nx / C) + 1;
  const cy = Math.ceil(ny / C) + 1;
  const coarse = new Float32Array(cx * cy * (Math.ceil(nz / C) + 1));
  for (let k = 0; k * C < nz + C; k++)
    for (let j = 0; j < cy; j++)
      for (let i = 0; i < cx; i++) coarse[i + cx * (j + cy * k)] = field(min[0] + i * C * h, min[1] + j * C * h, min[2] + k * C * h);
  const values = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const near = coarse[Math.round(i / C) + cx * (Math.round(j / C) + cy * Math.round(k / C))];
        values[idx(i, j, k)] = Math.abs(near) > C * h * 1.5 ? near : field(min[0] + i * h, min[1] + j * h, min[2] + k * h);
      }

  // Surface nets: one vertex per cell the surface passes through, at the average of the
  // points where the surface crosses that cell's edges.
  const cellVertex = new Int32Array(nx * ny * nz).fill(-1);
  const positions: number[] = [];
  const corners = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ];
  const edges = [
    [0, 1],
    [2, 3],
    [4, 5],
    [6, 7],
    [0, 2],
    [1, 3],
    [4, 6],
    [5, 7],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          cv[c] = values[idx(i + corners[c][0], j + corners[c][1], k + corners[c][2])];
          if (cv[c] < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let n = 0;
        for (const [a, b] of edges) {
          if (cv[a] < 0 === cv[b] < 0) continue;
          const t = cv[a] / (cv[a] - cv[b]);
          sx += corners[a][0] + (corners[b][0] - corners[a][0]) * t;
          sy += corners[a][1] + (corners[b][1] - corners[a][1]) * t;
          sz += corners[a][2] + (corners[b][2] - corners[a][2]) * t;
          n++;
        }
        cellVertex[idx(i, j, k)] = positions.length / 3;
        positions.push(min[0] + (i + sx / n) * h, min[1] + (j + sy / n) * h, min[2] + (k + sz / n) * h);
      }

  // One quad for each grid edge the surface crosses, joining the four cells around it.
  const index: number[] = [];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) index.push(a, b, c, a, c, d);
    else index.push(a, c, b, a, d, c);
  };
  for (let k = 1; k < nz - 1; k++)
    for (let j = 1; j < ny - 1; j++)
      for (let i = 1; i < nx - 1; i++) {
        const inside = values[idx(i, j, k)] < 0;
        if (inside !== values[idx(i + 1, j, k)] < 0)
          quad(cellVertex[idx(i, j - 1, k - 1)], cellVertex[idx(i, j, k - 1)], cellVertex[idx(i, j, k)], cellVertex[idx(i, j - 1, k)], inside);
        if (inside !== values[idx(i, j + 1, k)] < 0)
          quad(cellVertex[idx(i - 1, j, k - 1)], cellVertex[idx(i - 1, j, k)], cellVertex[idx(i, j, k)], cellVertex[idx(i, j, k - 1)], inside);
        if (inside !== values[idx(i, j, k + 1)] < 0)
          quad(cellVertex[idx(i - 1, j - 1, k)], cellVertex[idx(i, j - 1, k)], cellVertex[idx(i, j, k)], cellVertex[idx(i - 1, j, k)], inside);
      }

  // Per vertex: a smooth normal from the field, texture coordinates projected from the
  // dominant axis, the clothing region, and bone weights that fade between nearby shapes.
  const count = positions.length / 3;
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const regions = new Uint8Array(count);
  const skinIndex = new Uint16Array(count * 4);
  const skinWeight = new Float32Array(count * 4);
  const boneIndex = new Map(BONES.map(([name], i) => [name, i]));
  const e = 0.002;
  const dist = new Float64Array(list.length);
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    const n = new THREE.Vector3(
      field(x + e, y, z) - field(x - e, y, z),
      field(x, y + e, z) - field(x, y - e, z),
      field(x, y, z + e) - field(x, y, z - e),
    ).normalize();
    normals.set([n.x, n.y, n.z], v * 3);
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    const uv = ay > ax && ay > az ? [x, z] : ax > az ? [z, y] : [x, y];
    uvs.set([uv[0] * 2.5, uv[1] * 2.5], v * 2);

    let best = 0;
    for (let s = 0; s < list.length; s++) {
      dist[s] = list[s].d(x, y, z);
      if (dist[s] < dist[best]) best = s;
    }
    regions[v] = list[best].region(y);
    const weights = new Map<number, number>();
    for (let s = 0; s < list.length; s++) {
      const w = Math.exp(-(dist[s] - dist[best]) / 0.014);
      if (w < 0.01) continue;
      const b = boneIndex.get(list[s].bone)!;
      weights.set(b, (weights.get(b) ?? 0) + w);
    }
    const top = [...weights].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = top.reduce((t, [, w]) => t + w, 0);
    top.forEach(([b, w], i) => {
      skinIndex[v * 4 + i] = b;
      skinWeight[v * 4 + i] = w / total;
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geometry.setIndex(index);
  geometry.computeBoundingSphere();
  cached = { geometry, regions };
  return cached;
}
