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
    blotches(ctx, size, rand, 160, ['#8a4b2a', '#a35d32', '#5e2f18', '#7a4024'], 4, 26, 0.75);
    blotches(ctx, size, rand, 1200, ['#4a2412', '#b56a3a', '#3a3a3a'], 0.5, 2, 0.6);
  };
  const bump: Draw = (ctx, size, rand) => {
    ctx.fillStyle = '#888';
    ctx.fillRect(0, 0, size, size);
    blotches(ctx, size, rand, 1400, ['#555', '#aaa'], 0.5, 3, 0.6);
  };
  return surface(`rust-${paint}`, 256, draw, bump, 2);
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
    // Irregular rust patches: clusters of small spots that wander, not neat circles.
    blotches(ctx, size, rand, 40, ['#6e4a30', '#5e4434', '#7a5a40'], 20, 60, 0.28);
    for (let patch = 0; patch < 22; patch++) {
      let x = rand() * size;
      let y = rand() * size;
      const spots = 40 + Math.floor(rand() * 90);
      for (let n = 0; n < spots; n++) {
        x += (rand() - 0.5) * 7;
        y += (rand() - 0.5) * 7;
        ctx.globalAlpha = 0.35 + rand() * 0.4;
        ctx.fillStyle = ['#6e3c20', '#7f4a28', '#5e3420', '#8a5530', '#4e2c18'][Math.floor(rand() * 5)];
        ctx.beginPath();
        ctx.arc(((x % size) + size) % size, ((y % size) + size) % size, 2 + rand() * 7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    blotches(ctx, size, rand, 900, ['#5a2c14', '#b0662f', '#3e2010'], 0.5, 2.4, 0.5);
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

/** A dry grass tuft with transparent background, for instanced ground cover. */
export function grassTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const rand = mulberry32(99);
  for (let n = 0; n < 26; n++) {
    const x = 8 + rand() * 48;
    const lean = (rand() - 0.5) * 18;
    const h = 24 + rand() * 38;
    ctx.strokeStyle = ['#8f7f52', '#a39062', '#6f6444', '#7d6d47'][Math.floor(rand() * 4)];
    ctx.lineWidth = 1.5 + rand();
    ctx.beginPath();
    ctx.moveTo(x, 64);
    ctx.quadraticCurveTo(x + lean * 0.3, 64 - h * 0.6, x + lean, 64 - h);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
