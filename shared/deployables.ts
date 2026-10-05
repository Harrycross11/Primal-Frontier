// Things players craft and set down in the world: a workbench, a furnace and storage boxes.
// Furnaces and boxes hold items. Shared so client and server agree on size and slot rules.

import type { Box } from './building.ts';
import { emptySlots, type ItemId, type Slots } from './items.ts';

export type DeployableKind = 'workbench' | 'furnace' | 'storageBox';
export const DEPLOYABLE_KINDS: DeployableKind[] = ['workbench', 'furnace', 'storageBox'];

export interface Deployable {
  id: number;
  kind: DeployableKind;
  x: number;
  y: number;
  z: number;
  /** Facing, in radians around the vertical axis. */
  rot: number;
  hp: number;
  owner: number;
  /** Item slots, for furnaces and boxes. */
  slots: Slots;
  /** Furnaces: burning or not. */
  on: boolean;
}

export const DEPLOYABLE_INFO: Record<DeployableKind, { size: [number, number, number]; hp: number; slots: number }> = {
  workbench: { size: [1.7, 0.95, 0.85], hp: 300, slots: 0 },
  furnace: { size: [1.0, 1.7, 1.0], hp: 400, slots: 3 },
  storageBox: { size: [1.0, 0.62, 0.62], hp: 150, slots: 12 },
};

/** Furnace slots: 0 holds wood (fuel), 1 holds metal ore, 2 receives metal fragments. */
export const FURNACE_FUEL = 0;
export const FURNACE_ORE = 1;
export const FURNACE_OUTPUT = 2;
/** Seconds one wood burns for, and to smelt one ore. */
export const FURNACE_WOOD_SECONDS = 2;
export const FURNACE_SMELT_SECONDS = 1;

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

/** Whether an item may go into a container slot. The furnace output only takes things out. */
export function slotAccepts(d: Deployable, slot: number, item: ItemId): boolean {
  if (d.kind !== 'furnace') return true;
  if (slot === FURNACE_FUEL) return item === 'wood';
  if (slot === FURNACE_ORE) return item === 'metalOre';
  return false;
}
