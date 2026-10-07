// Photo-scanned models from client/public/models (see scripts/fetch-models.py), loaded once at
// startup. Each is re-centred and resized so the game can place it like the shapes it used to
// build in code. If a file fails to load the game falls back to those shapes.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

export interface Model {
  geometry: THREE.BufferGeometry;
  /** One material, or one per geometry group when the scan has several (bark and leaves). */
  material: THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[];
}

export const BOULDERS = ['boulder-a', 'boulder-b', 'boulder-c', 'boulder-d', 'boulder-e'];
/** Scanned car wrecks, each laid lengthways along x. */
export const WRECKS = ['wreck-a', 'wreck-b', 'wreck-c', 'wreck-d', 'wreck-e', 'wreck-f'];

interface Fit {
  /** Widest horizontal extent in metres. */
  width?: number;
  /** Height in metres. */
  height?: number;
  turn?: [number, number, number];
  /** The file is a set of variants side by side; each top-level object becomes its own model. */
  set?: boolean;
  /** Cut-out leaves or blades: lit like the ground rather than by each card's facing. */
  foliage?: boolean;
}

const FIT: Record<string, Fit> = {
  ...Object.fromEntries(BOULDERS.map((b) => [b, { width: 2.3 }])),
  log: { width: 3.2 },
  barrel: { height: 0.9 },
  // The tyre is scanned standing up; lay it flat.
  tyre: { width: 0.84, turn: [Math.PI / 2, 0, 0] },
  'dry-grass': { height: 0.45, set: true, foliage: true },
  'dry-bush': { height: 1.0, set: true, foliage: true },
  branches: { width: 1.2, set: true },
  // Scanned standing up; it lies on the ground in the game.
  'dead-branch': { width: 0.9, turn: [Math.PI / 2, 0, 0] },
  stones: { width: 0.3, set: true },
  stump: { width: 1.1 },
  // Lengths of the real cars: two big sedans, three mid-size, and a small hatchback.
  'wreck-a': { width: 5.0 },
  'wreck-b': { width: 4.6 },
  'wreck-c': { width: 4.5 },
  'wreck-d': { width: 4.7 },
  'wreck-e': { width: 3.9 },
  'wreck-f': { width: 4.6 },
};

const models = new Map<string, Model[]>();

function build(root: THREE.Object3D, fit: Fit, alpha?: THREE.Texture): Model | undefined {
  const parts: THREE.BufferGeometry[] = [];
  const materials: THREE.MeshStandardMaterial[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    // Keep only what every part has, so the parts can be merged.
    for (const key of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(key)) geo.deleteAttribute(key);
    parts.push(geo);
    materials.push(mesh.material as THREE.MeshStandardMaterial);
  });
  if (!parts.length) return undefined;
  const single = materials.every((m) => m === materials[0]);
  const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, !single)!;
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
  for (const m of materials) for (const t of [m.map, m.normalMap, m.roughnessMap]) if (t) t.anisotropy = 8;
  const mats = fit.foliage ? materials.map((m) => foliage(m, alpha)) : materials;
  if (fit.foliage) {
    // Cards seen edge-on or from behind go black when lit by their own facing; tilt every
    // normal most of the way up so a clump is lit as a whole.
    const n = geometry.attributes.normal;
    const v = new THREE.Vector3();
    for (let i = 0; i < n.count; i++) {
      v.fromBufferAttribute(n, i).multiplyScalar(0.25).add(new THREE.Vector3(0, 1, 0)).normalize();
      n.setXYZ(i, v.x, v.y, v.z);
    }
  }
  return { geometry, material: single ? mats[0] : mats };
}

const foliageMats = new Map<string, THREE.MeshStandardMaterial>();

function foliage(m: THREE.MeshStandardMaterial, alpha?: THREE.Texture): THREE.MeshStandardMaterial {
  let out = foliageMats.get(m.uuid);
  if (out) return out;
  out = m.clone();
  out.side = THREE.DoubleSide;
  out.normalMap = null;
  if (alpha && m.transparent) out.alphaMap = alpha;
  out.alphaTest = Math.max(out.alphaTest, 0.4);
  out.transparent = false;
  // Back faces would flip the upward normal into the ground; keep it pointing up on both sides.
  out.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''),
    );
  };
  foliageMats.set(m.uuid, out);
  return out;
}

async function load(loader: GLTFLoader, name: string) {
  const gltf = await loader.loadAsync(`/models/${name}.glb`);
  const fit = FIT[name];
  // A set's variants may sit under one wrapper node; find the level where they split.
  let level: THREE.Object3D = gltf.scene;
  while (fit.set && level.children.length === 1) level = level.children[0];
  const roots = fit.set ? [...level.children] : [gltf.scene];
  let alpha: THREE.Texture | undefined;
  if (fit.foliage) {
    alpha = await new THREE.TextureLoader().loadAsync(`/models/${name}_alpha.jpg`);
    // glTF textures are not flipped; the mask must match them.
    alpha.flipY = false;
  }
  const out = roots.map((r) => build(r, fit, alpha)).filter((m): m is Model => !!m);
  if (out.length) models.set(name, out);
}

/** Rigged characters, kept whole (skeleton and skinned meshes) rather than merged. */
const CHARACTERS = ['survivor'];
const characters = new Map<string, THREE.Object3D>();

async function loadCharacter(loader: GLTFLoader, name: string) {
  const gltf = await loader.loadAsync(`/models/${name}.glb`);
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Skinned bounds are taken from the bind pose; animated limbs would get culled at screen edges.
    mesh.frustumCulled = false;
    const m = mesh.material as THREE.MeshStandardMaterial;
    if (m.map) m.map.anisotropy = 8;
  });
  characters.set(name, gltf.scene);
}

/** Loads every model; resolves even if some fail, so a missing file never stops the game. */
export async function loadModels(): Promise<void> {
  const loader = new GLTFLoader();
  const warn = (n: string) => (e: unknown) => console.warn(`model ${n} failed to load`, e);
  await Promise.all([
    ...Object.keys(FIT).map((n) => load(loader, n).catch(warn(n))),
    ...CHARACTERS.map((n) => loadCharacter(loader, n).catch(warn(n))),
  ]);
}

/** A fresh copy of a rigged character with its own skeleton, or none if it didn't load. */
export function character(name: string): THREE.Object3D | undefined {
  const scene = characters.get(name);
  return scene && cloneSkinned(scene);
}

export function model(name: string): Model | undefined {
  return models.get(name)?.[0];
}

/** Every variant in a set (one for a plain model), or none if it didn't load. */
export function variants(name: string): Model[] {
  return models.get(name) ?? [];
}

/** The model's material, when it has just one. */
export function soleMaterial(m: Model): THREE.MeshStandardMaterial {
  return Array.isArray(m.material) ? m.material[0] : m.material;
}
