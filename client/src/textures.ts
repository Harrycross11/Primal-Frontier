// Procedural textures drawn on canvases at startup, so the game needs no image files.
// Each surface gets a colour map and a matching normal map for surface detail under light.

import * as THREE from 'three';
import { mulberry32 } from '../../shared/terrain.ts';

type Draw = (ctx: CanvasRenderingContext2D, size: number, rand: () => number) => void;

export interface Surface {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap?: THREE.Texture;
}

const cache = new Map<string, Surface>();

/** Builds a colour map plus a normal map derived from the same drawing's brightness. */
function surface(name: string, size: number, draw: Draw, bumpDraw?: Draw, bumpStrength = 2): Surface {
  const hit = cache.get(name);
  if (hit) return hit;
  const color = document.createElement('canvas');
  color.width = color.height = size;
  draw(color.getContext('2d')!, size, mulberry32(name.length * 7919));
  let bump = color;
  if (bumpDraw) {
    bump = document.createElement('canvas');
    bump.width = bump.height = size;
    bumpDraw(bump.getContext('2d')!, size, mulberry32(name.length * 104729));
  }
  const map = new THREE.CanvasTexture(color);
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = new THREE.CanvasTexture(normalFromHeight(bump, bumpStrength));
  const roughnessMap = new THREE.CanvasTexture(roughnessFromHeight(bump));
  for (const t of [map, normalMap, roughnessMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  const s = { map, normalMap, roughnessMap };
  cache.set(name, s);
  return s;
}

/**
 * Raised, worn spots are a little smoother than the grime in the cracks, so highlights break
 * up across a surface instead of sitting on it like plastic. Scales the material's roughness.
 */
function roughnessFromHeight(src: HTMLCanvasElement): HTMLCanvasElement {
  const size = src.width;
  const data = src.getContext('2d')!.getImageData(0, 0, size, size).data;
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const rand = mulberry32(size * 31);
  for (let i = 0; i < data.length; i += 4) {
    const h = (data[i] + data[i + 1] + data[i + 2]) / 765;
    const r = Math.min(1, 0.7 + (1 - h) * 0.26 + (rand() - 0.5) * 0.08);
    img.data[i] = img.data[i + 1] = img.data[i + 2] = r * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

function normalFromHeight(src: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const size = src.width;
  const data = src.getContext('2d')!.getImageData(0, 0, size, size).data;
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ctx = out.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const h = (x: number, y: number) => {
    const i = (((y + size) % size) * size + ((x + size) % size)) * 4;
    return (data[i] + data[i + 1] + data[i + 2]) / 765;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Soft blotchy noise by stacking random translucent circles. Tiles because it wraps edges. */
function blotches(ctx: CanvasRenderingContext2D, size: number, rand: () => number, count: number, colors: string[], rMin: number, rMax: number, alpha: number) {
  for (let n = 0; n < count; n++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = rMin + rand() * (rMax - rMin);
    ctx.globalAlpha = alpha * (0.4 + rand() * 0.6);
    ctx.fillStyle = colors[Math.floor(rand() * colors.length)];
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}

function cracks(ctx: CanvasRenderingContext2D, size: number, rand: () => number, count: number, color: string, width: number) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  for (let n = 0; n < count; n++) {
    let x = rand() * size;
    let y = rand() * size;
    let a = rand() * Math.PI * 2;
    ctx.lineWidth = width * (0.5 + rand());
    ctx.beginPath();
    ctx.moveTo(x, y);
    const steps = 6 + Math.floor(rand() * 10);
    for (let s = 0; s < steps; s++) {
      a += (rand() - 0.5) * 1.2;
      x += Math.cos(a) * size * 0.03;
      y += Math.sin(a) * size * 0.03;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

/** Dry, cracked ash-covered earth. */
export function groundSurface(): Surface {
  const draw: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#8b8172';
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, rand, 260, ['#7a6f60', '#9a907f', '#6e6559', '#a59a88'], 6, 40, 0.35);
    blotches(ctx, size, rand, 1800, ['#5e564c', '#b0a693', '#71685c'], 0.6, 2.2, 0.6);
    cracks(ctx, size, rand, 40, 'rgba(52,46,40,0.55)', 1.4);
  };
  const bump: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, rand, 300, ['#777', '#999'], 4, 30, 0.4);
    blotches(ctx, size, rand, 2200, ['#555', '#bbb'], 0.6, 2, 0.7);
    cracks(ctx, size, rand, 40, '#222', 2);
  };
  return surface('ground', 512, draw, bump, 3);
}

/** Weathered horizontal planks with nails, for wood building pieces. */
export function plankSurface(): Surface {
  const draw: Draw = (ctx, size, rand) => {
    const rows = 6;
    const h = size / rows;
    for (let r = 0; r < rows; r++) {
      const shade = 0.85 + rand() * 0.3;
      ctx.fillStyle = `rgb(${150 * shade},${108 * shade},${68 * shade})`;
      ctx.fillRect(0, r * h, size, h);
      ctx.globalAlpha = 0.25;
      for (let g = 0; g < 14; g++) {
        ctx.fillStyle = rand() > 0.5 ? '#5a3a1e' : '#c89a64';
        ctx.fillRect(0, r * h + rand() * h, size, 1 + rand() * 2);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#3b2512';
      ctx.fillRect(0, r * h, size, 3);
      const seam = rand() * size;
      ctx.fillRect(seam, r * h, 3, h);
      ctx.fillStyle = '#2a2a2a';
      for (const nx of [seam - 10, seam + 12]) {
        ctx.fillRect(nx, r * h + h * 0.3, 4, 4);
        ctx.fillRect(nx, r * h + h * 0.7, 4, 4);
      }
    }
  };
  const bump: Draw = (ctx, size, rand) => {
    const rows = 6;
    const h = size / rows;
    ctx.fillStyle = '#999';
    ctx.fillRect(0, 0, size, size);
    for (let r = 0; r < rows; r++) {
      ctx.globalAlpha = 0.3;
      for (let g = 0; g < 14; g++) {
        ctx.fillStyle = rand() > 0.5 ? '#666' : '#bbb';
        ctx.fillRect(0, r * h + rand() * h, size, 1 + rand() * 2);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#222';
      ctx.fillRect(0, r * h, size, 4);
    }
  };
  return surface('planks', 256, draw, bump, 4);
}

/** Corrugated sheet metal patched with rust, for scrap building pieces. */
export function metalSurface(): Surface {
  const draw: Draw = (ctx, size, rand) => {
    for (let x = 0; x < size; x++) {
      const v = 0.5 + 0.5 * Math.sin((x / size) * Math.PI * 2 * 12);
      const c = 95 + v * 45;
      ctx.fillStyle = `rgb(${c},${c + 4},${c + 10})`;
      ctx.fillRect(x, 0, 1, size);
    }
    blotches(ctx, size, rand, 120, ['#8a4b2a', '#a35d32', '#6e3a20'], 3, 22, 0.55);
    blotches(ctx, size, rand, 600, ['#7a4024', '#b56a3a'], 0.5, 2, 0.7);
    ctx.fillStyle = 'rgba(40,30,25,0.6)';
    ctx.fillRect(0, size / 2 - 2, size, 4);
  };
  const bump: Draw = (ctx, size, rand) => {
    for (let x = 0; x < size; x++) {
      const v = 0.5 + 0.5 * Math.sin((x / size) * Math.PI * 2 * 12);
      const c = Math.floor(60 + v * 140);
      ctx.fillStyle = `rgb(${c},${c},${c})`;
      ctx.fillRect(x, 0, 1, size);
    }
    blotches(ctx, size, rand, 300, ['#444', '#777'], 0.5, 3, 0.4);
  };
  return surface('metal', 256, draw, bump, 2.5);
}

/** Stained, cracked concrete for ruins. */
export function concreteSurface(): Surface {
  const draw: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#9a968e';
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, rand, 200, ['#85817a', '#aaa59c', '#7a756c'], 5, 30, 0.3);
    blotches(ctx, size, rand, 1600, ['#6e6a63', '#b8b3a9'], 0.5, 1.6, 0.6);
    ctx.globalAlpha = 0.35;
    for (let n = 0; n < 12; n++) {
      ctx.fillStyle = '#4a4036';
      const x = rand() * size;
      ctx.fillRect(x, 0, 2 + rand() * 6, size * (0.2 + rand() * 0.5));
    }
    ctx.globalAlpha = 1;
    cracks(ctx, size, rand, 14, 'rgba(40,38,35,0.7)', 1.2);
  };
  const bump: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, rand, 1800, ['#666', '#aaa'], 0.5, 1.8, 0.6);
    cracks(ctx, size, rand, 14, '#222', 2);
  };
  return surface('concrete', 256, draw, bump, 3);
}

/**
 * Weathered rock for boulders, one tile covering about 2 m: broad stains, grain you can see
 * from a few metres, strata, chips and fractures, and faint lichen.
 */
export function rockSurface(): Surface {
  const draw: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#9a958c';
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, rand, 120, ['#7a746a', '#b4ada1', '#6c665d', '#a69a86'], 20, 90, 0.35);
    ctx.globalAlpha = 0.16;
    for (let y = 0; y < size; y += 10 + rand() * 30) {
      ctx.fillStyle = rand() < 0.5 ? '#5a544c' : '#c8c1b4';
      ctx.fillRect(0, y, size, 3 + rand() * 9);
    }
    ctx.globalAlpha = 1;
    blotches(ctx, size, rand, 900, ['#5f5a52', '#c4bdb0', '#4e4a44', '#aea697'], 2, 7, 0.5);
    blotches(ctx, size, rand, 3000, ['#4a4640', '#d0c9bc'], 0.8, 2.4, 0.6);
    blotches(ctx, size, rand, 50, ['#9c9d78', '#b39a62'], 4, 14, 0.3);
    cracks(ctx, size, rand, 22, 'rgba(34,31,28,0.75)', 2.4);
    cracks(ctx, size, rand, 40, 'rgba(40,37,33,0.5)', 1.2);
  };
  const bump: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, rand, 140, ['#6a6a6a', '#a4a4a4'], 20, 90, 0.45);
    blotches(ctx, size, rand, 900, ['#555', '#bbb'], 2, 7, 0.55);
    blotches(ctx, size, rand, 3000, ['#4a4a4a', '#c4c4c4'], 0.8, 2.4, 0.6);
    cracks(ctx, size, rand, 22, '#141414', 3.5);
    cracks(ctx, size, rand, 40, '#2a2a2a', 1.6);
  };
  return surface('rock-granite', 512, draw, bump, 3);
}

/** Rough charred bark for trees and poles. */
export function barkSurface(dark = false): Surface {
  const base = dark ? ['#4a4038', '#5a4d42', '#3a322c'] : ['#5b4334', '#6b5040', '#4a362a'];
  const draw: Draw = (ctx, size, rand) => {
    ctx.fillStyle = base[0];
    ctx.fillRect(0, 0, size, size);
    for (let n = 0; n < 160; n++) {
      ctx.fillStyle = base[Math.floor(rand() * 3)];
      const x = rand() * size;
      ctx.fillRect(x, 0, 1 + rand() * 4, size);
    }
    cracks(ctx, size, rand, 30, 'rgba(15,12,10,0.6)', 1);
  };
  const bump: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, size, size);
    for (let n = 0; n < 160; n++) {
      ctx.fillStyle = rand() > 0.5 ? '#555' : '#bbb';
      ctx.fillRect(rand() * size, 0, 1 + rand() * 4, size);
    }
  };
  return surface(dark ? 'bark-dark' : 'bark', 128, draw, bump, 4);
}

/** Heavy rust and flaking paint, for wrecks and barrels. */
export function rustSurface(paint = '#5f6b5a'): Surface {
  const draw: Draw = (ctx, size, rand) => {
    ctx.fillStyle = paint;
    ctx.fillRect(0, 0, size, size);
    rustOver(ctx, size, rand, 0.42);
    blotches(ctx, size, rand, 1200, ['#4a2412', '#b56a3a', '#3a3a3a'], 0.5, 2, 0.5);
  };
  const bump: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, rand, 1400, ['#555', '#aaa'], 0.5, 3, 0.6);
  };
  return surface(`rust-${paint}`, 256, draw, bump, 2);
}

/**
 * Rust eating through paint in ragged, branching patches (thresholded noise, not circles),
 * with a darker rim of bubbled paint round each one. `coverage` is about the share rusted.
 */
function rustOver(ctx: CanvasRenderingContext2D, size: number, rand: () => number, coverage: number) {
  const a = tilingNoise(rand, 4);
  const b = tilingNoise(rand, 9);
  const c = tilingNoise(rand, 23);
  const tone = tilingNoise(rand, 7);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const edge = 0.5 + (0.5 - coverage) * 0.35;
  const ss = (e0: number, e1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const n = a(u, v) * 0.55 + b(u, v) * 0.3 + c(u, v) * 0.15;
      const rust = ss(edge, edge + 0.04, n);
      const rim = ss(edge - 0.035, edge, n) * (1 - rust);
      const t = tone(u, v);
      const i = (y * size + x) * 4;
      // Orange-brown fresh rust through to dark, flaking old rust.
      const rr = 58 + t * 62;
      const rg = 36 + t * 32;
      const rb = 24 + t * 14;
      d[i] = d[i] * (1 - rust) * (1 - rim * 0.35) + rr * rust;
      d[i + 1] = d[i + 1] * (1 - rust) * (1 - rim * 0.4) + rg * rust;
      d[i + 2] = d[i + 2] * (1 - rust) * (1 - rim * 0.45) + rb * rust;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Wind-rippled fine sand and grit, blended into the ground in drifts. */
export function sandSurface(): Surface {
  const draw: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#a3967f';
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, rand, 2200, ['#8a7e6a', '#b8ab92', '#6f6656', '#c4b9a2'], 0.4, 1.6, 0.6);
  };
  const bump: Draw = (ctx, size, rand) => {
    // Wavy ripples whose height fades in and out, so drifts don't read as straight stripes.
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const t = (Math.PI * 2) / size;
        const wave = Math.sin(y * t * 9 + Math.sin(x * t * 2) * 2.2 + Math.sin(x * t * 5 + y * t) * 0.6);
        const fade = 0.5 + 0.5 * Math.sin(x * t * 3 + y * t * 2);
        const c = 128 + wave * 30 * fade;
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    blotches(ctx, size, rand, 1800, ['#666', '#bbb'], 0.4, 1.4, 0.6);
  };
  return surface('sand', 256, draw, bump, 1);
}

/** Large soft grey blotches, used to vary the ground over tens of metres so it never looks tiled. */
export function macroNoiseTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(777);
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  blotches(ctx, size, rand, 90, ['#202020', '#e0e0e0', '#555', '#aaa'], 14, 50, 0.35);
  blotches(ctx, size, rand, 300, ['#404040', '#c0c0c0'], 4, 14, 0.25);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Broken old asphalt: cracked and patched, a faded dashed centre line, crumbling edges and
 * holes (transparent, so the ground shows through).
 */
export function asphaltSurface(): Surface {
  const draw: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#4a4744';
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, rand, 160, ['#3e3b38', '#57534e', '#615c55'], 4, 26, 0.45);
    blotches(ctx, size, rand, 2400, ['#2e2c2a', '#6e6a63', '#7a7468'], 0.4, 1.4, 0.6);
    blotches(ctx, size, rand, 40, ['rgba(150,138,115,1)'], 6, 22, 0.35);
    ctx.fillStyle = 'rgba(176,150,80,0.55)';
    for (let y = 0; y < size; y += size / 2) ctx.fillRect(size / 2 - 3, y + size * 0.08, 6, size * 0.28);
    cracks(ctx, size, rand, 50, 'rgba(25,23,21,0.85)', 1.3);
    // Crumbled edges and pot holes.
    ctx.globalCompositeOperation = 'destination-out';
    for (let y = 0; y < size; y += 2) {
      const l = Math.max(0, 6 + Math.sin(y * 0.07) * 6 + rand() * 10);
      const r = Math.max(0, 6 + Math.cos(y * 0.05) * 6 + rand() * 10);
      ctx.fillRect(0, y, l, 2);
      ctx.fillRect(size - r, y, r, 2);
    }
    blotches(ctx, size, rand, 7, ['#000'], 5, 16, 1);
    ctx.globalCompositeOperation = 'source-over';
  };
  const bump: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#909090';
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, rand, 2400, ['#707070', '#b0b0b0'], 0.4, 1.4, 0.6);
    cracks(ctx, size, rand, 50, '#303030', 1.6);
  };
  return surface('asphalt', 256, draw, bump, 2.5);
}

/**
 * Old car paint, sun-faded and eaten by rust: large rust patches, dark rust-through holes
 * and streaks running down from them.
 */
export function carPaintSurface(paint: string): Surface {
  const draw: Draw = (ctx, size, rand) => {
    ctx.fillStyle = paint;
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, rand, 120, ['rgba(255,250,235,0.5)', 'rgba(0,0,0,0.35)'], 6, 30, 0.18);
    rustOver(ctx, size, rand, 0.38);
    blotches(ctx, size, rand, 900, ['#5a2c14', '#b0662f', '#3e2010'], 0.5, 2.4, 0.4);
    // Rust streaks running down.
    for (let n = 0; n < 60; n++) {
      const x = rand() * size;
      const y = rand() * size;
      const g = ctx.createLinearGradient(x, y, x, y + size * (0.1 + rand() * 0.25));
      g.addColorStop(0, 'rgba(110,52,22,0.55)');
      g.addColorStop(1, 'rgba(110,52,22,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, 1 + rand() * 3, size * 0.35);
    }
    blotches(ctx, size, rand, 30, ['#1c120c', '#24170f'], 1, 4, 0.9);
  };
  const bump: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#999';
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, rand, 1500, ['#555', '#b0b0b0'], 0.5, 2.5, 0.6);
    blotches(ctx, size, rand, 30, ['#222'], 1, 4, 0.9);
  };
  return surface(`car-${paint}`, 256, draw, bump, 3);
}

/** Dirty, cracked safety glass with a spider-web break, on a transparent background. */
export function crackedGlassTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(4242);
  ctx.fillStyle = 'rgba(150,140,120,0.55)';
  ctx.fillRect(0, 0, size, size);
  blotches(ctx, size, rand, 200, ['rgba(120,105,85,1)', 'rgba(180,170,150,1)'], 3, 20, 0.35);
  const cx = size * (0.3 + rand() * 0.4);
  const cy = size * (0.3 + rand() * 0.4);
  ctx.strokeStyle = 'rgba(235,235,225,0.9)';
  ctx.lineWidth = 1.2;
  for (let n = 0; n < 14; n++) {
    let a = (n / 14) * Math.PI * 2 + rand() * 0.3;
    let x = cx;
    let y = cy;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      a += (rand() - 0.5) * 0.4;
      x += Math.cos(a) * size * 0.06;
      y += Math.sin(a) * size * 0.06;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let ring = 1; ring < 5; ring++) {
    ctx.beginPath();
    for (let n = 0; n <= 14; n++) {
      const a = (n / 14) * Math.PI * 2;
      const r = ring * size * 0.07 * (0.8 + rand() * 0.4);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Worn woven cloth in light neutral greys, tinted by the material colour, so one texture
 * serves every jacket, pair of trousers and scarf. Has grime, fading and stitched seams.
 */
export function clothSurface(): Surface {
  const draw: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#d8d4cc';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 2) {
      ctx.fillStyle = `rgba(90,84,74,${0.05 + rand() * 0.07})`;
      ctx.fillRect(0, y, size, 1);
    }
    for (let x = 0; x < size; x += 2) {
      ctx.fillStyle = `rgba(255,255,250,${0.03 + rand() * 0.05})`;
      ctx.fillRect(x, 0, 1, size);
    }
    blotches(ctx, size, rand, 90, ['#9c9282', '#b5ab9a', '#efebe2', '#8a7f6e'], 6, 34, 0.28);
    blotches(ctx, size, rand, 700, ['#6e6558', '#a49884'], 0.5, 1.8, 0.45);
    ctx.strokeStyle = 'rgba(70,62,52,0.45)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    for (const y of [size * 0.25, size * 0.75]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  };
  const bump: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 2) {
      for (let x = (y / 2) % 2; x < size; x += 2) {
        ctx.fillStyle = rand() < 0.5 ? '#9a9a9a' : '#7a7a7a';
        ctx.fillRect(x, y, 1, 1);
      }
    }
    blotches(ctx, size, rand, 160, ['#707070', '#a0a0a0'], 2, 10, 0.4);
    ctx.strokeStyle = '#555';
    for (const y of [size * 0.25, size * 0.75]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
  };
  return surface('cloth', 256, draw, bump, 1.6);
}

/** Scuffed, creased leather in neutral tones, tinted by the material colour. */
export function leatherSurface(): Surface {
  const draw: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#c9c0b4';
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, rand, 120, ['#a99d8c', '#ddd5ca', '#8f8474'], 4, 22, 0.35);
    blotches(ctx, size, rand, 900, ['#7d7262', '#e6dfd4'], 0.4, 1.6, 0.4);
    cracks(ctx, size, rand, 30, 'rgba(80,70,58,0.4)', 0.8);
  };
  const bump: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, rand, 1500, ['#7a7a7a', '#999'], 0.5, 2.2, 0.6);
    cracks(ctx, size, rand, 30, '#444', 1.2);
  };
  return surface('leather', 256, draw, bump, 2.5);
}

/**
 * A dry grass tuft with transparent background, for instanced ground cover. The see-through
 * pixels carry the grass colour too: a canvas stores them as black, which bleeds into the
 * blades when the texture is shrunk with distance and turns them into dark scribbles.
 */
export function grassTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(99);
  const shades = [
    ['#6f6440', '#b8a774'],
    ['#5f5a38', '#a89a62'],
    ['#7a6a44', '#c9b685'],
    ['#55573a', '#99956a'],
    ['#6a5c3c', '#b39d6c'],
  ];
  // Back blades first, darker and shorter, then the front ones over them.
  for (let n = 0; n < 70; n++) {
    const back = n < 30;
    const x = 30 + rand() * 196;
    const lean = (rand() - 0.5) * 80;
    const h = (back ? 70 : 100) + rand() * (back ? 90 : 150);
    const w = 3 + rand() * 4;
    const [root, tip] = shades[Math.floor(rand() * shades.length)];
    const grad = ctx.createLinearGradient(0, size, 0, size - h);
    grad.addColorStop(0, back ? '#3e3826' : root);
    grad.addColorStop(1, tip);
    ctx.fillStyle = grad;
    // A tapering blade that bends over as it rises.
    const tx = x + lean;
    const ty = size - h;
    const cx = x + lean * 0.25;
    const cy = size - h * 0.55;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, size);
    ctx.quadraticCurveTo(cx - w * 0.35, cy, tx, ty);
    ctx.quadraticCurveTo(cx + w * 0.35, cy, x + w / 2, size);
    ctx.closePath();
    ctx.fill();
    // A few dry seed heads.
    if (!back && rand() < 0.12) {
      ctx.fillStyle = '#c8b27e';
      for (let k = 0; k < 6; k++) {
        ctx.beginPath();
        ctx.ellipse(tx - lean * 0.02 * k, ty + k * 4, 2.2, 3.4, lean * 0.01, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return cutout(canvas, [0x93, 0x84, 0x58]);
}

/**
 * Turns a canvas drawing with a transparent background into a texture whose see-through
 * pixels carry `fill` instead of black, so shrinking it with distance doesn't darken the edges.
 */
function cutout(canvas: HTMLCanvasElement, fill: [number, number, number]): THREE.Texture {
  const size = canvas.width;
  const src = canvas.getContext('2d')!.getImageData(0, 0, size, size).data;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    // Flip rows: canvas rows run top down, texture rows bottom up.
    const from = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x++) {
      const i = from + x * 4;
      const o = (y * size + x) * 4;
      const a = src[i + 3];
      // Fully clear pixels take the fill colour; partly clear keep their own.
      data[o] = a ? src[i] : fill[0];
      data[o + 1] = a ? src[i + 1] : fill[1];
      data[o + 2] = a ? src[i + 2] : fill[2];
      data[o + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A round spray of small leaves on twigs, for the foliage cards on living trees. Leaves thin
 * out towards the edge so a card reads as a clump rather than a square.
 */
export function leafTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(4242);
  const c = size / 2;
  // Twigs from the centre outwards, which the leaves hang off.
  ctx.strokeStyle = '#4a3c2c';
  ctx.lineCap = 'round';
  const twigs: [number, number, number][] = [];
  for (let n = 0; n < 9; n++) {
    const a = (n / 9) * Math.PI * 2 + rand() * 0.5;
    const len = size * (0.3 + rand() * 0.14);
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(a) * len, c + Math.sin(a) * len);
    ctx.stroke();
    twigs.push([a, len, 0]);
  }
  const shades = ['#5d6a32', '#6b7838', '#4e5a2a', '#76803e', '#828a48', '#59642c', '#8a8248'];
  for (let n = 0; n < 420; n++) {
    const [a0, len] = twigs[Math.floor(rand() * twigs.length)];
    const along = 0.2 + rand() * 0.85;
    const spread = (rand() - 0.5) * 30;
    const a = a0 + (rand() - 0.5) * 0.35;
    const x = c + Math.cos(a) * len * along - Math.sin(a) * spread * 0.4;
    const y = c + Math.sin(a) * len * along + Math.cos(a) * spread * 0.4;
    const l = 9 + rand() * 9;
    const w = 3.5 + rand() * 3;
    const tilt = a + (rand() - 0.5) * 2.2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.fillStyle = shades[Math.floor(rand() * shades.length)];
    ctx.beginPath();
    ctx.moveTo(-l / 2, 0);
    ctx.quadraticCurveTo(0, -w, l / 2, 0);
    ctx.quadraticCurveTo(0, w, -l / 2, 0);
    ctx.fill();
    // A lighter midrib and a darker underside on half the leaf give it some shape.
    ctx.fillStyle = 'rgba(30,34,14,0.28)';
    ctx.beginPath();
    ctx.moveTo(-l / 2, 0);
    ctx.quadraticCurveTo(0, w, l / 2, 0);
    ctx.fill();
    ctx.strokeStyle = 'rgba(200,200,140,0.25)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-l / 2, 0);
    ctx.lineTo(l / 2, 0);
    ctx.stroke();
    ctx.restore();
  }
  return cutout(canvas, [0x62, 0x6c, 0x34]);
}

/** A soft round dot for ash particles. */
export function dotTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(canvas);
}

/**
 * A box whose texture coordinates are in metres (divided by `scale`), so textures keep the
 * same size on a 3 m wall and a 0.2 m edge instead of stretching.
 */
export function worldBox(w: number, h: number, d: number, scale = 1.5): THREE.BoxGeometry {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  // Face order in BoxGeometry: +x, -x, +y, -y, +z, -z; 4 vertices each.
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / scale, (uv.getY(i) * dims[f][1]) / scale);
    }
  }
  return geo;
}

/** Smooth tiling value noise: a lattice of random values, `cells` across, eased between. */
function tilingNoise(rand: () => number, cells: number): (u: number, v: number) => number {
  const grid = Float32Array.from({ length: cells * cells }, rand);
  const at = (i: number, j: number) => grid[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
  return (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const i = Math.floor(x);
    const j = Math.floor(y);
    let fx = x - i;
    let fy = y - j;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * fx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * fx;
    return a + (b - a) * fy;
  };
}

/** Paints every pixel from a function of (u, v) in 0..1, returning [r, g, b] in 0..255. */
function paint(ctx: CanvasRenderingContext2D, size: number, fn: (u: number, v: number) => [number, number, number]) {
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn(x / size, y / size);
      const i = (y * size + x) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Sun-bleached vertical boards for wood walls: each board its own shade, wavy grain, knots,
 * dark gaps between boards and rusty nail heads where the boards cross hidden battens.
 */
export function woodWallSurface(): Surface {
  const BOARDS = 6;
  const plan = (rand: () => number) => ({
    shade: Array.from({ length: BOARDS }, () => 0.78 + rand() * 0.34),
    tint: Array.from({ length: BOARDS }, () => rand()),
    knots: Array.from({ length: 7 }, () => [rand(), rand(), 0.008 + rand() * 0.012] as const),
    grain: tilingNoise(rand, 8),
    fine: tilingNoise(rand, 64),
    stain: tilingNoise(rand, 5),
  });
  const height = (u: number, v: number, p: ReturnType<typeof plan>) => {
    const b = Math.floor(u * BOARDS);
    const inB = u * BOARDS - b;
    const gap = Math.min(inB, 1 - inB) < 0.035 ? 0 : 1;
    // Boards cup slightly: their middles stand proud of their edges.
    const cup = Math.sin(inB * Math.PI) * 0.25;
    const wave = Math.sin((u * BOARDS * 40 + p.grain(u, v) * 9 + b * 3.1) * 1.0);
    return { b, inB, gap, cup, wave };
  };
  const draw: Draw = (ctx, size, rand) => {
    const p = plan(rand);
    paint(ctx, size, (u, v) => {
      const { b, gap, wave } = height(u, v, p);
      if (!gap) return [34, 27, 21];
      let k = p.shade[b] * (0.86 + wave * 0.06 + p.fine(u, v) * 0.1);
      for (const [ku, kv, r] of p.knots) {
        const d = Math.hypot((u - ku) * 2.2, v - kv);
        if (d < r * 2.5) k *= 0.55 + (d / (r * 2.5)) * 0.45;
      }
      // Old weathered grey on some boards, warmer brown under the grey on others.
      const grey = 0.35 + p.tint[b] * 0.5 + (p.stain(u, v) - 0.5) * 0.4;
      const warm: [number, number, number] = [138, 98, 64];
      const aged: [number, number, number] = [128, 118, 104];
      const c = warm.map((w, i) => (w + (aged[i] - w) * Math.min(1, Math.max(0, grey))) * k) as [number, number, number];
      // Nail heads.
      const inB = u * BOARDS - b;
      for (const nv of [0.12, 0.62]) {
        for (const nu of [0.3, 0.7]) {
          if (Math.hypot((inB - nu) / BOARDS, v - nv) < 0.006) return [52, 36, 26];
        }
      }
      return c;
    });
  };
  const bump: Draw = (ctx, size, rand) => {
    const p = plan(rand);
    paint(ctx, size, (u, v) => {
      const { gap, cup, wave } = height(u, v, p);
      const h = gap ? 150 + cup * 120 + wave * 18 + p.fine(u, v) * 20 : 20;
      return [h, h, h];
    });
  };
  return surface('wood-wall', 512, draw, bump, 3);
}

/**
 * Rough-cut stone blocks laid in courses with recessed mortar, for stone walls. Each block
 * has its own tone, chipped edges and lichen-dark stains.
 */
export function stoneWallSurface(): Surface {
  const ROWS = 6;
  const COLS = 3;
  const plan = (rand: () => number) => ({
    shade: Array.from({ length: ROWS * COLS * 2 }, () => 0.8 + rand() * 0.3),
    warm: Array.from({ length: ROWS * COLS * 2 }, () => rand()),
    n: tilingNoise(rand, 16),
    fine: tilingNoise(rand, 96),
    big: tilingNoise(rand, 4),
  });
  const cell = (u: number, v: number, p: ReturnType<typeof plan>) => {
    const row = Math.floor(v * ROWS);
    // Every other course is offset by half a block.
    const uu = u * COLS + (row % 2) * 0.5;
    const col = Math.floor(uu);
    const fu = uu - col;
    const fv = v * ROWS - row;
    const wobble = (p.n(u, v) - 0.5) * 0.12;
    // Blocks are twice as long as they are tall, so measure the mortar in the same units both ways.
    const edge = Math.min(fu * (ROWS / COLS), (1 - fu) * (ROWS / COLS), fv, 1 - fv) + wobble * 0.3;
    const id = row * COLS + (col % COLS);
    return { edge, id };
  };
  const draw: Draw = (ctx, size, rand) => {
    const p = plan(rand);
    paint(ctx, size, (u, v) => {
      const { edge, id } = cell(u, v, p);
      if (edge < 0.06) {
        const m = 78 + p.fine(u, v) * 26;
        return [m * 1.02, m * 0.98, m * 0.92];
      }
      const k = p.shade[id] * (0.82 + p.n(u, v) * 0.18 + p.fine(u, v) * 0.12) * (edge < 0.12 ? 0.9 : 1);
      const stain = Math.max(0, p.big(u, v) - 0.55) * 1.2;
      const base: [number, number, number] = p.warm[id] > 0.5 ? [160, 152, 140] : [146, 145, 141];
      return [base[0] * k * (1 - stain * 0.4), base[1] * k * (1 - stain * 0.35), base[2] * k * (1 - stain * 0.45)];
    });
  };
  const bump: Draw = (ctx, size, rand) => {
    const p = plan(rand);
    paint(ctx, size, (u, v) => {
      const { edge } = cell(u, v, p);
      // Blocks bulge out of the mortar, with rounded, chipped arrises.
      const h = edge < 0.06 ? 40 : 120 + Math.min(1, (edge - 0.06) * 8) * 70 + p.n(u, v) * 40 + p.fine(u, v) * 30;
      return [h, h, h];
    });
  };
  return surface('stone-wall', 512, draw, bump, 5);
}

/**
 * Corrugated sheet steel for scrap walls: deep ridges, flaking grey paint over rust, orange
 * streaks running down from bolt holes and a row of rivets where two sheets overlap.
 */
export function sheetMetalSurface(): Surface {
  const RIDGES = 10;
  const plan = (rand: () => number) => ({
    rust: tilingNoise(rand, 6),
    flake: tilingNoise(rand, 40),
    streak: Array.from({ length: 64 }, () => rand()),
  });
  const draw: Draw = (ctx, size, rand) => {
    const p = plan(rand);
    paint(ctx, size, (u, v) => {
      const ridge = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * RIDGES);
      const s = p.streak[Math.floor(u * 64)];
      const streak = s > 0.7 ? Math.max(0, 1 - ((v + s * 3) % 1) * 1.6) * (s - 0.7) * 3 : 0;
      const rust = Math.min(0.85, Math.max(0, (p.rust(u, v) - 0.55) * 2.2 + (p.flake(u, v) - 0.5) * 0.9 + streak));
      const paintC = 98 + ridge * 40;
      const painted: [number, number, number] = [paintC * 0.95, paintC, paintC * 1.02];
      const r = 0.75 + p.flake(u, v) * 0.35;
      const rusty: [number, number, number] = [124 * r, 74 * r, 46 * r];
      // Rivets along the overlap seam.
      if (Math.abs(v - 0.5) < 0.012 && Math.abs(((u * RIDGES) % 1) - 0.5) < 0.12) return [70, 50, 40];
      if (Math.abs(v - 0.5) < 0.004) return [50, 40, 34];
      return painted.map((c, i) => c + (rusty[i] - c) * rust) as [number, number, number];
    });
  };
  const bump: Draw = (ctx, size, rand) => {
    const p = plan(rand);
    paint(ctx, size, (u, v) => {
      const ridge = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * RIDGES);
      let h = 50 + ridge * 160 + (p.flake(u, v) - 0.5) * 20;
      if (Math.abs(v - 0.5) < 0.012 && Math.abs(((u * RIDGES) % 1) - 0.5) < 0.12) h = 240;
      return [h, h, h];
    });
  };
  return surface('sheet-metal', 512, draw, bump, 3);
}

/** Close wood grain for tool handles and gun furniture: oiled, darker along the grain lines. */
export function woodGrainSurface(): Surface {
  const plan = (rand: () => number) => ({ n: tilingNoise(rand, 6), fine: tilingNoise(rand, 80) });
  const draw: Draw = (ctx, size, rand) => {
    const p = plan(rand);
    paint(ctx, size, (u, v) => {
      const ring = Math.sin((v * 30 + p.n(u, v) * 6) * Math.PI);
      const k = 0.78 + ring * 0.12 + p.fine(u, v) * 0.12;
      return [150 * k, 100 * k, 60 * k];
    });
  };
  const bump: Draw = (ctx, size, rand) => {
    const p = plan(rand);
    paint(ctx, size, (u, v) => {
      const h = 128 + Math.sin((v * 30 + p.n(u, v) * 6) * Math.PI) * 30 + p.fine(u, v) * 20;
      return [h, h, h];
    });
  };
  return surface('wood-grain', 256, draw, bump, 1.5);
}

/** Worn gun metal: fine brushing scratches, darker bluing in recesses, lighter wear on edges. */
export function gunMetalSurface(): Surface {
  const plan = (rand: () => number) => ({ n: tilingNoise(rand, 8), fine: tilingNoise(rand, 128) });
  const draw: Draw = (ctx, size, rand) => {
    const p = plan(rand);
    paint(ctx, size, (u, v) => {
      const k = 0.8 + p.n(u, v) * 0.25 + p.fine(u * 0.2, v) * 0.15;
      return [180 * k, 182 * k, 186 * k];
    });
    // Scratches.
    ctx.strokeStyle = 'rgba(235,235,240,0.35)';
    ctx.lineWidth = 1;
    for (let n = 0; n < 90; n++) {
      const x = rand() * size;
      const y = rand() * size;
      const a = (rand() - 0.5) * 0.6;
      const l = 4 + rand() * 30;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
  };
  const bump: Draw = (ctx, size, rand) => {
    const p = plan(rand);
    paint(ctx, size, (u, v) => {
      const h = 128 + p.fine(u * 0.2, v) * 30;
      return [h, h, h];
    });
  };
  return surface('gun-metal', 256, draw, bump, 0.8);
}
