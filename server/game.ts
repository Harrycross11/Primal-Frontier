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
import type { CraftJob, DeathCause, PlayerState, ServerMessage, SlotRef } from '../shared/protocol.ts';
import { mulberry32, terrainHeight } from '../shared/terrain.ts';
import { cleanLook } from '../shared/look.ts';
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
  type ConsumeInfo,
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
import { BARREL_DRINK, RESOURCE_INFO, WRECK_LOOT, generateResources, type Material, type ResourceNode } from '../shared/world.ts';
import { CORE_RADIUS, biomeAt, climateAt } from '../shared/biomes.ts';
import { daylight, stormClimate, weatherAt } from '../shared/sky.ts';
import { ASHHOUND, PACK_SIZE, clearOfRuins, packDens, rayCreature, yawTowards } from '../shared/creatures.ts';
import { blocked, houndState, newHound, spread, steer, turnTo, type Hound, type Prey, type SavedHound } from './wildlife.ts';
import {
  MAX_FOOD,
  MAX_WATER,
  SPAWN_FOOD,
  SPAWN_WATER,
  radiationAt,
  tickVitals,
  type Vitals,
} from '../shared/survival.ts';

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
  lastEatAt: number;
  /** Hunger, thirst and radiation poisoning. */
  vitals: Vitals;
  /** The vitals last sent to the player, rounded, so updates only go out when something shows a change. */
  sentVitals: string;
  /** Health last sent, rounded, for the same reason. */
  sentHp: number;
  /** Wild hounds leave a survivor alone until this time (ms), just after they wake up. */
  safeUntil: number;
}

/** What is kept of a survivor while they are offline, so they come back as they left. */
interface Sleeper {
  id: number;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  hp: number;
  dead: boolean;
  slots: Slots;
  wear: Slots;
  vitals: Vitals;
}

/** Everything needed to bring a world back after the server restarts. Times are kept as ms left. */
export interface WorldSave {
  version: 2;
  seed: number;
  /** When this world began (ms since 1970), for the wipe. */
  startedAt: number;
  nextId: number;
  nextDeployableId: number;
  pieces: Piece[];
  deployables: Deployable[];
  /** Units left in each resource node, by id. */
  resources: number[];
  respawns: { id: number; in: number }[];
  furnaces: [number, FurnaceTimers][];
  /** Seconds left on each loot bag. */
  bags: [number, number][];
  /** Every survivor, online or not, by the private token their browser keeps. */
  survivors: [string, Sleeper][];
  /** Tame hounds (wild ones are born afresh). */
  hounds?: SavedHound[];
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
/** Seconds after waking up before wild hounds will go for you. */
const SAFE_SECONDS = 20;
/** Seconds a tame hound remembers who just fought its owner. */
const FEUD_SECONDS = 10;

export class Game {
  readonly seed: number;
  readonly resources: ResourceNode[];
  readonly pieces = new Map<string, Piece>();
  readonly deployables = new Map<number, Deployable>();
  readonly players = new Map<number, Player>();
  /** When this world began, for the wipe. */
  startedAt = 0;
  /** Survivors who are offline, by their token, and the token of each one online. */
  private sleepers = new Map<string, Sleeper>();
  private tokens = new Map<number, string>();
  private nextId = 1;
  private nextDeployableId = 1;
  private respawns: { id: number; at: number }[] = [];
  private furnaces = new Map<number, FurnaceTimers>();
  /** Seconds until each loot bag disappears. */
  private bagExpiry = new Map<number, number>();
  private lastTick = -1;
  private rand: () => number;
  /** Where everyone spawns, instead of a random spot (for screenshots). */
  spawnAt: [number, number] | null = null;
  /** Separate from `rand`, so finding loot never moves spawn points. */
  private lootRand: () => number;
  readonly hounds = new Map<number, Hound>();
  private nextHoundId = 1;
  /** Hounds still to be born into each pack, and when. */
  private litters: { pack: number; at: number }[] = [];
  /** Who last hurt each player, and whom each player last hurt, so tame hounds join the fight. */
  private hurtBy = new Map<number, { prey: Prey; at: number }>();
  private hurt = new Map<number, { prey: Prey; at: number }>();
  /** Turned off for tests that need an empty map; the packs are born on the first tick. */
  wildlife = true;
  private wildlifeStarted = false;
  /** Separate again, so the hounds' wandering never changes loot or spawns. */
  private houndRand: () => number;

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
    this.lootRand = mulberry32(seed ^ 0x2545f491);
    this.houndRand = mulberry32(seed ^ 0x3c6ef372);
  }

  /** Adds a player at a random spawn point. Returns null when the server is full. */
  /**
   * Adds a player. A `token` their browser kept from before brings back the survivor it was:
   * where they were, what they carried and wore, and how hurt, hungry and thirsty they were.
   * Returns null when the server is full.
   */
  join(name: string, now: number, look: unknown = null, token: unknown = null): { id: number; out: Outgoing[] } | null {
    if (this.players.size >= MAX_PLAYERS) return null;
    // A second tab with the same token plays as somebody new rather than the same survivor twice.
    const key = cleanToken(token) && ![...this.tokens.values()].includes(cleanToken(token)!) ? cleanToken(token) : null;
    const back = key ? this.sleepers.get(key) : undefined;
    if (key) this.sleepers.delete(key);
    const id = back?.id ?? this.nextId++;
    if (key) this.tokens.set(id, key);
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
      look: cleanLook(look),
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
      lastEatAt: -Infinity,
      vitals: { food: SPAWN_FOOD, water: SPAWN_WATER, rads: 0 },
      sentVitals: '',
      sentHp: MAX_HEALTH,
      queue: [],
      craftBlocked: false,
      lastMoveAt: now,
      lastGatherAt: 0,
      safeUntil: now + SAFE_SECONDS * 1000,
    };
    if (back && !back.dead && back.hp > 0) {
      Object.assign(player, { x: back.x, y: back.y, z: back.z, yaw: back.yaw, hp: back.hp, sentHp: back.hp, slots: back.slots, wear: back.wear, vitals: back.vitals });
      if (!cleanName(name)) player.name = back.name;
    }
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
            now,
            you: pub,
            players: [...this.players.values()].filter((p) => p.id !== id).map(publicState),
            creatures: this.creatures(),
            resources: this.resources,
            pieces: [...this.pieces.values()],
            deployables: [...this.deployables.values()],
            slots: clone(player.slots),
            wear: clone(player.wear),
            hp: player.hp,
            vitals: { ...player.vitals },
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
    const key = this.tokens.get(id);
    if (key) {
      this.tokens.delete(id);
      this.sleepers.set(key, sleeper(p));
    }
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
    if (node.kind === 'waterBarrel') return this.drink(p, node, now);
    const room = roomFor(p.slots, info.yields);
    if (room === 0) return [notice(id, 'Your inventory is full')];
    got = Math.min(got, room);
    p.lastGatherAt = now;
    node.amount -= got;
    addItem(p.slots, info.yields, got);
    const out: Outgoing[] = [{ to: 'all', msg: { t: 'resource', id: node.id, amount: node.amount, by: id } }];
    if (held && tool && info.tool !== 'pickup') {
      held.hp = (held.hp ?? tool.durability) - 1;
      if (held.hp <= 0) {
        p.slots[slot] = null;
        out.push(notice(id, `Your ${ITEMS[held.item].name} broke`));
      }
    }
    if (node.kind === 'scrap') {
      // Rummaging through a wreck sometimes turns up something to eat or drink.
      for (const [item, chance] of Object.entries(WRECK_LOOT) as [ItemId, number][]) {
        if (this.lootRand() < chance && roomFor(p.slots, item) > 0) {
          addItem(p.slots, item, 1);
          out.push(notice(id, `Found ${ITEMS[item].name.toLowerCase()} in the wreck`));
        }
      }
    }
    if (node.amount === 0 && info.respawn > 0) this.respawns.push({ id: node.id, at: now + info.respawn * 1000 });
    out.push(this.inventory(p));
    return out;
  }

  /** A few gulps from a rain barrel, if you are thirsty. */
  private drink(p: Player, node: ResourceNode, now: number): Outgoing[] {
    if (p.vitals.water >= MAX_WATER - 1) return [notice(p.id, 'You are not thirsty')];
    p.lastGatherAt = now;
    const gulp = Math.min(BARREL_DRINK, node.amount, MAX_WATER - p.vitals.water);
    p.vitals.water += gulp;
    // Barrels give out in whole drinks, so a sip still costs one.
    node.amount = Math.max(0, node.amount - RESOURCE_INFO.waterBarrel.perHit);
    if (node.amount === 0) this.respawns.push({ id: node.id, at: now + RESOURCE_INFO.waterBarrel.respawn * 1000 });
    return [{ to: 'all', msg: { t: 'resource', id: node.id, amount: node.amount, by: p.id } }, this.vitalsMsg(p, true)!];
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
    const bites = new Map<Hound, { amount: number; head: boolean }>();
    for (let n = 0; n < (w.pellets ?? 1); n++) {
      const pd = spreadDir(d, cone, this.rand);
      const hit = this.trace(p, from, pd, w.range);
      ends.push([from[0] + pd[0] * hit.t, from[1] + pd[1] * hit.t, from[2] + pd[2] * hit.t]);
      if (hit.hound) {
        const sum = bites.get(hit.hound) ?? { amount: 0, head: false };
        sum.amount += w.damage * falloff(hit.t, w.range) * (hit.head ? HEADSHOT : 1);
        sum.head ||= hit.head;
        bites.set(hit.hound, sum);
      }
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
    for (const [hound, { amount, head }] of bites) out.push(...this.hurtHound(hound, amount, { kind: 'player', id: p.id }, now, head));
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
    if (hit.hound) {
      const out = this.wear(p, slot);
      out.push(...this.hurtHound(hit.hound, w.damage * (hit.head ? 1.5 : 1), { kind: 'player', id: p.id }, now, hit.head));
      if (stack) out.push(this.inventory(p));
      return out;
    }
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
    if (stack?.item === 'cookedMeat') {
      const fed = this.feed(p, slot, now);
      if (fed) return fed;
    }
    const consume = stack ? ITEMS[stack.item].consume : undefined;
    if (stack && consume) return this.consume(p, slot, consume, now);
    const heal = stack ? ITEMS[stack.item].heal : undefined;
    if (!stack || !heal) return [];
    if ((now - p.lastHealAt) / 1000 < HEAL_COOLDOWN) return [];
    if (p.hp >= MAX_HEALTH) return [notice(id, 'You are already at full health')];
    p.lastHealAt = now;
    p.hp = Math.min(MAX_HEALTH, p.hp + heal);
    stack.count -= 1;
    if (stack.count === 0) p.slots[slot] = null;
    p.sentHp = Math.round(p.hp);
    return [this.inventory(p), { to: id, msg: { t: 'health', hp: p.sentHp } }];
  }

  /** Eats, drinks or swallows the item in a belt slot. */
  private consume(p: Player, slot: number, c: ConsumeInfo, now: number): Outgoing[] {
    if (now - p.lastEatAt < 600) return [];
    const v = p.vitals;
    const helps = (c.food && v.food < MAX_FOOD - 1) || (c.water && v.water < MAX_WATER - 1) || (c.rads && v.rads > 0);
    if (!helps) return [notice(p.id, c.rads ? 'You have no radiation poisoning' : c.food ? 'You are full' : 'You are not thirsty')];
    p.lastEatAt = now;
    v.food = Math.min(MAX_FOOD, v.food + (c.food ?? 0));
    v.water = Math.min(MAX_WATER, v.water + (c.water ?? 0));
    v.rads = Math.max(0, v.rads - (c.rads ?? 0));
    const stack = p.slots[slot]!;
    stack.count -= 1;
    if (stack.count === 0) p.slots[slot] = null;
    return [this.inventory(p), this.vitalsMsg(p, true)!];
  }

  /** The player's vitals, if they changed enough to show (or always, with `force`). */
  private vitalsMsg(p: Player, force = false): Outgoing | null {
    const v = p.vitals;
    const level = radiationAt(this.seed, p.x, p.z) * (1 - Math.min(0.9, radProtection(p)));
    const msg = { t: 'vitals' as const, food: Math.round(v.food), water: Math.round(v.water), rads: Math.round(v.rads), level: Math.round(level * 10) / 10 };
    const key = `${msg.food},${msg.water},${msg.rads},${msg.level}`;
    if (!force && key === p.sentVitals) return null;
    p.sentVitals = key;
    return { to: p.id, msg };
  }

  /** Hunger, thirst and radiation for everyone alive: drains, damage, healing and deaths. */
  private tickSurvival(p: Player, dt: number, now: number): Outgoing[] {
    if (p.dead || dt <= 0) return [];
    const level = radiationAt(this.seed, p.x, p.z);
    const land = climateAt(this.seed, p.x, p.z);
    const storm = stormClimate(weatherAt(this.seed, p.x, p.z, now));
    const climate = { hunger: land.hunger * storm.hunger, thirst: land.thirst * storm.thirst };
    const { hp, cause } = tickVitals(p.vitals, dt, p.moving, level, radProtection(p), p.hp, MAX_HEALTH, climate);
    p.hp = Math.max(0, Math.min(MAX_HEALTH, p.hp + hp));
    const out: Outgoing[] = [];
    const vitals = this.vitalsMsg(p);
    if (vitals) out.push(vitals);
    if (p.hp <= 0) return [...out, ...this.kill(p, null, null, false, cause ?? undefined)];
    if (Math.round(p.hp) !== p.sentHp) {
      p.sentHp = Math.round(p.hp);
      out.push({ to: p.id, msg: { t: 'health', hp: p.sentHp } });
    }
    return out;
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
    p.sentHp = MAX_HEALTH;
    p.vitals = { food: SPAWN_FOOD, water: SPAWN_WATER, rads: 0 };
    p.slots = starterSlots();
    p.wear = emptySlots(ARMOUR_SLOTS.length);
    p.active = 0;
    p.reloadUntil = 0;
    p.safeUntil = Math.max(0, this.lastTick) + SAFE_SECONDS * 1000;
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
  private trace(shooter: Player, o: Vec3, d: Vec3, range: number): { t: number; player?: Player; hound?: Hound; head: boolean; zone: ArmourSlot } {
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
    let best: { t: number; player?: Player; hound?: Hound; head: boolean; zone: ArmourSlot } = { t, head: false, zone: 'chest' };
    for (const other of this.players.values()) {
      if (other === shooter || other.dead) continue;
      const hit = rayPlayer(o, d, other, best.t);
      if (hit) best = { t: hit.t, player: other, head: hit.head, zone: hit.zone };
    }
    for (const h of this.hounds.values()) {
      if (h.deadAt) continue;
      const hit = rayCreature(o, d, h, best.t);
      if (hit) best = { t: hit.t, hound: h, head: hit.head, zone: 'chest' };
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
    const now = Math.max(0, this.lastTick);
    this.hurtBy.set(victim.id, { prey: { kind: 'player', id: by.id }, at: now });
    this.hurt.set(by.id, { prey: { kind: 'player', id: victim.id }, at: now });
    victim.hp = Math.max(0, victim.hp - amount);
    victim.sentHp = Math.round(victim.hp);
    const kill = victim.hp <= 0;
    const armour = [...zones].some((z) => victim.wear[ARMOUR_SLOTS.indexOf(z)]);
    const out: Outgoing[] = [
      { to: by.id, msg: { t: 'hitmarker', head, kill, armour } },
      { to: victim.id, msg: { t: 'health', hp: Math.round(victim.hp), from: [by.x, by.y, by.z], armour } },
    ];
    if (kill) return [...out, ...this.kill(victim, by, item, head)];
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
  /** `killer` names who did it when it was not a player (somebody's tame hound). */
  private kill(victim: Player, by: Player | null, item: ItemId | null, head = false, cause?: DeathCause, killer?: string): Outgoing[] {
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
    out.push(
      { to: victim.id, msg: { t: 'died', by: by?.name ?? killer ?? null, item, ...(cause && { cause }) } },
      this.inventory(victim),
      this.crafting(victim),
      { to: 'all', msg: { t: 'kill', killer: by?.name ?? killer ?? null, victim: victim.name, item: by ? item : null, head, ...(cause && { cause }) } },
    );
    return out;
  }

  /** A random spot to wake up in the Ashlands, away from the radiation zones. */
  private spawnPoint(): [number, number] {
    if (this.spawnAt) return [...this.spawnAt];
    let spot: [number, number] = [0, 0];
    for (let tries = 0; tries < 30; tries++) {
      const a = this.rand() * Math.PI * 2;
      const r = Math.sqrt(this.rand()) * CORE_RADIUS * 0.8;
      spot = [Math.cos(a) * r, Math.sin(a) * r];
      if (radiationAt(this.seed, spot[0], spot[1]) === 0 && biomeAt(this.seed, spot[0], spot[1]) === 'ashlands') break;
    }
    return spot;
  }

  /** A player who is connected and not dead. */
  private alive(id: number): Player | undefined {
    const p = this.players.get(id);
    return p && !p.dead ? p : undefined;
  }

  /** Everything needed to bring this world back, as of `now`. */
  save(now: number): WorldSave {
    const survivors = new Map(this.sleepers);
    for (const [id, key] of this.tokens) {
      const p = this.players.get(id);
      if (p) survivors.set(key, sleeper(p));
    }
    return clone({
      version: 2,
      seed: this.seed,
      startedAt: this.startedAt,
      nextId: this.nextId,
      nextDeployableId: this.nextDeployableId,
      pieces: [...this.pieces.values()],
      deployables: [...this.deployables.values()],
      resources: this.resources.map((r) => r.amount),
      respawns: this.respawns.map((r) => ({ id: r.id, in: Math.max(0, r.at - now) })),
      furnaces: [...this.furnaces],
      bags: [...this.bagExpiry],
      survivors: [...survivors],
      hounds: [...this.hounds.values()]
        .filter((h) => h.owner !== null && !h.deadAt)
        .map((h) => ({ x: h.x, y: h.y, z: h.z, yaw: h.yaw, hp: h.hp, owner: h.owner!, name: h.name ?? 'Ashhound' })),
    });
  }

  /** A world brought back from a save, with its clock running from `now`. */
  static restore(save: WorldSave, now: number, startKit: number | Partial<Record<ItemId, number>> = 0): Game {
    const game = new Game(save.seed, startKit);
    game.startedAt = save.startedAt;
    game.nextId = save.nextId;
    game.nextDeployableId = save.nextDeployableId;
    for (const piece of save.pieces) game.pieces.set(pieceKey(piece), piece);
    for (const d of save.deployables) game.deployables.set(d.id, d);
    save.resources.forEach((amount, i) => {
      if (game.resources[i]) game.resources[i].amount = amount;
    });
    game.respawns = save.respawns.map((r) => ({ id: r.id, at: now + r.in }));
    game.furnaces = new Map(save.furnaces);
    game.bagExpiry = new Map(save.bags);
    game.sleepers = new Map(save.survivors);
    for (const saved of save.hounds ?? []) {
      const h = newHound(game.nextHoundId++, -1, saved.x, saved.z, game.seed, saved.yaw);
      Object.assign(h, { hp: saved.hp, owner: saved.owner, name: saved.name });
      game.hounds.set(h.id, h);
    }
    return game;
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
    for (const p of this.players.values()) out.push(...this.tickCrafting(p, dt), ...this.tickSurvival(p, dt, now));
    for (const d of this.deployables.values()) if (d.kind === 'furnace' && d.on && this.tickFurnace(d, dt)) out.push({ to: 'all', msg: { t: 'deployable', id: d.id, d, by: 0 } });
    for (const [bag, left] of this.bagExpiry) {
      if (left - dt > 0) this.bagExpiry.set(bag, left - dt);
      else out.push(...this.removeDeployable(bag));
    }
    out.push(...this.tickWildlife(now, dt));
    if (this.players.size > 0) {
      out.push({ to: 'all', msg: { t: 'state', players: [...this.players.values()].map(publicState), creatures: this.creatures() } });
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
    return [this.inventory(p), this.crafting(p), { to: p.id, msg: { t: 'crafted', item: job.item, count: recipe.count } }];
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

  /** Every hound alive or lying dead, as everyone is told about them. */
  private creatures() {
    return [...this.hounds.values()].map(houndState);
  }

  /** The hounds a survivor has tamed and still has. */
  private pets(owner: number): Hound[] {
    return [...this.hounds.values()].filter((h) => h.owner === owner && !h.deadAt);
  }

  /**
   * Holding out cooked meat to a hound within reach: a wild one takes it and calms down
   * towards you, and is yours after enough of it; your own one is healed by it. Returns
   * null when no hound is near (or yours is already healthy), so you eat it yourself.
   */
  private feed(p: Player, slot: number, now: number): Outgoing[] | null {
    let best: Hound | null = null;
    let bestD: number = ASHHOUND.feedRange;
    for (const h of this.hounds.values()) {
      if (h.deadAt || (h.owner !== null && h.owner !== p.id) || Math.abs(h.y - p.y) > 1.5) continue;
      const d = Math.hypot(h.x - p.x, h.z - p.z);
      if (d < bestD) [best, bestD] = [h, d];
    }
    if (!best) return null;
    const h = best;
    // Busy biting or eating: it takes the meat once it is done.
    if (now < h.animUntil) return [];
    if (h.owner === p.id && h.hp >= ASHHOUND.maxHp - 1) return null;
    const stack = p.slots[slot]!;
    if (h.owner === null && this.pets(p.id).length >= ASHHOUND.maxPets) {
      return [notice(p.id, `You can only keep ${ASHHOUND.maxPets} hounds at a time`)];
    }
    stack.count -= 1;
    if (stack.count === 0) p.slots[slot] = null;
    h.anim = 'eat';
    h.animUntil = now + 1800;
    turnTo(h, yawTowards(h.x, h.z, p.x, p.z), 10);
    const out: Outgoing[] = [this.inventory(p)];
    if (h.owner === p.id) {
      h.hp = Math.min(ASHHOUND.maxHp, h.hp + 45);
      out.push(notice(p.id, 'Your hound wolfs down the meat'));
      return out;
    }
    if (h.fedBy !== p.id) h.fed = 0;
    h.fedBy = p.id;
    h.fed += 1;
    h.calmUntil = now + ASHHOUND.calm * 1000;
    if (h.target?.kind === 'player' && h.target.id === p.id) h.target = null;
    if (h.fed < ASHHOUND.tameFeeds) {
      out.push(notice(p.id, `The Ashhound snatches the meat (${h.fed}/${ASHHOUND.tameFeeds}). Feed it again to tame it`));
      return out;
    }
    // Tamed: it leaves its pack, which in time raises another pup to fill the gap.
    this.litters.push({ pack: h.pack, at: now + ASHHOUND.respawn * 1000 });
    Object.assign(h, { owner: p.id, name: `${p.name}'s Ashhound`, pack: -1, target: null, hp: ASHHOUND.maxHp, fed: 0, fedBy: null, fleeUntil: 0 });
    out.push(notice(p.id, 'The Ashhound is yours. It follows you and fights for you'));
    return out;
  }

  /** A shot, swing or bite landing on a hound. */
  private hurtHound(h: Hound, amount: number, by: Prey, now: number, head = false): Outgoing[] {
    if (h.deadAt) return [];
    h.hp = Math.max(0, h.hp - amount);
    const shooter = by.kind === 'player' ? this.players.get(by.id) : undefined;
    const out: Outgoing[] = [];
    if (shooter) {
      this.hurt.set(shooter.id, { prey: { kind: 'hound', id: h.id }, at: now });
      out.push({ to: shooter.id, msg: { t: 'hitmarker', head, kill: h.hp <= 0 } });
    }
    if (h.hp <= 0) return [...out, ...this.houndDies(h, now)];
    if (now >= h.animUntil || h.anim !== 'attack') {
      h.anim = 'hit';
      h.animUntil = now + 350;
    }
    // Hurt, it turns on whoever did it, unless that is its own master.
    const own = by.kind === 'player' && by.id === h.owner;
    if (!own && !(by.kind === 'hound' && by.id === h.id)) {
      h.target = by;
      h.calmUntil = 0;
      if (h.owner === null) this.alertPack(h, by);
    }
    if (h.owner === null && h.hp < ASHHOUND.maxHp * ASHHOUND.flee && h.fleeUntil < now - 20000) {
      const from = this.preyAt(by);
      h.fleeFrom = from ? [from.x, from.z] : [h.x, h.z];
      h.fleeUntil = now + 5000;
    }
    return out;
  }

  /** A dead hound leaves its meat in a bag, and its pack raises another in time. */
  private houndDies(h: Hound, now: number): Outgoing[] {
    h.deadAt = now;
    h.anim = 'dead';
    h.target = null;
    const out: Outgoing[] = [];
    if (h.owner === null) this.litters.push({ pack: h.pack, at: now + ASHHOUND.respawn * 1000 });
    else if (this.players.has(h.owner)) out.push(notice(h.owner, 'Your Ashhound was killed'));
    const [lo, hi] = ASHHOUND.meat;
    const bag = newDeployable(this.nextDeployableId++, 'lootBag', h.x, h.y, h.z, h.yaw, 0);
    bag.slots = emptySlots(6);
    addItem(bag.slots, 'rawMeat', lo + Math.floor(this.houndRand() * (hi - lo + 1)));
    bag.label = 'Ashhound';
    this.deployables.set(bag.id, bag);
    this.bagExpiry.set(bag.id, LOOT_BAG_SECONDS);
    out.push({ to: 'all', msg: { t: 'deployable', id: bag.id, d: bag, by: 0 } });
    return out;
  }

  /** The rest of a wild pack nearby joins a fight one of them is in. */
  private alertPack(h: Hound, prey: Prey) {
    for (const o of this.hounds.values()) {
      if (o !== h && o.pack === h.pack && o.owner === null && !o.deadAt && !o.target && Math.hypot(o.x - h.x, o.z - h.z) < 25) o.target = prey;
    }
  }

  /** Where someone a hound is after is, if they are still there to be chased. */
  private preyAt(prey: Prey): { x: number; y: number; z: number } | null {
    if (prey.kind === 'player') {
      const p = this.players.get(prey.id);
      return p && !p.dead ? p : null;
    }
    const h = this.hounds.get(prey.id);
    return h && !h.deadAt ? h : null;
  }

  /** The packs are born on the first tick, each round its den. */
  private startWildlife(now: number) {
    this.wildlifeStarted = true;
    packDens(this.seed).forEach((_, pack) => {
      for (let n = 0; n < PACK_SIZE; n++) this.litters.push({ pack, at: now });
    });
  }

  private tickWildlife(now: number, dt: number): Outgoing[] {
    if (!this.wildlife) return [];
    if (!this.wildlifeStarted) this.startWildlife(now);
    const dens = packDens(this.seed);
    this.litters = this.litters.filter((l) => {
      if (l.at > now) return true;
      const [dx, dz] = dens[l.pack];
      const a = this.houndRand() * Math.PI * 2;
      const r = 1 + this.houndRand() * 5;
      const h = newHound(this.nextHoundId++, l.pack, dx + Math.cos(a) * r, dz + Math.sin(a) * r, this.seed, this.houndRand() * Math.PI * 2);
      this.hounds.set(h.id, h);
      return false;
    });
    if (dt <= 0) return [];
    const out: Outgoing[] = [];
    for (const h of this.hounds.values()) {
      if (h.deadAt) {
        if (now - h.deadAt > ASHHOUND.corpse * 1000) this.hounds.delete(h.id);
        continue;
      }
      out.push(...(h.owner === null ? this.tickWild(h, dens[h.pack], now, dt) : this.tickTame(h, now, dt)));
    }
    spread([...this.hounds.values()]);
    for (const h of this.hounds.values()) if (!h.deadAt) h.y = terrainHeight(this.seed, h.x, h.z);
    return out;
  }

  private tickWild(h: Hound, den: [number, number], now: number, dt: number): Outgoing[] {
    if (h.fed > 0 && now > h.calmUntil + 30000) [h.fed, h.fedBy] = [0, null];
    if (now < h.fleeUntil && h.fleeFrom) {
      const [fx, fz] = h.fleeFrom;
      const away = Math.hypot(h.x - fx, h.z - fz) || 1;
      this.go(h, h.x + ((h.x - fx) / away) * 10, h.z + ((h.z - fz) / away) * 10, ASHHOUND.run, now, dt, 0);
      return [];
    }
    // Let go of someone who got away, died, or has been feeding it meat.
    const at = h.target && this.preyAt(h.target);
    const calm = (prey: Prey) => prey.kind === 'player' && prey.id === h.fedBy && now < h.calmUntil;
    if (h.target && (!at || Math.hypot(at.x - den[0], at.z - den[1]) > ASHHOUND.leash || Math.hypot(at.x - h.x, at.z - h.z) > ASHHOUND.sight * 2 || calm(h.target))) {
      h.target = null;
    }
    if (!h.target) {
      // The nearest survivor close enough to notice (and not just woken up). Tame hounds are
      // left alone unless they start a fight.
      let best: Prey | null = null;
      // Packs hunt further afield in the dark.
      let bestD: number = ASHHOUND.sight * (1 + 0.5 * (1 - daylight(now)));
      for (const p of this.players.values()) {
        if (p.dead || now < p.safeUntil || calm({ kind: 'player', id: p.id })) continue;
        const d = Math.hypot(p.x - h.x, p.z - h.z);
        if (d < bestD && Math.hypot(p.x - den[0], p.z - den[1]) < ASHHOUND.leash) [best, bestD] = [{ kind: 'player', id: p.id }, d];
      }
      if (best) {
        h.target = best;
        this.alertPack(h, best);
      }
    }
    if (h.target) return this.hunt(h, now, dt);
    if (h.hp < ASHHOUND.maxHp) h.hp = Math.min(ASHHOUND.maxHp, h.hp + dt);
    // Nothing to chase: amble about near the den, resting between walks.
    if (now < h.restUntil) {
      this.go(h, h.x, h.z, 0, now, dt, 0);
      return [];
    }
    if (!h.wanderTo) {
      const a = this.houndRand() * Math.PI * 2;
      const r = 2 + this.houndRand() * 10;
      const to: [number, number] = [den[0] + Math.cos(a) * r, den[1] + Math.sin(a) * r];
      if (!clearOfRuins(this.seed, to[0], to[1])) {
        h.restUntil = now + 1000;
        return [];
      }
      h.wanderTo = to;
    }
    const [wx, wz] = h.wanderTo;
    this.go(h, wx, wz, ASHHOUND.walk, now, dt, 0);
    // There, or stuck against something: rest a while, then pick somewhere else.
    if (Math.hypot(wx - h.x, wz - h.z) < 0.5 || h.anim === 'idle') {
      h.wanderTo = null;
      h.restUntil = now + 3000 + this.houndRand() * 7000;
    }
    return [];
  }

  /** A tame hound keeps near its owner and goes for anyone fighting them. */
  private tickTame(h: Hound, now: number, dt: number): Outgoing[] {
    const owner = this.players.get(h.owner!);
    if (h.hp < ASHHOUND.maxHp) h.hp = Math.min(ASHHOUND.maxHp, h.hp + dt * 0.5);
    if (!owner || owner.dead) {
      h.target = null;
      this.go(h, h.x, h.z, 0, now, dt, 0);
      return [];
    }
    const at = h.target && this.preyAt(h.target);
    if (h.target && (!at || Math.hypot(at.x - owner.x, at.z - owner.z) > 30)) h.target = null;
    if (!h.target) {
      for (const feud of [this.hurtBy.get(owner.id), this.hurt.get(owner.id)]) {
        if (!feud || now - feud.at > FEUD_SECONDS * 1000) continue;
        const prey = feud.prey;
        const mine = prey.kind === 'hound' ? this.hounds.get(prey.id)?.owner === owner.id : prey.id === owner.id;
        if (!mine && this.preyAt(prey)) h.target = prey;
      }
    }
    if (!h.target) {
      // Wild hounds that come for its owner.
      for (const o of this.hounds.values()) {
        if (o.owner === null && !o.deadAt && o.target?.kind === 'player' && o.target.id === owner.id && Math.hypot(o.x - h.x, o.z - h.z) < ASHHOUND.sight) {
          h.target = { kind: 'hound', id: o.id };
        }
      }
    }
    if (h.target) return this.hunt(h, now, dt);
    const d = Math.hypot(owner.x - h.x, owner.z - h.z);
    if (d > 40) {
      // Left far behind: it catches up the way a dog finds its way home.
      const a = this.houndRand() * Math.PI * 2;
      h.x = owner.x + Math.cos(a) * 3;
      h.z = owner.z + Math.sin(a) * 3;
      h.y = terrainHeight(this.seed, h.x, h.z);
      if (blocked(this.pieces.values(), h.x, h.y, h.z)) [h.x, h.y, h.z] = [owner.x, owner.y, owner.z];
    }
    this.go(h, owner.x, owner.z, d > 7 ? ASHHOUND.run : d > 3 ? ASHHOUND.walk * 2 : 0, now, dt, 2.2);
    return [];
  }

  /** Runs at its target and bites when close. */
  private hunt(h: Hound, now: number, dt: number): Outgoing[] {
    const at = this.preyAt(h.target!)!;
    const d = Math.hypot(at.x - h.x, at.z - h.z);
    if (d > ASHHOUND.biteRange || Math.abs(at.y - h.y) > 1.3) {
      this.go(h, at.x, at.z, ASHHOUND.run, now, dt, ASHHOUND.biteRange * 0.7);
      return [];
    }
    turnTo(h, yawTowards(h.x, h.z, at.x, at.z), dt);
    if (now < h.nextBiteAt) {
      this.go(h, h.x, h.z, 0, now, dt, 0);
      if (h.anim === 'idle') h.anim = 'snarl';
      return [];
    }
    h.nextBiteAt = now + ASHHOUND.biteEvery * 1000;
    h.anim = 'attack';
    h.animUntil = now + 900;
    const by: Prey = { kind: 'hound', id: h.id };
    if (h.target!.kind === 'hound') return this.hurtHound(this.hounds.get(h.target!.id)!, ASHHOUND.bite, by, now);
    return this.bite(this.players.get(h.target!.id)!, h, now);
  }

  /** A hound's bite on a survivor: mostly the legs, through whatever armour is there. */
  private bite(p: Player, h: Hound, now: number): Outgoing[] {
    const zone: ArmourSlot = this.houndRand() < 0.6 ? 'legs' : 'chest';
    p.hp = Math.max(0, p.hp - ASHHOUND.bite * armourFactor(p.wear, zone));
    p.sentHp = Math.round(p.hp);
    if (h.owner !== null) this.hurt.set(h.owner, { prey: { kind: 'player', id: p.id }, at: now });
    this.hurtBy.set(p.id, { prey: { kind: 'hound', id: h.id }, at: now });
    const armour = !!p.wear[ARMOUR_SLOTS.indexOf(zone)];
    const out: Outgoing[] = [{ to: p.id, msg: { t: 'health', hp: p.sentHp, from: [h.x, h.y + 0.6, h.z], armour } }];
    if (p.hp <= 0) return [...out, ...this.kill(p, null, null, false, h.owner === null ? 'ashhound' : undefined, h.name ?? undefined)];
    if (armour) out.push(...this.wearArmour(p, new Set([zone])));
    return out;
  }

  /** Steps towards a spot (or stands, at speed 0) and picks the animation to match. */
  private go(h: Hound, tx: number, tz: number, speed: number, now: number, dt: number, stop: number) {
    // Busy biting, flinching or eating: it stands where it is until done.
    const busy = now < h.animUntil;
    const moved = speed > 0 && !busy ? steer(h, tx, tz, speed, dt, stop, this.seed, this.pieces) : 0;
    if (!busy) h.anim = moved / dt > 3.5 ? 'run' : moved / dt > 0.2 ? 'walk' : 'idle';
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

/** How much radiation a player's worn armour keeps out, 0 to 1. */
function radProtection(p: Player): number {
  return p.wear.reduce((sum, s) => sum + (s ? (ITEMS[s.item].armour?.radiation ?? 0) : 0), 0);
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
    look: p.look,
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

/** A browser's private token: long and random, so nobody can guess another player's. */
function cleanToken(token: unknown): string | null {
  return typeof token === 'string' && /^[\w-]{16,64}$/.test(token) ? token : null;
}

function sleeper(p: Player): Sleeper {
  return clone({ id: p.id, name: p.name, x: p.x, y: p.y, z: p.z, yaw: p.yaw, hp: p.hp, dead: p.dead, slots: p.slots, wear: p.wear, vitals: p.vitals });
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

