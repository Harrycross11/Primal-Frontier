// Models for the crafting update: stone and metal ore boulders, hemp plants, and the things
// players set down (workbench, furnace, storage box), plus tools held in the hand.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { DOORWAY, type DoorKind } from '../../shared/building.ts';
import { DEPLOYABLE_INFO, type DeployableKind } from '../../shared/deployables.ts';
import type { ItemId } from '../../shared/items.ts';
import { buildGun, buildOtherWeapon, muzzleOffset } from './guns.ts';
import { BOULDERS, model, soleMaterial } from './models.ts';
import { paintRock, rockGeometry, rockMaterial } from './rocks.ts';
import { clothSurface, concreteSurface, gunMetalSurface, metalSurface, plankSurface, rustSurface, woodGrainSurface } from './textures.ts';

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
const handleMat = () => mat('handle', () => new THREE.MeshStandardMaterial({ ...woodGrainSurface(), color: 0xa88866, roughness: 0.75 }));
const ropeMat = () => mat('rope', () => new THREE.MeshStandardMaterial({ ...clothSurface(), color: 0xb8a27a, roughness: 1 }));
const tapeMat = () => mat('tape', () => new THREE.MeshStandardMaterial({ ...clothSurface(), color: 0x2e2f30, roughness: 0.85 }));
const steelMat = () => mat('tool-steel', () => new THREE.MeshStandardMaterial({ ...gunMetalSurface(), color: 0x8a8e94, roughness: 0.4, metalness: 0.85 }));
const flintMat = () => mat('flint', () => new THREE.MeshStandardMaterial({ ...concreteSurface(), color: 0x7d776e, roughness: 0.75, flatShading: true }));
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
  metalOre: [0x9a9289, 0xd08a3e],
  sulfurOre: [0x9c968a, 0xe6cc48],
  hqmOre: [0x7c838c, 0xb4cde2],
};

/** A weathered boulder. Ore boulders get veins: rusty for metal, yellow for sulfur, blue-grey for high quality metal. */
export function buildBoulder(rand: () => number, kind: BoulderKind): THREE.Group {
  const scanned = scannedBoulder(rand, kind);
  if (scanned) return scanned;
  const ore = kind !== 'stone';
  const g = new THREE.Group();
  const { geo, cavity } = rockGeometry(rand, { detail: 4, stretch: [1.15, 0.85, 1], cuts: 8 });
  paintRock(geo, cavity, new THREE.Color(BOULDER_COLORS[kind][0]), rand, ore ? { color: new THREE.Color(BOULDER_COLORS[kind][1]), count: 4, width: kind === 'sulfurOre' ? 0.22 : 0.16 } : undefined);
  const rockMat = rockMaterial(`boulder-${kind}`, { vertexColors: true, roughness: ore ? 0.82 : 0.95 });
  const body = mesh(geo, rockMat, 0, 0.36, 0);
  g.add(body);
  // A few smaller stones broken off around the base.
  for (let n = 0; n < 3; n++) {
    const piece = rockGeometry(rand, { detail: 2, stretch: [1, 0.7, 0.9], cuts: 3 });
    paintRock(piece.geo, piece.cavity, new THREE.Color(BOULDER_COLORS[kind][0]), rand);
    const small = mesh(piece.geo, rockMat, 0, 0, 0);
    const a = rand() * Math.PI * 2;
    const s = 0.2 + rand() * 0.16;
    small.scale.setScalar(s);
    small.position.set(Math.cos(a) * 1.15, s * 0.3, Math.sin(a) * 1.05);
    small.rotation.set((rand() - 0.5) * 0.4, rand() * 6, (rand() - 0.5) * 0.4);
    g.add(small);
  }
  return g;
}

const scannedMats = new Map<string, THREE.MeshStandardMaterial>();

/**
 * A photo-scanned boulder, picked by `rand`. Its own colour comes from the scan; vertex colours
 * tint it per kind and paint the ore veins across it. Undefined if the scans didn't load.
 */
export function scannedRock(rand: () => number, base: THREE.Color, vein?: { color: THREE.Color; count: number; width: number }): THREE.Mesh | undefined {
  const m = model(BOULDERS[Math.floor(rand() * BOULDERS.length)]);
  if (!m) return undefined;
  const geo = m.geometry.clone();
  // paintRock expects a rock about 1 m in radius centred on the origin.
  geo.translate(0, -0.5, 0);
  paintRock(geo, new Float32Array(geo.attributes.position.count), base, rand, vein);
  geo.translate(0, 0.5, 0);
  const source = soleMaterial(m);
  let mat = scannedMats.get(source.uuid);
  if (!mat) {
    mat = source.clone();
    mat.vertexColors = true;
    scannedMats.set(source.uuid, mat);
  }
  const out = new THREE.Mesh(geo, mat);
  out.castShadow = true;
  out.receiveShadow = true;
  return out;
}

function scannedBoulder(rand: () => number, kind: BoulderKind): THREE.Group | undefined {
  const stone = new THREE.Color(BOULDER_COLORS.stone[0]);
  // Tints relative to plain stone, since the scan already has stone's colour.
  const base = new THREE.Color(BOULDER_COLORS[kind][0]);
  base.setRGB(base.r / stone.r, base.g / stone.g, base.b / stone.b);
  const vein = kind === 'stone' ? undefined : { color: new THREE.Color(BOULDER_COLORS[kind][1]).multiplyScalar(1.15), count: 4, width: kind === 'sulfurOre' ? 0.22 : 0.16 };
  const body = scannedRock(rand, base, vein);
  if (!body) return undefined;
  const g = new THREE.Group();
  body.position.y = -0.05;
  g.add(body);
  // A few smaller stones broken off around the base.
  for (let n = 0; n < 3; n++) {
    const small = scannedRock(rand, base)!;
    const a = rand() * Math.PI * 2;
    small.scale.setScalar(0.12 + rand() * 0.08);
    small.position.set(Math.cos(a) * 1.2, -0.02, Math.sin(a) * 1.1);
    small.rotation.y = rand() * 6;
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

/** A clump of pale wasteland mushrooms with brown, speckled caps. */
export function buildMushrooms(rand: () => number): THREE.Group {
  const g = new THREE.Group();
  const stemMat = plain(0xd8cdb4, 0.9);
  const capMat = mat('mushroom-cap', () => new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.6 }));
  const gillMat = plain(0xb8a888, 1);
  for (let n = 0; n < 5; n++) {
    const h = 0.16 + rand() * 0.22;
    const r = 0.08 + rand() * 0.08;
    const x = (rand() - 0.5) * 0.6;
    const z = (rand() - 0.5) * 0.6;
    const tilt = (rand() - 0.5) * 0.4;
    const m = new THREE.Group();
    m.position.set(x, 0, z);
    m.rotation.set(tilt, rand() * 3, (rand() - 0.5) * 0.4);
    m.add(mesh(new THREE.CylinderGeometry(r * 0.3, r * 0.4, h, 8).translate(0, h / 2, 0), stemMat));
    const cap = mesh(new THREE.SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1), capMat, 0, h - 0.004, 0);
    m.add(cap);
    m.add(mesh(new THREE.CircleGeometry(r * 0.98, 12).rotateX(Math.PI / 2), gillMat, 0, h - 0.003, 0));
    g.add(m);
  }
  return g;
}

/**
 * A blue plastic drum catching rain under a tarp funnel. `setLevel` (0 to 1) raises or lowers
 * the water inside as people drink from it.
 */
export function buildWaterBarrel(): THREE.Group {
  const g = new THREE.Group();
  const plastic = mat('drum-plastic', () => new THREE.MeshStandardMaterial({ color: 0x2c5a80, roughness: 0.5 }));
  const body = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 20, 1, true), plastic, 0, 0.45, 0);
  (body.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  g.add(body);
  g.add(mesh(new THREE.CircleGeometry(0.3, 20).rotateX(-Math.PI / 2), plastic, 0, 0.02, 0));
  for (const y of [0.22, 0.68]) g.add(mesh(new THREE.TorusGeometry(0.305, 0.015, 6, 24).rotateX(Math.PI / 2), plastic, 0, y, 0));
  g.add(mesh(new THREE.TorusGeometry(0.3, 0.02, 6, 24).rotateX(Math.PI / 2), plastic, 0, 0.9, 0));
  // A torn tarp tied round the rim as a funnel.
  const tarp = mat('tarp', () => new THREE.MeshStandardMaterial({ ...clothSurface(), color: 0x5a6a4a, roughness: 1, side: THREE.DoubleSide }));
  const funnel = mesh(new THREE.CylinderGeometry(0.5, 0.28, 0.16, 10, 1, true), tarp, 0, 0.97, 0);
  funnel.rotation.z = 0.08;
  g.add(funnel);
  for (const a of [0.4, 2.5, 4.4]) g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), ropeMat(), Math.cos(a) * 0.4, 0.9, Math.sin(a) * 0.4));
  const water = mesh(
    new THREE.CircleGeometry(0.29, 20).rotateX(-Math.PI / 2),
    mat('barrel-water', () => new THREE.MeshStandardMaterial({ color: 0x3a5058, roughness: 0.08, metalness: 0.2 })),
    0,
    0.82,
    0,
  );
  water.castShadow = false;
  g.add(water);
  g.userData.setLevel = (k: number) => {
    water.visible = k > 0.01;
    water.position.y = 0.1 + 0.72 * k;
  };
  return g;
}

/** A yellow radiation warning sign on a leaning post, at the edge of a hot crater. */
export function buildRadSign(): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.035, 0.04, 1.8, 6).translate(0, 0.9, 0), rustMat()));
  const face = mat('rad-sign', () => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#d8b42a';
    ctx.fillRect(0, 0, 128, 128);
    ctx.strokeStyle = '#1e1a14';
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 116, 116);
    // The trefoil: three blades round a centre dot.
    ctx.fillStyle = '#1e1a14';
    ctx.translate(64, 64);
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      const a = (i * 2 * Math.PI) / 3 - Math.PI / 2;
      ctx.moveTo(Math.cos(a - 0.52) * 14, Math.sin(a - 0.52) * 14);
      ctx.arc(0, 0, 46, a - 0.52, a + 0.52);
      ctx.arc(0, 0, 14, a + 0.52, a - 0.52, true);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();
    // Weathering: rust streaks and flaked paint.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#7a4a24';
    for (let i = 0; i < 9; i++) ctx.fillRect(10 + i * 13, 70 + (i % 3) * 12, 3, 40 + (i % 4) * 10);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0.2 });
  });
  const board = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.02), [rustMat(), rustMat(), rustMat(), rustMat(), face, rustMat()]);
  board.position.set(0, 1.45, 0.05);
  board.rotation.z = 0.12;
  board.castShadow = true;
  g.add(board);
  g.rotation.z = 0.06;
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
  } else if (kind === 'toolCupboard') {
    // A tall plank cabinet with its tools hung on the front: a hammer, a saw and a wrench.
    g.add(mesh(new RoundedBoxGeometry(w, h, l, 2, 0.02), plankMat(), 0, h / 2, 0));
    for (const x of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(w / 2 - 0.06, h - 0.3, 0.02), plain(0x5a4630, 0.9), x * (w / 4), h / 2 + 0.05, l / 2 + 0.01));
    g.add(mesh(new THREE.BoxGeometry(w + 0.04, 0.08, l + 0.04), plankMat(), 0, h - 0.04, 0));
    g.add(mesh(new THREE.BoxGeometry(w + 0.02, 0.1, l + 0.02), plankMat(), 0, 0.05, 0));
    for (const x of [-0.03, 0.03]) g.add(mesh(new THREE.BoxGeometry(0.02, 0.1, 0.03), metalMat(), x, h * 0.55, l / 2 + 0.03));
    const hammer = new THREE.Group();
    hammer.add(mesh(new THREE.CylinderGeometry(0.015, 0.018, 0.34, 8), handleMat(), 0, 0, 0));
    hammer.add(mesh(new THREE.BoxGeometry(0.13, 0.05, 0.05), steelMat(), 0.02, 0.17, 0));
    hammer.position.set(-w / 4, h * 0.62, l / 2 + 0.05);
    hammer.rotation.z = 0.2;
    g.add(hammer);
    const saw = mesh(new THREE.BoxGeometry(0.1, 0.36, 0.006), steelMat(), w / 4, h * 0.6, l / 2 + 0.04);
    saw.rotation.z = -0.15;
    g.add(saw, mesh(new THREE.BoxGeometry(0.12, 0.06, 0.03), handleMat(), w / 4 - 0.03, h * 0.6 + 0.2, l / 2 + 0.04));
    // A rusty sign on top so it reads at a glance.
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.16, 0.02), rustMat(), 0, h + 0.08, l / 2 - 0.06));
  } else if (kind === 'sleepingBag') {
    // A quilted bag laid flat, with a rolled pillow at the head.
    const bag = mesh(new RoundedBoxGeometry(w, h, l, 3, 0.06), plain(0x4f5a3a, 1), 0, h / 2, 0);
    g.add(bag);
    for (let n = 1; n < 6; n++) g.add(mesh(new THREE.BoxGeometry(w - 0.04, 0.01, 0.02), plain(0x3f4a2e, 1), 0, h + 0.002, -l / 2 + (n * l) / 6));
    g.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, w - 0.1, 12).rotateZ(Math.PI / 2), plain(0x8a7d64, 1), 0, h + 0.06, -l / 2 + 0.18));
    g.add(mesh(new THREE.BoxGeometry(w * 0.6, 0.02, 0.5), plain(0x6a3a2a, 1), 0, h + 0.005, l / 2 - 0.4));
  } else if (kind === 'beancan' || kind === 'satchel' || kind === 'c4') {
    const charge = buildCharge(kind, true);
    g.add(charge);
    g.userData.tick = charge.userData.tick;
  } else if (kind === 'crate' || kind === 'militaryCrate' || kind === 'supplyDrop') {
    const scan = model(kind === 'crate' ? 'crate' : kind === 'militaryCrate' ? 'crate-military' : 'crate-drop');
    if (scan) g.add(shared(new THREE.Mesh(scan.geometry, scan.material)));
    else {
      const look = kind === 'crate' ? plankMat() : plain(kind === 'supplyDrop' ? 0x3d4a2e : 0x4a5a3a, 0.7, 0.2);
      g.add(mesh(new RoundedBoxGeometry(w, h, l, 2, 0.02), look, 0, h / 2, 0));
    }
    if (kind === 'supplyDrop') {
      // Its parachute, shown while it comes down (see World.update).
      const chute = new THREE.Group();
      chute.name = 'chute';
      const canopy = model('parachute');
      if (canopy) {
        const c = shared(new THREE.Mesh(canopy.geometry, canopy.material));
        chute.add(c);
      } else {
        const dome = mesh(new THREE.SphereGeometry(2.2, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2.4), plain(0x4f5a3a, 1));
        dome.position.y = 3.6;
        (dome.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
        chute.add(dome);
      }
      chute.position.y = h - 0.1;
      chute.visible = false;
      g.add(chute);
    }
  } else if (kind === 'supplySignal') {
    g.add(buildSignal(true));
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

/** A model's own geometry, shared with every copy: marked so nobody disposes of it. */
function shared(m: THREE.Mesh): THREE.Mesh {
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.shared = true;
  return m;
}

/** A supply signal: a red smoke canister with a pull ring. Lit ones glow at the top. */
export function buildSignal(lit: boolean): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.17, 16), plain(0xa82a22, 0.55, 0.3), 0, 0.085, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.05, 16, 1, true), plain(0xd8d2c0, 0.8), 0, 0.09, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.03, 16), plain(0x2a2c2e, 0.5, 0.6), 0, 0.185, 0));
  const ring = mesh(new THREE.TorusGeometry(0.02, 0.004, 6, 14), plain(0x9a9c9a, 0.4, 0.8), 0.03, 0.2, 0);
  ring.rotation.y = Math.PI / 2;
  g.add(ring);
  if (lit) {
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.y = 0.21;
    glow.userData.noAO = true;
    g.add(glow);
    g.userData.tick = () => glow.scale.setScalar(0.7 + Math.random() * 0.6);
  }
  return g;
}

/** The supply plane, nose along +z, or a rough stand-in if its model didn't load. */
export function buildPlane(): THREE.Group {
  const g = new THREE.Group();
  const scan = model('plane');
  if (scan) {
    const body = shared(new THREE.Mesh(scan.geometry, scan.material));
    body.castShadow = false;
    g.add(body);
    return g;
  }
  const grey = plain(0x8a8e92, 0.6, 0.3);
  g.add(mesh(new THREE.CylinderGeometry(2.6, 2.2, 48, 12).rotateX(Math.PI / 2), grey, 0, 4, 0));
  g.add(mesh(new THREE.BoxGeometry(52, 0.6, 7), grey, 0, 6, 2));
  g.add(mesh(new THREE.BoxGeometry(0.6, 8, 5), grey, 0, 9, -22));
  return g;
}

/**
 * How far up a scanned tool's handle the hand closes, in metres from its end: near the guard on
 * blades, around the balance point on spears, and round the middle of a rock.
 */
const TOOL_GRIP: Partial<Record<ItemId, number | 'middle'>> = {
  rock: 'middle',
  machete: 0.09,
  salvagedSword: 0.2,
  woodenSpear: 0.85,
  stoneSpear: 0.85,
  combatKnife: 0.06,
  nailBat: 0.1,
};

/** What a survivor holds in their right hand, modelled pointing along +y from the grip. */
export function buildHeldItem(item: ItemId | null): THREE.Object3D | null {
  if (!item) return null;
  const g = new THREE.Group();
  // A scanned tool, if it loaded, stands with the end of its handle just below the hand.
  const scan = model(`tool-${item}`);
  if (scan) {
    const tool = new THREE.Mesh(scan.geometry, scan.material);
    const grip = TOOL_GRIP[item] ?? 0.12;
    tool.position.y = -(grip === 'middle' ? scan.geometry.boundingBox!.max.y / 2 : grip);
    tool.castShadow = true;
    tool.userData.shared = true;
    g.add(tool);
    return g;
  }
  const handle = (len: number, m: THREE.Material) => mesh(new THREE.CylinderGeometry(0.016, 0.019, len, 8), m, 0, len / 2 - 0.12, 0);
  const wood = plain(0x6b5136, 0.85);
  /** Rope or tape wound round the shaft, as rings stacked along y. */
  const wrap = (y0: number, y1: number, r: number, m: THREE.Material) => {
    for (let y = y0; y <= y1; y += 0.012) g.add(mesh(new THREE.TorusGeometry(r, 0.006, 5, 12).rotateX(Math.PI / 2), m, 0, y, 0));
  };
  /** A knapped stone: a rough low-poly lump with its vertices jittered. */
  const knapped = (radius: number, sx: number, sy: number, sz: number) => {
    const geo = new THREE.IcosahedronGeometry(radius, 1);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 0.85 + Math.abs(Math.sin(i * 12.9898) * 43758.5453 % 1) * 0.3;
      p.setXYZ(i, p.getX(i) * k * sx, p.getY(i) * k * sy, p.getZ(i) * k * sz);
    }
    geo.computeVertexNormals();
    return geo;
  };
  switch (item) {
    case 'rock':
      g.add(mesh(knapped(0.075, 1, 0.85, 1.1), flintMat(), 0, 0.02, 0.02));
      return g;
    case 'stoneHatchet':
      // A flint head split into the shaft and lashed on with rope.
      g.add(handle(0.42, handleMat()));
      g.add(mesh(knapped(0.06, 0.45, 0.85, 1.5), flintMat(), 0, 0.24, 0.055));
      wrap(0.2, 0.28, 0.024, ropeMat());
      wrap(-0.1, -0.02, 0.022, ropeMat());
      return g;
    case 'stonePickaxe': {
      g.add(handle(0.46, handleMat()));
      for (const dir of [-1, 1]) {
        const pick = mesh(new THREE.ConeGeometry(0.032, 0.2, 6), flintMat(), 0, 0.3, dir * 0.1);
        pick.rotation.x = dir * (Math.PI / 2 + 0.25);
        (pick.material as THREE.MeshStandardMaterial).flatShading = true;
        g.add(pick);
      }
      g.add(mesh(knapped(0.04, 1, 1, 1.2), flintMat(), 0, 0.3, 0));
      wrap(0.25, 0.34, 0.024, ropeMat());
      return g;
    }
    case 'salvagedAxe': {
      // A saw blade bolted to a length of pipe, with a taped grip.
      const pipe = mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.52, 10), rustMat(), 0, 0.14, 0);
      const blade = mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.008, 28).rotateZ(Math.PI / 2), steelMat(), 0, 0.3, 0.07);
      g.add(pipe, blade);
      for (let t = 0; t < 24; t++) {
        const a = (t / 24) * Math.PI * 2;
        const tooth = mesh(new THREE.ConeGeometry(0.008, 0.02, 3), steelMat(), 0, 0.3 + Math.sin(a) * 0.115, 0.07 + Math.cos(a) * 0.115);
        tooth.rotation.x = -a + Math.PI / 2;
        g.add(tooth);
      }
      g.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 8).rotateZ(Math.PI / 2), rustMat(), 0, 0.3, 0.07));
      wrap(-0.11, 0.05, 0.02, tapeMat());
      return g;
    }
    case 'salvagedPickaxe': {
      g.add(mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.56, 10), rustMat(), 0, 0.16, 0));
      // A forged steel head: two tapered spikes drooping slightly from a central eye.
      for (const dir of [-1, 1]) {
        const spike = mesh(new THREE.CylinderGeometry(0.004, 0.022, 0.22, 8), steelMat(), 0, 0.325, dir * 0.12);
        spike.rotation.x = dir * (Math.PI / 2 + 0.22);
        g.add(spike);
      }
      g.add(mesh(new RoundedBoxGeometry(0.05, 0.07, 0.06, 2, 0.01), rustMat(), 0, 0.34, 0));
      wrap(-0.11, 0.05, 0.02, tapeMat());
      return g;
    }
    case 'bandage':
    case 'syringe':
      return buildOtherWeapon(item)?.rotateX(-Math.PI / 2) ?? null;
    case 'cannedBeans':
    case 'bottledWater':
    case 'antiRadPills':
    case 'mushroom':
    case 'feedSack':
    case 'rawMeat':
    case 'cookedMeat':
      // Held upright in the palm.
      return buildOtherWeapon(item)?.rotateX(-Math.PI / 2).translateY(-0.03) ?? null;
    case 'torch': {
      // A stick with oily rags bound round the top, burning.
      g.add(handle(0.5, handleMat()));
      g.add(mesh(new THREE.CylinderGeometry(0.034, 0.026, 0.12, 9), plain(0x2a2018, 1), 0, 0.36, 0));
      wrap(0.31, 0.41, 0.03, ropeMat());
      const flame = new THREE.Group();
      flame.position.y = 0.44;
      const fire = (r: number, h: number, color: number, opacity: number) => {
        const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 10, 1, true).translate(0, h / 2, 0), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
        m.userData.noAO = true;
        flame.add(m);
        return m;
      };
      fire(0.045, 0.2, 0xff6a1a, 0.55);
      fire(0.028, 0.14, 0xffd27a, 0.8);
      flame.userData.flame = true;
      g.add(flame);
      g.userData.flame = flame;
      return g;
    }
    case 'woodenDoor':
    case 'metalDoor': {
      // A small leaf held at its edge.
      const leaf = buildDoorLeaf(item, false);
      leaf.scale.setScalar(0.3);
      leaf.position.set(-0.02, -0.15, 0);
      g.add(leaf);
      return g;
    }
    case 'codeLock':
      g.add(buildKeypad(true));
      g.children[0].position.set(0, 0.04, 0.03);
      return g;
    case 'beancan':
    case 'satchel':
    case 'c4': {
      const charge = buildCharge(item, false);
      charge.position.y = item === 'beancan' ? -0.04 : -0.08;
      g.add(charge);
      return g;
    }
    case 'supplySignal': {
      const can = buildSignal(false);
      can.position.y = -0.06;
      g.add(can);
      return g;
    }
    case 'explosives': {
      // Three paper-wrapped sticks taped into a bundle.
      for (const [x, z] of [
        [-0.022, 0],
        [0.022, 0],
        [0, 0.036],
      ]) {
        g.add(mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.22, 12), plain(0xa83a2a, 0.75), x, 0.06, z));
        g.add(mesh(new THREE.CircleGeometry(0.02, 12).rotateX(-Math.PI / 2), plain(0xd8c8a0, 0.9), x, 0.171, z));
      }
      for (const y of [0.0, 0.12]) g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 14), tapeMat(), 0, y, 0.012));
      return g;
    }
    case 'buildingPlan': {
      // A rolled blueprint tied with string.
      g.add(mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.3, 16).rotateX(Math.PI / 2), plain(0x335f94, 0.85), 0, 0.02, 0.05));
      g.add(mesh(new THREE.CircleGeometry(0.0275, 16).rotateY(0), plain(0xd8e4f0, 0.9), 0, 0.02, 0.201));
      for (const z of [-0.04, 0.14]) g.add(mesh(new THREE.TorusGeometry(0.029, 0.003, 4, 16), ropeMat(), 0, 0.02, z));
      return g;
    }
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

/**
 * A door for a doorway, hinged at its left edge (the origin) and standing along +x, facing +z
 * and -z alike: boards with battens and a Z-brace, or a riveted steel sheet. A fitted code lock
 * shows on both faces.
 */
export function buildDoorLeaf(kind: DoorKind, locked: boolean): THREE.Group {
  const g = new THREE.Group();
  const W = DOORWAY.to - DOORWAY.from - 0.04;
  const H = DOORWAY.height - 0.03;
  const T = 0.05;
  const x0 = 0.02;
  if (kind === 'woodenDoor') {
    const boards = 5;
    for (let n = 0; n < boards; n++) {
      const bw = W / boards - 0.006;
      const board = mesh(new THREE.BoxGeometry(bw, H - (n % 2) * 0.02, T), plankMat(), x0 + (n + 0.5) * (W / boards), H / 2, 0);
      g.add(board);
    }
    for (const side of [-1, 1]) {
      for (const y of [0.3, H - 0.3]) g.add(mesh(new THREE.BoxGeometry(W - 0.08, 0.13, 0.035), plankMat(), x0 + W / 2, y, side * (T / 2 + 0.017)));
      const brace = mesh(new THREE.BoxGeometry(Math.hypot(W - 0.16, H - 0.6), 0.11, 0.03), plankMat(), x0 + W / 2, H / 2, side * (T / 2 + 0.015));
      brace.rotation.z = Math.atan2(H - 0.6, W - 0.16) * (side > 0 ? 1 : -1);
      g.add(brace);
      // Black iron strap hinges.
      for (const y of [0.3, H - 0.3]) g.add(mesh(new THREE.BoxGeometry(0.42, 0.05, 0.008), plain(0x1d1b19, 0.6, 0.7), x0 + 0.2, y, side * (T / 2 + 0.04)));
    }
  } else {
    g.add(mesh(new THREE.BoxGeometry(W, H, T * 0.6), rustMat(), x0 + W / 2, H / 2, 0));
    for (const side of [-1, 1]) {
      const z = side * (T * 0.3 + 0.012);
      // A welded frame round the sheet, a stiffener across the middle, and rivets.
      g.add(mesh(new THREE.BoxGeometry(W, 0.08, 0.024), metalMat(), x0 + W / 2, 0.04, z));
      g.add(mesh(new THREE.BoxGeometry(W, 0.08, 0.024), metalMat(), x0 + W / 2, H - 0.04, z));
      g.add(mesh(new THREE.BoxGeometry(0.08, H, 0.024), metalMat(), x0 + 0.04, H / 2, z));
      g.add(mesh(new THREE.BoxGeometry(0.08, H, 0.024), metalMat(), x0 + W - 0.04, H / 2, z));
      g.add(mesh(new THREE.BoxGeometry(W - 0.1, 0.07, 0.02), metalMat(), x0 + W / 2, H * 0.48, z));
      for (let n = 0; n < 8; n++) {
        for (const y of [0.04, H - 0.04]) g.add(mesh(new THREE.SphereGeometry(0.012, 6, 4), steelMat(), x0 + 0.1 + (n * (W - 0.2)) / 7, y, z + side * 0.014));
      }
    }
  }
  // A pull handle on each face.
  for (const side of [-1, 1]) {
    const handle = mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 12, Math.PI).rotateZ(-Math.PI / 2), plain(0x2a2826, 0.5, 0.8), x0 + W - 0.13, 1.0, side * (T / 2 + 0.03));
    g.add(handle);
    if (locked) {
      const pad = buildKeypad(false);
      pad.position.set(x0 + W - 0.13, 1.2, side * (T / 2 + 0.02));
      if (side < 0) pad.rotation.y = Math.PI;
      g.add(pad);
    }
  }
  return g;
}

/** A code lock's keypad: a steel box with a grid of buttons and a green light, facing +z. */
function buildKeypad(held: boolean): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new RoundedBoxGeometry(0.09, 0.15, 0.035, 2, 0.008), plain(0x3a3e42, 0.45, 0.7), 0, 0, 0));
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) g.add(mesh(new THREE.BoxGeometry(0.018, 0.016, 0.008), plain(0xb8bcc0, 0.5, 0.6), -0.024 + c * 0.024, 0.035 - r * 0.024, 0.02));
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshStandardMaterial({ color: 0x6cff6a, emissive: 0x3cff4a, emissiveIntensity: 2 }));
  led.position.set(0.03, 0.062, 0.018);
  g.add(led);
  if (held) g.rotation.x = -0.4;
  return g;
}

/**
 * A charge: a beancan grenade (a food tin with a fuse), a satchel charge (a canvas bag of
 * cans with a fuse), or C4 (taped blocks, wires and a timer). Lit ones spark or blink. Each
 * stands with its back against -z and its base at y = 0.
 */
export function buildCharge(kind: 'beancan' | 'satchel' | 'c4', lit: boolean): THREE.Group {
  const g = new THREE.Group();
  let spark: THREE.Object3D | null = null;
  let led: THREE.MeshStandardMaterial | null = null;
  const sparkAt = (x: number, y: number, z: number) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.set(x, y, z);
    s.userData.noAO = true;
    g.add(s);
    spark = s;
  };
  if (kind === 'beancan') {
    g.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.12, 16), plain(0x9a9c9a, 0.4, 0.8), 0, 0.06, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.07, 16, 1, true), plain(0xb04a2a, 0.8), 0, 0.06, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.05, 6), plain(0x3a2a1c, 1), 0.01, 0.145, 0));
    if (lit) sparkAt(0.01, 0.17, 0);
  } else if (kind === 'satchel') {
    const bag = mesh(new RoundedBoxGeometry(0.28, 0.24, 0.13, 3, 0.04), plain(0x6a5d44, 1), 0, 0.12, 0);
    g.add(bag);
    g.add(mesh(new THREE.BoxGeometry(0.29, 0.1, 0.14), plain(0x5a4e38, 1), 0, 0.2, 0.004));
    const strap = mesh(new THREE.TorusGeometry(0.11, 0.012, 6, 16, Math.PI), plain(0x3a3026, 1), 0, 0.24, 0);
    g.add(strap);
    for (const x of [-0.07, 0, 0.07]) g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.04, 12), plain(0x9a9c9a, 0.4, 0.8), x, 0.255, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.08, 6).rotateZ(0.6), plain(0x3a2a1c, 1), 0.1, 0.28, 0.02));
    if (lit) sparkAt(0.125, 0.31, 0.02);
  } else {
    for (const x of [-0.07, 0.07]) g.add(mesh(new THREE.BoxGeometry(0.12, 0.2, 0.07), plain(0xc8b98a, 0.9), x, 0.1, -0.01));
    for (const y of [0.05, 0.15]) g.add(mesh(new THREE.BoxGeometry(0.27, 0.03, 0.075), tapeMat(), 0, y, -0.008));
    g.add(mesh(new RoundedBoxGeometry(0.1, 0.07, 0.03, 2, 0.006), plain(0x1e2124, 0.5, 0.4), 0, 0.12, 0.035));
    const screen = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a1a, emissiveIntensity: lit ? 1.5 : 0.4 });
    g.add(mesh(new THREE.PlaneGeometry(0.06, 0.025), screen, 0, 0.125, 0.051));
    led = screen;
    for (const [x, c] of [
      [-0.04, 0xc8302a],
      [0.0, 0x2a6ac8],
      [0.04, 0xd8c040],
    ] as const) {
      const wire = mesh(new THREE.TorusGeometry(0.04, 0.004, 5, 10, Math.PI), plain(c, 0.6), x, 0.2, 0.02);
      wire.rotation.y = Math.PI / 2;
      g.add(wire);
    }
  }
  if (lit) {
    // Called each frame by the world: sparks gutter, the timer blinks faster as it runs down.
    g.userData.tick = (t: number) => {
      if (spark) spark.scale.setScalar(0.7 + Math.random() * 0.8);
      if (led) led.emissiveIntensity = Math.sin(t * 9) > 0 ? 3 : 0.3;
    };
  }
  return g;
}
