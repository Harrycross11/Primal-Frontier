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
/** Pixels across the land's shading, worked out from the terrain. */
const SIZE = 360;
/** Pixels across the map as drawn, so the marks and names stay sharp. */
const OUT = 1000;

/** The radiation hazard sign: three blades round a dot. */
function hazard(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, colour: string) {
  ctx.fillStyle = colour;
  for (let n = 0; n < 3; n++) {
    const a = -Math.PI / 2 + (n * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.arc(x, y, r, a - Math.PI / 6, a + Math.PI / 6);
    ctx.arc(x, y, r * 0.34, a + Math.PI / 6, a - Math.PI / 6, true);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

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
    /** The world photographed from above, to draw the map on; without it the lands are painted flat. */
    private aerial?: () => HTMLCanvasElement | null,
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
    return [((x + HALF_WORLD) / WORLD_SIZE) * OUT, ((z + HALF_WORLD) / WORLD_SIZE) * OUT];
  }

  /**
   * The lands as a survey map: muted colours, hill shading and contour lines, a lettered grid,
   * the radiation zones, ruins, road and landmarks, and the lands' names. Drawn once.
   */
  private drawBase(): HTMLCanvasElement {
    const land = document.createElement('canvas');
    land.width = land.height = SIZE;
    const lctx = land.getContext('2d')!;
    const img = lctx.createImageData(SIZE, SIZE);
    const step = WORLD_SIZE / SIZE;
    // Each land's colour pulled toward a dusty grey, so the map reads as one printed sheet.
    const rgb = BIOME_IDS.map((id) => {
      const n = parseInt(BIOMES[id].color.slice(1), 16);
      const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      const l = c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;
      return c.map((v) => (v * 0.55 + l * 0.45) * 0.78);
    });
    const w = [0, 0, 0, 0, 0];
    const centres = BIOME_IDS.map(() => ({ x: 0, z: 0, n: 0 }));
    const heights = new Float32Array(SIZE * SIZE);
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) heights[j * SIZE + i] = terrainHeight(this.seed, -HALF_WORLD + (i + 0.5) * step, -HALF_WORLD + (j + 0.5) * step);
    }
    const height = (i: number, j: number) => heights[Math.max(0, Math.min(SIZE - 1, j)) * SIZE + Math.max(0, Math.min(SIZE - 1, i))];
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
        const h = height(i, j);
        const slope = (height(i - 1, j - 1) - h) / step;
        let shade = Math.max(0.6, Math.min(1.3, 1 + slope * 0.7 + (h - 6) * 0.006));
        // A contour line every 5 m of height.
        const band = Math.floor(h / 5);
        if (band !== Math.floor(height(i + 1, j) / 5) || band !== Math.floor(height(i, j + 1) / 5)) shade *= 0.82;
        const at = (j * SIZE + i) * 4;
        img.data[at] = Math.min(255, r * shade);
        img.data[at + 1] = Math.min(255, g * shade);
        img.data[at + 2] = Math.min(255, b * shade);
        img.data[at + 3] = 255;
      }
    }
    lctx.putImageData(img, 0, 0);

    const c = document.createElement('canvas');
    c.width = c.height = OUT;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(land, 0, 0, OUT, OUT);
    let photo: HTMLCanvasElement | null = null;
    try {
      photo = this.aerial?.() ?? null;
    } catch (e) {
      console.warn('aerial map failed', e);
    }
    if (photo) {
      ctx.drawImage(photo, 0, 0, OUT, OUT);
      // A touch darker and cooler, so the marks and names read on bright sand and snow.
      ctx.fillStyle = 'rgba(18, 20, 24, 0.16)';
      ctx.fillRect(0, 0, OUT, OUT);
      // The land's far corners, past where anyone can walk, fade into the dark of the frame.
      const edge = ctx.createRadialGradient(OUT / 2, OUT / 2, OUT * 0.58, OUT / 2, OUT / 2, OUT * 0.71);
      edge.addColorStop(0, 'rgba(20, 18, 16, 0)');
      edge.addColorStop(1, 'rgba(20, 18, 16, 0.92)');
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, OUT, OUT);
    }
    const font = (size: number, weight = 600) => `${weight} ${size}px 'Barlow Condensed', 'Barlow', sans-serif`;
    const label = (text: string, x: number, y: number, size: number, colour: string, spacing: number) => {
      ctx.font = font(size);
      ctx.letterSpacing = `${spacing}px`;
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      ctx.shadowBlur = 4;
      ctx.fillStyle = colour;
      ctx.fillText(text, x, y);
      ctx.shadowBlur = 0;
      ctx.letterSpacing = '0px';
    };

    // A lettered grid, like a survey sheet: A to H across, 1 to 8 down.
    const cells = 8;
    const cell = OUT / cells;
    ctx.strokeStyle = photo ? 'rgba(255, 255, 255, 0.16)' : 'rgba(12, 11, 10, 0.28)';
    ctx.lineWidth = 1;
    for (let n = 1; n < cells; n++) {
      ctx.beginPath();
      ctx.moveTo(n * cell + 0.5, 0);
      ctx.lineTo(n * cell + 0.5, OUT);
      ctx.moveTo(0, n * cell + 0.5);
      ctx.lineTo(OUT, n * cell + 0.5);
      ctx.stroke();
    }
    ctx.font = font(13);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(235, 230, 218, 0.5)';
    for (let a = 0; a < cells; a++) {
      for (let b = 0; b < cells; b++) ctx.fillText(`${String.fromCharCode(65 + a)}${b + 1}`, a * cell + 6, b * cell + 5);
    }

    // The old road along the power line.
    const poles = this.decor.filter((d) => d.kind === 'pole');
    // On the photograph the road and ruins can be seen as they are.
    if (poles.length > 1 && !photo) {
      ctx.strokeStyle = 'rgba(30, 27, 24, 0.45)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(...this.toPx(poles[0].x, poles[0].z));
      ctx.lineTo(...this.toPx(poles[poles.length - 1].x, poles[poles.length - 1].z));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = 'rgba(28, 26, 24, 0.75)';
    for (const d of photo ? [] : this.decor) {
      if (d.kind !== 'ruin') continue;
      const [px, py] = this.toPx(d.x, d.z);
      ctx.fillRect(px - 4, py - 4, 8, 8);
    }
    // Radiation: a dashed amber ring with the hazard sign in the middle.
    for (const zone of radZones(this.seed)) {
      const [px, py] = this.toPx(zone.x, zone.z);
      const r = (zone.radius / WORLD_SIZE) * OUT;
      ctx.fillStyle = 'rgba(214, 176, 60, 0.12)';
      ctx.strokeStyle = 'rgba(232, 190, 70, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      hazard(ctx, px, py, 9, 'rgba(232, 190, 70, 0.95)');
    }
    // The landmarks: a crate mark and the name, so you know where the loot is.
    for (const { site, landmark } of landmarks(this.seed)) {
      const [px, py] = this.toPx(site.x, site.z);
      ctx.fillStyle = '#ebe6da';
      ctx.strokeStyle = 'rgba(12, 11, 10, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.rect(px - 6, py - 6, 12, 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#c9562a';
      ctx.fillRect(px - 3, py - 3, 6, 6);
      ctx.textBaseline = 'top';
      label(landmark.name.toUpperCase(), px, py + 11, 14, '#ebe6da', 1.5);
    }
    ctx.textBaseline = 'middle';
    BIOME_IDS.forEach((id, k) => {
      const ce = centres[k];
      if (!ce.n) return;
      const [px, py] = this.toPx(ce.x / ce.n, ce.z / ce.n);
      label(BIOMES[id].name.toUpperCase(), px, py - 26, 24, 'rgba(250, 246, 236, 0.92)', 5);
    });
    return c;
  }

  private draw(marks: MapMarks) {
    this.base ??= this.drawBase();
    const c = this.canvas;
    c.width = c.height = OUT;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(this.base, 0, 0);
    ctx.lineJoin = 'round';
    ctx.fillStyle = '#c0502e';
    ctx.strokeStyle = '#1c1a18';
    ctx.lineWidth = 2;
    // Supply drops: a red parachute crate, pulsing so it catches the eye.
    const pulse = 9 + Math.sin(performance.now() / 180) * 2.5;
    for (const d of marks.drops) {
      const [px, py] = this.toPx(d.x, d.z);
      ctx.fillStyle = '#d23a2c';
      ctx.beginPath();
      ctx.arc(px, py, pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Cars: small dark blocks.
    ctx.fillStyle = '#4c7480';
    for (const car of marks.cars) {
      const [px, py] = this.toPx(car.x, car.z);
      ctx.fillRect(px - 8, py - 5, 16, 10);
      ctx.strokeRect(px - 8, py - 5, 16, 10);
    }
    // Teammates: green dots with their names.
    ctx.font = "600 17px 'Barlow Condensed', 'Barlow', sans-serif";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const m of marks.mates) {
      const [px, py] = this.toPx(m.x, m.z);
      ctx.fillStyle = '#5fd06a';
      ctx.beginPath();
      ctx.arc(px, py, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeText(m.name, px, py - 11);
      ctx.fillStyle = '#d8f5da';
      ctx.fillText(m.name, px, py - 11);
      ctx.lineWidth = 2;
    }
    ctx.fillStyle = '#c0502e';
    for (const h of marks.hounds) {
      const [px, py] = this.toPx(h.x, h.z);
      ctx.beginPath();
      ctx.arc(px, py, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // You: an arrow pointing the way you face, and the grid square you are in.
    const [px, py] = this.toPx(marks.x, marks.z);
    const cell = OUT / 8;
    const grid = `Grid ${String.fromCharCode(65 + Math.min(7, Math.max(0, Math.floor(px / cell))))}${Math.min(8, Math.max(1, Math.floor(py / cell) + 1))}`;
    if ($('map-grid').textContent !== grid) $('map-grid').textContent = grid;
    const fx = -Math.sin(marks.yaw);
    const fz = -Math.cos(marks.yaw);
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(px + fx * 17, py + fz * 17);
    ctx.lineTo(px - fx * 9 - fz * 10, py - fz * 9 + fx * 10);
    ctx.lineTo(px - fx * 3.5, py - fz * 3.5);
    ctx.lineTo(px - fx * 9 + fz * 10, py - fz * 9 - fx * 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
