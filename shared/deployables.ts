// Things players craft and set down in the world: workbenches, a furnace and storage boxes,
// plus the loot bag a survivor leaves behind when they die. Furnaces, boxes and bags hold
// items. Shared so client and server agree on size and slot rules.

import type { Box } from './building.ts';
import { INVENTORY_SIZE, emptySlots, type ItemId, type Slots } from './items.ts';

export type DeployableKind = 'workbench' | 'workbench2' | 'workbench3' | 'furnace' | 'storageBox' | 'lootBag';
/** The kinds that come from an item of the same name and can be placed. */
export const DEPLOYABLE_KINDS: DeployableKind[] = ['workbench', 'workbench2', 'workbench3', 'furnace', 'storageBox'];

export interface Deployable {
  id: number;
  kind: DeployableKind;
  x: number;
  y: number;
  z: number;
  /** Facing, in radians around the vertical axis. */
  rot: number;
  hp: number;
  /** Player id of whoever placed it, or 0 for loot bags. */
  owner: number;
  /** Item slots, for furnaces, boxes and loot bags. */
  slots: Slots;
  /** Furnaces: burning or not. */
  on: boolean;
  /** Loot bags: whose they were. */
  label?: string;
}

export const DEPLOYABLE_INFO: Record<DeployableKind, { name: string; size: [number, number, number]; hp: number; slots: number }> = {
  workbench: { name: 'Workbench Level 1', size: [1.7, 0.95, 0.85], hp: 300, slots: 0 },
  workbench2: { name: 'Workbench Level 2', size: [1.8, 1.0, 0.9], hp: 500, slots: 0 },
  workbench3: { name: 'Workbench Level 3', size: [2.0, 1.05, 1.0], hp: 800, slots: 0 },
  furnace: { name: 'Furnace', size: [1.0, 1.7, 1.0], hp: 400, slots: 6 },
  storageBox: { name: 'Storage Box', size: [1.0, 0.62, 0.62], hp: 150, slots: 12 },
  lootBag: { name: 'Loot Bag', size: [0.7, 0.45, 0.7], hp: 40, slots: INVENTORY_SIZE },
};

export const WORKBENCH_LEVEL: Partial<Record<DeployableKind, 1 | 2 | 3>> = { workbench: 1, workbench2: 2, workbench3: 3 };

/** Furnace slots: wood in slot 0, ore in slots 1-2, and smelted results come out in 3-5. */
export const FURNACE_FUEL = 0;
export const FURNACE_ORE_SLOTS = [1, 2];
export const FURNACE_OUTPUT_SLOTS = [3, 4, 5];
/** Seconds one wood burns for (leaving one charcoal). */
export const FURNACE_WOOD_SECONDS = 2;
/** What each ore smelts (or raw meat cooks) into, and the seconds one takes. */
export const SMELTS: Partial<Record<ItemId, { into: ItemId; seconds: number }>> = {
  metalOre: { into: 'metal', seconds: 1 },
  sulfurOre: { into: 'sulfur', seconds: 0.75 },
  hqmOre: { into: 'hqm', seconds: 2 },
  rawMeat: { into: 'cookedMeat', seconds: 5 },
};
/** Loot bags vanish after this long. */
export const LOOT_BAG_SECONDS = 300;

export function newDeployable(id: number, kind: DeployableKind, x: number, y: number, z: number, rot: number, owner: number): Deployable {
  const info = DEPLOYABLE_INFO[kind];
  return { id, kind, x, y, z, rot, hp: info.hp, owner, slots: emptySlots(info.slots), on: false };
}

/** The space a deployable takes up, as an axis-aligned box (rotations are rounded to the wider fit). */
export function deployableBox(d: Pick<Deployable, 'kind' | 'x' | 'y' | 'z' | 'rot'>): Box {
  const [w, h, l] = DEPLOYABLE_INFO[d.kind].size;
  const c = Math.abs(Math.cos(d.rot));
  const s = Math.abs(Math.sin(d.rot));
  const hx = (w * c + l * s) / 2;
  const hz = (w * s + l * c) / 2;
  return { min: [d.x - hx, d.y, d.z - hz], max: [d.x + hx, d.y + h, d.z + hz] };
}

/** Whether an item may go into a container slot. Furnace outputs and loot bags only give. */
export function slotAccepts(d: Deployable, slot: number, item: ItemId): boolean {
  if (d.kind === 'lootBag') return false;
  if (d.kind !== 'furnace') return true;
  if (slot === FURNACE_FUEL) return item === 'wood';
  if (FURNACE_ORE_SLOTS.includes(slot)) return SMELTS[item] !== undefined;
  return false;
}
