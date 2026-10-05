// Armour models: burlap clothes, road sign plates and welded steel. Each piece is a few
// meshes placed in the survivor's modelled pose (feet at 0, facing +z) and hung on the bone
// they move with, so the same parts dress a survivor and make the inventory icon.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { ItemId } from '../../shared/items.ts';
import { ARM_REST, type BoneName } from './survivorMesh.ts';
import { clothSurface, leatherSurface, rustSurface } from './textures.ts';

export interface ArmourPart {
  bone: BoneName;
  /** Positioned in the survivor's modelled pose. */
  mesh: THREE.Mesh;
}

/** Parts of the survivor's own gear that a piece covers up, so they don't poke through. */
export type HiddenGear = 'hood' | 'face';
export const ARMOUR_HIDES: Partial<Record<ItemId, HiddenGear[]>> = {
  burlapHeadwrap: ['hood'],
  coffeeCanHelmet: [],
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
const rope = () => mat('rope', () => new THREE.MeshStandardMaterial({ color: 0x8a7550, roughness: 0.95 }));
const strap = () =>
  mat('armour-strap', () => {
    const s = leatherSurface();
    return new THREE.MeshStandardMaterial({ color: 0x4e3b2a, map: s.map, normalMap: s.normalMap, roughness: 0.75 });
  });
const steel = () =>
  mat('armour-steel', () => {
    const s = rustSurface('#62625e');
    return new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normalMap, roughness: 0.55, metalness: 0.75, side: THREE.DoubleSide });
  });
const darkSteel = () => mat('armour-dark-steel', () => new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.6, metalness: 0.5 }));
const rivet = () => mat('armour-rivet', () => new THREE.MeshStandardMaterial({ color: 0x8c877c, roughness: 0.35, metalness: 0.9 }));
const can = () =>
  mat('coffee-can', () => {
    const s = rustSurface('#4f5d4a');
    return new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normalMap, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide });
  });
const sign = (kind: 'chevron' | 'stop' | 'warning') => mat(`roadsign-${kind}`, () => roadSignMaterial(kind));

/** A battered road sign: reflective paint with its markings, scratched through to bare, rusting metal. */
function roadSignMaterial(kind: 'chevron' | 'stop' | 'warning'): THREE.Material {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const base = kind === 'stop' ? '#9e2a22' : kind === 'warning' ? '#d1a52a' : '#c99a24';
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 128, 128);
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
  // Scratches and chips down to bare metal, and rust bleeding from the edges.
  let seed = kind.length * 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(150,150,145,0.55)' : 'rgba(110,60,30,0.45)';
    ctx.lineWidth = 0.5 + rand() * 1.5;
    const x = rand() * 128;
    const y = rand() * 128;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rand() - 0.5) * 30, y + (rand() - 0.5) * 12);
    ctx.stroke();
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(${110 + rand() * 40},${50 + rand() * 25},${20 + rand() * 15},${0.25 + rand() * 0.4})`;
    const edge = rand() < 0.5;
    ctx.beginPath();
    ctx.arc(edge ? (rand() < 0.5 ? 0 : 128) : rand() * 128, edge ? rand() * 128 : rand() < 0.5 ? 0 : 128, 3 + rand() * 9, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide });
}

/** A curved plate: a slice of a cylinder around the y axis, facing +z, `arc` radians wide. */
function curvedPlate(radius: number, height: number, arc: number, taper = 1): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(radius * taper, radius, height, 16, 1, true, -arc / 2, arc);
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
      add('torso', new THREE.CylinderGeometry(0.188, 0.172, 0.46, 20, 1, true), burlap(), 0, 1.2, 0.005).scale.set(1, 1, 0.74);
      add('torso', new THREE.TorusGeometry(0.15, 0.014, 6, 24), rope(), 0, 1.0, 0.005, Math.PI / 2).scale.set(1.12, 0.85, 1);
      for (const [side, s] of sides) {
        const sleeve = add(`shoulder${s}`, new THREE.CylinderGeometry(0.075, 0.07, 0.17, 14, 1, true), burlap(), 0, 0, 0, 0, 0, side * ARM_REST);
        const dir = new THREE.Vector3(side * Math.sin(ARM_REST), -Math.cos(ARM_REST), 0);
        sleeve.position.set(side * 0.19, 1.4, 0).addScaledVector(dir, 0.09);
      }
      break;
    }
    case 'burlapTrousers': {
      for (const [side, s] of sides) {
        add(`hip${s}`, new THREE.CylinderGeometry(0.097, 0.073, 0.42, 14, 1, true), burlap(), side * 0.092, 0.71, 0);
        add(`knee${s}`, new THREE.CylinderGeometry(0.072, 0.064, 0.26, 14, 1, true), burlap(), side * 0.092, 0.38, 0.003);
        // A sewn-on patch over each knee.
        add(`knee${s}`, new RoundedBoxGeometry(0.08, 0.09, 0.02, 2, 0.008), burlapDark(), side * 0.092, 0.49, 0.07);
      }
      add('pelvis', new THREE.TorusGeometry(0.15, 0.013, 6, 24), rope(), 0, 0.97, 0, Math.PI / 2).scale.set(1.1, 0.8, 1);
      break;
    }
    case 'coffeeCanHelmet': {
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
      add('torso', curvedPlate(0.2, 0.25, 1.5), sign('chevron'), 0, 1.3, -0.012).scale.set(1, 1, 0.73);
      add('torso', curvedPlate(0.18, 0.15, 1.3), sign('warning'), 0, 1.1, -0.01, 0.06).scale.set(1, 1, 0.74);
      rivets('torso', [
        [-0.12, 1.4, 0.115],
        [0.12, 1.4, 0.115],
        [-0.12, 1.2, 0.12],
        [0.12, 1.2, 0.12],
      ]);
      for (const [side] of sides) {
        add('torso', new RoundedBoxGeometry(0.16, 0.02, 0.2, 2, 0.008), sign('stop'), side * 0.17, 1.47, -0.01, 0, 0, side * -0.38);
      }
      for (const x of [-0.1, 0.1]) add('torso', new THREE.BoxGeometry(0.035, 0.02, 0.3), strap(), x, 1.46, -0.01);
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
      add('torso', curvedPlate(0.205, 0.4, 1.9, 1.05), steel(), 0, 1.23, -0.01).scale.set(1, 1, 0.78);
      // A ridge down the middle and shoulder guards.
      add('torso', new THREE.BoxGeometry(0.025, 0.36, 0.02), steel(), 0, 1.24, 0.15);
      for (const [side] of sides) {
        add('torso', curvedPlate(0.09, 0.14, 2.6), steel(), side * 0.21, 1.43, -0.01, 0, side * (Math.PI / 2), side * -0.5);
      }
      for (const x of [-0.11, 0.11]) add('torso', new THREE.BoxGeometry(0.035, 0.02, 0.3), strap(), x, 1.45, -0.01);
      rivets('torso', [
        [-0.13, 1.4, 0.12],
        [0.13, 1.4, 0.12],
        [-0.13, 1.07, 0.11],
        [0.13, 1.07, 0.11],
      ]);
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
