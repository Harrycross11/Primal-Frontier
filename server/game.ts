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
  BLOCK_COST,
  RESOURCE_INFO,
  blockKey,
  cellInBounds,
  cellIsSupported,
  emptyInventory,
  generateResources,
  type Block,
  type BlockType,
  type Inventory,
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

const COLORS = [0xff5a36, 0x2ec4ff, 0xffc93c, 0x7cff6b, 0xd16bff, 0xff6bb5, 0x40e0c0, 0xff9f1c];

export class Game {
  readonly seed: number;
  readonly resources: ResourceNode[];
  readonly blocks = new Map<string, Block>();
  readonly players = new Map<number, Player>();
  private nextId = 1;
  private respawns: { id: number; at: number }[] = [];
  private rand: () => number;

  constructor(seed: number) {
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
      inventory: emptyInventory(),
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
            blocks: [...this.blocks.values()],
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

  place(id: number, x: number, y: number, z: number, type: BlockType): Outgoing[] {
    const p = this.players.get(id);
    if (!p || !(type in BLOCK_COST) || !cellInBounds(x, y, z)) return [];
    const key = blockKey(x, y, z);
    if (this.blocks.has(key)) return [];
    if (!this.inReach(p, x, y, z)) return [{ to: id, msg: { t: 'notice', text: 'Too far away' } }];
    const cost = BLOCK_COST[type];
    if (p.inventory[cost.material] < cost.amount) {
      return [{ to: id, msg: { t: 'notice', text: `Need ${cost.amount} ${cost.material}` } }];
    }
    if (!cellIsSupported(this.seed, this.blocks, x, y, z)) {
      return [{ to: id, msg: { t: 'notice', text: 'Blocks must touch the ground or another block' } }];
    }
    for (const other of this.players.values()) {
      if (overlapsPlayer(other, x, y, z)) return [{ to: id, msg: { t: 'notice', text: 'Someone is standing there' } }];
    }
    p.inventory[cost.material] -= cost.amount;
    this.blocks.set(key, { x, y, z, type });
    return [
      { to: 'all', msg: { t: 'block', x, y, z, type, by: id } },
      { to: id, msg: { t: 'inventory', inventory: { ...p.inventory } } },
    ];
  }

  /** Breaking a block refunds half its cost, so building has a real price. */
  break(id: number, x: number, y: number, z: number): Outgoing[] {
    const p = this.players.get(id);
    const key = blockKey(x, y, z);
    const block = this.blocks.get(key);
    if (!p || !block) return [];
    if (!this.inReach(p, x, y, z)) return [{ to: id, msg: { t: 'notice', text: 'Too far away' } }];
    this.blocks.delete(key);
    const cost = BLOCK_COST[block.type];
    p.inventory[cost.material] += Math.floor(cost.amount / 2);
    return [
      { to: 'all', msg: { t: 'block', x, y, z, type: null, by: id } },
      { to: id, msg: { t: 'inventory', inventory: { ...p.inventory } } },
    ];
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

  private inReach(p: Player, x: number, y: number, z: number): boolean {
    const eyeY = p.y + PLAYER_HEIGHT * 0.9;
    return Math.hypot(p.x - (x + 0.5), eyeY - (y + 0.5), p.z - (z + 0.5)) <= BUILD_RANGE + 0.9;
  }
}

function publicState(p: Player): PlayerState {
  return { id: p.id, name: p.name, color: p.color, x: p.x, y: p.y, z: p.z, yaw: p.yaw, moving: p.moving };
}

function cleanName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/[^\w \-]/g, '').trim().slice(0, 16) : '';
}

function overlapsPlayer(p: PlayerState, x: number, y: number, z: number): boolean {
  const r = PLAYER_RADIUS;
  return (
    p.x + r > x && p.x - r < x + 1 && p.z + r > z && p.z - r < z + 1 && p.y + PLAYER_HEIGHT > y && p.y < y + 1
  );
}
