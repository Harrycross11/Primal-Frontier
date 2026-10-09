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

/** A copy of `base` in paint `n` (shared between everything painted the same), or `base` for 0. */
export function painted<M extends THREE.Material>(base: M, n: number, mode: PaintMode = 'all'): M {
  const hex = PAINTS[n]?.hex ?? null;
  if (hex === null) return base;
  const key = `${base.uuid}:${n}:${mode}`;
  const hit = cache.get(key);
  if (hit) return hit as M;
  const mat = base.clone() as M;
  const colour = { value: new THREE.Color(hex) };
  // Glossier, less metallic: it reads as a coat of paint over whatever was there.
  const std = mat as unknown as THREE.MeshStandardMaterial;
  if (std.isMeshStandardMaterial && mode === 'all') {
    std.metalness = Math.min(std.metalness, 0.3);
    if (std.metalnessMap) std.metalness = Math.min(std.metalness, 0.15);
  }
  mat.onBeforeCompile = (shader) => {
    base.onBeforeCompile?.(shader, undefined as never);
    shader.uniforms.paintColour = colour;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 paintColour;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 c = diffuseColor.rgb;
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          float hi = max(c.r, max(c.g, c.b));
          float sat = hi > 0.0 ? (hi - min(c.r, min(c.g, c.b))) / hi : 0.0;
          float w = ${WEIGHT[mode]};
          vec3 p = paintColour * mix(0.42, 1.25, clamp(sqrt(lum) * 1.35, 0.0, 1.0));
          diffuseColor.rgb = mix(c, p, w);
        }`,
      );
  };
  mat.customProgramCacheKey = () => `paint-${mode}-${base.customProgramCacheKey?.() ?? ''}`;
  cache.set(key, mat);
  return mat;
}

/** CSS colour for a swatch. */
export function swatch(n: number): string {
  const hex = PAINTS[n]?.hex;
  return hex === null || hex === undefined ? 'transparent' : `#${hex.toString(16).padStart(6, '0')}`;
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
