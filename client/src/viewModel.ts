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

  constructor() {
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
      rot.x = -0.5 - s * 1.3 + wind * 0.6;
      rot.z = 0.15 - s * 0.35;
      // Turned a little in towards the middle, so you see the side of the head and its edge leads.
      rot.y = 0.35;
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

  /** Gloves on the grip and the handguard, with forearms back to elbows out of view. */
  private placeArms() {
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
  // The furthest point of the head from the handle: the blade's edge reaches further than the poll.
  let far: THREE.Vector3 | null = null;
  for (const p of points) if (p.y >= top * 0.7 && (!far || Math.hypot(p.x, p.z) > Math.hypot(far.x, far.z))) far = p;
  const turn = far && Math.hypot(far.x, far.z) > 0.02 ? Math.PI - Math.atan2(far.x, far.z) : 0;
  facings.set(item, turn);
  return turn;
}
