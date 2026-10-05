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
  WORKBENCH_RANGE,
} from '../shared/constants.ts';
import type { CraftJob, PlayerState, ServerMessage, SlotRef } from '../shared/protocol.ts';
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
  DEPLOYABLE_KINDS,
  FURNACE_FUEL,
  FURNACE_ORE_SLOTS,
  FURNACE_OUTPUT_SLOTS,
  FURNACE_WOOD_SECONDS,
  LOOT_BAG_SECONDS,
  SMELTS,
  WORKBENCH_LEVEL,
  deployableBox,
  newDeployable,
  slotAccepts,
  type Deployable,
  type DeployableKind,
} from '../shared/deployables.ts';
import {
  ARMOUR_SLOTS,
  BELT_SIZE,
  INVENTORY_SIZE,
  ITEMS,
  addItem,
  canAfford,
  countItem,
  emptySlots,
  fitsArmourSlot,
  maxDurability,
  recipeFor,
  removeItem,
  roomFor,
  type ItemId,
  type Slots,
  type Stack,
} from '../shared/items.ts';
import type { ArmourSlot } from '../shared/items.ts';
import {
  EYE_HEIGHT,
  FIST,
  HEADSHOT,
  HEAL_COOLDOWN,
  MAX_HEALTH,
  armourFactor,
  falloff,
  normalize,
  rayBox,
  rayPlayer,
  rayTerrain,
  spreadDir,
  type Vec3,
} from '../shared/combat.ts';
import { RESOURCE_INFO, generateResources, type Material, type ResourceNode } from '../shared/world.ts';

/** Who a message goes to: one player, everyone, or everyone except one player. */
export type Outgoing =
  | { to: number; msg: ServerMessage }
  | { to: 'all'; msg: ServerMessage }
  | { to: 'others'; except: number; msg: ServerMessage };

interface Player extends Omit<PlayerState, 'held' | 'wear'> {
  slots: Slots;
  /** Armour worn on the head, chest and legs. */
  wear: Slots;
  /** Belt slot in their hands. */
  active: number;
  queue: CraftJob[];
  /** Set when a finished craft is waiting for inventory space, so the notice is sent once. */
  craftBlocked: boolean;
  lastMoveAt: number;
  lastGatherAt: number;
  hp: number;
  /** Earliest time (ms) the next shot or swing is allowed. */
  nextAttackAt: number;
  reloadUntil: number;
  lastHealAt: number;
}

/** Furnace burn and smelt timers, kept off the shared deployable state. */
interface FurnaceTimers {
  burn: number;
  /** Progress on the ore in each ore slot. */
  smelt: number[];
}

// Faded dyes rather than bright team colours: they tint a survivor's scarf, armband and name
// stripe, enough to tell players apart without breaking the wasteland look.
const COLORS = [0xa4553a, 0x3f7f86, 0xb08c3a, 0x6f7f3e, 0x7a4f6e, 0x9a3b34, 0x4f6382, 0xb06f2e];
const MAX_QUEUE = 20;
/** How close you must be to open a furnace or box. */
const CONTAINER_RANGE = 3.5;

export class Game {
  readonly seed: number;
  readonly resources: ResourceNode[];
  readonly pieces = new Map<string, Piece>();
  readonly deployables = new Map<number, Deployable>();
  readonly players = new Map<number, Player>();
  private nextId = 1;
  private nextDeployableId = 1;
  private respawns: { id: number; at: number }[] = [];
  private furnaces = new Map<number, FurnaceTimers>();
  /** Seconds until each loot bag disappears. */
  private bagExpiry = new Map<number, number>();
  private lastTick = -1;
  private rand: () => number;

  /**
   * @param startKit what players spawn with besides the rock and plan: a count of each basic
   * resource, or a list of items (nothing normally; handy for testing and screenshots).
   */
  constructor(
    seed: number,
    private startKit: number | Partial<Record<ItemId, number>> = 0,
  ) {
    this.seed = seed;
    this.resources = generateResources(seed);
    this.rand = mulberry32(seed ^ 0x5bd1e995);
  }

  /** Adds a player at a random spawn point. Returns null when the server is full. */
  join(name: string, now: number): { id: number; out: Outgoing[] } | null {
    if (this.players.size >= MAX_PLAYERS) return null;
    const id = this.nextId++;
    const [x, z] = this.spawnPoint();
    const usedColors = new Set([...this.players.values()].map((p) => p.color));
    const color = COLORS.find((c) => !usedColors.has(c)) ?? COLORS[id % COLORS.length];
    const slots = starterSlots();
    const each = this.startKit;
    const kit: Partial<Record<ItemId, number>> =
      typeof each === 'number' ? Object.fromEntries((['wood', 'stone', 'scrap', 'metal', 'hqm', 'cloth', 'gunpowder'] as ItemId[]).map((i) => [i, each])) : each;
    for (const [item, n] of Object.entries(kit)) if (typeof n === 'number' && n > 0 && item in ITEMS) addItem(slots, item as ItemId, n);
    const player: Player = {
      id,
      name: cleanName(name) || `Survivor ${id}`,
      color,
      x,
      y: terrainHeight(this.seed, x, z),
      z,
      yaw: 0,
      moving: false,
      dead: false,
      slots,
      wear: emptySlots(ARMOUR_SLOTS.length),
      active: 0,
      hp: MAX_HEALTH,
      nextAttackAt: 0,
      reloadUntil: 0,
      lastHealAt: -Infinity,
      queue: [],
      craftBlocked: false,
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
            deployables: [...this.deployables.values()],
            slots: clone(slots),
            wear: clone(player.wear),
            hp: player.hp,
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
   * the player back otherwise. It also says which belt slot is in their hands.
   */
  move(id: number, x: number, y: number, z: number, yaw: number, moving: boolean, now: number, slot = 0): Outgoing[] {
    const p = this.alive(id);
    if (!p || ![x, y, z, yaw].every(Number.isFinite)) return [];
    if (isBeltSlot(slot)) p.active = slot;
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

  /**
   * Hits a resource node with whatever is in the given belt slot. Tools multiply the yield
   * for what they are made for and wear down with each hit. Hemp is picked whole by hand.
   */
  gather(id: number, resourceId: number, now: number, slot = 0): Outgoing[] {
    const p = this.alive(id);
    const node = this.resources[resourceId];
    if (!p || !node || node.amount <= 0) return [];
    if ((now - p.lastGatherAt) / 1000 < GATHER_COOLDOWN) return [];
    const info = RESOURCE_INFO[node.kind];
    if (Math.hypot(p.x - node.x, p.z - node.z) > GATHER_RANGE + info.radius) {
      return [notice(id, 'Too far away')];
    }
    const held = isBeltSlot(slot) ? p.slots[slot] : null;
    const tool = held ? ITEMS[held.item].tool : undefined;
    let got = node.amount;
    if (info.tool !== 'pickup') {
      // Bare hands can only pull at scrap.
      const multiplier = tool ? tool[info.tool] : info.tool === 'scrap' ? 0.5 : 0;
      if (multiplier === 0) return [notice(id, info.tool === 'wood' ? 'You need a rock or an axe to chop wood' : 'You need a rock or a pickaxe to mine this')];
      got = Math.min(Math.max(1, Math.round(info.perHit * multiplier)), node.amount);
    }
    const room = roomFor(p.slots, info.yields);
    if (room === 0) return [notice(id, 'Your inventory is full')];
    got = Math.min(got, room);
    p.lastGatherAt = now;
    node.amount -= got;
    addItem(p.slots, info.yields, got);
    const out: Outgoing[] = [{ to: 'all', msg: { t: 'resource', id: node.id, amount: node.amount } }];
    if (held && tool && info.tool !== 'pickup') {
      held.hp = (held.hp ?? tool.durability) - 1;
      if (held.hp <= 0) {
        p.slots[slot] = null;
        out.push(notice(id, `Your ${ITEMS[held.item].name} broke`));
      }
    }
    if (node.amount === 0 && info.respawn > 0) this.respawns.push({ id: node.id, at: now + info.respawn * 1000 });
    out.push(this.inventory(p));
    return out;
  }

  place(id: number, kind: PieceKind, i: number, y: number, k: number, dir: number, material: Material): Outgoing[] {
    const p = this.alive(id);
    if (!p) return [];
    if (p.slots[p.active]?.item !== 'buildingPlan') return [notice(id, 'Hold a building plan to build')];
    const piece: Piece = { kind, i, y, k, dir: kind === 'floor' ? 0 : dir, material, edit: 'solid', hp: MAX_HP[material] };
    if (!validPieceShape(piece)) return [];
    const key = pieceKey(piece);
    if (this.pieces.has(key)) return [];
    const bounds = pieceBounds(piece);
    if (!this.inReach(p, bounds)) return [notice(id, 'Too far away')];
    if (countItem(p.slots, material) < PIECE_COST) return [notice(id, `Need ${PIECE_COST} ${ITEMS[material].name.toLowerCase()}`)];
    if (!pieceSupported(this.seed, piece, this.pieces.values())) {
      return [notice(id, 'Must connect to the ground or another piece')];
    }
    const solid = pieceBoxes(piece);
    for (const other of this.players.values()) {
      const pb = playerBox(other);
      if (solid.some((b) => boxesTouch(b, pb, -0.02))) return [notice(id, 'Someone is standing there')];
    }
    for (const d of this.deployables.values()) {
      const db = deployableBox(d);
      if (solid.some((b) => boxesTouch(b, db, -0.02))) return [notice(id, 'Something is in the way')];
    }
    removeItem(p.slots, material, PIECE_COST);
    piece.hp = MAX_HP[material];
    this.pieces.set(key, piece);
    return [{ to: 'all', msg: { t: 'piece', key, piece, by: id } }, this.inventory(p)];
  }

  /** Hits damage a piece; at zero health it breaks and refunds a little material. */
  hit(id: number, key: string, now: number): Outgoing[] {
    const p = this.alive(id);
    const piece = this.pieces.get(key);
    if (!p || !piece) return [];
    if ((now - p.lastGatherAt) / 1000 < GATHER_COOLDOWN) return [];
    if (!this.inReach(p, pieceBounds(piece))) return [notice(id, 'Too far away')];
    p.lastGatherAt = now;
    piece.hp -= HIT_DAMAGE;
    if (piece.hp > 0) return [{ to: 'all', msg: { t: 'piece', key, piece, by: id } }];
    this.pieces.delete(key);
    addItem(p.slots, piece.material, PIECE_COST / 2);
    return [{ to: 'all', msg: { t: 'piece', key, piece: null, by: id } }, this.inventory(p)];
  }

  /**
   * Hits a workbench, furnace or box. When it breaks, whatever was inside goes to whoever
   * broke it, and its owner gets the item itself back (so this is also how you pick one up).
   */
  hitDeployable(id: number, deployableId: number, now: number): Outgoing[] {
    const p = this.alive(id);
    const d = this.deployables.get(deployableId);
    if (!p || !d) return [];
    if ((now - p.lastGatherAt) / 1000 < GATHER_COOLDOWN) return [];
    if (!this.inReach(p, deployableBox(d))) return [notice(id, 'Too far away')];
    p.lastGatherAt = now;
    d.hp -= HIT_DAMAGE;
    if (d.hp > 0) return [{ to: 'all', msg: { t: 'deployable', id: d.id, d, by: id } }];
    for (const s of d.slots) if (s) addStack(p.slots, s);
    if (d.owner === id && DEPLOYABLE_KINDS.includes(d.kind)) addItem(p.slots, d.kind as ItemId, 1);
    return [...this.removeDeployable(d.id, id), this.inventory(p)];
  }

  /** Edits turn a wall into a window, door or half wall, for free, like Fortnite. */
  edit(id: number, key: string, edit: WallEdit): Outgoing[] {
    const p = this.alive(id);
    const piece = this.pieces.get(key);
    if (!p || !piece || piece.kind !== 'wall' || !WALL_EDITS.includes(edit)) return [];
    if (!this.inReach(p, pieceBounds(piece))) return [notice(id, 'Too far away')];
    piece.edit = edit;
    return [{ to: 'all', msg: { t: 'piece', key, piece, by: id } }];
  }

  /** Queues crafting jobs. Ingredients are taken now and refunded if the job is cancelled. */
  craft(id: number, item: ItemId, count: number): Outgoing[] {
    const p = this.alive(id);
    const recipe = recipeFor(item);
    if (!p || !recipe || !Number.isInteger(count) || count < 1) return [];
    count = Math.min(count, MAX_QUEUE - p.queue.length);
    if (count <= 0) return [notice(id, 'Your crafting queue is full')];
    if (recipe.workbench && this.workbenchLevel(p) < recipe.workbench) return [notice(id, `You need to be near a level ${recipe.workbench} workbench`)];
    if (!canAfford(p.slots, recipe, count)) return [notice(id, 'Not enough resources')];
    for (const [ingredient, n] of Object.entries(recipe.cost)) removeItem(p.slots, ingredient as ItemId, n! * count);
    for (let n = 0; n < count; n++) p.queue.push({ item, left: recipe.time, total: recipe.time });
    return [this.inventory(p), this.crafting(p)];
  }

  cancelCraft(id: number, index: number): Outgoing[] {
    const p = this.alive(id);
    const job = p?.queue[index];
    if (!p || !job) return [];
    p.queue.splice(index, 1);
    for (const [ingredient, n] of Object.entries(recipeFor(job.item)!.cost)) addItem(p.slots, ingredient as ItemId, n!);
    if (index === 0) p.craftBlocked = false;
    return [this.inventory(p), this.crafting(p)];
  }

  /**
   * Moves items between slots of your inventory, a furnace or a box you are standing at.
   * Moving onto the same item tops up the stack; onto a different item swaps them.
   */
  moveItem(id: number, from: SlotRef, to: SlotRef, count?: number): Outgoing[] {
    const p = this.alive(id);
    if (!p || !from || !to) return [];
    const src = this.container(p, from.c);
    const dst = this.container(p, to.c);
    if (!src || !dst || !validIndex(src.slots, from.i) || !validIndex(dst.slots, to.i)) return [];
    if (src === dst && from.i === to.i) return [];
    const a = src.slots[from.i];
    if (!a) return [];
    if (dst.deployable && !slotAccepts(dst.deployable, to.i, a.item)) return [notice(id, "That can't go there")];
    if (dst.wear && !fitsArmourSlot(a.item, to.i)) return [notice(id, ITEMS[a.item].armour ? `That is worn on the ${ITEMS[a.item].armour!.slot}` : 'Only armour can be worn')];
    const n = Number.isInteger(count) && count! > 0 ? Math.min(count!, a.count) : a.count;
    const b = dst.slots[to.i];
    const stackMax = ITEMS[a.item].stack;
    if (!b) {
      dst.slots[to.i] = { ...a, count: n };
      a.count -= n;
      if (a.count === 0) src.slots[from.i] = null;
    } else if (b.item === a.item && stackMax > 1) {
      const moved = Math.min(n, stackMax - b.count);
      b.count += moved;
      a.count -= moved;
      if (a.count === 0) src.slots[from.i] = null;
    } else {
      if (n !== a.count) return [];
      if (src.deployable && !slotAccepts(src.deployable, from.i, b.item)) return [notice(id, "That can't go there")];
      if (src.wear && !fitsArmourSlot(b.item, from.i)) return [notice(id, "That can't go there")];
      src.slots[from.i] = b;
      dst.slots[to.i] = a;
    }
    const out: Outgoing[] = [];
    if (src.deployable === null || dst.deployable === null) out.push(this.inventory(p));
    for (const d of new Set([src.deployable, dst.deployable])) {
      if (!d) continue;
      // An emptied loot bag goes away.
      if (d.kind === 'lootBag' && !d.slots.some(Boolean)) out.push(...this.removeDeployable(d.id, id));
      else out.push({ to: 'all', msg: { t: 'deployable', id: d.id, d, by: id } });
    }
    return out;
  }

  /** Sets down a workbench, furnace or box from a belt slot, on the ground or on a floor. */
  deploy(id: number, slot: number, x: number, y: number, z: number, rot: number): Outgoing[] {
    const p = this.alive(id);
    if (!p || !isBeltSlot(slot) || ![x, y, z, rot].every(Number.isFinite)) return [];
    const stack = p.slots[slot];
    if (!stack || !DEPLOYABLE_KINDS.includes(stack.item as DeployableKind)) return [];
    const kind = stack.item as DeployableKind;
    const box = deployableBox({ kind, x, y, z, rot });
    if (!this.inReach(p, box)) return [notice(id, 'Too far away')];
    if (!this.deploySupported(x, y, z)) return [notice(id, 'Place it on flat ground or a floor')];
    const blockers: Box[] = [
      ...[...this.pieces.values()].flatMap(pieceBoxes),
      ...[...this.deployables.values()].map(deployableBox),
      ...[...this.players.values()].map(playerBox),
    ];
    if (blockers.some((b) => boxesTouch(box, b, -0.02))) return [notice(id, 'Something is in the way')];
    stack.count -= 1;
    if (stack.count === 0) p.slots[slot] = null;
    const d = newDeployable(this.nextDeployableId++, kind, x, y, z, rot, id);
    this.deployables.set(d.id, d);
    return [{ to: 'all', msg: { t: 'deployable', id: d.id, d, by: id } }, this.inventory(p)];
  }

  /** Lights or puts out a furnace. */
  furnace(id: number, deployableId: number, on: boolean): Outgoing[] {
    const p = this.alive(id);
    const d = this.deployables.get(deployableId);
    if (!p || !d || d.kind !== 'furnace' || !this.container(p, d.id)) return [];
    if (on && !d.slots[FURNACE_FUEL]) return [notice(id, 'Put some wood in first')];
    d.on = !!on;
    return [{ to: 'all', msg: { t: 'deployable', id: d.id, d, by: id } }];
  }

  /**
   * Fires the bow or gun in a belt slot. The server rolls the spread, traces every pellet
   * against walls, deployables, the ground and other players, and applies the damage.
   */
  fire(id: number, slot: number, dir: Vec3, aim: boolean, now: number): Outgoing[] {
    const p = this.alive(id);
    if (!p || !isBeltSlot(slot) || !isVec3(dir)) return [];
    p.active = slot;
    const stack = p.slots[slot];
    const w = stack ? ITEMS[stack.item].weapon : undefined;
    if (!stack || !w || w.class === 'melee') return [];
    if (now < p.nextAttackAt || now < p.reloadUntil) return [];
    if (!stack.ammo) return [notice(id, 'Out of ammo: press R to reload')];
    stack.ammo -= 1;
    p.nextAttackAt = now + w.delay * 1000 * 0.9;
    const from: Vec3 = [p.x, p.y + EYE_HEIGHT, p.z];
    const d = normalize(dir);
    const cone = (w.spread ?? 0) * (aim ? 0.5 : 1) * (p.moving ? 1.6 : 1);
    const ends: Vec3[] = [];
    const damage = new Map<Player, { amount: number; head: boolean; zones: Set<ArmourSlot> }>();
    for (let n = 0; n < (w.pellets ?? 1); n++) {
      const pd = spreadDir(d, cone, this.rand);
      const hit = this.trace(p, from, pd, w.range);
      ends.push([from[0] + pd[0] * hit.t, from[1] + pd[1] * hit.t, from[2] + pd[2] * hit.t]);
      if (!hit.player) continue;
      const amount = w.damage * falloff(hit.t, w.range) * (hit.head ? HEADSHOT : 1) * armourFactor(hit.player.wear, hit.zone);
      const sum = damage.get(hit.player) ?? { amount: 0, head: false, zones: new Set() };
      sum.amount += amount;
      sum.head ||= hit.head;
      sum.zones.add(hit.zone);
      damage.set(hit.player, sum);
    }
    const out: Outgoing[] = [{ to: 'all', msg: { t: 'shot', by: id, item: stack.item, from, ends } }];
    out.push(...this.wear(p, slot));
    for (const [victim, { amount, head, zones }] of damage) out.push(...this.damage(victim, amount, p, stack.item, head, zones));
    out.push(this.inventory(p));
    return out;
  }

  /** Loads the magazine of the gun in a belt slot from ammo in your inventory. */
  reload(id: number, slot: number, now: number): Outgoing[] {
    const p = this.alive(id);
    if (!p || !isBeltSlot(slot)) return [];
    const stack = p.slots[slot];
    const w = stack ? ITEMS[stack.item].weapon : undefined;
    if (!stack || !w?.ammo || !w.mag) return [];
    if (now < p.reloadUntil) return [];
    const need = w.mag - (stack.ammo ?? 0);
    const take = Math.min(need, countItem(p.slots, w.ammo));
    if (need <= 0) return [];
    if (take === 0) return [notice(id, `No ${ITEMS[w.ammo].name.toLowerCase()} left`)];
    removeItem(p.slots, w.ammo, take);
    stack.ammo = (stack.ammo ?? 0) + take;
    p.reloadUntil = now + (w.reload ?? 1) * 1000 * 0.9;
    return [this.inventory(p)];
  }

  /** Swings a melee weapon, a tool or your fists at whoever is straight ahead. */
  melee(id: number, slot: number, dir: Vec3, now: number): Outgoing[] {
    const p = this.alive(id);
    if (!p || !isBeltSlot(slot) || !isVec3(dir)) return [];
    p.active = slot;
    const stack = p.slots[slot];
    const w = stack ? ITEMS[stack.item].weapon : FIST;
    if (!w || ('class' in w && w.class !== 'melee')) return [];
    if (now < p.nextAttackAt) return [];
    p.nextAttackAt = now + w.delay * 1000 * 0.9;
    const from: Vec3 = [p.x, p.y + EYE_HEIGHT, p.z];
    // A little extra reach, since the client aims from behind the shoulder.
    const hit = this.trace(p, from, normalize(dir), w.range + 0.6);
    if (!hit.player) return [];
    const out = this.wear(p, slot);
    const amount = w.damage * (hit.head ? 1.5 : 1) * armourFactor(hit.player.wear, hit.zone);
    out.push(...this.damage(hit.player, amount, p, stack?.item ?? null, hit.head, new Set([hit.zone])));
    if (stack) out.push(this.inventory(p));
    return out;
  }

  /** Uses a bandage or syringe from a belt slot. */
  use(id: number, slot: number, now: number): Outgoing[] {
    const p = this.alive(id);
    if (!p || !isBeltSlot(slot)) return [];
    const stack = p.slots[slot];
    // Armour in your hands is put on, swapping with whatever was worn there.
    const armour = stack ? ITEMS[stack.item].armour : undefined;
    if (armour) return this.moveItem(id, { c: 'me', i: slot }, { c: 'wear', i: ARMOUR_SLOTS.indexOf(armour.slot) });
    const heal = stack ? ITEMS[stack.item].heal : undefined;
    if (!stack || !heal) return [];
    if ((now - p.lastHealAt) / 1000 < HEAL_COOLDOWN) return [];
    if (p.hp >= MAX_HEALTH) return [notice(id, 'You are already at full health')];
    p.lastHealAt = now;
    p.hp = Math.min(MAX_HEALTH, p.hp + heal);
    stack.count -= 1;
    if (stack.count === 0) p.slots[slot] = null;
    return [this.inventory(p), { to: id, msg: { t: 'health', hp: Math.round(p.hp) } }];
  }

  /** Back to life at a random spot with a rock, a building plan and full health. */
  respawn(id: number): Outgoing[] {
    const p = this.players.get(id);
    if (!p || !p.dead) return [];
    const [x, z] = this.spawnPoint();
    p.x = x;
    p.z = z;
    p.y = terrainHeight(this.seed, x, z);
    p.dead = false;
    p.hp = MAX_HEALTH;
    p.slots = starterSlots();
    p.wear = emptySlots(ARMOUR_SLOTS.length);
    p.active = 0;
    p.reloadUntil = 0;
    return [
      { to: id, msg: { t: 'correct', x: p.x, y: p.y, z: p.z } },
      { to: id, msg: { t: 'health', hp: p.hp } },
      this.inventory(p),
    ];
  }

  /**
   * Follows a ray until it hits a player, or is stopped by a building piece, a deployable or
   * the ground. Returns how far it went.
   */
  private trace(shooter: Player, o: Vec3, d: Vec3, range: number): { t: number; player?: Player; head: boolean; zone: ArmourSlot } {
    let t = range;
    for (const piece of this.pieces.values()) {
      for (const b of pieceBoxes(piece)) {
        const hit = rayBox(o, d, b, t);
        if (hit !== null) t = hit;
      }
    }
    for (const dep of this.deployables.values()) {
      const hit = rayBox(o, d, deployableBox(dep), t);
      if (hit !== null) t = hit;
    }
    const ground = rayTerrain(this.seed, o, d, t);
    if (ground !== null) t = ground;
    let best: { t: number; player?: Player; head: boolean; zone: ArmourSlot } = { t, head: false, zone: 'chest' };
    for (const other of this.players.values()) {
      if (other === shooter || other.dead) continue;
      const hit = rayPlayer(o, d, other, best.t);
      if (hit) best = { t: hit.t, player: other, head: hit.head, zone: hit.zone };
    }
    return best;
  }

  /** Wears down the weapon in a slot by one use; it breaks at zero. */
  private wear(p: Player, slot: number): Outgoing[] {
    const stack = p.slots[slot];
    if (!stack || stack.hp === undefined) return [];
    stack.hp -= 1;
    if (stack.hp > 0) return [];
    p.slots[slot] = null;
    return [notice(p.id, `Your ${ITEMS[stack.item].name} broke`), this.inventory(p)];
  }

  /** Applies damage (already reduced by armour) and wears down the armour on each part hit. */
  private damage(victim: Player, amount: number, by: Player, item: ItemId | null, head: boolean, zones: Set<ArmourSlot>): Outgoing[] {
    victim.hp = Math.max(0, victim.hp - amount);
    const kill = victim.hp <= 0;
    const armour = [...zones].some((z) => victim.wear[ARMOUR_SLOTS.indexOf(z)]);
    const out: Outgoing[] = [
      { to: by.id, msg: { t: 'hitmarker', head, kill, armour } },
      { to: victim.id, msg: { t: 'health', hp: Math.round(victim.hp), from: [by.x, by.y, by.z], armour } },
    ];
    if (kill) return [...out, ...this.kill(victim, by, item)];
    if (armour) out.push(...this.wearArmour(victim, zones));
    return out;
  }

  /** Each armour piece that took a hit loses one point of condition, and falls apart at zero. */
  private wearArmour(p: Player, zones: Set<ArmourSlot>): Outgoing[] {
    const out: Outgoing[] = [];
    for (const zone of zones) {
      const i = ARMOUR_SLOTS.indexOf(zone);
      const piece = p.wear[i];
      if (!piece || piece.hp === undefined) continue;
      piece.hp -= 1;
      if (piece.hp > 0) continue;
      p.wear[i] = null;
      out.push(notice(p.id, `Your ${ITEMS[piece.item].name} fell apart`));
    }
    out.push(this.inventory(p));
    return out;
  }

  /** Drops everything the victim carried (and their crafting refunds) into a loot bag. */
  private kill(victim: Player, by: Player | null, item: ItemId | null): Outgoing[] {
    for (const job of victim.queue) {
      for (const [ingredient, n] of Object.entries(recipeFor(job.item)!.cost)) addItem(victim.slots, ingredient as ItemId, n!);
    }
    victim.queue = [];
    victim.craftBlocked = false;
    victim.dead = true;
    victim.hp = 0;
    const out: Outgoing[] = [];
    // Worn armour goes in the bag too, after the inventory.
    const carried = [...victim.slots, ...victim.wear];
    if (carried.some(Boolean)) {
      const bag = newDeployable(this.nextDeployableId++, 'lootBag', victim.x, victim.y, victim.z, victim.yaw, 0);
      bag.slots = carried;
      bag.label = victim.name;
      this.deployables.set(bag.id, bag);
      this.bagExpiry.set(bag.id, LOOT_BAG_SECONDS);
      out.push({ to: 'all', msg: { t: 'deployable', id: bag.id, d: bag, by: 0 } });
    }
    victim.slots = emptySlots(INVENTORY_SIZE);
    victim.wear = emptySlots(ARMOUR_SLOTS.length);
    const how = item ? ` with ${ITEMS[item].name.replace(/^an? /i, '')}` : '';
    const text = by ? `${by.name} killed ${victim.name}${how}` : `${victim.name} died`;
    out.push(
      { to: victim.id, msg: { t: 'died', by: by?.name ?? null, item } },
      this.inventory(victim),
      this.crafting(victim),
      { to: 'all', msg: { t: 'notice', text } },
    );
    return out;
  }

  private spawnPoint(): [number, number] {
    return [(this.rand() - 0.5) * HALF_WORLD, (this.rand() - 0.5) * HALF_WORLD];
  }

  /** A player who is connected and not dead. */
  private alive(id: number): Player | undefined {
    const p = this.players.get(id);
    return p && !p.dead ? p : undefined;
  }

  /** Called every server tick: respawns nodes, runs crafting and furnaces, sends positions. */
  tick(now: number): Outgoing[] {
    const dt = this.lastTick < 0 ? 0 : Math.min((now - this.lastTick) / 1000, 1);
    this.lastTick = now;
    const out: Outgoing[] = [];
    this.respawns = this.respawns.filter((r) => {
      if (r.at > now) return true;
      const node = this.resources[r.id];
      node.amount = RESOURCE_INFO[node.kind].amount;
      out.push({ to: 'all', msg: { t: 'resource', id: node.id, amount: node.amount } });
      return false;
    });
    for (const p of this.players.values()) out.push(...this.tickCrafting(p, dt));
    for (const d of this.deployables.values()) if (d.kind === 'furnace' && d.on && this.tickFurnace(d, dt)) out.push({ to: 'all', msg: { t: 'deployable', id: d.id, d, by: 0 } });
    for (const [bag, left] of this.bagExpiry) {
      if (left - dt > 0) this.bagExpiry.set(bag, left - dt);
      else out.push(...this.removeDeployable(bag));
    }
    if (this.players.size > 0) {
      out.push({ to: 'all', msg: { t: 'state', players: [...this.players.values()].map(publicState) } });
    }
    return out;
  }

  private tickCrafting(p: Player, dt: number): Outgoing[] {
    const job = p.queue[0];
    if (!job) return [];
    job.left = Math.max(0, job.left - dt);
    if (job.left > 0) return [];
    const recipe = recipeFor(job.item)!;
    if (roomFor(p.slots, job.item) < recipe.count) {
      if (p.craftBlocked) return [];
      p.craftBlocked = true;
      return [notice(p.id, 'Inventory full: crafting is waiting for space')];
    }
    p.craftBlocked = false;
    p.queue.shift();
    addItem(p.slots, job.item, recipe.count);
    return [this.inventory(p), this.crafting(p), notice(p.id, `Crafted ${ITEMS[job.item].name}`)];
  }

  /**
   * Burns wood (leaving charcoal) and smelts each ore slot: metal ore into metal fragments,
   * sulfur ore into sulfur, high quality ore into high quality metal. Returns true if
   * anything changed.
   */
  private tickFurnace(d: Deployable, dt: number): boolean {
    const timers = this.furnaces.get(d.id) ?? { burn: 0, smelt: FURNACE_ORE_SLOTS.map(() => 0) };
    this.furnaces.set(d.id, timers);
    let changed = false;
    if (timers.burn <= 0) {
      const fuel = d.slots[FURNACE_FUEL];
      if (!fuel) {
        d.on = false;
        timers.smelt.fill(0);
        return true;
      }
      fuel.count -= 1;
      if (fuel.count === 0) d.slots[FURNACE_FUEL] = null;
      timers.burn += FURNACE_WOOD_SECONDS;
      furnaceOutput(d, 'charcoal');
      changed = true;
    }
    timers.burn -= dt;
    FURNACE_ORE_SLOTS.forEach((slot, n) => {
      const ore = d.slots[slot];
      const smelt = ore ? SMELTS[ore.item] : undefined;
      if (!ore || !smelt || !furnaceHasRoom(d, smelt.into)) {
        timers.smelt[n] = 0;
        return;
      }
      timers.smelt[n] += dt;
      while (timers.smelt[n] >= smelt.seconds && d.slots[slot] && furnaceHasRoom(d, smelt.into)) {
        timers.smelt[n] -= smelt.seconds;
        const o = d.slots[slot]!;
        o.count -= 1;
        if (o.count === 0) d.slots[slot] = null;
        furnaceOutput(d, smelt.into);
        changed = true;
      }
    });
    return changed;
  }

  /** Removes a deployable from the world, telling everyone. */
  private removeDeployable(id: number, by = 0): Outgoing[] {
    this.deployables.delete(id);
    this.furnaces.delete(id);
    this.bagExpiry.delete(id);
    return [{ to: 'all', msg: { t: 'deployable', id, d: null, by } }];
  }

  /** Your inventory, or a furnace or box you are close enough to use. */
  private container(p: Player, c: SlotRef['c']): { slots: Slots; deployable: Deployable | null; wear?: boolean } | null {
    if (c === 'me') return { slots: p.slots, deployable: null };
    if (c === 'wear') return { slots: p.wear, deployable: null, wear: true };
    if (typeof c !== 'number') return null;
    const d = this.deployables.get(c);
    if (!d || d.slots.length === 0) return null;
    const b = deployableBox(d);
    const dx = Math.max(b.min[0] - p.x, 0, p.x - b.max[0]);
    const dz = Math.max(b.min[2] - p.z, 0, p.z - b.max[2]);
    if (Math.hypot(dx, dz) > CONTAINER_RANGE || Math.abs(p.y - d.y) > 3) return null;
    return { slots: d.slots, deployable: d };
  }

  /** The best workbench level within reach, or 0. */
  private workbenchLevel(p: Player): number {
    let level = 0;
    for (const d of this.deployables.values()) {
      const l = WORKBENCH_LEVEL[d.kind];
      if (l && l > level && Math.hypot(d.x - p.x, d.z - p.z) <= WORKBENCH_RANGE && Math.abs(d.y - p.y) < 3) level = l;
    }
    return level;
  }

  /** On the ground (allowing small bumps), or on top of a floor piece. */
  private deploySupported(x: number, y: number, z: number): boolean {
    const ground = terrainHeight(this.seed, x, z);
    if (y >= ground - 0.3 && y <= ground + 0.4) return true;
    for (const piece of this.pieces.values()) {
      if (piece.kind !== 'floor') continue;
      const [b] = pieceBoxes(piece);
      if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2] && Math.abs(y - b.max[1]) < 0.15) return true;
    }
    return false;
  }

  private inventory(p: Player): Outgoing {
    return { to: p.id, msg: { t: 'inventory', slots: clone(p.slots), wear: clone(p.wear) } };
  }

  private crafting(p: Player): Outgoing {
    return { to: p.id, msg: { t: 'crafting', queue: clone(p.queue) } };
  }

  /** Reach is measured from the player's eyes to the nearest point of the box. */
  private inReach(p: Player, b: Box): boolean {
    const eye = [p.x, p.y + PLAYER_HEIGHT * 0.9, p.z];
    const d = eye.map((v, a) => Math.max(b.min[a] - v, 0, v - b.max[a]));
    return Math.hypot(d[0], d[1], d[2]) <= BUILD_RANGE + 0.5;
  }
}

function publicState(p: Player): PlayerState {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: p.yaw,
    moving: p.moving,
    held: p.dead ? null : (p.slots[p.active]?.item ?? null),
    dead: p.dead,
    wear: p.wear.map((s) => s?.item ?? null),
  };
}

/** Like Rust, everyone starts with a rock. A building plan comes free too, so you can build at once. */
function starterSlots(): Slots {
  const slots = emptySlots(INVENTORY_SIZE);
  addItem(slots, 'rock', 1);
  addItem(slots, 'buildingPlan', 1);
  return slots;
}

/** Adds a whole stack, keeping its durability and loaded ammo. */
function addStack(slots: Slots, s: Stack) {
  if (ITEMS[s.item].stack > 1) return addItem(slots, s.item, s.count);
  const free = slots.findIndex((x) => !x);
  if (free >= 0) slots[free] = { ...s };
}

function furnaceHasRoom(d: Deployable, item: ItemId): boolean {
  return FURNACE_OUTPUT_SLOTS.some((i) => !d.slots[i] || (d.slots[i]!.item === item && d.slots[i]!.count < ITEMS[item].stack));
}

function furnaceOutput(d: Deployable, item: ItemId) {
  const same = FURNACE_OUTPUT_SLOTS.find((i) => d.slots[i]?.item === item && d.slots[i]!.count < ITEMS[item].stack);
  if (same !== undefined) d.slots[same]!.count += 1;
  else {
    const free = FURNACE_OUTPUT_SLOTS.find((i) => !d.slots[i]);
    if (free !== undefined) d.slots[free] = { item, count: 1 };
  }
}

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) && v.some((n) => n !== 0);
}

function notice(id: number, text: string): Outgoing {
  return { to: id, msg: { t: 'notice', text } };
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function isBeltSlot(slot: unknown): slot is number {
  return Number.isInteger(slot) && (slot as number) >= 0 && (slot as number) < BELT_SIZE;
}

function validIndex(slots: Slots, i: unknown): i is number {
  return Number.isInteger(i) && (i as number) >= 0 && (i as number) < slots.length;
}

function cleanName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/[^\w \-]/g, '').trim().slice(0, 16) : '';
}

export function playerBox(p: Pick<PlayerState, 'x' | 'y' | 'z'>): Box {
  return {
    min: [p.x - PLAYER_RADIUS, p.y, p.z - PLAYER_RADIUS],
    max: [p.x + PLAYER_RADIUS, p.y + PLAYER_HEIGHT, p.z + PLAYER_RADIUS],
  };
}

