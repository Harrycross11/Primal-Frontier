// Photos on the graphics card. Every texture is sent to the card a few at a time between frames,
// as soon as it exists, rather than on the frame something wearing it first comes into view:
// that upload (and its mipmaps) is what stalled the game when you turned to face something new.
// On Low the photos are also kept to LOW_MAX pixels across, which needs a quarter of the memory
// of 1024 ones; a laptop's graphics share its memory, and running short of it makes every turn
// of the view slow as textures are swapped in and out.

import * as THREE from 'three';

const LOW_MAX = 512;
/** Texture slots of the standard materials that hold photos. */
const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap'] as const;

type Photo = ImageBitmap | HTMLImageElement;
type Picture = THREE.Texture['source'];
const isPhoto = (d: unknown): d is Photo =>
  (typeof ImageBitmap !== 'undefined' && d instanceof ImageBitmap) || (typeof HTMLImageElement !== 'undefined' && d instanceof HTMLImageElement);

let cap = Infinity;
let renderer: THREE.WebGLRenderer | null = null;
/** Each photo's full-size picture, kept to put back when the quality goes up again. */
const full = new Map<Picture, Photo>();
const smaller = new Map<Picture, { size: number; image: Promise<ImageBitmap | null> }>();
/** The textures showing each photo (copies of a texture share it). */
const users = new Map<Picture, Set<THREE.Texture>>();
const queue = new Set<THREE.Texture>();
let sending = false;

/** Every photo texture worn by meshes under these roots. */
export function texturesIn(roots: Iterable<THREE.Object3D>): Set<THREE.Texture> {
  const out = new Set<THREE.Texture>();
  for (const root of roots) {
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        for (const slot of SLOTS) {
          const t = (mat as unknown as Record<string, THREE.Texture | null | undefined>)[slot];
          if (t?.isTexture && !(t as THREE.CanvasTexture).isCanvasTexture) out.add(t);
        }
      }
    });
  }
  return out;
}

/** Takes these textures on: shrinks them if Low needs it, then sends them to the card a few a frame. */
export function prepareTextures(r: THREE.WebGLRenderer, textures: Iterable<THREE.Texture>) {
  renderer = r;
  for (const t of textures) {
    const source = t.source;
    let list = users.get(source);
    if (!list) {
      if (!isPhoto(source.data)) continue;
      users.set(source, (list = new Set()));
      full.set(source, source.data);
    }
    if (list.has(t)) continue;
    list.add(t);
    fit(source);
  }
}

/** Keeps photos to LOW_MAX pixels across on Low, and puts them back to full size otherwise. */
export function setLowTextures(low: boolean) {
  const next = low ? LOW_MAX : Infinity;
  if (next === cap) return;
  cap = next;
  for (const source of users.keys()) fit(source);
}

function fit(source: Picture) {
  const picture = full.get(source)!;
  const largest = Math.max(picture.width, picture.height);
  if (largest <= cap) {
    show(source, picture);
    return;
  }
  let small = smaller.get(source);
  if (!small || small.size !== cap) {
    const k = cap / largest;
    const texture = users.get(source)!.values().next().value!;
    // A plain image is turned the right way up as it goes to the card; a bitmap has to be made
    // that way round already.
    const flip = picture instanceof HTMLImageElement && texture.flipY;
    small = {
      size: cap,
      image: createImageBitmap(picture, {
        resizeWidth: Math.max(1, Math.round(picture.width * k)),
        resizeHeight: Math.max(1, Math.round(picture.height * k)),
        resizeQuality: 'medium',
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
        imageOrientation: flip ? 'flipY' : 'from-image',
      }).catch(() => null),
    };
    smaller.set(source, small);
  }
  const wanted = cap;
  small.image.then((image) => {
    // Too late if the quality changed again while it was being made.
    if (cap !== wanted) return;
    show(source, image ?? picture);
  });
}

/** Puts this picture in the photo's textures and queues them for the card. */
function show(source: Picture, picture: Photo | ImageBitmap) {
  const list = users.get(source)!;
  if (source.data !== picture) {
    const old = source.data as Photo;
    const resized = old.width !== picture.width || old.height !== picture.height;
    source.data = picture;
    for (const t of list) {
      // A photo already on the card has room for its old size only: a new size sent into it
      // fills just one corner and leaves the rest of the old picture around it (blotches on a
      // scanned person, whose photo is hundreds of small patches). Start it afresh.
      if (resized) t.dispose();
      t.needsUpdate = true;
    }
  }
  for (const t of list) queue.add(t);
  if (sending) return;
  sending = true;
  requestAnimationFrame(sendSome);
}

/** Sends textures for a few milliseconds a frame until the queue is empty. */
function sendSome() {
  const until = performance.now() + 4;
  for (const t of queue) {
    if (performance.now() > until) break;
    queue.delete(t);
    renderer?.initTexture(t);
  }
  if (queue.size) requestAnimationFrame(sendSome);
  else sending = false;
}
