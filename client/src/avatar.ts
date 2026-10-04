// Wasteland survivor: realistic proportions, worn layered clothing in dusty tones, a hood,
// goggles and a respirator, and a loaded backpack. Each player's colour shows only as a
// faded accent (scarf and armband) so characters belong in the world instead of glowing in it.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { clothSurface, leatherSurface } from './textures.ts';

const JACKETS = [0x6b6a4e, 0x7d6c55, 0x585b5a, 0x80705a, 0x5a6458, 0x6e5a4a];
const TROUSERS = [0x5b5649, 0x625a48, 0x4f5459, 0x6a5e4c];

const materials = new Map<string, THREE.Material>();

/** Worn cloth tinted to `color`. Cached, since every survivor shares most of these. */
function cloth(color: number, roughness = 0.95): THREE.MeshStandardMaterial {
  const key = `cloth-${color}-${roughness}`;
  let m = materials.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    const s = clothSurface();
    m = new THREE.MeshStandardMaterial({ color, map: s.map, normalMap: s.normalMap, roughness, metalness: 0 });
    m.normalScale.set(0.7, 0.7);
    materials.set(key, m);
  }
  return m;
}

function leather(color: number): THREE.MeshStandardMaterial {
  const key = `leather-${color}`;
  let m = materials.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    const s = leatherSurface();
    m = new THREE.MeshStandardMaterial({ color, map: s.map, normalMap: s.normalMap, roughness: 0.72, metalness: 0 });
    materials.set(key, m);
  }
  return m;
}

function plain(color: number, roughness: number, metalness = 0): THREE.MeshStandardMaterial {
  const key = `plain-${color}-${roughness}-${metalness}`;
  let m = materials.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    materials.set(key, m);
  }
  return m;
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** Torso shape (radius by height, from the jacket hem to the collar), turned on a lathe. */
const TORSO_PROFILE = [
  [0.0, -0.1],
  [0.165, -0.1],
  [0.17, 0.0],
  [0.178, 0.12],
  [0.192, 0.26],
  [0.2, 0.38],
  [0.19, 0.45],
  [0.15, 0.5],
  [0.085, 0.54],
  [0.0, 0.55],
].map(([r, y]) => new THREE.Vector2(r, y));

export class Avatar {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private hipL: THREE.Object3D;
  private hipR: THREE.Object3D;
  private kneeL: THREE.Object3D;
  private kneeR: THREE.Object3D;
  private shoulderL: THREE.Object3D;
  private shoulderR: THREE.Object3D;
  private elbowL: THREE.Object3D;
  private elbowR: THREE.Object3D;
  private phase = 0;
  private walk = 0;
  private run = 0;
  private speed = 0;
  private time = Math.random() * 10;
  private swingTimer = 0;
  private last = new THREE.Vector3(NaN, 0, 0);

  constructor(color: number, name?: string) {
    // Each survivor gets a different but always muted outfit, picked from their colour.
    const pick = (list: number[], salt: number) => list[Math.abs(Math.imul((color >> salt) ^ color, 2654435761)) % list.length];
    const jacket = cloth(pick(JACKETS, 3));
    const trousers = cloth(pick(TROUSERS, 7));
    const accent = cloth(color, 0.9);
    const hood = cloth(pick(JACKETS, 11)).clone();
    hood.side = THREE.DoubleSide;
    const darkLeather = leather(0x5a4634);
    const brownLeather = leather(0x6a5038);
    const canvas = cloth(0x6a6150);
    const bedroll = cloth(0x5b6450);
    const metal = plain(0x55524a, 0.45, 0.7);
    const rubber = plain(0x2a2927, 0.8);
    const glass = plain(0x1a2326, 0.12, 0.4);
    const skin = plain(0xa47a5f, 0.75);
    const wood = plain(0x6b5136, 0.85);

    this.root.add(this.body);
    const body = this.body;

    // Hips, belt and pouches.
    const hips = new THREE.Group();
    hips.position.y = 0.95;
    body.add(hips);
    const pelvis = mesh(new THREE.SphereGeometry(0.16, 20, 12), trousers);
    pelvis.scale.set(1, 0.62, 0.74);
    hips.add(pelvis);
    const belt = mesh(new THREE.TorusGeometry(0.158, 0.024, 6, 28), darkLeather, 0, 0.05, 0);
    belt.rotation.x = Math.PI / 2;
    belt.scale.set(1, 0.76, 1);
    hips.add(belt);
    hips.add(mesh(new RoundedBoxGeometry(0.05, 0.04, 0.02, 2, 0.006), metal, 0, 0.05, 0.123));
    for (const [x, z, ry] of [
      [0.14, 0.05, 1.2],
      [-0.12, -0.08, -2.2],
      [0.06, -0.12, 2.8],
    ]) {
      const pouch = mesh(new RoundedBoxGeometry(0.1, 0.09, 0.05, 2, 0.015), brownLeather, x, 0.02, z);
      pouch.rotation.y = ry;
      hips.add(pouch);
    }

    // Legs: hip and knee joints, cargo pockets, laced boots.
    const leg = (side: number): [THREE.Object3D, THREE.Object3D] => {
      const hip = new THREE.Group();
      hip.position.set(side * 0.092, 0.93, 0);
      body.add(hip);
      hip.add(mesh(new THREE.CapsuleGeometry(0.078, 0.3, 6, 14), trousers, 0, -0.21, 0));
      hip.add(mesh(new RoundedBoxGeometry(0.05, 0.12, 0.11, 2, 0.015), trousers, side * 0.072, -0.25, 0));
      const knee = new THREE.Group();
      knee.position.y = -0.44;
      hip.add(knee);
      knee.add(mesh(new THREE.CapsuleGeometry(0.064, 0.28, 6, 14), trousers, 0, -0.19, 0));
      knee.add(mesh(new THREE.SphereGeometry(0.058, 12, 8), darkLeather, 0, -0.02, 0.035));
      knee.add(mesh(new THREE.CylinderGeometry(0.072, 0.068, 0.1, 14), darkLeather, 0, -0.36, 0));
      knee.add(mesh(new RoundedBoxGeometry(0.125, 0.12, 0.27, 3, 0.04), darkLeather, 0, -0.425, 0.045));
      knee.add(mesh(new RoundedBoxGeometry(0.13, 0.028, 0.28, 2, 0.01), rubber, 0, -0.48, 0.045));
      return [hip, knee];
    };
    [this.hipL, this.kneeL] = leg(-1);
    [this.hipR, this.kneeR] = leg(1);

    // Torso: jacket, chest pockets, scarf, backpack straps.
    const torso = this.torso;
    torso.position.y = 0.95;
    body.add(torso);
    const coat = mesh(new THREE.LatheGeometry(TORSO_PROFILE, 28), jacket);
    coat.scale.set(1, 1, 0.7);
    torso.add(coat);
    for (const x of [-0.085, 0.085]) {
      const pocket = mesh(new RoundedBoxGeometry(0.1, 0.09, 0.03, 2, 0.01), jacket, x, 0.3, 0.128);
      pocket.rotation.x = -0.12;
      torso.add(pocket);
    }
    torso.add(mesh(new THREE.BoxGeometry(0.014, 0.5, 0.01), darkLeather, 0, 0.18, 0.13));
    for (const x of [-0.11, 0.11]) {
      const strap = mesh(new THREE.BoxGeometry(0.045, 0.42, 0.016), brownLeather, x, 0.27, 0.125);
      strap.rotation.x = -0.18;
      torso.add(strap);
      torso.add(mesh(new THREE.BoxGeometry(0.045, 0.016, 0.3), brownLeather, x, 0.49, -0.04));
    }
    const scarf = mesh(new THREE.TorusGeometry(0.095, 0.045, 10, 20), accent, 0, 0.53, 0.01);
    scarf.rotation.x = Math.PI / 2 - 0.15;
    torso.add(scarf);
    const tail = mesh(new RoundedBoxGeometry(0.07, 0.2, 0.025, 2, 0.01), accent, 0.06, 0.42, 0.13);
    tail.rotation.set(-0.25, 0, 0.12);
    torso.add(tail);
    torso.add(mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 12), skin, 0, 0.58, 0));

    // Backpack with a rolled bedroll and a canteen.
    const pack = new THREE.Group();
    pack.position.set(0, 0.27, -0.2);
    torso.add(pack);
    pack.add(mesh(new RoundedBoxGeometry(0.32, 0.4, 0.17, 3, 0.045), canvas));
    pack.add(mesh(new RoundedBoxGeometry(0.34, 0.1, 0.19, 2, 0.03), canvas, 0, 0.17, 0.005));
    pack.add(mesh(new RoundedBoxGeometry(0.22, 0.14, 0.05, 2, 0.015), canvas, 0, -0.06, -0.1));
    const roll = mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 16), bedroll, 0, 0.27, 0);
    roll.rotation.z = Math.PI / 2;
    pack.add(roll);
    for (const x of [-0.12, 0.12]) {
      const tie = mesh(new THREE.CylinderGeometry(0.079, 0.079, 0.025, 16), darkLeather, x, 0.27, 0);
      tie.rotation.z = Math.PI / 2;
      pack.add(tie);
    }
    pack.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 14), plain(0x4f5a44, 0.6, 0.3), 0.2, -0.06, 0.01));

    // Head: hood, goggles and respirator, so the face reads as a gritty survivor.
    const head = this.head;
    head.position.y = 0.6;
    torso.add(head);
    const skull = mesh(new THREE.SphereGeometry(0.105, 20, 16), skin, 0, 0.1, 0);
    skull.scale.set(0.92, 1.1, 1);
    head.add(skull);
    const hoodMesh = mesh(new THREE.SphereGeometry(0.13, 24, 16, Math.PI / 2 + 0.72, Math.PI * 2 - 1.44, 0, Math.PI * 0.78), hood, 0, 0.11, -0.008);
    hoodMesh.scale.set(1, 1.08, 1.06);
    head.add(hoodMesh);
    const strap = mesh(new THREE.TorusGeometry(0.104, 0.011, 6, 24), darkLeather, 0, 0.125, 0);
    strap.rotation.x = Math.PI / 2;
    head.add(strap);
    for (const x of [-0.042, 0.042]) {
      const rim = mesh(new THREE.CylinderGeometry(0.031, 0.034, 0.035, 16), metal, x, 0.128, 0.09);
      rim.rotation.x = Math.PI / 2;
      head.add(rim);
      const lens = mesh(new THREE.CircleGeometry(0.026, 16), glass, x, 0.128, 0.108);
      head.add(lens);
    }
    const mask = mesh(new THREE.SphereGeometry(0.068, 16, 12), rubber, 0, 0.05, 0.068);
    mask.scale.set(1.15, 0.85, 0.95);
    head.add(mask);
    for (const x of [-0.055, 0.055]) {
      const filter = mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.045, 14), metal, x, 0.035, 0.115);
      filter.rotation.set(Math.PI / 2, x * 10, 0, 'YXZ');
      head.add(filter);
    }

    // Arms: shoulder and elbow joints, gloves, and a faded armband in the player's colour.
    const arm = (side: number): [THREE.Object3D, THREE.Object3D] => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.235, 0.45, 0);
      torso.add(shoulder);
      shoulder.add(mesh(new THREE.SphereGeometry(0.072, 14, 10), jacket));
      shoulder.add(mesh(new THREE.CapsuleGeometry(0.06, 0.2, 6, 12), jacket, 0, -0.14, 0));
      if (side < 0) shoulder.add(mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.05, 14), accent, 0, -0.15, 0));
      const elbow = new THREE.Group();
      elbow.position.y = -0.28;
      shoulder.add(elbow);
      elbow.add(mesh(new THREE.CapsuleGeometry(0.052, 0.17, 6, 12), jacket, 0, -0.11, 0));
      elbow.add(mesh(new THREE.CylinderGeometry(0.056, 0.05, 0.05, 12), darkLeather, 0, -0.21, 0));
      elbow.add(mesh(new RoundedBoxGeometry(0.06, 0.1, 0.075, 2, 0.02), darkLeather, 0, -0.28, 0.005));
      return [shoulder, elbow];
    };
    [this.shoulderL, this.elbowL] = arm(-1);
    [this.shoulderR, this.elbowR] = arm(1);

    // A crude hatchet in the right hand, for chopping and hammering.
    const hatchet = new THREE.Group();
    hatchet.position.set(0, -0.29, 0.03);
    hatchet.rotation.x = Math.PI / 2 - 0.2;
    this.elbowR.add(hatchet);
    hatchet.add(mesh(new THREE.CylinderGeometry(0.016, 0.019, 0.42, 8), wood, 0, 0.08, 0));
    hatchet.add(mesh(new RoundedBoxGeometry(0.02, 0.07, 0.11, 1, 0.006), metal, 0, 0.26, 0.045));

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });

    if (name) {
      const tag = nameTag(name, color);
      tag.position.y = 2.1;
      this.root.add(tag);
    }
  }

  /** Plays a chopping swing, used when gathering or building. */
  swing() {
    this.swingTimer = 0.35;
  }

  update(dt: number, moving: boolean) {
    dt = Math.min(dt, 0.1);
    this.time += dt;

    // Speed comes from how far the avatar actually moved, so remote players animate
    // correctly too and a sprint reads differently from a walk.
    const p = this.root.position;
    if (!Number.isNaN(this.last.x) && dt > 0) {
      const v = Math.hypot(p.x - this.last.x, p.z - this.last.z) / dt;
      this.speed += (Math.min(v, 12) - this.speed) * Math.min(1, dt * 8);
    }
    this.last.copy(p);
    const speed = moving ? Math.max(this.speed, 3) : this.speed;
    const walkTarget = moving || speed > 1 ? 1 : 0;
    this.walk += (walkTarget - this.walk) * Math.min(1, dt * 8);
    const runTarget = THREE.MathUtils.clamp((speed - 6.5) / 2.5, 0, 1);
    this.run += (runTarget - this.run) * Math.min(1, dt * 6);
    this.phase += dt * (2.2 + speed * 1.15) * (walkTarget || this.walk);

    const w = this.walk;
    const r = this.run;
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const stride = (0.5 + 0.3 * r) * w;

    // Legs: thighs swing, knees bend as each foot comes forward.
    this.hipL.rotation.x = -s * stride;
    this.hipR.rotation.x = s * stride;
    this.kneeL.rotation.x = w * (0.08 + Math.max(0, c) * (0.75 + 0.6 * r));
    this.kneeR.rotation.x = w * (0.08 + Math.max(0, -c) * (0.75 + 0.6 * r));

    // Arms counter-swing with bent elbows; idle arms hang loosely and sway with breathing.
    const breathe = Math.sin(this.time * 1.8);
    const armSwing = (0.45 + 0.35 * r) * w;
    this.shoulderL.rotation.set(s * armSwing, 0, -0.1 - breathe * 0.01);
    this.shoulderR.rotation.set(-s * armSwing, 0, 0.1 + breathe * 0.01);
    this.elbowL.rotation.x = -(0.2 + 0.25 * w + 0.9 * r);
    this.elbowR.rotation.x = -(0.35 + 0.2 * w + 0.9 * r);

    // Body: bob each step, lean forward when running, slight hip twist, idle breathing.
    this.body.position.y = Math.abs(c) * (0.035 + 0.03 * r) * w - 0.02 * w;
    const lean = 0.05 * w + 0.2 * r;
    this.torso.rotation.set(lean, s * 0.1 * w, 0);
    this.torso.scale.y = 1 + breathe * 0.008 * (1 - w);
    this.head.rotation.set(-lean * 0.7, Math.sin(this.time * 0.4) * 0.15 * (1 - w), 0);

    if (this.swingTimer > 0) {
      this.swingTimer = Math.max(0, this.swingTimer - dt);
      const t = 1 - this.swingTimer / 0.35;
      // Wind up over the head, then chop down and forward.
      const lift = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
      this.shoulderR.rotation.x = -2.6 * lift - 0.4 * (1 - lift) * Math.sin(t * Math.PI);
      this.elbowR.rotation.x = -0.9 * lift - 0.3;
      this.torso.rotation.y += -0.25 * Math.sin(t * Math.PI);
    }
  }
}

function nameTag(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 28px system-ui, sans-serif';
  const w = Math.min(ctx.measureText(text).width + 34, 256);
  ctx.fillStyle = 'rgba(20,18,15,0.6)';
  ctx.beginPath();
  ctx.roundRect((256 - w) / 2, 12, w, 40, 8);
  ctx.fill();
  // A thin stripe in the player's colour, so names stay easy to tell apart.
  ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillRect((256 - w) / 2 + 8, 46, w - 16, 3);
  ctx.fillStyle = '#ece4d6';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 31);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthWrite: false }));
  sprite.scale.set(1.4, 0.35, 1);
  return sprite;
}
