// Messages sent over the WebSocket, as JSON. Client sends inputs and requests;
// the server decides what actually happens and tells everyone.

import type { Piece, PieceKind, WallEdit } from './building.ts';
import type { Vec3 } from './combat.ts';
import type { Deployable } from './deployables.ts';
import type { ItemId, Slots } from './items.ts';
import type { Material, ResourceNode } from './world.ts';

export interface PlayerState {
  id: number;
  name: string;
  color: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  moving: boolean;
  /** The item in their hands, so others see it. */
  held: ItemId | null;
  /** Lying dead, waiting to respawn. */
  dead: boolean;
  /** Armour worn on the head, chest and legs, so others see it. */
  wear: (ItemId | null)[];
}

/** A slot in your own inventory ('me'), your worn armour ('wear'), or a furnace or box (its id). */
export interface SlotRef {
  c: 'me' | 'wear' | number;
  i: number;
}

export interface CraftJob {
  item: ItemId;
  /** Seconds left on the job at the front of the queue; the full time for the rest. */
  left: number;
  total: number;
}

export type ClientMessage =
  | { t: 'join'; name: string }
  | { t: 'move'; x: number; y: number; z: number; yaw: number; moving: boolean; slot: number }
  /** Hit a resource node with the item in a belt slot. */
  | { t: 'gather'; id: number; slot: number }
  | { t: 'place'; kind: PieceKind; i: number; y: number; k: number; dir: number; material: Material }
  | { t: 'hit'; key: string }
  | { t: 'hitDeployable'; id: number }
  | { t: 'edit'; key: string; edit: WallEdit }
  | { t: 'craft'; item: ItemId; count: number }
  | { t: 'cancelCraft'; index: number }
  /** Move a stack (or `count` of it) between slots; stacks merge or swap. */
  | { t: 'moveItem'; from: SlotRef; to: SlotRef; count?: number }
  | { t: 'deploy'; slot: number; x: number; y: number; z: number; rot: number }
  | { t: 'furnace'; id: number; on: boolean }
  /** Fire the bow or gun in a belt slot from your eyes along `d`, aiming down sights or not. */
  | { t: 'fire'; slot: number; d: Vec3; aim: boolean }
  | { t: 'reload'; slot: number }
  /** Swing a melee weapon or tool (or your fists) at whoever is in front of you along `d`. */
  | { t: 'melee'; slot: number; d: Vec3 }
  /** Use a bandage or syringe. */
  | { t: 'use'; slot: number }
  | { t: 'respawn' };

export type ServerMessage =
  | {
      t: 'welcome';
      id: number;
      seed: number;
      you: PlayerState;
      players: PlayerState[];
      resources: ResourceNode[];
      pieces: Piece[];
      deployables: Deployable[];
      slots: Slots;
      wear: Slots;
      hp: number;
    }
  | { t: 'state'; players: PlayerState[] }
  | { t: 'joined'; player: PlayerState }
  | { t: 'left'; id: number }
  /** A node's amount changed: `by` gathered from it, or it grew back (no `by`). */
  | { t: 'resource'; id: number; amount: number; by?: number }
  /** Your inventory and the armour you wear (head, chest, legs). */
  | { t: 'inventory'; slots: Slots; wear: Slots }
  | { t: 'crafting'; queue: CraftJob[] }
  /** A craft finished and went into your inventory. */
  | { t: 'crafted'; item: ItemId; count: number }
  /** A piece was placed, changed or damaged (piece set), or destroyed (piece null). */
  | { t: 'piece'; key: string; piece: Piece | null; by: number }
  /** A deployable was placed or changed (set), or destroyed (null). */
  | { t: 'deployable'; id: number; d: Deployable | null; by: number }
  | { t: 'correct'; x: number; y: number; z: number }
  | { t: 'notice'; text: string }
  /** Someone died, for the kill feed: who killed them (null if nobody), with what, and if it was a headshot. */
  | { t: 'kill'; killer: string | null; victim: string; item: ItemId | null; head: boolean }
  /** Someone fired: where from and where each pellet ended, for tracers and sound. */
  | { t: 'shot'; by: number; item: ItemId; from: Vec3; ends: Vec3[] }
  /** You hit someone (for the hit marker); `armour` when the hit landed on armour. */
  | { t: 'hitmarker'; head: boolean; kill: boolean; armour?: boolean }
  /** Your health changed; `from` is where the damage came from, if anywhere, and `armour` if your armour took some of it. */
  | { t: 'health'; hp: number; from?: Vec3; armour?: boolean }
  /** You died. */
  | { t: 'died'; by: string | null; item: ItemId | null }
  | { t: 'full' };
