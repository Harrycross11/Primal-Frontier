// Wasteland survivor: one smooth, continuous body (see survivorMesh.ts) in worn clothing of
// dusty tones, with a hood, goggles, a respirator, a loaded backpack and whatever they hold
// attached to its bones. Each player's colour shows only as a faded accent (scarf and armband) so
// characters belong in the world instead of glowing in it.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { ITEMS, type ItemId } from '../../shared/items.ts';
import { type Look, defaultLook, lookColor } from '../../shared/look.ts';
import { ARMOUR_HIDES, armourParts, type HiddenGear } from './armour.ts';
import { character } from './models.ts';
import { PISTOLS, gunHands } from './guns.ts';
import { buildHeldItem } from './props.ts';
import { ScanBody } from './scanBody.ts';
import { headGear, tintScan } from './survivorLook.ts';
import { ARM_REST, BONES, type BoneName, HAND, Region, survivorGeometry } from './survivorMesh.ts';
import { clothSurface, leatherSurface } from './textures.ts';

// Faded workwear: olive drab, oilskin brown, charcoal, washed-out navy, khaki and rust. Trousers
// are darker than jackets, as they usually are, so the outfit reads as separate pieces.
/** Between the scanned survivor's eyes, in the survivor's model space. */
const EYE = new THREE.Vector3(0, 1.655, 0.085);
/**
 * Guns aimed along their top, through a scope or sights raised well above the bore, rather than
 * just over the barrel.
 */
const SCOPED: ItemId[] = ['boltRifle', 'l96', 'm249', 'svd', 'm82', 'm4', 'scarH', 'm14', 'hk416', 'aug', 'vector', 'ump45', 'p90', 'spas12', 'saiga12', 'm60'];

const JACKETS = [0x5a5c3e, 0x6a5440, 0x48494a, 0x46505e, 0x7c7052, 0x6e4e3a];
const TROUSERS = [0x3f3c35, 0x4a4436, 0x363a3f, 0x544a3b];

const materials = new Map<string, THREE.Material>();

/** Fabric catches a soft, pale sheen along its edges where light grazes the fibres. */
const CLOTH_SHEEN = { sheen: 0.4, sheenRoughness: 0.7, sheenColor: new THREE.Color(0x4a463e) };

/** Worn cloth tinted to `color`. Cached, since every survivor shares most of these. */
function cloth(color: number, roughness = 0.95): THREE.MeshStandardMaterial {
  const key = `cloth-${color}-${roughness}`;
  let m = materials.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!m) {
    const s = clothSurface();
    m = new THREE.MeshPhysicalMaterial({ color, map: s.map, normalMap: s.normalMap, roughness, metalness: 0, ...CLOTH_SHEEN });
    m.normalScale.set(0.9, 0.9);
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
    bodyMaterial = new THREE.MeshPhysicalMaterial({ map: s.map, normalMap: s.normalMap, vertexColors: true, roughness: 0.9, ...CLOTH_SHEEN });
    bodyMaterial.normalScale.set(0.85, 0.85);
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
  private hand: THREE.Group;
  private grip: THREE.Group;
  /** The photo-scanned body, when it loaded; it replaces the modelled one. */
  private scan: ScanBody | null = null;
  private held: ItemId | null | undefined = undefined;
  /** What they have in their hands. */
  get heldItem(): ItemId | null {
    return this.held ?? null;
  }
  /** How the arms hold what is in the hands. */
  private band: THREE.Mesh | null = null;
  private bandRest: [THREE.Vector3, THREE.Quaternion] | null = null;
  private pose: 'normal' | 'rifle' | 'pistol' | 'bow' = 'normal';
  private muzzle: THREE.Object3D | null = null;
  /** A burning torch's flame, if they hold one. */
  private flame: THREE.Object3D | null = null;
  /** Where the hands go on the gun or bow in hand, in its model space, and where its butt is. */
  private hands: { palm: THREE.Vector3; hold: THREE.Vector3 | null; fore?: boolean; butt?: THREE.Vector3; top?: number } | null = null;
  private recoilTimer = 0;
  private reloadTimer = 0;
  private dead = false;
  /** Astride an animal: sitting, legs either side. */
  seated = false;
  private tag: THREE.Sprite | null = null;
  /** Bind-pose positions of the bones, for hanging armour on them. */
  private boneAt = new Map<BoneName, THREE.Vector3>();
  /** The survivor's own hood and face gear, hidden under some armour. */
  private gear: Record<HiddenGear, THREE.Object3D[]> = { hood: [], face: [] };
  private worn: (ItemId | null)[] = [null, null, null];
  private wornMeshes: THREE.Object3D[][] = [[], [], []];
  /** Aim pitch (radians, up is positive), so others see where a survivor points their gun. */
  aimPitch = 0;
  /** Called as each foot comes down while walking or running; `sprint` when running. */
  onStep: ((sprint: boolean) => void) | null = null;
  private stepSign = 0;

  constructor(color: number, name?: string, look: Look = defaultLook()) {
    // Each survivor gets a different but always muted outfit, picked from their colour.
    const pick = (list: number[], salt: number) => list[Math.abs(Math.imul((color >> salt) ^ color, 2654435761)) % list.length];
    const jacketColor = pick(JACKETS, 3);
    const accent = cloth(color, 0.9);
    const hood = cloth(new THREE.Color(jacketColor).multiplyScalar(0.7).getHex()).clone();
    hood.side = THREE.DoubleSide;
    const darkLeather = leather(0x5a4634);
    const brownLeather = leather(0x6a5038);
    const packColor = lookColor(look, 'pack');
    const canvas = cloth(packColor ?? 0x6a6150);
    const bedroll = cloth(0x5b6450);
    const metal = plain(0x55524a, 0.45, 0.7);
    const rubber = plain(0x2a2927, 0.8);
    const glass = plain(0x1a2326, 0.12, 0.4);

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
      [Region.Boots]: new THREE.Color(0x5a4634),
      [Region.Gloves]: new THREE.Color(0x3e342b),
      [Region.Skin]: new THREE.Color(0x9c735a),
      [Region.Belt]: new THREE.Color(0x3d3026),
    };
    const colors = new Float32Array(shared.regions.length * 3);
    // Dust caked on the boots and lower legs, and uneven fading over the whole outfit.
    const dust = new THREE.Color(0xa0927a);
    const pos = shared.geometry.getAttribute('position');
    const c = new THREE.Color();
    shared.regions.forEach((r, i) => {
      c.copy(palette[r]);
      const y = pos.getY(i);
      const fade = Math.sin(pos.getX(i) * 23 + y * 17) * Math.sin(pos.getZ(i) * 19 - y * 11);
      if (r !== Region.Skin) c.multiplyScalar(1 + fade * 0.06);
      if (r === Region.Trousers || r === Region.Boots) c.lerp(dust, THREE.MathUtils.smoothstep(0.6 - y, 0, 0.55) * 0.45);
      c.toArray(colors, i * 3);
    });
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const body = new THREE.SkinnedMesh(geometry, bodyMat());
    body.add(this.bones.root);
    body.updateMatrixWorld(true);
    body.bind(new THREE.Skeleton(BONES.map(([n]) => this.bones[n])));
    this.root.add(body);

    // Gear is placed in the modelled pose's coordinates, then hung on the nearest bone. Pieces
    // made to sit tight on the modelled body's surface are left off the scanned one.
    let tight = true;
    const fitted: THREE.Object3D[] = [];
    const attach = (boneName: BoneName, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z).sub(world.get(boneName)!);
      this.bones[boneName].add(m);
      if (tight) fitted.push(m);
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

    // Backpack with a rolled bedroll and a canteen, unless they chose to go without.
    tight = false;
    const packStart = this.bones.torso.children.length;
    attach('torso', box(0.32, 0.4, 0.17, 0.045), canvas, 0, 1.24, -0.2);
    attach('torso', box(0.34, 0.1, 0.19, 0.03), canvas, 0, 1.41, -0.195);
    attach('torso', box(0.22, 0.14, 0.05, 0.015), canvas, 0, 1.18, -0.3);
    attach('torso', new THREE.CylinderGeometry(0.075, 0.075, 0.42, 16), bedroll, 0, 1.51, -0.2).rotation.z = Math.PI / 2;
    for (const x of [-0.12, 0.12]) attach('torso', new THREE.CylinderGeometry(0.079, 0.079, 0.025, 16), darkLeather, x, 1.51, -0.2).rotation.z = Math.PI / 2;
    attach('torso', new THREE.CylinderGeometry(0.045, 0.045, 0.16, 14), plain(0x4f5a44, 0.6, 0.3), 0.2, 1.18, -0.19);
    if (packColor === null) for (const o of this.bones.torso.children.slice(packStart)) o.removeFromParent();

    // Armband in the player's colour, around the left upper arm.
    const band = (this.band = attach('shoulderL', new THREE.CylinderGeometry(0.066, 0.064, 0.05, 16), accent, ...HAND(-1)));
    band.position.copy(new THREE.Vector3(...HAND(-1)).sub(world.get('shoulderL')!).multiplyScalar(0.27));
    band.rotation.z = -ARM_REST;
    this.bandRest = [band.position.clone(), band.quaternion.clone()];

    // Head: hood, goggles and respirator, so the face reads as a gritty survivor.
    tight = true;
    const faceStart = this.bones.head.children.length;
    const hoodMesh = attach('head', new THREE.SphereGeometry(0.13, 24, 16, Math.PI / 2 + 0.72, Math.PI * 2 - 1.44, 0, Math.PI * 0.78), hood, 0, 1.705, -0.012);
    hoodMesh.scale.set(1.06, 1.1, 1.14);
    const strap = attach('head', new THREE.TorusGeometry(0.094, 0.011, 6, 24), darkLeather, 0, 1.718, 0.005);
    strap.rotation.x = Math.PI / 2;
    strap.scale.set(1, 1.1, 1);
    this.gear.hood.push(hoodMesh, strap);
    for (const x of [-0.042, 0.042]) {
      attach('head', new THREE.CylinderGeometry(0.031, 0.034, 0.035, 16), metal, x, 1.718, 0.095).rotation.x = Math.PI / 2;
      attach('head', new THREE.CircleGeometry(0.026, 16), glass, x, 1.718, 0.113);
    }
    attach('head', new THREE.SphereGeometry(0.068, 20, 14), rubber, 0, 1.63, 0.08).scale.set(1.2, 0.9, 1.1);
    // A short olive filter canister on the front of the mask, with a dark grille.
    const filter = attach('head', new THREE.CylinderGeometry(0.03, 0.034, 0.05, 18), plain(0x3e4232, 0.55, 0.35), 0, 1.612, 0.15);
    filter.rotation.x = Math.PI / 2 + 0.35;
    const grille = attach('head', new THREE.CircleGeometry(0.026, 18), plain(0x1c1d1a, 0.7, 0.4), 0, 1.603, 0.174);
    grille.rotation.x = 0.35;
    for (const x of [-0.055, 0.055]) {
      // Painted canisters: bare metal here mirrored the bright sky as a pale disc.
      attach('head', new THREE.CylinderGeometry(0.032, 0.032, 0.045, 14), plain(0x3e4232, 0.55, 0.35), x, 1.615, 0.12).rotation.set(Math.PI / 2, x * 10, 0, 'YXZ');
    }
    this.gear.face.push(...this.bones.head.children.slice(faceStart).filter((o) => o !== hoodMesh && o !== strap));
    for (const [n, pos] of world) this.boneAt.set(n, pos);

    // Whatever is in their hands goes here: a rock, a tool or a building plan.
    const grip = (this.grip = new THREE.Group());
    grip.position.set(...HAND(1)).sub(world.get('elbowR')!);
    grip.rotation.z = ARM_REST;
    this.bones.elbowR.add(grip);
    this.hand = new THREE.Group();
    this.hand.rotation.x = Math.PI / 2 - 0.2;
    grip.add(this.hand);

    const scan = character('survivor');
    if (scan) {
      // The modelled body draws nothing but keeps its bones, which carry the gear.
      geometry.setDrawRange(0, 0);
      for (const o of fitted) o.visible = false;
      tintScan(scan, look);
      // Their own pick of hat, mask and goggles, made for the scanned head, in place of the
      // modelled body's hood and mask.
      this.gear = { hood: [], face: [] };
      for (const { mesh, kind } of headGear(look, (c) => cloth(c), accent)) {
        mesh.position.sub(world.get('head')!);
        this.bones.head.add(mesh);
        this.gear[kind].push(mesh);
      }
      this.scan = new ScanBody(this.root, scan, this.bones, world);
      this.scan.update();
    }

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });

    if (name) {
      const tag = nameTag(name, color);
      tag.position.y = 2.1;
      this.root.add(tag);
      this.tag = tag;
    }
  }

  /** Shows the item in their right hand. */
  setHeld(item: ItemId | null) {
    if (item === this.held) return;
    this.held = item;
    this.hand.clear();
    const model = buildHeldItem(item);
    if (model) this.hand.add(model);
    this.muzzle = (model?.userData.muzzle as THREE.Object3D | undefined) ?? null;
    this.flame = (model?.userData.flame as THREE.Object3D | undefined) ?? null;
    const w = item ? ITEMS[item].weapon : undefined;
    this.pose = !w || w.class === 'melee' ? 'normal' : w.class === 'bow' && item !== 'crossbow' ? 'bow' : item && PISTOLS.includes(item) ? 'pistol' : 'rifle';
    // A bow is gripped at its middle, and the other hand rests on the string.
    this.hands = this.pose === 'normal' || !item ? null : gunHands(item);
  }

  /** Dresses the survivor in the armour worn on their head, chest and legs. */
  setWear(wear: (ItemId | null)[]) {
    let changed = false;
    for (let i = 0; i < this.worn.length; i++) {
      const item = wear[i] ?? null;
      if (item === this.worn[i]) continue;
      changed = true;
      this.worn[i] = item;
      for (const m of this.wornMeshes[i]) m.removeFromParent();
      this.wornMeshes[i] = [];
      if (!item) continue;
      for (const { bone, mesh } of armourParts(item)) {
        mesh.position.sub(this.boneAt.get(bone)!);
        // The scanned head is smaller than the modelled one in its hood; sit hats lower on it.
        if (this.scan && item === 'coffeeCanHelmet') mesh.position.y -= 0.07;
        this.bones[bone].add(mesh);
        this.wornMeshes[i].push(mesh);
      }
    }
    if (!changed) return;
    const hidden = new Set(this.worn.flatMap((item) => (item ? (ARMOUR_HIDES[item] ?? []) : [])));
    for (const kind of ['hood', 'face'] as const) for (const o of this.gear[kind]) o.visible = !hidden.has(kind);
  }

  /** World position of the torch flame they hold, or null without one. */
  flamePosition(out = new THREE.Vector3()): THREE.Vector3 | null {
    if (!this.flame || this.dead) return null;
    return this.flame.getWorldPosition(out).setY(out.y + 0.12);
  }

  /** World position of the gun's muzzle, for flashes and tracers. */
  muzzlePosition(out = new THREE.Vector3()): THREE.Vector3 {
    if (this.muzzle) return this.muzzle.getWorldPosition(out);
    return out.copy(this.root.position).add(new THREE.Vector3(0, 1.5, 0));
  }

  /** A kick back from firing. */
  recoil() {
    this.recoilTimer = 0.12;
  }

  reloadAnim(seconds: number) {
    this.reloadTimer = seconds;
  }

  /**
   * Turns the hand so the gun points where the survivor looks, whatever the arm bones did:
   * the weapon's barrel (its +y here) along the facing pitched by `pitch`, its top upward.
   */
  private pointWeapon(pitch: number) {
    this.root.updateMatrixWorld(true);
    const forward = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
    const top = new THREE.Vector3(0, Math.cos(pitch), -Math.sin(pitch)).negate();
    const side = new THREE.Vector3().crossVectors(forward, top);
    const local = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, forward, top));
    const want = this.root.getWorldQuaternion(new THREE.Quaternion()).multiply(local);
    const parent = this.hand.parent!.getWorldQuaternion(new THREE.Quaternion());
    this.hand.quaternion.copy(parent.invert().multiply(want));
  }

  /** Lies the body on the ground, or stands it back up. */
  setDead(dead: boolean) {
    if (dead === this.dead) return;
    this.dead = dead;
    if (this.tag) this.tag.visible = !dead;
    this.bones.root.rotation.set(dead ? -Math.PI / 2 : 0, 0, 0);
    this.bones.root.position.z = 0;
  }

  /** Plays a chopping swing, used when gathering or building. */
  swing() {
    this.swingTimer = 0.35;
  }

  update(dt: number, moving: boolean) {
    this.animate(dt, moving);
    if (this.flame) {
      // The torch flame licks and gutters.
      const f = 1 + Math.sin(this.time * 17) * 0.12 + Math.sin(this.time * 29.3) * 0.08;
      this.flame.scale.set(1 / Math.sqrt(f), f, 1 / Math.sqrt(f));
      this.flame.rotation.y = this.time * 3;
    }
    if (!this.scan) return;
    const scan = this.scan;
    scan.update();
    // The right hand closes round whatever it holds, which sits in the middle of the palm.
    scan.curl('elbowR', this.held && !this.dead ? 1 : 0.3);
    this.grip.position.copy(this.bones.elbowR.worldToLocal(scan.palm('elbowR')));
    this.hand.position.set(0, 0, 0);
    const weapon = this.dead || !this.hands ? undefined : this.hand.children[0]?.children[0];
    if (weapon) this.holdWeapon(scan, weapon, this.hands!);
    else {
      scan.curl('elbowL', this.dead ? 0.15 : 0.3);
      if (this.band && this.bandRest) {
        this.band.position.copy(this.bandRest[0]);
        this.band.quaternion.copy(this.bandRest[1]);
      }
    }
  }

  /**
   * Holds a gun or bow the way a person does. The weapon goes where it belongs on the body (a long
   * gun's butt in the shoulder, a pistol out in front of the chest, a bow at arm's length), then
   * both arms reach for the places on it that a hand grips.
   */
  private holdWeapon(scan: ScanBody, weapon: THREE.Object3D, hands: NonNullable<Avatar['hands']>) {
    this.root.updateMatrixWorld(true);
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    const side = Math.sign(this.boneAt.get('shoulderL')!.x);
    // Towards the survivor's left, straight ahead, and up.
    const left = new THREE.Vector3(side, 0, 0).applyQuaternion(rootQ);
    const ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQ);
    const up = new THREE.Vector3(0, 1, 0);
    const [shoulderR] = scan.arm('elbowR');
    const [shoulderL] = scan.arm('elbowL');
    const turn = weapon.getWorldQuaternion(new THREE.Quaternion());
    let point: THREE.Vector3;
    let at: THREE.Vector3;
    // Where he looks from: between the scanned eyes, which sit a little lower than the old hood's.
    const eye = this.bones.head.localToWorld(EYE.clone().sub(this.boneAt.get('head')!));
    const sightY = this.sightY(weapon, hands);
    if (this.pose === 'rifle') {
      // The butt sits in the pocket of the right shoulder, just inside the joint, and comes up
      // until the sights are at his eye (his cheek on the stock), as far as the shoulder allows.
      point = this.butt(weapon, hands);
      at = shoulderR.clone().addScaledVector(left, 0.08).addScaledVector(ahead, 0.05).addScaledVector(up, 0.03);
      const sight = new THREE.Vector3(0, sightY - point.y, 0.25).applyQuaternion(turn);
      at.addScaledVector(up, THREE.MathUtils.clamp(eye.y - 0.015 - (at.y + sight.y), 0, 0.13));
    } else if (this.pose === 'pistol') {
      // Arms out towards the target, the sights at eye level.
      point = hands.palm;
      at = shoulderR.clone().lerp(shoulderL, 0.5).addScaledVector(ahead, 0.4);
      at.y = eye.y - 0.03 - new THREE.Vector3(0, sightY - point.y, 0).applyQuaternion(turn).y;
    } else {
      // A bow is held out at arm's length in the left hand.
      point = hands.hold!;
      at = shoulderL.clone().addScaledVector(ahead, 0.5).addScaledVector(left, -0.06);
    }
    this.hand.position.copy(this.hand.parent!.worldToLocal(at.sub(point.clone().applyQuaternion(turn))));
    this.hand.updateMatrixWorld(true);

    const on = (p: THREE.Vector3) => weapon.localToWorld(p.clone());
    const gunUp = new THREE.Vector3(0, 1, 0).applyQuaternion(turn);
    const gunAhead = new THREE.Vector3(0, 0, 1).applyQuaternion(turn);
    const right = left.clone().negate();
    // Elbows hang below the shoulders and a little out to the side.
    const poleR = this.root.localToWorld(new THREE.Vector3(-side * 0.9, 0.8, -0.1));
    const poleL = this.root.localToWorld(new THREE.Vector3(side * 0.9, 0.8, -0.1));
    if (this.pose === 'bow') {
      // Left fist round the bow's grip, right fingers on the string.
      scan.reach('elbowL', on(hands.hold!), on(hands.hold!), poleL, right, right);
      scan.reach('elbowR', on(hands.palm), on(hands.palm), poleR, left);
    } else {
      // The shooting hand wraps the grip from the right; the other hand lies palm up under the
      // handguard, or cups the shooting hand on a pistol.
      // Fingers wrap forward and down round the grip, and across under the handguard.
      // The scanned hand's bulk sits above and ahead of its palm point, so a long gun's grip is
      // aimed for a little low and behind its middle to put the fist round it.
      const grip = this.pose === 'rifle' ? on(hands.palm).addScaledVector(gunAhead, 0.01).addScaledVector(gunUp, -0.035) : on(hands.palm).addScaledVector(gunAhead, 0.02).addScaledVector(gunUp, -0.02);
      scan.reach('elbowR', grip, grip, poleR, left, gunAhead.clone().addScaledVector(gunUp, -0.6));
      const hold = hands.hold ?? hands.palm.clone().add(new THREE.Vector3(0, -0.05, 0));
      // A front grip is held like a second pistol grip, from the left; a handguard rests on the
      // upturned palm, fingers running forward and round its far side.
      if (hands.hold && hands.fore) scan.reach('elbowL', on(hold), on(hold), poleL, right, gunAhead.clone().addScaledVector(gunUp, -0.6));
      else if (hands.hold) scan.reach('elbowL', on(hold), on(hold), poleL, gunUp, gunAhead.clone().addScaledVector(right, 0.6));
      else scan.reach('elbowL', on(hold), on(hold), poleL, gunUp.clone().add(right).normalize(), gunAhead.clone().add(right));
    }
    scan.curl('elbowR', 1);
    scan.curl('elbowL', 1);
    // The armband rides on the scanned upper arm, which has left the game's arm behind.
    if (this.band) {
      const [shoulder, elbow] = scan.arm('elbowL');
      const parent = this.band.parent!;
      this.band.position.copy(parent.worldToLocal(shoulder.clone().lerp(elbow, 0.27)));
      const along = elbow.sub(shoulder).normalize();
      const world = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), along);
      this.band.quaternion.copy(parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
    }
  }

  /** How high the line from his eye along the sights sits on the weapon: a scope's middle, or just over the bore. */
  private sightY(weapon: THREE.Object3D, hands: NonNullable<Avatar['hands']>): number {
    const muzzleY = this.muzzle?.position.y ?? 0.05;
    if (!this.held || !SCOPED.includes(this.held)) return muzzleY + 0.03;
    this.butt(weapon, hands);
    return hands.top! - 0.025;
  }

  /** The middle of a long gun's butt plate, in its model space: the back end, halfway up the stock. */
  private butt(weapon: THREE.Object3D, hands: NonNullable<Avatar['hands']>): THREE.Vector3 {
    if (hands.butt) return hands.butt;
    weapon.updateMatrixWorld(true);
    const into = weapon.matrixWorld.clone().invert();
    const box = new THREE.Box3();
    weapon.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(into.clone().multiply(mesh.matrixWorld)));
    });
    const muzzleY = this.muzzle?.position.y ?? 0.05;
    hands.top = box.max.y;
    return (hands.butt = new THREE.Vector3(0, (hands.palm.y + muzzleY) / 2 + 0.02, box.min.z));
  }

  /** Poses the game skeleton for this frame. */
  private animate(dt: number, moving: boolean) {
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
    // A foot lands each time the stride swings through the middle.
    const sign = Math.sign(s);
    if (sign !== 0 && sign !== this.stepSign) {
      if (this.stepSign !== 0 && w > 0.5 && !this.dead && !this.seated && this.speed > 1) this.onStep?.(r > 0.5);
      this.stepSign = sign;
    }
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

    if (this.seated && !this.dead) {
      // Sat on an animal's back (the avatar stands at the saddle): thighs forward and apart,
      // shins hanging, sitting up straight with a gentle sway as it moves.
      b.root.position.set(0, -0.93, 0);
      b.hipL.rotation.set(-1.35, 0, 0.32 * Math.sign(this.boneAt.get('hipL')!.x));
      b.hipR.rotation.set(-1.35, 0, 0.32 * Math.sign(this.boneAt.get('hipR')!.x));
      b.kneeL.rotation.x = b.kneeR.rotation.x = 1.25;
      b.torso.rotation.set(0.05 + s * 0.04 * w, 0, 0);
      b.shoulderL.rotation.set(-0.5, 0, hang);
      b.shoulderR.rotation.set(-0.5, 0, -hang);
      b.elbowL.rotation.x = b.elbowR.rotation.x = -0.9;
    }

    if (this.dead) {
      // Limp: arms out, knees slightly bent, lying on the back.
      b.root.position.set(0, 0.18, 0);
      b.shoulderL.rotation.set(0, 0, ARM_REST - 0.6);
      b.shoulderR.rotation.set(0, 0, -ARM_REST + 0.6);
      b.hipL.rotation.x = b.hipR.rotation.x = 0;
      b.kneeL.rotation.x = 0.3;
      b.kneeR.rotation.x = 0.1;
      b.torso.rotation.set(0, 0, 0);
      b.head.rotation.set(0, 0.5, 0);
      return;
    }

    // Holding a gun or bow up to aim: right arm forward, left hand supporting it.
    this.hand.rotation.set(Math.PI / 2 - 0.2, 0, 0);
    // A spear is carried low at the side near its balance point, point forward and tipped a little up.
    if (this.held === 'woodenSpear' || this.held === 'stoneSpear') this.pointWeapon(0.45);
    if (this.pose !== 'normal') {
      const kick = this.recoilTimer > 0 ? Math.sin((this.recoilTimer / 0.12) * Math.PI) * 0.12 : 0;
      this.recoilTimer = Math.max(0, this.recoilTimer - dt);
      const reloading = this.reloadTimer > 0;
      this.reloadTimer = Math.max(0, this.reloadTimer - dt);
      // Lowered while reloading or sprinting.
      const lower = reloading ? 0.6 : r * 0.7;
      const pitch = THREE.MathUtils.clamp(this.aimPitch, -0.9, 0.9) * (1 - lower);
      const up = 1.45 - lower + pitch + kick;
      if (this.pose === 'pistol' || this.pose === 'bow') {
        b.shoulderR.rotation.set(-up, -0.15, -0.12);
        b.elbowR.rotation.x = -0.1;
        b.shoulderL.rotation.set(-up + 0.05, 0.5, 0.35);
        b.elbowL.rotation.x = -0.35;
      } else {
        b.shoulderR.rotation.set(-up + 0.55, -0.8, -0.35);
        b.elbowR.rotation.x = -1.2;
        b.shoulderL.rotation.set(-up - 0.05, 0.55, 0.45);
        b.elbowL.rotation.x = -0.25;
      }
      if (reloading) b.shoulderL.rotation.x += Math.sin(this.time * 14) * 0.15;
      // Bladed to the target for a long gun, which brings the left shoulder forward to the handguard.
      const twist = this.pose === 'rifle' ? -Math.sign(this.boneAt.get('shoulderL')!.x) * 0.55 : 0.1;
      b.torso.rotation.y += twist;
      b.head.rotation.y -= twist;
      this.pointWeapon(pitch + kick * 0.5 - lower * 0.8);
    }

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

export function nameTag(text: string, color: number): THREE.Sprite {
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
