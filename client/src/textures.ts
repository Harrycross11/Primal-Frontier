// Surface textures. Most are photo-scanned CC0 materials from Poly Haven, committed under
// client/public/textures (see scripts/fetch-textures.py); a few small or special ones (gun metal,
// grass, leaves, glass) are still drawn on canvases at startup. Each surface has a colour map, a
// normal map for detail under light, and a roughness map.

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

const loader = new THREE.TextureLoader();
const images = new Map<string, Promise<HTMLImageElement>>();

function image(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = new THREE.ImageLoader().loadAsync(url);
    images.set(url, p);
  }
  return p;
}

interface PhotoOptions {
  /** Cache key, when one photo is used several ways (different paint, wear). */
  key?: string;
  /** Tiles per texture coordinate unit; above 1 shrinks the texture. */
  repeat?: number;
  /** Draws over the photo's colour map on a canvas once it has loaded. */
  edit?: (ctx: CanvasRenderingContext2D, size: number) => void;
}

/**
 * A photo-scanned surface from client/public/textures. Returns at once; the images stream in
 * and appear when loaded. Normal maps are OpenGL-style, as three.js expects.
 */
function photo(name: string, opts: PhotoOptions = {}): Surface {
  const key = opts.key ?? name;
  const hit = cache.get(key);
  if (hit) return hit;
  const url = (kind: string) => `/textures/${name}_${kind}.webp`;
  let map: THREE.Texture;
  if (opts.edit) {
    // Drawn into a canvas of the photo's final size up front, so the texture never changes size.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#7a756d';
    ctx.fillRect(0, 0, 1024, 1024);
    map = new THREE.CanvasTexture(canvas);
    const edit = opts.edit;
    image(url('diff')).then((img) => {
      ctx.clearRect(0, 0, 1024, 1024);
      ctx.drawImage(img, 0, 0, 1024, 1024);
      edit(ctx, 1024);
      map.needsUpdate = true;
    });
  } else map = loader.load(url('diff'));
  map.colorSpace = THREE.SRGBColorSpace;
  const normalMap = loader.load(url('nor'));
  const roughnessMap = loader.load(url('rough'));
  for (const t of [map, normalMap, roughnessMap]) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (opts.repeat) t.repeat.setScalar(opts.repeat);
  }
  const s = { map, normalMap, roughnessMap };
  cache.set(key, s);
  return s;
}

/**
 * Turns the pale paint in the rusted-metal photo into `paint`, keeping its shading, and darkens
 * its bright orange rust to old brown rust. `coverage` above 0.5 lets rust spread further.
 */
function repaint(ctx: CanvasRenderingContext2D, size: number, paint: string, coverage = 0.5) {
  const c = new THREE.Color(paint).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  const lo = 0.36 - (coverage - 0.5) * 0.25;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i];
    const g = d[i + 1];
    const b = d[i + 2];
    const max = Math.max(r, g, b);
    const sat = max ? (max - Math.min(r, g, b)) / max : 0;
    // Paint is the grey-white parts; rust is saturated orange.
    const t = Math.min(1, Math.max(0, (lo + 0.08 - sat) / 0.08));
    const k = t * t * (3 - 2 * t);
    const lum = (r * 0.3 + g * 0.55 + b * 0.15) / 210;
    d[i] = r * 0.6 + (c.r * 255 * lum - r * 0.6) * k;
    d[i + 1] = g * 0.42 + (c.g * 255 * lum - g * 0.42) * k;
    d[i + 2] = b * 0.36 + (c.b * 255 * lum - b * 0.36) * k;
  }
  ctx.putImageData(img, 0, 0);
}

/** Dark forest soil with leaf litter, for planter boxes. */
export const soilSurface = () => photo('forest-floor', { repeat: 1 });
/** Dry, cracked grey earth. */
export const groundSurface = () => photo('ground', { repeat: 2.5 });
/** Dusty brown dirt and gravel, blended into the ground in drifts. */
export const sandSurface = () => photo('dirt', { repeat: 2.5 });
/** Weathered pale boulder, about 2 m to a tile, tinted per rock by vertex colours. */
export const rockSurface = () => photo('rock');
/** Rough bark for trees and poles; the dark one for dead, charred trees. */
export const barkSurface = (dark = false) => photo(dark ? 'bark-dark' : 'bark');
/** Rust eating through old paint of the given colour, for wrecks, barrels and scrap. */
export const rustSurface = (paint = '#5f6b5a') => photo('rust', { key: `rust-${paint}`, edit: (ctx, size) => repaint(ctx, size, paint) });
/** Weathered horizontal planks. */
export const plankSurface = () => photo('planks');
/** Worn tread plate steel. */
export const metalSurface = () => photo('metal-plate');
/** Stained, cracked concrete for ruins. */
export const concreteSurface = () => photo('concrete');
/** Neutral grey woven cloth, tinted by the material colour, for every garment. */
export const clothSurface = () => photo('cloth', { repeat: 3 });
/** Neutral grey creased leather, tinted by the material colour. */
export const leatherSurface = () => photo('leather', { repeat: 2 });
/** Sun-bleached vertical boards for wood walls. */
export const woodWallSurface = () => photo('wood-wall');
/** Rough stone blocks in courses for stone walls. */
export const stoneWallSurface = () => photo('stone-wall');
/** Rusted sheet steel for scrap walls. */
export const sheetMetalSurface = () => photo('sheet-metal');
/** Close wood grain in neutral grey, tinted per use, for tool handles and gun furniture. */
export const woodGrainSurface = () => photo('wood-grain', { repeat: 2 });

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
  return photo('asphalt', {
    key: 'asphalt-worn',
    // The wear is drawn at 256 px and scaled up to the photo.
    edit: (ctx, size) => {
      const rand = mulberry32(4242);
      ctx.save();
      ctx.scale(size / 256, size / 256);
      const s = 256;
      ctx.fillStyle = 'rgba(176,150,80,0.5)';
      for (let y = 0; y < s; y += s / 2) ctx.fillRect(s / 2 - 3, y + s * 0.08, 6, s * 0.28);
      // Pot holes: ragged clusters rather than neat circles, with a darker broken rim first.
      const holes: [number, number, number][] = [];
      for (let n = 0; n < 4; n++) holes.push([40 + rand() * 176, rand() * s, 7 + rand() * 7]);
      const holeShape = (grow: number) => {
        for (const [hx, hy, hr] of holes) {
          const r2 = mulberry32(Math.round(hx * 97 + hy));
          for (let k = 0; k < 9; k++) {
            const a = r2() * Math.PI * 2;
            const d = r2() * hr * 0.7;
            for (const oy of [-s, 0, s]) {
              ctx.beginPath();
              ctx.ellipse(hx + Math.cos(a) * d, hy + oy + Math.sin(a) * d, hr * (0.35 + r2() * 0.3) + grow, hr * (0.3 + r2() * 0.3) + grow, r2() * 3, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      };
      ctx.fillStyle = 'rgba(20,18,16,0.45)';
      holeShape(2.5);
      // Crumbled edges: a smooth, wandering line down each side, the same at top and bottom so
      // it tiles along the road.
      const edge = (side: number) => {
        const pts = 32;
        const off: number[] = [];
        for (let n = 0; n < pts; n++) off.push(rand());
        const at = (y: number) => {
          const f = (y / s) * pts;
          const i = Math.floor(f);
          const t = f - i;
          const a = off[((i % pts) + pts) % pts];
          const b = off[(i + 1) % pts];
          const w = a + (b - a) * (t * t * (3 - 2 * t));
          return 4 + w * 14 + Math.sin((y / s) * Math.PI * 6) * 3 + Math.sin((y / s) * Math.PI * 22) * 1.2;
        };
        ctx.beginPath();
        ctx.moveTo(side < 0 ? -1 : s + 1, 0);
        for (let y = 0; y <= s; y += 2) ctx.lineTo(side < 0 ? at(y) : s - at(y), y);
        ctx.lineTo(side < 0 ? -1 : s + 1, s);
        ctx.closePath();
        ctx.fill();
      };
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000';
      // Feathered, so the road fades into the dirt instead of ending in a hard cut.
      ctx.filter = `blur(${(size / 256) * 1.5}px)`;
      edge(-1);
      edge(1);
      holeShape(0);
      ctx.filter = 'none';
      ctx.restore();
    },
  });
}

/**
 * Old car paint, sun-faded and eaten by rust: large rust patches, dark rust-through holes
 * and streaks running down from them.
 */
export function carPaintSurface(paint: string): Surface {
  return photo('rust', {
    key: `car-${paint}`,
    edit: (ctx, size) => {
      repaint(ctx, size, paint, 0.7);
      // Rust streaks running down.
      const rand = mulberry32(paint.length * 131);
      for (let n = 0; n < 60; n++) {
        const x = rand() * size;
        const y = rand() * size;
        const g = ctx.createLinearGradient(x, y, x, y + size * (0.1 + rand() * 0.25));
        g.addColorStop(0, 'rgba(110,52,22,0.4)');
        g.addColorStop(1, 'rgba(110,52,22,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x, y, (1 + rand() * 3) * (size / 256), size * 0.35);
      }
    },
  });
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
