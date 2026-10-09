// The main menu's stage and locker: a row per part of the survivor's look with arrows to step
// through its options, and the survivor (or, in the garage, your car) turning slowly behind the
// menus. The pick is remembered in this browser for next time.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { LOOK_KEYS, LOOK_PARTS, type Look, type LookPart, cleanLook, defaultLook, randomLook } from '../../shared/look.ts';
import type { VehicleKind } from '../../shared/vehicles.ts';
import { Avatar } from './avatar.ts';
import { Vehicles } from './vehicles.ts';

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
  /** What stands on the stage: the survivor, or a car on its turntable. */
  private showing: 'survivor' | 'car' | 'none' = 'survivor';
  private turntable = new THREE.Group();
  private cars: Vehicles | null = null;
  private car: { kind: VehicleKind; paint: number } = { kind: 'pickup', paint: 0 };

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
    // A dark disc for the survivor or car to stand on, with a warm rim light from behind.
    const glow = document.createElement('canvas');
    glow.width = glow.height = 128;
    const g = glow.getContext('2d')!;
    const fade = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    fade.addColorStop(0, 'rgba(0,0,0,0.9)');
    fade.addColorStop(0.55, 'rgba(0,0,0,0.6)');
    fade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = fade;
    g.fillRect(0, 0, 128, 128);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(2.4, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(glow), transparent: true, depthWrite: false }),
    );
    this.scene.add(floor);
    const rim = new THREE.DirectionalLight(0xff9a50, 2.4);
    rim.position.set(-2, 2.5, -3);
    this.scene.add(rim);
    this.scene.add(this.turntable);
    this.frameShot();
    modelsReady.then(() => {
      this.ready = true;
      this.dress();
      this.cars = new Vehicles(this.turntable as unknown as THREE.Scene, { engine() {}, puff() {} } as never, 0);
      this.park();
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
    this.avatar.root.visible = this.showing === 'survivor';
    this.scene.add(this.avatar.root);
  }

  /** Shows the survivor, or a car in the given model and paint. */
  show(what: 'survivor' | 'car' | 'none', car = this.car) {
    this.showing = what;
    this.car = car;
    if (this.avatar) this.avatar.root.visible = what === 'survivor';
    this.turntable.visible = what === 'car';
    this.park();
    this.frameShot();
  }

  /** Puts your car on the turntable. */
  private park() {
    if (!this.cars) return;
    this.cars.sync([{ id: 1, kind: this.car.kind, x: 0, y: 0, z: 0, yaw: 0, hp: 1, fuel: 1, paint: this.car.paint }]);
    this.turntable.visible = this.showing === 'car';
  }

  /** Frames the survivor or the car a little left of the middle, clear of the menus on the right. */
  private frameShot() {
    if (this.showing === 'car') {
      this.camera.position.set(0, 3.2, 11.5);
      this.camera.lookAt(0, 0.6, 0);
    } else {
      this.camera.position.set(0, 1.7, 6.2);
      this.camera.lookAt(0, 0.9, 0);
    }
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
      // On a wide screen the subject stands left of centre, clear of the menus on the right.
      const shift = w > 760 ? w * 0.14 : 0;
      this.camera.setViewOffset(w, h, shift, w > 760 ? 0 : h * 0.12, w, h);
      this.camera.updateProjectionMatrix();
    }
    if (this.avatar) {
      this.avatar.root.rotation.y += dt * 0.5;
      this.avatar.update(dt, false);
    }
    this.turntable.rotation.y += dt * 0.35;
    r.render(this.scene, this.camera);
  }
}
