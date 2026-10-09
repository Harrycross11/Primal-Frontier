// Repaints a model's materials in one of the palette's colours while keeping the grain of its
// texture: dents, rust streaks, wood grain and panel lines still show through the new colour.

import * as THREE from 'three';
import { PAINTS } from '../../shared/paint.ts';

/**
 * 'all' covers the whole surface; 'body' and 'soft' only the coloured parts of a texture, for
 * models that keep their tyres, glass and trim in the same texture as the body.
 */
export type PaintMode = 'all' | 'body' | 'soft';

/**
 * How much of each texel takes the paint. 'body' paints only well-coloured texels; 'soft' also
 * greyish ones, for faded paintwork, while still sparing black tyres and dark glass.
 */
const WEIGHT: Record<PaintMode, string> = {
  all: '1.0',
  body: 'smoothstep(0.16, 0.34, sat) * smoothstep(0.035, 0.09, hi)',
  soft: 'smoothstep(0.04, 0.14, sat) * smoothstep(0.08, 0.2, hi)',
};

const cache = new Map<string, THREE.Material>();

/** Smooth value noise over the texture's coordinates, for camo blotches. */
const NOISE = `
float paintHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float paintNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(paintHash(i), paintHash(i + vec2(1.0, 0.0)), f.x), mix(paintHash(i + vec2(0.0, 1.0)), paintHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float paintFbm(vec2 p) { return paintNoise(p) * 0.6 + paintNoise(p * 2.3 + 17.0) * 0.3 + paintNoise(p * 5.1 + 3.0) * 0.1; }
`;

/** A copy of `base` in paint `n` (shared between everything painted the same), or `base` for 0. */
export function painted<M extends THREE.Material>(base: M, n: number, mode: PaintMode = 'all'): M {
  const paint = PAINTS[n];
  const hex = paint?.hex ?? null;
  if (hex === null) return base;
  const key = `${base.uuid}:${n}:${mode}`;
  const hit = cache.get(key);
  if (hit) return hit as M;
  const mat = base.clone() as M;
  const finish = paint.finish ?? 'plain';
  const colour = { value: new THREE.Color(hex) };
  const camo = (paint.camo ?? [hex, hex, hex]).map((c) => ({ value: new THREE.Color(c) }));
  const std = mat as unknown as THREE.MeshStandardMaterial;
  if (std.isMeshStandardMaterial) {
    if (finish === 'chrome' || finish === 'pearl') {
      // A polished coat: its own shine instead of the scan's rust and grime.
      std.metalnessMap = null;
      std.roughnessMap = null;
      std.metalness = finish === 'chrome' ? 1 : 0.55;
      std.roughness = finish === 'chrome' ? 0.12 : 0.28;
    } else if (mode === 'all') {
      // Glossier, less metallic: it reads as a coat of paint over whatever was there.
      std.metalness = Math.min(std.metalness, 0.3);
      if (std.metalnessMap) std.metalness = Math.min(std.metalness, 0.15);
    }
  }
  // How much the texture's own light and dark shows through.
  const grain = finish === 'chrome' ? 'mix(0.8, 1.05, clamp(sqrt(lum) * 1.35, 0.0, 1.0))' : 'mix(0.42, 1.25, clamp(sqrt(lum) * 1.35, 0.0, 1.0))';
  const tint =
    finish === 'camo'
      ? `paintCamo()`
      : 'paintColour';
  mat.onBeforeCompile = (shader) => {
    base.onBeforeCompile?.(shader, undefined as never);
    shader.uniforms.paintColour = colour;
    shader.uniforms.camoA = camo[0];
    shader.uniforms.camoB = camo[1];
    shader.uniforms.camoC = camo[2];
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 paintColour;
        uniform vec3 camoA;
        uniform vec3 camoB;
        uniform vec3 camoC;`,
      )
      // After the texture coordinates are declared, which camo needs.
      .replace(
        '#include <uv_pars_fragment>',
        `#include <uv_pars_fragment>
        ${NOISE}
        vec3 paintCamo() {
          #ifdef USE_MAP
            vec2 at = vMapUv * 7.0;
          #else
            vec2 at = vec2(0.0);
          #endif
          vec3 c = paintColour;
          c = mix(c, camoA, step(0.52, paintFbm(at)));
          c = mix(c, camoB, step(0.6, paintFbm(at * 1.3 + 41.0)));
          c = mix(c, camoC, step(0.66, paintFbm(at * 1.7 + 83.0)));
          return c;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float paintW = 0.0;
        {
          vec3 c = diffuseColor.rgb;
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float hi = max(c.r, max(c.g, c.b));
          float sat = hi > 0.0 ? (hi - min(c.r, min(c.g, c.b))) / hi : 0.0;
          paintW = ${WEIGHT[mode]};
          vec3 p = ${tint} * ${grain};
          diffuseColor.rgb = mix(c, p, paintW);
        }`,
      );
    // Neon glows, so it shows up at night.
    if (finish === 'neon') {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n totalEmissiveRadiance += paintColour * paintW * 0.9;',
      );
    }
  };
  mat.customProgramCacheKey = () => `paint-${mode}-${finish}-${base.customProgramCacheKey?.() ?? ''}`;
  cache.set(key, mat);
  return mat;
}

const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/** CSS background for a paint's swatch: flat, shiny, glowing or blotched to match its finish. */
export function swatch(n: number): string {
  const p = PAINTS[n];
  if (!p || p.hex === null) return 'transparent';
  const c = css(p.hex);
  switch (p.finish) {
    case 'chrome':
      return `linear-gradient(135deg, ${c} 0%, #ffffff 30%, ${c} 55%, #1a1a1a 100%)`;
    case 'pearl':
      return `radial-gradient(circle at 35% 30%, #ffffff 0%, ${c} 45%, ${c} 100%)`;
    case 'neon':
      return `radial-gradient(circle, #ffffff 0%, ${c} 35%, ${c} 100%)`;
    case 'camo': {
      const [a, b, d] = p.camo!.map(css);
      return `radial-gradient(circle at 25% 30%, ${a} 0 22%, transparent 23%), radial-gradient(circle at 70% 65%, ${b} 0 20%, transparent 21%), radial-gradient(circle at 60% 20%, ${d} 0 14%, transparent 15%), ${c}`;
    }
    default:
      return c;
  }
}

/** Paints every mesh in a model, apart from anything under `skip` (a muzzle flash, say). */
export function paintModel(root: THREE.Object3D, n: number, skip?: THREE.Object3D, mode: PaintMode = 'all') {
  const skipped = new Set<THREE.Object3D>();
  skip?.traverse((o) => skipped.add(o));
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || skipped.has(mesh)) return;
    const mat = mesh.material as THREE.Material | THREE.Material[];
    // Glow and see-through parts (flames, lenses, sights) keep their own colour.
    const one = (m: THREE.Material) => (m.transparent || (m as THREE.MeshBasicMaterial).isMeshBasicMaterial ? m : painted(m, n, mode));
    mesh.material = Array.isArray(mat) ? mat.map(one) : one(mat);
  });
}
