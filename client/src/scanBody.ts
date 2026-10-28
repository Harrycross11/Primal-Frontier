// A scanned, Mixamo-rigged character worn over the survivor's own skeleton. The game animates
// its simple skeleton in code (walking, aiming, swinging, lying dead); every frame the scanned
// body's matching bones are turned the same way, so it needs no animation files of its own.
// Gear, armour and held items stay on the game's bones, which line up with the scan's.

import * as THREE from 'three';
import type { BoneName } from './survivorMesh.ts';

/** Height the scan is scaled to, in metres. */
const HEIGHT = 1.78;

// Mixamo bone (without side) and the game bone it follows. L/R are matched up by which side
// of the body each one is on, since the two rigs name sides from different points of view.
const FOLLOW: [string, BoneName | 'shoulder' | 'elbow' | 'hip' | 'knee'][] = [
  ['Hips', 'pelvis'],
  ['Spine', 'torso'],
  ['Neck', 'neck'],
  ['Head', 'head'],
  ['UpLeg', 'hip'],
  ['Leg', 'knee'],
  ['Arm', 'shoulder'],
  ['ForeArm', 'elbow'],
];

// Limb bones and the child whose direction they are turned to match, in the game's bind pose.
const LIMBS: [string, string][] = [
  ['UpLeg', 'Leg'],
  ['Leg', 'Foot'],
  ['Arm', 'ForeArm'],
  ['ForeArm', 'Hand'],
];

/**
 * How far each finger joint bends, knuckle first, in a full grip. The survivor's rig weights all
 * four fingers to the index's first joint, so they fold together at the knuckles, round a handle;
 * other rigs have every finger's joints, which share the bend.
 */
const CURL = [1.8, 0, 0];
const CURL_JOINTED = [0.9, 1.3, 0.7];

interface Pair {
  src: THREE.Bone;
  dst: THREE.Bone;
  /** Rest orientations in the avatar's own space. */
  srcRest: THREE.Quaternion;
  dstRest: THREE.Quaternion;
}

const q = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const v = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0);

export class ScanBody {
  private pairs: Pair[] = [];
  private hips: THREE.Bone;
  private hipsRest = new THREE.Vector3();
  private pelvisRest = new THREE.Vector3();
  /** The scan's hands, keyed by the game's elbow bone on the same side. */
  readonly hands = new Map<BoneName, THREE.Bone>();
  private arms = new Map<BoneName, ScanArm>();

  constructor(
    private root: THREE.Object3D,
    scan: THREE.Object3D,
    private bones: Record<BoneName, THREE.Bone>,
    /** Where each game bone sits in the bind pose, in avatar space. */
    bindAt: Map<BoneName, THREE.Vector3>,
  ) {
    const named = new Map<string, THREE.Bone>();
    scan.traverse((o) => {
      if ((o as THREE.Bone).isBone) named.set(o.name.replace(/^mixamorig:?/, '').replace(/_\d+$/, ''), o as THREE.Bone);
    });
    const bone = (n: string) => named.get(n)!;
    this.hips = bone('Hips');

    // Stand the scan on the ground at the game's height, centred on the hips.
    root.add(scan);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scan);
    const k = HEIGHT / (box.max.y - box.min.y);
    scan.scale.multiplyScalar(k);
    root.updateMatrixWorld(true);
    box.setFromObject(scan);
    const hips = this.hips.getWorldPosition(new THREE.Vector3());
    scan.position.add(new THREE.Vector3(-hips.x, -box.min.y, -hips.z));
    root.updateMatrixWorld(true);

    // Each side's limb follows the game limb on the same side (x sign).
    const side = (name: string) => (Math.sign(bone(`Left${name}`).getWorldPosition(v).x) === Math.sign(bindAt.get('shoulderL')!.x) ? 'L' : 'R');
    const leftIs = side('Arm');
    const rightIs = leftIs === 'L' ? 'R' : 'L';

    // Bring the scan's limbs from its T-pose into the game's bind pose, upper bones first.
    // Shins hang straight down; forearms carry on along the upper arm.
    const target = (game: string, s: 'L' | 'R') => {
      if (game === 'knee') return new THREE.Vector3(0, -1, 0);
      const [a, b] = game === 'hip' ? ['hip', 'knee'] : ['shoulder', 'elbow'];
      return new THREE.Vector3().subVectors(bindAt.get(`${b}${s}` as BoneName)!, bindAt.get(`${a}${s}` as BoneName)!).normalize();
    };
    const limbGame: Record<string, string> = { UpLeg: 'hip', Leg: 'knee', Arm: 'shoulder', ForeArm: 'elbow' };
    for (const [prefix, s] of [
      ['Left', leftIs],
      ['Right', rightIs],
    ] as const) {
      for (const [name, child] of LIMBS) {
        const b = bone(prefix + name);
        const from = bone(prefix + child).getWorldPosition(new THREE.Vector3()).sub(b.getWorldPosition(v)).normalize();
        const turn = new THREE.Quaternion().setFromUnitVectors(from, target(limbGame[name], s));
        const world = b.getWorldQuaternion(new THREE.Quaternion()).premultiply(turn);
        b.quaternion.copy(b.parent!.getWorldQuaternion(q).invert().multiply(world));
        b.updateMatrixWorld(true);
      }
    }

    for (const [name, game] of FOLLOW) {
      const sides: [THREE.Bone, BoneName][] = ['pelvis', 'torso', 'neck', 'head'].includes(game)
        ? [[bone(name), game as BoneName]]
        : [
            [bone(`Left${name}`), `${game}${leftIs}` as BoneName],
            [bone(`Right${name}`), `${game}${rightIs}` as BoneName],
          ];
      for (const [dst, src] of sides) {
        this.pairs.push({ src: bones[src], dst, srcRest: this.avatarQuat(bones[src]), dstRest: this.avatarQuat(dst) });
      }
    }
    for (const [prefix, s] of [
      ['Left', leftIs],
      ['Right', rightIs],
    ] as const) {
      const elbow = `elbow${s}` as BoneName;
      this.hands.set(elbow, bone(`${prefix}Hand`));
      this.arms.set(elbow, new ScanArm(named, prefix));
    }
    this.hipsRest.copy(root.worldToLocal(this.hips.getWorldPosition(v)));
    this.pelvisRest.copy(root.worldToLocal(bones.pelvis.getWorldPosition(v)));
  }

  /** A bone's orientation relative to the avatar. */
  private avatarQuat(o: THREE.Object3D, out = new THREE.Quaternion()): THREE.Quaternion {
    return out.copy(this.root.getWorldQuaternion(q2).invert().multiply(o.getWorldQuaternion(q)));
  }

  /** Closes the fingers of one hand, from open (0) to a full grip (1). */
  curl(elbow: BoneName, amount: number) {
    this.arms.get(elbow)?.curl(amount);
  }

  /** The middle of the palm in world space, where a held handle sits. */
  palm(elbow: BoneName, out = new THREE.Vector3()): THREE.Vector3 {
    return this.arms.get(elbow)!.palm(out);
  }

  /** Bends one scanned arm to put its palm on a handle (see ScanArm.reach). */
  reach(elbow: BoneName, near: THREE.Vector3, far: THREE.Vector3, pole: THREE.Vector3, up: THREE.Vector3, fingers?: THREE.Vector3) {
    this.arms.get(elbow)!.reach(near, far, pole, up, fingers);
  }

  /** Where a scanned arm's shoulder and elbow joints are, in world space. */
  arm(elbow: BoneName): [THREE.Vector3, THREE.Vector3] {
    return this.arms.get(elbow)!.joints();
  }

  /** Turns the scan's bones to match the game skeleton's current pose. */
  update() {
    this.root.updateMatrixWorld(true);
    const rootQ = this.root.getWorldQuaternion(new THREE.Quaternion());
    for (const p of this.pairs) {
      // How far the game bone has turned from rest, applied to the scan bone's own rest.
      const delta = this.avatarQuat(p.src).multiply(q.copy(p.srcRest).invert());
      const want = delta.multiply(p.dstRest).premultiply(rootQ);
      p.dst.quaternion.copy(p.dst.parent!.getWorldQuaternion(q).invert().multiply(want));
      if (p.dst === this.hips) {
        // The hips also move: bobbing while walking, and down onto the ground when dead.
        const moved = this.root.worldToLocal(this.bones.pelvis.getWorldPosition(new THREE.Vector3())).sub(this.pelvisRest);
        const at = this.root.localToWorld(moved.add(this.hipsRest));
        p.dst.position.copy(p.dst.parent!.worldToLocal(at));
      }
      p.dst.updateMatrixWorld(true);
    }
  }
}

/** One arm of a Mixamo-rigged scan: upper arm, forearm, hand and fingers, posed by code. */
export class ScanArm {
  readonly upper: THREE.Bone;
  readonly lower: THREE.Bone;
  readonly hand: THREE.Bone;
  /** The index finger's joints from the knuckle out (on the survivor's rig, all four fingers'). */
  private fingers: THREE.Bone[];
  /** Every finger joint that bends in a grip, how far, and about which of its own axes. */
  private bends: { bone: THREE.Bone; rest: THREE.Quaternion; axis: THREE.Vector3; bend: number }[] = [];

  /** `named` holds the rig's bones without their mixamorig prefix; `prefix` is Left or Right. */
  constructor(named: Map<string, THREE.Bone>, prefix: 'Left' | 'Right') {
    this.upper = named.get(`${prefix}Arm`)!;
    this.lower = named.get(`${prefix}ForeArm`)!;
    this.hand = named.get(`${prefix}Hand`)!;
    const finger = (f: string) => [1, 2, 3].map((n) => named.get(`${prefix}Hand${f}${n}`)).filter((b): b is THREE.Bone => !!b);
    this.fingers = finger('Index');
    const others = ['Middle', 'Ring', 'Pinky'].map(finger).filter((f) => f.length);
    if (!others.length) {
      // Mixamo's finger joints bend about their x axis.
      this.fingers.forEach((bone, i) => this.bends.push({ bone, rest: bone.quaternion.clone(), axis: X.clone(), bend: CURL[i] }));
      return;
    }
    // Other rigs' joints turn every which way, so each one's bend axis is worked out: across the
    // finger, turning it towards the palm. Hands rest palm down or towards the thighs, so the
    // palm faces down as seen along the finger.
    this.hand.updateMatrixWorld(true);
    for (const f of [this.fingers, ...others]) {
      f.forEach((bone, i) => {
        const next = f[i + 1] ?? bone.children[0];
        const from = bone.getWorldPosition(new THREE.Vector3());
        const along = next ? next.getWorldPosition(new THREE.Vector3()).sub(from).normalize() : new THREE.Vector3().subVectors(from, f[i - 1].getWorldPosition(v)).normalize();
        const palm = new THREE.Vector3(0, -1, 0).addScaledVector(along, along.y).normalize();
        const axis = new THREE.Vector3().crossVectors(along, palm).normalize().applyQuaternion(bone.getWorldQuaternion(q2).invert());
        this.bends.push({ bone, rest: bone.quaternion.clone(), axis, bend: CURL_JOINTED[i] ?? 0 });
      });
    }
  }

  /** Closes the fingers, from open (0) to a full grip (1). */
  curl(amount: number) {
    // Every finger joint bends about its own axis, towards the palm.
    for (const j of this.bends) j.bone.quaternion.copy(j.rest).multiply(q.setFromAxisAngle(j.axis, j.bend * amount));
    this.hand.updateMatrixWorld(true);
  }

  /** The middle of the palm in world space, where a held handle sits. */
  palm(out = new THREE.Vector3()): THREE.Vector3 {
    const wrist = this.hand.getWorldPosition(new THREE.Vector3());
    if (!this.fingers.length) return out.copy(wrist);
    const along = this.fingers[0].getWorldPosition(new THREE.Vector3()).sub(wrist);
    return out.copy(wrist).addScaledVector(along, 0.75).addScaledVector(this.facing(), along.length() * 0.35);
  }

  /** Which way the palm faces, in world space. */
  private facing(): THREE.Vector3 {
    const along = this.fingers[0].getWorldPosition(new THREE.Vector3()).sub(this.hand.getWorldPosition(v));
    // Fingers bend towards the palm, so it faces along (axis x fingers).
    const axis = this.bends[0].axis.clone().applyQuaternion(this.fingers[0].getWorldQuaternion(q2));
    return new THREE.Vector3().crossVectors(axis, along).normalize();
  }

  /**
   * Bends the arm so its palm lands as far along the line from `near` to `far` as the arm
   * reaches, the elbow bowing towards `pole`, the palm turned to face `up` and the fingers, if
   * given, pointing along `fingers`. The standard two-bone solve: the triangle of upper arm,
   * forearm and reach fixes the elbow.
   */
  reach(near: THREE.Vector3, far: THREE.Vector3, pole: THREE.Vector3, up: THREE.Vector3, fingers?: THREE.Vector3) {
    if (!this.fingers.length) return;
    const s = this.upper.getWorldPosition(new THREE.Vector3());
    const a = s.distanceTo(this.lower.getWorldPosition(v));
    const b = this.lower.getWorldPosition(v).distanceTo(this.hand.getWorldPosition(new THREE.Vector3()));
    // Turning the wrist moves the palm, so solve twice.
    for (let pass = 0; pass < 2; pass++) {
      // Aim the wrist so the palm, rather than the wrist, ends up on the target.
      const offset = this.palm().sub(this.hand.getWorldPosition(v));
      const wristAt = (t: number) => near.clone().lerp(far, t).sub(offset);
      let lo = 0;
      let hi = 1;
      if (wristAt(1).distanceTo(s) <= a + b - 0.01) lo = 1;
      else for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (wristAt(mid).distanceTo(s) <= a + b - 0.01) lo = mid;
        else hi = mid;
      }
      const toTarget = wristAt(lo).sub(s);
      const d = THREE.MathUtils.clamp(toTarget.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
      const dir = toTarget.normalize();
      const x = (a * a - b * b + d * d) / (2 * d);
      const bow = pole.clone().sub(s);
      bow.addScaledVector(dir, -bow.dot(dir)).normalize();
      const elbowAt = s.clone().addScaledVector(dir, x).addScaledVector(bow, Math.sqrt(Math.max(0, a * a - x * x)));
      turn(this.upper, s, this.lower.getWorldPosition(new THREE.Vector3()), elbowAt);
      turn(this.lower, elbowAt, this.hand.getWorldPosition(new THREE.Vector3()), s.clone().addScaledVector(dir, d));
      // Roll the hand so the palm faces the handle.
      const wrist = this.hand.getWorldPosition(new THREE.Vector3());
      turn(this.hand, wrist, wrist.clone().add(this.facing()), wrist.clone().add(up));
      // Then turn it about that facing so the fingers run the way the handle needs them to.
      if (fingers) {
        const axis = up.clone().normalize();
        const flat = (d: THREE.Vector3) => d.addScaledVector(axis, -d.dot(axis)).normalize();
        const was = flat(this.fingers[0].getWorldPosition(new THREE.Vector3()).sub(wrist));
        const want = flat(fingers.clone());
        const angle = Math.atan2(new THREE.Vector3().crossVectors(was, want).dot(axis), was.dot(want));
        const world = this.hand.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
        this.hand.quaternion.copy(this.hand.parent!.getWorldQuaternion(q).invert().multiply(world));
        this.hand.updateMatrixWorld(true);
      }
    }
  }

  /** Where the shoulder and elbow joints are, in world space. */
  joints(): [THREE.Vector3, THREE.Vector3] {
    return [this.upper.getWorldPosition(new THREE.Vector3()), this.lower.getWorldPosition(new THREE.Vector3())];
  }
}

/** Swings a bone about the point `from` so the direction towards `was` points towards `want`. */
function turn(bone: THREE.Object3D, from: THREE.Vector3, was: THREE.Vector3, want: THREE.Vector3) {
  const by = new THREE.Quaternion().setFromUnitVectors(was.clone().sub(from).normalize(), want.clone().sub(from).normalize());
  const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(by);
  bone.quaternion.copy(bone.parent!.getWorldQuaternion(q).invert().multiply(world));
  bone.updateMatrixWorld(true);
}
