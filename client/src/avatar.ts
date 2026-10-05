// Wasteland survivor: one smooth, continuous body (see survivorMesh.ts) in worn clothing of
// dusty tones, with a hood, goggles, a respirator, a loaded backpack and a hatchet attached to
// its bones. Each player's colour shows only as a faded accent (scarf and armband) so
// characters belong in the world instead of glowing in it.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ARM_REST, BONES, type BoneName, HAND, Region, survivorGeometry } from './survivorMesh.ts';
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

/** The body's material: one cloth texture, tinted per region by vertex colours. */
let bodyMaterial: THREE.MeshStandardMaterial | null = null;
function bodyMat(): THREE.MeshStandardMaterial {
  if (!bodyMaterial) {
    const s = clothSurface();
    bodyMaterial = new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normalMap, vertexColors: true, roughness: 0.92 });
    bodyMaterial.normalScale.set(0.6, 0.6);
  }
  return bodyMaterial;
}

export class Avatar {
  readonly root = new THREE.Group();
  private bones = {} as Record<BoneName, THREE.Bone>;
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
    const jacketColor = pick(JACKETS, 3);
    const accent = cloth(color, 0.9);
    const hood = cloth(new THREE.Color(jacketColor).multiplyScalar(0.7).getHex()).clone();
    hood.side = THREE.DoubleSide;
    const darkLeather = leather(0x5a4634);
    const brownLeather = leather(0x6a5038);
    const canvas = cloth(0x6a6150);
    const bedroll = cloth(0x5b6450);
    const metal = plain(0x55524a, 0.45, 0.7);
    const rubber = plain(0x2a2927, 0.8);
    const glass = plain(0x1a2326, 0.12, 0.4);
    const wood = plain(0x6b5136, 0.85);

    // Skeleton, in the same pose the body mesh was modelled in.
    const world = new Map<BoneName, THREE.Vector3>();
    for (const [boneName, parent, pos] of BONES) {
      const bone = new THREE.Bone();
      bone.name = boneName;
      world.set(boneName, new THREE.Vector3(...pos));
      bone.position.set(...pos);
      if (parent) {
        bone.position.sub(world.get(parent)!);
        this.bones[parent].add(bone);
      }
      this.bones[boneName] = bone;
    }

    // The body: shared shape, with this survivor's clothing colours.
    const shared = survivorGeometry();
    const geometry = new THREE.BufferGeometry();
    for (const key of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) geometry.setAttribute(key, shared.geometry.getAttribute(key));
    geometry.setIndex(shared.geometry.index);
    geometry.boundingSphere = shared.geometry.boundingSphere;
    const palette: Record<number, THREE.Color> = {
      [Region.Jacket]: new THREE.Color(jacketColor),
      [Region.Trousers]: new THREE.Color(pick(TROUSERS, 7)),
      [Region.Boots]: new THREE.Color(0x4f3e2f),
      [Region.Gloves]: new THREE.Color(0x3e342b),
      [Region.Skin]: new THREE.Color(0x9c735a),
      [Region.Belt]: new THREE.Color(0x3d3026),
    };
    const colors = new Float32Array(shared.regions.length * 3);
    shared.regions.forEach((r, i) => palette[r].toArray(colors, i * 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const body = new THREE.SkinnedMesh(geometry, bodyMat());
    body.add(this.bones.root);
    body.updateMatrixWorld(true);
    body.bind(new THREE.Skeleton(BONES.map(([n]) => this.bones[n])));
    this.root.add(body);

    // Gear is placed in the modelled pose's coordinates, then hung on the nearest bone.
    const attach = (boneName: BoneName, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z).sub(world.get(boneName)!);
      this.bones[boneName].add(m);
      return m;
    };
    const box = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 2, r);

    // Belt buckle and pouches.
    attach('pelvis', box(0.05, 0.04, 0.02, 0.006), metal, 0, 0.95, 0.122);
    for (const [x, z, ry] of [
      [0.158, 0.055, 1.2],
      [-0.14, -0.09, -2.2],
      [0.07, -0.13, 2.8],
    ]) {
      attach('pelvis', box(0.1, 0.09, 0.05, 0.015), brownLeather, x, 0.94, z).rotation.y = ry;
    }
    // Cargo pockets and boot soles.
    for (const [side, s] of [
      [-1, 'L'],
      [1, 'R'],
    ] as const) {
      attach(`hip${s}`, box(0.045, 0.12, 0.1, 0.015), cloth(pick(TROUSERS, 7)), side * 0.158, 0.67, 0);
      attach(`knee${s}`, box(0.125, 0.026, 0.27, 0.01), rubber, side * 0.092, 0.012, 0.04);
    }

    // Chest: pockets, backpack straps and the scarf.
    for (const x of [-0.075, 0.075]) attach('torso', box(0.09, 0.08, 0.03, 0.01), cloth(jacketColor), x, 1.25, 0.113).rotation.x = -0.1;
    for (const x of [-0.1, 0.1]) {
      attach('torso', new THREE.BoxGeometry(0.045, 0.34, 0.016), brownLeather, x, 1.22, 0.1).rotation.x = -0.12;
      attach('torso', new THREE.BoxGeometry(0.045, 0.016, 0.26), brownLeather, x, 1.455, -0.04);
    }
    const scarf = attach('torso', new THREE.TorusGeometry(0.08, 0.042, 10, 22), accent, 0, 1.47, 0.012);
    scarf.rotation.x = Math.PI / 2 - 0.15;
    attach('torso', box(0.07, 0.18, 0.025, 0.01), accent, 0.05, 1.37, 0.1).rotation.set(-0.3, 0, 0.12);

    // Backpack with a rolled bedroll and a canteen.
    attach('torso', box(0.32, 0.4, 0.17, 0.045), canvas, 0, 1.24, -0.2);
    attach('torso', box(0.34, 0.1, 0.19, 0.03), canvas, 0, 1.41, -0.195);
    attach('torso', box(0.22, 0.14, 0.05, 0.015), canvas, 0, 1.18, -0.3);
    attach('torso', new THREE.CylinderGeometry(0.075, 0.075, 0.42, 16), bedroll, 0, 1.51, -0.2).rotation.z = Math.PI / 2;
    for (const x of [-0.12, 0.12]) attach('torso', new THREE.CylinderGeometry(0.079, 0.079, 0.025, 16), darkLeather, x, 1.51, -0.2).rotation.z = Math.PI / 2;
    attach('torso', new THREE.CylinderGeometry(0.045, 0.045, 0.16, 14), plain(0x4f5a44, 0.6, 0.3), 0.2, 1.18, -0.19);

    // Armband in the player's colour, around the left upper arm.
    const band = attach('shoulderL', new THREE.CylinderGeometry(0.066, 0.064, 0.05, 16), accent, ...HAND(-1));
    band.position.copy(new THREE.Vector3(...HAND(-1)).sub(world.get('shoulderL')!).multiplyScalar(0.27));
    band.rotation.z = -ARM_REST;

    // Head: hood, goggles and respirator, so the face reads as a gritty survivor.
    const hoodMesh = attach('head', new THREE.SphereGeometry(0.13, 24, 16, Math.PI / 2 + 0.72, Math.PI * 2 - 1.44, 0, Math.PI * 0.78), hood, 0, 1.705, -0.012);
    hoodMesh.scale.set(1.06, 1.1, 1.14);
    const strap = attach('head', new THREE.TorusGeometry(0.094, 0.011, 6, 24), darkLeather, 0, 1.718, 0.005);
    strap.rotation.x = Math.PI / 2;
    strap.scale.set(1, 1.1, 1);
    for (const x of [-0.042, 0.042]) {
      attach('head', new THREE.CylinderGeometry(0.031, 0.034, 0.035, 16), metal, x, 1.718, 0.095).rotation.x = Math.PI / 2;
      attach('head', new THREE.CircleGeometry(0.026, 16), glass, x, 1.718, 0.113);
    }
    attach('head', new THREE.SphereGeometry(0.068, 16, 12), rubber, 0, 1.63, 0.073).scale.set(1.15, 0.85, 0.95);
    for (const x of [-0.055, 0.055]) {
      attach('head', new THREE.CylinderGeometry(0.032, 0.032, 0.045, 14), metal, x, 1.615, 0.12).rotation.set(Math.PI / 2, x * 10, 0, 'YXZ');
    }

    // A crude hatchet in the right hand, for chopping and hammering.
    const grip = new THREE.Group();
    grip.position.set(...HAND(1)).sub(world.get('elbowR')!);
    grip.rotation.z = ARM_REST;
    this.bones.elbowR.add(grip);
    const hatchet = new THREE.Group();
    hatchet.rotation.x = Math.PI / 2 - 0.2;
    grip.add(hatchet);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, 0.42, 8), wood);
    handle.position.y = 0.08;
    const blade = new THREE.Mesh(box(0.02, 0.07, 0.11, 0.006), metal);
    blade.position.set(0, 0.26, 0.045);
    hatchet.add(handle, blade);

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
    const b = this.bones;

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
    b.hipL.rotation.x = -s * stride;
    b.hipR.rotation.x = s * stride;
    b.kneeL.rotation.x = w * (0.08 + Math.max(0, c) * (0.75 + 0.6 * r));
    b.kneeR.rotation.x = w * (0.08 + Math.max(0, -c) * (0.75 + 0.6 * r));

    // Arms come down from the modelled pose to hang at the sides, counter-swing with bent
    // elbows, and sway slightly with breathing when idle.
    const breathe = Math.sin(this.time * 1.8);
    const armSwing = (0.45 + 0.35 * r) * w;
    const hang = ARM_REST - 0.13 - breathe * 0.01;
    b.shoulderL.rotation.set(s * armSwing, 0, hang);
    b.shoulderR.rotation.set(-s * armSwing, 0, -hang);
    b.elbowL.rotation.x = -(0.2 + 0.25 * w + 0.9 * r);
    b.elbowR.rotation.x = -(0.35 + 0.2 * w + 0.9 * r);

    // Body: bob each step, lean forward when running, slight hip twist, idle breathing.
    b.root.position.y = Math.abs(c) * (0.035 + 0.03 * r) * w - 0.02 * w;
    const lean = 0.05 * w + 0.2 * r;
    b.torso.rotation.set(lean, s * 0.1 * w, 0);
    b.torso.scale.setScalar(1 + breathe * 0.006 * (1 - w));
    b.head.rotation.set(-lean * 0.7, Math.sin(this.time * 0.4) * 0.15 * (1 - w), 0);

    if (this.swingTimer > 0) {
      this.swingTimer = Math.max(0, this.swingTimer - dt);
      const t = 1 - this.swingTimer / 0.35;
      // Wind up over the head, then chop down and forward.
      const lift = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6;
      b.shoulderR.rotation.x = -2.6 * lift - 0.4 * (1 - lift) * Math.sin(t * Math.PI);
      b.shoulderR.rotation.z = -hang * (1 - lift * 0.7);
      b.elbowR.rotation.x = -0.9 * lift - 0.3;
      b.torso.rotation.y += -0.25 * Math.sin(t * Math.PI);
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
