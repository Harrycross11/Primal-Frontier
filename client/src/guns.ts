// Bows, guns and melee weapons. Each gun is described by a few proportions (receiver,
// barrel, stock, magazine, sights, finish) and both its 3D model and its inventory icon are
// built from that description, so the two always match.
//
// Where a photo-scanned model of the gun has loaded (see models.ts), it is used instead, placed
// in the same model space by where its pistol grip and bore are.
//
// Model space: the grip is at the origin, the barrel points along +z, up is +y. Metres.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ItemId } from '../../shared/items.ts';
import { model } from './models.ts';
import { gunMetalSurface, rustSurface, woodGrainSurface } from './textures.ts';

type Finish = 'black' | 'rust' | 'scrap' | 'steel';
type Stock = 'none' | 'wood' | 'solid' | 'skeleton' | 'pipe';
type Mag = 'none' | 'box' | 'curved' | 'drum' | 'tube' | 'belt' | 'cylinder' | 'grip';

interface GunLook {
  /** Receiver length, height and width. */
  body: [number, number, number];
  barrel: number;
  bore: number;
  stock: Stock;
  stockLength: number;
  mag: Mag;
  finish: Finish;
  /** Wooden handguard under the barrel. */
  wood?: boolean;
  scope?: boolean;
  /** Side-by-side barrels. */
  double?: boolean;
  /** Pump grip under the barrel. */
  pump?: boolean;
  /** Pistol grips sit under the back of the receiver; rifles further forward. */
  pistol?: boolean;
  /** Barrel shroud with cooling holes. */
  shroud?: boolean;
  /** Bipod under the front. */
  bipod?: boolean;
}

export const GUN_LOOKS: Partial<Record<ItemId, GunLook>> = {
  eoka: { body: [0.12, 0.05, 0.05], barrel: 0.2, bore: 0.022, stock: 'none', stockLength: 0, mag: 'none', finish: 'scrap', wood: true, pistol: true },
  waterpipe: { body: [0.2, 0.08, 0.06], barrel: 0.42, bore: 0.028, stock: 'pipe', stockLength: 0.32, mag: 'none', finish: 'scrap', wood: true },
  revolver: { body: [0.14, 0.08, 0.04], barrel: 0.16, bore: 0.012, stock: 'none', stockLength: 0, mag: 'cylinder', finish: 'steel', pistol: true },
  doubleBarrel: { body: [0.18, 0.08, 0.06], barrel: 0.55, bore: 0.017, stock: 'wood', stockLength: 0.36, mag: 'none', finish: 'rust', wood: true, double: true },
  semiPistol: { body: [0.18, 0.065, 0.032], barrel: 0.02, bore: 0.009, stock: 'none', stockLength: 0, mag: 'grip', finish: 'black', pistol: true },
  pumpShotgun: { body: [0.26, 0.085, 0.055], barrel: 0.5, bore: 0.016, stock: 'solid', stockLength: 0.34, mag: 'tube', finish: 'black', pump: true },
  thompson: { body: [0.3, 0.08, 0.05], barrel: 0.24, bore: 0.012, stock: 'wood', stockLength: 0.3, mag: 'drum', finish: 'steel', wood: true },
  customSmg: { body: [0.28, 0.07, 0.045], barrel: 0.16, bore: 0.012, stock: 'skeleton', stockLength: 0.24, mag: 'box', finish: 'scrap', shroud: true },
  semiRifle: { body: [0.3, 0.075, 0.045], barrel: 0.38, bore: 0.011, stock: 'wood', stockLength: 0.34, mag: 'box', finish: 'rust', wood: true },
  mp5: { body: [0.3, 0.08, 0.05], barrel: 0.12, bore: 0.012, stock: 'skeleton', stockLength: 0.26, mag: 'curved', finish: 'black', shroud: true },
  assaultRifle: { body: [0.32, 0.08, 0.05], barrel: 0.34, bore: 0.011, stock: 'wood', stockLength: 0.34, mag: 'curved', finish: 'black', wood: true },
  lr300: { body: [0.34, 0.085, 0.05], barrel: 0.3, bore: 0.011, stock: 'skeleton', stockLength: 0.3, mag: 'box', finish: 'black', shroud: true },
  boltRifle: { body: [0.3, 0.07, 0.045], barrel: 0.5, bore: 0.01, stock: 'wood', stockLength: 0.38, mag: 'box', finish: 'steel', wood: true, scope: true },
  l96: { body: [0.36, 0.085, 0.06], barrel: 0.55, bore: 0.012, stock: 'solid', stockLength: 0.4, mag: 'box', finish: 'black', scope: true, bipod: true },
  m249: { body: [0.4, 0.12, 0.08], barrel: 0.46, bore: 0.014, stock: 'solid', stockLength: 0.34, mag: 'belt', finish: 'black', shroud: true, bipod: true },
};

const FINISH_COLORS: Record<Finish, number> = { black: 0x2c2d2e, rust: 0x7a5236, scrap: 0x6a6762, steel: 0x6f7378 };

const mats = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material) {
  let m = mats.get(key);
  if (!m) mats.set(key, (m = make()));
  return m;
}
const finishMat = (f: Finish) =>
  mat(`gun-${f}`, () =>
    f === 'rust' || f === 'scrap'
      ? new THREE.MeshStandardMaterial({ ...rustSurface(f === 'rust' ? '#6a5a4c' : '#6a6a64'), color: FINISH_COLORS[f], roughness: 0.6, metalness: 0.6 })
      : new THREE.MeshStandardMaterial({ ...gunMetalSurface(), color: FINISH_COLORS[f], roughness: f === 'black' ? 0.5 : 0.38, metalness: 0.8 }),
  );
const woodMat = () => mat('gun-wood', () => new THREE.MeshStandardMaterial({ ...woodGrainSurface(), color: 0xc08a60, roughness: 0.55 }));
/** Black polymer furniture, slightly textured. */
const darkMat = () => mat('gun-dark', () => new THREE.MeshStandardMaterial({ ...gunMetalSurface(), color: 0x2a2a2a, roughness: 0.68, metalness: 0.15 }));
const glassMat = () => mat('gun-glass', () => new THREE.MeshStandardMaterial({ color: 0x223844, roughness: 0.1, metalness: 0.5 }));
const clothMat = () => mat('gun-cloth', () => new THREE.MeshStandardMaterial({ color: 0x8a7a5a, roughness: 1 }));
const stoneMat = () => mat('gun-stone', () => new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 1, flatShading: true }));

function part(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.rotation.x = rx;
  mesh.castShadow = true;
  g.add(mesh);
  return mesh;
}

/** Boxes with softly rounded edges, so every edge catches a highlight the way machined parts do. */
const box = (w: number, h: number, l: number) => new RoundedBoxGeometry(w, h, l, 2, Math.min(w, h, l) * 0.22);
/** A flat 2D profile in the (z, y) plane, extruded sideways to a width, with bevelled edges. */
function profile(points: [number, number][], width: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const bevel = Math.min(0.006, width * 0.2);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 8 });
  geo.translate(0, 0, -(width - bevel * 2) / 2);
  // Shape x becomes model z; the extrusion becomes model x.
  geo.rotateY(-Math.PI / 2);
  geo.computeVertexNormals();
  return geo;
}
/** A cylinder lying along z. */
const tube = (r: number, len: number, seg = 10) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);

/**
 * Scanned guns, as fractions of the model's length (from the back) and height (from the bottom),
 * read off side views of the models. `grip` is the top of the pistol grip or the wrist of the
 * stock, which sits at the hand's origin; `bore` is how high the barrel is. `palm` is the middle
 * of the grip, where the shooting hand closes; `hold` is the underside of the handguard, pump or
 * fore-end, where the other hand goes.
 */
const SCANNED: Partial<Record<ItemId, { grip: [number, number]; bore: number; palm: [number, number]; hold?: [number, number] }>> = {
  assaultRifle: { grip: [0.325, 0.5], bore: 0.8, palm: [0.315, 0.45], hold: [0.68, 0.693] },
  boltRifle: { grip: [0.275, 0.5], bore: 0.7, palm: [0.26, 0.519], hold: [0.5, 0.462] },
  doubleBarrel: { grip: [0.37, 0.56], bore: 0.93, palm: [0.33, 0.72], hold: [0.52, 0.7] },
  l96: { grip: [0.275, 0.4], bore: 0.66, palm: [0.27, 0.404], hold: [0.45, 0.448] },
  lr300: { grip: [0.39, 0.48], bore: 0.74, palm: [0.37, 0.383], hold: [0.65, 0.61] },
  m249: { grip: [0.31, 0.53], bore: 0.78, palm: [0.3, 0.51], hold: [0.62, 0.593] },
  mp5: { grip: [0.435, 0.57], bore: 0.79, palm: [0.42, 0.414], hold: [0.72, 0.634] },
  pumpShotgun: { grip: [0.31, 0.55], bore: 0.93, palm: [0.29, 0.72], hold: [0.63, 0.614] },
  revolver: { grip: [0.21, 0.58], bore: 0.9, palm: [0.14, 0.362] },
  semiPistol: { grip: [0.31, 0.78], bore: 0.93, palm: [0.2, 0.375] },
  semiRifle: { grip: [0.27, 0.6], bore: 0.85, palm: [0.25, 0.57], hold: [0.55, 0.561] },
  thompson: { grip: [0.42, 0.53], bore: 0.83, palm: [0.41, 0.49], hold: [0.7, 0.678] },
  eoka: { grip: [0.32, 0.8], bore: 0.86, palm: [0.29, 0.42] },
  // A bolt-action pipe gun with a taped grip under the barrel block: the bolt tube rests in the
  // shoulder like a stock, and the other hand takes the barrel under the lamp.
  waterpipe: { grip: [0.68, 0.6], bore: 0.8, palm: [0.68, 0.3], hold: [0.88, 0.6] },
  customSmg: { grip: [0.38, 0.68], bore: 0.92, palm: [0.36, 0.62], hold: [0.77, 0.82] },
  // The crossbow is gripped at the wrist of the stock behind its trigger lever and supported
  // under the stock in front of the lever, as far forward as an arm reaches. Its bore is the bolt groove.
  crossbow: { grip: [0.38, 0.6], bore: 0.64, palm: [0.36, 0.55], hold: [0.6, 0.45] },
  // The bow is lengths as seen side on, string at the back: grip is the riser, palm the string
  // where the arrow nocks, hold the fist round the riser.
  huntingBow: { grip: [0.86, 0.5], bore: 0.55, palm: [0.02, 0.53], hold: [0.86, 0.47] },
  compoundBow: { grip: [0.86, 0.42], bore: 0.38, palm: [0.03, 0.38], hold: [0.86, 0.42] },
  // Pistols.
  deagle: { grip: [0.25, 0.68], bore: 0.85, palm: [0.2, 0.35] },
  m1911: { grip: [0.25, 0.68], bore: 0.88, palm: [0.2, 0.3] },
  // SMGs. The Vector and AUG have a vertical foregrip; the P90's other hand goes under its nose.
  ump45: { grip: [0.45, 0.56], bore: 0.75, palm: [0.41, 0.42], hold: [0.66, 0.68] },
  vector: { grip: [0.4, 0.78], bore: 0.72, palm: [0.36, 0.62], hold: [0.86, 0.5] },
  p90: { grip: [0.6, 0.45], bore: 0.4, palm: [0.58, 0.28], hold: [0.85, 0.3] },
  // Shotguns.
  spas12: { grip: [0.29, 0.5], bore: 0.85, palm: [0.27, 0.3], hold: [0.58, 0.55] },
  saiga12: { grip: [0.3, 0.68], bore: 0.8, palm: [0.28, 0.48], hold: [0.5, 0.76] },
  // Rifles. The M4 and AUG have a vertical foregrip; the M14 is held at the wrist of its wooden stock.
  m4: { grip: [0.33, 0.5], bore: 0.7, palm: [0.31, 0.36], hold: [0.66, 0.38] },
  hk416: { grip: [0.34, 0.55], bore: 0.8, palm: [0.31, 0.3], hold: [0.65, 0.68] },
  aug: { grip: [0.46, 0.55], bore: 0.62, palm: [0.43, 0.35], hold: [0.79, 0.3] },
  scarH: { grip: [0.19, 0.42], bore: 0.6, palm: [0.15, 0.25], hold: [0.52, 0.47] },
  m14: { grip: [0.3, 0.55], bore: 0.82, palm: [0.28, 0.45], hold: [0.55, 0.6] },
  svd: { grip: [0.25, 0.5], bore: 0.6, palm: [0.23, 0.3], hold: [0.45, 0.5] },
  m82: { grip: [0.25, 0.45], bore: 0.6, palm: [0.22, 0.3], hold: [0.48, 0.55] },
  m60: { grip: [0.3, 0.45], bore: 0.6, palm: [0.27, 0.28], hold: [0.48, 0.4] },
};

/** Guns held out in front at arm's length rather than shouldered. */
export const PISTOLS: ItemId[] = ['revolver', 'semiPistol', 'eoka', 'm1911', 'deagle'];

/** The scanned model's grip and muzzle in its own geometry, if it loaded. */
function scanned(item: ItemId) {
  const s = SCANNED[item];
  const m = s && model(`gun-${item}`);
  if (!m) return null;
  const box = m.geometry.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const grip = new THREE.Vector3(0, box.min.y + s.grip[1] * size.y, box.min.z + s.grip[0] * size.z);
  const at = ([z, y]: [number, number]) => new THREE.Vector3(0, box.min.y + y * size.y, box.min.z + z * size.z).sub(grip);
  const muzzle = new THREE.Vector3(0, box.min.y + s.bore * size.y, box.max.z).sub(grip);
  return { model: m, grip, muzzle, palm: at(s.palm), hold: s.hold ? at(s.hold) : null };
}

/** Where the front of the receiver is, for muzzle flashes: the barrel tip in model space. */
export function muzzleOffset(item: ItemId): THREE.Vector3 {
  const scan = scanned(item);
  if (scan) return scan.muzzle.clone();
  const look = GUN_LOOKS[item];
  if (!look) return new THREE.Vector3(0, 0.05, 0.6);
  const [len, h] = look.body;
  const front = look.pistol ? len * 0.75 : len * 0.55;
  return new THREE.Vector3(0, h * 0.75, front + look.barrel);
}

/**
 * Where the hands go on a gun, in its model space: the shooting palm on the pistol grip, and the
 * other hand under the handguard (null for pistols, held two-handed round the grip).
 */
export function gunHands(item: ItemId): { palm: THREE.Vector3; hold: THREE.Vector3 | null } {
  const scan = scanned(item);
  if (scan) return { palm: scan.palm, hold: scan.hold };
  if (item === 'huntingBow') return { palm: new THREE.Vector3(0, 0.02, -0.14), hold: new THREE.Vector3(0, 0.02, 0.08) };
  const look = GUN_LOOKS[item];
  const m = muzzleOffset(item);
  // Code-built guns: the grip hangs below the receiver; the handguard is a little over a third of
  // the way to the muzzle.
  return { palm: new THREE.Vector3(0, -0.045, 0), hold: look?.pistol ? null : new THREE.Vector3(0, m.y * 0.2, m.z * 0.4) };
}

export function buildGun(item: ItemId): THREE.Group | null {
  const look = GUN_LOOKS[item];
  const scan = scanned(item);
  if (!look && !scan) return null;
  const g = new THREE.Group();
  if (scan) {
    const mesh = new THREE.Mesh(scan.model.geometry, scan.model.material);
    mesh.position.copy(scan.grip).negate();
    mesh.castShadow = true;
    // Shared with every other copy of this gun; not to be disposed with one of them.
    mesh.userData.shared = true;
    g.add(mesh);
    return g;
  }
  if (!look) return null;
  const metal = finishMat(look.finish);
  const [len, h, w] = look.body;
  // The grip is at z = 0. Pistols hold the receiver forward of it; rifles reach further back.
  const back = look.pistol ? -len * 0.25 : -len * 0.45;
  const front = back + len;
  const top = h;
  const midY = h / 2 + 0.03;
  part(g, box(w, h, len), metal, 0, midY, back + len / 2);
  // Pistol grip.
  const grip = part(g, box(w * 0.85, 0.11, 0.04), look.mag === 'grip' || look.pistol ? metal : darkMat(), 0, -0.02, 0, -0.25);
  if (look.finish === 'steel' && look.pistol) grip.material = woodMat();
  // Trigger guard.
  part(g, new THREE.TorusGeometry(0.022, 0.004, 4, 10, Math.PI).rotateY(Math.PI / 2), metal, 0, 0.03, 0.035);

  // Barrel(s).
  const barrelY = midY + h * 0.2;
  const barrels = look.double ? [-look.bore * 1.1, look.bore * 1.1] : [0];
  for (const x of barrels) part(g, tube(look.bore, look.barrel), metal, x, barrelY, front + look.barrel / 2);
  if (look.shroud) {
    const shroud = part(g, tube(look.bore * 2.3, look.barrel * 0.7, 8), darkMat(), 0, barrelY, front + look.barrel * 0.35);
    shroud.scale.set(1, 1, 1);
  }
  if (look.wood) part(g, box(w * 1.05, h * 0.55, look.barrel * 0.55), woodMat(), 0, midY - h * 0.15, front + look.barrel * 0.28);
  if (look.pump) part(g, tube(look.bore * 1.8, 0.14), woodMat(), 0, barrelY - look.bore * 2.5, front + look.barrel * 0.3);
  // Front sight, and a rear sight or a top rail.
  part(g, box(0.006, 0.02, 0.01), metal, 0, barrelY + look.bore + 0.008, front + look.barrel - 0.02);
  if (look.shroud && look.finish === 'black') {
    part(g, box(w * 0.55, 0.008, len * 0.9), darkMat(), 0, top + 0.034, back + len / 2);
    for (let z = back + 0.02; z < front - 0.01; z += 0.018) part(g, box(w * 0.62, 0.007, 0.008), darkMat(), 0, top + 0.041, z);
  } else if (!look.scope) {
    part(g, box(w * 0.5, 0.016, 0.012), metal, 0, top + 0.036, back + 0.03);
  }
  // Ejection port on the right, trigger inside the guard, and a muzzle device on long guns.
  part(g, box(0.004, h * 0.32, len * 0.22), darkMat(), w / 2 + 0.001, midY + h * 0.12, back + len * 0.55);
  part(g, box(0.006, 0.026, 0.008), metal, 0, 0.022, 0.032, 0.35);
  if (!look.pistol && !look.double && look.mag !== 'none') {
    part(g, tube(look.bore * 1.7, 0.045, 10), darkMat(), 0, barrelY, front + look.barrel + 0.02);
  }
  // Rivets and screws on the receiver side.
  for (const z of [back + 0.03, front - 0.03]) part(g, tube(0.004, 0.004, 6).rotateY(Math.PI / 2), metal, w / 2 + 0.002, midY - h * 0.2, z);

  // Stock.
  const stockZ = back - look.stockLength / 2;
  if (look.stock === 'wood' || look.stock === 'solid') {
    // A real stock profile: slim at the wrist behind the receiver, dropping to a deep butt.
    const L = look.stockLength;
    const top = midY + h * 0.45;
    const wrist = midY - h * 0.35;
    const drop = look.stock === 'wood' ? h * 0.35 : h * 0.15;
    const shape: [number, number][] = [
      [back + 0.01, top],
      [back - L * 0.35, top - drop * 0.4],
      [back - L, top - drop],
      [back - L, top - drop - h * 1.55],
      [back - L * 0.55, wrist - h * 0.55],
      [back - L * 0.25, wrist - h * 0.1],
      [back + 0.01, wrist],
    ];
    part(g, profile(shape, w * 0.85), look.stock === 'wood' ? woodMat() : darkMat(), 0, 0, 0);
    // Rubber butt pad.
    part(g, box(w * 0.9, h * 1.55, 0.015), darkMat(), 0, top - drop - h * 0.78, back - L - 0.004);
  } else if (look.stock === 'skeleton') {
    part(g, box(0.012, 0.012, look.stockLength), metal, 0, midY + h * 0.25, stockZ);
    part(g, box(0.012, 0.012, look.stockLength), metal, 0, midY - h * 0.35, stockZ, -0.1);
    part(g, box(w * 0.8, h * 1.3, 0.02), darkMat(), 0, midY - h * 0.1, back - look.stockLength);
  } else if (look.stock === 'pipe') {
    part(g, tube(0.02, look.stockLength), woodMat(), 0, midY - 0.01, stockZ);
    part(g, tube(0.024, 0.05), clothMat(), 0, midY - 0.01, stockZ);
  }

  // Magazine.
  const magZ = look.pistol ? 0 : back + len * 0.55;
  if (look.mag === 'box') part(g, box(w * 0.7, 0.14, 0.05), darkMat(), 0, -0.05, magZ, 0.08);
  else if (look.mag === 'curved') {
    // A banana magazine, curving forward as it drops.
    const pts: [number, number][] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push([magZ - 0.025 + t * t * 0.07, 0.03 - t * 0.17]);
    }
    for (let i = 6; i >= 0; i--) {
      const t = i / 6;
      pts.push([magZ + 0.028 + t * t * 0.085, 0.03 - t * 0.16]);
    }
    part(g, profile(pts, w * 0.62), look.finish === 'black' ? darkMat() : finishMat('steel'), 0, 0, 0);
  } else if (look.mag === 'drum') part(g, new THREE.CylinderGeometry(0.08, 0.08, w * 1.1, 16).rotateZ(Math.PI / 2), darkMat(), 0, -0.07, magZ);
  else if (look.mag === 'tube') part(g, tube(look.bore * 0.9, look.barrel * 0.85), metal, 0, barrelY - look.bore * 2.2, front + look.barrel * 0.43);
  else if (look.mag === 'belt') part(g, box(0.1, 0.12, 0.14), darkMat(), w * 0.6 + 0.04, midY - 0.05, magZ);
  else if (look.mag === 'cylinder') part(g, tube(0.028, 0.05, 6), metal, 0, barrelY - 0.012, front - 0.03);

  if (look.scope) {
    part(g, tube(0.02, 0.26, 12), darkMat(), 0, top + 0.07, back + len * 0.5);
    for (const z of [-0.13, 0.13]) part(g, tube(0.026, 0.05, 12), darkMat(), 0, top + 0.07, back + len * 0.5 + z);
    part(g, new THREE.CircleGeometry(0.02, 12), glassMat(), 0, top + 0.07, back + len * 0.5 + 0.156);
    for (const z of [-0.06, 0.06]) part(g, box(0.012, 0.04, 0.012), darkMat(), 0, top + 0.03, back + len * 0.5 + z);
  }
  if (look.bipod) {
    for (const x of [-1, 1]) {
      const leg = part(g, box(0.01, 0.16, 0.01), darkMat(), x * 0.03, barrelY - 0.08, front + look.barrel * 0.7);
      leg.rotation.z = x * 0.25;
    }
  }
  return g;
}

/** Bows, melee weapons, ammo and medical items held in the hand, in the same model space. */
export function buildOtherWeapon(item: ItemId): THREE.Group | null {
  const g = new THREE.Group();
  const wood = woodMat();
  switch (item) {
    case 'huntingBow':
    case 'crossbow': {
      const cross = item === 'crossbow';
      const limbR = cross ? 0.32 : 0.55;
      const arc = new THREE.TorusGeometry(limbR, 0.012, 6, 24, cross ? 1.6 : 1.9);
      const limb = part(g, arc, cross ? finishMat('scrap') : wood, 0, 0.02, -limbR + 0.08);
      if (cross) {
        limb.rotation.set(Math.PI / 2, 0, Math.PI / 2 - 0.8);
        part(g, box(0.04, 0.04, 0.6), wood, 0, 0.03, 0.15);
      } else {
        // Upright, curving back from the grip to the tips.
        limb.rotation.set(0, -Math.PI / 2, -0.95);
        part(g, box(0.025, 0.12, 0.03), clothMat(), 0, 0.02, 0.08);
      }
      const string = new THREE.BufferGeometry().setFromPoints(
        cross
          ? [new THREE.Vector3(-limbR * 0.72, 0.02, 0.32), new THREE.Vector3(0, 0.02, 0.05), new THREE.Vector3(limbR * 0.72, 0.02, 0.32)]
          : [new THREE.Vector3(0, limbR * 0.81 + 0.02, -0.05), new THREE.Vector3(0, 0.02, -0.12), new THREE.Vector3(0, -limbR * 0.81 + 0.02, -0.05)],
      );
      // The string as thin cords, so it has thickness and catches light.
      const pts: THREE.Vector3[] = [];
      const pos = string.attributes.position;
      for (let i = 0; i < pos.count; i++) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i));
      const cord = mat('bowstring', () => new THREE.MeshStandardMaterial({ color: 0xd8d0bc, roughness: 0.8 }));
      for (let i = 0; i + 1 < pts.length; i++) {
        const d = pts[i + 1].clone().sub(pts[i]);
        const c = part(g, new THREE.CylinderGeometry(0.0025, 0.0025, d.length(), 5), cord, 0, 0, 0);
        c.position.copy(pts[i]).addScaledVector(d, 0.5);
        c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      }
      if (cross) {
        // Trigger housing, a stirrup at the front and a loaded bolt.
        part(g, box(0.05, 0.06, 0.08), finishMat('scrap'), 0, 0.0, 0.05);
        part(g, new THREE.TorusGeometry(0.05, 0.006, 5, 12, Math.PI).rotateX(Math.PI / 2), finishMat('scrap'), 0, 0.03, 0.47);
        part(g, tube(0.005, 0.38, 6), wood, 0, 0.055, 0.25);
      }
      return g;
    }
    case 'woodenSpear':
    case 'stoneSpear': {
      part(g, tube(0.016, 1.8, 8), wood, 0, 0, 0.35);
      if (item === 'stoneSpear') {
        // A knapped leaf-shaped point, lashed into a split in the shaft.
        part(g, profile([[1.22, 0], [1.3, 0.035], [1.42, 0], [1.3, -0.035]], 0.014), stoneMat(), 0, 0, 0);
        for (let z = 1.17; z < 1.25; z += 0.012) part(g, new THREE.TorusGeometry(0.018, 0.005, 4, 10), clothMat(), 0, 0, z);
      } else part(g, new THREE.ConeGeometry(0.016, 0.16, 8).rotateX(Math.PI / 2), mat('spear-tip', () => new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 })), 0, 0, 1.33);
      for (let z = -0.05; z < 0.1; z += 0.012) part(g, new THREE.TorusGeometry(0.018, 0.005, 4, 10), clothMat(), 0, 0, z);
      return g;
    }
    case 'machete': {
      // A broad blade swelling toward a clipped tip, with a riveted grip.
      part(g, box(0.026, 0.034, 0.13), darkMat(), 0, 0, 0);
      for (const z of [-0.03, 0.03]) part(g, tube(0.005, 0.03, 6).rotateY(Math.PI / 2), finishMat('steel'), 0, 0, z);
      part(g, profile([[0.06, 0.012], [0.07, 0.022], [0.42, 0.034], [0.5, 0.02], [0.52, -0.01], [0.46, -0.028], [0.07, -0.018], [0.06, -0.012]], 0.004), finishMat('steel'), 0, 0.006, 0);
      return g;
    }
    case 'salvagedSword': {
      // A blade cut from a road sign or leaf spring: rusty, ragged and wrapped in cloth.
      part(g, box(0.03, 0.035, 0.14), clothMat(), 0, 0, 0);
      part(g, box(0.12, 0.028, 0.025), finishMat('scrap'), 0, 0, 0.08);
      part(g, profile([[0.09, 0.03], [0.6, 0.03], [0.74, 0.0], [0.62, -0.035], [0.09, -0.035]], 0.007), finishMat('rust'), 0, 0.005, 0);
      for (let z = -0.06; z < 0.07; z += 0.014) part(g, new THREE.TorusGeometry(0.022, 0.005, 4, 10), clothMat(), 0, 0, z).scale.set(0.8, 1, 1);
      return g;
    }
    case 'bandage':
      part(g, new THREE.CylinderGeometry(0.035, 0.035, 0.06, 16), mat('gauze', () => new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 1 })), 0, 0, 0.03);
      part(g, new THREE.CylinderGeometry(0.012, 0.012, 0.061, 10), mat('gauze-core', () => new THREE.MeshStandardMaterial({ color: 0x9a8a70, roughness: 1 })), 0, 0, 0.03);
      part(g, box(0.05, 0.002, 0.08), mat('gauze', () => new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 1 })), 0.02, -0.03, 0.08);
      return g;
    case 'cannedBeans': {
      // A dented tin with a faded paper label and a ring-pull lid.
      const tin = mat('tin', () => new THREE.MeshStandardMaterial({ color: 0xb0b2b0, roughness: 0.35, metalness: 0.9 }));
      const label = mat('beans-label', () => new THREE.MeshStandardMaterial({ color: 0xa8462c, roughness: 0.8 }));
      part(g, new THREE.CylinderGeometry(0.038, 0.038, 0.1, 20), tin, 0, 0.05, 0);
      part(g, new THREE.CylinderGeometry(0.0385, 0.0385, 0.062, 20, 1, true), label, 0, 0.05, 0);
      part(g, new THREE.CylinderGeometry(0.0386, 0.0386, 0.012, 20, 1, true), mat('beans-band', () => new THREE.MeshStandardMaterial({ color: 0xd8c27a, roughness: 0.8 })), 0, 0.05, 0);
      part(g, new THREE.TorusGeometry(0.036, 0.003, 4, 20).rotateX(Math.PI / 2), tin, 0, 0.1, 0);
      part(g, new THREE.TorusGeometry(0.009, 0.0025, 4, 10).rotateX(Math.PI / 2), tin, 0.015, 0.102, 0);
      return g;
    }
    case 'bottledWater': {
      // A clear plastic bottle, mostly full, with a blue cap and label.
      const plastic = mat('bottle', () => new THREE.MeshPhysicalMaterial({ color: 0xdfeef5, roughness: 0.08, transmission: 0.5, transparent: true, opacity: 0.45, thickness: 0.01 }));
      const shape = [[0.001, 0], [0.032, 0], [0.034, 0.01], [0.034, 0.15], [0.026, 0.18], [0.013, 0.2], [0.013, 0.215]].map(([r, y]) => new THREE.Vector2(r, y));
      part(g, new THREE.LatheGeometry(shape, 20), plastic, 0, 0, 0);
      part(g, new THREE.CylinderGeometry(0.031, 0.031, 0.13, 20), mat('bottle-water', () => new THREE.MeshStandardMaterial({ color: 0x8ec4dc, roughness: 0.05, transparent: true, opacity: 0.55 })), 0, 0.075, 0);
      part(g, new THREE.CylinderGeometry(0.0345, 0.0345, 0.05, 20, 1, true), mat('bottle-label', () => new THREE.MeshStandardMaterial({ color: 0x2f6aa8, roughness: 0.7 })), 0, 0.08, 0);
      part(g, new THREE.CylinderGeometry(0.015, 0.015, 0.018, 14), mat('bottle-cap', () => new THREE.MeshStandardMaterial({ color: 0x2a5a9a, roughness: 0.5 })), 0, 0.222, 0);
      return g;
    }
    case 'antiRadPills': {
      // An orange pill bottle with a white cap and a yellow warning label.
      part(g, new THREE.CylinderGeometry(0.024, 0.024, 0.075, 18), mat('pill-bottle', () => new THREE.MeshPhysicalMaterial({ color: 0xd8742a, roughness: 0.2, transmission: 0.25, transparent: true, opacity: 0.85 })), 0, 0.0375, 0);
      part(g, new THREE.CylinderGeometry(0.0245, 0.0245, 0.035, 18, 1, true), mat('pill-label', () => new THREE.MeshStandardMaterial({ color: 0xe0c040, roughness: 0.7 })), 0, 0.035, 0);
      part(g, new THREE.CylinderGeometry(0.027, 0.027, 0.018, 18), mat('pill-cap', () => new THREE.MeshStandardMaterial({ color: 0xece8e0, roughness: 0.6 })), 0, 0.084, 0);
      return g;
    }
    case 'mushroom': {
      const stem = mat('shroom-stem', () => new THREE.MeshStandardMaterial({ color: 0xd8cdb4, roughness: 0.9 }));
      const cap = mat('shroom-cap', () => new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.6 }));
      for (const [x, z, h, r] of [[0, 0, 0.07, 0.04], [0.045, 0.02, 0.05, 0.028]]) {
        part(g, new THREE.CylinderGeometry(r * 0.32, r * 0.42, h, 10), stem, x, h / 2, z);
        part(g, new THREE.SphereGeometry(r, 14, 7, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1), cap, x, h - 0.003, z);
      }
      return g;
    }
    case 'syringe': {
      const glass = mat('syringe-glass', () => new THREE.MeshPhysicalMaterial({ color: 0xdfeaf0, roughness: 0.05, transmission: 0.6, transparent: true, opacity: 0.55, thickness: 0.01 }));
      part(g, tube(0.012, 0.12, 14), glass, 0, 0.02, 0.05);
      part(g, tube(0.009, 0.08, 12), mat('serum', () => new THREE.MeshStandardMaterial({ color: 0xb03a2e, roughness: 0.3, emissive: 0x300805 })), 0, 0.02, 0.06);
      part(g, tube(0.0012, 0.05, 6), finishMat('steel'), 0, 0.02, 0.135);
      part(g, tube(0.003, 0.06, 8), darkMat(), 0, 0.02, -0.035);
      part(g, tube(0.016, 0.004, 14), darkMat(), 0, 0.02, -0.066);
      return g;
    }
    default:
      return null;
  }
}

/** A side-on silhouette of a gun for inventory icons, drawn from the same proportions as the model. */
export function gunIconBody(item: ItemId): string | null {
  const look = GUN_LOOKS[item];
  if (!look) return null;
  const [len, h] = look.body;
  const back = look.pistol ? -len * 0.25 : -len * 0.45;
  const front = back + len;
  const minZ = back - look.stockLength;
  const maxZ = front + look.barrel;
  const span = maxZ - minZ;
  // Long guns lie along the icon's diagonal, like Rust's; pistols sit level.
  const k = Math.min((look.pistol ? 32 : 46) / span, look.pistol ? 110 : 80);
  const ox = 20 - ((minZ + maxZ) / 2) * k;
  // Long guns are drawn thicker than true scale so they read at icon size.
  const ky = look.pistol ? k : k * 1.8;
  const X = (z: number) => (ox + z * k).toFixed(1);
  const Y = (y: number) => (21 - y * ky).toFixed(1);
  const rect = (z0: number, y0: number, z1: number, y1: number, fill: string, extra = '') =>
    `<rect x="${X(z0)}" y="${Y(y1)}" width="${((z1 - z0) * k).toFixed(1)}" height="${((y1 - y0) * ky).toFixed(1)}" fill="${fill}" ${extra}/>`;
  const metal = { black: '#55585c', rust: '#9a6640', scrap: '#7d7a74', steel: '#8d9298' }[look.finish];
  const dark = '#2a2a2a';
  const wood = '#a8754a';
  const midY = h / 2 + 0.03;
  const barrelY = midY + h * 0.2;
  const parts: string[] = [];
  // Stock.
  if (look.stock === 'wood' || look.stock === 'solid') {
    parts.push(`<path d="M${X(back)} ${Y(midY + h * 0.45)} L${X(minZ)} ${Y(midY + h * 0.2)} L${X(minZ)} ${Y(midY - h * 0.95)} L${X(back)} ${Y(midY - h * 0.45)} Z" fill="${look.stock === 'wood' ? wood : dark}"/>`);
  } else if (look.stock === 'skeleton') {
    parts.push(rect(minZ, midY + h * 0.15, back, midY + h * 0.3, metal), rect(minZ, midY - h * 0.5, back, midY - h * 0.35, metal), rect(minZ, midY - h * 0.7, minZ + 0.02, midY + h * 0.4, dark));
  } else if (look.stock === 'pipe') {
    parts.push(rect(minZ, midY - 0.025, back, midY + 0.015, wood));
  }
  // Magazine and grip.
  const magZ = look.pistol ? 0 : back + len * 0.55;
  if (look.mag === 'box') parts.push(rect(magZ - 0.025, -0.11, magZ + 0.025, midY, dark));
  if (look.mag === 'curved') parts.push(`<path d="M${X(magZ - 0.025)} ${Y(midY)} L${X(magZ + 0.025)} ${Y(midY)} Q${X(magZ + 0.05)} ${Y(-0.05)} ${X(magZ + 0.08)} ${Y(-0.13)} L${X(magZ + 0.03)} ${Y(-0.15)} Q${X(magZ)} ${Y(-0.05)} ${X(magZ - 0.025)} ${Y(midY)} Z" fill="${dark}"/>`);
  if (look.mag === 'drum') parts.push(`<circle cx="${X(magZ)}" cy="${Y(-0.07)}" r="${(0.08 * ky).toFixed(1)}" fill="${dark}"/>`);
  if (look.mag === 'belt') parts.push(rect(magZ - 0.07, midY - 0.11, magZ + 0.07, midY + 0.01, '#4a4b3a'));
  parts.push(`<path d="M${X(-0.02)} ${Y(midY - h / 2)} L${X(0.02)} ${Y(midY - h / 2)} L${X(0.0)} ${Y(-0.08)} L${X(-0.05)} ${Y(-0.075)} Z" fill="${look.pistol && look.finish === 'steel' ? wood : dark}"/>`);
  // Receiver, barrel and furniture.
  parts.push(rect(back, midY - h / 2, front, midY + h / 2, metal));
  const bores = look.double ? 2 : 1;
  parts.push(rect(front, barrelY - look.bore * bores, maxZ, barrelY + look.bore * bores, metal));
  if (look.shroud) parts.push(rect(front, barrelY - look.bore * 2.3, front + look.barrel * 0.7, barrelY + look.bore * 2.3, dark));
  if (look.wood) parts.push(rect(front, midY - h * 0.42, front + look.barrel * 0.55, midY + h * 0.12, wood));
  if (look.pump) parts.push(rect(front + look.barrel * 0.2, barrelY - look.bore * 4.3, front + look.barrel * 0.45, barrelY - look.bore * 0.7, wood));
  if (look.mag === 'tube') parts.push(rect(front, barrelY - look.bore * 3.1, front + look.barrel * 0.85, barrelY - look.bore * 1.3, metal));
  if (look.mag === 'cylinder') parts.push(rect(front - 0.055, barrelY - 0.04, front - 0.005, barrelY + 0.016, metal));
  if (look.scope) parts.push(rect(back + len * 0.5 - 0.13, h + 0.05, back + len * 0.5 + 0.13, h + 0.09, dark), rect(back + len * 0.5 - 0.07, h, back + len * 0.5 - 0.05, h + 0.05, dark));
  if (look.bipod) parts.push(`<path d="M${X(front + look.barrel * 0.7)} ${Y(barrelY)} l-3 7 M${X(front + look.barrel * 0.7)} ${Y(barrelY)} l2 7" stroke="${dark}" stroke-width="1.4"/>`);
  return look.pistol ? parts.join('') : `<g transform="rotate(-32 20 20)">${parts.join('')}</g>`;
}
