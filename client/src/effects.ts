// Short-lived combat effects: bullet tracers, muzzle flashes, dust puffs where shots land,
// and synthesised gunshot sounds (no audio files: filtered noise shaped per weapon).

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
  private audio: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

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

  /** A gunshot, quieter and duller the further away it is. */
  sound(item: ItemId, distance: number) {
    const ctx = this.context();
    if (!ctx || !this.noise) return;
    const w = ITEMS[item].weapon;
    if (!w) return;
    const now = ctx.currentTime;
    const volume = Math.min(1, 6 / Math.max(6, distance)) * (w.class === 'bow' ? 0.25 : 0.55);
    if (volume < 0.02) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    // Heavier guns sound deeper; distance takes the crack off the top.
    const heavy = Math.min(1, w.damage * (w.pellets ?? 1) / 120);
    filter.frequency.value = (w.class === 'bow' ? 1800 : 5200 - heavy * 2600) / (1 + distance / 40);
    const gain = ctx.createGain();
    const length = w.class === 'bow' ? 0.12 : 0.18 + heavy * 0.35;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + length);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(now, Math.random() * 0.5, length + 0.05);
  }

  /** The tick you hear when your shot lands; higher for headshots. */
  hitSound(head: boolean) {
    const ctx = this.context();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.value = head ? 1400 : 900;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  private context(): AudioContext | null {
    if (!this.audio) {
      try {
        this.audio = new AudioContext();
        const buffer = this.audio.createBuffer(1, this.audio.sampleRate, this.audio.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        this.noise = buffer;
      } catch {
        return null;
      }
    }
    if (this.audio.state === 'suspended') void this.audio.resume();
    return this.audio;
  }
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
