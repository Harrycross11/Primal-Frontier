// Bows, guns and melee weapons. Each gun is described by a few proportions (receiver,
// barrel, stock, magazine, sights, finish) and both its 3D model and its inventory icon are
// built from that description, so the two always match.
//
// Model space: the grip is at the origin, the barrel points along +z, up is +y. Metres.

import * as THREE from 'three';
import type { ItemId } from '../../shared/items.ts';
import { metalSurface, plankSurface, rustSurface } from './textures.ts';

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
      : new THREE.MeshStandardMaterial({ ...metalSurface(), color: FINISH_COLORS[f], roughness: f === 'black' ? 0.55 : 0.4, metalness: 0.75 }),
  );
const woodMat = () => mat('gun-wood', () => new THREE.MeshStandardMaterial({ ...plankSurface(), color: 0xa0704a, roughness: 0.7 }));
const darkMat = () => mat('gun-dark', () => new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.7, metalness: 0.3 }));
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

const box = (w: number, h: number, l: number) => new THREE.BoxGeometry(w, h, l);
/** A cylinder lying along z. */
const tube = (r: number, len: number, seg = 10) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);

/** Where the front of the receiver is, for muzzle flashes: the barrel tip in model space. */
export function muzzleOffset(item: ItemId): THREE.Vector3 {
  const look = GUN_LOOKS[item];
  if (!look) return new THREE.Vector3(0, 0.05, 0.6);
  const [len, h] = look.body;
  const front = look.pistol ? len * 0.75 : len * 0.55;
  return new THREE.Vector3(0, h * 0.75, front + look.barrel);
}

export function buildGun(item: ItemId): THREE.Group | null {
  const look = GUN_LOOKS[item];
  if (!look) return null;
  const g = new THREE.Group();
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
  // Front sight.
  part(g, box(0.006, 0.02, 0.01), metal, 0, barrelY + look.bore + 0.008, front + look.barrel - 0.02);

  // Stock.
  const stockZ = back - look.stockLength / 2;
  if (look.stock === 'wood') {
    part(g, box(w * 0.9, h * 1.2, look.stockLength), woodMat(), 0, midY - h * 0.25, stockZ, 0.12);
  } else if (look.stock === 'solid') {
    part(g, box(w * 0.9, h * 1.1, look.stockLength), darkMat(), 0, midY - h * 0.2, stockZ, 0.08);
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
    for (let s = 0; s < 3; s++) part(g, box(w * 0.7, 0.07, 0.05), darkMat(), 0, -0.01 - s * 0.055, magZ + s * 0.02, 0.18 + s * 0.12);
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
        limb.rotation.set(0, Math.PI / 2, Math.PI / 2 - 0.95);
        part(g, box(0.025, 0.12, 0.03), clothMat(), 0, 0.02, 0.08);
      }
      const string = new THREE.BufferGeometry().setFromPoints(
        cross
          ? [new THREE.Vector3(-limbR * 0.72, 0.02, 0.32), new THREE.Vector3(0, 0.02, 0.05), new THREE.Vector3(limbR * 0.72, 0.02, 0.32)]
          : [new THREE.Vector3(0, limbR * 0.81 + 0.02, -0.05), new THREE.Vector3(0, 0.02, -0.12), new THREE.Vector3(0, -limbR * 0.81 + 0.02, -0.05)],
      );
      g.add(new THREE.Line(string, new THREE.LineBasicMaterial({ color: 0xd8d0bc })));
      return g;
    }
    case 'woodenSpear':
    case 'stoneSpear':
      part(g, tube(0.016, 1.8, 6), wood, 0, 0, 0.35);
      if (item === 'stoneSpear') part(g, new THREE.ConeGeometry(0.035, 0.16, 5).rotateX(Math.PI / 2), stoneMat(), 0, 0, 1.3);
      else part(g, new THREE.ConeGeometry(0.018, 0.12, 6).rotateX(Math.PI / 2), wood, 0, 0, 1.31);
      return g;
    case 'machete':
      part(g, box(0.03, 0.035, 0.12), darkMat(), 0, 0, 0);
      part(g, box(0.006, 0.05, 0.45), finishMat('steel'), 0, 0.01, 0.28);
      return g;
    case 'salvagedSword':
      part(g, box(0.03, 0.035, 0.14), clothMat(), 0, 0, 0);
      part(g, box(0.1, 0.03, 0.02), finishMat('scrap'), 0, 0, 0.08);
      part(g, box(0.008, 0.07, 0.65), finishMat('rust'), 0, 0.005, 0.42);
      return g;
    case 'bandage':
      part(g, new THREE.CylinderGeometry(0.035, 0.035, 0.06, 12), clothMat(), 0, 0, 0.03);
      return g;
    case 'syringe':
      part(g, tube(0.012, 0.12), glassMat(), 0, 0.02, 0.05);
      part(g, tube(0.002, 0.05), finishMat('steel'), 0, 0.02, 0.14);
      return g;
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
