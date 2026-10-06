// Extra map detail that tells the world's story without affecting gameplay: an old broken
// road beside the power line, toxic puddles in the blast craters, pebbles, rubble, tyres,
// planks and dead shrubs scattered over the ground, and distant hills fading into the haze.

import * as THREE from 'three';
import { HALF_WORLD, WORLD_SIZE } from '../../shared/constants.ts';
import { craters, mulberry32, terrainHeight } from '../../shared/terrain.ts';
import type { Decor } from '../../shared/world.ts';
import { asphaltSurface, barkSurface, concreteSurface } from './textures.ts';
import { model, variants, type Model } from './models.ts';
import { rockGeometry, rockMaterial } from './rocks.ts';

export function buildScenery(scene: THREE.Scene, seed: number, decor: Decor[]) {
  buildRoad(scene, seed, decor);
  buildPuddles(scene, seed);
  buildScatter(scene, seed);
  buildDistantHills(scene);
}

/** A cracked asphalt road running alongside the line of power poles, following the ground. */
function buildRoad(scene: THREE.Scene, seed: number, decor: Decor[]) {
  const poles = decor.filter((d) => d.kind === 'pole');
  if (poles.length < 2) return;
  const a = poles[0];
  const b = poles[poles.length - 1];
  const dir = new THREE.Vector2(b.x - a.x, b.z - a.z).normalize();
  const across = new THREE.Vector2(-dir.y, dir.x);
  const mid = new THREE.Vector2((a.x + b.x) / 2, (a.z + b.z) / 2).addScaledVector(across, 4.5);
  const width = 6;
  const cols = 7;
  const step = 1;
  const half = HALF_WORLD * 1.05;
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  let rows = 0;
  for (let t = -half * 1.5; t <= half * 1.5; t += step) {
    const cx = mid.x + dir.x * t;
    const cz = mid.y + dir.y * t;
    if (Math.abs(cx) > half || Math.abs(cz) > half) continue;
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);
      const x = cx + across.x * (u - 0.5) * width;
      const z = cz + across.y * (u - 0.5) * width;
      positions.push(x, terrainHeight(seed, x, z) + 0.04, z);
      uvs.push(u, t / width);
    }
    if (rows > 0) {
      const r0 = (rows - 1) * cols;
      const r1 = rows * cols;
      for (let c = 0; c < cols - 1; c++) index.push(r0 + c, r0 + c + 1, r1 + c, r0 + c + 1, r1 + c + 1, r1 + c);
    }
    rows++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  geo.computeVertexNormals();
  const s = asphaltSurface();
  const mat = new THREE.MeshStandardMaterial({
    ...s,
    roughness: 0.92,
    alphaTest: 0.5,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const road = new THREE.Mesh(geo, mat);
  road.receiveShadow = true;
  scene.add(road);
}

/** Stagnant, faintly glowing water pooled at the bottom of each blast crater. */
function buildPuddles(scene: THREE.Scene, seed: number) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3c4a2a,
    emissive: 0x1c2c08,
    roughness: 0.06,
    metalness: 0.2,
    transparent: true,
    opacity: 0.88,
  });
  for (const c of craters(seed)) {
    let low = Infinity;
    for (let a = 0; a < 12; a++) for (const r of [0, c.radius * 0.15, c.radius * 0.3]) low = Math.min(low, terrainHeight(seed, c.x + Math.cos(a) * r, c.z + Math.sin(a) * r));
    const water = new THREE.Mesh(new THREE.CircleGeometry(c.radius * 0.7, 48).rotateX(-Math.PI / 2), mat);
    water.position.set(c.x, low + c.depth * 0.18, c.z);
    water.receiveShadow = true;
    scene.add(water);
  }
}

/** Scattered pebbles, rubble, bricks, old tyres, planks and dead shrubs. */
function buildScatter(scene: THREE.Scene, seed: number) {
  const rand = mulberry32(seed ^ 0x5eed);
  const concrete = concreteSurface();
  const bark = barkSurface(true);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const span = WORLD_SIZE * 0.47;

  const scatter = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material | THREE.Material[],
    count: number,
    place: (i: number) => { x: number; z: number; size: number; flat?: boolean; lift?: number } | null,
    shadows = false,
  ): THREE.InstancedMesh => {
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    let n = 0;
    for (let i = 0; i < count; i++) {
      const p = place(i);
      if (!p) continue;
      const y = terrainHeight(seed, p.x, p.z);
      e.set(p.flat ? (rand() - 0.5) * 0.2 : rand() * Math.PI, rand() * Math.PI * 2, p.flat ? (rand() - 0.5) * 0.2 : rand() * Math.PI);
      q.setFromEuler(e);
      sc.setScalar(p.size);
      v.set(p.x, y + (p.lift ?? 0) * p.size, p.z);
      mesh.setMatrixAt(n++, m.compose(v, q, sc));
    }
    mesh.count = n;
    mesh.receiveShadow = true;
    mesh.castShadow = shadows;
    scene.add(mesh);
    return mesh;
  };
  /** Scatters a scanned set, sharing `count` between its variants. Cut-out leaves skip the AO pass. */
  const scatterSet = (set: Model[], count: number, place: Parameters<typeof scatter>[3], cutout = false) => {
    for (const v of set) {
      const mesh = scatter(v.geometry, v.material, Math.ceil(count / set.length), place, true);
      if (cutout) mesh.userData.noAO = true;
    }
  };
  const anywhere = () => ({ x: (rand() - 0.5) * 2 * span, z: (rand() - 0.5) * 2 * span });
  // Clusters, so debris looks dumped or blown together rather than sprinkled evenly.
  const clusters = (n: number, spread: number) => {
    const centres = [...Array(n)].map(anywhere);
    return () => {
      const c = centres[Math.floor(rand() * centres.length)];
      return { x: c.x + (rand() - 0.5) * spread, z: c.z + (rand() - 0.5) * spread };
    };
  };

  // Pebbles and small stones.
  const pebble = rockGeometry(rand, { detail: 1, stretch: [1.1, 0.7, 1], cuts: 3 });
  const rockMat = rockMaterial('pebble', { color: 0x857c70 });
  scatter(pebble.geo, rockMat, 3000, () => ({ ...anywhere(), size: 0.04 + rand() * rand() * 0.22, lift: 0.1 }));

  // Broken concrete rubble and bricks.
  const rubble = clusters(30, 8);
  const rubbleMat = new THREE.MeshStandardMaterial({ ...concrete, color: 0x9a9288, roughness: 0.95 });
  scatter(new THREE.DodecahedronGeometry(1, 0), rubbleMat, 500, () => ({ ...rubble(), size: 0.08 + rand() * 0.22, lift: 0.3 }), true);
  const brickMat = new THREE.MeshStandardMaterial({ color: 0x7a4a36, roughness: 0.95 });
  scatter(new THREE.BoxGeometry(2.2, 0.7, 1), brickMat, 400, () => ({ ...rubble(), size: 0.1, flat: rand() < 0.6, lift: 0.35 }));

  // Old tyres lying flat.
  const tyre = model('tyre');
  if (tyre) scatter(tyre.geometry, tyre.material, 45, () => ({ ...anywhere(), size: 0.9 + rand() * 0.2, flat: true, lift: -0.02 }), true);
  else {
    const tyreMat = new THREE.MeshStandardMaterial({ color: 0x1f1d1b, roughness: 0.95 });
    const tyreGeo = new THREE.TorusGeometry(0.3, 0.12, 8, 18).rotateX(Math.PI / 2);
    scatter(tyreGeo, tyreMat, 45, () => ({ ...anywhere(), size: 0.9 + rand() * 0.2, flat: true, lift: 0.1 }), true);
  }

  // Fallen, bleached dead trunks.
  const log = model('log');
  if (log) scatter(log.geometry, log.material, 40, () => ({ ...anywhere(), size: 0.7 + rand() * 0.6, flat: true, lift: -0.08 }), true);

  // Weathered planks.
  const plankMat = new THREE.MeshStandardMaterial({ ...bark, color: 0x9a8a78, roughness: 0.95 });
  const planks = clusters(20, 5);
  scatter(new THREE.BoxGeometry(1.4, 0.03, 0.16), plankMat, 160, () => ({ ...planks(), size: 0.7 + rand() * 0.6, flat: true, lift: 0.02 }), true);

  // Dead shrubs: a few thin twigs splayed out from one point.
  const twigs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 9; i++) {
    const len = 0.4 + rand() * 0.5;
    const twig = new THREE.CylinderGeometry(0.006, 0.018, len, 4).translate(0, len / 2, 0);
    twig.rotateZ(0.3 + rand() * 0.7);
    twig.rotateY((i / 9) * Math.PI * 2 + rand() * 0.5);
    twigs.push(twig.toNonIndexed());
  }
  const shrubGeo = mergeSimple(twigs);
  const shrubMat = new THREE.MeshStandardMaterial({ color: 0x4e4236, roughness: 1 });
  const bushes = variants('dry-bush');
  if (bushes.length) {
    scatter(shrubGeo, shrubMat, 120, () => ({ ...anywhere(), size: 0.7 + rand() * 0.9, flat: true }), true);
    scatterSet(bushes, 160, () => ({ ...anywhere(), size: 0.7 + rand() * 0.8, flat: true }), true);
  } else scatter(shrubGeo, shrubMat, 260, () => ({ ...anywhere(), size: 0.7 + rand() * 0.9, flat: true }), true);

  // Scanned ground cover: clumps of dry grass where the grass grows, fallen branches, small
  // stones and old stumps.
  const grassy = (x: number, z: number) => Math.sin(x * 0.08) * Math.cos(z * 0.06) + Math.sin((x + z) * 0.05) > 0.3;
  scatterSet(
    variants('dry-grass'),
    1400,
    () => {
      for (let t = 0; t < 8; t++) {
        const p = anywhere();
        if (grassy(p.x, p.z) && terrainHeight(seed, p.x, p.z) > 1) return { ...p, size: 0.8 + rand() * 0.7, flat: true };
      }
      return null;
    },
    true,
  );
  const twigsAt = clusters(40, 10);
  scatterSet(variants('branches'), 140, () => ({ ...twigsAt(), size: 0.6 + rand() * 0.8, flat: true }));
  scatterSet(variants('dead-branch'), 50, () => ({ ...anywhere(), size: 0.8 + rand() * 0.8, flat: true }));
  const stonesAt = clusters(60, 6);
  scatterSet(variants('stones'), 500, () => ({ ...stonesAt(), size: 0.6 + rand() * 1.4, flat: true, lift: -0.05 }));
  scatterSet(variants('stump'), 30, () => ({ ...anywhere(), size: 0.8 + rand() * 0.5, flat: true, lift: -0.1 }));
}

function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  for (const p of parts) {
    pos.push(...p.attributes.position.array);
    nor.push(...p.attributes.normal.array);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return geo;
}

/** Rolling hills beyond the edge of the map, rising out of the haze, so the horizon has depth. */
function buildDistantHills(scene: THREE.Scene) {
  const inner = HALF_WORLD * 1.3;
  const geo = new THREE.RingGeometry(inner, 1400, 160, 24).rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const near = new THREE.Color(0x857a6b);
  const far = new THREE.Color(0x9a8d78);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const t = Math.min(1, (r - inner) / 300);
    const ridges = Math.sin(a * 5 + 1.3) * 0.5 + Math.sin(a * 13 + r * 0.01) * 0.3 + Math.sin(a * 29 + r * 0.03) * 0.15 + 0.6;
    // Rise steeply just past the map edge, so the hills show as silhouettes through the haze.
    const rise = THREE.MathUtils.smoothstep(r, inner, inner + 70);
    p.setY(i, 10 + Math.max(0, ridges) * rise * (16 + 34 * t));
    c.copy(near).lerp(far, t).multiplyScalar(0.9 + ridges * 0.1);
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })));
}
