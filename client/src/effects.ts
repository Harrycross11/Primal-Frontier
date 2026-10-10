// Short-lived effects: bullet tracers, muzzle flashes, dust puffs where shots land, chips
// flying off whatever you hit, and every sound in the game, synthesised (no audio files:
// layered noise and tones shaped per weapon, tool, material and footstep).

import * as THREE from 'three';
import type { BiomeId } from '../../shared/biomes.ts';
import { ITEMS, type ItemId } from '../../shared/items.ts';

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
}

/** A unit-length streak along +y, stretched and turned to fit each shot. */
const TRACER_GEO = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
const UP = new THREE.Vector3(0, 1, 0);
const HOLE_GEO = new THREE.PlaneGeometry(1, 1);
/** A rifle case: a short brass tube. */
const SHELL_GEO = new THREE.CylinderGeometry(0.0055, 0.006, 0.045, 7);

interface Chip {
  mesh: THREE.Mesh;
  v: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  floor: number;
}

/** What a hit or footstep sounds like. */
export type Surface = 'wood' | 'stone' | 'scrap' | 'ore' | 'hemp' | 'dirt';
const CHIP_GEO = new THREE.BoxGeometry(1, 1, 1);
/** The recorded footsteps in client/public/sounds, six of each (step-gravel-0 to -5 and so on). */
type StepKind = 'gravel' | 'grass' | 'stone' | 'sand' | 'snow' | 'wood' | 'concrete' | 'metal';
const STEP_VARIANTS = 6;
/** How loud each kind plays, evening out how loud they were recorded. */
const STEP_LEVEL: Record<StepKind, number> = { gravel: 0.32, grass: 0.3, stone: 0.3, sand: 0.3, snow: 0.34, wood: 0.34, concrete: 0.28, metal: 0.26 };
/** What bare ground sounds like underfoot in each land. */
const GROUND_STEP: Record<BiomeId, StepKind> = { ashlands: 'gravel', deadwood: 'grass', mesa: 'stone', flats: 'sand', frost: 'snow' };

function stepKind(surface: Surface, land: BiomeId): StepKind {
  return surface === 'wood' ? 'wood' : surface === 'stone' ? 'concrete' : surface === 'scrap' ? 'metal' : GROUND_STEP[land];
}

const CHIP_COLORS: Record<Surface, number[]> = {
  wood: [0x8a6a44, 0xb08a5a, 0x5e4630],
  stone: [0x9a958c, 0x7d7870, 0xb5afa4],
  ore: [0x8a837a, 0xc4823a, 0x6e6860],
  scrap: [0x7a5a40, 0x9a6a3a, 0x55524a],
  hemp: [0x7d8a4a, 0x9aa060, 0x5e6a38],
  dirt: [0x7a6a52, 0x5e5040, 0x9a8a6a],
};

interface Puff {
  sprite: THREE.Sprite;
  life: number;
  max: number;
  /** Metres a second it climbs and swells. */
  rise: number;
  grow: number;
}

/** The supply plane crossing the sky, with the drone of its engines. */
interface Plane {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** Seconds since it set off, and how long the whole crossing takes. */
  t: number;
  time: number;
  hum: { gain: GainNode; pan: StereoPannerNode; stop: () => void } | null;
}

export class Effects {
  private tracers: Tracer[] = [];
  private puffs: Puff[] = [];
  private flashes: { sprite: THREE.Sprite; life: number }[] = [];
  /** Fireballs of explosions, swelling and fading. */
  private fireballs: { sprite: THREE.Sprite; life: number; max: number; grow: number }[] = [];
  /** Grenades in flight, along an arc from hand to where they land. */
  private tosses: { obj: THREE.Object3D; from: THREE.Vector3; to: THREE.Vector3; t: number; time: number; done: () => void }[] = [];
  /** How hard the camera should shake right now, from nearby blasts; read and eased by the game. */
  shake = 0;
  /** One light reused for every muzzle flash: adding and removing lights makes three.js recompile shaders. */
  private flashLight = new THREE.PointLight(0xffa860, 0, 7, 1.6);
  private flashLife = 0;
  private tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  private arrowMat = new THREE.MeshBasicMaterial({ color: 0x6a5030, transparent: true });
  private flashTex = radialTexture('rgba(255,236,170,1)', 'rgba(255,140,40,0.6)', 'rgba(255,120,30,0)');
  private dustTex = radialTexture('rgba(150,135,110,0.75)', 'rgba(120,110,95,0.35)', 'rgba(120,110,95,0)');
  private bloodTex = radialTexture('rgba(120,14,10,0.85)', 'rgba(100,12,8,0.4)', 'rgba(90,10,8,0)');
  private redSmokeTex = radialTexture('rgba(205,62,48,0.8)', 'rgba(180,58,46,0.4)', 'rgba(170,60,50,0)');
  private planes: Plane[] = [];
  private audio: { ctx: AudioContext; noise: AudioBuffer; out: AudioNode; reverb: ConvolverNode } | null = null;
  /** Recorded shots, swings and strikes from client/public/sounds, by name, once decoded. */
  private samples = new Map<string, AudioBuffer>();
  private loading: Promise<unknown> | null = null;
  private gotContext!: (ctx: AudioContext) => void;
  private ready = new Promise<AudioContext>((resolve) => (this.gotContext = resolve));
  private chips: Chip[] = [];
  /** Bullet holes left where shots struck something solid, oldest first; they fade out in time. */
  private holes: { mesh: THREE.Mesh; life: number }[] = [];
  private holeMats = new Map<Surface, THREE.MeshBasicMaterial>();
  /** Hot sparks off metal, short bright streaks under gravity. */
  private sparks: { mesh: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  private sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  /** Spent cases thrown out of the side of a gun, bouncing once and lying a moment. */
  private shells: { mesh: THREE.Mesh; v: THREE.Vector3; spin: number; life: number; floor: number }[] = [];
  private shellMat = new THREE.MeshStandardMaterial({ color: 0xb08a3e, roughness: 0.35, metalness: 0.9 });
  private chipMats = new Map<number, THREE.MeshStandardMaterial>();
  private wind: GainNode | null = null;
  /** The storm's own sounds: rain hissing on the ground, and a howl that rises with it. */
  private rainLevel: GainNode | null = null;
  private stormLevel: GainNode | null = null;
  /** The camera, so world sounds are panned and fade with distance. */
  listener: THREE.Camera | null = null;

  constructor(private scene: THREE.Scene) {
    scene.add(this.flashLight);
    this.loadSamples();
  }

  /** Bits of wood, stone or metal knocked off whatever was hit, falling with gravity. */
  chipsAt(at: THREE.Vector3, surface: Surface, floor: number, count = 7, power = 1) {
    const colors = CHIP_COLORS[surface];
    for (let n = 0; n < count; n++) {
      const color = colors[n % colors.length];
      let m = this.chipMats.get(color);
      if (!m) this.chipMats.set(color, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: true })));
      const mesh = new THREE.Mesh(CHIP_GEO, m);
      const size = (surface === 'hemp' ? 0.03 : 0.04) + Math.random() * 0.05;
      mesh.scale.set(size, size * (surface === 'wood' || surface === 'hemp' ? 0.35 : 0.8), size * (surface === 'wood' ? 1.8 : 1));
      mesh.position.copy(at);
      mesh.castShadow = false;
      this.scene.add(mesh);
      const v = new THREE.Vector3(Math.random() - 0.5, 0.6 + Math.random() * 0.9, Math.random() - 0.5).multiplyScalar(3.2 * power);
      const spin = new THREE.Vector3(Math.random(), Math.random(), Math.random()).multiplyScalar(14);
      this.chips.push({ mesh, v, spin, life: 0.7 + Math.random() * 0.5, floor });
    }
    this.puff(at, 0.3 * power);
  }

  /** How loud a sound at `at` is (1 close, falling off with distance) and where it sits left to right. */
  private placed(at: THREE.Vector3 | null, reach = 8): { near: number; pan: number; distance: number } {
    if (!at || !this.listener) return { near: 1, pan: 0, distance: 0 };
    const distance = this.listener.position.distanceTo(at);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.listener.quaternion);
    const pan = distance < 0.5 ? 0 : at.clone().sub(this.listener.position).normalize().dot(right) * 0.8;
    return { near: Math.min(1, reach / Math.max(reach, distance)), pan, distance };
  }

  /** A tool or fist striking a tree, boulder, wreck or hemp plant (`depleted` when it is used up). */
  gatherSound(surface: Surface, at: THREE.Vector3 | null, depleted = false, tool: ItemId | null = null) {
    const a = this.context();
    if (!a) return;
    const { near, pan, distance } = this.placed(at);
    if (near < 0.04) return;
    const { ctx, noise } = a;
    const now = ctx.currentTime + 0.005;
    const bus = this.voiceBus(pan, 0.06 + Math.min(0.3, distance / 80));
    const v = near * (0.85 + Math.random() * 0.3);
    const tune = 0.93 + Math.random() * 0.14;
    // The recorded strike of that very tool on wood or on rock and metal.
    const sounds = tool ? MELEE_SOUNDS[tool] : undefined;
    const strike = sounds && (surface === 'wood' ? sounds.wood : surface === 'stone' || surface === 'ore' || surface === 'scrap' ? sounds.stone : null);
    if (strike && this.play(strike[0], pan, 0.06 + Math.min(0.3, distance / 80), v * 0.9, strike[1] * tune)) {
      if (surface === 'wood' && depleted) this.creakAndFall(bus, now + 0.08, v);
      if (surface === 'ore') this.ping(bus, now, [1870 * tune, 2790 * tune, 4120 * tune], 0.05 * v, 0.18);
      if (surface !== 'wood') this.gravel(bus, now + 0.03, (depleted ? 0.4 : 0.15) * v, depleted ? 14 : 5);
      return;
    }
    if (surface === 'wood') {
      // An axe biting into dry wood: a hollow knock with a woody resonance.
      this.thud(bus, now, 170 * tune, 0.5 * v);
      this.tone(bus, now, 'triangle', 330 * tune, 210 * tune, 0.32 * v, 0.09);
      this.noiseHit(bus, noise, now, 'bandpass', 1100 * tune, 2.2, 0.55 * v, 0.07);
      this.noiseHit(bus, noise, now + 0.003, 'highpass', 3500, 0.7, 0.2 * v, 0.025);
      if (depleted) this.creakAndFall(bus, now + 0.08, v);
    } else if (surface === 'stone' || surface === 'ore') {
      // A pick on rock: a hard click, grit, and a little ring from the ore.
      this.click(bus, now, 3200 * tune, 0.55 * v);
      this.noiseHit(bus, noise, now, 'bandpass', 2300 * tune, 2.5, 0.5 * v, 0.05);
      this.thud(bus, now, 120 * tune, 0.35 * v);
      if (surface === 'ore') this.ping(bus, now, [1870 * tune, 2790 * tune, 4120 * tune], 0.07 * v, 0.18);
      this.gravel(bus, now + 0.03, 0.18 * v, 5);
      if (depleted) this.gravel(bus, now + 0.05, 0.4 * v, 14);
    } else if (surface === 'scrap') {
      // Rusty sheet metal: a clang with a few wobbly partials.
      this.ping(bus, now, [410 * tune, 1130 * tune, 1720 * tune, 2650 * tune], 0.08 * v, 0.55);
      this.noiseHit(bus, noise, now, 'bandpass', 1500 * tune, 1.4, 0.4 * v, 0.06);
      this.thud(bus, now, 140 * tune, 0.3 * v);
    } else if (surface === 'hemp') {
      // Pulling a plant: a rustle of leaves.
      for (let i = 0; i < 4; i++) this.noiseHit(bus, noise, now + i * 0.04, 'bandpass', 3800 + Math.random() * 1600, 0.8, 0.13 * v, 0.07);
    } else {
      this.thud(bus, now, 110, 0.4 * v);
      this.noiseHit(bus, noise, now, 'lowpass', 900, 0.7, 0.35 * v, 0.08);
    }
  }

  /** A building piece going up: a solid knock of timber, a grind of stone, or a sheet of metal clanking into place. */
  buildSound(material: 'wood' | 'stone' | 'scrap', at: THREE.Vector3 | null) {
    const a = this.context();
    if (!a) return;
    const { near, pan, distance } = this.placed(at, 10);
    if (near < 0.04) return;
    const { ctx, noise } = a;
    const now = ctx.currentTime + 0.005;
    const bus = this.voiceBus(pan, 0.1 + Math.min(0.3, distance / 80));
    const v = near * 0.7;
    if (material === 'wood') {
      this.thud(bus, now, 120, 0.35 * v);
      this.tone(bus, now, 'triangle', 240, 150, 0.3 * v, 0.14);
      this.noiseHit(bus, noise, now, 'bandpass', 800, 1.5, 0.45 * v, 0.12);
      this.thud(bus, now + 0.11, 150, 0.2 * v);
      this.noiseHit(bus, noise, now + 0.11, 'bandpass', 1300, 2, 0.25 * v, 0.05);
    } else if (material === 'stone') {
      this.thud(bus, now, 75, 0.85 * v);
      this.noiseHit(bus, noise, now, 'lowpass', 700, 0.8, 0.6 * v, 0.2);
      this.gravel(bus, now + 0.04, 0.3 * v, 10);
    } else {
      this.thud(bus, now, 95, 0.6 * v);
      this.ping(bus, now, [230, 610, 1180, 1790], 0.11 * v, 0.8);
      this.noiseHit(bus, noise, now, 'bandpass', 1100, 1, 0.4 * v, 0.1);
    }
  }

  /** Something you built (or a workbench, furnace or box) breaking apart. */
  breakSound(material: 'wood' | 'stone' | 'scrap', at: THREE.Vector3 | null) {
    const a = this.context();
    if (!a) return;
    const { near, pan, distance } = this.placed(at, 12);
    if (near < 0.03) return;
    const { ctx, noise } = a;
    const now = ctx.currentTime + 0.005;
    const bus = this.voiceBus(pan, 0.2 + Math.min(0.3, distance / 80), 0.35);
    this.thud(bus, now, material === 'stone' ? 60 : 85, 0.9 * near);
    this.noiseHit(bus, noise, now, 'lowpass', material === 'wood' ? 1400 : 900, 0.7, 0.7 * near, 0.45);
    if (material === 'wood') for (let i = 0; i < 6; i++) this.noiseHit(bus, noise, now + 0.04 + i * 0.05 * Math.random(), 'bandpass', 900 + Math.random() * 900, 3, 0.35 * near, 0.05);
    else if (material === 'stone') this.gravel(bus, now + 0.03, 0.55 * near, 22);
    else this.ping(bus, now + 0.02, [180, 520, 1010, 1640], 0.11 * near, 1);
  }

  /** The whoosh of a swing through the air: that tool's own, or a plain one for fists. */
  swingSound(heavy = false, tool: ItemId | null = null, at: THREE.Vector3 | null = null) {
    const a = this.context();
    if (!a) return;
    const swing = tool ? MELEE_SOUNDS[tool]?.swing : undefined;
    if (swing) {
      const { near, pan } = this.placed(at);
      if (near >= 0.04) this.play(swing[0], pan, 0.02, near * 0.8, swing[1] * (0.95 + Math.random() * 0.1));
      return;
    }
    const { ctx, noise } = a;
    const now = ctx.currentTime + 0.005;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.6;
    filter.frequency.setValueAtTime(500, now);
    filter.frequency.exponentialRampToValueAtTime(heavy ? 1500 : 2200, now + 0.09);
    filter.frequency.exponentialRampToValueAtTime(700, now + 0.2);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.22, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0005, now + 0.22);
    src.connect(filter).connect(gain).connect(this.voiceBus(0, 0.02));
    src.start(now, Math.random() * 0.6, 0.3);
  }

  /** An Ashhound's growl, bark, yelp or whine from where it stands, pitched a little low. */
  creatureSound(name: string, at: THREE.Vector3, level = 1) {
    if (!this.context()) return;
    const { near, pan, distance } = this.placed(at, 6);
    if (near < 0.04) return;
    this.play(name, pan, 0.08, near * level * 0.9, 0.84 + Math.random() * 0.12, 18000 - Math.min(15000, distance * 300));
  }

  /** The last recorded step played of each kind, so the same one never plays twice running. */
  private lastStep = new Map<StepKind, number>();

  /** Plays a recorded step of this kind, if they have loaded; false if not. */
  private recordedStep(kind: StepKind, pan: number, level: number, rate: number, bright = 18000): boolean {
    let i = Math.floor(Math.random() * STEP_VARIANTS);
    if (i === this.lastStep.get(kind)) i = (i + 1) % STEP_VARIANTS;
    this.lastStep.set(kind, i);
    return this.play(`step-${kind}-${i}`, pan, 0.03, level * STEP_LEVEL[kind], rate, bright);
  }

  /**
   * One footstep: on bare ground it sounds of the land underfoot (gravel in the Ashlands, leaf
   * litter in the forest, rock on the mesa, sand on the flats, snow up in the peaks); on a floor,
   * of wood, concrete or sheet metal. Quieter for others further away.
   */
  footstep(surface: Surface, at: THREE.Vector3 | null, sprint = false, land: BiomeId = 'ashlands') {
    const a = this.context();
    if (!a) return;
    const { near, pan, distance } = this.placed(at, 3);
    if (near < 0.08) return;
    const v = near * (sprint ? 1.2 : 0.85) * (0.8 + Math.random() * 0.4);
    const tune = 0.9 + Math.random() * 0.2;
    const rate = (sprint ? 1.04 : 0.97) * (0.94 + Math.random() * 0.12);
    if (this.recordedStep(stepKind(surface, land), pan, v, rate, 18000 - Math.min(14000, distance * 400))) return;
    const { ctx, noise } = a;
    const now = ctx.currentTime + 0.005;
    const bus = this.voiceBus(pan, 0.015);
    if (surface === 'wood') {
      this.thud(bus, now, 135 * tune, 0.32 * v);
      this.noiseHit(bus, noise, now, 'bandpass', 1000 * tune, 1.8, 0.16 * v, 0.05);
    } else if (surface === 'stone') {
      this.thud(bus, now, 110 * tune, 0.2 * v);
      this.noiseHit(bus, noise, now, 'bandpass', 2600 * tune, 2, 0.16 * v, 0.03);
      this.gravel(bus, now + 0.01, 0.05 * v, 3);
    } else if (surface === 'scrap') {
      this.thud(bus, now, 120 * tune, 0.22 * v);
      this.ping(bus, now, [540 * tune, 1390 * tune], 0.035 * v, 0.2);
    } else {
      // Ash and dry dirt: a soft crunch.
      this.thud(bus, now, 90 * tune, 0.16 * v);
      this.noiseHit(bus, noise, now, 'lowpass', 1300 * tune, 0.6, 0.2 * v, 0.06);
      this.noiseHit(bus, noise, now + 0.012, 'bandpass', 3800 * tune, 1, 0.08 * v, 0.04);
    }
  }

  /** Feet hitting the ground after a jump or fall. */
  landSound(surface: Surface, hard: number, land: BiomeId = 'ashlands') {
    const a = this.context();
    if (!a) return;
    // Both feet coming down: a recorded step, heavier and a touch slower, over a body thud.
    this.recordedStep(stepKind(surface, land), 0, Math.min(1.6, 0.9 + hard * 0.06), 0.9);
    const bus = this.voiceBus(0, 0.02);
    const now = a.ctx.currentTime + 0.005;
    this.thud(bus, now, surface === 'wood' ? 120 : 80, Math.min(0.7, 0.3 + hard * 0.05));
    this.noiseHit(bus, a.noise, now, 'lowpass', surface === 'dirt' ? 1100 : 1600, 0.7, Math.min(0.5, 0.2 + hard * 0.04), 0.1);
  }

  /** A finished craft dropping into your inventory: a soft double knock of something solid. */
  craftedSound() {
    const a = this.context();
    if (!a) return;
    const bus = this.voiceBus(0, 0.04, 0.3);
    const now = a.ctx.currentTime + 0.005;
    this.tone(bus, now, 'triangle', 520, 500, 0.16, 0.12);
    this.tone(bus, now + 0.09, 'triangle', 780, 760, 0.14, 0.18);
    this.noiseHit(bus, a.noise, now, 'bandpass', 1400, 2, 0.12, 0.04);
  }

  /** Picking up or dropping an item in the inventory. */
  uiSound(kind: 'move' | 'click' = 'click') {
    const a = this.context();
    if (!a) return;
    const bus = this.voiceBus(0, 0);
    const now = a.ctx.currentTime + 0.005;
    if (kind === 'move') {
      this.noiseHit(bus, a.noise, now, 'bandpass', 1300, 1.2, 0.14, 0.05);
      this.thud(bus, now, 180, 0.12);
    } else this.click(bus, now, 2400, 0.16);
  }

  /**
   * The wasteland's background: a low wind that rises and falls in gusts. Starts once and runs
   * for the rest of the game.
   */
  startAmbience() {
    const a = this.context();
    if (!a || this.wind) return;
    const { ctx } = a;
    // Four seconds of brown-ish noise, looped.
    const buf = ctx.createBuffer(2, ctx.sampleRate * 4, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        d[i] = last * 3.5;
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.9;
    // Gusts: slow wobbles on the level and the brightness.
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.07;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = 260;
    gust.connect(gustDepth).connect(filter.frequency);
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.045;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.025;
    const level = ctx.createGain();
    level.gain.value = 0.05;
    swell.connect(swellDepth).connect(level.gain);
    // Straight to the output, past the compressor, so gunfire does not pump the wind.
    src.connect(filter).connect(level).connect(ctx.destination);
    src.start();
    gust.start();
    swell.start();
    this.wind = level;

    // Rain: the same noise, bright and steady, silent until a storm comes in.
    const rain = ctx.createBufferSource();
    rain.buffer = buf;
    rain.loop = true;
    rain.playbackRate.value = 1.7;
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'highpass';
    hiss.frequency.value = 1800;
    const patter = ctx.createBiquadFilter();
    patter.type = 'peaking';
    patter.frequency.value = 4200;
    patter.gain.value = 6;
    this.rainLevel = ctx.createGain();
    this.rainLevel.gain.value = 0;
    rain.connect(hiss).connect(patter).connect(this.rainLevel).connect(ctx.destination);
    rain.start();
    // A storm's howl: the wind again, louder and higher, gusting faster.
    const howl = ctx.createBufferSource();
    howl.buffer = buf;
    howl.loop = true;
    howl.playbackRate.value = 1.3;
    const howlFilter = ctx.createBiquadFilter();
    howlFilter.type = 'bandpass';
    howlFilter.frequency.value = 700;
    howlFilter.Q.value = 1.4;
    const whistle = ctx.createOscillator();
    whistle.frequency.value = 0.19;
    const whistleDepth = ctx.createGain();
    whistleDepth.gain.value = 380;
    whistle.connect(whistleDepth).connect(howlFilter.frequency);
    this.stormLevel = ctx.createGain();
    this.stormLevel.gain.value = 0;
    howl.connect(howlFilter).connect(this.stormLevel).connect(ctx.destination);
    howl.start();
    whistle.start();
  }

  /** How stormy it is, 0 to 1: storms drown out the crickets and birds. */
  private storm = 0;
  /** Recorded loops under the wind, by name, once they have started. */
  private beds = new Map<string, GainNode>();
  /** When the next creak may sound, in audio-clock seconds. */
  private nextCreak = 0;

  /** Starts a recorded loop, silent, if it has loaded; its level, or null until then. */
  private bed(name: string): GainNode | null {
    let level = this.beds.get(name);
    if (level) return level;
    const buffer = this.samples.get(name);
    if (!buffer || !this.audio) return null;
    const { ctx } = this.audio;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    level = ctx.createGain();
    level.gain.value = 0;
    // Like the wind, straight to the output so gunfire does not pump it.
    src.connect(level).connect(ctx.destination);
    // Start somewhere in the loop, so it is never heard from the same point.
    src.start(0, Math.random() * buffer.duration);
    this.beds.set(name, level);
    return level;
  }

  /**
   * The land's own sounds round the listener, set every second or so: crickets at night,
   * birds by day in the forest, wind harder up in the peaks and out on the flats, and now and
   * then a groan of old metal from a wreck close by or a tree creaking in the forest.
   * `land` is how much each land claims the spot (as biomeWeights), `light` the daylight from 0
   * (night) to 1, and `wreck` the nearest wreck if one is in earshot.
   */
  surroundings(land: readonly number[], light: number, wreck: THREE.Vector3 | null, fire = Infinity, machine = Infinity) {
    const a = this.context();
    if (!a) return;
    const { ctx } = a;
    const now = ctx.currentTime;
    const [ash, forest, mesa, flats, frost] = land;
    const calm = 1 - this.storm * 0.85;
    const night = 1 - THREE.MathUtils.smoothstep(light, 0.15, 0.6);
    const day = THREE.MathUtils.smoothstep(light, 0.4, 0.8);
    const crickets = this.bed('amb-crickets');
    crickets?.gain.setTargetAtTime(0.11 * night * calm * (ash * 0.55 + forest + mesa * 0.5 + flats * 0.35), now, 2);
    const birds = this.bed('amb-birds');
    birds?.gain.setTargetAtTime(0.09 * day * calm * (forest + ash * 0.12 + mesa * 0.15), now, 2);
    this.wind?.gain.setTargetAtTime(0.05 * (1 + frost * 0.7 + flats * 0.35 + mesa * 0.3 - forest * 0.25), now, 3);
    // The nearest lit fire crackling, and the nearest running recycler grinding, by distance.
    const fade = (d: number, range: number) => Math.max(0, 1 - d / range) ** 2;
    this.bed('amb-fire')?.gain.setTargetAtTime(0.3 * fade(fire, 14), now, 0.6);
    this.bed('amb-machine')?.gain.setTargetAtTime(0.22 * fade(machine, 16), now, 0.6);

    if (now < this.nextCreak || !this.listener) return;
    this.nextCreak = now + 5 + Math.random() * 9;
    if (wreck && this.listener.position.distanceTo(wreck) < 28) {
      // A rusted panel shifting in the wind: the creak pitched up and darkened, over a low ring.
      const { near, pan } = this.placed(wreck, 8);
      if (this.play('amb-creak', pan, 0.3, near * 0.42, 1.5 + Math.random() * 0.6, 5200)) {
        const bus = this.voiceBus(pan, 0.25, 0.4);
        const hz = 70 + Math.random() * 40;
        this.ping(bus, now + 0.05 + Math.random() * 0.4, [hz, hz * 2.76, hz * 5.4], 0.012 * near, 1.4);
      }
    } else if (forest > 0.5 && Math.random() < 0.6) {
      // A dead trunk swaying somewhere off in the trees.
      const pan = Math.random() * 1.4 - 0.7;
      this.play('amb-creak', pan, 0.35, (0.12 + Math.random() * 0.1) * forest * (0.6 + this.storm * 0.8), 0.75 + Math.random() * 0.3, 3500);
    }
  }

  /** Brings the storm's sounds up and down with the weather, each 0 to 1. */
  setWeather(rain: number, dust: number, snow: number) {
    const a = this.context();
    if (!a || !this.rainLevel || !this.stormLevel) return;
    const now = a.ctx.currentTime;
    this.storm = Math.min(1, rain + dust + snow);
    this.rainLevel.gain.setTargetAtTime(rain * 0.16, now, 1.5);
    this.stormLevel.gain.setTargetAtTime(Math.min(1, dust + snow + rain * 0.4) * 0.09, now, 1.5);
  }

  /** Eating (crunchy chews), drinking (gulps) or swallowing pills (a rattle and a gulp). */
  consumeSound(kind: 'eat' | 'drink' | 'pills', at: THREE.Vector3 | null) {
    const a = this.context();
    if (!a) return;
    const { near, pan } = this.placed(at, 4);
    if (near < 0.05) return;
    const { ctx, noise } = a;
    const now = ctx.currentTime + 0.005;
    const bus = this.voiceBus(pan, 0.01, 0.2);
    if (kind === 'eat') {
      for (let i = 0; i < 3; i++) {
        this.noiseHit(bus, noise, now + i * 0.17, 'bandpass', 1800 + Math.random() * 900, 1.2, 0.3 * near, 0.06);
        this.thud(bus, now + i * 0.17, 140, 0.15 * near);
      }
    } else {
      if (kind === 'pills') for (let i = 0; i < 5; i++) this.click(bus, now + i * 0.03 + Math.random() * 0.02, 3800, 0.12 * near);
      const start = kind === 'pills' ? now + 0.3 : now;
      // Gulps: a low resonant bloop that bends up as the throat closes.
      for (let i = 0; i < (kind === 'pills' ? 1 : 3); i++) {
        const t = start + i * 0.28;
        this.tone(bus, t, 'sine', 180, 320, 0.3 * near, 0.09);
        this.noiseHit(bus, noise, t, 'lowpass', 600, 1, 0.12 * near, 0.08);
      }
    }
  }

  private geigerWait = 0;
  /**
   * A Geiger counter: random clicks, more of them the hotter the ground you stand on. Call
   * every frame with the radiation level (0 is silent).
   */
  geiger(level: number, dt: number) {
    if (level <= 0) {
      this.geigerWait = 0;
      return;
    }
    this.geigerWait -= dt;
    if (this.geigerWait > 0) return;
    const a = this.context();
    if (!a) return;
    const rate = 3 + level * 9;
    // Random gaps, like real decays: some clicks bunch up, some are spread out.
    this.geigerWait = -Math.log(1 - Math.random()) / rate;
    const bus = this.voiceBus(0, 0, 0.4);
    const now = a.ctx.currentTime + 0.005;
    this.noiseHit(bus, a.noise, now, 'highpass', 2500, 0.7, 0.35, 0.004);
    this.noiseHit(bus, a.noise, now, 'bandpass', 4200, 3, 0.25, 0.006);
  }

  /** A tree creaking and crashing down when its last wood is taken. */
  private creakAndFall(bus: AudioNode, at: number, v: number) {
    const { ctx, noise } = this.audio!;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95, at);
    osc.frequency.linearRampToValueAtTime(70, at + 0.5);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 600;
    f.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(0.08 * v, at + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0005, at + 0.55);
    osc.connect(f).connect(g).connect(bus);
    osc.start(at);
    osc.stop(at + 0.6);
    this.thud(bus, at + 0.6, 60, 0.2 * v);
    this.noiseHit(bus, noise, at + 0.6, 'lowpass', 900, 0.7, 0.2 * v, 0.4);
  }

  /** Little stones skittering: a run of tiny random clicks. */
  private gravel(bus: AudioNode, at: number, level: number, count: number) {
    for (let i = 0; i < count; i++) {
      this.noiseHit(bus, this.audio!.noise, at + Math.random() * 0.012 * count, 'bandpass', 2500 + Math.random() * 3500, 4, level * (0.4 + Math.random() * 0.6), 0.012);
    }
  }

  /** A short pitched tone sliding from one frequency to another. */
  private tone(bus: AudioNode, at: number, type: OscillatorType, from: number, to: number, level: number, length: number) {
    const ctx = this.audio!.ctx;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + length);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0005, at + length);
    osc.connect(gain).connect(bus);
    osc.start(at);
    osc.stop(at + length + 0.02);
  }

  /** A streak from the muzzle to where the bullet stopped, and dust where it landed. */
  shot(from: THREE.Vector3, ends: THREE.Vector3[], item: ItemId) {
    const bow = ITEMS[item].weapon?.class === 'bow';
    for (const end of ends) {
      // Start the streak a little way out so it doesn't poke through the shooter.
      const start = from.clone().lerp(end, Math.min(0.9, 1 / Math.max(1, from.distanceTo(end))));
      const dir = end.clone().sub(start);
      const mesh = new THREE.Mesh(TRACER_GEO, (bow ? this.arrowMat : this.tracerMat).clone());
      mesh.position.copy(start);
      mesh.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
      // Thicker further away, so distant shots stay visible.
      const r = bow ? 0.012 : 0.012 + Math.min(0.03, dir.length() * 0.0004);
      mesh.scale.set(r, dir.length(), r);
      this.scene.add(mesh);
      this.tracers.push({ mesh, life: bow ? 0.25 : 0.1 });
      this.puff(end, 0.35);
    }
  }

  /**
   * Where a bullet struck something solid: a hole on the surface facing back along the shot,
   * dust or chips of whatever it is, and sparks off metal. `normal` faces out of the surface.
   */
  impact(at: THREE.Vector3, normal: THREE.Vector3, surface: Surface, floor: number) {
    let mat = this.holeMats.get(surface);
    if (!mat) this.holeMats.set(surface, (mat = new THREE.MeshBasicMaterial({ map: holeTexture(surface), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })));
    const hole = new THREE.Mesh(HOLE_GEO, mat.clone());
    // The ground's drawn surface sits a little proud of its collision shape, so lift holes in it more.
    hole.position.copy(at).addScaledVector(normal, surface === 'dirt' ? 0.06 : 0.015);
    hole.renderOrder = 3;
    hole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    hole.rotateZ(Math.random() * Math.PI * 2);
    hole.scale.setScalar(surface === 'dirt' ? 0.24 : 0.08 + Math.random() * 0.03);
    hole.userData.noAO = true;
    this.scene.add(hole);
    this.holes.push({ mesh: hole, life: 25 });
    if (this.holes.length > 80) {
      const old = this.holes.shift()!;
      this.scene.remove(old.mesh);
      (old.mesh.material as THREE.Material).dispose();
    }
    const out = at.clone().addScaledVector(normal, 0.05);
    if (surface === 'scrap' || surface === 'ore') {
      for (let n = 0; n < 7; n++) {
        const spark = new THREE.Mesh(CHIP_GEO, this.sparkMat);
        spark.position.copy(out);
        spark.scale.set(0.012, 0.012, 0.09);
        const v = normal.clone().multiplyScalar(3 + Math.random() * 3).add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(5));
        spark.lookAt(out.clone().add(v));
        spark.userData.noAO = true;
        this.scene.add(spark);
        this.sparks.push({ mesh: spark, v, life: 0.18 + Math.random() * 0.2 });
      }
    }
    this.chipsAt(out, surface, floor, surface === 'dirt' ? 3 : 5, 0.55);
    this.puff(out, surface === 'dirt' ? 0.55 : 0.35, 0.9);
  }

  /** A burst of red mist where a bullet went into someone. */
  blood(at: THREE.Vector3) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.bloodTex, depthWrite: false, transparent: true }));
    sprite.position.copy(at);
    sprite.scale.setScalar(0.3);
    this.scene.add(sprite);
    this.puffs.push({ sprite, life: 0.35, max: 0.35, rise: -0.3, grow: 1.6 });
  }

  /** A spent case kicked out to the right of the gun; `right` is the shooter's right. */
  shell(from: THREE.Vector3, right: THREE.Vector3, floor: number, big = false) {
    const mesh = new THREE.Mesh(SHELL_GEO, this.shellMat);
    mesh.position.copy(from);
    mesh.scale.setScalar(big ? 1.2 : 0.85);
    mesh.rotation.set(Math.random() * 3, Math.random() * 3, Math.PI / 2);
    this.scene.add(mesh);
    const v = right.clone().multiplyScalar(1.8 + Math.random() * 0.6).add(new THREE.Vector3(0, 1 + Math.random() * 0.6, 0));
    this.shells.push({ mesh, v, spin: 20 + Math.random() * 15, life: 1.6, floor });
  }

  /** A bright flash and a flicker of light at the muzzle. */
  muzzle(at: THREE.Vector3, item: ItemId, size = 1) {
    if (ITEMS[item].weapon?.class !== 'gun') return;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sprite.position.copy(at);
    sprite.scale.setScalar((0.35 + Math.random() * 0.15) * size);
    this.flashLight.position.copy(at);
    this.flashLight.distance = 7;
    this.flashLight.intensity = 8;
    this.flashLife = 0.05;
    this.scene.add(sprite);
    this.flashes.push({ sprite, life: 0.05 });
  }

  puff(at: THREE.Vector3, size: number, life = 0.6) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dustTex, depthWrite: false, transparent: true }));
    sprite.position.copy(at);
    sprite.scale.setScalar(size);
    this.scene.add(sprite);
    this.puffs.push({ sprite, life, max: life, rise: 0.3, grow: 0.8 });
  }

  /** One billow of thick red smoke from a supply signal or a landed supply drop, climbing high. */
  redSmoke(at: THREE.Vector3) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.redSmokeTex, depthWrite: false, transparent: true }));
    sprite.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0, (Math.random() - 0.5) * 0.3));
    sprite.scale.setScalar(0.6);
    this.scene.add(sprite);
    const life = 5 + Math.random() * 3;
    this.puffs.push({ sprite, life, max: life, rise: 2.2 + Math.random(), grow: 1.1 });
  }

  /**
   * The supply plane flying over, from `from` to `to` at `speed` m/s, `elapsed` seconds into
   * its crossing already (if it set off before we heard).
   */
  plane(obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, speed: number, elapsed: number) {
    obj.position.copy(from);
    obj.lookAt(to);
    this.scene.add(obj);
    this.planes.push({ obj, from: from.clone(), to: to.clone(), t: elapsed, time: from.distanceTo(to) / speed, hum: this.engineHum() });
  }

  /** Four turbofans heard from the ground: a deep roar with a whine on top, fed into the mix. */
  private engineHum(): Plane['hum'] {
    const a = this.context();
    if (!a) return null;
    const { ctx, noise } = a;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const pan = ctx.createStereoPanner();
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const roar = ctx.createBiquadFilter();
    roar.type = 'lowpass';
    roar.frequency.value = 420;
    roar.Q.value = 0.7;
    const whine = ctx.createOscillator();
    whine.type = 'sawtooth';
    whine.frequency.value = 1180;
    const whineLevel = ctx.createGain();
    whineLevel.gain.value = 0.015;
    const throb = ctx.createOscillator();
    throb.type = 'triangle';
    throb.frequency.value = 58;
    const throbLevel = ctx.createGain();
    throbLevel.gain.value = 0.25;
    src.connect(roar).connect(gain);
    whine.connect(whineLevel).connect(gain);
    throb.connect(throbLevel).connect(gain);
    gain.connect(pan).connect(this.audio!.out);
    src.start();
    whine.start();
    throb.start();
    return {
      gain,
      pan,
      stop: () => {
        for (const n of [src, whine, throb]) n.stop();
        gain.disconnect();
      },
    };
  }

  /**
   * Something blowing up: a fireball and a flash that lights the area, a cloud of smoke,
   * debris thrown out, a boom that arrives late from far away, and a shake if it was close.
   */
  explosion(at: THREE.Vector3, item: 'beancan' | 'satchel' | 'c4' | 'car', floor: number) {
    const size = item === 'car' ? 2.2 : item === 'c4' ? 1.7 : item === 'satchel' ? 1.25 : 0.9;
    for (let n = 0; n < 6; n++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      sprite.position.copy(at).add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(0.8 * size));
      sprite.scale.setScalar(0.4 * size);
      this.scene.add(sprite);
      const max = 0.25 + Math.random() * 0.2;
      this.fireballs.push({ sprite, life: max, max, grow: (3 + Math.random() * 3) * size });
    }
    this.flashLight.position.copy(at).setY(at.y + 0.5);
    this.flashLight.distance = 30;
    this.flashLight.intensity = 45 * size;
    this.flashLife = 0.18;
    for (let n = 0; n < 9; n++) {
      const p = at.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(1.4 * size));
      this.puff(p, (1 + Math.random()) * size, 1.6 + Math.random() * 1.4);
    }
    this.chipsAt(at, 'stone', floor, Math.round(18 * size), 2.2 * size);
    if (this.listener) this.shake = Math.max(this.shake, size * Math.max(0, 1 - this.listener.position.distanceTo(at) / 25));
    const a = this.context();
    if (!a) return;
    const { near, pan, distance } = this.placed(at, 30);
    if (near < 0.01) return;
    const { ctx, noise } = a;
    // Sound takes its time to arrive from far away.
    const now = ctx.currentTime + 0.005 + distance / 343;
    const bus = this.voiceBus(pan, 0.35 + Math.min(0.45, distance / 120), 0.95);
    const v = near * Math.min(1.2, 0.6 + size * 0.35);
    this.noiseHit(bus, noise, now, 'highpass', 2200, 0.7, 0.7 * v * Math.max(0.25, 1 - distance / 60), 0.07);
    this.noiseHit(bus, noise, now, 'lowpass', 1100, 0.6, 1.1 * v, 0.55);
    this.noiseHit(bus, noise, now + 0.015, 'lowpass', 240, 0.8, 1.4 * v, 0.85);
    this.tone(bus, now, 'sine', 75, 26, 1.1 * v, 0.75);
    this.gravel(bus, now + 0.3, 0.25 * v, 20);
  }

  /** A door swinging: a wooden creak and knock, or a metal scrape and clang shut. */
  doorSound(open: boolean, metal: boolean, at: THREE.Vector3) {
    const a = this.context();
    if (!a) return;
    const { near, pan } = this.placed(at, 6);
    if (near < 0.05) return;
    const { ctx, noise } = a;
    const now = ctx.currentTime + 0.005;
    const bus = this.voiceBus(pan, 0.12);
    if (metal) {
      this.noiseHit(bus, noise, now, 'bandpass', 2200, 4, 0.18 * near, 0.3);
      if (!open) {
        this.thud(bus, now + 0.28, 90, 0.5 * near);
        this.ping(bus, now + 0.28, [210, 570, 1130, 1720], 0.08 * near, 0.6);
      }
    } else {
      this.tone(bus, now, 'sawtooth', open ? 380 : 300, open ? 260 : 210, 0.04 * near, 0.3);
      if (!open) {
        this.thud(bus, now + 0.28, 130, 0.45 * near);
        this.noiseHit(bus, noise, now + 0.28, 'bandpass', 900, 1.5, 0.3 * near, 0.08);
      }
    }
  }

  /** A charge's warning: C4's timer beeps; a satchel or beancan fuse hisses. */
  chargeSound(kind: 'beancan' | 'satchel' | 'c4', at: THREE.Vector3) {
    const a = this.context();
    if (!a) return;
    const { near, pan } = this.placed(at, 5);
    if (near < 0.08) return;
    const now = a.ctx.currentTime + 0.005;
    const bus = this.voiceBus(pan, 0.05);
    if (kind === 'c4') this.tone(bus, now, 'square', 2600, 2590, 0.05 * near, 0.07);
    else this.noiseHit(bus, a.noise, now, 'highpass', 3500, 0.7, 0.08 * near, 0.55);
  }

  /** Throws a grenade model along an arc from `from` to `to`, then calls `done`. */
  toss(obj: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3, done: () => void) {
    const time = Math.min(0.9, 0.15 + from.distanceTo(to) / 14);
    obj.position.copy(from);
    this.scene.add(obj);
    this.tosses.push({ obj, from: from.clone(), to: to.clone(), t: 0, time, done });
  }

  update(dt: number) {
    this.tracers = this.tracers.filter((t) => {
      t.life -= dt;
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(0.9, Math.max(0, t.life * 9));
      if (t.life > 0) return true;
      this.scene.remove(t.mesh);
      (t.mesh.material as THREE.Material).dispose();
      return false;
    });
    this.flashLife -= dt;
    if (this.flashLife <= 0) this.flashLight.intensity = 0;
    else if (this.flashLight.intensity > 20) this.flashLight.intensity *= Math.pow(0.02, dt);
    this.fireballs = this.fireballs.filter((f) => {
      f.life -= dt;
      const k = 1 - f.life / f.max;
      f.sprite.scale.setScalar(f.sprite.scale.x + f.grow * dt * (1 - k));
      f.sprite.material.opacity = Math.max(0, 1 - k * k);
      if (f.life > 0) return true;
      this.scene.remove(f.sprite);
      f.sprite.material.dispose();
      return false;
    });
    this.tosses = this.tosses.filter((s) => {
      s.t += dt;
      const k = Math.min(1, s.t / s.time);
      s.obj.position.lerpVectors(s.from, s.to, k);
      s.obj.position.y += Math.sin(k * Math.PI) * s.time * 2.2;
      s.obj.rotation.x += dt * 12;
      if (k < 1) return true;
      this.scene.remove(s.obj);
      s.done();
      return false;
    });
    this.flashes = this.flashes.filter((f) => {
      f.life -= dt;
      if (f.life > 0) return true;
      this.scene.remove(f.sprite);
      f.sprite.material.dispose();
      return false;
    });
    this.chips = this.chips.filter((c) => {
      c.life -= dt;
      c.v.y -= 9.8 * dt;
      c.mesh.position.addScaledVector(c.v, dt);
      if (c.mesh.position.y < c.floor) {
        c.mesh.position.y = c.floor;
        c.v.multiplyScalar(0.3).setY(Math.abs(c.v.y) * 0.3);
      }
      c.mesh.rotation.x += c.spin.x * dt;
      c.mesh.rotation.y += c.spin.y * dt;
      if (c.life < 0.2) c.mesh.scale.multiplyScalar(0.85);
      if (c.life > 0) return true;
      this.scene.remove(c.mesh);
      return false;
    });
    this.holes = this.holes.filter((h) => {
      h.life -= dt;
      if (h.life < 3) (h.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, h.life / 3);
      if (h.life > 0) return true;
      this.scene.remove(h.mesh);
      (h.mesh.material as THREE.Material).dispose();
      return false;
    });
    this.sparks = this.sparks.filter((p) => {
      p.life -= dt;
      p.v.y -= 9.8 * dt;
      p.mesh.position.addScaledVector(p.v, dt);
      p.mesh.lookAt(p.mesh.position.clone().add(p.v));
      if (p.life > 0) return true;
      this.scene.remove(p.mesh);
      return false;
    });
    this.shells = this.shells.filter((c) => {
      c.life -= dt;
      c.v.y -= 9.8 * dt;
      c.mesh.position.addScaledVector(c.v, dt);
      if (c.mesh.position.y < c.floor + 0.01) {
        c.mesh.position.y = c.floor + 0.01;
        c.v.multiplyScalar(0.25).setY(Math.abs(c.v.y) * 0.25);
        c.spin *= 0.4;
      }
      c.mesh.rotation.x += c.spin * dt;
      if (c.life > 0) return true;
      this.scene.remove(c.mesh);
      return false;
    });
    this.planes = this.planes.filter((p) => {
      p.t += dt;
      const k = p.t / p.time;
      p.obj.position.lerpVectors(p.from, p.to, Math.min(1, k));
      if (p.hum) {
        // Heard from far off and loudest overhead; it lags a little, like the real thing.
        const { near, pan } = this.placed(p.obj.position, 90);
        const ctx = this.audio!.ctx;
        p.hum.gain.gain.setTargetAtTime(0.5 * near * near, ctx.currentTime, 0.3);
        p.hum.pan.pan.setTargetAtTime(pan, ctx.currentTime, 0.3);
      }
      if (k < 1) return true;
      this.scene.remove(p.obj);
      p.hum?.stop();
      return false;
    });
    this.puffs = this.puffs.filter((p) => {
      p.life -= dt;
      const k = 1 - p.life / p.max;
      p.sprite.scale.setScalar(p.sprite.scale.x + dt * p.grow);
      p.sprite.position.y += dt * p.rise;
      p.sprite.material.opacity = 1 - k;
      if (p.life > 0) return true;
      this.scene.remove(p.sprite);
      p.sprite.material.dispose();
      return false;
    });
  }

  /**
   * A gunshot built from layers, like a recorded one: a sharp supersonic crack, a low punch
   * that drops in pitch, the noisy body of the blast, then an echo off the land. Far away the
   * crack fades first and the echo takes over. `pan` is -1 (left) to 1 (right).
   */
  sound(item: ItemId, distance: number, pan = 0) {
    const a = this.context();
    if (!a) return;
    const w = ITEMS[item].weapon;
    if (!w || w.class === 'melee') return;
    const { ctx, noise } = a;
    const now = ctx.currentTime + 0.005;
    const near = Math.min(1, 8 / Math.max(8, distance));
    if (near < 0.015) return;
    // Guns are the loudest thing in the wasteland: driven hard so a shot cracks over everything else.
    const echo = 0.22 + Math.min(0.6, distance / 120);
    // A recording of the real thing, duller and quieter with distance as the air soaks up the highs.
    if (this.play(`shot-${item}`, pan, echo, near * (w.class === 'bow' ? 0.8 : 1), 1, 16000 / (1 + distance / 35))) {
      const v = GUN_VOICES[item];
      if (v?.action === 'bolt' && distance < 25) this.play(`bolt-${item}`, pan, 0.05, Math.min(1, 6 / Math.max(6, distance)) * 0.6, 1, 18000, v.actionAt);
      return;
    }
    const bus = this.voiceBus(pan, echo, w.class === 'bow' ? 1.4 : 2.6);
    if (w.class === 'bow') {
      this.twang(bus, now, near, item === 'crossbow');
      return;
    }
    const v = GUN_VOICES[item] ?? GUN_VOICES.semiPistol!;
    const air = 1 + distance / 35;
    // The crack: a very short burst of bright noise.
    this.noiseHit(bus, noise, now, 'highpass', 1800, 0.7, v.crack * near * Math.min(1, 1.6 / air), 0.03);
    // The punch: a thump that drops from a knock to a deep thud.
    const boom = ctx.createOscillator();
    boom.type = 'sine';
    boom.frequency.setValueAtTime(v.boomHz * 2.6, now);
    boom.frequency.exponentialRampToValueAtTime(v.boomHz * 0.55, now + 0.16);
    const boomGain = ctx.createGain();
    boomGain.gain.setValueAtTime(v.boom * near * 1.1, now);
    boomGain.gain.exponentialRampToValueAtTime(0.0005, now + 0.12 + v.tail * 0.25);
    boom.connect(boomGain).connect(bus);
    boom.start(now);
    boom.stop(now + 0.6 + v.tail);
    // The blast: filtered noise that rings on for heavier guns, duller with distance.
    this.noiseHit(bus, noise, now, 'lowpass', v.bodyHz / air, 0.8, v.body * near, 0.06 + v.tail * 0.5);
    this.noiseHit(bus, noise, now + 0.004, 'bandpass', 700, 1.2, v.body * near * 0.6, 0.05 + v.tail * 0.2);
    // Working the action: bolt, pump or a break-open click, heard only close by.
    if (v.action && distance < 25) {
      const q = Math.min(1, 6 / Math.max(6, distance)) * 0.5;
      const t = now + v.actionAt!;
      if (v.action === 'bolt') {
        this.click(bus, t, 2600, q);
        this.click(bus, t + 0.12, 1700, q * 0.9);
        this.click(bus, t + 0.32, 2100, q * 0.8);
        this.click(bus, t + 0.42, 3000, q);
      } else if (v.action === 'pump') {
        this.noiseHit(bus, noise, t, 'bandpass', 900, 2, q * 0.8, 0.07);
        this.click(bus, t + 0.16, 1400, q);
      } else {
        this.click(bus, t, 2200, q * 0.7);
      }
    }
  }

  /** The sound you hear when your shot lands: a thud, a ping off a helmet, a deeper knock for a kill. */
  hitSound(head: boolean, kill = false, armour = false) {
    const a = this.context();
    if (!a) return;
    const { ctx, noise } = a;
    const now = ctx.currentTime + 0.005;
    const bus = this.voiceBus(0, 0.08, 1.3);
    this.thud(bus, now, 150, 0.45);
    this.noiseHit(bus, noise, now, 'bandpass', 2400, 1.5, 0.25, 0.025);
    if (head) this.ping(bus, now, armour ? [1900, 2870, 4100] : [2350, 3520], armour ? 0.18 : 0.14, armour ? 0.4 : 0.28);
    else if (armour) this.ping(bus, now, [1500, 2260], 0.12, 0.18);
    if (kill) this.thud(bus, now + 0.06, 80, 0.5);
  }

  /** You were hit: a dull blow, with a clank if your armour took it. */
  hurtSound(armour: boolean) {
    const a = this.context();
    if (!a) return;
    const { ctx, noise } = a;
    const now = ctx.currentTime + 0.005;
    const bus = this.voiceBus(0, 0.05, 0.9);
    this.thud(bus, now, 95, 0.6);
    this.noiseHit(bus, noise, now, 'lowpass', 500, 0.7, 0.5, 0.12);
    if (armour) this.ping(bus, now, [880, 1330, 2010], 0.12, 0.3);
  }

  /** The hollow click of pulling the trigger on an empty gun. */
  dryFire() {
    const a = this.context();
    if (!a) return;
    this.click(this.voiceBus(0, 0.05), a.ctx.currentTime + 0.005, 2400, 0.45);
  }

  /** Reloading: the magazine out, the new one in, then the charging handle. */
  reloadSound(seconds: number) {
    const a = this.context();
    if (!a) return;
    const now = a.ctx.currentTime + 0.005;
    const bus = this.voiceBus(0, 0.05, 0.3);
    this.click(bus, now + 0.15, 1500, 0.35);
    this.noiseHit(bus, a.noise, now + 0.2, 'bandpass', 600, 1.5, 0.15, 0.08);
    this.click(bus, now + seconds * 0.62, 1800, 0.45);
    this.click(bus, now + seconds * 0.64, 1200, 0.3);
    this.click(bus, now + seconds * 0.85, 2600, 0.4);
    this.click(bus, now + seconds * 0.85 + 0.09, 3200, 0.45);
  }

  /**
   * Plays a recorded sound, if it has loaded: panned, through a filter that takes off the highs
   * (distance), with some sent to the echo. `rate` speeds it up (higher, shorter) or slows it.
   * Returns false when the recording is not ready, so the caller can make the sound itself.
   */
  private play(name: string, pan: number, echo: number, level: number, rate = 1, bright = 18000, delay = 0): boolean {
    const buffer = this.samples.get(name);
    if (!buffer || !this.audio) return false;
    const { ctx, out, reverb } = this.audio;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = Math.max(300, Math.min(20000, bright));
    const gain = ctx.createGain();
    gain.gain.value = level;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(filter).connect(gain).connect(panner).connect(out);
    const send = ctx.createGain();
    send.gain.value = echo;
    panner.connect(send).connect(reverb);
    src.start(ctx.currentTime + 0.005 + delay);
    return true;
  }

  /** Fetches the recordings now and decodes them once there is an audio context to decode into. */
  private loadSamples() {
    if (this.loading) return;
    this.loading = Promise.all(['/sounds/index.json', '/sounds/world.json'].map((list) => fetch(list).then((r) => r.json() as Promise<string[]>).catch(() => [] as string[])))
      .then((lists) => lists.flat())
      .then((names) =>
        Promise.all(
          names.map(async (name) => {
            const bytes = await (await fetch(`/sounds/${name}.mp3`)).arrayBuffer();
            const ctx = await this.ready;
            this.samples.set(name, await ctx.decodeAudioData(bytes));
          }),
        ),
      )
      .catch(() => undefined);
  }

  /** A voice's path out: through a little saturation, panned, with some sent to the echo. */
  /** Each running car's engine: a low growl that climbs with its speed. */
  private engines = new Map<number, { level: GainNode; pan: StereoPannerNode; low: OscillatorNode; high: OscillatorNode; filter: BiquadFilterNode }>();

  /**
   * Keeps a car's engine sound going at `at`: `load` from 0 (idling) to 1 (flat out), or off with
   * null (and gone for good once the car is).
   */
  engine(id: number, at: THREE.Vector3 | null, load: number | null) {
    let e = this.engines.get(id);
    if (load === null || !at) {
      if (e) {
        e.level.gain.setTargetAtTime(0, e.level.context.currentTime, 0.15);
        const old = e;
        setTimeout(() => [old.low, old.high].forEach((o) => o.stop()), 800);
        this.engines.delete(id);
      }
      return;
    }
    const a = this.context();
    if (!a) return;
    const { ctx } = a;
    if (!e) {
      // Two rough oscillators a fifth apart through a low-pass: a tired old straight-six.
      const low = ctx.createOscillator();
      low.type = 'sawtooth';
      const high = ctx.createOscillator();
      high.type = 'square';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.value = 2;
      const mix = ctx.createGain();
      mix.gain.value = 0.5;
      const level = ctx.createGain();
      level.gain.value = 0;
      const pan = ctx.createStereoPanner();
      low.connect(filter);
      high.connect(mix).connect(filter);
      filter.connect(level).connect(pan).connect(this.audio!.out);
      low.start();
      high.start();
      e = { level, pan, low, high, filter };
      this.engines.set(id, e);
    }
    const { near, pan } = this.placed(at, 10);
    const t = ctx.currentTime;
    const hz = 34 + load * 70;
    e.low.frequency.setTargetAtTime(hz, t, 0.12);
    e.high.frequency.setTargetAtTime(hz * 1.5 + 1.3, t, 0.12);
    e.filter.frequency.setTargetAtTime(260 + load * 900, t, 0.12);
    e.level.gain.setTargetAtTime(near * (0.07 + load * 0.08), t, 0.1);
    e.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.1);
  }

  /** A car slamming into something. */
  /** A bright rising chime for a finished objective. */
  objective() {
    if (!this.audio) return;
    const { ctx, out } = this.audio;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const gain = ctx.createGain();
      const start = t + i * 0.08;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.6);
      osc.connect(gain).connect(out);
      osc.start(start);
      osc.stop(start + 0.65);
    });
  }

  crash(at: THREE.Vector3, speed: number) {
    this.gatherSound('scrap', at);
    if (speed > 8) this.gatherSound('scrap', at, true);
  }

  private voiceBus(pan: number, echo: number, drive = 0.55): AudioNode {
    const { ctx, out, reverb } = this.audio!;
    const input = ctx.createGain();
    // Drive pushes the voice harder into the saturation: louder and denser, but never past full scale.
    input.gain.value = drive;
    const shaper = ctx.createWaveShaper();
    shaper.curve = SATURATION;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    input.connect(shaper).connect(panner).connect(out);
    const send = ctx.createGain();
    send.gain.value = echo;
    panner.connect(send).connect(reverb);
    return input;
  }

  private noiseHit(bus: AudioNode, noise: AudioBuffer, at: number, type: BiquadFilterType, freq: number, q: number, level: number, length: number) {
    if (level < 0.002) return;
    const ctx = this.audio!.ctx;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = Math.max(40, Math.min(18000, freq));
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.0015);
    gain.gain.exponentialRampToValueAtTime(0.0005, at + length);
    src.connect(filter).connect(gain).connect(bus);
    src.start(at, Math.random() * Math.max(0, 0.9 - length), length + 0.05);
  }

  private thud(bus: AudioNode, at: number, hz: number, level: number) {
    const ctx = this.audio!.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(hz * 1.8, at);
    osc.frequency.exponentialRampToValueAtTime(hz * 0.5, at + 0.09);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0005, at + 0.14);
    osc.connect(gain).connect(bus);
    osc.start(at);
    osc.stop(at + 0.2);
  }

  /** Struck metal: a few inharmonic partials that ring and fade. */
  private ping(bus: AudioNode, at: number, partials: number[], level: number, length: number) {
    const ctx = this.audio!.ctx;
    partials.forEach((hz, i) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = hz;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(level / (1 + i * 0.6), at);
      gain.gain.exponentialRampToValueAtTime(0.0005, at + length / (1 + i * 0.3));
      osc.connect(gain).connect(bus);
      osc.start(at);
      osc.stop(at + length + 0.05);
    });
  }

  private click(bus: AudioNode, at: number, hz: number, level: number) {
    this.noiseHit(bus, this.audio!.noise, at, 'bandpass', hz, 6, level * 1.5, 0.018);
    this.noiseHit(bus, this.audio!.noise, at, 'highpass', 5000, 0.7, level * 0.5, 0.006);
  }

  /** A bow or crossbow string: a low snap and the whoosh of the arrow leaving. */
  private twang(bus: AudioNode, at: number, near: number, crossbow: boolean) {
    const { ctx, noise } = this.audio!;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(crossbow ? 240 : 170, at);
    osc.frequency.exponentialRampToValueAtTime(crossbow ? 120 : 95, at + 0.25);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.35 * near, at);
    gain.gain.exponentialRampToValueAtTime(0.0005, at + 0.3);
    osc.connect(gain).connect(bus);
    osc.start(at);
    osc.stop(at + 0.35);
    if (crossbow) this.click(bus, at, 1800, 0.4 * near);
    this.noiseHit(bus, noise, at + 0.01, 'bandpass', 1400, 1, 0.22 * near, 0.18);
  }

  private context(): { ctx: AudioContext; noise: AudioBuffer } | null {
    if (!this.audio) {
      try {
        const ctx = new AudioContext();
        const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        // Everything goes through a compressor, so bursts of fire punch without clipping.
        const out = ctx.createDynamicsCompressor();
        out.threshold.value = -16;
        out.knee.value = 6;
        out.ratio.value = 5;
        out.attack.value = 0.002;
        out.release.value = 0.18;
        // Make-up gain after the compressor, then a limiter so stacked shots never clip.
        const master = ctx.createGain();
        master.gain.value = 2;
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -3;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.1;
        out.connect(master).connect(limiter).connect(ctx.destination);
        // The echo: a long, darkening tail like a shot rolling across open ground.
        const reverb = ctx.createConvolver();
        reverb.buffer = echoImpulse(ctx);
        reverb.connect(out);
        this.audio = { ctx, noise, out, reverb };
        this.gotContext(ctx);
      } catch {
        return null;
      }
    }
    if (this.audio.ctx.state === 'suspended') void this.audio.ctx.resume();
    return this.audio;
  }
}

/**
 * Each melee tool's recorded swing and strikes (on wood, and on rock or metal), as a recording in
 * client/public/sounds and how fast to play it: a heavy pick slower and deeper, a light blade quicker.
 */
const MELEE_SOUNDS: Partial<Record<ItemId, { swing: [string, number]; wood: [string, number]; stone: [string, number] }>> = {
  rock: { swing: ['swing-light', 1.15], wood: ['hit-chop2', 0.7], stone: ['hit-rock', 1] },
  stoneHatchet: { swing: ['swing-axe', 1], wood: ['hit-chop', 1], stone: ['hit-stone', 1] },
  stonePickaxe: { swing: ['swing-heavy', 0.95], wood: ['hit-chop2', 0.9], stone: ['hit-stone', 0.85] },
  salvagedAxe: { swing: ['swing-axe2', 1], wood: ['hit-axe', 1], stone: ['hit-pick', 1.15] },
  salvagedPickaxe: { swing: ['swing-heavy2', 1], wood: ['hit-axe', 0.85], stone: ['hit-pick', 1] },
  torch: { swing: ['swing-light', 1], wood: ['hit-chop2', 0.9], stone: ['hit-rock', 1.1] },
  machete: { swing: ['swing-blade', 1.1], wood: ['hit-blade', 1.1], stone: ['hit-clang', 1.15] },
  salvagedSword: { swing: ['swing-sword', 1], wood: ['hit-blade', 0.9], stone: ['hit-clang', 0.95] },
  woodenSpear: { swing: ['swing-thrust', 1], wood: ['hit-stab', 1], stone: ['hit-stone', 1.25] },
  stoneSpear: { swing: ['swing-thrust2', 1], wood: ['hit-stab', 0.9], stone: ['hit-stone', 1.1] },
  combatKnife: { swing: ['swing-knife', 1.1], wood: ['hit-knife', 1], stone: ['hit-clang', 1.3] },
  nailBat: { swing: ['swing-bat', 1], wood: ['hit-bat', 1], stone: ['hit-rock', 0.8] },
  fireAxe: { swing: ['swing-fireAxe', 0.95], wood: ['hit-split', 1], stone: ['hit-pick', 0.9] },
  sledgehammer: { swing: ['swing-sledge', 0.9], wood: ['hit-bat', 0.75], stone: ['hit-sledge', 1] },
};

/** How each gun sounds: the level of each layer, the pitch of its punch, how long it rings and how its action works. */
interface GunVoice {
  crack: number;
  boom: number;
  boomHz: number;
  body: number;
  bodyHz: number;
  /** Extra ring-out, in seconds. */
  tail: number;
  action?: 'bolt' | 'pump' | 'break';
  actionAt?: number;
}

const GUN_VOICES: Partial<Record<ItemId, GunVoice>> = {
  eoka: { crack: 0.4, boom: 1, boomHz: 85, body: 0.9, bodyHz: 1600, tail: 0.5 },
  waterpipe: { crack: 0.45, boom: 1.1, boomHz: 75, body: 1, bodyHz: 1800, tail: 0.55, action: 'break', actionAt: 0.6 },
  revolver: { crack: 0.85, boom: 0.85, boomHz: 125, body: 0.7, bodyHz: 3400, tail: 0.3 },
  semiPistol: { crack: 0.9, boom: 0.7, boomHz: 150, body: 0.6, bodyHz: 3800, tail: 0.22 },
  doubleBarrel: { crack: 0.7, boom: 1.25, boomHz: 68, body: 1, bodyHz: 2400, tail: 0.6 },
  pumpShotgun: { crack: 0.75, boom: 1.2, boomHz: 72, body: 0.95, bodyHz: 2600, tail: 0.55, action: 'pump', actionAt: 0.3 },
  thompson: { crack: 0.65, boom: 0.85, boomHz: 115, body: 0.6, bodyHz: 2600, tail: 0.18 },
  customSmg: { crack: 0.7, boom: 0.65, boomHz: 155, body: 0.5, bodyHz: 3400, tail: 0.14 },
  mp5: { crack: 0.7, boom: 0.6, boomHz: 165, body: 0.5, bodyHz: 3600, tail: 0.14 },
  semiRifle: { crack: 1, boom: 0.9, boomHz: 110, body: 0.7, bodyHz: 4200, tail: 0.38 },
  lr300: { crack: 1, boom: 0.85, boomHz: 112, body: 0.65, bodyHz: 4400, tail: 0.3 },
  assaultRifle: { crack: 1.15, boom: 1.05, boomHz: 95, body: 0.75, bodyHz: 3800, tail: 0.35 },
  m249: { crack: 1.1, boom: 1.05, boomHz: 92, body: 0.75, bodyHz: 3600, tail: 0.3 },
  boltRifle: { crack: 1.35, boom: 1.25, boomHz: 72, body: 0.85, bodyHz: 4600, tail: 0.9, action: 'bolt', actionAt: 0.55 },
  l96: { crack: 1.45, boom: 1.35, boomHz: 64, body: 0.9, bodyHz: 5000, tail: 1.1, action: 'bolt', actionAt: 0.7 },
};

/** A soft tanh curve: drives the layers together into a denser, louder blast. */
const SATURATION = (() => {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2);
  }
  return curve;
})();

/** Decaying stereo noise with a few slap-back echoes, losing its highs as it fades. */
function echoImpulse(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 2.2);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / ctx.sampleRate;
      // Smooth the noise more as time goes on, so the tail darkens.
      const smooth = Math.min(0.97, 0.3 + t * 0.5);
      low = low * smooth + (Math.random() * 2 - 1) * (1 - smooth);
      data[i] = low * Math.exp(-t * 2.4) * (t < 0.012 ? t / 0.012 : 1);
    }
    // Slap-backs off distant rocks and ruins.
    for (const [at, level] of [
      [0.11 + ch * 0.013, 0.5],
      [0.27 - ch * 0.02, 0.32],
      [0.48 + ch * 0.03, 0.2],
    ]) {
      const start = Math.floor(at * ctx.sampleRate);
      for (let i = 0; i < 400; i++) data[start + i] += (Math.random() * 2 - 1) * level * Math.exp(-i / 90);
    }
  }
  return buffer;
}

function radialTexture(inner: string, mid: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, mid);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A bullet hole: a dark pit with a ring of crushed or splintered surface round it. */
const holeTextures = new Map<Surface, THREE.Texture>();
function holeTexture(surface: Surface): THREE.Texture {
  const known = holeTextures.get(surface);
  if (known) return known;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const ring: Record<Surface, string> = {
    wood: 'rgba(200,160,110,0.55)',
    stone: 'rgba(210,205,195,0.5)',
    ore: 'rgba(210,205,195,0.5)',
    scrap: 'rgba(200,190,175,0.6)',
    hemp: 'rgba(60,70,40,0.4)',
    dirt: 'rgba(30,24,18,0.7)',
  };
  // Torn edge.
  ctx.fillStyle = ring[surface];
  ctx.beginPath();
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 9) {
    const r = 15 + Math.random() * 9;
    ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  ctx.fill();
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 13);
  g.addColorStop(0, 'rgba(8,6,5,1)');
  g.addColorStop(0.55, 'rgba(18,14,11,0.95)');
  g.addColorStop(1, 'rgba(30,24,18,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  holeTextures.set(surface, tex);
  return tex;
}
