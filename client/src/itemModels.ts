// A 3D model for every item, used to render inventory icons: loose resources (logs, stones,
// fragments, ingots, cloth, powder), ammunition, and the same models survivors hold or place.
// Models sit around the origin in metres; the icon renderer frames them.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { DEPLOYABLE_KINDS, type DeployableKind } from '../../shared/deployables.ts';
import { ITEMS, type ItemId } from '../../shared/items.ts';
import { mulberry32 } from '../../shared/terrain.ts';
import { buildArmourModel } from './armour.ts';
import { model } from './models.ts';
import { GUN_LOOKS, PISTOLS, buildGun, buildOtherWeapon } from './guns.ts';
import { buildBoulder, buildDeployable, buildHeldItem } from './props.ts';
import { barkSurface, clothSurface, concreteSurface, gunMetalSurface, rustSurface, woodGrainSurface } from './textures.ts';

const cache = new Map<string, THREE.Material>();
function mat(key: string, make: () => THREE.Material): THREE.Material {
  let m = cache.get(key);
  if (!m) cache.set(key, (m = make()));
  return m;
}
const std = (key: string, opts: THREE.MeshStandardMaterialParameters) => mat(key, () => new THREE.MeshStandardMaterial(opts));

function add(g: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, rz);
  g.add(mesh);
  return mesh;
}

/** A rough lump with its vertices pushed in and out, for stones, charcoal and fragments. */
function lump(rand: () => number, r: number, sx = 1, sy = 1, sz = 1, detail = 1): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(r, detail);
  const p = geo.attributes.position;
  const seen = new Map<string, number>();
  for (let i = 0; i < p.count; i++) {
    // Shared corners must move together, or the surface tears.
    const key = `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
    let k = seen.get(key);
    if (k === undefined) seen.set(key, (k = 0.75 + rand() * 0.45));
    p.setXYZ(i, p.getX(i) * k * sx, p.getY(i) * k * sy, p.getZ(i) * k * sz);
  }
  geo.computeVertexNormals();
  return geo;
}

/** End grain: growth rings on a cut log face. */
function endGrain(): THREE.Material {
  return mat('end-grain', () => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#c9a074';
    ctx.fillRect(0, 0, 128, 128);
    for (let r = 60; r > 2; r -= 3 + (r % 5)) {
      ctx.strokeStyle = r % 2 ? 'rgba(120,80,45,0.55)' : 'rgba(150,105,65,0.4)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(64 + Math.sin(r) * 2, 64 + Math.cos(r) * 2, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(70,45,25,0.6)';
    ctx.beginPath();
    ctx.moveTo(64, 64);
    ctx.lineTo(110, 40);
    ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
  });
}

/** A cartridge from a turned profile: brass case, then the bullet. */
function cartridge(g: THREE.Object3D, x: number, z: number, profile: [number, number][], tip: [number, number][], tipMat: THREE.Material) {
  const brass = std('brass', { color: 0xc9a050, roughness: 0.3, metalness: 1 });
  add(g, new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 20), brass, x, 0, z);
  add(g, new THREE.LatheGeometry(tip.map(([r, y]) => new THREE.Vector2(r, y)), 20), tipMat, x, 0, z);
}

function resource(item: ItemId): THREE.Object3D | null {
  const g = new THREE.Group();
  const rand = mulberry32(item.length * 9973 + item.charCodeAt(0));
  switch (item) {
    case 'wood': {
      const bark = std('log-bark', { ...barkSurface(), roughness: 0.95 });
      const logs: [number, number, number][] = [[-0.11, 0.09, 0], [0.11, 0.09, 0.02], [0, 0.27, -0.01]];
      for (const [x, y, z] of logs) {
        const r = 0.085 + rand() * 0.02;
        add(g, new THREE.CylinderGeometry(r, r * 1.05, 0.7, 18), [bark, endGrain(), endGrain()], x, y, z, Math.PI / 2, 0, 0).rotation.z = (rand() - 0.5) * 0.1;
      }
      return g;
    }
    case 'stone': {
      const m = std('loose-stone', { ...concreteSurface(), color: 0xa49d92, roughness: 0.95, flatShading: true });
      add(g, lump(rand, 0.16, 1.2, 0.8, 1), m, -0.06, 0.1, 0, 0.3, 0.5, 0);
      add(g, lump(rand, 0.12, 1, 0.8, 1.1), m, 0.15, 0.08, 0.08, 0.1, 1.2, 0.4);
      add(g, lump(rand, 0.09, 1, 0.9, 1), m, 0.05, 0.06, -0.15, 1, 0.3, 0);
      return g;
    }
    case 'metalOre':
    case 'sulfurOre':
    case 'hqmOre': {
      const boulder = buildBoulder(rand, item);
      const body = boulder.children[0];
      body.position.set(0, 0, 0);
      body.scale.setScalar(0.22);
      g.add(body);
      return g;
    }
    case 'scrap': {
      const rust = std('scrap-rust', { ...rustSurface('#6a6a64'), roughness: 0.6, metalness: 0.6 });
      // A bent sheet, a gear and a couple of bolts.
      const sheet = new THREE.PlaneGeometry(0.4, 0.28, 8, 4);
      const p = sheet.attributes.position;
      for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 9) * 0.03 + p.getX(i) * p.getX(i) * 0.5);
      sheet.computeVertexNormals();
      const s = add(g, sheet, rust, 0, 0.1, 0, -1.2, 0, 0.3);
      (s.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      const gear = add(g, new THREE.CylinderGeometry(0.1, 0.1, 0.03, 12), rust, 0.14, 0.08, 0.12, 0.3, 0, 0.2);
      for (let t = 0; t < 12; t++) {
        const a = (t / 12) * Math.PI * 2;
        add(gear, new THREE.BoxGeometry(0.03, 0.03, 0.03), rust, Math.cos(a) * 0.11, 0, Math.sin(a) * 0.11, 0, -a, 0);
      }
      const steel = std('bolt', { ...gunMetalSurface(), color: 0x8a8e94, roughness: 0.45, metalness: 0.9 });
      for (const [x, z] of [[-0.16, 0.12], [-0.05, 0.18]]) {
        add(g, new THREE.CylinderGeometry(0.012, 0.012, 0.12, 8), steel, x, 0.03, z, 0, 0, Math.PI / 2 - 0.2);
        add(g, new THREE.CylinderGeometry(0.025, 0.025, 0.018, 6), steel, x - 0.06, 0.04, z, 0, 0, Math.PI / 2 - 0.2);
      }
      return g;
    }
    case 'metal': {
      // Metal fragments: jagged little pieces of smelted steel.
      const m = std('fragments', { ...gunMetalSurface(), color: 0x9a9ea4, roughness: 0.4, metalness: 0.9, flatShading: true });
      for (let n = 0; n < 7; n++) {
        const a = (n / 7) * Math.PI * 2;
        const r = n === 0 ? 0 : 0.13;
        add(g, lump(rand, 0.07, 1.3, 0.45, 0.9, 0), m, Math.cos(a) * r, 0.05 + (n === 0 ? 0.05 : 0), Math.sin(a) * r, rand(), rand() * 3, rand() * 0.5);
      }
      return g;
    }
    case 'hqm': {
      const m = std('hqm', { ...gunMetalSurface(), color: 0xb8c8d8, roughness: 0.22, metalness: 1 });
      // Two cast ingots, the classic trapezoid.
      const ingot = () => {
        const shape = new THREE.Shape([new THREE.Vector2(-0.16, 0), new THREE.Vector2(0.16, 0), new THREE.Vector2(0.13, 0.08), new THREE.Vector2(-0.13, 0.08)]);
        const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 2 });
        return geo.translate(0, 0, -0.05);
      };
      add(g, ingot(), m, 0, 0, -0.07);
      add(g, ingot(), m, 0, 0, 0.07);
      add(g, ingot(), m, 0, 0.1, 0, 0, Math.PI / 2, 0);
      return g;
    }
    case 'charcoal': {
      const m = std('charcoal', { color: 0x262321, roughness: 0.95, metalness: 0, envMapIntensity: 0.3, flatShading: true });
      add(g, new THREE.CylinderGeometry(0.06, 0.07, 0.34, 7), m, -0.04, 0.07, 0, Math.PI / 2, 0.3, 0);
      add(g, new THREE.CylinderGeometry(0.05, 0.055, 0.26, 7), m, 0.09, 0.06, 0.06, Math.PI / 2, -0.4, 0);
      add(g, lump(rand, 0.07, 1.2, 0.8, 1, 0), m, 0.02, 0.15, -0.04);
      return g;
    }
    case 'sulfur': {
      const m = std('sulfur', { color: 0xe8cf3a, roughness: 0.45, emissive: 0x2a2000 });
      for (let n = 0; n < 9; n++) {
        const a = rand() * Math.PI * 2;
        const r = rand() * 0.14;
        const c = add(g, new THREE.OctahedronGeometry(0.05 + rand() * 0.05, 0), m, Math.cos(a) * r, 0.04 + rand() * 0.08, Math.sin(a) * r, rand() * 3, rand() * 3, 0);
        c.scale.set(1, 1.4, 1);
      }
      return g;
    }
    case 'gunpowder': {
      const sack = std('powder-sack', { ...clothSurface(), color: 0x9a8a68, roughness: 1 });
      const body = new THREE.LatheGeometry(
        [[0, 0], [0.14, 0.01], [0.17, 0.08], [0.16, 0.18], [0.13, 0.24], [0.12, 0.25]].map(([r, y]) => new THREE.Vector2(r, y)),
        20,
      );
      add(g, body, sack);
      add(g, new THREE.CircleGeometry(0.12, 20), std('powder', { color: 0x252423, roughness: 1 }), 0, 0.245, 0, -Math.PI / 2);
      add(g, new THREE.TorusGeometry(0.125, 0.012, 6, 20), sack, 0, 0.25, 0, Math.PI / 2);
      return g;
    }
    case 'hempSeed':
    case 'cornSeed':
    case 'pumpkinSeed': {
      // A little cloth pouch, tied off, with a few seeds spilled out in front.
      const pouch = std('seed-pouch', { ...clothSurface(), color: 0x8f7448, roughness: 1 });
      add(g, new THREE.SphereGeometry(0.11, 14, 10).scale(1, 0.85, 1), pouch, -0.04, 0.09, -0.03);
      add(g, new THREE.CylinderGeometry(0.03, 0.06, 0.07, 10), pouch, -0.04, 0.2, -0.03);
      add(g, new THREE.TorusGeometry(0.035, 0.008, 5, 12), std('seed-string', { color: 0x5a4426, roughness: 1 }), -0.04, 0.19, -0.03, Math.PI / 2);
      const look = item === 'hempSeed' ? { color: 0x6a6450, size: [0.016, 0.012, 0.012] } : item === 'cornSeed' ? { color: 0xe0b83a, size: [0.02, 0.012, 0.016] } : { color: 0xe8dfc4, size: [0.03, 0.008, 0.018] };
      const seedMat = std(`seed-${item}`, { color: look.color, roughness: 0.6 });
      for (let n = 0; n < 9; n++) {
        const [sx, sy, sz] = look.size.map((v) => v * 1.6);
        add(g, new THREE.SphereGeometry(1, 8, 6).scale(sx, sy, sz), seedMat, 0.06 + (rand() - 0.5) * 0.14, sy, 0.08 + (rand() - 0.5) * 0.12, 0, rand() * 3, 0);
      }
      return g;
    }
    case 'cloth': {
      const colors = [0xc9bb94, 0x8a7a5a, 0xa89a74];
      for (let n = 0; n < 3; n++) {
        const m = std(`cloth-${n}`, { ...clothSurface(), color: colors[n], roughness: 1 });
        add(g, new RoundedBoxGeometry(0.36, 0.05, 0.26, 3, 0.022), m, (rand() - 0.5) * 0.03, 0.03 + n * 0.05, (rand() - 0.5) * 0.03, 0, (rand() - 0.5) * 0.25, 0);
      }
      return g;
    }
    case 'arrow': {
      const shaft = std('arrow-shaft', { ...woodGrainSurface(), color: 0xc8a070, roughness: 0.8 });
      for (const off of [-0.05, 0.05]) {
        const a = new THREE.Group();
        add(a, new THREE.CylinderGeometry(0.006, 0.006, 0.7, 8), shaft);
        add(a, new THREE.ConeGeometry(0.016, 0.06, 4), std('arrow-head', { color: 0x7d776e, roughness: 0.75, flatShading: true }), 0, 0.37, 0);
        for (let f = 0; f < 3; f++) {
          const fl = add(a, new THREE.PlaneGeometry(0.03, 0.09), std('fletch', { color: 0xd8d0bc, roughness: 1, side: THREE.DoubleSide }), 0, -0.3, 0, 0, (f / 3) * Math.PI * 2, 0);
          fl.translateX(0.016);
        }
        a.position.x = off;
        g.add(a);
      }
      g.rotation.z = -Math.PI / 4;
      return g;
    }
    case 'pistolAmmo':
    case 'rifleAmmo':
    case 'shotgunShell':
    case 'handmadeShell': {
      const copper = std('copper', { color: 0xb8704a, roughness: 0.35, metalness: 1 });
      for (const [x, z] of [[-0.035, 0], [0.035, 0.01], [0, -0.05]]) {
        if (item === 'pistolAmmo') {
          cartridge(g, x, z, [[0, 0], [0.024, 0], [0.024, 0.006], [0.022, 0.008], [0.022, 0.06], [0, 0.06]], [[0, 0.06], [0.022, 0.06], [0.02, 0.08], [0.012, 0.095], [0, 0.1]], copper);
        } else if (item === 'rifleAmmo') {
          cartridge(g, x, z, [[0, 0], [0.026, 0], [0.026, 0.006], [0.023, 0.009], [0.025, 0.012], [0.025, 0.11], [0.016, 0.13], [0.014, 0.15], [0, 0.15]], [[0, 0.15], [0.014, 0.15], [0.012, 0.18], [0.006, 0.2], [0, 0.205]], copper);
        } else {
          const red = item === 'shotgunShell';
          const hull = std(red ? 'shell-red' : 'shell-paper', { color: red ? 0xa83a2e : 0xb89a6a, roughness: red ? 0.5 : 0.9 });
          add(g, new THREE.CylinderGeometry(0.028, 0.028, 0.13, 18), hull, x, 0.075, z);
          add(g, new THREE.CylinderGeometry(0.03, 0.03, 0.03, 18), red ? std('brass', { color: 0xc9a050, roughness: 0.3, metalness: 1 }) : std('base-iron', { color: 0x5c5a56, roughness: 0.6, metalness: 0.8 }), x, 0.015, z);
          add(g, new THREE.CircleGeometry(0.026, 18), std('crimp', { color: 0x3a1a14, roughness: 0.9 }), x, 0.141, z, -Math.PI / 2);
        }
      }
      return g;
    }
    default:
      return null;
  }
}

/** The model an item's icon is drawn from, plus how to frame it. */
/** Salvage parts drawn from their scanned models. */
const PART_MODELS: Partial<Record<ItemId, string>> = { gears: 'part-gears', metalPipe: 'part-pipe', rope: 'part-rope', sheetMetal: 'part-sheet' };

export function buildItemModel(item: ItemId): { model: THREE.Object3D; view: 'side' | 'top' | 'front' } | null {
  const part = PART_MODELS[item] ? model(PART_MODELS[item]!) : undefined;
  if (part) {
    const m = new THREE.Mesh(part.geometry, part.material);
    m.userData.shared = true;
    return { model: wrap(m), view: 'top' };
  }
  const r = resource(item);
  if (r) return { model: r, view: 'top' };
  if ((DEPLOYABLE_KINDS as readonly string[]).includes(item)) return { model: buildDeployable(item as DeployableKind), view: 'top' };
  // Guns and long weapons lie on the diagonal, barrel up and to the right, like Rust's icons.
  if (GUN_LOOKS[item]) {
    const gun = buildGun(item)!;
    gun.rotation.x = GUN_LOOKS[item]!.pistol ? 0 : -0.55;
    return { model: wrap(gun), view: 'side' };
  }
  const kind = ITEMS[item].kind;
  if (kind === 'weapon' || kind === 'medical' || kind === 'food') {
    const w = buildOtherWeapon(item);
    // Scanned guns with no code-built look, such as the higher-tier rifles and the compound bow.
    const scanned = !w && ITEMS[item].weapon && ITEMS[item].weapon!.class !== 'melee' ? buildGun(item) : null;
    if (scanned) {
      scanned.rotation.x = PISTOLS.includes(item) ? 0 : -0.55;
      return { model: wrap(scanned), view: 'side' };
    }
    if (w) {
      w.rotation.x = kind === 'weapon' ? -0.75 : -0.4;
      // Lay the crossbow's limbs toward the camera so they show.
      if (item === 'crossbow') w.rotation.set(-0.6, 0, 1.2);
      // Meat lies flat, seen from above at an angle.
      if (item === 'rawMeat' || item === 'cookedMeat') {
        w.rotation.set(0.9, 0, 0.3);
        return { model: wrap(w), view: 'front' };
      }
      // Cans, bottles and pills stand upright, seen from the front.
      if (kind === 'food' || item === 'antiRadPills') {
        w.rotation.x = 0.25;
        return { model: wrap(w), view: 'front' };
      }
      return { model: wrap(w), view: item === 'bandage' ? 'top' : 'side' };
    }
  }
  const armour = buildArmourModel(item);
  if (armour) {
    // Seen from the front and a little to the side, like clothing laid out for sale.
    armour.rotation.y = -0.55;
    return { model: wrap(armour), view: 'front' };
  }
  const held = buildHeldItem(item);
  // The blueprint is seen face on, a little turned, so its drawing shows.
  if (held && (item === 'buildingPlan' || item === 'blueprint')) {
    held.rotation.set(-0.2, 0.3, -0.35);
    return { model: wrap(held), view: 'front' };
  }
  if (held) {
    // Tools point along +y from the grip; tip them so the head sits top right.
    held.rotation.x = 0.7;
    return { model: wrap(held), view: 'side' };
  }
  return null;
}

function wrap(o: THREE.Object3D): THREE.Group {
  const g = new THREE.Group();
  g.add(o);
  return g;
}
