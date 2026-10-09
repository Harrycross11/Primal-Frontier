// Inventory icons rendered from each item's 3D model with studio lighting, so the hotbar
// and inventory show the actual log, cartridge or rifle rather than a flat drawing.
// Rendered once per item into a small offscreen canvas and cached as an image URL.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ItemId } from '../../shared/items.ts';
import { buildItemModel } from './itemModels.ts';

const SIZE = 128;

let studio: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null | undefined;
const urls = new Map<ItemId, string | null>();

function setup() {
  if (studio !== undefined) return studio;
  try {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(SIZE, SIZE);
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    pmrem.dispose();
    // A warm key from the upper left, a cool rim from behind, like product shots.
    const key = new THREE.DirectionalLight(0xfff0dc, 2.6);
    key.position.set(-2, 3, 2.5);
    const rim = new THREE.DirectionalLight(0xbfd4ff, 1.6);
    rim.position.set(2, 1.5, -3);
    scene.add(key, rim, new THREE.HemisphereLight(0xfff4e6, 0x3a3430, 0.5));
    const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
    studio = { renderer, scene, camera };
  } catch {
    studio = null;
  }
  return studio;
}

/** An image URL of the item's model, or null where WebGL or a model isn't available. */
export function itemIconUrl(item: ItemId): string | null {
  if (urls.has(item)) return urls.get(item)!;
  const s = setup();
  const built = s ? buildItemModel(item) : null;
  if (!s || !built) {
    urls.set(item, null);
    return null;
  }
  const { model, view } = built;
  s.scene.add(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const centre = box.getCenter(new THREE.Vector3());
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  // Side views look at the left side of the model (+z to the right), a little from above
  // and in front; top views look down at a three-quarter angle;
  // front views look at the front (+z) from slightly above.
  const dir = view === 'side' ? new THREE.Vector3(-1, 0.32, 0.28) : view === 'front' ? new THREE.Vector3(0, 0.35, 1) : new THREE.Vector3(-0.75, 0.85, 1);
  dir.normalize();
  const fit = view === 'side' ? 0.66 : view === 'front' ? 0.72 : 0.8;
  const dist = (sphere.radius * fit) / Math.sin(THREE.MathUtils.degToRad(s.camera.fov / 2));
  s.camera.position.copy(centre).addScaledVector(dir, dist);
  s.camera.lookAt(centre);
  s.renderer.render(s.scene, s.camera);
  const url = s.renderer.domElement.toDataURL('image/png');
  s.scene.remove(model);
  model.traverse((o) => !o.userData.shared && (o as THREE.Mesh).geometry?.dispose());
  urls.set(item, url);
  closeSoon();
  return url;
}

/**
 * The icon renderer keeps its own copy of every texture it has drawn, and the crafting menu
 * draws every gun and tool, so once a batch of icons is done it is shut down to give that
 * memory back. The finished icons are kept; it starts again if a new one is needed.
 */
let closeTimer = 0;
function closeSoon() {
  clearTimeout(closeTimer);
  closeTimer = window.setTimeout(() => {
    if (!studio) return;
    studio.scene.environment?.dispose();
    studio.renderer.dispose();
    studio.renderer.forceContextLoss();
    studio = undefined;
  }, 2000);
}
