// The ground's photo-scanned surfaces, one layer each in a texture array, so the terrain can
// blend all of them in one draw without running out of texture slots: the Ashlands' cracked
// earth, the forest floor, the mesa's red earth, the flats' lake bed, snow, bare cliff rock and
// the dusty dirt that drifts across everything.

import * as THREE from 'three';

export const LAYERS = ['ground', 'forest-floor', 'red-earth', 'lake-bed', 'snow', 'cliff', 'dirt'] as const;
/** Pixels across each layer; the larger photos are scaled down to it. */
const SIZE = 1024;

export interface TerrainLayers {
  diffuse: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
}

let layers: TerrainLayers | null = null;

/** The two arrays, flat grey until the photos arrive, then filled in. */
export function terrainLayers(): TerrainLayers {
  if (layers) return layers;
  const make = (fill: [number, number, number], srgb: boolean) => {
    const data = new Uint8Array(SIZE * SIZE * 4 * LAYERS.length);
    for (let i = 0; i < data.length; i += 4) data.set([...fill, 255], i);
    const tex = new THREE.DataArrayTexture(data, SIZE, SIZE, LAYERS.length);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  };
  layers = { diffuse: make([120, 112, 100], true), normal: make([128, 128, 255], false) };
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const load = (tex: THREE.DataArrayTexture, layer: number, url: string) =>
    new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        // Drawn upside down, as the photos would be flipped on loading like any other texture.
        ctx.setTransform(1, 0, 0, -1, 0, SIZE);
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        const px = ctx.getImageData(0, 0, SIZE, SIZE).data;
        (tex.image.data as Uint8Array).set(px, layer * SIZE * SIZE * 4);
        tex.addLayerUpdate(layer);
        tex.needsUpdate = true;
        resolve();
      };
      img.onerror = () => resolve();
      img.src = url;
    });
  LAYERS.forEach((name, layer) => {
    load(layers!.diffuse, layer, `/textures/${name}_diff.webp`);
    load(layers!.normal, layer, `/textures/${name}_nor.webp`);
  });
  return layers;
}
