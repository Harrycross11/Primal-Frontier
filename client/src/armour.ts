// Armour models: burlap clothes, road sign plates and welded steel. Each piece is a few
// meshes placed in the survivor's modelled pose (feet at 0, facing +z) and hung on the bone
// they move with, so the same parts dress a survivor and make the inventory icon.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ItemId } from '../../shared/items.ts';
import { ARM_REST, type BoneName } from './survivorMesh.ts';
import { clothSurface, leatherSurface, metalSurface, paintedRustSurface, rustSurface } from './textures.ts';
import { HEAD, scannedWear } from './survivorLook.ts';

export interface ArmourPart {
  bone: BoneName;
  /** Positioned in the survivor's modelled pose. */
  mesh: THREE.Mesh;
}

/** Parts of the survivor's own gear that a piece covers up, so they don't poke through. */
export type HiddenGear = 'hood' | 'face';
export const ARMOUR_HIDES: Partial<Record<ItemId, HiddenGear[]>> = {
  burlapHeadwrap: ['hood'],
  coffeeCanHelmet: ['hood'],
  metalFacemask: ['face'],
};

const cache = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = cache.get(key);
  if (!m) cache.set(key, (m = make()));
  return m;
}

const burlap = () =>
  mat('burlap', () => {
    const s = clothSurface();
    const m = new THREE.MeshStandardMaterial({ color: 0xa08c62, map: s.map, normalMap: s.normalMap, roughness: 1, side: THREE.DoubleSide });
    m.normalScale.set(1.2, 1.2);
    return m;
  });
const burlapDark = () =>
  mat('burlap-dark', () => {
    const s = clothSurface();
    return new THREE.MeshStandardMaterial({ color: 0x6f5f40, map: s.map, normalMap: s.normalMap, roughness: 1 });
  });
const rope = () => mat('rope', () => new THREE.MeshStandardMaterial({ ...clothSurface(), color: 0xb09868, roughness: 1 }));
const strap = () =>
  mat('armour-strap', () => {
    const s = leatherSurface();
    return new THREE.MeshStandardMaterial({ color: 0x4e3b2a, map: s.map, normalMap: s.normalMap, roughness: 0.75 });
  });
const steel = () => mat('armour-steel', steelMaterial);
const darkSteel = () => mat('armour-dark-steel', () => new THREE.MeshStandardMaterial({ ...metalSurface(), color: 0x2a2928, metalness: 0.5 }));
const rivet = () => mat('armour-rivet', () => new THREE.MeshStandardMaterial({ ...metalSurface(), color: 0xa09a90, metalness: 0.9 }));
const can = () =>
  mat('coffee-can', () => {
    const s = rustSurface('#4f5d4a');
    return new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normalMap, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide });
  });
const sign = (kind: 'chevron' | 'stop' | 'warning') => mat(`roadsign-${kind}`, () => roadSignMaterial(kind));

/** A battered road sign: its paint and markings over a photo of rusted metal, worn through in places. */
function roadSignMaterial(kind: 'chevron' | 'stop' | 'warning'): THREE.Material {
  const base = kind === 'stop' ? '#9e2a22' : kind === 'warning' ? '#d1a52a' : '#c99a24';
  const s = paintedRustSurface(`roadsign-${kind}`, base, (ctx) => {
    ctx.fillStyle = kind === 'stop' ? '#e6dccb' : '#1d1b18';
    if (kind === 'chevron') {
      for (let x = -64; x < 160; x += 44) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + 22, 0);
        ctx.lineTo(x + 48, 64);
        ctx.lineTo(x + 22, 128);
        ctx.lineTo(x, 128);
        ctx.lineTo(x + 26, 64);
        ctx.fill();
      }
    } else if (kind === 'stop') {
      ctx.font = '900 40px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('STOP', 64, 78);
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#e6dccb';
      ctx.strokeRect(6, 6, 116, 116);
    } else {
      ctx.lineWidth = 9;
      ctx.strokeStyle = '#1d1b18';
      ctx.beginPath();
      ctx.moveTo(64, 14);
      ctx.lineTo(116, 108);
      ctx.lineTo(12, 108);
      ctx.closePath();
      ctx.stroke();
      ctx.fillRect(59, 44, 10, 38);
      ctx.fillRect(59, 88, 10, 10);
    }
  });
  return new THREE.MeshStandardMaterial({ ...s, metalness: 0.35, side: THREE.DoubleSide });
}

/** Welded steel plate: a photo of worn plate, darkened. */
function steelMaterial(): THREE.Material {
  return new THREE.MeshStandardMaterial({ ...metalSurface(), color: 0xa4a6a8, metalness: 0.45, side: THREE.DoubleSide });
}

/** A curved plate: a slice of a cylinder around the y axis, facing +z, `arc` radians wide. */
function curvedPlate(radius: number, height: number, arc: number, taper = 1): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(radius * taper, radius, height, 16, 1, true, -arc / 2, arc);
}

/**
 * The scanned survivor's trunk, measured at each height in the avatar's own space (Avatar.bodyBands):
 * [height, half width, front, back]. Clothes and plates over the chest are shaped to it.
 */
const TRUNK: [number, number, number, number][] = [
  [0.95, 0.166, 0.114, -0.144],
  [1.0, 0.188, 0.137, -0.164],
  [1.1, 0.182, 0.132, -0.159],
  [1.2, 0.183, 0.122, -0.165],
  [1.3, 0.185, 0.108, -0.177],
  [1.4, 0.189, 0.079, -0.171],
  [1.45, 0.205, 0.068, -0.171],
  [1.5, 0.2, 0.044, -0.149],
  [1.55, 0.13, 0, -0.127],
];

/** The trunk's half width, front and back at a height, between the measured ones. */
function trunkAt(y: number): [number, number, number] {
  const i = THREE.MathUtils.clamp(TRUNK.findIndex((t) => t[0] >= y), 1, TRUNK.length - 1);
  const [y0, ...a] = TRUNK[i - 1];
  const [y1, ...b] = TRUNK[i];
  const t = THREE.MathUtils.clamp((y - y0) / (y1 - y0), 0, 1);
  return [0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * t) as [number, number, number];
}

/** How far forward a trunk shell `off` metres clear of the body is, `x` to the side at height `y`. */
function shellFront(x: number, y: number, off: number): number {
  const [w, front, back] = trunkAt(y);
  const a = Math.asin(THREE.MathUtils.clamp(x / (w + off), -1, 1));
  return (front + back) / 2 + Math.cos(a) * ((front - back) / 2 + off);
}

/**
 * A shell over the trunk from height `y0` to `y1`, standing `off` metres clear of it, round
 * `arc` radians centred on the chest (2π for all the way round). Placed in avatar space, with
 * the same UVs as a cylinder's so printed signs read the right way.
 */
function trunkShell(y0: number, y1: number, arc: number, off: number, rows = 8): THREE.BufferGeometry {
  const cols = Math.max(8, Math.round(arc * 5));
  const position: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const y = y1 - ((y1 - y0) * r) / rows;
    const [w, front, back] = trunkAt(y);
    const mid = (front + back) / 2;
    const depth = (front - back) / 2;
    for (let c = 0; c <= cols; c++) {
      const a = -arc / 2 + (arc * c) / cols;
      position.push(Math.sin(a) * (w + off), y, mid + Math.cos(a) * (depth + off));
      uv.push(c / cols, 1 - r / rows);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * (cols + 1) + c;
      const b = a + cols + 1;
      index.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** The pieces of one armour item, or an empty list for anything else. */
export function armourParts(item: ItemId): ArmourPart[] {
  const parts: ArmourPart[] = [];
  const add = (bone: BoneName, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = true;
    parts.push({ bone, mesh });
    return mesh;
  };
  const rivets = (bone: BoneName, points: [number, number, number][]) => {
    for (const [x, y, z] of points) add(bone, new THREE.SphereGeometry(0.009, 8, 6), rivet(), x, y, z);
  };
  const sides = [
    [-1, 'L'],
    [1, 'R'],
  ] as const;

  switch (item) {
    case 'burlapHeadwrap': {
      // Sacking pulled over the head with the face left open, tied with twine.
      const wrap = add('head', new THREE.SphereGeometry(0.128, 22, 16, Math.PI / 2 + 0.8, Math.PI * 2 - 1.6, 0, Math.PI * 0.8), burlap(), 0, 1.71, -0.01);
      wrap.scale.set(1.08, 1.08, 1.12);
      add('head', new THREE.TorusGeometry(0.118, 0.012, 6, 24), rope(), 0, 1.76, -0.005, Math.PI / 2 + 0.12);
      // The loose tail of the wrap hanging down the back.
      add('head', new THREE.BoxGeometry(0.07, 0.16, 0.012), burlapDark(), 0.03, 1.62, -0.13, 0.25, 0, 0.1);
      break;
    }
    case 'burlapShirt': {
      // Sacking hung over the jacket from the shoulders to the belt, tied round the waist; the
      // jacket's own sleeves show through the arm holes.
      add('torso', trunkShell(0.96, 1.52, Math.PI * 2, 0.012, 12), burlap(), 0, 0, 0);
      add('torso', new THREE.TorusGeometry(0.15, 0.014, 6, 24), rope(), 0, 1.0, -0.013, Math.PI / 2).scale.set(1.33, 1.03, 1);
      break;
    }
    case 'burlapTrousers': {
      for (const [side, s] of sides) {
        // Deeper than wide, like a thigh, and full at the top to cover the seat of the trousers under it.
        add(`hip${s}`, new THREE.CylinderGeometry(0.112, 0.076, 0.42, 14, 1, true), burlap(), side * 0.092, 0.71, 0).scale.z = 1.15;
        add(`knee${s}`, new THREE.CylinderGeometry(0.084, 0.066, 0.26, 14, 1, true), burlap(), side * 0.092, 0.38, -0.012).scale.z = 1.25;
        // A sewn-on patch over each knee.
        add(`knee${s}`, new RoundedBoxGeometry(0.08, 0.09, 0.02, 2, 0.008), burlapDark(), side * 0.092, 0.49, 0.088);
      }
      // The seat, joining the legs at the crotch.
      add('pelvis', new THREE.BoxGeometry(0.15, 0.16, 0.24), burlap(), 0, 0.87, 0);
      add('pelvis', new THREE.TorusGeometry(0.15, 0.013, 6, 24), rope(), 0, 0.97, 0, Math.PI / 2).scale.set(1.1, 0.8, 1);
      break;
    }
    case 'coffeeCanHelmet': {
      // A scanned rusty can turned over the scanned head, with a strap under the chin.
      const scan = scannedWear('wear-can', [0, HEAD.y + 0.025, HEAD.z - 0.01], -0.08);
      if (scan) {
        scan.scale.y = 0.45;
        scan.userData.scanHead = true;
        parts.push({ bone: 'head', mesh: scan });
        add('head', new THREE.TorusGeometry(0.08, 0.006, 6, 20, Math.PI), strap(), 0, HEAD.y - 0.02, HEAD.z + 0.01, 0, 0, Math.PI).userData.scanHead = true;
        break;
      }
      add('head', new THREE.CylinderGeometry(0.148, 0.152, 0.16, 22, 1, false), can(), 0, 1.79, -0.01, -0.08);
      // Rolled rims and a strap under the chin.
      add('head', new THREE.TorusGeometry(0.152, 0.008, 6, 26), rivet(), 0, 1.712, -0.004, Math.PI / 2 - 0.08);
      add('head', new THREE.TorusGeometry(0.148, 0.006, 6, 26), rivet(), 0, 1.87, -0.017, Math.PI / 2 - 0.08);
      add('head', new THREE.TorusGeometry(0.105, 0.009, 6, 20, Math.PI), strap(), 0, 1.7, 0.02, 0, 0, Math.PI);
      rivets('head', [
        [-0.1, 1.79, 0.1],
        [0.1, 1.79, 0.1],
      ]);
      break;
    }
    case 'roadsignJacket': {
      // A sign on the chest, a smaller one on the belly, and bent plates on the shoulders.
      add('torso', trunkShell(1.18, 1.43, 1.5, 0.02), sign('chevron'), 0, 0, 0);
      add('torso', trunkShell(1.03, 1.17, 1.3, 0.02), sign('warning'), 0, 0, 0);
      rivets('torso', [-0.12, 0.12].flatMap((x) => [1.4, 1.21].map((y) => [x, y, shellFront(x, y, 0.024)] as [number, number, number])));
      // Bent down over each shoulder, following its slope.
      for (const [side] of sides) {
        add('torso', new RoundedBoxGeometry(0.15, 0.018, 0.2, 2, 0.008), sign('stop'), side * 0.16, 1.5, -0.05, 0, 0, side * -0.5);
      }
      for (const x of [-0.1, 0.1]) add('torso', new THREE.BoxGeometry(0.035, 0.02, 0.24), strap(), x, 1.52, -0.05);
      break;
    }
    case 'roadsignKilt': {
      add('pelvis', new THREE.TorusGeometry(0.16, 0.018, 6, 24), strap(), 0, 0.97, 0, Math.PI / 2).scale.set(1.12, 0.82, 1);
      // Overlapping plates hung round the hips, open at the back for the backpack's straps.
      const plates = 7;
      for (let n = 0; n < plates; n++) {
        const a = -2.1 + (4.2 * n) / (plates - 1);
        const m = add('pelvis', new RoundedBoxGeometry(0.13, 0.22, 0.012, 2, 0.005), sign(n % 3 === 1 ? 'stop' : 'warning'), 0, 0, 0);
        m.position.set(Math.sin(a) * 0.19, 0.85, Math.cos(a) * 0.15);
        m.rotation.set(0.12 * Math.cos(a), a, -0.12 * Math.sin(a), 'YXZ');
      }
      break;
    }
    case 'metalFacemask': {
      // A scanned welder's mask: a steel shell over the face with a dark window to see through.
      const scan = scannedWear('wear-welder', [0, 1.54, HEAD.z + 0.02]);
      if (scan) {
        parts.push({ bone: 'head', mesh: scan });
        break;
      }
      // A welded plate over the face, with an eye slit and breathing holes.
      const plate = add('head', curvedPlate(0.125, 0.22, 2.1), steel(), 0, 1.69, 0.0);
      plate.scale.set(1, 1, 1.05);
      add('head', new THREE.BoxGeometry(0.15, 0.022, 0.03), darkSteel(), 0, 1.72, 0.128);
      for (const x of [-0.03, 0, 0.03]) for (const y of [1.625, 1.6]) add('head', new THREE.CylinderGeometry(0.008, 0.008, 0.03, 8), darkSteel(), x, y, 0.126, Math.PI / 2);
      add('head', new THREE.BoxGeometry(0.02, 0.2, 0.012), steel(), 0, 1.69, 0.134);
      rivets('head', [
        [-0.09, 1.77, 0.095],
        [0.09, 1.77, 0.095],
        [-0.09, 1.6, 0.095],
        [0.09, 1.6, 0.095],
      ]);
      add('head', new THREE.TorusGeometry(0.118, 0.01, 6, 24), strap(), 0, 1.71, -0.005, Math.PI / 2);
      break;
    }
    case 'metalChestplate': {
      add('torso', trunkShell(1.03, 1.43, 1.9, 0.02), steel(), 0, 0, 0);
      // A ridge down the middle and shoulder guards.
      add('torso', new THREE.BoxGeometry(0.025, 0.36, 0.02), steel(), 0, 1.24, shellFront(0, 1.24, 0.03), -0.12);
      for (const [side] of sides) {
        add('torso', curvedPlate(0.08, 0.12, 2.4), steel(), side * 0.2, 1.44, -0.05, 0, side * (Math.PI / 2), side * -0.5);
      }
      for (const x of [-0.11, 0.11]) add('torso', new THREE.BoxGeometry(0.035, 0.02, 0.24), strap(), x, 1.5, -0.05);
      rivets('torso', [-0.13, 0.13].flatMap((x) => [1.4, 1.07].map((y) => [x, y, shellFront(x, y, 0.024)] as [number, number, number])));
      break;
    }
    case 'metalLegPlates': {
      for (const [side, s] of sides) {
        add(`hip${s}`, curvedPlate(0.1, 0.3, 2.2, 0.85), steel(), side * 0.092, 0.72, 0.004);
        add(`knee${s}`, new THREE.SphereGeometry(0.065, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), steel(), side * 0.092, 0.5, 0.035, Math.PI / 2);
        add(`knee${s}`, curvedPlate(0.074, 0.22, 2.2, 1.12), steel(), side * 0.092, 0.35, 0.006);
        for (const y of [0.64, 0.8]) add(`hip${s}`, new THREE.TorusGeometry(0.09, 0.008, 6, 18), strap(), side * 0.092, y, 0, Math.PI / 2);
        add(`knee${s}`, new THREE.TorusGeometry(0.068, 0.008, 6, 18), strap(), side * 0.092, 0.33, 0, Math.PI / 2);
      }
      break;
    }
  }
  return parts;
}

/** All of a piece's parts together in one group, as worn: for the inventory icon. */
export function buildArmourModel(item: ItemId): THREE.Group | null {
  const parts = armourParts(item);
  if (!parts.length) return null;
  const g = new THREE.Group();
  for (const p of parts) g.add(p.mesh);
  return g;
}
