// The animals as you see and hear them, animated from the server's snapshots: Ashhounds (the
// scanned hyena re-coloured ash grey, with a growl, a snarl as it bites, a yelp when hit and a
// whine as it dies) and each land's big animal. Tame ones wear their owner's name: a hound a
// rag collar, an animal you can ride a saddle.

import * as THREE from 'three';
import { SPECIES, rayCreature, type CreatureAnim, type CreatureState, type Species } from '../../shared/creatures.ts';
import type { Vec3 } from '../../shared/combat.ts';
import { nameTag } from './avatar.ts';
import type { Effects } from './effects.ts';
import { character, characterClips, model, soleMaterial } from './models.ts';

/** The scanned saddle's fitted length (models.ts FIT). */
const SADDLE_LENGTH = 1;

type Clips = Partial<Record<CreatureAnim, [string, number]>>;

/**
 * Each animal's model, the clip each thing it does plays (and how fast), and its size: the
 * hound is scaled to the top of its head, the rest nose to tail, matching the server's bodies.
 */
const LOOKS: Record<Species, { model: string; clips: Clips; height?: number }> = {
  ashhound: {
    model: 'ashhound',
    height: 0.92,
    clips: {
      idle: ['Idle', 1],
      snarl: ['Fight Idle', 1],
      walk: ['Walk', 1.15],
      trot: ['Run', 0.9],
      run: ['Run', 1.25],
      attack: ['Attack', 2.1],
      hit: ['Hit Front', 1.4],
      eat: ['Eating', 1],
      dead: ['Death', 0.8],
    },
  },
  mule: {
    model: 'mule',
    clips: {
      idle: ['Armature|idle', 1],
      snarl: ['Armature|idle', 1.4],
      walk: ['Armature|walk', 1],
      trot: ['Armature|trot', 1],
      run: ['Armature|run', 0.9],
      attack: ['Armature|rear leg kick', 1.2],
      eat: ['Armature|grazing', 1],
      dead: ['Armature|wound', 1.4],
    },
  },
  elk: {
    model: 'elk',
    clips: {
      idle: ['Stand_Breathing_01', 1],
      snarl: ['Stand_Breathing_01', 1.5],
      walk: ['Walk', 1],
      trot: ['Trot', 1],
      run: ['Sprint', 1],
      attack: ['JumpStand', 1.3],
      hit: ['Hit_Stand_L01', 1.2],
      eat: ['Stand_Eating_01', 1],
      dead: ['Death_Stand_R01', 1],
    },
  },
  buffalo: {
    model: 'buffalo',
    clips: {
      idle: ['Idle', 1],
      snarl: ['Idle', 1.6],
      walk: ['Walk', 1],
      trot: ['Run', 0.75],
      run: ['Run', 1],
      attack: ['Attack', 1.3],
      eat: ['Eating', 1],
      dead: ['Death', 1],
    },
  },
  camel: {
    model: 'camel',
    clips: {
      idle: ['Take 001', 1],
      snarl: ['Take 001', 1],
      walk: ['Take 001_1', 1],
      trot: ['Take 001_4', 0.75],
      run: ['Take 001_4', 1],
      attack: ['Take 001_2', 1.2],
      eat: ['Take 001_2', 0.6],
      dead: ['Take 001_3', 1],
    },
  },
  bear: {
    model: 'bear',
    clips: {
      idle: ['Stand_Idle_01', 1],
      snarl: ['StandAngry_Breathing_01', 1],
      walk: ['Walk', 1],
      trot: ['Trot', 1],
      run: ['Run', 1],
      attack: ['Attack_StandAngry_01_High', 1.3],
      hit: ['Hit_Stand_F01', 1.2],
      eat: ['Stand_Eating_01', 1],
      dead: ['Death_Stand_R01', 1],
    },
  },
};
const ONCE = new Set<CreatureAnim>(['attack', 'hit', 'dead']);
/** Sounds each animal makes: when it attacks, is hurt, dies, starts running, and now and then. */
const VOICES: Record<Species, { attack: string[]; hurt: string; dead: string; run?: string; idle: string[]; pitch?: number }> = {
  ashhound: { attack: ['hound-snarl', 'hound-growl'], hurt: 'hound-hurt', dead: 'hound-whine', run: 'hound-bark', idle: ['hound-growl2', 'hound-grumble'] },
  mule: { attack: ['mule-bray'], hurt: 'mule-bray', dead: 'mule-bray', run: 'mule-bray', idle: ['mule-bray'] },
  elk: { attack: ['elk-call'], hurt: 'elk-call', dead: 'elk-call', run: 'elk-call', idle: ['elk-call'] },
  buffalo: { attack: ['buffalo-grunt'], hurt: 'buffalo-grunt', dead: 'buffalo-grunt', run: 'buffalo-grunt', idle: ['buffalo-grunt'] },
  camel: { attack: ['camel-groan'], hurt: 'camel-groan', dead: 'camel-groan', idle: ['camel-groan'] },
  bear: { attack: ['bear-roar'], hurt: 'bear-hurt', dead: 'bear-hurt', run: 'bear-roar', idle: ['bear-growl'] },
};

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

  readonly species: Species;
  private info: (typeof SPECIES)[Species];
  /** Where its saddle sits on its back, in its own frame, for those that can be ridden. */
  private saddle: THREE.Group | null = null;
  /** The top of its back where the saddle goes, and the half width of its barrel below that. */
  private back: { top: number; half: number } | null = null;
  private lastAt = new THREE.Vector3();
  private pace = 0;

  constructor(state: CreatureState) {
    this.state = state;
    this.species = state.species ?? 'ashhound';
    this.info = SPECIES[this.species];
    this.root.position.set(state.x, state.y, state.z);
    this.root.rotation.y = state.yaw;
    this.target.copy(this.root.position);
    this.lastAt.copy(this.root.position);
    const look = LOOKS[this.species];
    const body = character(look.model);
    if (!body) return;
    body.updateMatrixWorld(true);
    body.traverse((o) => (o as THREE.SkinnedMesh).skeleton?.update());
    // Turn it to face +z, the way the server's animals look: towards its head.
    const headBone = this.species === 'ashhound' ? null : findBone(body, /head/i);
    const holder = new THREE.Group();
    holder.add(body);
    if (headBone) {
      const box0 = new THREE.Box3().setFromObject(body, true);
      const mid = box0.getCenter(new THREE.Vector3());
      const head = headBone.getWorldPosition(new THREE.Vector3());
      const angle = Math.atan2(head.x - mid.x, head.z - mid.z);
      // Models are built along an axis, so a quarter turn is always right.
      holder.rotation.y = -Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
    }
    holder.updateMatrixWorld(true);
    // Scale the scan to the size the server plays it at, feet on the ground. Measured from the
    // skinned vertices, as the raw mesh bounds ignore the skeleton.
    const box = new THREE.Box3().setFromObject(holder, true);
    const s = look.height ? look.height / (box.max.y - box.min.y) : this.info.length / (box.max.z - box.min.z);
    const centre = box.getCenter(new THREE.Vector3());
    holder.scale.multiplyScalar(s);
    holder.position.set(-centre.x * s, -box.min.y * s, -centre.z * s);
    if (this.info.ride) this.back = measureBack(this.species, holder);
    if (this.species === 'ashhound') {
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
    }
    this.root.add(holder);
    this.mixer = new THREE.AnimationMixer(body);
    const clips = characterClips(look.model);
    for (const [anim, [name, speed]] of Object.entries(look.clips) as [CreatureAnim, [string, number]][]) {
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
    // Some way through its idle, so a herd never breathes in step.
    this.mixer.update(Math.random() * 2);
  }

  /** Puts it right under its rider (you), rather than where the server last had it. */
  carry(x: number, y: number, z: number, yaw: number) {
    this.target.set(x, y, z);
    this.root.position.set(x, y, z);
    this.state = { ...this.state, yaw };
  }

  /** A new snapshot from the server; returns the animation it changed from, if it did. */
  sync(state: CreatureState): CreatureAnim | null {
    const was = this.state.anim;
    this.state = state;
    this.target.set(state.x, state.y, state.z);
    this.setOwner(state.owner !== undefined ? (state.name ?? this.info.name) : null);
    if (state.anim === was && !(state.anim === 'attack' && this.finished())) return null;
    this.play(state.anim, 0.15);
    return was;
  }

  private finished(): boolean {
    const a = this.playing && this.actions.get(this.playing);
    return !!a && !a.isRunning();
  }

  private play(anim: CreatureAnim, fade: number) {
    // A clip it has none of (a flinch, say) leaves it doing what it was.
    const next = this.actions.get(anim) ?? (anim === 'trot' ? this.actions.get('run') : undefined);
    if (!next) return;
    const prev = this.playing ? this.actions.get(this.playing) : undefined;
    next.reset().play();
    if (prev && prev !== next) next.crossFadeFrom(prev, fade, false);
    this.playing = anim;
  }

  /** A tame hound gets a collar of red rag, an animal to ride a saddle, and its name above it. */
  private setOwner(name: string | null) {
    if ((this.tag !== null) === (name !== null)) return;
    if (name) {
      if (this.species === 'ashhound') {
        this.collar = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.028, 6, 18), new THREE.MeshStandardMaterial({ color: 0x6a2018, roughness: 0.95 }));
        this.collar.castShadow = true;
        this.root.add(this.collar);
      } else if (this.info.ride) {
        this.saddle = buildSaddle(this.back ?? { top: this.info.ride.seat - 0.08, half: this.info.width / 2 });
        this.root.add(this.saddle);
      }
      this.tag = nameTag(name, 0x8a2a1e);
      this.tag.position.y = this.species === 'ashhound' ? 1.25 : (this.info.ride?.seat ?? this.info.height) + 1.2;
      this.root.add(this.tag);
    } else {
      for (const o of [this.collar, this.saddle, this.tag]) if (o) this.root.remove(o);
      this.collar = null;
      this.saddle = null;
      this.tag = null;
    }
  }

  update(dt: number) {
    this.root.position.lerp(this.target, Math.min(1, dt * 10));
    // Legs keep pace with how fast it is really going, so a ridden animal never skates.
    if (dt > 0) {
      const v = Math.hypot(this.root.position.x - this.lastAt.x, this.root.position.z - this.lastAt.z) / dt;
      this.pace += (v - this.pace) * Math.min(1, dt * 6);
      this.lastAt.copy(this.root.position);
      const anim = this.playing;
      const look = LOOKS[this.species].clips;
      const action = anim && this.actions.get(anim);
      const base = anim && (look[anim] ?? (anim === 'trot' ? look.run : undefined));
      if (action && base && (anim === 'walk' || anim === 'trot' || anim === 'run')) {
        const natural = anim === 'walk' ? this.info.walk * 1.1 : anim === 'trot' ? (this.info.ride?.walk ?? this.info.run * 0.6) : this.info.ride?.sprint ?? this.info.run;
        action.timeScale = base[1] * THREE.MathUtils.clamp(this.pace / natural, 0.6, 1.6);
      }
    }
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
  /** The animal you are riding, which your own aim and shots pass over. */
  mine: number | null = null;

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

  /** The sound of an animal starting something new. */
  private voice(view: HoundView, anim: CreatureAnim, was: CreatureAnim) {
    const at = view.root.position;
    const v = VOICES[view.species];
    const any = (list: string[]) => list[Math.floor(Math.random() * list.length)];
    if (anim === 'attack') this.effects.creatureSound(any(v.attack), at, 1);
    else if (anim === 'hit') this.effects.creatureSound(v.hurt, at, 0.9);
    else if (anim === 'dead') this.effects.creatureSound(v.dead, at, 0.9);
    else if (anim === 'run' && was !== 'run' && view.state.owner === undefined && v.run) this.effects.creatureSound(v.run, at, 1);
    else if (anim === 'eat' && view.species === 'ashhound') this.effects.creatureSound('hound-grumble', at, 0.6);
  }

  update(dt: number) {
    for (const view of this.views.values()) {
      view.update(dt);
      if (view.state.anim === 'dead') continue;
      // Now and then a low growl, more often when squaring up to a fight.
      view.growlIn -= dt * (view.state.anim === 'snarl' ? 4 : 1);
      if (view.growlIn > 0) continue;
      const idle = VOICES[view.species].idle;
      // Hounds growl often; the big grazers call out now and then.
      view.growlIn = view.species === 'ashhound' || view.species === 'bear' ? 4 + Math.random() * 10 : 15 + Math.random() * 30;
      this.effects.creatureSound(idle[Math.floor(Math.random() * idle.length)], view.root.position, 0.55);
    }
  }

  /** Whether a live animal's body is within `reach` of a point (its middle, not its feet). */
  near(at: THREE.Vector3, reach: number): boolean {
    for (const view of this.views.values()) {
      if (view.state.anim === 'dead') continue;
      const info = SPECIES[view.species];
      const mid = view.root.position.clone().setY(view.root.position.y + info.height / 2);
      if (mid.distanceTo(at) < reach + info.width / 2) return true;
    }
    return false;
  }

  /** The nearest live hound along a ray, if any, within `max`. */
  ray(o: Vec3, d: Vec3, max: number): { view: HoundView; t: number; head: boolean } | null {
    let best: { view: HoundView; t: number; head: boolean } | null = null;
    for (const view of this.views.values()) {
      if (view.state.anim === 'dead' || view.state.id === this.mine) continue;
      const p = view.root.position;
      const hit = rayCreature(o, d, { x: p.x, y: p.y, z: p.z, yaw: view.root.rotation.y, species: view.species }, best?.t ?? max);
      if (hit) best = { view, t: hit.t, head: hit.head };
    }
    return best;
  }

  /** What the crosshair says over an animal. */
  describe(view: HoundView, me: number, holding: string | null, near: boolean): string {
    const s = view.state;
    const info = SPECIES[view.species];
    if (s.anim === 'dead') return `Dead ${info.name}`;
    const food = holding === info.food;
    if (s.owner !== undefined) {
      const label = s.owner === me ? `${s.name} (yours)` : (s.name ?? info.name);
      if (food && s.owner === me && s.hp < 0.99) return `${label}  ·  ${near ? 'Left click to feed it' : 'Get closer to feed it'}`;
      if (s.owner === me && info.ride && s.rider === undefined) return `${label}  ·  E to ride`;
      return label;
    }
    const label = s.fed ? `Wild ${info.name} (fed ${s.fed}/${info.tameFeeds})` : `Wild ${info.name}`;
    if (food) return `${label}  ·  ${near ? 'Left click to feed it' : 'Get closer to feed it'}`;
    if (holding === 'cookedMeat' || holding === 'feedSack') return `${label}  ·  It eats ${info.food === 'feedSack' ? 'from a feed sack' : 'cooked meat'}`;
    return label;
  }
}

/** The first bone whose name matches, for finding an animal's head. */
function findBone(root: THREE.Object3D, name: RegExp): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.Bone).isBone && name.test(o.name) && !/end|top|nub/i.test(o.name)) found = o;
  });
  return found;
}

/**
 * The top of a ridden animal's back over its middle, and how wide its barrel is a hand below
 * that, measured from its skinned vertices in the rest pose (the scans differ too much for one
 * rule). Kept per species.
 */
const backs = new Map<Species, { top: number; half: number }>();
function measureBack(species: Species, holder: THREE.Object3D): { top: number; half: number } {
  const known = backs.get(species);
  if (known) return known;
  // Not yet added to the animal, so world space here is the animal's own frame.
  holder.updateMatrixWorld(true);
  const pts: THREE.Vector3[] = [];
  const v = new THREE.Vector3();
  holder.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.skeleton?.update();
    const n = mesh.geometry.attributes.position.count;
    for (let i = 0; i < n; i += 2) {
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      if (Math.abs(v.z) < 0.18) pts.push(v.clone());
    }
  });
  let top = -Infinity;
  for (const p of pts) if (Math.abs(p.x) < 0.08 && p.y > top) top = p.y;
  let half = 0;
  for (const p of pts) if (p.y < top - 0.08 && p.y > top - 0.3) half = Math.max(half, Math.abs(p.x));
  if (!Number.isFinite(top)) return { top: SPECIES[species].ride!.seat - 0.08, half: SPECIES[species].width / 2 };
  const out = { top, half: half || SPECIES[species].width / 2 };
  backs.set(species, out);
  return out;
}

/** The scan's leather is very dark in the game's light; lifted and taken off its red toward brown. */
let saddleLeather: THREE.Material | null = null;
function lighter(base: THREE.MeshStandardMaterial): THREE.Material {
  const m = base.clone();
  m.color = new THREE.Color(1.3, 1.35, 1.45);
  return m;
}

/** Woven wool for the saddle blanket: dark red with a pale stripe near each edge. */
let blanketMap: THREE.CanvasTexture | null = null;
function blanketTexture(): THREE.CanvasTexture {
  if (blanketMap) return blanketMap;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#5a2a1c';
  ctx.fillRect(0, 0, 128, 128);
  // Fine weave.
  for (let y = 0; y < 128; y += 2) {
    ctx.fillStyle = y % 4 ? 'rgba(0,0,0,0.12)' : 'rgba(255,220,180,0.05)';
    ctx.fillRect(0, y, 128, 1);
  }
  // Stripes running along the animal near each edge of the cloth.
  for (const x of [8, 112]) {
    ctx.fillStyle = '#b89a6a';
    ctx.fillRect(x, 0, 6, 128);
    ctx.fillStyle = '#2a1610';
    ctx.fillRect(x + 8, 0, 3, 128);
  }
  blanketMap = new THREE.CanvasTexture(c);
  blanketMap.colorSpace = THREE.SRGBColorSpace;
  return blanketMap;
}

/**
 * The scanned leather saddle (see models.ts) on a woven blanket, sat on an animal's back, sized
 * to the animal and widened a little on the broad ones so the flaps and stirrups hang clear of
 * its flanks. Falls back to a plain leather seat if the scan didn't load.
 */
function buildSaddle({ top, half }: { top: number; half: number }): THREE.Group {
  const g = new THREE.Group();
  const blanket = new THREE.MeshStandardMaterial({ map: blanketTexture(), roughness: 1, side: THREE.DoubleSide });
  // The saddle's length, front to back: a real one is about 0.6 m, a little longer on the big
  // animals. Its tree rests on the back at 0.6 of that above the stirrups' feet, and its flaps
  // spread a third of it each side, widened to wrap a broad animal.
  const length = Math.max(0.6, half * 1.6);
  const spread = Math.min(1.3, Math.max(1, (half * 1.08) / (length * 0.36)));
  // The blanket: a curve of cloth over the back, draped down both flanks.
  const r = half * 1.1;
  const span = Math.PI * 0.72;
  const cloth = new THREE.Mesh(new THREE.CylinderGeometry(r, r, length * 0.9, 20, 1, true, -span / 2, span), blanket);
  cloth.rotation.x = -Math.PI / 2;
  // Flattened to the back's oval rather than a round tube.
  cloth.scale.z = 0.7;
  cloth.position.set(0, top + 0.005 - r * 0.7, -0.02);
  g.add(cloth);
  const scan = model('gear-saddle');
  if (scan) {
    saddleLeather ??= lighter(soleMaterial(scan));
    const saddle = new THREE.Mesh(scan.geometry, saddleLeather);
    const k = length / SADDLE_LENGTH;
    saddle.scale.set(k * spread, k, k);
    saddle.position.y = top - 0.03 - length * 0.6;
    g.add(saddle);
  } else {
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x4a2c18, roughness: 0.55 }));
    shell.scale.set(half * 0.7, 0.07, 0.3);
    shell.position.y = top;
    g.add(shell);
  }
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}
