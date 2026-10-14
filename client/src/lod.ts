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

/** A lighter triangle list, and where each material's part of it starts and ends. */
interface Lighter {
  index: THREE.BufferAttribute;
  groups: { start: number; count: number; materialIndex: number }[];
}

const lists = new WeakMap<THREE.BufferGeometry, Map<number, Lighter | null>>();

/** One run of triangles cut to about `fraction` of its length. */
function simplify(indices: Uint32Array, positions: Float32Array, fraction: number): Uint32Array {
  const target = Math.max(36, Math.floor((indices.length * fraction) / 3) * 3);
  let [list] = MeshoptSimplifier.simplify(indices, positions, 3, target, 0.08);
  // Seams in the photo's layout stop the plain simplifier early; let it cut across them.
  if (list.length > target * 1.5) [list] = MeshoptSimplifier.simplify(indices, positions, 3, target, 0.08, ['Permissive']);
  return list;
}

/**
 * The triangle list for a copy of `geo` with about `fraction` of its triangles, worked out once
 * per model, or null if it can't be made (the simplifier didn't start, or the model isn't indexed).
 * A model with several materials (bark and leaves, say) is cut part by part, and parts with only
 * a small share of the triangles, like leaf cards, are kept whole so the crown doesn't fall apart.
 */
function lighterList(geo: THREE.BufferGeometry, fraction: number): Lighter | null {
  let known = lists.get(geo);
  if (!known) lists.set(geo, (known = new Map()));
  if (known.has(fraction)) return known.get(fraction)!;
  let out: Lighter | null = null;
  const index = geo.index;
  const pos = geo.getAttribute('position');
  if (ready && index && pos && !(pos as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    const indices = new Uint32Array(index.array);
    const positions = pos.array instanceof Float32Array ? pos.array : new Float32Array(pos.array);
    const parts = geo.groups.length > 1 ? geo.groups : [{ start: 0, count: indices.length, materialIndex: 0 }];
    const lists: Uint32Array[] = [];
    const groups: Lighter['groups'] = [];
    let at = 0;
    for (const part of parts) {
      const run = indices.subarray(part.start, Math.min(indices.length, part.start + part.count));
      const list = run.length > indices.length * 0.15 ? simplify(run, positions, fraction) : run;
      lists.push(list);
      groups.push({ start: at, count: list.length, materialIndex: part.materialIndex ?? 0 });
      at += list.length;
    }
    if (at < indices.length) {
      const all = new Uint32Array(at);
      let o = 0;
      for (const list of lists) {
        all.set(list, o);
        o += list.length;
      }
      out = { index: new THREE.BufferAttribute(all, 1), groups: geo.groups.length > 1 ? groups : [] };
    }
  }
  known.set(fraction, out);
  return out;
}

/** The triangle list for a single-material copy of `geo` with about `fraction` of its triangles. */
export function lodIndex(geo: THREE.BufferGeometry, fraction: number): THREE.BufferAttribute | null {
  return lighterList(geo, fraction)?.index ?? null;
}

/** A geometry drawing `geo`'s vertices with another triangle list. */
export function withIndex(geo: THREE.BufferGeometry, index: THREE.BufferAttribute, groups: Lighter['groups'] = []): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) out.setAttribute(name, attr);
  out.setIndex(index);
  for (const g of groups) out.addGroup(g.start, g.count, g.materialIndex);
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  if (!geo.boundingBox) geo.computeBoundingBox();
  out.boundingSphere = geo.boundingSphere!.clone();
  out.boundingBox = geo.boundingBox!.clone();
  return out;
}

const shared = new WeakMap<THREE.BufferGeometry, Map<number, THREE.BufferGeometry | null>>();

/**
 * A copy of `geo` with about `fraction` of its triangles, shared by everything that asks for the
 * same one, or null where it can't be made (no simplifier, or nothing to cut).
 */
export function lighter(geo: THREE.BufferGeometry, fraction: number): THREE.BufferGeometry | null {
  let copies = shared.get(geo);
  if (!copies) shared.set(geo, (copies = new Map()));
  if (!copies.has(fraction)) {
    const list = lighterList(geo, fraction);
    copies.set(fraction, list ? withIndex(geo, list.index, list.groups) : null);
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
  const mid = lighter(geo, 0.25);
  const low = lighter(geo, 0.06);
  if (!mid || !low) return level(geo);
  const lod = new THREE.LOD();
  lod.addLevel(level(geo), 0);
  lod.addLevel(level(mid), near);
  lod.addLevel(level(low), far);
  return rayOnce(lod);
}

/**
 * Makes a ray test only the level the LOD would show from where the ray starts. Without this,
 * three.js tests that level and then every level again as children, at full detail.
 */
export function rayOnce(lod: THREE.LOD): THREE.LOD {
  lod.raycast = (raycaster, hits) => {
    THREE.LOD.prototype.raycast.call(lod, raycaster, hits);
    return false;
  };
  return lod;
}
