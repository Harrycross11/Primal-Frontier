// Messages sent over the WebSocket, as JSON. Client sends inputs and requests;
// the server decides what actually happens and tells everyone.

import type { Piece, PieceKind, WallEdit } from './building.ts';
import type { Vec3 } from './combat.ts';
import type { CreatureState } from './creatures.ts';
import type { Deployable } from './deployables.ts';
import type { ItemId, Slots } from './items.ts';
import type { Look } from './look.ts';
import type { SurvivalCause, Vitals } from './survival.ts';
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
  /** Skin, hair, clothing and gear they picked before joining. */
  look: Look;
  /** The animal they are riding. */
  riding?: number;
}

/** A slot in your own inventory ('me'), your worn armour ('wear'), or a furnace or box (its id). */
export interface SlotRef {
  c: 'me' | 'wear' | number;
  i: number;
}

/** What killed someone when no player did: hunger, thirst, radiation or a wild Ashhound. */
export type DeathCause = SurvivalCause | 'ashhound' | 'explosion';

export interface CraftJob {
  item: ItemId;
  /** Seconds left on the job at the front of the queue; the full time for the rest. */
  left: number;
  total: number;
}

export type ClientMessage =
  /** `token` is a private random id the browser keeps, so a returning player gets their survivor back. */
  | { t: 'join'; name: string; look?: Look; token?: string }
  | { t: 'move'; x: number; y: number; z: number; yaw: number; moving: boolean; slot: number }
  /** Hit a resource node with the item in a belt slot. */
  | { t: 'gather'; id: number; slot: number }
  | { t: 'place'; kind: PieceKind; i: number; y: number; k: number; dir: number; material: Material }
  /** Hit a building piece, or the door hung in it. */
  | { t: 'hit'; key: string; door?: boolean }
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
  /** Use a bandage or syringe, eat, drink or take pills. */
  | { t: 'use'; slot: number }
  /** Climb on your own tame animal, or (id null) get off the one you are riding. */
  | { t: 'ride'; id: number | null }
  | { t: 'invite'; id: number }
  | { t: 'acceptInvite' }
  | { t: 'leaveTeam' }
  /** Wake up somewhere random, or in one of your sleeping bags. */
  | { t: 'respawn'; bag?: number }
  /** Ask a tool cupboard to trust you, or make it forget everyone else. */
  | { t: 'authorize'; id: number }
  | { t: 'clearAuth'; id: number }
  /** Hang the door in a belt slot in a doorway. */
  | { t: 'hangDoor'; key: string; slot: number }
  /** Open or close a door. */
  | { t: 'door'; key: string }
  /** Fit the code lock in a belt slot to a door, with a 4-digit code. */
  | { t: 'lock'; key: string; slot: number; code: string }
  /** Try a code on someone else's locked door. */
  | { t: 'code'; key: string; code: string }
  /** Stick the charge in a belt slot at a point on a wall, door, floor or the ground. */
  | { t: 'plant'; slot: number; at: Vec3; key?: string; door?: boolean }
  /** Throw the grenade in a belt slot from your eyes along `d`. */
  | { t: 'throw'; slot: number; d: Vec3 };

export type ServerMessage =
  | {
      t: 'welcome';
      id: number;
      seed: number;
      /** The server's clock (ms since 1970), which sets the time of day and the weather. */
      now: number;
      you: PlayerState;
      players: PlayerState[];
      creatures: CreatureState[];
      resources: ResourceNode[];
      pieces: Piece[];
      deployables: Deployable[];
      slots: Slots;
      wear: Slots;
      hp: number;
      vitals: Vitals;
      /** Everyone on your team (you included), or just you. */
      team: number[];
    }
  | { t: 'state'; players: PlayerState[]; creatures: CreatureState[] }
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
  /** You climbed on an animal (id), or got off one (id null) at this spot. */
  | { t: 'invited'; from: string }
  /** Your team's members (you included), or none when you're on no team. */
  | { t: 'team'; members: number[] }
  | { t: 'mounted'; id: number | null; x: number; y: number; z: number; yaw: number }
  | { t: 'notice'; text: string }
  /** Someone died, for the kill feed: who killed them (null if nobody), with what, and if it was a headshot. */
  | { t: 'kill'; killer: string | null; victim: string; item: ItemId | null; head: boolean; cause?: DeathCause }
  /** Your hunger, thirst and radiation poisoning, and the radiation per second where you stand (after protection). */
  | { t: 'vitals'; food: number; water: number; rads: number; level: number }
  /** Someone fired: where from and where each pellet ended, for tracers and sound. */
  | { t: 'shot'; by: number; item: ItemId; from: Vec3; ends: Vec3[] }
  /** You hit someone (for the hit marker); `armour` when the hit landed on armour. */
  | { t: 'hitmarker'; head: boolean; kill: boolean; armour?: boolean }
  /** Your health changed; `from` is where the damage came from, if anywhere, and `armour` if your armour took some of it. */
  | { t: 'health'; hp: number; from?: Vec3; armour?: boolean }
  /** You died. */
  | { t: 'died'; by: string | null; item: ItemId | null; cause?: DeathCause }
  /** Something blew up. */
  | { t: 'explosion'; at: Vec3; item: 'beancan' | 'satchel' | 'c4' }
  /**
   * The supply plane crosses the map at `y`, from `from` to `to` (x, z), leaving at `start`
   * (server ms) at `speed` m/s. It drops its crate at `drop`, over the land named `over`.
   */
  | { t: 'plane'; from: [number, number]; to: [number, number]; y: number; start: number; speed: number; drop: [number, number]; over: string }
  /** That door is locked: ask for its code. */
  | { t: 'codeNeeded'; key: string }
  | { t: 'full' };
