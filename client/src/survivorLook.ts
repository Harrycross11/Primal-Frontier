// Dresses a scanned person in the look a player picked: which person they are, recolours their
// skin, hair and clothes in the shader, and puts on the scanned hats, masks, glasses and packs.
//
// Each scan is one photographed texture, so parts are told apart two ways: by the bone that
// moves a point most (head, upper body and arms, legs, feet), and by whether its pixel is
// skin-coloured. Recoloured cloth keeps the scan's own light and shade, just in a new colour.

import * as THREE from 'three';
import { type Look, lookColor } from '../../shared/look.ts';
import { model } from './models.ts';

/**
 * The scanned people a survivor can be, by the look's `body` option. The first is loaded with the
 * game; the others when someone first wears them. `pale` keeps a light shirt under a jacket its
 * own colour when the jacket is recoloured.
 */
export const BODIES: { model: string; pale?: boolean }[] = [
  { model: 'survivor', pale: true },
  { model: 'body-viktor' },
  { model: 'body-tony' },
  { model: 'body-carla' },
  { model: 'body-sophia' },
  { model: 'body-nathan' },
  { model: 'body-hank' },
  { model: 'body-rico' },
  { model: 'body-claudia' },
];

/** The rigged model a look's survivor is drawn with. */
export const bodyModel = (look: Look) => (BODIES[look.body] ?? BODIES[0]).model;

/** The scan's skin and cloth as they look on screen, which the picked colours replace. */
const SKIN_REF = new THREE.Color(0xb38b6f);
const CLOTH_REF = new THREE.Color(0x5a5a5a);

const regions = new WeakMap<THREE.BufferGeometry, true>();

/** Which region a bone's points are in: 0 head, 1 upper body and arms, 2 legs, 3 feet. */
function boneRegion(name: string): number {
  if (/Head/.test(name)) return 0;
  if (/Foot|Toe/.test(name)) return 3;
  if (/Hips|UpLeg|Leg/.test(name)) return 2;
  return 1;
}

/** Tags each vertex of the scan with the body region it is in, once per shared geometry. */
function addRegions(mesh: THREE.SkinnedMesh) {
  const geometry = mesh.geometry;
  if (regions.has(geometry)) return;
  regions.set(geometry, true);
  const of = mesh.skeleton.bones.map((b) => boneRegion(b.name));
  const index = geometry.getAttribute('skinIndex');
  const weight = geometry.getAttribute('skinWeight');
  const out = new Float32Array(index.count * 4);
  for (let i = 0; i < index.count; i++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (weight.getComponent(i, k) > weight.getComponent(i, best)) best = k;
    out[i * 4 + of[index.getComponent(i, best)]] = 1;
  }
  geometry.setAttribute('region', new THREE.BufferAttribute(out, 4));
}

const linear = (hex: number) => new THREE.Color(hex);

/** Recolours the scanned body's skin, hair, jacket, trousers and boots. */
export function tintScan(scan: THREE.Object3D, look: Look, pale = false) {
  const skin = lookColor(look, 'skin');
  const parts = [lookColor(look, 'hair'), lookColor(look, 'jacket'), lookColor(look, 'trousers'), lookColor(look, 'boots')];
  if (skin === null && parts.every((p) => p === null)) return;
  const skinScale = skin === null ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(linear(skin).r / SKIN_REF.r, linear(skin).g / SKIN_REF.g, linear(skin).b / SKIN_REF.b);
  const refLum = CLOTH_REF.r * 0.2126 + CLOTH_REF.g * 0.7152 + CLOTH_REF.b * 0.0722;
  const tints = parts.map((p) => (p === null ? new THREE.Vector3() : new THREE.Vector3(linear(p).r, linear(p).g, linear(p).b).divideScalar(refLum)));
  const on = new THREE.Vector4(...parts.map((p) => (p === null ? 0 : 1)));
  scan.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    addRegions(mesh);
    const m = (mesh.material as THREE.MeshStandardMaterial).clone();
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uSkin = { value: skinScale };
      shader.uniforms.uTint = { value: tints };
      shader.uniforms.uOn = { value: on };
      shader.uniforms.uPale = { value: pale ? 1 : 0 };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 region;\nvarying vec4 vRegion;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = region;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSkin;\nuniform vec3 uTint[4];\nuniform vec4 uOn;\nuniform float uPale;\nvarying vec4 vRegion;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            vec3 c = diffuseColor.rgb;
            // Skin is warm: much more red than blue, and not too dark.
            // On the head, dirty or shadowed skin is told from hair more loosely.
            float warm = (c.r - c.b) / (c.r + 0.004);
            float skin = mix(smoothstep(0.5, 0.68, warm) * smoothstep(0.04, 0.1, c.r), smoothstep(0.3, 0.5, warm) * smoothstep(0.02, 0.05, c.r), vRegion.x);
            float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
            // A pale shirt under a jacket keeps its colour.
            float shirt = uPale * smoothstep(0.1, 0.18, lum);
            vec3 cloth = c;
            for (int i = 0; i < 4; i++) cloth = mix(cloth, uTint[i] * lum, vRegion[i] * uOn[i] * (i == 1 ? 1.0 - shirt : 1.0));
            diffuseColor.rgb = mix(cloth, c * uSkin, skin);
          }`,
        );
    };
    m.customProgramCacheKey = () => 'tinted-scan';
    mesh.material = m;
  });
}

export interface Gear {
  mesh: THREE.Mesh;
  /** What hides it: a helmet hides headwear, a face guard hides face gear. */
  kind: 'hood' | 'face';
}

// The scanned survivor's head middle and eye height, in its model space. Gear is placed for this
// head; avatar.ts moves and sizes it to fit each other person's.
export const HEAD = new THREE.Vector3(0, 1.675, -0.008);
export const EYES_Y = 1.657;

/**
 * A scanned hat, mask or helmet (models.ts sizes it, standing on y = 0) put on the scanned head,
 * its bottom at `at`; null if its scan hasn't loaded.
 */
export function scannedWear(name: string, at: [number, number, number], tilt = 0): THREE.Mesh | null {
  const m = model(name);
  if (!m) return null;
  const mesh = new THREE.Mesh(m.geometry, m.material);
  mesh.position.set(...at);
  mesh.rotation.x = tilt;
  mesh.castShadow = true;
  // Shared with every survivor wearing one.
  mesh.userData.shared = true;
  return mesh;
}

/** Each headwear option's scan, where its bottom sits on the head, and how far it tips back. */
const HATS: ([string, [number, number, number], number] | null)[] = [
  null,
  ['wear-scarfhood', [0, HEAD.y - 0.2, HEAD.z - 0.03], 0],
  ['wear-beanie', [0, HEAD.y + 0.01, HEAD.z - 0.012], -0.1],
  ['wear-cap', [0, HEAD.y + 0.015, HEAD.z + 0.045], -0.08],
  ['wear-huntercap', [0, HEAD.y + 0.015, HEAD.z + 0.04], -0.08],
  ['wear-hat', [0, HEAD.y + 0.035, HEAD.z], -0.06],
  ['wear-outback', [0, HEAD.y + 0.012, HEAD.z], -0.06],
  ['wear-straw', [0, HEAD.y + 0.015, HEAD.z], -0.06],
  ['wear-bucket', [0, HEAD.y + 0.02, HEAD.z], -0.06],
  ['wear-flatcap', [0, HEAD.y - 0.035, HEAD.z + 0.01], -0.08],
  ['wear-trapper', [0, HEAD.y - 0.02, HEAD.z], -0.04],
  ['wear-hardhat', [0, HEAD.y + 0.02, HEAD.z], -0.06],
  ['wear-rustyhat', [0, HEAD.y + 0.02, HEAD.z], -0.06],
  ['wear-m1', [0, HEAD.y + 0.0, HEAD.z], -0.04],
  ['wear-tactical', [0, HEAD.y - 0.01, HEAD.z], -0.04],
];

/**
 * Hats, masks, goggles and glasses for the scanned head, placed in the survivor's model space.
 * All of them are scans: any not loaded yet is left off until it arrives (avatar.ts dresses again).
 */
export function headGear(look: Look): Gear[] {
  const out: Gear[] = [];
  const wear = (name: string, kind: Gear['kind'], at: [number, number, number], tilt = 0) => {
    const mesh = scannedWear(name, at, tilt);
    if (mesh) out.push({ mesh, kind });
    return !!mesh;
  };
  const hat = HATS[look.head];
  if (hat) wear(hat[0], 'hood', hat[1], hat[2]);

  const goggles = look.face === 2 || look.face === 3 || look.face === 5;
  const respirator = look.face === 1 || look.face === 3;
  const balaclava = look.face === 4 || look.face === 5;
  // A rubber gas mask over the whole head; goggles with it are pushed up on the forehead.
  if (respirator) {
    wear('wear-gasmask', 'face', [0, 1.53, HEAD.z + 0.012]);
    if (goggles) wear('wear-goggles', 'face', [0, HEAD.y + 0.045, HEAD.z + 0.01], -0.5);
    return out;
  }
  if (balaclava) wear('wear-balaclava', 'face', [0, 1.5, HEAD.z + 0.005]);
  if (goggles) wear('wear-goggles', 'face', [0, EYES_Y - 0.045, HEAD.z + (balaclava ? 0.014 : 0.008)]);
  if (look.face === 6) wear('wear-sunglasses', 'face', [0, EYES_Y - 0.02, HEAD.z + 0.042]);
  if (look.face === 7) wear('wear-glasses', 'face', [0, EYES_Y - 0.02, HEAD.z + 0.042]);
  return out;
}

/** The pack on their back: which scan, and the colour it is tinted towards (null: as scanned); null for none. */
export function packOf(look: Look): { model: string; color: number | null } | null {
  if (look.pack === 6) return { model: 'gear-daypack', color: null };
  if (look.pack === 7) return { model: 'gear-kanken', color: null };
  const color = lookColor(look, 'pack');
  return color === null ? null : { model: 'gear-backpack', color };
}
