// Dresses the scanned survivor in the look a player picked: recolours the scan's skin, hair
// and clothes in its shader, and makes the hats, masks and goggles worn on its head.
//
// The scan is one photographed texture, so parts are told apart two ways: by where on the
// body a point is (head, upper body, legs, feet), and by whether its pixel is skin-coloured.
// Recoloured cloth keeps the scan's own light and shade, just in a new colour.

import * as THREE from 'three';
import { type Look, lookColor } from '../../shared/look.ts';

// Body regions of the scan, by height in its own model space (it stands 2 units tall, T-posed).
const FEET_TOP = 0.13;
const WAIST = 1.06;
const CHIN = 1.74;

/** The scan's skin and cloth as they look on screen, which the picked colours replace. */
const SKIN_REF = new THREE.Color(0xb38b6f);
const CLOTH_REF = new THREE.Color(0x5a5a5a);

const regions = new WeakMap<THREE.BufferGeometry, true>();

/** Tags each vertex of the scan with the body region it is in, once per shared geometry. */
function addRegions(geometry: THREE.BufferGeometry) {
  if (regions.has(geometry)) return;
  regions.set(geometry, true);
  const pos = geometry.getAttribute('position');
  const out = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const r = y > CHIN && Math.abs(pos.getX(i)) < 0.2 ? 0 : y > WAIST ? 1 : y > FEET_TOP ? 2 : 3;
    out[i * 4 + r] = 1;
  }
  geometry.setAttribute('region', new THREE.BufferAttribute(out, 4));
}

const linear = (hex: number) => new THREE.Color(hex);

/** Recolours the scanned body's skin, hair, jacket, trousers and boots. */
export function tintScan(scan: THREE.Object3D, look: Look) {
  const skin = lookColor(look, 'skin');
  const parts = [lookColor(look, 'hair'), lookColor(look, 'jacket'), lookColor(look, 'trousers'), lookColor(look, 'boots')];
  if (skin === null && parts.every((p) => p === null)) return;
  const skinScale = skin === null ? new THREE.Vector3(1, 1, 1) : new THREE.Vector3(linear(skin).r / SKIN_REF.r, linear(skin).g / SKIN_REF.g, linear(skin).b / SKIN_REF.b);
  const refLum = CLOTH_REF.r * 0.2126 + CLOTH_REF.g * 0.7152 + CLOTH_REF.b * 0.0722;
  const tints = parts.map((p) => (p === null ? new THREE.Vector3() : new THREE.Vector3(linear(p).r, linear(p).g, linear(p).b).divideScalar(refLum)));
  const on = new THREE.Vector4(...parts.map((p) => (p === null ? 0 : 1)));
  scan.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    addRegions(mesh.geometry);
    const m = (mesh.material as THREE.MeshStandardMaterial).clone();
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uSkin = { value: skinScale };
      shader.uniforms.uTint = { value: tints };
      shader.uniforms.uOn = { value: on };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 region;\nvarying vec4 vRegion;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = region;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uSkin;\nuniform vec3 uTint[4];\nuniform vec4 uOn;\nvarying vec4 vRegion;')
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
            // The pale shirt under the jacket keeps its colour.
            float shirt = smoothstep(0.1, 0.18, lum);
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

const materials = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, roughness = 0.9, metalness = 0): THREE.MeshStandardMaterial {
  const key = `${color}-${roughness}-${metalness}`;
  let m = materials.get(key);
  if (!m) materials.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness, metalness })));
  return m;
}

export interface Gear {
  mesh: THREE.Mesh;
  /** What hides it: a helmet hides headwear, a face guard hides face gear. */
  kind: 'hood' | 'face';
}

// The scanned head's middle and eye height, in the survivor's model space.
const HEAD = new THREE.Vector3(0, 1.675, -0.008);
const EYES_Y = 1.657;

/**
 * Hats, masks and goggles for the scanned head, placed in the survivor's model space.
 * `cloth` makes a fabric material in a colour; `accent` is the player's colour.
 */
export function headGear(look: Look, cloth: (color: number) => THREE.Material, accent: THREE.Material): Gear[] {
  const out: Gear[] = [];
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, kind: Gear['kind'], at: [number, number, number]) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(...at);
    out.push({ mesh, kind });
    return mesh;
  };
  const leather = mat(0x4a3828, 0.75);
  const rubber = mat(0x2a2927, 0.8);
  const metal = mat(0x55524a, 0.45, 0.7);
  const glass = mat(0x1a2326, 0.12, 0.4);
  const olive = mat(0x3e4232, 0.55, 0.35);

  switch (look.head) {
    case 1: {
      // A loose hood over the head and down the back of the neck, open round the face.
      const m = (cloth(0x57554d) as THREE.MeshStandardMaterial).clone();
      m.side = THREE.DoubleSide;
      add(new THREE.SphereGeometry(0.11, 24, 16, Math.PI / 2 + 0.8, Math.PI * 2 - 1.6, 0, Math.PI * 0.8), m, 'hood', [0, HEAD.y + 0.02, HEAD.z + 0.014]).scale.set(1.0, 1.06, 1.08);
      break;
    }
    case 2: {
      // A knitted beanie with a turned-up brim.
      const knit = cloth(0x3a3a3c);
      add(new THREE.SphereGeometry(0.1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), knit, 'hood', [0, HEAD.y + 0.012, HEAD.z - 0.005]).scale.set(1, 0.95, 1.1);
      const brim = add(new THREE.TorusGeometry(0.099, 0.013, 8, 28), knit, 'hood', [0, HEAD.y + 0.016, HEAD.z - 0.005]);
      brim.rotation.x = Math.PI / 2 - 0.12;
      brim.scale.set(1, 1.1, 1);
      break;
    }
    case 3: {
      // A peaked cap.
      const cap = cloth(0x4e533a);
      add(new THREE.SphereGeometry(0.108, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), cap, 'hood', [0, HEAD.y, HEAD.z]).scale.set(1, 0.9, 1.08);
      const peak = add(new THREE.CylinderGeometry(0.08, 0.08, 0.008, 20, 1, false, -Math.PI / 2, Math.PI), cap, 'hood', [0, HEAD.y + 0.005, HEAD.z + 0.065]);
      peak.rotation.x = 0.15;
      break;
    }
    case 4: {
      // A bandana tied round the forehead, in the player's colour.
      add(new THREE.TorusGeometry(0.096, 0.014, 8, 28), accent, 'hood', [0, HEAD.y + 0.02, HEAD.z]).rotation.set(Math.PI / 2 - 0.15, 0, 0);
      break;
    }
    case 5: {
      // A wide-brimmed leather hat.
      add(new THREE.CylinderGeometry(0.085, 0.098, 0.09, 22), leather, 'hood', [0, HEAD.y + 0.068, HEAD.z]).scale.set(1, 1, 1.12);
      add(new THREE.CylinderGeometry(0.19, 0.19, 0.01, 28), leather, 'hood', [0, HEAD.y + 0.03, HEAD.z]).scale.set(1, 1, 1.08);
      add(new THREE.CylinderGeometry(0.099, 0.099, 0.02, 22), mat(0x2a221a, 0.8), 'hood', [0, HEAD.y + 0.045, HEAD.z]).scale.set(1, 1, 1.12);
      break;
    }
  }

  const goggles = look.face === 2 || look.face === 3;
  const respirator = look.face === 1 || look.face === 3;
  if (goggles) {
    const strap = add(new THREE.TorusGeometry(0.094, 0.009, 6, 28), leather, 'face', [0, EYES_Y + 0.004, HEAD.z]);
    strap.rotation.x = Math.PI / 2;
    strap.scale.set(1, 1.12, 1);
    for (const x of [-0.035, 0.035]) {
      add(new THREE.CylinderGeometry(0.026, 0.029, 0.03, 16), metal, 'face', [x, EYES_Y, 0.098]).rotation.x = Math.PI / 2;
      add(new THREE.CircleGeometry(0.022, 16), glass, 'face', [x, EYES_Y, 0.114]);
    }
  }
  if (respirator) {
    add(new THREE.SphereGeometry(0.05, 20, 14), rubber, 'face', [0, 1.6, 0.074]).scale.set(1.15, 0.95, 1.05);
    const filter = add(new THREE.CylinderGeometry(0.02, 0.023, 0.035, 18), olive, 'face', [0, 1.586, 0.122]);
    filter.rotation.x = Math.PI / 2 + 0.35;
    add(new THREE.CircleGeometry(0.018, 18), mat(0x1c1d1a, 0.7, 0.4), 'face', [0, 1.58, 0.139]).rotation.x = 0.35;
    for (const x of [-0.042, 0.042]) add(new THREE.CylinderGeometry(0.021, 0.021, 0.03, 14), olive, 'face', [x, 1.59, 0.1]).rotation.set(Math.PI / 2, x * 10, 0, 'YXZ');
    const band = add(new THREE.TorusGeometry(0.09, 0.006, 6, 28), rubber, 'face', [0, 1.615, HEAD.z]);
    band.rotation.x = Math.PI / 2 - 0.25;
  }
  if (look.face === 4) {
    // A scarf pulled up over the nose and mouth, in the player's colour.
    const m = (accent as THREE.MeshStandardMaterial).clone();
    m.side = THREE.DoubleSide;
    add(new THREE.SphereGeometry(0.104, 24, 12, Math.PI / 2 - 1.9, 3.8, Math.PI * 0.52, Math.PI * 0.47), m, 'face', [0, 1.64, HEAD.z + 0.006]).scale.set(1.02, 1.05, 1.12);
  }
  return out;
}
