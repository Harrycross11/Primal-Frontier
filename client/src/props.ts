// Models for the crafting update: stone and metal ore boulders, hemp plants, and the things
// players set down (workbench, furnace, storage box), plus tools held in the hand.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { DEPLOYABLE_INFO, type DeployableKind } from '../../shared/deployables.ts';
import type { ItemId } from '../../shared/items.ts';
import { buildGun, buildOtherWeapon, muzzleOffset } from './guns.ts';
import { concreteSurface, metalSurface, plankSurface, rustSurface } from './textures.ts';

const cache = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = cache.get(key);
  if (!m) cache.set(key, (m = make()));
  return m;
}
const stoneMat = () => mat('stone', () => new THREE.MeshStandardMaterial({ ...concreteSurface(), color: 0xa49d92, roughness: 1, flatShading: true }));
const plankMat = () => mat('planks', () => new THREE.MeshStandardMaterial({ ...plankSurface(), roughness: 0.85 }));
const metalMat = () => mat('metal', () => new THREE.MeshStandardMaterial({ ...metalSurface(), roughness: 0.5, metalness: 0.7 }));
const rustMat = () => mat('rust', () => new THREE.MeshStandardMaterial({ ...rustSurface('#6a6a64'), roughness: 0.6, metalness: 0.6 }));
const plain = (color: number, roughness = 0.9, metalness = 0) =>
  mat(`plain-${color}-${roughness}-${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const out = new THREE.Mesh(geo, m);
  out.position.set(x, y, z);
  out.castShadow = true;
  out.receiveShadow = true;
  return out;
}

export type BoulderKind = 'stone' | 'metalOre' | 'sulfurOre' | 'hqmOre';
const BOULDER_COLORS: Record<BoulderKind, [number, number]> = {
  stone: [0xa8a196, 0xa8a196],
  metalOre: [0x7a736b, 0xc4823a],
  sulfurOre: [0x8a8478, 0xe0c640],
  hqmOre: [0x5e646c, 0xa9c2d8],
};

/** A lumpy boulder. Ore boulders get veins: rusty for metal, yellow for sulfur, blue-grey for high quality metal. */
export function buildBoulder(rand: () => number, kind: BoulderKind): THREE.Group {
  const ore = kind !== 'stone';
  const g = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const base = new THREE.Color(BOULDER_COLORS[kind][0]);
  const vein = new THREE.Color(BOULDER_COLORS[kind][1]);
  const c = new THREE.Color();
  const bumps = [...Array(6)].map(() => new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize());
  const veins = [...Array(5)].map(() => new THREE.Vector3(rand() - 0.5, rand() * 0.6, rand() - 0.5).normalize());
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    let k = 0.85;
    for (const b of bumps) k += Math.max(0, v.dot(b) - 0.6) * 0.5;
    k += (rand() - 0.5) * 0.08;
    p.setXYZ(i, v.x * k * 1.1, v.y * k * 0.75, v.z * k);
    c.copy(base).multiplyScalar(0.85 + rand() * 0.25);
    if (ore) for (const w of veins) if (v.dot(w) > (kind === 'sulfurOre' ? 0.8 : 0.86)) c.lerp(vein, 0.85);
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const rockMat = mat(`boulder-${kind}`, () =>
    new THREE.MeshStandardMaterial({ ...concreteSurface(), vertexColors: true, roughness: ore ? 0.75 : 1, metalness: kind === 'metalOre' || kind === 'hqmOre' ? 0.25 : 0, flatShading: true }),
  );
  const body = mesh(geo, rockMat, 0, 0.45, 0);
  g.add(body);
  // A couple of smaller stones around the base.
  for (let n = 0; n < 3; n++) {
    const small = mesh(new THREE.DodecahedronGeometry(0.22 + rand() * 0.15, 0), ore ? rockMat : stoneMat());
    const a = rand() * Math.PI * 2;
    small.position.set(Math.cos(a) * 1.1, 0.08, Math.sin(a) * 1.0);
    small.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    g.add(small);
  }
  return g;
}

/** A clump of tall hemp stalks with narrow leaves. */
export function buildHemp(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const stalkMat = plain(0x6d7a3a);
  const leafMat = mat('hemp-leaf', () => new THREE.MeshStandardMaterial({ color: 0x7f8f3a, roughness: 0.85, side: THREE.DoubleSide }));
  for (let s = 0; s < 5; s++) {
    const h = 0.9 + rand() * 0.6;
    const stalk = mesh(new THREE.CylinderGeometry(0.012, 0.02, h, 5).translate(0, h / 2, 0), stalkMat);
    stalk.position.set((rand() - 0.5) * 0.35, 0, (rand() - 0.5) * 0.35);
    stalk.rotation.set((rand() - 0.5) * 0.25, 0, (rand() - 0.5) * 0.25);
    g.add(stalk);
    for (let l = 0; l < 6; l++) {
      const leaf = mesh(new THREE.PlaneGeometry(0.05, 0.28).translate(0, 0.14, 0), leafMat);
      leaf.position.y = h * (0.35 + l * 0.11);
      leaf.rotation.set(0.9 + rand() * 0.4, (l / 6) * Math.PI * 2 + rand(), 0, 'YXZ');
      stalk.add(leaf);
    }
  }
  return g;
}

/** The object for a deployable, sitting on y = 0, facing +z. Furnaces get a fire that can be lit. */
export function buildDeployable(kind: DeployableKind): THREE.Group {
  const g = new THREE.Group();
  const [w, h, l] = DEPLOYABLE_INFO[kind].size;
  if (kind === 'workbench' || kind === 'workbench2' || kind === 'workbench3') {
    const level = kind === 'workbench' ? 1 : kind === 'workbench2' ? 2 : 3;
    const topMat = level === 1 ? plankMat() : level === 2 ? rustMat() : metalMat();
    const legMat = level === 1 ? plankMat() : metalMat();
    const top = mesh(new RoundedBoxGeometry(w, 0.09, l, 2, 0.02), topMat, 0, h - 0.045, 0);
    g.add(top);
    for (const [x, z] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      g.add(mesh(new THREE.BoxGeometry(0.09, h - 0.09, 0.09), legMat, x * (w / 2 - 0.08), (h - 0.09) / 2, z * (l / 2 - 0.08)));
    }
    g.add(mesh(new THREE.BoxGeometry(w - 0.2, 0.05, l - 0.2), level === 1 ? plankMat() : rustMat(), 0, 0.3, 0));
    if (level >= 2) {
      // A pegboard of tools at the back, and a drill press.
      const board = mesh(new THREE.BoxGeometry(w - 0.1, 0.6, 0.04), level === 3 ? metalMat() : plankMat(), 0, h + 0.3, -l / 2 + 0.04);
      g.add(board);
      for (let n = 0; n < 4; n++) g.add(mesh(new THREE.BoxGeometry(0.03, 0.22, 0.03), metalMat(), -0.5 + n * 0.3, h + 0.35, -l / 2 + 0.08));
      g.add(mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 10), plain(0x8a3a2a, 0.6, 0.4), -w / 2 + 0.25, h + 0.25, -0.05));
    }
    if (level === 3) {
      g.add(mesh(new THREE.BoxGeometry(0.4, 0.3, 0.3), plain(0x3a4048, 0.5, 0.6), w / 2 - 0.35, h + 0.15, -0.1));
      g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 10), plain(0x4fd06a, 0.3, 0), w / 2 - 0.35, h + 0.33, 0.06));
    }
    // A vice, a saw blade and a scrap sheet on top.
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.14, 0.22), metalMat(), w / 2 - 0.2, h + 0.07, l / 2 - 0.18));
    const blade = mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.01, 20), metalMat(), -0.35, h + 0.01, -0.05);
    g.add(blade);
    const sheet = mesh(new THREE.BoxGeometry(0.5, 0.012, 0.35), rustMat(), 0.15, h + 0.006, -0.1);
    sheet.rotation.y = 0.3;
    g.add(sheet);
  } else if (kind === 'furnace') {
    // A squat stone furnace with a chimney and a fire door.
    const body = new THREE.LatheGeometry(
      [
        [0.0, 0],
        [0.5, 0],
        [0.5, 0.15],
        [0.47, 0.8],
        [0.38, 1.15],
        [0.16, 1.3],
        [0.0, 1.3],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      14,
    );
    g.add(mesh(body, stoneMat()));
    g.add(mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.45, 10), stoneMat(), 0, 1.45, 0));
    const fireMat = new THREE.MeshStandardMaterial({ color: 0x1a120c, emissive: 0x000000, roughness: 1 });
    const door = mesh(new THREE.CircleGeometry(0.2, 16), fireMat, 0, 0.4, 0.475);
    door.rotation.x = -0.06;
    g.add(door);
    g.add(mesh(new THREE.TorusGeometry(0.21, 0.03, 6, 16), metalMat(), 0, 0.4, 0.47));
    const light = new THREE.PointLight(0xff8a3a, 0, 6, 1.5);
    light.position.set(0, 0.5, 0.8);
    g.add(light);
    g.userData.setOn = (on: boolean) => {
      fireMat.emissive.set(on ? 0xff6a1a : 0x000000);
      fireMat.emissiveIntensity = on ? 2.2 : 0;
      light.intensity = on ? 6 : 0;
    };
  } else if (kind === 'lootBag') {
    // A stuffed canvas sack left where someone died.
    const sack = mesh(new THREE.SphereGeometry(0.34, 14, 10), plain(0x6a5d44, 1), 0, 0.26, 0);
    sack.scale.set(1, 0.75, 0.9);
    g.add(sack);
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.14, 10), plain(0x5a4e38, 1), 0, 0.55, 0));
    g.add(mesh(new THREE.TorusGeometry(0.07, 0.015, 6, 12).rotateX(Math.PI / 2), plain(0x3a3026, 1), 0, 0.5, 0));
  } else {
    // A plank crate with metal corners.
    g.add(mesh(new RoundedBoxGeometry(w, h, l, 2, 0.02), plankMat(), 0, h / 2, 0));
    for (const x of [-1, 1]) for (const z of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.06, h + 0.01, 0.06), metalMat(), x * (w / 2 - 0.02), h / 2, z * (l / 2 - 0.02)));
    g.add(mesh(new THREE.BoxGeometry(w + 0.01, 0.04, l + 0.01), metalMat(), 0, h - 0.12, 0));
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.12, 0.03), metalMat(), 0, h - 0.18, l / 2 + 0.01));
  }
  return g;
}

/** What a survivor holds in their right hand, modelled pointing along +y from the grip. */
export function buildHeldItem(item: ItemId | null): THREE.Object3D | null {
  if (!item) return null;
  const g = new THREE.Group();
  const handle = (len: number, m: THREE.Material) => mesh(new THREE.CylinderGeometry(0.016, 0.019, len, 8), m, 0, len / 2 - 0.12, 0);
  const wood = plain(0x6b5136, 0.85);
  switch (item) {
    case 'rock':
      g.add(mesh(new THREE.DodecahedronGeometry(0.075, 0), stoneMat(), 0, 0.02, 0.02));
      return g;
    case 'stoneHatchet':
      g.add(handle(0.42, wood), mesh(new THREE.DodecahedronGeometry(0.06, 0).scale(0.6, 1, 1.4), stoneMat(), 0, 0.24, 0.05));
      return g;
    case 'stonePickaxe':
      g.add(handle(0.46, wood), mesh(new THREE.ConeGeometry(0.035, 0.36, 5).rotateX(Math.PI / 2), stoneMat(), 0, 0.3, 0));
      return g;
    case 'salvagedAxe': {
      const blade = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.012, 20).rotateZ(Math.PI / 2), metalMat(), 0, 0.28, 0.07);
      g.add(handle(0.5, rustMat()), blade);
      return g;
    }
    case 'salvagedPickaxe':
      g.add(handle(0.5, rustMat()), mesh(new THREE.BoxGeometry(0.03, 0.05, 0.42), metalMat(), 0, 0.33, 0));
      return g;
    case 'bandage':
    case 'syringe':
      return buildOtherWeapon(item)?.rotateX(-Math.PI / 2) ?? null;
    case 'buildingPlan':
      g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 10).rotateX(Math.PI / 2), plain(0x3f78b8, 0.8), 0, 0.02, 0.05));
      return g;
    default: {
      // Guns, bows and melee weapons are modelled along +z; turn them to point along +y like the tools.
      const gun = buildGun(item);
      const weapon = gun ?? buildOtherWeapon(item);
      if (!weapon) return null;
      weapon.rotation.x = -Math.PI / 2;
      g.add(weapon);
      if (gun) {
        // Where muzzle flashes appear.
        const muzzle = new THREE.Object3D();
        muzzle.position.copy(muzzleOffset(item));
        gun.add(muzzle);
        g.userData.muzzle = muzzle;
      }
      return g;
    }
  }
}
