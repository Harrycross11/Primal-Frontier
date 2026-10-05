// Messages sent over the WebSocket, as JSON. Client sends inputs and requests;
// the server decides what actually happens and tells everyone.

import type { Piece, PieceKind, WallEdit } from './building.ts';
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
}

/** A slot in your own inventory ('me') or in a furnace or box (its id). */
export interface SlotRef {
  c: 'me' | number;
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
  | { t: 'furnace'; id: number; on: boolean };

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
    }
  | { t: 'state'; players: PlayerState[] }
  | { t: 'joined'; player: PlayerState }
  | { t: 'left'; id: number }
  | { t: 'resource'; id: number; amount: number }
  | { t: 'inventory'; slots: Slots }
  | { t: 'crafting'; queue: CraftJob[] }
  /** A piece was placed, changed or damaged (piece set), or destroyed (piece null). */
  | { t: 'piece'; key: string; piece: Piece | null; by: number }
  /** A deployable was placed or changed (set), or destroyed (null). */
  | { t: 'deployable'; id: number; d: Deployable | null; by: number }
  | { t: 'correct'; x: number; y: number; z: number }
  | { t: 'notice'; text: string }
  | { t: 'full' };
