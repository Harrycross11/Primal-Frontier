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

export class ScanBody {
  private pairs: Pair[] = [];
  private hips: THREE.Bone;
  private hipsRest = new THREE.Vector3();
  private pelvisRest = new THREE.Vector3();
  /** The scan's hands, keyed by the game's elbow bone on the same side. */
  readonly hands = new Map<BoneName, THREE.Bone>();

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
    this.hands.set(`elbow${leftIs}` as BoneName, bone('LeftHand'));
    this.hands.set(`elbow${rightIs}` as BoneName, bone('RightHand'));
    this.hipsRest.copy(root.worldToLocal(this.hips.getWorldPosition(v)));
    this.pelvisRest.copy(root.worldToLocal(bones.pelvis.getWorldPosition(v)));
  }

  /** A bone's orientation relative to the avatar. */
  private avatarQuat(o: THREE.Object3D, out = new THREE.Quaternion()): THREE.Quaternion {
    return out.copy(this.root.getWorldQuaternion(q2).invert().multiply(o.getWorldQuaternion(q)));
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
