// The sky over the wasteland through the day: the sun crossing from dawn to dusk, a dark night
// lit by the moon and by fire, and the storms that roll over each land: rain falling in streaks,
// blizzards of snow, and dust storms that close the world in to a few metres.

import * as THREE from 'three';
import { DAY_MS, clockText, dayPhase, daylight, sunPath, weatherAt, type Weather } from '../../shared/sky.ts';
import { mulberry32 } from '../../shared/terrain.ts';
import { HAZE, SUN_DIRECTION, type Graphics } from './graphics.ts';
import type { World } from './world.ts';

/** A fire that could light the night: where it is and how bright. */
export interface Fire {
  at: THREE.Vector3;
  strength: number;
}

const DAY_FOG = 0.0085;
// The sky's own colours at each time and in each kind of storm.
const DUSK = new THREE.Color(0xc89a78);
const NIGHT = new THREE.Color(0x141a26);
const RAIN = new THREE.Color(0x7c8086);
const DUST = new THREE.Color(0xb08658);
const SNOW = new THREE.Color(0xc8ced6);
const SUN_DAY = new THREE.Color(0xffe0b8);
const SUN_LOW = new THREE.Color(0xff9a5c);
const MOON = new THREE.Color(0x8ea6d4);
const TMP = new THREE.Color();

export class DayNight {
  /** Milliseconds to add to this computer's clock to get the server's. */
  private offset: number;
  private weather: Weather = { rain: 0, dust: 0, snow: 0 };
  private weatherIn = 0;
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private dust: THREE.Points;
  private color = new THREE.Color();
  private stormColor = new THREE.Color();
  private flicker = 0;

  constructor(
    private world: World,
    private gfx: Graphics,
    private seed: number,
    serverNow: number,
  ) {
    this.offset = serverNow - Date.now();
    this.rain = rainStreaks();
    this.snow = flakes(3600, 0.14, 0xf4f6fa, 0.95);
    this.dust = flakes(3200, 0.06, 0xc49a68, 0.55);
    world.scene.add(this.rain, this.snow, this.dust);
  }

  /** For screenshots and tests: weather held at a fixed level instead of the real forecast. */
  forced: Weather | null = null;

  /** For screenshots: a point in the day to stay at, so a slow machine's capture can't drift into night. */
  held: number | null = null;

  /** For screenshots and tests: jumps the clock to a point in the day, 0 being sunrise. */
  setPhase(phase: number) {
    const now = this.now;
    this.offset += (((phase - dayPhase(now)) % 1) + 1) % 1 * DAY_MS;
  }

  get now(): number {
    return Date.now() + this.offset;
  }

  /** The clock for the corner of the screen, with the weather if there is any. */
  label(): string {
    const w = this.weather;
    const storm = w.snow > 0.3 ? 'Blizzard' : w.dust > 0.3 ? 'Dust storm' : w.rain > 0.3 ? 'Rain' : '';
    const night = daylight(this.now) < 0.3 ? ' · Night' : '';
    return `${clockText(this.now)}${night}${storm ? ` · ${storm}` : ''}`;
  }

  /** How stormy it is where you stand: rain, dust and snow, 0 to 1 each. */
  get storm(): Weather {
    return this.weather;
  }

  update(dt: number, focus: THREE.Vector3, camera: THREE.Camera, fires: Fire[]) {
    if (this.held !== null) this.setPhase(this.held);
    const now = this.now;
    // The weather changes over minutes; there's no need to work it out every frame.
    this.weatherIn -= dt;
    if (this.forced) Object.assign(this.weather, this.forced);
    else if (this.weatherIn <= 0) {
      this.weatherIn = 0.5;
      const target = weatherAt(this.seed, focus.x, focus.z, now);
      // Ease towards it, so walking over a border brings the storm in gradually.
      const w = this.weather;
      w.rain += (target.rain - w.rain) * 0.25;
      w.dust += (target.dust - w.dust) * 0.25;
      w.snow += (target.snow - w.snow) * 0.25;
    }
    const { rain, dust, snow } = this.weather;
    const storm = Math.min(1, rain + dust + snow);
    const light = daylight(now);

    // The sun's path: rising in the east, high in the south at noon, setting in the west; the
    // moon takes the same road by night.
    const { height, across } = sunPath(now);
    const azimuth = THREE.MathUtils.degToRad(100 + across * 160);
    const elevation = Math.asin(Math.max(-1, Math.min(1, height))) * (48 / 90);
    SUN_DIRECTION.setFromSphericalCoords(1, Math.PI / 2 - elevation, azimuth);
    const sun = this.world.sun;
    if (height > -0.05) {
      // Daylight: warm and red low down, whiter overhead, dimmed by cloud.
      sun.color.copy(SUN_LOW).lerp(SUN_DAY, THREE.MathUtils.smoothstep(height, 0.05, 0.45));
      sun.intensity = 2.8 * THREE.MathUtils.smoothstep(height, -0.05, 0.12) * (1 - storm * 0.7);
      sun.position.copy(focus).addScaledVector(SUN_DIRECTION, 80);
    } else {
      // Moonlight: cold, faint and from the moon's side of the sky.
      const moon = new THREE.Vector3().setFromSphericalCoords(1, Math.PI / 2 - Math.max(0.2, -elevation), azimuth);
      sun.color.copy(MOON);
      sun.intensity = 0.45 * THREE.MathUtils.smoothstep(-height, 0.05, 0.3) * (1 - storm * 0.8);
      sun.position.copy(focus).addScaledVector(moon, 80);
    }
    sun.target.position.copy(focus);
    this.world.hemi.intensity = 0.6 * (0.18 + 0.82 * light) * (1 - storm * 0.15);
    this.world.hemi.color.setHex(0xa9bad0).lerp(MOON, 1 - light);
    this.world.scene.environmentIntensity = 0.55 * (0.25 + 0.75 * light);

    // Haze: the dust's colour by day, warm at dawn and dusk, blue-black at night, and the
    // storm's own colour, much thicker in a dust storm or a blizzard.
    this.stormColor.setRGB(0, 0, 0);
    if (storm > 0) {
      const sum = rain + dust + snow;
      const mix = (c: THREE.Color, k: number) => this.stormColor.add(TMP.copy(c).multiplyScalar(k / sum));
      mix(RAIN, rain);
      mix(DUST, dust);
      mix(SNOW, snow);
    } else this.stormColor.copy(RAIN);
    const c = this.color.copy(HAZE).lerp(DUSK, (1 - THREE.MathUtils.smoothstep(height, 0.05, 0.35)) * light * 0.6);
    c.lerp(this.stormColor, storm * 0.85);
    c.lerp(NIGHT, 1 - light);
    const fog = this.world.scene.fog as THREE.FogExp2;
    fog.color.copy(c);
    fog.density = DAY_FOG * (1 + rain * 1.3 + dust * 5 + snow * 3.2) * (1 + (1 - light) * 0.4);
    this.gfx.setSky(light, storm, this.stormColor.clone().multiplyScalar(0.55 + 0.45 * light));
    this.gfx.renderer.toneMappingExposure = 1.1 + (1 - light) * 0.45;

    this.fall(dt, focus, camera);
    this.lightFires(dt, focus, fires, light);
  }

  /** Moves the rain, snow and dust along with the player, falling and blowing. */
  private fall(dt: number, focus: THREE.Vector3, camera: THREE.Camera) {
    const { rain, dust, snow } = this.weather;
    const show = (o: THREE.Object3D & { material: THREE.Material | THREE.Material[] }, amount: number, base: number) => {
      o.visible = amount > 0.02;
      (o.material as THREE.Material).opacity = base * Math.min(1, amount * 1.6);
      const geo = (o as THREE.Mesh).geometry;
      const count = geo.attributes.position.count / (o === this.rain ? 2 : 1);
      geo.setDrawRange(0, Math.floor(count * Math.min(1, amount * 1.4)) * (o === this.rain ? 2 : 1));
    };
    show(this.rain, rain, 0.38);
    show(this.snow, snow, 0.9);
    show(this.dust, dust, 0.55);
    const t = performance.now() / 1000;
    if (this.rain.visible) wrapFall(this.rain, focus, dt, 0, -19, 0.8, 2, t);
    if (this.snow.visible) wrapFall(this.snow, focus, dt, 1.2, -1.6, 0.6, 1, t);
    if (this.dust.visible) wrapFall(this.dust, focus, dt, 9, -0.2, 3, 1, t);
    void camera;
  }

  /** Hands the firelights to the fires nearest the player, flickering. Unused by day. */
  private lightFires(dt: number, focus: THREE.Vector3, fires: Fire[], light: number) {
    this.flicker += dt;
    const dark = 1 - light * 0.75;
    const near = fires
      .map((f) => ({ f, d: f.at.distanceTo(focus) }))
      .filter((n) => n.d < 60)
      .sort((a, b) => a.d - b.d);
    this.world.fires.forEach((lamp, i) => {
      const n = near[i];
      if (!n) {
        lamp.intensity = 0;
        return;
      }
      lamp.position.copy(n.f.at);
      const wobble = 0.85 + Math.sin(this.flicker * 13 + i * 2.1) * 0.08 + Math.sin(this.flicker * 23.7 + i) * 0.07;
      lamp.intensity = 9 * n.f.strength * dark * wobble;
    });
  }
}

/** Rain: short streaks in a box round the player, each a line segment slanting in the wind. */
function rainStreaks(): THREE.LineSegments {
  const count = 5000;
  const pos = new Float32Array(count * 6);
  const rand = mulberry32(31);
  for (let i = 0; i < count; i++) {
    const x = (rand() - 0.5) * 50;
    const y = rand() * 24;
    const z = (rand() - 0.5) * 50;
    pos.set([x, y, z, x + 0.03, y + 0.55, z + 0.02], i * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc4ccd6, transparent: true, opacity: 0, depthWrite: false }));
  lines.frustumCulled = false;
  lines.visible = false;
  return lines;
}

/** Snowflakes or dust: soft round points in a box round the player. */
function flakes(count: number, size: number, color: number, opacity: number): THREE.Points {
  const pos = new Float32Array(count * 3);
  const rand = mulberry32(count);
  for (let i = 0; i < count; i++) pos.set([(rand() - 0.5) * 50, rand() * 24, (rand() - 0.5) * 50], i * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  const pts = new THREE.Points(
    geo,
    new THREE.PointsMaterial({ size, map: new THREE.CanvasTexture(canvas), color, transparent: true, opacity, depthWrite: false }),
  );
  pts.frustumCulled = false;
  pts.visible = false;
  return pts;
}

/**
 * Moves every point (or segment, `per` points at a time) by the wind and fall speed, swirling a
 * little, and wraps it round a 50 m box centred on the player so the weather goes where they go.
 */
function wrapFall(o: THREE.Points | THREE.LineSegments, focus: THREE.Vector3, dt: number, wind: number, fall: number, swirl: number, per: number, t: number) {
  const pos = o.geometry.attributes.position as THREE.BufferAttribute;
  const a = pos.array as Float32Array;
  for (let i = 0; i < pos.count; i += per) {
    const k = i * 3;
    const s = Math.sin(t * 1.3 + i * 0.37) * swirl;
    let dx = (wind + s) * dt;
    let dy = fall * dt;
    let dz = (Math.cos(t * 0.9 + i * 0.61) * swirl + wind * 0.3) * dt;
    // Wrap into the box round the player.
    const x = a[k] + dx;
    const y = a[k + 1] + dy;
    const z = a[k + 2] + dz;
    if (x - focus.x > 25) dx -= 50;
    if (x - focus.x < -25) dx += 50;
    if (z - focus.z > 25) dz -= 50;
    if (z - focus.z < -25) dz += 50;
    if (y < focus.y - 4) dy += 24;
    if (y > focus.y + 20) dy -= 24;
    for (let j = 0; j < per; j++) {
      a[k + j * 3] += dx;
      a[k + j * 3 + 1] += dy;
      a[k + j * 3 + 2] += dz;
    }
  }
  pos.needsUpdate = true;
}
