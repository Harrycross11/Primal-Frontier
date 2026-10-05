// Messages sent over the WebSocket, as JSON. Client sends inputs and requests;
// the server decides what actually happens and tells everyone.

import type { Piece, PieceKind, WallEdit } from './building.ts';
import type { Inventory, Material, ResourceNode } from './world.ts';

export interface PlayerState {
  id: number;
  name: string;
  color: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  moving: boolean;
}

export type ClientMessage =
  | { t: 'join'; name: string }
  | { t: 'move'; x: number; y: number; z: number; yaw: number; moving: boolean }
  | { t: 'gather'; id: number }
  | { t: 'place'; kind: PieceKind; i: number; y: number; k: number; dir: number; material: Material }
  | { t: 'hit'; key: string }
  | { t: 'edit'; key: string; edit: WallEdit };

export type ServerMessage =
  | {
      t: 'welcome';
      id: number;
      seed: number;
      you: PlayerState;
      players: PlayerState[];
      resources: ResourceNode[];
      pieces: Piece[];
      inventory: Inventory;
    }
  | { t: 'state'; players: PlayerState[] }
  | { t: 'joined'; player: PlayerState }
  | { t: 'left'; id: number }
  | { t: 'resource'; id: number; amount: number }
  | { t: 'inventory'; inventory: Inventory }
  /** A piece was placed, changed or damaged (piece set), or destroyed (piece null). */
  | { t: 'piece'; key: string; piece: Piece | null; by: number }
  | { t: 'correct'; x: number; y: number; z: number }
  | { t: 'notice'; text: string }
  | { t: 'full' };
