// The customise panel on the join screen: a row per part of the survivor's look with arrows to
// step through its options, and a turning preview of the survivor dressed in them. The pick is
// remembered in this browser for next time.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LOOK_KEYS, LOOK_PARTS, type Look, type LookPart, cleanLook, defaultLook, randomLook } from '../../shared/look.ts';
import { Avatar } from './avatar.ts';

const STORE = 'pf-look';
/** The armband colour shown in the preview; the server picks the real one on joining. */
const PREVIEW_ACCENT = 0xa4553a;

export class LookPicker {
  look: Look;
  private value = new Map<LookPart, HTMLElement>();
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
  private avatar: Avatar | null = null;
  private ready = false;
  private frame = 0;

  constructor(modelsReady: Promise<void>) {
    let saved: unknown = null;
    try {
      saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    } catch {
      /* storage unavailable */
    }
    this.look = saved ? cleanLook(saved) : defaultLook();

    const rows = document.getElementById('look-rows')!;
    for (const part of LOOK_KEYS) {
      const row = document.createElement('div');
      row.className = 'look-row';
      const label = document.createElement('span');
      label.className = 'look-label';
      label.textContent = LOOK_PARTS[part].label;
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.textContent = '‹';
      prev.setAttribute('aria-label', `Previous ${LOOK_PARTS[part].label.toLowerCase()}`);
      const value = document.createElement('span');
      value.className = 'look-value';
      const next = document.createElement('button');
      next.type = 'button';
      next.textContent = '›';
      next.setAttribute('aria-label', `Next ${LOOK_PARTS[part].label.toLowerCase()}`);
      const n = LOOK_PARTS[part].options.length;
      prev.addEventListener('click', () => this.set({ ...this.look, [part]: (this.look[part] + n - 1) % n }));
      next.addEventListener('click', () => this.set({ ...this.look, [part]: (this.look[part] + 1) % n }));
      row.append(label, prev, value, next);
      rows.append(row);
      this.value.set(part, value);
    }
    document.getElementById('look-random')!.addEventListener('click', () => this.set(randomLook()));
    document.getElementById('look-reset')!.addEventListener('click', () => this.set(defaultLook()));
    this.showValues();

    const canvas = document.getElementById('look-preview') as HTMLCanvasElement;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      canvas.hidden = true;
      return;
    }
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene.environment = new THREE.PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    this.scene.add(new THREE.HemisphereLight(0xdde4ee, 0x6a5a48, 1.6));
    const sun = new THREE.DirectionalLight(0xfff0dd, 2.2);
    sun.position.set(1.5, 3, 2.5);
    this.scene.add(sun);
    this.camera.position.set(0, 1.15, 4.2);
    this.camera.lookAt(0, 0.92, 0);
    modelsReady.then(() => {
      this.ready = true;
      this.dress();
    });
    let last = performance.now();
    const tick = (now: number) => {
      this.frame = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this.draw(dt);
    };
    this.frame = requestAnimationFrame(tick);
  }

  /** Stops the preview once the game starts. */
  dispose() {
    cancelAnimationFrame(this.frame);
    this.renderer?.dispose();
    this.renderer = null;
  }

  private set(look: Look) {
    this.look = look;
    try {
      localStorage.setItem(STORE, JSON.stringify(look));
    } catch {
      /* storage unavailable */
    }
    this.showValues();
    this.dress();
  }

  private showValues() {
    for (const part of LOOK_KEYS) this.value.get(part)!.textContent = LOOK_PARTS[part].options[this.look[part]][0];
  }

  /** Swaps the preview survivor for one in the current look, keeping its turn. */
  private dress() {
    if (!this.ready || !this.renderer) return;
    const turn = this.avatar?.root.rotation.y ?? 0.5;
    if (this.avatar) this.scene.remove(this.avatar.root);
    this.avatar = new Avatar(PREVIEW_ACCENT, undefined, this.look);
    this.avatar.root.rotation.y = turn;
    this.scene.add(this.avatar.root);
  }

  private draw(dt: number) {
    const r = this.renderer;
    if (!r) return;
    const canvas = r.domElement;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * r.getPixelRatio()) || canvas.height !== Math.round(h * r.getPixelRatio())) {
      r.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.avatar) {
      this.avatar.root.rotation.y += dt * 0.5;
      this.avatar.update(dt, false);
    }
    r.render(this.scene, this.camera);
  }
}
