// Photo-scanned models from client/public/models (see scripts/fetch-models.py), loaded once at
// startup. Each is re-centred and resized so the game can place it like the shapes it used to
// build in code. If a file fails to load the game falls back to those shapes.

import * as THREE from 'three';
import { lodReady } from './lod.ts';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
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
  /** Length along z in metres (guns, barrel along +z). */
  length?: number;
  /** Parts of the file left out, by mesh name: spare magazines, bayonets, loose rounds. */
  drop?: RegExp;
  /**
   * Loose bits merged into the same mesh as the gun, such as a shell lying beside it, cut out by
   * boxes of [back, front, bottom, top] as fractions of the turned model's length and height.
   */
  cut?: [number, number, number, number][];
  turn?: [number, number, number];
  /** The file is a set of variants side by side; each top-level object becomes its own model. */
  set?: boolean;
  /** Cut-out leaves or blades: lit like the ground rather than by each card's facing. */
  foliage?: boolean;
}

const FIT: Record<string, Fit> = {
  ...Object.fromEntries(BOULDERS.map((b) => [b, { width: 2.3 }])),
  log: { width: 3.2 },
  // Worn on the survivor's back: turned so the straps face +z, against the body.
  'gear-backpack': { height: 0.62, turn: [0, Math.PI, 0] },
  // An English leather saddle with its stirrups hanging, front along +z; creatures.ts sizes it.
  'gear-saddle': { length: 1 },
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
  // Ruins at real size: a gutted two-storey concrete frame, a tall broken stairwell block, a
  // freestanding graffiti wall, a heap of broken reinforced concrete and loose chunks.
  'ruin-a': { width: 14 },
  'ruin-b': { height: 8 },
  'ruin-wall': { width: 6 },
  'rubble-pile': { width: 5 },
  'rubble-chunks': { width: 0.5, set: true },
  // The landmarks' buildings and props at real size (see shared/landmarks.ts, whose solid parts
  // are measured at these sizes).
  'lm-petrol': { width: 22 },
  'lm-warehouse': { width: 14 },
  'lm-house': { width: 11 },
  'lm-shed': { height: 4.2 },
  'lm-container': { width: 6.1 },
  'lm-container2': { width: 9 },
  'lm-waterTower': { height: 12 },
  'lm-pumpJack': { height: 6 },
  'lm-guardTower': { height: 7 },
  'lm-tent': { width: 9 },
  'lm-radioTower': { height: 30 },
  // Loot crates (sized as DEPLOYABLE_INFO), the parachute and a C-17 sized supply plane.
  crate: { width: 1.5 },
  'crate-military': { width: 1.3 },
  'crate-drop': { width: 1.4 },
  parachute: { height: 5 },
  plane: { width: 55 },
  // Held guns, turned so the barrel points along +z, at their real overall lengths.
  'gun-assaultRifle': { length: 0.88, turn: [0, -Math.PI / 2, 0] },
  'gun-boltRifle': { length: 1.23, drop: /bayonet/ },
  'gun-doubleBarrel': { length: 1.1, turn: [0, -Math.PI / 2, 0] },
  'gun-l96': { length: 1.2, turn: [0, Math.PI / 2, 0] },
  'gun-lr300': { length: 0.92, turn: [0, Math.PI, 0] },
  'gun-m249': { length: 1.04 },
  'gun-mp5': { length: 0.7, turn: [0, Math.PI, 0] },
  'gun-pumpShotgun': { length: 1.06, turn: [0, -Math.PI / 2, 0] },
  'gun-revolver': { length: 0.3 },
  // The file has a spare magazine lying beside the pistol.
  'gun-semiPistol': { length: 0.216, drop: /_mag_/ },
  'gun-semiRifle': { length: 1.02, drop: /bayonet|clip/ },
  'gun-thompson': { length: 0.81, drop: /bullet/ },
  'gun-eoka': { length: 0.3 },
  // Lying on its side in the file, muzzle along -x.
  'gun-waterpipe': { length: 0.6, turn: [-Math.PI / 2, Math.PI, Math.PI / 2] },
  'gun-customSmg': { length: 0.78, turn: [0, -Math.PI / 2, 0] },
  'gun-crossbow': { length: 0.8, turn: [0, Math.PI, 0] },
  // Strung bow lying flat in the file; stood up with the string at the back.
  'gun-huntingBow': { height: 1.3, turn: [-Math.PI / 2, 0, Math.PI / 2] },
  // Tools stand handle down, head up, the axe's edge and the pick's points along z.
  'tool-salvagedAxe': { height: 0.4, turn: [0, 0, -Math.PI / 2] },
  'tool-salvagedPickaxe': { height: 0.72, turn: [Math.PI, Math.PI / 2, 0] },
  'tool-rock': { width: 0.12 },
  'tool-stoneHatchet': { height: 0.45, turn: [0, Math.PI, 0] },
  // Modelled leaning over; stood upright.
  'tool-stonePickaxe': { height: 0.6, turn: [0.75, 0, 0] },
  // Blades lie flat in their files; stood point up with the edge along z.
  'tool-machete': { height: 0.6, turn: [0, Math.PI, -Math.PI / 2] },
  'tool-salvagedSword': { height: 0.9, turn: [-Math.PI / 2, Math.PI, -Math.PI / 2] },
  'tool-woodenSpear': { height: 2 },
  'tool-stoneSpear': { height: 2, turn: [0.97, 0, 0] },
  // The higher-tier weapons. Spare rounds and magazines lying beside a gun are left out.
  'gun-m4': { length: 0.84 },
  'gun-scarH': { length: 0.97, turn: [0, -Math.PI / 2, 0], drop: /^Bullet/ },
  'gun-m14': { length: 1.12, turn: [0, -Math.PI / 2, 0] },
  'gun-hk416': { length: 0.8 },
  'gun-aug': { length: 0.79, turn: [0, -Math.PI / 2, 0] },
  'gun-vector': { length: 0.7 },
  'gun-ump45': { length: 0.69, turn: [0, -Math.PI / 2, 0] },
  'gun-p90': { length: 0.5, turn: [0, Math.PI, 0] },
  'gun-deagle': { length: 0.27, drop: /^Bullet(Case)?_low/ },
  // The file holds two copies of the pistol and a loose magazine.
  'gun-m1911': { length: 0.216, turn: [0, Math.PI, 0], drop: /002|magazine_empty/ },
  // A shell stands beside the grip in the same mesh as the gun.
  'gun-spas12': { length: 1.04, turn: [0, Math.PI, 0], cut: [[0.32, 0.38, -0.01, 0.3]] },
  'gun-saiga12': { length: 1.0, turn: [0, -Math.PI / 2, 0] },
  // Tilted nose-up in its file, with a round lying off the muzzle.
  'gun-m82': { length: 1.45, turn: [0.1405, 0, 0], cut: [[0.9, 1.01, 0.5, 0.75]] },
  'gun-svd': { length: 1.22, turn: [0, Math.PI, 0] },
  'gun-m60': { length: 1.1, turn: [0, Math.PI / 2, 0], cut: [[0.3, 0.4, 0.8, 1.01]] },
  // Lies diagonally in its file; stood up with the string at the back.
  'gun-compoundBow': { height: 0.95, turn: [0.84, 0, 0] },
  'tool-combatKnife': { height: 0.33, turn: [0, 0, Math.PI / 2] },
  'tool-nailBat': { height: 0.84, turn: [Math.PI / 2, 0, 0] },
  'tool-fireAxe': { height: 0.9, turn: [-0.048, 0.263, -1.542] },
  // Lies at an angle in all three axes; found by lining the handle up with y and the head with z.
  'tool-sledgehammer': { height: 0.9, turn: [-2.679, -0.679, 2.835] },
};

const models = new Map<string, Model[]>();

function build(root: THREE.Object3D, fit: Fit, alpha?: THREE.Texture): Model | undefined {
  const parts: THREE.BufferGeometry[] = [];
  const materials: THREE.MeshStandardMaterial[] = [];
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || fit.drop?.test(mesh.name)) return;
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    // Keep only what every part has, so the parts can be merged.
    for (const key of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(key)) geo.deleteAttribute(key);
    parts.push(geo);
    materials.push(mesh.material as THREE.MeshStandardMaterial);
  });
  if (!parts.length) return undefined;
  if (fit.turn) for (const geo of parts) geo.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...fit.turn)));
  if (fit.cut) cutBoxes(parts, fit.cut);
  const single = materials.every((m) => m === materials[0]);
  const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, !single)!;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const k = fit.height ? fit.height / size.y : fit.length ? fit.length / size.z : fit.width ? fit.width / Math.max(size.x, size.z) : 1;
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

/** Removes the triangles whose middle falls inside any of the boxes (see Fit.cut). */
function cutBoxes(parts: THREE.BufferGeometry[], boxes: [number, number, number, number][]) {
  const all = new THREE.Box3();
  for (const geo of parts) {
    geo.computeBoundingBox();
    all.union(geo.boundingBox!);
  }
  const size = all.getSize(new THREE.Vector3());
  const inside = (y: number, z: number) => {
    const fz = (z - all.min.z) / size.z;
    const fy = (y - all.min.y) / size.y;
    return boxes.some(([z0, z1, y0, y1]) => fz > z0 && fz < z1 && fy > y0 && fy < y1);
  };
  for (let i = 0; i < parts.length; i++) {
    const geo = parts[i].index ? parts[i] : parts[i].setIndex([...Array(parts[i].attributes.position.count).keys()]);
    const pos = geo.attributes.position;
    const idx = geo.index!.array;
    const kept: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      const y = (pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3;
      const z = (pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3;
      if (!inside(y, z)) kept.push(a, b, c);
    }
    // Unindexed, so the cut-away vertices go too and no longer count towards the model's size.
    parts[i] = geo.setIndex(kept).toNonIndexed();
  }
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
  for (const m of out) m.geometry.name = name;
  if (out.length) models.set(name, out);
}

/** Rigged characters and the car, kept whole (skeleton, skinned meshes, wheels) rather than merged. */
const CHARACTERS = ['survivor', 'ashhound', 'mule', 'elk', 'buffalo', 'camel', 'bear', 'vehicle-pickup', 'vehicle-sedan', 'vehicle-van', 'vehicle-jeep', 'vehicle-heli'];
const characters = new Map<string, THREE.Object3D>();
/** Animations that came with a character, by name. */
const clips = new Map<string, THREE.AnimationClip[]>();

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
  clips.set(name, gltf.animations);
}

/**
 * Loads every model; resolves even if some fail, so a missing file never stops the game.
 * `progress` hears how many of them have finished.
 */
export async function loadModels(progress?: (done: number, total: number) => void): Promise<void> {
  // The files are Draco-compressed (see scripts/compress-assets.py); the decoder is served
  // from /draco.
  const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'));
  const warn = (n: string) => (e: unknown) => console.warn(`model ${n} failed to load`, e);
  const jobs = [lodReady, ...Object.keys(FIT).map((n) => load(loader, n).catch(warn(n))), ...CHARACTERS.map((n) => loadCharacter(loader, n).catch(warn(n)))];
  let done = 0;
  progress?.(0, jobs.length);
  await Promise.all(jobs.map((j) => j.then(() => progress?.(++done, jobs.length))));
}

/** A fresh copy of a rigged character with its own skeleton, or none if it didn't load. */
export function character(name: string): THREE.Object3D | undefined {
  const scene = characters.get(name);
  return scene && cloneSkinned(scene);
}

/** The animations a rigged character came with (none if it has none or didn't load). */
export function characterClips(name: string): THREE.AnimationClip[] {
  return clips.get(name) ?? [];
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
