// The authoritative game state. Pure logic with no networking, so it can be unit tested.
// Every method returns the messages to send; server/index.ts delivers them.

import {
  BUILD_RANGE,
  GATHER_COOLDOWN,
  GATHER_RANGE,
  HALF_WORLD,
  MAX_PLAYERS,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  PLAYER_SPRINT,
  SCRAP_RESPAWN_SECONDS,
} from '../shared/constants.ts';
import type { PlayerState, ServerMessage } from '../shared/protocol.ts';
import { mulberry32, terrainHeight } from '../shared/terrain.ts';
import {
  HIT_DAMAGE,
  MAX_HP,
  PIECE_COST,
  WALL_EDITS,
  boxesTouch,
  pieceBounds,
  pieceBoxes,
  pieceKey,
  pieceSupported,
  validPieceShape,
  type Box,
  type Piece,
  type PieceKind,
  type WallEdit,
} from '../shared/building.ts';
import {
  RESOURCE_INFO,
  generateResources,
  type Inventory,
  type Material,
  type ResourceNode,
} from '../shared/world.ts';

/** Who a message goes to: one player, everyone, or everyone except one player. */
export type Outgoing =
  | { to: number; msg: ServerMessage }
  | { to: 'all'; msg: ServerMessage }
  | { to: 'others'; except: number; msg: ServerMessage };

interface Player extends PlayerState {
  inventory: Inventory;
  lastMoveAt: number;
  lastGatherAt: number;
}

// Faded dyes rather than bright team colours: they tint a survivor's scarf, armband and name
// stripe, enough to tell players apart without breaking the wasteland look.
const COLORS = [0xa4553a, 0x3f7f86, 0xb08c3a, 0x6f7f3e, 0x7a4f6e, 0x9a3b34, 0x4f6382, 0xb06f2e];

export class Game {
  readonly seed: number;
  readonly resources: ResourceNode[];
  readonly pieces = new Map<string, Piece>();
  readonly players = new Map<number, Player>();
  private nextId = 1;
  private respawns: { id: number; at: number }[] = [];
  private rand: () => number;

  /** @param startKit materials each player spawns with (0 normally; handy for testing builds). */
  constructor(
    seed: number,
    private startKit = 0,
  ) {
    this.seed = seed;
    this.resources = generateResources(seed);
    this.rand = mulberry32(seed ^ 0x5bd1e995);
  }

  /** Adds a player at a random spawn point. Returns null when the server is full. */
  join(name: string, now: number): { id: number; out: Outgoing[] } | null {
    if (this.players.size >= MAX_PLAYERS) return null;
    const id = this.nextId++;
    const x = (this.rand() - 0.5) * HALF_WORLD;
    const z = (this.rand() - 0.5) * HALF_WORLD;
    const usedColors = new Set([...this.players.values()].map((p) => p.color));
    const color = COLORS.find((c) => !usedColors.has(c)) ?? COLORS[id % COLORS.length];
    const player: Player = {
      id,
      name: cleanName(name) || `Survivor ${id}`,
      color,
      x,
      y: terrainHeight(this.seed, x, z),
      z,
      yaw: 0,
      moving: false,
      inventory: { wood: this.startKit, scrap: this.startKit },
      lastMoveAt: now,
      lastGatherAt: 0,
    };
    this.players.set(id, player);
    const pub = publicState(player);
    return {
      id,
      out: [
        {
          to: id,
          msg: {
            t: 'welcome',
            id,
            seed: this.seed,
            you: pub,
            players: [...this.players.values()].filter((p) => p.id !== id).map(publicState),
            resources: this.resources,
            pieces: [...this.pieces.values()],
            inventory: player.inventory,
          },
        },
        { to: 'others', except: id, msg: { t: 'joined', player: pub } },
        { to: 'all', msg: { t: 'notice', text: `${player.name} joined the wasteland` } },
      ],
    };
  }

  leave(id: number): Outgoing[] {
    const p = this.players.get(id);
    if (!p) return [];
    this.players.delete(id);
    return [
      { to: 'all', msg: { t: 'left', id } },
      { to: 'all', msg: { t: 'notice', text: `${p.name} left` } },
    ];
  }

  /**
   * Movement is simulated on the client for responsiveness. The server only checks it is
   * plausible (not faster than sprinting, not under the ground, inside the map) and snaps
   * the player back otherwise.
   */
  move(id: number, x: number, y: number, z: number, yaw: number, moving: boolean, now: number): Outgoing[] {
    const p = this.players.get(id);
    if (!p || ![x, y, z, yaw].every(Number.isFinite)) return [];
    const dt = Math.max((now - p.lastMoveAt) / 1000, 0.05);
    const horizontal = Math.hypot(x - p.x, z - p.z);
    const allowed = PLAYER_SPRINT * dt * 1.5 + 0.5;
    const ground = terrainHeight(this.seed, x, z);
    const outside = Math.abs(x) > HALF_WORLD || Math.abs(z) > HALF_WORLD;
    if (horizontal > allowed || y < ground - 1 || y > ground + 60 || outside) {
      p.lastMoveAt = now;
      return [{ to: id, msg: { t: 'correct', x: p.x, y: p.y, z: p.z } }];
    }
    p.x = x;
    p.y = y;
    p.z = z;
    p.yaw = yaw;
    p.moving = moving;
    p.lastMoveAt = now;
    return [];
  }

  gather(id: number, resourceId: number, now: number): Outgoing[] {
    const p = this.players.get(id);
    const node = this.resources[resourceId];
    if (!p || !node || node.amount <= 0) return [];
    if ((now - p.lastGatherAt) / 1000 < GATHER_COOLDOWN) return [];
    const info = RESOURCE_INFO[node.kind];
    if (Math.hypot(p.x - node.x, p.z - node.z) > GATHER_RANGE + info.radius) {
      return [{ to: id, msg: { t: 'notice', text: 'Too far away' } }];
    }
    p.lastGatherAt = now;
    const got = Math.min(info.perHit, node.amount);
    node.amount -= got;
    p.inventory[info.material] += got;
    if (node.amount === 0 && node.kind === 'scrap') {
      this.respawns.push({ id: node.id, at: now + SCRAP_RESPAWN_SECONDS * 1000 });
    }
    return [
      { to: 'all', msg: { t: 'resource', id: node.id, amount: node.amount } },
      { to: id, msg: { t: 'inventory', inventory: { ...p.inventory } } },
    ];
  }

  place(id: number, kind: PieceKind, i: number, y: number, k: number, dir: number, material: Material): Outgoing[] {
    const p = this.players.get(id);
    if (!p) return [];
    const piece: Piece = { kind, i, y, k, dir: kind === 'floor' ? 0 : dir, material, edit: 'solid', hp: MAX_HP[material] };
    if (!validPieceShape(piece)) return [];
    const key = pieceKey(piece);
    if (this.pieces.has(key)) return [];
    const bounds = pieceBounds(piece);
    if (!this.inReach(p, bounds)) return [{ to: id, msg: { t: 'notice', text: 'Too far away' } }];
    if (p.inventory[material] < PIECE_COST) {
      return [{ to: id, msg: { t: 'notice', text: `Need ${PIECE_COST} ${material}` } }];
    }
    if (!pieceSupported(this.seed, piece, this.pieces.values())) {
      return [{ to: id, msg: { t: 'notice', text: 'Must connect to the ground or another piece' } }];
    }
    const solid = pieceBoxes(piece);
    for (const other of this.players.values()) {
      const pb = playerBox(other);
      if (solid.some((b) => boxesTouch(b, pb, -0.02))) {
        return [{ to: id, msg: { t: 'notice', text: 'Someone is standing there' } }];
      }
    }
    p.inventory[material] -= PIECE_COST;
    piece.hp = MAX_HP[material];
    this.pieces.set(key, piece);
    return [
      { to: 'all', msg: { t: 'piece', key, piece, by: id } },
      { to: id, msg: { t: 'inventory', inventory: { ...p.inventory } } },
    ];
  }

  /** Bare-handed hits damage a piece; at zero health it breaks and refunds a little material. */
  hit(id: number, key: string, now: number): Outgoing[] {
    const p = this.players.get(id);
    const piece = this.pieces.get(key);
    if (!p || !piece) return [];
    if ((now - p.lastGatherAt) / 1000 < GATHER_COOLDOWN) return [];
    if (!this.inReach(p, pieceBounds(piece))) return [{ to: id, msg: { t: 'notice', text: 'Too far away' } }];
    p.lastGatherAt = now;
    piece.hp -= HIT_DAMAGE;
    if (piece.hp > 0) return [{ to: 'all', msg: { t: 'piece', key, piece, by: id } }];
    this.pieces.delete(key);
    p.inventory[piece.material] += PIECE_COST / 2;
    return [
      { to: 'all', msg: { t: 'piece', key, piece: null, by: id } },
      { to: id, msg: { t: 'inventory', inventory: { ...p.inventory } } },
    ];
  }

  /** Edits turn a wall into a window, door or half wall, for free, like Fortnite. */
  edit(id: number, key: string, edit: WallEdit): Outgoing[] {
    const p = this.players.get(id);
    const piece = this.pieces.get(key);
    if (!p || !piece || piece.kind !== 'wall' || !WALL_EDITS.includes(edit)) return [];
    if (!this.inReach(p, pieceBounds(piece))) return [{ to: id, msg: { t: 'notice', text: 'Too far away' } }];
    piece.edit = edit;
    return [{ to: 'all', msg: { t: 'piece', key, piece, by: id } }];
  }

  /** Called every server tick: respawns scrap and builds the position snapshot. */
  tick(now: number): Outgoing[] {
    const out: Outgoing[] = [];
    this.respawns = this.respawns.filter((r) => {
      if (r.at > now) return true;
      const node = this.resources[r.id];
      node.amount = RESOURCE_INFO[node.kind].amount;
      out.push({ to: 'all', msg: { t: 'resource', id: node.id, amount: node.amount } });
      return false;
    });
    if (this.players.size > 0) {
      out.push({ to: 'all', msg: { t: 'state', players: [...this.players.values()].map(publicState) } });
    }
    return out;
  }

  /** Reach is measured from the player's eyes to the nearest point of the piece. */
  private inReach(p: Player, b: Box): boolean {
    const eye = [p.x, p.y + PLAYER_HEIGHT * 0.9, p.z];
    const d = eye.map((v, a) => Math.max(b.min[a] - v, 0, v - b.max[a]));
    return Math.hypot(d[0], d[1], d[2]) <= BUILD_RANGE + 0.5;
  }
}

function publicState(p: Player): PlayerState {
  return { id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, yaw: p.yaw, moving: p.moving };
}

function cleanName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/[^\w \-]/g, '').trim().slice(0, 16) : '';
}

export function playerBox(p: PlayerState): Box {
  return {
    min: [p.x - PLAYER_RADIUS, p.y, p.z - PLAYER_RADIUS],
    max: [p.x + PLAYER_RADIUS, p.y + PLAYER_HEIGHT, p.z + PLAYER_RADIUS],
  };
}
