// Short-lived combat effects: bullet tracers, muzzle flashes, dust puffs where shots land,
// and synthesised combat sounds (no audio files: layered noise and tones shaped per weapon).

import * as THREE from 'three';
import { ITEMS, type ItemId } from '../../shared/items.ts';

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
}

/** A unit-length streak along +y, stretched and turned to fit each shot. */
const TRACER_GEO = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
const UP = new THREE.Vector3(0, 1, 0);

interface Puff {
  sprite: THREE.Sprite;
  life: number;
  max: number;
}

export class Effects {
  private tracers: Tracer[] = [];
  private puffs: Puff[] = [];
  private flashes: { sprite: THREE.Sprite; life: number }[] = [];
  /** One light reused for every muzzle flash: adding and removing lights makes three.js recompile shaders. */
  private flashLight = new THREE.PointLight(0xffa860, 0, 7, 1.6);
  private flashLife = 0;
  private tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  private arrowMat = new THREE.MeshBasicMaterial({ color: 0x6a5030, transparent: true });
  private flashTex = radialTexture('rgba(255,236,170,1)', 'rgba(255,140,40,0.6)', 'rgba(255,120,30,0)');
  private dustTex = radialTexture('rgba(150,135,110,0.75)', 'rgba(120,110,95,0.35)', 'rgba(120,110,95,0)');
  private audio: { ctx: AudioContext; noise: AudioBuffer; out: AudioNode; reverb: ConvolverNode } | null = null;

  constructor(private scene: THREE.Scene) {
    scene.add(this.flashLight);
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

  /** A bright flash and a flicker of light at the muzzle. */
  muzzle(at: THREE.Vector3, item: ItemId) {
    if (ITEMS[item].weapon?.class !== 'gun') return;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sprite.position.copy(at);
    sprite.scale.setScalar(0.35 + Math.random() * 0.15);
    this.flashLight.position.copy(at);
    this.flashLight.intensity = 8;
    this.flashLife = 0.05;
    this.scene.add(sprite);
    this.flashes.push({ sprite, life: 0.05 });
  }

  puff(at: THREE.Vector3, size: number) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.dustTex, depthWrite: false, transparent: true }));
    sprite.position.copy(at);
    sprite.scale.setScalar(size);
    this.scene.add(sprite);
    this.puffs.push({ sprite, life: 0.6, max: 0.6 });
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
    this.flashes = this.flashes.filter((f) => {
      f.life -= dt;
      if (f.life > 0) return true;
      this.scene.remove(f.sprite);
      f.sprite.material.dispose();
      return false;
    });
    this.puffs = this.puffs.filter((p) => {
      p.life -= dt;
      const k = 1 - p.life / p.max;
      p.sprite.scale.setScalar(p.sprite.scale.x + dt * 0.8);
      p.sprite.position.y += dt * 0.3;
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
    const bus = this.voiceBus(pan, 0.22 + Math.min(0.6, distance / 120));
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
    const bus = this.voiceBus(0, 0.08);
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
    const bus = this.voiceBus(0, 0.05);
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
    const bus = this.voiceBus(0, 0.05);
    this.click(bus, now + 0.15, 1500, 0.35);
    this.noiseHit(bus, a.noise, now + 0.2, 'bandpass', 600, 1.5, 0.15, 0.08);
    this.click(bus, now + seconds * 0.62, 1800, 0.45);
    this.click(bus, now + seconds * 0.64, 1200, 0.3);
    this.click(bus, now + seconds * 0.85, 2600, 0.4);
    this.click(bus, now + seconds * 0.85 + 0.09, 3200, 0.45);
  }

  /** A voice's path out: through a little saturation, panned, with some sent to the echo. */
  private voiceBus(pan: number, echo: number): AudioNode {
    const { ctx, out, reverb } = this.audio!;
    const input = ctx.createGain();
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
    this.noiseHit(bus, this.audio!.noise, at, 'bandpass', hz, 6, level * 2.2, 0.018);
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
        const master = ctx.createGain();
        master.gain.value = 0.8;
        out.connect(master).connect(ctx.destination);
        // The echo: a long, darkening tail like a shot rolling across open ground.
        const reverb = ctx.createConvolver();
        reverb.buffer = echoImpulse(ctx);
        reverb.connect(out);
        this.audio = { ctx, noise, out, reverb };
      } catch {
        return null;
      }
    }
    if (this.audio.ctx.state === 'suspended') void this.audio.ctx.resume();
    return this.audio;
  }
}

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
