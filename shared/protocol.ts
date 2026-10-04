// Messages sent over the WebSocket, as JSON. Client sends inputs and requests;
// the server decides what actually happens and tells everyone.

import type { Block, BlockType, Inventory, ResourceNode } from './world.ts';

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
  | { t: 'place'; x: number; y: number; z: number; block: BlockType }
  | { t: 'break'; x: number; y: number; z: number };

export type ServerMessage =
  | {
      t: 'welcome';
      id: number;
      seed: number;
      you: PlayerState;
      players: PlayerState[];
      resources: ResourceNode[];
      blocks: Block[];
      inventory: Inventory;
    }
  | { t: 'state'; players: PlayerState[] }
  | { t: 'joined'; player: PlayerState }
  | { t: 'left'; id: number }
  | { t: 'resource'; id: number; amount: number }
  | { t: 'inventory'; inventory: Inventory }
  | { t: 'block'; x: number; y: number; z: number; type: BlockType | null; by: number }
  | { t: 'correct'; x: number; y: number; z: number }
  | { t: 'notice'; text: string }
  | { t: 'full' };
