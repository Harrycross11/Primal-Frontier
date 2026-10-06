// Natural-looking rocks: a noisy lump with a few flat fractured faces cut into it and a flat
// base, smooth-shaded, with a rock texture projected from three sides so it never stretches.

import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { rockSurface } from './textures.ts';

/** Smooth 3D value noise in about -1..1, seeded. */
function noise3(seed: number): (x: number, y: number, z: number) => number {
  const hash = (i: number, j: number, k: number) => {
    let h = (i * 374761393 + j * 668265263 + k * 2147483647 + seed * 974634) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const s = (t: number) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const k = Math.floor(z);
    const fx = s(x - i);
    const fy = s(y - j);
    const fz = s(z - k);
    const l = (a: number, b: number, t: number) => a + (b - a) * t;
    const c = (dj: number, dk: number) => l(hash(i, j + dj, k + dk), hash(i + 1, j + dj, k + dk), fx);
    return l(l(c(0, 0), c(1, 0), fy), l(c(0, 1), c(1, 1), fy), fz) * 2 - 1;
  };
}

export interface RockShape {
  /** Subdivision of the base sphere: 1 for pebbles, up to 4 for big boulders. */
  detail: number;
  /** Stretch on each axis. */
  stretch?: [number, number, number];
  /** How many flat fractured faces to cut. */
  cuts?: number;
}

/**
 * A rock about 1 m across, its base flat at y = -0.4 × stretch. Also writes a `cavity` value
 * (0 open, 1 deep) per vertex into the returned array, for darkening crevices.
 */
export function rockGeometry(rand: () => number, shape: RockShape): { geo: THREE.BufferGeometry; cavity: Float32Array } {
  const [sx, sy, sz] = shape.stretch ?? [1.15, 0.8, 1];
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, shape.detail);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const n = noise3(Math.floor(rand() * 1e6));
  const cuts = [...Array(shape.cuts ?? 5)].map(() => {
    const dir = new THREE.Vector3(rand() - 0.5, (rand() - 0.3) * 0.9, rand() - 0.5).normalize();
    return { dir, d: 0.62 + rand() * 0.22 };
  });
  const p = geo.attributes.position;
  const cavity = new Float32Array(p.count);
  const v = new THREE.Vector3();
  const out = new THREE.Vector3();
  const fbm = (x: number, y: number, z: number, oct: number) => {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    for (let o = 0; o < oct; o++, amp *= 0.5, f *= 2.1) sum += n(x * f, y * f, z * f) * amp;
    return sum;
  };
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const big = fbm(v.x * 1.4 + 3, v.y * 1.4, v.z * 1.4, 3);
    out.copy(v).multiplyScalar(1 + big * 0.35);
    // Fractures: anything past a cutting plane is pushed back onto it, leaving a flat face.
    for (const c of cuts) {
      const past = out.dot(c.dir) - c.d;
      if (past > 0) out.addScaledVector(c.dir, -past);
    }
    // Small grain over everything, weaker on the flat faces.
    const grain = fbm(v.x * 6, v.y * 6, v.z * 6, 3) * 0.06;
    out.addScaledVector(v, grain);
    out.set(out.x * sx, out.y * sy, out.z * sz);
    // Flat bottom so it sits on the ground.
    out.y = Math.max(out.y, -0.4 * sy);
    cavity[i] = THREE.MathUtils.clamp(-big * 2 - grain * 8, 0, 1);
    p.setXYZ(i, out.x, out.y, out.z);
  }
  geo.computeVertexNormals();
  return { geo, cavity };
}

const mats = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Rock material with its texture and surface detail projected in world space from the three
 * axes and blended by the surface direction. Colours come from vertex colours times the texture.
 */
export function rockMaterial(key: string, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  let m = mats.get(key);
  if (m) return m;
  const surf = rockSurface();
  m = new THREE.MeshStandardMaterial({ map: surf.map, normalMap: surf.normalMap, normalScale: new THREE.Vector2(1.8, 1.8), roughness: 0.95, metalness: 0, ...opts });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        vec4 triWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          triWorld = instanceMatrix * triWorld;
        #endif
        vTriPos = (modelMatrix * triWorld).xyz;
        vec3 triN = objectNormal;
        #ifdef USE_INSTANCING
          triN = mat3(instanceMatrix) * triN;
        #endif
        vTriNormal = normalize(mat3(modelMatrix) * triN);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;')
      .replace(
        '#include <map_fragment>',
        `vec3 triW = pow(abs(normalize(vTriNormal)), vec3(4.0));
        triW /= triW.x + triW.y + triW.z;
        vec3 tp = vTriPos * 0.5;
        vec4 triCol = texture2D(map, tp.zy) * triW.x + texture2D(map, tp.xz) * triW.y + texture2D(map, tp.xy) * triW.z;
        diffuseColor *= triCol;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `{
          vec3 wn = normalize(vTriNormal);
          vec3 tx = texture2D(normalMap, tp.zy).xyz * 2.0 - 1.0;
          vec3 ty = texture2D(normalMap, tp.xz).xyz * 2.0 - 1.0;
          vec3 tz = texture2D(normalMap, tp.xy).xyz * 2.0 - 1.0;
          tx.xy *= normalScale; ty.xy *= normalScale; tz.xy *= normalScale;
          // Whiteout-style blend: each projection's detail tilts the surface normal on its plane.
          vec3 nx = vec3(0.0, tx.y, tx.x) * sign(wn.x);
          vec3 ny = vec3(ty.x, 0.0, ty.y) * sign(wn.y);
          vec3 nz = vec3(tz.x, tz.y, 0.0) * sign(wn.z);
          vec3 bumped = normalize(wn + nx * triW.x + ny * triW.y + nz * triW.z);
          normal = normalize((viewMatrix * vec4(bumped, 0.0)).xyz);
        }`,
      );
  };
  mats.set(key, m);
  return m;
}

/** Vertex colours for a rock: a base shade with broad patches, darker in crevices. */
export function paintRock(geo: THREE.BufferGeometry, cavity: Float32Array, base: THREE.Color, rand: () => number, vein?: { color: THREE.Color; count: number; width: number }) {
  // Veins are thin wavy slabs of mineral cutting right through the rock, so each shows as a
  // band wrapping round it.
  const slabs = [...Array(vein?.count ?? 0)].map(() => ({
    dir: new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize(),
    at: (rand() - 0.5) * 0.9,
    width: (vein?.width ?? 0) * (0.6 + rand() * 0.8),
  }));
  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  const n = noise3(Math.floor(rand() * 1e6));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.copy(base).multiplyScalar(0.9 + n(v.x * 2.5, v.y * 2.5, v.z * 2.5) * 0.18 - cavity[i] * 0.5);
    if (vein) {
      const wobble = n(v.x * 3 + 9, v.y * 3, v.z * 3) * 0.12;
      for (const s of slabs) {
        const k = 1 - THREE.MathUtils.smoothstep(Math.abs(v.dot(s.dir) - s.at + wobble), s.width * 0.5, s.width);
        if (k > 0) c.lerp(vein.color, k * 0.85);
      }
    }
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
