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
  for (const t of [map, normalMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
  }
  const s = { map, normalMap };
  cache.set(name, s);
  return s;
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
