// Cheaper copies of a model for when it is far off or small on screen. Each is just a second
// list of triangles over the model's own vertices, so the copies share its vertex data (and any
// colours painted on it) and cost no extra memory beyond the list itself.

import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';

let ready = false;
/** Resolves once the simplifier has started; until then models stay at full detail. */
export const lodReady = MeshoptSimplifier.ready.then(
  () => {
    ready = true;
  },
  () => {},
);

const lists = new WeakMap<THREE.BufferGeometry, Map<number, THREE.BufferAttribute | null>>();

/**
 * The triangle list for a copy of `geo` with about `fraction` of its triangles, worked out once
 * per model, or null if it can't be made (the simplifier didn't start, or the model isn't indexed).
 */
export function lodIndex(geo: THREE.BufferGeometry, fraction: number): THREE.BufferAttribute | null {
  let known = lists.get(geo);
  if (!known) lists.set(geo, (known = new Map()));
  if (known.has(fraction)) return known.get(fraction)!;
  let out: THREE.BufferAttribute | null = null;
  const index = geo.index;
  const pos = geo.getAttribute('position');
  if (ready && index && pos && !(pos as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    const indices = new Uint32Array(index.array);
    const positions = pos.array instanceof Float32Array ? pos.array : new Float32Array(pos.array);
    const target = Math.max(36, Math.floor((indices.length * fraction) / 3) * 3);
    let [list] = MeshoptSimplifier.simplify(indices, positions, 3, target, 0.08);
    // Seams in the photo's layout stop the plain simplifier early; let it cut across them.
    if (list.length > target * 1.5) [list] = MeshoptSimplifier.simplify(indices, positions, 3, target, 0.08, ['Permissive']);
    if (list.length < indices.length) out = new THREE.BufferAttribute(list, 1);
  }
  known.set(fraction, out);
  return out;
}

/** A geometry drawing `geo`'s vertices with another triangle list. */
export function withIndex(geo: THREE.BufferGeometry, index: THREE.BufferAttribute): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) out.setAttribute(name, attr);
  out.setIndex(index);
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  if (!geo.boundingBox) geo.computeBoundingBox();
  out.boundingSphere = geo.boundingSphere!.clone();
  out.boundingBox = geo.boundingBox!.clone();
  return out;
}

const shared = new WeakMap<THREE.BufferGeometry, Map<number, THREE.BufferGeometry | null>>();

/**
 * A copy of `geo` with about `fraction` of its triangles, shared by everything that asks for the
 * same one, or null where it can't be made (several materials, or no simplifier).
 */
export function lighter(geo: THREE.BufferGeometry, fraction: number): THREE.BufferGeometry | null {
  if (geo.groups.length > 1) return null;
  let copies = shared.get(geo);
  if (!copies) shared.set(geo, (copies = new Map()));
  if (!copies.has(fraction)) {
    const index = lodIndex(geo, fraction);
    copies.set(fraction, index ? withIndex(geo, index) : null);
  }
  return copies.get(fraction)!;
}

/**
 * A scanned model that swaps to a quarter of its triangles past `near` metres and a sixteenth
 * past `far`, or a plain mesh where that can't be done. Every level casts and takes shadows.
 */
export function scanMesh(geo: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], near = 30, far = 90): THREE.Mesh | THREE.LOD {
  const level = (g: THREE.BufferGeometry) => {
    const mesh = new THREE.Mesh(g, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  };
  const mid = Array.isArray(material) ? null : lighter(geo, 0.25);
  const low = Array.isArray(material) ? null : lighter(geo, 0.06);
  if (!mid || !low) return level(geo);
  const lod = new THREE.LOD();
  lod.addLevel(level(geo), 0);
  lod.addLevel(level(mid), near);
  lod.addLevel(level(low), far);
  return lod;
}
