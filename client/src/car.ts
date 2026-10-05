// Rusted-out old cars for the scrap piles: a rounded body with wheel arches, a cabin of
// pillars and roof, doors with panel gaps and handles (some hanging open or missing),
// cracked, shattered or missing windows, seats and a steering wheel inside, chrome grille,
// headlights and bumpers, flat or missing tyres, and ash settled on the top surfaces.
// Each wreck is randomised, then merged into a handful of meshes so dozens stay cheap to draw.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { carPaintSurface, crackedGlassTexture, rustSurface } from './textures.ts';

const PAINTS = ['#6f8a86', '#8a7a5a', '#7a5a50', '#5f6b5a', '#8c8a80', '#5a6a7a'];

type V3 = [number, number, number];

const cache = new Map<string, THREE.Material>();
function material(key: string, make: () => THREE.Material): THREE.Material {
  let m = cache.get(key);
  if (!m) cache.set(key, (m = make()));
  return m;
}

function paintMaterial(paint: string) {
  return material(`paint-${paint}`, () => {
    const s = carPaintSurface(paint);
    return new THREE.MeshStandardMaterial({ ...s, vertexColors: true, roughness: 0.78, metalness: 0.3 });
  });
}
const chrome = () =>
  material('chrome', () => new THREE.MeshStandardMaterial({ ...rustSurface('#8e8b84'), roughness: 0.42, metalness: 0.85 }));
const plain = (color: number, roughness = 0.95, metalness = 0) =>
  material(`plain-${color}-${roughness}-${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));
const glass = () =>
  material(
    'glass',
    () =>
      new THREE.MeshStandardMaterial({
        map: crackedGlassTexture(),
        color: 0xa8b0a4,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        roughness: 0.15,
        metalness: 0.3,
      }),
  );

/** Darkens the lower body towards rust and lightens upward-facing surfaces with settled ash. */
function weather(geo: THREE.BufferGeometry, rand: () => number) {
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const rust = new THREE.Color(0.62, 0.42, 0.3);
  const ash = new THREE.Color(1.45, 1.38, 1.25);
  const jitter = 0.9 + rand() * 0.15;
  for (let i = 0; i < pos.count; i++) {
    c.setRGB(jitter, jitter, jitter);
    const y = pos.getY(i);
    if (y < 0.6) c.lerp(rust, Math.min(1, (0.6 - y) / 0.35) * 0.8);
    const up = nor.getY(i);
    if (up > 0.5) c.lerp(ash, (up - 0.5) * 1.6);
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** A quad between four corners (counter-clockwise from bottom-left), with 0..1 texture coordinates. */
function quad(corners: THREE.Vector3[], uvs: [number, number][]): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setFromPoints(corners);
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
  geo.setIndex(corners.length === 4 ? [0, 1, 2, 0, 2, 3] : [...Array(corners.length - 2)].flatMap((_, i) => [0, i + 1, i + 2]));
  geo.computeVertexNormals();
  return geo;
}

export function buildCar(rand: () => number): THREE.Group {
  const car = new THREE.Group();
  const paint = paintMaterial(PAINTS[Math.floor(rand() * PAINTS.length)]);
  const interior = plain(0x2b2520);
  const hole = plain(0x0f0c0a);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, parent: THREE.Object3D = car) => {
    const m = new THREE.Mesh(geo, mat);
    parent.add(m);
    return m;
  };
  const box = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, r = 0) => {
    const m = add(r > 0 ? new RoundedBoxGeometry(w, h, d, 2, r) : new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  };
  /** A bar of the given thickness from a to b, for window pillars. */
  const beam = (a: V3, b: V3, t: number, mat: THREE.Material) => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const len = va.distanceTo(vb);
    const m = box(t, len + t * 0.6, t, mat, 0, 0, 0, t * 0.3);
    m.position.copy(va).lerp(vb, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.sub(va).normalize());
    return m;
  };

  // Body: a side profile with round wheel arches, extruded across the car's width.
  const shape = new THREE.Shape();
  shape.moveTo(-2.32, 0.36);
  shape.lineTo(-1.95, 0.3);
  shape.absarc(-1.45, 0.3, 0.47, Math.PI, 0, true);
  shape.lineTo(0.98, 0.3);
  shape.absarc(1.45, 0.3, 0.47, Math.PI, 0, true);
  shape.lineTo(2.3, 0.34);
  shape.quadraticCurveTo(2.4, 0.62, 2.3, 0.84);
  shape.quadraticCurveTo(1.6, 0.94, 0.75, 0.98);
  shape.lineTo(-1.5, 0.97);
  shape.quadraticCurveTo(-2.2, 0.95, -2.3, 0.88);
  shape.quadraticCurveTo(-2.4, 0.62, -2.32, 0.36);
  const hullGeo = new THREE.ExtrudeGeometry(shape, {
    depth: 1.64,
    bevelEnabled: true,
    bevelSize: 0.08,
    bevelThickness: 0.08,
    bevelSegments: 3,
    curveSegments: 14,
  });
  hullGeo.translate(0, 0, -0.82);
  add(hullGeo, paint);
  const side = 0.905; // outer face of the body sides

  // Cabin: pillars, a sagging roof and the cabin floor seen through the windows.
  const z = 0.8;
  for (const s of [-1, 1]) {
    beam([0.72, 0.98, s * z], [0.16, 1.47, s * z], 0.07, paint);
    beam([-0.25, 0.98, s * z], [-0.25, 1.47, s * z], 0.08, paint);
    beam([-1.0, 1.47, s * z], [-1.5, 0.97, s * z], 0.09, paint);
  }
  const roof = box(1.28, 0.07, 1.72, paint, -0.42, 1.49, 0, 0.03);
  roof.rotation.set((rand() - 0.5) * 0.06, 0, (rand() - 0.5) * 0.05);
  roof.position.y -= rand() * 0.04;
  box(2.3, 0.012, 1.62, interior, -0.4, 0.99, 0);

  // Seats, dashboard and steering wheel.
  const seat = (x: number) => {
    const back = box(0.16, 0.42, 1.5, interior, x, 1.17, 0, 0.05);
    back.rotation.z = 0.18;
    box(0.5, 0.1, 1.5, interior, x + 0.25, 1.0, 0, 0.04);
  };
  seat(-0.1);
  seat(-1.15);
  box(0.3, 0.12, 1.6, interior, 0.62, 1.05, 0, 0.03);
  const wheel = add(new THREE.TorusGeometry(0.17, 0.022, 6, 18), plain(0x1d1a17, 0.7));
  wheel.position.set(0.38, 1.18, 0.38);
  wheel.rotation.set(0, Math.PI / 2, 0.45, 'ZYX');

  // Windows: each one is cracked, shattered to a few jagged shards, or gone.
  const pane = (bl: V3, br: V3, tr: V3, tl: V3) => {
    const state = rand();
    if (state > 0.68) return;
    const at = (u: number, v: number) => {
      const b = new THREE.Vector3(...bl).lerp(new THREE.Vector3(...br), u);
      const t = new THREE.Vector3(...tl).lerp(new THREE.Vector3(...tr), u);
      return b.lerp(t, v);
    };
    if (state < 0.3) {
      add(quad([at(0, 0), at(1, 0), at(1, 1), at(0, 1)], [[0, 0], [1, 0], [1, 1], [0, 1]]), glass());
      return;
    }
    // Shards left standing along the bottom of the frame.
    const steps = 5 + Math.floor(rand() * 4);
    const pts: THREE.Vector3[] = [];
    const uvs: [number, number][] = [];
    const index: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const v = i === 0 || i === steps ? rand() * 0.5 : rand() < 0.4 ? 0.02 : 0.1 + rand() * 0.45;
      pts.push(at(u, 0), at(u, v));
      uvs.push([u, 0], [u, v]);
      if (i > 0) {
        const k = i * 2;
        index.push(k - 2, k, k + 1, k - 2, k + 1, k - 1);
      }
    }
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs.flat(), 2));
    geo.setIndex(index);
    geo.computeVertexNormals();
    add(geo, glass());
  };
  pane([0.72, 0.99, -z], [0.72, 0.99, z], [0.17, 1.46, z], [0.17, 1.46, -z]);
  pane([-1.5, 0.98, z], [-1.5, 0.98, -z], [-1.0, 1.46, -z], [-1.0, 1.46, z]);
  for (const s of [-1, 1]) {
    const w = s * 0.84;
    pane([-0.22, 0.99, w], [0.69, 0.99, w], [0.17, 1.44, w], [-0.22, 1.44, w]);
    pane([-1.47, 0.99, w], [-0.29, 0.99, w], [-0.29, 1.44, w], [-0.98, 1.44, w]);
  }

  // Doors: panel gaps, chrome handles and trim; some hang open or have fallen off.
  for (const s of [-1, 1]) {
    const face = s * (side + 0.004);
    for (const x of [0.72, -0.25, -1.0]) box(0.014, 0.6, 0.008, hole, x, 0.69, face);
    box(1.72, 0.014, 0.008, hole, -0.14, 0.39, face);
    box(4.5, 0.035, 0.02, chrome(), 0, 0.76, s * (side + 0.01));
    for (const [x0, x1] of [
      [-0.25, 0.72],
      [-1.0, -0.25],
    ]) {
      const r = rand();
      const width = x1 - x0;
      if (r < 0.25) {
        // Open or missing: show the dark doorway, and maybe the door swung out on its hinges.
        box(width - 0.03, 0.56, 0.02, hole, (x0 + x1) / 2, 0.69, s * (side - 0.004));
        if (r < 0.16) {
          const hinge = new THREE.Group();
          hinge.position.set(x1, 0, s * (side + 0.02));
          hinge.rotation.y = s * (0.5 + rand() * 0.7);
          car.add(hinge);
          const door = add(new RoundedBoxGeometry(width - 0.02, 0.58, 0.06, 2, 0.02), paint, hinge);
          door.position.set(-width / 2, 0.69, 0);
          const handle = add(new THREE.BoxGeometry(0.12, 0.025, 0.03), chrome(), hinge);
          handle.position.set(-width + 0.16, 0.9, s * 0.04);
        }
      } else {
        box(0.12, 0.025, 0.03, chrome(), x0 + 0.14, 0.9, s * (side + 0.012));
      }
    }
    const mirror = box(0.05, 0.08, 0.12, chrome(), 0.62, 1.05, s * (side + 0.07), 0.015);
    mirror.visible = s > 0 || rand() < 0.5;
  }

  // Front: grille with chrome bars, round headlights (some smashed), bumper.
  box(0.05, 0.24, 1.1, hole, 2.39, 0.62, 0);
  for (let i = 0; i < 5; i++) box(0.03, 0.022, 1.12, chrome(), 2.42, 0.52 + i * 0.05, 0);
  for (const s of [-1, 1]) {
    const rim = add(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 16).rotateZ(Math.PI / 2), chrome());
    rim.position.set(2.37, 0.72, s * 0.66);
    const lens = add(new THREE.CircleGeometry(0.095, 16).rotateY(Math.PI / 2), rand() < 0.5 ? hole : plain(0xb8b4a4, 0.2, 0.2));
    lens.position.set(2.405, 0.72, s * 0.66);
  }
  const bumper = (x: number, y: number) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0.98);
    car.add(pivot);
    const bar = add(new RoundedBoxGeometry(0.12, 0.13, 1.96, 2, 0.04), chrome(), pivot);
    bar.position.z = -0.98;
    // Sometimes it has come loose at one end and droops to the ground.
    if (rand() < 0.3) pivot.rotation.x = -(0.15 + rand() * 0.12);
  };
  bumper(2.46, 0.42);
  bumper(-2.44, 0.44);

  // Back: tail lights, number plate.
  for (const s of [-1, 1]) box(0.04, 0.16, 0.14, plain(0x5a1c16, 0.4), -2.39, 0.74, s * 0.7);
  box(0.02, 0.13, 0.32, plain(0x8a7a42, 0.8, 0.2), -2.4, 0.6, 0);

  // Bonnet, sometimes popped open over a dark engine bay.
  if (rand() < 0.35) {
    box(1.2, 0.12, 1.4, hole, 1.5, 0.88, 0);
    const hinge = new THREE.Group();
    hinge.position.set(0.8, 0.985, 0);
    hinge.rotation.z = -0.07 + 0.12 + rand() * 0.2;
    car.add(hinge);
    const lid = add(new RoundedBoxGeometry(1.45, 0.04, 1.62, 2, 0.015), paint, hinge);
    lid.position.set(0.72, 0.02, 0);
  } else {
    box(0.012, 0.006, 1.5, hole, 0.8, 0.983, 0);
  }

  // Wheels: flat tyres on rusty steel rims; a missing wheel drops that corner onto its hub.
  let tiltX = 0;
  let tiltZ = 0;
  for (const wx of [-1.45, 1.45]) {
    for (const s of [-1, 1]) {
      if (rand() < 0.2) {
        box(0.2, 0.2, 0.16, plain(0x3a2a20, 0.8, 0.5), wx, 0.22, s * 0.78, 0.04);
        tiltZ += wx > 0 ? -0.035 : 0.035;
        tiltX += s * 0.04;
        continue;
      }
      const tyre = add(new THREE.TorusGeometry(0.26, 0.115, 10, 22), plain(0x1e1c1a));
      tyre.position.set(wx, 0.29, s * 0.78);
      tyre.scale.set(1, 0.82, 1.4);
      const rimMesh = add(new THREE.CylinderGeometry(0.19, 0.19, 0.17, 18).rotateX(Math.PI / 2), plain(0x5a3a26, 0.7, 0.6));
      rimMesh.position.copy(tyre.position);
      if (rand() < 0.5) {
        const cap = add(new THREE.CylinderGeometry(0.15, 0.17, 0.03, 18).rotateX(Math.PI / 2), chrome());
        cap.position.set(wx, 0.29, s * 0.875);
      }
    }
  }

  // A bent radio aerial.
  const aerial = box(0.012, 0.8, 0.012, chrome(), 1.7, 1.3, 0.7);
  aerial.rotation.set(0.2, 0, -0.25 - rand() * 0.4);

  const merged = mergeByMaterial(car, rand);
  merged.rotation.set(tiltX, 0, tiltZ);
  merged.position.y = tiltX || tiltZ ? -0.06 : 0;
  const g = new THREE.Group();
  g.add(merged);
  g.scale.setScalar(0.85);
  return g;
}

/** Bakes every part's transform into its geometry and merges parts that share a material. */
function mergeByMaterial(root: THREE.Group, rand: () => number): THREE.Group {
  root.updateMatrixWorld(true);
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const mat = mesh.material as THREE.Material;
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld);
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    geo.morphAttributes = {};
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    if (!geo.attributes.normal) geo.computeVertexNormals();
    // Painted panels get their weathering from where they ended up on the car.
    if ((mat as THREE.MeshStandardMaterial).vertexColors) weather(geo, rand);
    (groups.get(mat) ?? groups.set(mat, []).get(mat)!).push(geo);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of groups) {
    const geo = mergeGeometries(geos);
    if (geo) out.add(new THREE.Mesh(geo, mat));
  }
  return out;
}
