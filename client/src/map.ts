// The map (M): the lands drawn from the same seed as the terrain, shaded by the hills, with the
// craters, ruins and road marked, and where you and your hounds are. Also the banner that
// names each land as you walk into it.

import { HALF_WORLD, WORLD_SIZE } from '../../shared/constants.ts';
import { BIOMES, BIOME_IDS, biomeAt, biomeWeights, type BiomeId } from '../../shared/biomes.ts';
import { landmarks } from '../../shared/landmarks.ts';
import { radZones } from '../../shared/survival.ts';
import { terrainHeight } from '../../shared/terrain.ts';
import type { Decor } from '../../shared/world.ts';

const $ = (id: string) => document.getElementById(id)!;
/** Pixels across the drawn map. */
const SIZE = 360;

export interface MapMarks {
  x: number;
  z: number;
  /** Which way you face, as the controller's yaw. */
  yaw: number;
  hounds: { x: number; z: number }[];
  /** Supply drops lying about, waiting to be looted. */
  drops: { x: number; z: number }[];
  /** Cars, wherever they are. */
  cars: { x: number; z: number }[];
  /** Your teammates, wherever they are. */
  mates: { x: number; z: number; name: string }[];
}

export class WorldMap {
  private base: HTMLCanvasElement | null = null;
  private canvas = $('map-canvas') as HTMLCanvasElement;
  private land: BiomeId | null = null;
  private bannerTimer = 0;
  private checkIn = 0;

  constructor(
    private seed: number,
    private decor: Decor[],
  ) {}

  get open(): boolean {
    return !$('map').hidden;
  }

  toggle(marks: MapMarks) {
    $('map').hidden = this.open;
    if (this.open) this.draw(marks);
  }

  close() {
    $('map').hidden = true;
  }

  /** Keeps the map's marks moving while it is open, and names a land when you enter it. */
  update(dt: number, marks: MapMarks) {
    if (this.open) this.draw(marks);
    this.checkIn -= dt;
    if (this.checkIn > 0) return;
    this.checkIn = 0.5;
    const land = biomeAt(this.seed, marks.x, marks.z);
    if (land === this.land) return;
    this.land = land;
    $('land-name').textContent = BIOMES[land].name;
    $('banner-name').textContent = BIOMES[land].name;
    $('banner-perk').textContent = BIOMES[land].perk;
    const banner = $('land-banner');
    banner.classList.add('show');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => banner.classList.remove('show'), 4500);
  }

  private toPx(x: number, z: number): [number, number] {
    return [((x + HALF_WORLD) / WORLD_SIZE) * SIZE, ((z + HALF_WORLD) / WORLD_SIZE) * SIZE];
  }

  /** The lands, hill shading, craters, ruins and the names, drawn once. */
  private drawBase(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(SIZE, SIZE);
    const step = WORLD_SIZE / SIZE;
    const rgb = BIOME_IDS.map((id) => {
      const n = parseInt(BIOMES[id].color.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    });
    const w = [0, 0, 0, 0, 0];
    const centres = BIOME_IDS.map(() => ({ x: 0, z: 0, n: 0 }));
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const x = -HALF_WORLD + (i + 0.5) * step;
        const z = -HALF_WORLD + (j + 0.5) * step;
        biomeWeights(this.seed, x, z, w);
        let r = 0;
        let g = 0;
        let b = 0;
        let top = 0;
        for (let k = 0; k < 5; k++) {
          r += rgb[k][0] * w[k];
          g += rgb[k][1] * w[k];
          b += rgb[k][2] * w[k];
          if (w[k] > w[top]) top = k;
        }
        if (Math.max(Math.abs(x), Math.abs(z)) < HALF_WORLD * 0.85) {
          centres[top].x += x;
          centres[top].z += z;
          centres[top].n++;
        }
        // Light from the top left, so hills and mesas stand out.
        const h = terrainHeight(this.seed, x, z);
        const slope = (terrainHeight(this.seed, x - step, z - step) - h) / step;
        const shade = Math.max(0.55, Math.min(1.35, 1 + slope * 0.9 + (h - 6) * 0.008));
        const at = (j * SIZE + i) * 4;
        img.data[at] = Math.min(255, r * shade);
        img.data[at + 1] = Math.min(255, g * shade);
        img.data[at + 2] = Math.min(255, b * shade);
        img.data[at + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // The old road along the power line.
    const poles = this.decor.filter((d) => d.kind === 'pole');
    if (poles.length > 1) {
      ctx.strokeStyle = 'rgba(40, 36, 32, 0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(...this.toPx(poles[0].x, poles[0].z));
      ctx.lineTo(...this.toPx(poles[poles.length - 1].x, poles[poles.length - 1].z));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(50, 46, 42, 0.8)';
    for (const d of this.decor) {
      if (d.kind !== 'ruin') continue;
      const [px, py] = this.toPx(d.x, d.z);
      ctx.fillRect(px - 2.5, py - 2.5, 5, 5);
    }
    for (const zone of radZones(this.seed)) {
      const [px, py] = this.toPx(zone.x, zone.z);
      const r = (zone.radius / WORLD_SIZE) * SIZE;
      ctx.fillStyle = 'rgba(200, 190, 40, 0.28)';
      ctx.strokeStyle = 'rgba(120, 110, 20, 0.8)';
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#2a2610';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('☢', px, py);
    }
    // The landmarks: a crate symbol and the name, so you know where the loot is.
    for (const { site, landmark } of landmarks(this.seed)) {
      const [px, py] = this.toPx(site.x, site.z);
      ctx.fillStyle = '#e8b04a';
      ctx.strokeStyle = '#1c1a18';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.rect(px - 4.5, py - 4.5, 9, 9);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px - 4.5, py);
      ctx.lineTo(px + 4.5, py);
      ctx.stroke();
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(20, 18, 16, 0.8)';
      ctx.strokeText(landmark.name, px, py + 7);
      ctx.fillStyle = '#f6d690';
      ctx.fillText(landmark.name, px, py + 7);
    }
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    BIOME_IDS.forEach((id, k) => {
      const c = centres[k];
      if (!c.n) return;
      const [px, py] = this.toPx(c.x / c.n, c.z / c.n);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(20, 18, 16, 0.75)';
      ctx.strokeText(BIOMES[id].name, px, py);
      ctx.fillStyle = '#f2ece2';
      ctx.fillText(BIOMES[id].name, px, py);
    });
    return c;
  }

  private draw(marks: MapMarks) {
    this.base ??= this.drawBase();
    const c = this.canvas;
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(this.base, 0, 0);
    ctx.fillStyle = '#c0502e';
    ctx.strokeStyle = '#1c1a18';
    ctx.lineWidth = 1.5;
    // Supply drops: a red parachute crate, pulsing so it catches the eye.
    const pulse = 4 + Math.sin(performance.now() / 180) * 1.2;
    for (const d of marks.drops) {
      const [px, py] = this.toPx(d.x, d.z);
      ctx.fillStyle = '#d23a2c';
      ctx.beginPath();
      ctx.arc(px, py, pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Cars: small dark blocks.
    ctx.fillStyle = '#3c5e66';
    for (const car of marks.cars) {
      const [px, py] = this.toPx(car.x, car.z);
      ctx.fillRect(px - 4, py - 2.5, 8, 5);
      ctx.strokeRect(px - 4, py - 2.5, 8, 5);
    }
    // Teammates: green dots with their names.
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const m of marks.mates) {
      const [px, py] = this.toPx(m.x, m.z);
      ctx.fillStyle = '#5fd06a';
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeText(m.name, px, py - 6);
      ctx.fillStyle = '#d8f5da';
      ctx.fillText(m.name, px, py - 6);
      ctx.lineWidth = 1.5;
    }
    ctx.fillStyle = '#c0502e';
    for (const h of marks.hounds) {
      const [px, py] = this.toPx(h.x, h.z);
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // You: an arrow pointing the way you face.
    const [px, py] = this.toPx(marks.x, marks.z);
    const fx = -Math.sin(marks.yaw);
    const fz = -Math.cos(marks.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(px + fx * 9, py + fz * 9);
    ctx.lineTo(px - fx * 5 - fz * 5.5, py - fz * 5 + fx * 5.5);
    ctx.lineTo(px - fx * 2, py - fz * 2);
    ctx.lineTo(px - fx * 5 + fz * 5.5, py - fz * 5 - fx * 5.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
