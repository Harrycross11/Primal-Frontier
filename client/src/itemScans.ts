// Scanned models of the things you carry: food, medicine, ammo, resources, plans and the rest.
// The same model is held in the hand (props.ts) and drawn as the item's inventory icon
// (itemModels.ts). Each stands upright on y = 0 at its real size; null until its scan has loaded,
// so the code-built stand-ins show until then.

import * as THREE from 'three';
import type { ItemId } from '../../shared/items.ts';
import { model, soleMaterial, variants, type Model } from './models.ts';

/** How an item is drawn from scans: the model, recoloured or not, and how it lies in the icon. */
interface Look {
  /** One scanned model, or several placed as [name, x, z, turn, scale] (a heap of them). */
  parts: [string, number, number, number, number][];
  /** Multiplies the scan's own colours: cooked meat from raw, charcoal and sulfur from stone. */
  tint?: number;
  metal?: number;
  rough?: number;
  /** In the icon: 'side' for long things, 'top' for heaps seen from above, 'front' for cans and bottles. */
  view: 'side' | 'top' | 'front';
  /** Turned over in the icon (radians about x), such as laying a steak down. */
  lie?: number;
}

const one = (name: string, scale = 1): Look['parts'] => [[name, 0, 0, 0, scale]];
/** A loose heap of a scanned set's variants, for stones and the lumps made from them. */
const heap = (name: string, size: number): Look['parts'] =>
  [
    [0, 0, 0],
    [0.55, 0.2, 1.7],
    [-0.45, 0.35, 0.6],
    [0.1, -0.55, 2.6],
  ].map(([x, z, turn], n) => [`${name}#${n}`, x * size, z * size, turn, n ? 0.7 : 1]);

const LOOKS: Partial<Record<ItemId, Look>> = {
  bandage: { parts: one('item-bandage'), view: 'front' },
  syringe: { parts: one('item-syringe'), view: 'side' },
  antiRadPills: { parts: one('item-pills'), view: 'front' },
  cannedBeans: { parts: one('item-cans'), view: 'front' },
  bottledWater: { parts: one('item-water'), view: 'front' },
  rawMeat: { parts: one('item-meat'), view: 'front', lie: 0.9 },
  cookedMeat: { parts: one('item-meat'), view: 'front', lie: 0.9, tint: 0x5c3a28, rough: 0.7 },
  feedSack: { parts: one('item-feedSack', 0.6), view: 'front' },
  corn: { parts: one('food-corn'), view: 'side' },
  pumpkin: { parts: one('crop-pumpkin', 0.8), view: 'front' },
  mushroom: { parts: one('mushroom', 0.9), view: 'front' },
  // A seed sack with what it grows beside it.
  hempSeed: { parts: [['item-sack', 0, 0, 0, 0.5], ['crop-hemp', 0.14, 0.06, 0, 0.09]], view: 'front' },
  cornSeed: { parts: [['item-sack', 0, 0, 0, 0.5], ['food-corn', 0.13, 0.08, 0.6, 0.8]], view: 'front' },
  pumpkinSeed: { parts: [['item-sack', 0, 0, 0, 0.5], ['crop-pumpkin', 0.14, 0.08, 0, 0.45]], view: 'front' },
  gunpowder: { parts: one('item-sack', 0.6), tint: 0x55524c, view: 'front' },
  torch: { parts: one('item-torch'), view: 'side' },
  arrow: { parts: one('item-arrow'), view: 'side' },
  pistolAmmo: { parts: one('item-pistolAmmo'), view: 'top' },
  rifleAmmo: { parts: one('item-rifleAmmo'), view: 'top' },
  shotgunShell: { parts: one('item-shotgunShell'), view: 'top' },
  // Paper-hulled, like home-made shells.
  handmadeShell: { parts: one('item-shotgunShell'), tint: 0xd8b888, rough: 0.9, view: 'top' },
  explosives: { parts: one('item-dynamite'), view: 'side' },
  buildingPlan: { parts: one('item-blueprints'), view: 'top' },
  blueprint: { parts: one('item-blueprints'), view: 'top' },
  supplySignal: { parts: one('item-smoke'), view: 'front' },
  hqm: {
    parts: [
      ['item-ingot', 0, -0.05, 0, 1],
      ['item-ingot', 0.01, 0.05, 0.1, 1],
    ],
    tint: 0xd0e0f0,
    metal: 1,
    rough: 0.3,
    view: 'top',
  },
  cloth: { parts: one('item-cloth'), view: 'front' },
  wood: { parts: one('item-wood'), view: 'front' },
  lowGradeFuel: { parts: one('item-fuel'), view: 'front' },
  stone: { parts: heap('stones', 0.12), view: 'top' },
  charcoal: { parts: heap('stones', 0.1), tint: 0x2a2826, rough: 1, view: 'top' },
  sulfur: { parts: heap('stones', 0.1), tint: 0xf0d040, view: 'top' },
  // Metal fragments: shards of scrap sheet cut small.
  metal: {
    parts: [
      ['part-sheet', 0, 0, 0, 0.35],
      ['part-sheet', 0.08, 0.06, 2, 0.3],
      ['part-sheet', -0.07, 0.05, 4, 0.28],
    ],
    tint: 0xb0b4b8,
    metal: 0.9,
    rough: 0.45,
    view: 'top',
  },
  // A rusty sheet, a gear and a length of pipe.
  scrap: {
    parts: [
      ['part-sheet', 0, 0, 0, 0.6],
      ['part-gears', 0.1, 0.08, 0.5, 0.7],
      ['part-pipe', -0.04, 0.12, 1.2, 0.5],
    ],
    view: 'top',
  },
};

const tinted = new Map<string, THREE.Material>();
/** The scan's material, recoloured for this look (shared by every copy). */
function materialFor(m: Model, look: Look): THREE.Material | THREE.Material[] {
  if (look.tint === undefined && look.metal === undefined && look.rough === undefined) return m.material;
  const src = soleMaterial(m);
  const key = `${src.uuid}|${look.tint}|${look.metal}|${look.rough}`;
  let out = tinted.get(key) as THREE.MeshStandardMaterial | undefined;
  if (!out) {
    out = src.clone();
    if (look.tint !== undefined) out.color.multiply(new THREE.Color(look.tint));
    if (look.metal !== undefined) out.metalness = look.metal;
    if (look.rough !== undefined) out.roughness = look.rough;
    tinted.set(key, out);
  }
  return out;
}

/** Whether an item has a scanned look (loaded or not). */
export const hasScannedLook = (item: ItemId) => item in LOOKS;

/**
 * The item built from its scans, standing on y = 0 with the parts' sizes from models.ts, and how
 * to show it as an icon; null if it has none or they haven't all loaded.
 */
export function scannedItem(item: ItemId): { model: THREE.Group; view: Look['view']; lie: number } | null {
  const look = LOOKS[item];
  if (!look) return null;
  const g = new THREE.Group();
  for (const [ref, x, z, turn, scale] of look.parts) {
    const [name, n] = ref.split('#');
    const m = n === undefined ? model(name) : variants(name)[Number(n) % Math.max(1, variants(name).length)];
    if (!m) return null;
    const mesh = new THREE.Mesh(m.geometry, materialFor(m, look));
    mesh.position.set(x, 0, z);
    mesh.rotation.y = turn;
    mesh.scale.setScalar(scale);
    mesh.castShadow = true;
    mesh.userData.shared = true;
    g.add(mesh);
  }
  return { model: g, view: look.view, lie: look.lie ?? 0 };
}
