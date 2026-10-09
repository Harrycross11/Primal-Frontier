// The main menu's backdrop: the real wasteland from the server's own seed, drawn by the game's
// renderer, with your survivor standing by your car outside a landmark in the low evening sun.
// Each tab has its own camera shot, and the camera eases between them. Pressing Play hands the
// world and renderer straight to the game, so nothing has to load twice.

import * as THREE from 'three';
import type { Look } from '../../shared/look.ts';
import { PAINTS } from '../../shared/paint.ts';
import { DAY_MS, sunPath } from '../../shared/sky.ts';
import { BIOMES, BIOME_IDS } from '../../shared/biomes.ts';
import { LANDMARKS } from '../../shared/landmarks.ts';
import { landmarkSites, terrainHeight } from '../../shared/terrain.ts';
import { generateResources } from '../../shared/world.ts';
import { VEHICLES, vehicleSpots, type VehicleKind } from '../../shared/vehicles.ts';
import { Avatar } from './avatar.ts';
import { DayNight } from './daynight.ts';
import { Graphics } from './graphics.ts';
import { Vehicles } from './vehicles.ts';
import { World } from './world.ts';

/** The armband colour shown on the menu; the server picks the real one on joining. */
const MENU_ACCENT = 0xa4553a;

/** Points in the day the menu may be set at: late afternoon to just before sunset (0 is sunrise). */
const EVENINGS = [0.6, 0.62, 0.64, 0.66, 0.68];

/** Which way the sun lies along the ground at a point in the day (radians, as atan2(x, z)). */
function sunAzimuth(phase: number): number {
  // As in DayNight: the sun swings from 100 to 260 degrees round the sky over the day.
  const { across } = sunPath((phase - 0.12) * DAY_MS);
  return THREE.MathUtils.degToRad(100 + across * 160);
}

export type Shot = 'play' | 'store' | 'character' | 'car';

/** Where the camera sits and looks for a shot, in the scene's own frame (see `frame`). */
interface Framing {
  from: THREE.Vector3;
  to: THREE.Vector3;
  fov: number;
  /** How far left of the middle of the screen the subject sits, as a share of the width. */
  shift: number;
  /** How far away things are sharpest (by default, whatever the camera looks at). */
  focus?: number;
}

/** What each store pack is shown on, and in which of its paints. */
const PACK_SHOTS: Record<string, { kind: VehicleKind; paint: number }> = {
  chrome: { kind: 'sedan', paint: 16 },
  neon: { kind: 'pickup', paint: 21 },
  camo: { kind: 'jeep', paint: 24 },
  legend: { kind: 'van', paint: 31 },
  /** The news card's picture: an old pickup as found. */
  news: { kind: 'pickup', paint: 0 },
};

export class MenuStage {
  readonly world: World;
  readonly gfx: Graphics;
  readonly dayNight: DayNight;
  private avatar: Avatar;
  private cars: Vehicles;
  private car: { kind: VehicleKind; paint: number };
  private shot: Shot = 'play';
  private eye = new THREE.Vector3();
  private aim = new THREE.Vector3();
  private fov = 40;
  private shift = 0;
  private focus = 5;
  private time = 0;
  private started = false;
  /** Where the car is parked, which way the shot looks back from, and across it. */
  private spot: THREE.Vector3;
  private out: THREE.Vector3;
  private side: THREE.Vector3;
  private heading: number;
  /** The landmark the scene is set at, and its land. */
  readonly place: { landmark: string; land: string };
  /** A soft key light on the survivor, as in a photo shoot, so their face isn't lost against the sun. */
  private key = new THREE.SpotLight(0xffe6cc, 55, 18, 0.45, 0.9, 2);
  /** Clutter taken out of the shot, put back for the game. */
  private cleared: THREE.Object3D[] = [];
  /** Called once the first frame is on screen. */
  onReady: () => void = () => {};

  constructor(
    readonly seed: number,
    serverNow: number,
    look: Look,
    car: { kind: VehicleKind; paint: number },
  ) {
    this.world = new World(seed);
    this.world.addResources(generateResources(seed));
    this.gfx = new Graphics(document.getElementById('game')!, this.world.scene);
    this.dayNight = new DayNight(this.world, this.gfx, seed, serverNow);
    // Always a clear evening on the menu, whatever the real sky is doing.
    this.dayNight.forced = { rain: 0, dust: 0, snow: 0 };

    // Of the landmarks' parking spots, use the one whose view back towards its landmark puts the
    // evening sun off to one side, for long shadows and a lit edge on the survivor and car.
    const sites = landmarkSites(seed);
    const spots = vehicleSpots(seed);
    let best = { score: -Infinity, n: 0, phase: EVENINGS[0] };
    for (let n = 0; n < spots.length; n++) {
      const ox = spots[n].x - sites[n].x;
      const oz = spots[n].z - sites[n].z;
      const look = Math.atan2(-ox, -oz);
      for (const phase of EVENINGS) {
        const off = Math.abs(((sunAzimuth(phase) - look + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        // Best with the sun about 65 degrees off the line of sight, in front of the camera.
        const score = -Math.abs(off - 1.13) + (n === 0 ? 0.15 : 0);
        if (score > best.score) best = { score, n, phase };
      }
    }
    const site = sites[best.n];
    const park = spots[best.n];
    this.dayNight.held = best.phase;
    this.spot = new THREE.Vector3(park.x, terrainHeight(seed, park.x, park.z), park.z);
    this.out = new THREE.Vector3(park.x - site.x, 0, park.z - site.z).normalize();
    this.side = new THREE.Vector3(-this.out.z, 0, this.out.x);
    this.heading = park.yaw;
    const land = BIOME_IDS[site.land];
    this.place = { landmark: LANDMARKS[land].name, land: BIOMES[land].name };
    // Nothing between the camera and the survivor and car: no wrecks or bushes in the way.
    for (const g of this.world.resourceMeshes.values()) {
      const d = g.position.clone().sub(this.spot).setY(0);
      const ahead = d.dot(this.out);
      if (ahead > 1 && ahead < 22 && Math.abs(d.dot(this.side)) < 10) {
        g.visible = false;
        this.cleared.push(g);
      }
    }

    this.car = car;
    this.cars = new Vehicles(this.world.scene, { engine() {}, puff() {} } as never, seed);
    this.park();
    this.avatar = this.dress(look);
    const keyAt = this.survivorAt();
    this.key.position.copy(keyAt).addScaledVector(this.out, 3.2).addScaledVector(this.side, -2.2).add(new THREE.Vector3(0, 3.8, 0));
    this.key.target.position.copy(keyAt).add(new THREE.Vector3(0, 1, 0));
    this.world.scene.add(this.key, this.key.target);

    const start = this.framing('play');
    this.eye.copy(start.from);
    this.aim.copy(start.to);
    this.fov = start.fov;
    this.shift = start.shift;

    const timer = new THREE.Timer();
    this.gfx.renderer.setAnimationLoop((now) => {
      timer.update(now);
      this.draw(Math.max(0, Math.min(timer.getDelta(), 0.1)));
    });
  }

  /** Puts a survivor in this look beside the car, turned towards the camera. */
  private dress(look: Look): Avatar {
    if (this.avatar) this.world.scene.remove(this.avatar.root);
    const a = new Avatar(MENU_ACCENT, undefined, look);
    const at = this.survivorAt();
    a.root.position.copy(at);
    a.root.visible = this.shot !== 'car';
    const cam = this.framing('play').from;
    a.root.rotation.y = Math.atan2(cam.x - at.x, cam.z - at.z) - 0.3;
    this.world.scene.add(a.root);
    return a;
  }

  /** Just off the car's flank on the camera's side, a little ahead of its middle. */
  private survivorAt(): THREE.Vector3 {
    const half = VEHICLES[this.car.kind].width / 2;
    const p = this.spot.clone().addScaledVector(this.out, half + 1.3).addScaledVector(this.side, 1.2);
    p.y = terrainHeight(this.seed, p.x, p.z);
    return p;
  }

  private park(car = this.car) {
    this.cars.sync([{ id: 1, kind: car.kind, x: this.spot.x, y: this.spot.y, z: this.spot.z, yaw: this.heading, hp: VEHICLES[car.kind].maxHp, fuel: 0, paint: car.paint }]);
  }

  setLook(look: Look) {
    this.avatar = this.dress(look);
  }

  setCar(car: { kind: VehicleKind; paint: number }) {
    const moved = car.kind !== this.car.kind;
    this.car = car;
    this.park();
    if (moved) this.avatar.root.position.copy(this.survivorAt());
  }

  show(shot: Shot) {
    this.shot = shot;
    // The garage is the car's shot alone.
    this.avatar.root.visible = shot !== 'car';
  }

  /** For screenshots: cuts straight to the current shot instead of easing there. */
  jump() {
    const f = this.framing(this.shot);
    this.eye.copy(f.from);
    this.aim.copy(f.to);
    this.fov = f.fov;
    this.shift = f.shift;
    this.focus = f.focus ?? f.from.distanceTo(f.to);
  }

  /** The camera for each tab, built round the parked car with its landmark behind. */
  private framing(shot: Shot): Framing {
    const s = this.spot;
    const up = (y: number) => new THREE.Vector3(0, y, 0);
    const at = (out: number, side: number, y: number) => s.clone().addScaledVector(this.out, out).addScaledVector(this.side, side).add(up(y));
    const ground = (v: THREE.Vector3, lift: number) => v.setY(Math.max(v.y, terrainHeight(this.seed, v.x, v.z) + lift));
    const survivor = this.survivorAt();
    switch (shot) {
      case 'character':
        return { from: ground(survivor.clone().addScaledVector(this.out, 4.4).addScaledVector(this.side, 1.0).add(up(1.15)), 1.1), to: survivor.clone().add(up(0.93)), fov: 30, shift: 0.17 };
      case 'car':
        return { from: ground(at(7, -3.6, 1.6), 1.2), to: s.clone().add(up(0.7)), fov: 36, shift: 0.15 };
      case 'store':
        // The play shot thrown out of focus, as a quiet backdrop for the cards.
        return { ...this.framing('play'), focus: 0.6 };
      default:
        // A hero shot: the survivor large and sharp, the car and landmark soft behind.
        return { from: ground(survivor.clone().addScaledVector(this.out, 4.6).addScaledVector(this.side, -0.5).add(up(1.2)), 1.1), to: survivor.clone().add(up(0.92)), fov: 30, shift: 0.06 };
    }
  }

  private draw(dt: number) {
    this.time += dt;
    const f = this.framing(this.shot);
    // A slow drift, so the shot feels filmed rather than frozen.
    const sway = this.side.clone().multiplyScalar(Math.sin(this.time * 0.11) * 0.35).add(new THREE.Vector3(0, Math.sin(this.time * 0.17) * 0.08, 0));
    const k = 1 - Math.exp(-dt * 2.6);
    this.eye.lerp(f.from.add(sway), k);
    this.aim.lerp(f.to, k);
    this.fov += (f.fov - this.fov) * k;
    this.shift += (f.shift - this.shift) * k;
    this.focus += ((f.focus ?? f.from.distanceTo(f.to)) - this.focus) * k;

    const cam = this.gfx.camera;
    cam.position.copy(this.eye);
    cam.lookAt(this.aim);
    cam.fov = this.fov;
    const w = innerWidth;
    const h = innerHeight;
    // On a wide screen the subject stands left of centre, clear of the menus on the right.
    const shift = w > 760 ? this.shift : 0;
    cam.setViewOffset(w, h, w * shift, 0, w, h);
    cam.updateProjectionMatrix();

    this.gfx.setFocus(this.focus);
    this.avatar.update(dt, false);
    this.cars.update(dt);
    this.world.update(dt, this.spot, this.time);
    this.dayNight.update(dt, this.spot, cam, []);
    this.gfx.render();
    if (!this.started) {
      this.started = true;
      this.onReady();
    }
  }

  /**
   * Store pictures: each pack's car in one of its paints, parked in this same evening light,
   * as images for the store's cards.
   */
  packArt(packs: string[], width = 480, height = 270): Record<string, string> {
    const r = this.gfx.renderer;
    const canvas = r.domElement;
    const ratio = r.getPixelRatio();
    const out = document.createElement('canvas');
    out.width = width;
    out.height = height;
    const ctx = out.getContext('2d')!;
    const cam = new THREE.PerspectiveCamera(25, width / height, 0.1, 1500);
    const art: Record<string, string> = {};
    const was = this.car;
    const avatarShown = this.avatar.root.visible;
    this.avatar.root.visible = false;
    const vw = Math.min(width, Math.floor(canvas.width / ratio));
    const vh = Math.min(height, Math.floor(canvas.height / ratio));
    for (const pack of packs) {
      const shot = PACK_SHOTS[pack];
      if (!shot || PAINTS[shot.paint] === undefined) continue;
      this.park(shot);
      this.cars.update(0.016);
      const s = this.spot;
      cam.position.copy(s).addScaledVector(this.out, 8.4).addScaledVector(this.side, -4.6).add(new THREE.Vector3(0, 1.9, 0));
      cam.lookAt(s.x, s.y + 0.65, s.z);
      cam.aspect = vw / vh;
      cam.updateProjectionMatrix();
      r.setScissorTest(true);
      r.setViewport(0, 0, vw, vh);
      r.setScissor(0, 0, vw, vh);
      r.render(this.world.scene, cam);
      ctx.drawImage(canvas, 0, canvas.height - vh * ratio, vw * ratio, vh * ratio, 0, 0, width, height);
      art[pack] = out.toDataURL('image/jpeg', 0.86);
    }
    r.setScissorTest(false);
    r.setViewport(0, 0, Math.floor(canvas.width / ratio), Math.floor(canvas.height / ratio));
    this.avatar.root.visible = avatarShown;
    this.park(was);
    return art;
  }

  /**
   * Gives the world, renderer and sky to the game: the menu's survivor and car leave, the
   * camera goes back to normal and the real sky and weather take over.
   */
  handOver(serverNow: number): { world: World; gfx: Graphics; dayNight: DayNight } {
    this.gfx.renderer.setAnimationLoop(null);
    this.world.scene.remove(this.avatar.root, this.key, this.key.target);
    this.cars.sync([]);
    for (const g of this.cleared) g.visible = true;
    this.gfx.setFocus(null);
    const cam = this.gfx.camera;
    cam.clearViewOffset();
    cam.fov = 70;
    cam.aspect = innerWidth / innerHeight;
    cam.updateProjectionMatrix();
    this.dayNight.held = null;
    this.dayNight.forced = null;
    this.dayNight.resync(serverNow);
    return { world: this.world, gfx: this.gfx, dayNight: this.dayNight };
  }

  /** Throws it all away (the game is joining a different world). */
  dispose() {
    const r = this.gfx.renderer;
    r.setAnimationLoop(null);
    r.dispose();
    r.forceContextLoss();
    r.domElement.remove();
  }
}
