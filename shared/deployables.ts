// Things players craft and set down in the world: workbenches, a furnace and storage boxes,
// plus the loot bag a survivor leaves behind when they die. Furnaces, boxes and bags hold
// items. Shared so client and server agree on size and slot rules.

import type { Box } from './building.ts';
import { CROPS, PLANTER_SEED_SLOTS } from './farming.ts';
import { INVENTORY_SIZE, emptySlots, type ItemId, type Slots } from './items.ts';

export type DeployableKind =
  | 'workbench'
  | 'workbench2'
  | 'workbench3'
  | 'furnace'
  | 'storageBox'
  | 'toolCupboard'
  | 'sleepingBag'
  | 'planter'
  | 'lootBag'
  // Loot crates at the landmarks, and the crate the supply plane drops.
  | 'crate'
  | 'militaryCrate'
  | 'supplyDrop'
  // A thrown supply signal, smoking.
  | 'supplySignal'
  // Explosives once they are lit: thrown, or stuck to a wall or door.
  | 'beancan'
  | 'satchel'
  | 'c4';
/** The kinds that come from an item of the same name and can be placed. */
export const DEPLOYABLE_KINDS: DeployableKind[] = ['workbench', 'workbench2', 'workbench3', 'furnace', 'storageBox', 'toolCupboard', 'sleepingBag', 'planter'];
/** Lit explosives waiting to go off. */
export const CHARGE_KINDS: DeployableKind[] = ['beancan', 'satchel', 'c4'];
/** Crates full of loot that nobody owns: you can only take from them, and they can't be broken. */
export const CRATE_KINDS: DeployableKind[] = ['crate', 'militaryCrate', 'supplyDrop'];

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
  /** Planters: seconds each plot's plant has grown (see shared/farming.ts). */
  grow?: number[];
  /** Furnaces: burning or not. */
  on: boolean;
  /** Loot bags: whose they were. */
  label?: string;
  /** Tool cupboards: the players allowed to build near it. */
  auth?: number[];
  /** Landmark crates: which crate spot it fills (see crateSpots). */
  spot?: string;
  /** Supply drops: the height it was dropped from and when (server ms) it left the plane and lands. */
  fall?: { from: number; start: number; land: number };
}

export const DEPLOYABLE_INFO: Record<DeployableKind, { name: string; size: [number, number, number]; hp: number; slots: number }> = {
  workbench: { name: 'Workbench Level 1', size: [1.7, 0.95, 0.85], hp: 300, slots: 0 },
  workbench2: { name: 'Workbench Level 2', size: [1.8, 1.0, 0.9], hp: 500, slots: 0 },
  workbench3: { name: 'Workbench Level 3', size: [2.0, 1.05, 1.0], hp: 800, slots: 0 },
  furnace: { name: 'Furnace', size: [1.0, 1.7, 1.0], hp: 400, slots: 6 },
  storageBox: { name: 'Storage Box', size: [1.0, 0.62, 0.62], hp: 150, slots: 12 },
  toolCupboard: { name: 'Tool Cupboard', size: [0.9, 1.75, 0.55], hp: 600, slots: 0 },
  sleepingBag: { name: 'Sleeping Bag', size: [0.8, 0.14, 1.9], hp: 100, slots: 0 },
  planter: { name: 'Planter Box', size: [1.8, 0.42, 0.75], hp: 200, slots: 9 },
  lootBag: { name: 'Loot Bag', size: [0.7, 0.45, 0.7], hp: 40, slots: INVENTORY_SIZE },
  crate: { name: 'Wooden Crate', size: [0.49, 0.28, 1.5], hp: 1e9, slots: 12 },
  militaryCrate: { name: 'Military Crate', size: [0.71, 0.77, 1.3], hp: 1e9, slots: 12 },
  supplyDrop: { name: 'Supply Drop', size: [1.4, 1.37, 1.4], hp: 1e9, slots: 18 },
  supplySignal: { name: 'Supply Signal', size: [0.09, 0.2, 0.09], hp: 1e9, slots: 0 },
  beancan: { name: 'Beancan Grenade', size: [0.14, 0.16, 0.14], hp: 1e9, slots: 0 },
  satchel: { name: 'Satchel Charge', size: [0.3, 0.3, 0.16], hp: 1e9, slots: 0 },
  c4: { name: 'Timed Explosive Charge', size: [0.3, 0.22, 0.12], hp: 1e9, slots: 0 },
};

/** Metres round a tool cupboard (across the ground) where only those it trusts may build. */
export const TC_RANGE = 18;

/**
 * Whether a player may build at a spot: 'none' outside every tool cupboard's reach,
 * 'authorised' inside only cupboards that trust them, 'blocked' inside any that doesn't.
 * `player` can be them and their teammates: a cupboard that trusts one of the team trusts all.
 */
export function privilege(deployables: Iterable<Deployable>, x: number, z: number, player: number | readonly number[]): 'none' | 'authorised' | 'blocked' {
  const us = typeof player === 'number' ? [player] : player;
  let result: 'none' | 'authorised' = 'none';
  for (const d of deployables) {
    if (d.kind !== 'toolCupboard' || Math.hypot(d.x - x, d.z - z) > TC_RANGE) continue;
    if (!us.some((m) => d.auth?.includes(m))) return 'blocked';
    result = 'authorised';
  }
  return result;
}


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
  const d: Deployable = { id, kind, x, y, z, rot, hp: info.hp, owner, slots: emptySlots(info.slots), on: false };
  // Whoever sets down a tool cupboard is the first one it trusts.
  if (kind === 'toolCupboard') d.auth = [owner];
  if (kind === 'planter') d.grow = PLANTER_SEED_SLOTS.map(() => 0);
  return d;
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
  if (d.kind === 'lootBag' || CRATE_KINDS.includes(d.kind)) return false;
  if (d.kind === 'planter') return PLANTER_SEED_SLOTS.includes(slot) && CROPS[item] !== undefined;
  if (d.kind !== 'furnace') return true;
  if (slot === FURNACE_FUEL) return item === 'wood';
  if (FURNACE_ORE_SLOTS.includes(slot)) return SMELTS[item] !== undefined;
  return false;
}
