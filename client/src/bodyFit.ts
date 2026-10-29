// How each scanned person's head and trunk sit and how big they are, so the hats, masks, armour
// and packs made for the survivor can be moved and sized onto anyone (see Avatar.fitTo). Measured
// once per person from their skinned points, standing in the game's bind pose.

import * as THREE from 'three';

export interface BodyFit {
  /**
   * Where hats and masks are placed from, in the avatar's space: the middle of the head across,
   * its top, and the front of the face (hair can hang anywhere behind and below).
   */
  head: THREE.Vector3;
  /** How far forward the face is beside the nose (brows, eyes, cheeks): what glasses and masks clear. */
  eyes: number;
  /** The head's width. */
  headSize: number;
  /** Width (x) and depth (z) of the chest. */
  chest: { x: number; z: number };
  /** Where the middle of the chest is, front to back, and where its back is. */
  middle: number;
  back: number;
  /** Width at the hips. */
  hips: number;
  /** Width (x) and depth (z) of a thigh, trousers and all, halfway down it. */
  thigh: { x: number; z: number };
  /** How much thicker the arms are than the survivor's. */
  arm: number;
  /** What was measured, where it is not used as is (the survivor's). */
  measured?: BodyFit;
}

/** The survivor's own measurements (what every piece of gear was placed for). */
export const SURVIVOR_FIT: BodyFit = {
  head: new THREE.Vector3(0.006, 1.78, 0.113),
  eyes: 0.084,
  headSize: 0.191,
  chest: { x: 0.374, z: 0.302 },
  middle: -0.029,
  back: -0.18,
  hips: 0.369,
  thigh: { x: 0.165, z: 0.189 },
  arm: 1,
};

const fits = new Map<string, BodyFit>();

/** The measurements of the scanned person `name`, whose scan stands fitted under `root`. */
export function bodyFit(name: string, root: THREE.Object3D, scan: THREE.Object3D): BodyFit {
  const known = fits.get(name);
  if (known) return known;
  const head = new THREE.Box3();
  // Every point, whatever bone it hangs on: some scans hang the face on the neck as much as the head.
  const points: THREE.Vector3[] = [];
  const chest = new THREE.Box3();
  const hips = new THREE.Box3();
  const thigh = new THREE.Box3();
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const p = new THREE.Vector3();
  scan.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const bones = m.skeleton.bones;
    const index = m.geometry.attributes.skinIndex;
    const weight = m.geometry.attributes.skinWeight;
    for (let i = 0; i < m.geometry.attributes.position.count; i++) {
      let best = 0;
      for (let k = 1; k < 4; k++) if (weight.getComponent(i, k) > weight.getComponent(i, best)) best = k;
      const bone = bones[index.getComponent(i, best)]?.name ?? '';
      m.getVertexPosition(i, p);
      p.applyMatrix4(m.matrixWorld).applyMatrix4(toRoot);
      if (p.y > 1.4) points.push(p.clone());
      if (/Head/.test(bone)) head.expandByPoint(p);
      else if (/Spine|Neck|Shoulder/.test(bone) && p.y > 1.15 && p.y < 1.35) chest.expandByPoint(p);
      else if (/Hips|UpLeg/.test(bone) && p.y > 0.85 && p.y < 1.0) hips.expandByPoint(p);
      if (/UpLeg/.test(bone) && p.x > 0.02 && p.y > 0.62 && p.y < 0.78) thigh.expandByPoint(p);
    }
  });
  if (head.isEmpty() || chest.isEmpty() || hips.isEmpty() || thigh.isEmpty()) return SURVIVOR_FIT;
  const size = head.getSize(new THREE.Vector3());
  // The face's front: the nose, not an ear or a lock of hair, so only the middle of the head
  // between the brow and the chin.
  const mid = (head.min.x + head.max.x) / 2;
  const front = points.reduce((z, q) => (Math.abs(q.x - mid) < 0.03 && q.y > head.max.y - 0.22 && q.y < head.max.y - 0.06 ? Math.max(z, q.z) : z), -Infinity);
  const eyes = points.reduce((z, q) => (Math.abs(Math.abs(q.x - mid) - 0.03) < 0.015 && q.y > head.max.y - 0.17 && q.y < head.max.y - 0.09 ? Math.max(z, q.z) : z), -Infinity);
  const fit: BodyFit = {
    head: new THREE.Vector3(mid, head.max.y, Number.isFinite(front) ? front : head.max.z),
    eyes: Number.isFinite(eyes) ? eyes : (Number.isFinite(front) ? front : head.max.z) - 0.013,
    headSize: size.x,
    chest: { x: chest.max.x - chest.min.x, z: chest.max.z - chest.min.z },
    middle: (chest.min.z + chest.max.z) / 2,
    back: chest.min.z,
    hips: hips.max.x - hips.min.x,
    thigh: { x: thigh.max.x - thigh.min.x, z: thigh.max.z - thigh.min.z },
    arm: 1,
  };
  fit.arm = THREE.MathUtils.clamp(fit.chest.x / SURVIVOR_FIT.chest.x, 0.8, 1.1);
  // The survivor is what everything was made for: leave it exactly as it was.
  const kept = name === 'survivor' ? { ...SURVIVOR_FIT, measured: fit } : fit;
  fits.set(name, kept);
  return kept;
}

/** Every person measured so far (window.__pf.bodyFits, for tuning; players never run it). */
export const measuredFits = () => Object.fromEntries(fits);
