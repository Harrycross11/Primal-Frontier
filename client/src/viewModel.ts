// What you see of your own hands in first person: the gun, tool or item you hold, in gloved
// hands with sleeved forearms, low in the right of the view. It sways behind the mouse, bobs as
// you walk, drops while you sprint or reload, pulls back from a wall in front of you, kicks with
// each shot, and comes up to the middle of the view to look down the sights while you aim.
//
// It hangs off the camera, so its space is the camera's: x right, y up, looking down -z.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ITEMS, type ItemId } from '../../shared/items.ts';
import { PISTOLS, buildGun, gunHands, muzzleOffset } from './guns.ts';
import { paintModel } from './paint.ts';
import { buildHeldItem } from './props.ts';
import { character, hasCharacter } from './models.ts';
import { ScanArm } from './scanBody.ts';
import { bodyModel, tintScan } from './survivorLook.ts';
import type { Look } from '../../shared/look.ts';

/** Where the gun's grip sits at the hip, and how far in front of the eye its sights sit when aiming. */
const HIP_RIFLE = new THREE.Vector3(0.15, -0.17, -0.3);
const HIP_PISTOL = new THREE.Vector3(0.14, -0.13, -0.4);
const EYE_RELIEF = 0.27;
const EYE_RELIEF_PISTOL = 0.42;
/** A tool or anything else held low in the right hand, head up. */
const HIP_TOOL = new THREE.Vector3(0.22, -0.21, -0.4);
/** The elbows, out of view below and behind the hands. */
const ELBOW_R = new THREE.Vector3(0.3, -0.42, 0.02);
const ELBOW_L = new THREE.Vector3(-0.16, -0.44, -0.08);

const glove = new THREE.MeshStandardMaterial({ color: 0x3a3029, roughness: 0.8 });
const sleeve = new THREE.MeshStandardMaterial({ color: 0x4b4a3c, roughness: 0.95 });
/** Joins shapes into one, with only what they all have (some come indexed, some not). */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
    for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(key)) g.deleteAttribute(key);
    return g;
  }))!;
}

/** A gloved fist closed round an upright grip or handle, thumb over the top on its left. */
const FIST_GEO = merge([
  new RoundedBoxGeometry(0.05, 0.088, 0.066, 3, 0.02).translate(0.004, -0.012, 0.002),
  new THREE.CapsuleGeometry(0.0115, 0.042, 4, 8).rotateX(Math.PI / 2).translate(-0.024, 0.026, -0.006),
]);
/** A gloved hand cupped under a handguard, thumb up its left side. */
const CUP_GEO = merge([
  new RoundedBoxGeometry(0.068, 0.034, 0.092, 3, 0.015).translate(0, -0.026, 0),
  new THREE.CapsuleGeometry(0.011, 0.05, 4, 8).rotateX(Math.PI / 2).translate(-0.034, -0.004, 0.012),
  new THREE.CapsuleGeometry(0.01, 0.05, 4, 8).rotateX(Math.PI / 2).translate(0.032, -0.008, -0.004),
]);
const ARM_GEO = new THREE.CylinderGeometry(0.036, 0.042, 1, 10).translate(0, 0.5, 0).rotateX(Math.PI / 2);
const CUFF_GEO = new THREE.CylinderGeometry(0.044, 0.044, 0.05, 10).rotateX(Math.PI / 2);

type Kind = 'gun' | 'pistol' | 'tool' | null;

/** Mixamo bones whose skin is drawn in first person: the arms from just below the shoulder down. */
const ARM_BONE = /(Arm|ForeArm|Hand)/;
/** Each scan geometry cut down to just the arms, shared by every copy. */
const armsOnly = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();

/**
 * The scanned survivor's own arms and hands, in your look's sleeves and skin, standing where your
 * body would be under the camera. The rest of the body is cut away; each frame the arms reach for
 * the grips of whatever you hold.
 */
class ScannedArms {
  readonly right: ScanArm;
  readonly left: ScanArm;

  constructor(readonly body: THREE.Object3D, look: Look | undefined, pale: boolean) {
    if (look) tintScan(body, look, pale);
    const named = new Map<string, THREE.Bone>();
    body.traverse((o) => {
      if ((o as THREE.Bone).isBone) named.set(o.name.replace(/^mixamorig:?/, '').replace(/_\d+$/, ''), o as THREE.Bone);
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      mesh.geometry = cutToArms(mesh);
      mesh.castShadow = false;
      // Always in front of the camera, and posed far from its bind pose.
      mesh.frustumCulled = false;
      mesh.userData.noAO = true;
    });
    // The survivor's right is your right once it faces down -z with the camera. The two rigs name
    // sides differently, so check which arm is on the right.
    const [a, b] = [named.get('RightHand')!, named.get('LeftHand')!];
    body.rotation.y = Math.PI;
    body.updateMatrixWorld(true);
    const rightIs = a.getWorldPosition(new THREE.Vector3()).x > b.getWorldPosition(new THREE.Vector3()).x ? 'Right' : 'Left';
    this.right = new ScanArm(named, rightIs);
    this.left = new ScanArm(named, rightIs === 'Right' ? 'Left' : 'Right');
    // Scaled to the survivor's height, its head just below the eye. The head sits a little
    // further forward than a real one would, so the scan's arms reach a gun held out at the hip.
    const box = new THREE.Box3().setFromObject(body);
    body.scale.multiplyScalar(1.78 / (box.max.y - box.min.y));
    body.updateMatrixWorld(true);
    const head = named.get('Head')!.getWorldPosition(new THREE.Vector3());
    body.position.sub(head).add(new THREE.Vector3(0, -0.07, 0));
    body.updateMatrixWorld(true);
  }
}

/** A copy of a skinned mesh's geometry keeping only the triangles that move with the arms. */
function cutToArms(mesh: THREE.SkinnedMesh): THREE.BufferGeometry {
  const known = armsOnly.get(mesh.geometry);
  if (known) return known;
  const geo = mesh.geometry;
  const bones = mesh.skeleton.bones.map((b) => ARM_BONE.test(b.name) && !/Shoulder/.test(b.name));
  const si = geo.getAttribute('skinIndex');
  const sw = geo.getAttribute('skinWeight');
  const onArm = (i: number) => {
    let best = 0;
    let weight = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > weight) [best, weight] = [si.getComponent(i, k), w];
    }
    return bones[best];
  };
  const index = geo.index ? geo.index.array : [...Array(geo.getAttribute('position').count).keys()];
  const kept: number[] = [];
  for (let t = 0; t < index.length; t += 3) if (onArm(index[t]) && onArm(index[t + 1]) && onArm(index[t + 2])) kept.push(index[t], index[t + 1], index[t + 2]);
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(geo.attributes)) out.setAttribute(name, attr);
  out.setIndex(kept);
  out.boundingSphere = geo.boundingSphere;
  armsOnly.set(geo, out);
  return out;
}

export class ViewModel {
  readonly root = new THREE.Group();
  private item: ItemId | null = null;
  private paint = 0;
  private kind: Kind = null;
  private held: THREE.Group = new THREE.Group();
  private model: THREE.Object3D | null = null;
  /** Gun space: where each hand goes, the muzzle, and the point that sits mid-screen when aiming. */
  private palm = new THREE.Vector3();
  private hold: THREE.Vector3 | null = null;
  private muzzle = new THREE.Vector3();
  /** The rear and front sights, in gun space. */
  private sight = { rear: new THREE.Vector3(), front: new THREE.Vector3() };
  private arms: { hand: THREE.Mesh; arm: THREE.Mesh; cuff: THREE.Mesh }[];
  /** 0 to 1: how far up to the sights it is. */
  private ads = 0;
  private kick = 0;
  private swingT = 1;
  private reloadT = 0;
  private reloadLength = 1;
  private lower = 0;
  private bob = 0;
  private sway = new THREE.Vector2();
  private lastYaw = 0;
  private lastPitch = 0;
  /** The scanned arms, once the survivor has loaded; the gloves and sleeves built here stand in till then. */
  private scanned: ScannedArms | null = null;
  /** Whose arms they are. */
  private armsOf = '';

  constructor(private look?: Look) {
    this.root.add(this.held);
    this.arms = [0, 1].map(() => {
      const hand = new THREE.Mesh(FIST_GEO, glove);
      const arm = new THREE.Mesh(ARM_GEO, sleeve);
      const cuff = new THREE.Mesh(CUFF_GEO, glove);
      this.root.add(hand, arm, cuff);
      return { hand, arm, cuff };
    });
    this.root.traverse((o) => (o.userData.noAO = true));
  }

  /** Puts your scanned person's arms in place of the stand-in gloves, once they have loaded (the survivor's till then). */
  private scanArms(): ScannedArms | null {
    const want = this.look ? bodyModel(this.look) : 'survivor';
    const name = hasCharacter(want) ? want : 'survivor';
    if (this.scanned && this.armsOf === name) return this.scanned;
    const body = character(name);
    if (!body) return this.scanned;
    this.scanned?.body.removeFromParent();
    this.armsOf = name;
    this.scanned = new ScannedArms(body, this.look, name === 'survivor');
    this.root.add(body);
    for (const a of this.arms) a.hand.visible = a.arm.visible = a.cuff.visible = false;
    return this.scanned;
  }

  /** Builds what is in your hands again, once its scanned model has arrived. */
  rebuild() {
    const { item, paint } = this;
    this.paint = -1;
    this.set(item, paint);
  }

  /** What is in your hands, and its paint. */
  set(item: ItemId | null, paint = 0) {
    if (item === this.item && paint === this.paint) return;
    this.item = item;
    this.paint = paint;
    this.held.clear();
    this.model = null;
    const w = item ? ITEMS[item].weapon : undefined;
    const ranged = !!w && w.class !== 'melee';
    const model = !item ? null : ranged ? (buildGun(item) ?? buildHeldItem(item)) : buildHeldItem(item);
    this.kind = !model ? null : ranged ? (PISTOLS.includes(item!) ? 'pistol' : 'gun') : 'tool';
    if (model) {
      if (paint) paintModel(model, paint, model.userData.flame as THREE.Object3D | undefined);
      model.traverse((o) => {
        o.castShadow = false;
        o.userData.noAO = true;
      });
      this.held.add(model);
      this.model = model;
    }
    if (this.kind === 'gun' || this.kind === 'pistol') {
      const hands = gunHands(item!);
      this.palm.copy(hands.palm);
      this.hold = hands.hold;
      this.muzzle.copy(muzzleOffset(item!));
      this.sight = sightLine(item!, model!, this.muzzle);
      // Guns point down -z, the way the camera looks.
      model!.rotation.y = Math.PI;
    } else {
      this.palm.set(0, 0, 0);
      this.hold = null;
      // An axe's blade or a pick's point faces forward, away from you.
      if (model) model.rotation.y = headFacing(item!, model);
    }
    // Brought up from below when it changes.
    this.lower = 1;
  }

  fire() {
    this.kick = 1;
  }

  swing() {
    this.swingT = 0;
  }

  reload(seconds: number) {
    this.reloadT = seconds;
    this.reloadLength = seconds;
  }

  /**
   * Moves it for this frame. `aiming` raises it to the sights; `room` is how far it is to
   * whatever is right in front of the eye.
   */
  update(dt: number, o: { aiming: boolean; moving: boolean; sprinting: boolean; yaw: number; pitch: number; room: number }) {
    const dyaw = wrap(o.yaw - this.lastYaw);
    const dpitch = o.pitch - this.lastPitch;
    this.lastYaw = o.yaw;
    this.lastPitch = o.pitch;
    const gun = this.kind === 'gun' || this.kind === 'pistol';
    this.reloadT = Math.max(0, this.reloadT - dt);
    const reloading = this.reloadT > 0;
    const aim = o.aiming && gun && !reloading && !o.sprinting;
    this.ads += ((aim ? 1 : 0) - this.ads) * Math.min(1, dt * 16);
    this.kick *= Math.exp(-dt * 14);
    this.swingT = Math.min(1, this.swingT + dt * 3.2);
    const lowered = o.sprinting || reloading ? 1 : 0;
    this.lower += (lowered - this.lower) * Math.min(1, dt * 8);
    // Trails the view a little when you look around, less so while aiming.
    const k = 1 - this.ads * 0.8;
    this.sway.x += (THREE.MathUtils.clamp(dyaw * 1.4, -0.05, 0.05) * k - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (THREE.MathUtils.clamp(-dpitch * 1.4, -0.05, 0.05) * k - this.sway.y) * Math.min(1, dt * 10);
    this.bob += dt * (o.moving ? (o.sprinting ? 13 : 9) : 0);
    const bobAmount = (o.moving ? (o.sprinting ? 1.6 : 1) : 0) * (1 - this.ads * 0.85);

    const at = new THREE.Vector3();
    const rot = new THREE.Euler();
    if (gun) {
      const hip = this.kind === 'pistol' ? HIP_PISTOL : HIP_RIFLE;
      // Aimed: tipped so the rear and front sights line up along the view, with the rear sight
      // dead centre a short way in front of the eye.
      const relief = this.kind === 'pistol' ? EYE_RELIEF_PISTOL : EYE_RELIEF;
      const { rear, front } = this.sight;
      const tip = -Math.atan2(front.y - rear.y, front.z - rear.z);
      const rearView = new THREE.Vector3(-rear.x, rear.y, -rear.z).applyAxisAngle(new THREE.Vector3(1, 0, 0), tip);
      const sights = new THREE.Vector3(0, 0, -relief).sub(rearView);
      at.lerpVectors(hip, sights, this.ads);
      at.z += this.kick * (0.05 - this.ads * 0.02);
      rot.x = tip * this.ads + this.kick * 0.09;
    } else {
      at.copy(HIP_TOOL);
      // A chop: drawn back and up, then brought down and across.
      const s = this.swingT < 1 ? Math.sin(this.swingT * Math.PI) : 0;
      const wind = this.swingT < 0.35 ? this.swingT / 0.35 : 0;
      rot.x = -0.35 - s * 1.3 + wind * 0.6;
      rot.z = 0.05 - s * 0.35;
      // Upright and pointing ahead, edge first, only a touch turned in towards the middle.
      rot.y = 0.15;
      at.y += s * 0.06;
      at.z -= s * 0.12;
    }
    at.x += Math.sin(this.bob) * 0.012 * bobAmount + this.sway.x;
    at.y -= Math.abs(Math.cos(this.bob)) * 0.01 * bobAmount - this.sway.y;
    // Down and turned in while sprinting, reloading or just drawn.
    at.y -= this.lower * 0.12;
    rot.x -= this.lower * 0.45;
    rot.y += this.lower * 0.35;
    if (reloading && gun) rot.z += Math.sin((1 - this.reloadT / this.reloadLength) * Math.PI) * 0.5;
    // Pulled back against a wall rather than through it.
    const reach = gun ? Math.abs(at.z) + Math.max(0, this.muzzle.z) : 0.6;
    const pull = THREE.MathUtils.clamp((reach + 0.05 - o.room) / reach, 0, 0.6);
    at.z += pull * reach * 0.8;
    rot.x += pull * 0.7;
    this.held.position.copy(at);
    this.held.rotation.copy(rot);
    this.held.updateMatrix();
    this.placeArms();
  }

  /**
   * The scanned arms reaching for what you hold, the way the survivor holds it in third person:
   * the shooting hand round the grip, the other under the handguard or cupping a pistol grip, a
   * tool in the right fist. A free hand drops out of view.
   */
  private reachArms(arms: ScannedArms) {
    this.root.updateMatrixWorld(true);
    const world = (x: number, y: number, z: number) => this.root.localToWorld(new THREE.Vector3(x, y, z));
    const origin = world(0, 0, 0);
    const right = world(1, 0, 0).sub(origin).normalize();
    const left = right.clone().negate();
    // Elbows hang below and out to the side.
    const poleR = world(0.7, -0.9, 0.3);
    const poleL = world(-0.7, -0.9, 0.3);
    const down = (x: number) => world(x, -0.75, 0.15);
    const model = this.model;
    if (!model) {
      arms.right.reach(down(0.25), down(0.25), poleR, left);
      arms.left.reach(down(-0.25), down(-0.25), poleL, right);
      arms.right.curl(0.3);
      arms.left.curl(0.3);
      return;
    }
    model.updateMatrixWorld(true);
    const on = (p: THREE.Vector3) => model.localToWorld(p.clone());
    const turn = model.getWorldQuaternion(new THREE.Quaternion());
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(turn);
    const ahead = new THREE.Vector3(0, 0, 1).applyQuaternion(turn);
    if (this.kind === 'gun' || this.kind === 'pistol') {
      // The scanned hand's bulk sits above and ahead of its palm point, so the grip is aimed
      // for a little low and behind its middle to put the fist round it.
      const grip = on(this.palm).addScaledVector(ahead, this.kind === 'gun' ? 0.01 : 0.02).addScaledVector(up, this.kind === 'gun' ? -0.035 : -0.02);
      arms.right.reach(grip, grip, poleR, left, ahead.clone().addScaledVector(up, -0.6));
      if (this.kind === 'pistol') {
        const cup = on(this.palm.clone().add(new THREE.Vector3(0, -0.05, 0)));
        arms.left.reach(cup, cup, poleL, up.clone().add(right).normalize(), ahead.clone().add(right));
      } else if (this.hold) {
        // The palm under the handguard rather than inside it; the scanned fingers rise round it.
        const hold = on(this.hold).addScaledVector(up, 0.01);
        // A long gun held out at the hip is past the scanned arm's reach, so the hand slides
        // back along the handguard towards the magazine until it can grip it.
        const along = hold.clone().sub(on(this.palm));
        along.addScaledVector(up, -along.dot(up));
        const back = hold.clone().addScaledVector(along, -0.6);
        arms.left.reach(back, hold, poleL, up, ahead.clone().addScaledVector(right, 0.6));
      } else arms.left.reach(down(-0.25), down(-0.25), poleL, right);
    } else {
      // A tool's handle runs up its +y from the grip; the fist closes round it from the right,
      // fingers wrapping forward.
      const grip = on(new THREE.Vector3(0, 0.02, 0));
      const forward = world(0, 0, -1).sub(origin);
      arms.right.reach(grip, grip, poleR, left, forward.addScaledVector(up, -0.4));
      arms.left.reach(down(-0.25), down(-0.25), poleL, right);
    }
    arms.right.curl(1);
    arms.left.curl(this.kind === 'gun' || this.kind === 'pistol' ? 1 : 0.3);
  }

  /** Gloves on the grip and the handguard, with forearms back to elbows out of view. */
  private placeArms() {
    const scanned = this.scanArms();
    if (scanned) {
      this.reachArms(scanned);
      return;
    }
    const m = this.held.matrix;
    const turn = this.kind === 'gun' || this.kind === 'pistol' ? new THREE.Matrix4().makeRotationY(Math.PI) : new THREE.Matrix4();
    const toView = (p: THREE.Vector3) => p.clone().applyMatrix4(turn).applyMatrix4(m);
    const right = this.model ? toView(this.palm) : null;
    // A pistol is held in both hands round its grip.
    const left = this.kind === 'pistol' ? toView(this.palm).add(new THREE.Vector3(-0.035, -0.015, 0.01)) : this.hold && this.model ? toView(this.hold) : null;
    const set = (n: number, hand: THREE.Vector3 | null, elbow: THREE.Vector3) => {
      const a = this.arms[n];
      a.hand.visible = a.arm.visible = a.cuff.visible = !!hand;
      if (!hand) return;
      const cup = n === 1 && this.kind === 'gun';
      a.hand.geometry = cup ? CUP_GEO : FIST_GEO;
      a.hand.position.copy(hand);
      a.hand.quaternion.setFromRotationMatrix(new THREE.Matrix4().extractRotation(m));
      // The support hand of a pistol grip is the right fist mirrored.
      a.hand.scale.x = n === 1 && this.kind === 'pistol' ? -1 : 1;
      const wrist = hand.clone().add((cup ? new THREE.Vector3(0, -0.04, 0.06) : new THREE.Vector3(0, -0.055, 0.035)).applyQuaternion(a.hand.quaternion));
      a.arm.position.copy(wrist);
      a.arm.lookAt(this.root.localToWorld(elbow.clone()));
      a.arm.scale.set(1, 1, wrist.distanceTo(elbow));
      a.cuff.position.copy(wrist);
      a.cuff.quaternion.copy(a.arm.quaternion);
    };
    set(0, right, ELBOW_R);
    set(1, left, ELBOW_L);
  }

  /** The scanned arms' shoulder, elbow, wrist and palm, and the grip, in the camera's space (for tests). */
  joints(camera: THREE.Camera) {
    if (!this.scanned) return null;
    const local = (p: THREE.Vector3) => camera.worldToLocal(p.clone()).toArray().map((n) => +n.toFixed(3));
    const arm = (a: ScanArm) => [...a.joints(), a.hand.getWorldPosition(new THREE.Vector3()), a.palm()].map(local);
    return { right: arm(this.scanned.right), left: arm(this.scanned.left), grip: this.model ? local(this.model.localToWorld(this.palm.clone())) : null };
  }

  /** Where the muzzle is in the world, for the flash and the tracer. */
  muzzleWorld(out = new THREE.Vector3()): THREE.Vector3 {
    const gun = this.kind === 'gun' || this.kind === 'pistol';
    out.copy(gun ? this.muzzle : new THREE.Vector3(0, 0.3, 0));
    if (gun) out.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI));
    return this.root.localToWorld(out.applyMatrix4(this.held.matrix));
  }

  /** Where spent cases come out: the right side of the receiver, just ahead of the grip. */
  ejectWorld(out = new THREE.Vector3()): THREE.Vector3 {
    out.set(-0.03, this.muzzle.y, 0.08).applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI)).applyMatrix4(this.held.matrix);
    return this.root.localToWorld(out);
  }
}

/** Wraps an angle difference into -π to π. */
function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * The line you look along when aiming, in the gun's own space: from the top of the gun just
 * ahead of the grip (rear sight, carry handle or rail) to the top of the barrel near the muzzle
 * (front sight), both on the barrel's centre line.
 */
const sightLines = new Map<ItemId, { rear: THREE.Vector3; front: THREE.Vector3 }>();
function sightLine(item: ItemId, model: THREE.Object3D, muzzle: THREE.Vector3): { rear: THREE.Vector3; front: THREE.Vector3 } {
  const known = sightLines.get(item);
  if (known) return { rear: known.rear.clone(), front: known.front.clone() };
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const points: THREE.Vector3[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    const to = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const step = Math.max(1, Math.floor(pos.count / 8000));
    for (let i = 0; i < pos.count; i += step) points.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(to));
  });
  const length = Math.max(0.1, muzzle.z);
  // The barrel's centre line, from the width of the gun near its muzzle.
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) if (p.z > muzzle.z - length * 0.15) [lo, hi] = [Math.min(lo, p.x), Math.max(hi, p.x)];
  const cx = Number.isFinite(lo) ? (lo + hi) / 2 : 0;
  const top = (z0: number, z1: number) => {
    let y = -Infinity;
    let z = (z0 + z1) / 2;
    for (const p of points) if (p.z > z0 && p.z < z1 && Math.abs(p.x - cx) < 0.012 && p.y > y) [y, z] = [p.y, p.z];
    return Number.isFinite(y) ? new THREE.Vector3(cx, y, z) : null;
  };
  const rear = top(-0.03, length * 0.45) ?? new THREE.Vector3(cx, muzzle.y + 0.04, 0.05);
  const front = top(length * 0.75, muzzle.z + 0.01) ?? new THREE.Vector3(cx, muzzle.y + 0.03, muzzle.z);
  // Never tipped steeply by a tall rear part such as a scope mount.
  if (front.y < rear.y - 0.06) front.y = rear.y - 0.06;
  const out = { rear: rear.add(new THREE.Vector3(0, 0.004, 0)), front: front.add(new THREE.Vector3(0, 0.004, 0)) };
  sightLines.set(item, out);
  return { rear: out.rear.clone(), front: out.front.clone() };
}

/**
 * The turn about the handle that points a tool's head forward (down -z): the side of the
 * handle its head sticks out furthest, such as an axe's blade rather than its poll, measured
 * once per tool from the top of the model.
 */
const facings = new Map<ItemId, number>();
function headFacing(item: ItemId, model: THREE.Object3D): number {
  const known = facings.get(item);
  if (known !== undefined) return known;
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const points: THREE.Vector3[] = [];
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    const to = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld);
    const step = Math.max(1, Math.floor(pos.count / 6000));
    for (let i = 0; i < pos.count; i += step) points.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(to));
  });
  let top = -Infinity;
  for (const p of points) top = Math.max(top, p.y);
  // The handle's line, from the middle of the shaft below the head, and the point of the head
  // furthest from it: an axe's edge reaches further from the shaft than its poll.
  let ax = 0;
  let az = 0;
  let n = 0;
  for (const p of points) {
    if (p.y < top * 0.3 || p.y > top * 0.55) continue;
    ax += p.x;
    az += p.z;
    n++;
  }
  if (n) [ax, az] = [ax / n, az / n];
  let far: THREE.Vector3 | null = null;
  const reach = (p: THREE.Vector3) => Math.hypot(p.x - ax, p.z - az);
  for (const p of points) if (p.y >= top * 0.7 && (!far || reach(p) > reach(far))) far = p;
  const turn = far && reach(far) > 0.02 ? Math.PI - Math.atan2(far.x - ax, far.z - az) : 0;
  facings.set(item, turn);
  return turn;
}
