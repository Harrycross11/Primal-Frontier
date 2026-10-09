// Atmosphere for every material: replaces three.js's flat distance fog with height fog
// that pools in low ground and thins with altitude, and glows warm when you look toward the
// sun (light scattering through the dust). Import this before any material is created.

import * as THREE from 'three';
import { SUN_DIRECTION } from './graphics.ts';

/** How quickly the fog thins with height, per metre, and the height where it is thickest. */
export const FOG_FALLOFF = 0.055;
export const FOG_BASE = -2;
/** The colour of the haze toward the sun, in linear light. */
export const SUN_HAZE = new THREE.Color(0xffd2a4);

const v = (c: { x: number; y: number; z: number } | THREE.Color) =>
  'r' in c ? `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})` : `vec3(${c.x.toFixed(4)}, ${c.y.toFixed(4)}, ${c.z.toFixed(4)})`;

// Marks shaders that have the directional lights' uniforms, so the fog can find the sun.
THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin.replace('#if NUM_DIR_LIGHTS > 0', '#if NUM_DIR_LIGHTS > 0\n#define PF_DIR_LIGHT');

THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vFogWorld;
#endif`;

THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  // mvPosition exists in every built-in vertex shader (meshes, points, lines, sprites).
  vFogWorld = (inverse(viewMatrix) * mvPosition).xyz;
#endif`;

THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;

THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogD = fogDensity;
  #else
    float fogD = 2.0 / max(fogFar, 1.0);
  #endif
  vec3 fogRay = vFogWorld - cameraPosition;
  float fogDist = length(fogRay);
  vec3 fogDir = fogRay / max(fogDist, 1e-4);
  // Exponential height fog, integrated along the view ray.
  float fogB = ${FOG_FALLOFF.toFixed(4)};
  float fogK = fogD * exp(-fogB * (cameraPosition.y - (${FOG_BASE.toFixed(1)})));
  float fogDy = fogB * fogRay.y;
  float fogPath = abs(fogDy) > 1e-3 ? (1.0 - exp(-fogDy)) / fogDy : 1.0;
  float fogAmount = 1.0 - exp(-fogK * fogDist * fogPath);
  // A thin even haze on top, so the far distance always fades out.
  fogAmount = max(fogAmount, 1.0 - exp(-fogDist * fogD * 0.45));
  // The glow follows the sun (the scene's one directional light) round the sky and fades with
  // it; materials without lighting use the starting sun.
  #ifdef PF_DIR_LIGHT
    vec3 fogSunDir = normalize((vec4(directionalLights[0].direction, 0.0) * viewMatrix).xyz);
    float fogGlow = clamp(dot(directionalLights[0].color, vec3(0.333)) / 2.8, 0.0, 1.0);
  #else
    vec3 fogSunDir = ${v(SUN_DIRECTION)};
    float fogGlow = 0.6;
  #endif
  float fogSun = max(dot(fogDir, fogSunDir), 0.0);
  vec3 fogCol = mix(fogColor, ${v(SUN_HAZE)} * fogGlow + fogColor * (1.0 - fogGlow), pow(fogSun, 6.0) * 0.75);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, clamp(fogAmount, 0.0, 1.0));
#endif`;
