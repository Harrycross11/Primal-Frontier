// Inventory icons rendered from each item's 3D model with studio lighting, so the hotbar
// and inventory show the actual log, cartridge or rifle rather than a flat drawing.
// Rendered once per item into a small offscreen canvas and cached as an image URL. They are
// drawn in the background, one a frame: drawing a screenful at once (the crafting list is every
// gun and tool) froze the game for the moment a menu opened. Until its picture is ready an item
// shows its drawn icon.

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

/** Drops the rendered icons, so the next ask draws them again (once the scanned models have come). */
export function forgetIcons() {
  urls.clear();
  forgotten++;
}

/** Counts forgetIcons calls, so an icon still being drawn from the stand-in models isn't kept. */
let forgotten = 0;
const waiting = new Set<ItemId>();
let drawing = false;
/** Called as icons are drawn (every half second or so, and at the end), to show them. */
let onDrawn: (() => void) | null = null;

/** Draws these items' icons in the background, one a frame; `drawn` runs when they are done. */
export function drawIconsSoon(items: Iterable<ItemId>, drawn?: () => void) {
  if (drawn) onDrawn = drawn;
  for (const item of items) if (!urls.has(item)) waiting.add(item);
  if (drawing || !waiting.size) return;
  drawing = true;
  void drawWaiting();
}

const nextFrame = () => new Promise<void>((done) => requestAnimationFrame(() => done()));

async function drawWaiting() {
  await nextFrame();
  let shown = performance.now();
  // Items asked for while these are drawn join the end of the line.
  for (const item of waiting) {
    waiting.delete(item);
    try {
      await drawIcon(item);
    } catch (e) {
      console.warn('icon failed', item, e);
      urls.set(item, null);
    }
    // Show what is done every so often, rather than only once the whole crafting list is.
    if (performance.now() - shown > 500) {
      shown = performance.now();
      onDrawn?.();
    }
    await nextFrame();
  }
  drawing = false;
  onDrawn?.();
}

/**
 * Draws one icon without holding up the game: its photos are shrunk to icon size off the main
 * thread (sending full-size ones to the icon renderer was most of the stall), its shaders are
 * built in the background, and the picture is saved as a file off the main thread.
 */
async function drawIcon(item: ItemId) {
  if (urls.has(item)) return;
  const s = setup();
  const built = s ? buildItemModel(item) : null;
  if (!s || !built) {
    urls.set(item, null);
    return;
  }
  clearTimeout(closeTimer);
  const generation = forgotten;
  const { model, view } = built;
  const made = await lighten(model);
  // The renderer may have been shut down while the photos were shrunk.
  if (studio !== s) {
    model.traverse((o) => !o.userData.shared && (o as THREE.Mesh).geometry?.dispose());
    for (const m of made) m.dispose();
    return drawIcon(item);
  }
  aim(s, model, view);
  await s.renderer.compileAsync(s.scene, s.camera).catch(() => {});
  s.renderer.render(s.scene, s.camera);
  const blob = await new Promise<Blob | null>((done) => s.renderer.domElement.toBlob(done, 'image/png'));
  s.scene.remove(model);
  model.traverse((o) => !o.userData.shared && (o as THREE.Mesh).geometry?.dispose());
  for (const m of made) m.dispose();
  if (generation === forgotten) urls.set(item, blob ? URL.createObjectURL(blob) : null);
  else waiting.add(item);
  closeSoon();
}

/** Material slots that hold photos. */
const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'] as const;
/** Pixels across an icon's photos: plenty for a picture 128 across. */
const PHOTO = 256;
const small = new Map<THREE.Texture, Promise<THREE.Texture>>();

/** An icon-sized copy of a photo texture (the texture itself if it is small already or not a photo). */
function smallTexture(t: THREE.Texture): Promise<THREE.Texture> {
  let made = small.get(t);
  if (made) return made;
  const picture = t.source.data as ImageBitmap | HTMLImageElement | null;
  const photo = (typeof ImageBitmap !== 'undefined' && picture instanceof ImageBitmap) || (typeof HTMLImageElement !== 'undefined' && picture instanceof HTMLImageElement);
  const largest = photo ? Math.max(picture.width, picture.height) : 0;
  if (!photo || largest <= PHOTO || (t as THREE.CanvasTexture).isCanvasTexture) made = Promise.resolve(t);
  else {
    const k = PHOTO / largest;
    made = createImageBitmap(picture, {
      resizeWidth: Math.max(1, Math.round(picture.width * k)),
      resizeHeight: Math.max(1, Math.round(picture.height * k)),
      resizeQuality: 'medium',
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'none',
      // A plain image is turned the right way up as it is sent; a bitmap has to be made that way.
      imageOrientation: picture instanceof HTMLImageElement && t.flipY ? 'flipY' : 'from-image',
    }).then(
      (bitmap) => {
        const copy = t.clone();
        copy.source = new THREE.TextureSource(bitmap);
        copy.needsUpdate = true;
        return copy;
      },
      () => t,
    );
  }
  small.set(t, made);
  return made;
}

/** Dresses the model in copies of its materials wearing icon-sized photos; returns the copies. */
async function lighten(model: THREE.Object3D): Promise<THREE.Material[]> {
  const meshes: THREE.Mesh[] = [];
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
  });
  const copies = new Map<THREE.Material, Promise<THREE.Material>>();
  const copy = (m: THREE.Material) => {
    let c = copies.get(m);
    if (c) return c;
    const slots = m as unknown as Record<string, THREE.Texture | null | undefined>;
    const used = SLOTS.filter((slot) => slots[slot]?.isTexture);
    c = Promise.all(used.map((slot) => smallTexture(slots[slot]!))).then((textures) => {
      const out = m.clone();
      // Cloning drops a material's shader changes (tints, cut-outs); keep them.
      out.onBeforeCompile = m.onBeforeCompile;
      out.customProgramCacheKey = m.customProgramCacheKey;
      used.forEach((slot, n) => ((out as unknown as Record<string, THREE.Texture>)[slot] = textures[n]));
      return out;
    });
    copies.set(m, c);
    return c;
  };
  for (const mesh of meshes) {
    const m = mesh.material;
    if (Array.isArray(m)) mesh.material = await Promise.all(m.map(copy));
    else if (m) mesh.material = await copy(m);
  }
  return Promise.all(copies.values());
}

/** Frames the model in the studio camera. */
function aim(s: NonNullable<typeof studio>, model: THREE.Object3D, view: 'side' | 'top' | 'front') {
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
}

/** The item's picture if it has been drawn; if not, it is put in line and null is returned for now. */
export function itemIconUrl(item: ItemId): string | null {
  if (urls.has(item)) return urls.get(item)!;
  drawIconsSoon([item]);
  return null;
}

/** An image URL of the item's model, drawn now if need be, or null where WebGL or a model isn't available. */
export function renderIcon(item: ItemId): string | null {
  if (urls.has(item)) return urls.get(item)!;
  const s = setup();
  const built = s ? buildItemModel(item) : null;
  if (!s || !built) {
    urls.set(item, null);
    return null;
  }
  const { model, view } = built;
  aim(s, model, view);
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
