// Ashhounds as you see and hear them: the scanned hyena re-coloured ash grey, animated from the
// server's snapshots, with a growl, a snarl as it bites, a yelp when hit and a whine as it dies.
// Tame ones wear a rag collar and their owner's name.

import * as THREE from 'three';
import { ASHHOUND, rayCreature, type CreatureAnim, type CreatureState } from '../../shared/creatures.ts';
import type { Vec3 } from '../../shared/combat.ts';
import { nameTag } from './avatar.ts';
import type { Effects } from './effects.ts';
import { character, characterClips } from './models.ts';

/** The clip each thing a hound does plays, and how fast. */
const CLIPS: Record<CreatureAnim, [string, number]> = {
  idle: ['Idle', 1],
  snarl: ['Fight Idle', 1],
  walk: ['Walk', 1.15],
  run: ['Run', 1.25],
  attack: ['Attack', 2.1],
  hit: ['Hit Front', 1.4],
  eat: ['Eating', 1],
  dead: ['Death', 0.8],
};
const ONCE = new Set<CreatureAnim>(['attack', 'hit', 'dead']);
/** Height of the top of its head, metres, matching the server's hit boxes. */
const HEIGHT = 0.92;

/** The hyena's fur turned to grey ash: most of the colour drained out, the spots left dark. */
function ashen(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const out = m.clone();
  const image = m.map?.image as CanvasImageSource & { width: number; height: number } | undefined;
  if (!m.map || !image?.width) return out;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0);
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = px.data;
  for (let i = 0; i < d.length; i += 4) {
    const grey = d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;
    d[i] = (grey + (d[i] - grey) * 0.22) * 0.66;
    d[i + 1] = (grey + (d[i + 1] - grey) * 0.22) * 0.63;
    d[i + 2] = (grey + (d[i + 2] - grey) * 0.22) * 0.6;
  }
  ctx.putImageData(px, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  for (const key of ['flipY', 'colorSpace', 'wrapS', 'wrapT', 'channel', 'anisotropy'] as const) (map[key] as unknown) = m.map[key];
  out.map = map;
  return out;
}

let ashMaterial: Map<THREE.Material, THREE.Material> | null = null;

class HoundView {
  readonly root = new THREE.Group();
  state: CreatureState;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<CreatureAnim, THREE.AnimationAction>();
  private playing: CreatureAnim | null = null;
  private target = new THREE.Vector3();
  private neck: THREE.Object3D | null = null;
  private head: THREE.Object3D | null = null;
  private collar: THREE.Mesh | null = null;
  private tag: THREE.Sprite | null = null;
  /** Seconds until it next growls on its own. */
  growlIn = 2 + Math.random() * 8;

  constructor(state: CreatureState) {
    this.state = state;
    this.root.position.set(state.x, state.y, state.z);
    this.root.rotation.y = state.yaw;
    this.target.copy(this.root.position);
    const body = character('ashhound');
    if (!body) return;
    // Scale the scan to the size the server plays it at, feet on the ground.
    body.updateMatrixWorld(true);
    body.traverse((o) => (o as THREE.SkinnedMesh).skeleton?.update());
    // Measured from the skinned vertices, as the raw mesh bounds ignore the skeleton.
    const box = new THREE.Box3().setFromObject(body, true);
    const s = HEIGHT / (box.max.y - box.min.y);
    const centre = box.getCenter(new THREE.Vector3());
    body.scale.multiplyScalar(s);
    body.position.set(-centre.x * s, -box.min.y * s, -centre.z * s);
    ashMaterial ??= new Map();
    body.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      if (!ashMaterial!.has(m)) ashMaterial!.set(m, ashen(m));
      mesh.material = ashMaterial!.get(m)!;
    });
    this.neck = body.getObjectByName('head1_neck_024') ?? null;
    this.head = body.getObjectByName('head1_head_025') ?? null;
    this.root.add(body);
    this.mixer = new THREE.AnimationMixer(body);
    const clips = characterClips('ashhound');
    for (const [anim, [name, speed]] of Object.entries(CLIPS) as [CreatureAnim, [string, number]][]) {
      const clip = clips.find((c) => c.name === name);
      if (!clip) continue;
      const action = this.mixer.clipAction(clip);
      action.timeScale = speed;
      if (ONCE.has(anim)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(anim, action);
    }
    this.play(state.anim, 0);
    // Some way through its idle, so a pack never breathes in step.
    this.mixer.update(Math.random() * 2);
  }

  /** A new snapshot from the server; returns the animation it changed from, if it did. */
  sync(state: CreatureState): CreatureAnim | null {
    const was = this.state.anim;
    this.state = state;
    this.target.set(state.x, state.y, state.z);
    this.setOwner(state.owner !== undefined ? (state.name ?? 'Ashhound') : null);
    if (state.anim === was && !(state.anim === 'attack' && this.finished())) return null;
    this.play(state.anim, 0.15);
    return was;
  }

  private finished(): boolean {
    const a = this.playing && this.actions.get(this.playing);
    return !!a && !a.isRunning();
  }

  private play(anim: CreatureAnim, fade: number) {
    const next = this.actions.get(anim);
    if (!next) return;
    const prev = this.playing ? this.actions.get(this.playing) : undefined;
    next.reset().play();
    if (prev && prev !== next) next.crossFadeFrom(prev, fade, false);
    this.playing = anim;
  }

  /** A tame hound gets a collar of red rag and its name above it. */
  private setOwner(name: string | null) {
    if ((this.tag !== null) === (name !== null)) return;
    if (name) {
      this.collar = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.028, 6, 18), new THREE.MeshStandardMaterial({ color: 0x6a2018, roughness: 0.95 }));
      this.collar.castShadow = true;
      this.root.add(this.collar);
      this.tag = nameTag(name, 0x8a2a1e);
      this.tag.position.y = 1.25;
      this.root.add(this.tag);
    } else {
      if (this.collar) this.root.remove(this.collar);
      if (this.tag) this.root.remove(this.tag);
      this.collar = null;
      this.tag = null;
    }
  }

  update(dt: number) {
    this.root.position.lerp(this.target, Math.min(1, dt * 10));
    let d = this.state.yaw - this.root.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.root.rotation.y += d * Math.min(1, dt * 10);
    this.mixer?.update(dt);
    if (this.collar && this.neck && this.head) {
      // Round the neck, wherever the animation has put it.
      const neck = this.neck.getWorldPosition(new THREE.Vector3());
      const head = this.head.getWorldPosition(new THREE.Vector3());
      const at = neck.lerp(head, 0.35);
      this.collar.position.copy(this.root.worldToLocal(at.clone()));
      const along = this.root.worldToLocal(head.clone()).sub(this.collar.position).normalize();
      this.collar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), along);
    }
  }
}

export class Creatures {
  readonly views = new Map<number, HoundView>();

  constructor(
    private scene: THREE.Scene,
    private effects: Effects,
  ) {}

  /** Brings the hounds in line with the server's list: new ones appear, missing ones go. */
  sync(list: CreatureState[]) {
    const seen = new Set<number>();
    for (const s of list) {
      seen.add(s.id);
      let view = this.views.get(s.id);
      if (!view) {
        view = new HoundView(s);
        this.views.set(s.id, view);
        this.scene.add(view.root);
        continue;
      }
      const was = view.sync(s);
      if (was !== null) this.voice(view, s.anim, was);
    }
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      this.scene.remove(view.root);
      this.views.delete(id);
    }
  }

  /** The sound of a hound starting something new. */
  private voice(view: HoundView, anim: CreatureAnim, was: CreatureAnim) {
    const at = view.root.position;
    if (anim === 'attack') this.effects.creatureSound(Math.random() < 0.5 ? 'hound-snarl' : 'hound-growl', at, 1);
    else if (anim === 'hit') this.effects.creatureSound('hound-hurt', at, 0.9);
    else if (anim === 'dead') this.effects.creatureSound('hound-whine', at, 0.9);
    else if (anim === 'run' && was !== 'run' && view.state.owner === undefined) this.effects.creatureSound('hound-bark', at, 1);
    else if (anim === 'eat') this.effects.creatureSound('hound-grumble', at, 0.6);
  }

  update(dt: number) {
    for (const view of this.views.values()) {
      view.update(dt);
      if (view.state.anim === 'dead') continue;
      // Now and then a low growl, more often when squaring up to a fight.
      view.growlIn -= dt * (view.state.anim === 'snarl' ? 4 : 1);
      if (view.growlIn > 0) continue;
      view.growlIn = 4 + Math.random() * 10;
      this.effects.creatureSound(Math.random() < 0.5 ? 'hound-growl2' : 'hound-grumble', view.root.position, 0.55);
    }
  }

  /** The nearest live hound along a ray, if any, within `max`. */
  ray(o: Vec3, d: Vec3, max: number): { view: HoundView; t: number; head: boolean } | null {
    let best: { view: HoundView; t: number; head: boolean } | null = null;
    for (const view of this.views.values()) {
      if (view.state.anim === 'dead') continue;
      const p = view.root.position;
      const hit = rayCreature(o, d, { x: p.x, y: p.y, z: p.z, yaw: view.root.rotation.y }, best?.t ?? max);
      if (hit) best = { view, t: hit.t, head: hit.head };
    }
    return best;
  }

  /** What the crosshair says over a hound. */
  describe(view: HoundView, me: number, holding: string | null, near: boolean): string {
    const s = view.state;
    if (s.anim === 'dead') return 'Dead Ashhound';
    if (s.owner !== undefined) {
      const label = s.owner === me ? `${s.name} (yours)` : (s.name ?? 'Ashhound');
      return holding === 'cookedMeat' && s.owner === me && s.hp < 0.99 ? `${label}  ·  ${near ? 'Left click to feed it' : 'Get closer to feed it'}` : label;
    }
    const label = s.fed ? `Wild Ashhound (fed ${s.fed}/${ASHHOUND.tameFeeds})` : 'Wild Ashhound';
    if (holding === 'cookedMeat') return `${label}  ·  ${near ? 'Left click to feed it' : 'Get closer to feed it'}`;
    return label;
  }
}
