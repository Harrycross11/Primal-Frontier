// Photo-scanned models from client/public/models (see scripts/fetch-models.py), loaded once at
// startup. Each is one mesh, re-centred and resized so the game can place it like the shapes it
// used to build in code. If a file fails to load the game falls back to those shapes.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface Model {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

export const BOULDERS = ['boulder-a', 'boulder-b', 'boulder-c', 'boulder-d', 'boulder-e'];

/** How to fit each model: its widest horizontal extent in metres, or its height. */
const FIT: Record<string, { width?: number; height?: number; turn?: [number, number, number] }> = {
  ...Object.fromEntries(BOULDERS.map((b) => [b, { width: 2.3 }])),
  log: { width: 3.2 },
  barrel: { height: 0.9 },
  // The tyre is scanned standing up; lay it flat.
  tyre: { width: 0.84, turn: [Math.PI / 2, 0, 0] },
};

const models = new Map<string, Model>();

async function load(loader: GLTFLoader, name: string) {
  const gltf = await loader.loadAsync(`/models/${name}.glb`);
  gltf.scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  const materials: THREE.MeshStandardMaterial[] = [];
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    parts.push(mesh.geometry.clone().applyMatrix4(mesh.matrixWorld));
    materials.push(mesh.material as THREE.MeshStandardMaterial);
  });
  const material = materials[0];
  if (!material) return;
  const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts)!;
  const fit = FIT[name] ?? {};
  if (fit.turn) geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...fit.turn)));
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const k = fit.height ? fit.height / size.y : fit.width ? fit.width / Math.max(size.x, size.z) : 1;
  // Centred over the origin, resting on y = 0.
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  geometry.scale(k, k, k);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  for (const t of [material.map, material.normalMap, material.roughnessMap]) if (t) t.anisotropy = 8;
  models.set(name, { geometry, material });
}

/** Loads every model; resolves even if some fail, so a missing file never stops the game. */
export async function loadModels(): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all([...Object.keys(FIT)].map((n) => load(loader, n).catch((e) => console.warn(`model ${n} failed to load`, e))));
}

export function model(name: string): Model | undefined {
  return models.get(name);
}
