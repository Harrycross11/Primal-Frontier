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
  PLAYER_SPEED,
  PLAYER_SPRINT,
  WORKBENCH_RANGE,
} from '../shared/constants.ts';
import type { CraftJob, DeathCause, PlayerState, ServerMessage, SlotRef } from '../shared/protocol.ts';
import { mulberry32, terrainHeight } from '../shared/terrain.ts';
import { cleanLook } from '../shared/look.ts';
import {
  DOOR_HP,
  DOOR_KINDS,
  HIT_DAMAGE,
  MAX_HP,
  PIECE_COST,
  WALL_EDITS,
  boxesTouch,
  doorBox,
  pieceBounds,
  pieceBoxes,
  pieceKey,
  pieceSupported,
  validPieceShape,
  type Box,
  type DoorKind,
  type Piece,
  type PieceKind,
  type WallEdit,
} from '../shared/building.ts';
import {
  CHARGE_KINDS,
  CRATE_KINDS,
  DEPLOYABLE_INFO,
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
  privilege,
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
import { EXPLOSIVES, PLANT_RANGE, POINT_BLANK, THROW_SPEED, blastFalloff, isExplosive, type ExplosiveId } from '../shared/explosives.ts';
import { BARREL_DRINK, RESOURCE_INFO, WRECK_LOOT, generateResources, type Material, type ResourceNode } from '../shared/world.ts';
import { BIOMES, CORE_RADIUS, biomeAt, climateAt } from '../shared/biomes.ts';
import { atLandmark, crateSpots, landmarks } from '../shared/landmarks.ts';
import { rollLoot } from '../shared/loot.ts';
import { daylight, stormClimate, weatherAt } from '../shared/sky.ts';
import { ASHHOUND, MAX_MOUNTS, MOUNT_RANGE, SPECIES, clearOfRuins, herds, rayCreature, yawTowards, type Species } from '../shared/creatures.ts';
import { blocked, bodyRadius, houndState, newHound, spread, steer, turnTo, type Hound, type Prey, type SavedHound } from './wildlife.ts';
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
  /** How fast they were last going, m/s, which is what spooks skittish animals. */
  speed: number;
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
  /** Code locks by the key of the wall their door hangs in. */
  locks?: [string, Lock][];
  /** Lit charges: ms left on each fuse, and what it is stuck to. */
  fuses?: [number, { in: number; key?: string; door?: boolean }][];
  /** Sleeping bags still cooling down: ms until each can be used again. */
  bagCooldowns?: [number, number][];
  /** Landmark crate spots waiting to refill: ms until each does. */
  crates?: [string, number][];
}

/** A code lock's code, and everyone who has opened it with the code (its owner first). */
interface Lock {
  code: string;
  auth: number[];
}

/** A lit charge: when it goes off (ms), and the wall or door it was stuck to, if any. */
interface Fuse {
  at: number;
  key?: string;
  door?: boolean;
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
/** Seconds before an emptied landmark crate fills up again. */
export const CRATE_RESPAWN = 8 * 60;
/** Minutes before the first supply plane once someone is playing, and between planes after that (give or take a fifth). */
export const FIRST_DROP = 6;
export const DROP_EVERY = 25;
/** The supply plane: metres up, metres a second, and how far either side of its drop it flies. */
const PLANE_HEIGHT = 95;
const PLANE_SPEED = 45;
const PLANE_REACH = 340;
/** How fast a supply drop comes down under its parachute, m/s, and how long it waits to be looted, s. */
export const DROP_FALL = 4.5;
const DROP_EXPIRY = 30 * 60;
/** Seconds from a supply signal landing to the plane being sent, and to its smoke dying out. */
export const SIGNAL_DELAY = 5;
const SIGNAL_SMOKE = 45;

/** Damage a hit by hand does to a wooden wall or door inside someone else's tool cupboard range. */
const SOFT_HIT = 3;
/** Seconds before a sleeping bag can be used again. */
export const BAG_COOLDOWN = 60;
/** Seconds between tries at a code lock's code. */
const CODE_DELAY = 1;
/** Health a wrong code costs: the lock shocks you. */
const CODE_SHOCK = 5;

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
  /** Landmark crates and the supply plane, also turned off for tests that need an empty map. */
  loot = true;
  private wildlifeStarted = false;
  /** Separate again, so the hounds' wandering never changes loot or spawns. */
  private houndRand: () => number;
  private locks = new Map<string, Lock>();
  private fuses = new Map<number, Fuse>();
  /** When each sleeping bag can next be woken up in (ms). */
  private bagReady = new Map<number, number>();
  /** When each player may next try a code (ms). */
  private nextCodeAt = new Map<number, number>();
  /** Every landmark crate spot, and when each empty one fills up again (ms). */
  private spots: ReturnType<typeof crateSpots>;
  private crateDue = new Map<string, number>();
  private nextCrateCheck = 0;
  /** Its own random stream, so what crates hold never moves spawns or hounds. */
  private crateRand: () => number;
  /** Thrown supply signals: when each calls the plane (ms), and when its smoke is gone. */
  private signals = new Map<number, { call: number; gone: number }>();
  /** Crates on their way, leaving the plane at `at` (ms) over (x, z). */
  private drops: { at: number; x: number; z: number }[] = [];
  /** When the next supply plane is due (ms), or -1 until someone is playing. */
  private nextDropAt = -1;

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
    this.crateRand = mulberry32(seed ^ 0x6a09e667);
    this.spots = crateSpots(seed);
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
      speed: 0,
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
    const rider = this.players.get(id);
    if (rider) this.dismount(rider);
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
    const mount = this.mountOf(p);
    const allowed = Math.max(PLAYER_SPRINT, mount ? SPECIES[mount.species].ride!.sprint : 0) * dt * 1.5 + 0.5;
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
    p.speed = horizontal / dt;
    p.lastMoveAt = now;
    return [];
  }

  /** A tame animal of the kind given, beside a player: for screenshots and testing. */
  givePet(id: number, species: Species) {
    const p = this.players.get(id);
    if (!p || !SPECIES[species]) return;
    const h = newHound(this.nextHoundId++, -1, p.x + 2.5, p.z + 1, this.seed, 0, species);
    Object.assign(h, { owner: id, name: `${p.name}'s ${SPECIES[species].name}` });
    this.hounds.set(h.id, h);
  }

  /** The animal a player is riding, if they are. */
  private mountOf(p: Player): Hound | null {
    const h = p.riding === undefined ? undefined : this.hounds.get(p.riding);
    return h && !h.deadAt && h.rider === p.id ? h : null;
  }

  /** Climbs on your own tame animal (one that can be ridden), or gets off with id null. */
  ride(id: number, creature: number | null): Outgoing[] {
    const p = this.alive(id);
    if (!p) return [];
    if (creature === null) return this.dismount(p);
    const h = this.hounds.get(creature);
    if (!h || h.deadAt || !SPECIES[h.species].ride) return [];
    if (h.owner !== p.id) return [notice(id, h.owner === null ? `Tame the ${SPECIES[h.species].name} before you ride it` : 'That is not yours to ride')];
    if (h.rider !== null && h.rider !== id) return [];
    if (Math.hypot(h.x - p.x, h.z - p.z) > MOUNT_RANGE + SPECIES[h.species].length / 2) return [notice(id, 'Get closer to climb on')];
    this.dismount(p);
    h.rider = id;
    h.target = null;
    p.riding = h.id;
    return [{ to: id, msg: { t: 'mounted', id: h.id, x: h.x, y: h.y, z: h.z, yaw: h.yaw } }];
  }

  /** Off whatever they are riding, standing beside it. */
  private dismount(p: Player): Outgoing[] {
    const h = p.riding === undefined ? undefined : this.hounds.get(p.riding);
    delete p.riding;
    if (!h || h.rider !== p.id) return [];
    h.rider = null;
    // Step off to its left, clear of its body.
    const side = bodyRadius(h.species) + 0.8;
    let x = h.x + Math.cos(h.yaw) * side;
    let z = h.z - Math.sin(h.yaw) * side;
    if (blocked(this.pieces.values(), x, terrainHeight(this.seed, x, z), z, 0.35)) [x, z] = [h.x, h.z];
    const y = terrainHeight(this.seed, x, z);
    if (p.dead) return [];
    Object.assign(p, { x, y, z });
    return [{ to: p.id, msg: { t: 'mounted', id: null, x, y, z, yaw: p.yaw } }];
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
    if (this.landmarkAt(bounds)) return [notice(id, this.landmarkAt(bounds)!)];
    if (this.blockedAt(p, bounds)) return [notice(id, BLOCKED)];
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

  /**
   * Hits damage a piece, or the door hung in it; at zero health it breaks, and a piece refunds
   * a little material. Inside someone else's tool cupboard range, hands barely scratch wood and
   * do nothing to stone, scrap or metal: that takes explosives.
   */
  hit(id: number, key: string, now: number, door = false): Outgoing[] {
    const p = this.alive(id);
    const piece = this.pieces.get(key);
    if (!p || !piece) return [];
    if ((now - p.lastGatherAt) / 1000 < GATHER_COOLDOWN) return [];
    if (!this.inReach(p, pieceBounds(piece))) return [notice(id, 'Too far away')];
    const blocked = this.blockedAt(p, pieceBounds(piece));
    if (door && piece.door) {
      const amount = blocked ? (piece.door.kind === 'woodenDoor' ? SOFT_HIT : 0) : HIT_DAMAGE;
      if (amount === 0) return [notice(id, 'Too strong to break by hand: you need explosives')];
      p.lastGatherAt = now;
      return this.damageDoor(key, piece, amount, id);
    }
    const amount = blocked ? (piece.material === 'wood' ? SOFT_HIT : 0) : HIT_DAMAGE;
    if (amount === 0) return [notice(id, 'Too strong to break by hand: you need explosives')];
    p.lastGatherAt = now;
    const out = this.damagePiece(key, piece, amount, id);
    if (!this.pieces.has(key) && !blocked) {
      addItem(p.slots, piece.material, PIECE_COST / 2);
      out.push(this.inventory(p));
    }
    return out;
  }

  /** Takes health off a piece, breaking it (and any door and lock in it) at zero. */
  private damagePiece(key: string, piece: Piece, amount: number, by: number): Outgoing[] {
    piece.hp -= amount;
    if (piece.hp > 0) return [{ to: 'all', msg: { t: 'piece', key, piece, by } }];
    this.pieces.delete(key);
    this.locks.delete(key);
    return [{ to: 'all', msg: { t: 'piece', key, piece: null, by } }];
  }

  /** Takes health off the door in a piece; at zero it is gone, lock and all, leaving the doorway. */
  private damageDoor(key: string, piece: Piece, amount: number, by: number): Outgoing[] {
    if (!piece.door) return [];
    piece.door.hp -= amount;
    if (piece.door.hp <= 0) {
      delete piece.door;
      this.locks.delete(key);
    }
    return [{ to: 'all', msg: { t: 'piece', key, piece, by } }];
  }

  /** True inside a tool cupboard's range that doesn't trust this player. */
  /** Why nobody may build here, if it is on a landmark's ground. */
  private landmarkAt(b: Box): string | null {
    const x = (b.min[0] + b.max[0]) / 2;
    const z = (b.min[2] + b.max[2]) / 2;
    if (!atLandmark(this.seed, x, z, 4)) return null;
    const near = landmarks(this.seed).reduce((a, l) => (Math.hypot(l.site.x - x, l.site.z - z) < Math.hypot(a.site.x - x, a.site.z - z) ? l : a));
    return `You can't build at ${near.landmark.name}`;
  }

  private blockedAt(p: Player, b: Box): boolean {
    return privilege(this.deployables.values(), (b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2, p.id) === 'blocked';
  }

  /**
   * Hits a workbench, furnace or box. When it breaks, whatever was inside goes to whoever
   * broke it, and its owner gets the item itself back (so this is also how you pick one up).
   */
  hitDeployable(id: number, deployableId: number, now: number): Outgoing[] {
    const p = this.alive(id);
    const d = this.deployables.get(deployableId);
    if (!p || !d || CHARGE_KINDS.includes(d.kind) || d.kind === 'supplySignal') return [];
    if (CRATE_KINDS.includes(d.kind)) return [notice(id, 'Press E to open it')];
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
    if (this.blockedAt(p, pieceBounds(piece))) return [notice(id, BLOCKED)];
    const out: Outgoing[] = [];
    if (piece.door && edit !== 'door') {
      // Walling up a doorway takes the door down, and its lock, back into your pack.
      addItem(p.slots, piece.door.kind, 1);
      if (piece.door.locked) addItem(p.slots, 'codeLock', 1);
      delete piece.door;
      this.locks.delete(key);
      out.push(this.inventory(p));
    }
    piece.edit = edit;
    out.unshift({ to: 'all', msg: { t: 'piece', key, piece, by: id } });
    return out;
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
      // An emptied loot bag or crate goes away.
      if ((d.kind === 'lootBag' || CRATE_KINDS.includes(d.kind)) && !d.slots.some(Boolean)) out.push(...this.removeDeployable(d.id, id));
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
    if (this.landmarkAt(box)) return [notice(id, this.landmarkAt(box)!)];
    if (this.blockedAt(p, box)) return [notice(id, BLOCKED)];
    if (!this.deploySupported(x, y, z)) return [notice(id, 'Place it on flat ground or a floor')];
    const blockers: Box[] = [
      ...[...this.pieces.values()].flatMap((piece) => pieceBoxes(piece)),
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

  /** Asks a tool cupboard to trust you, so you can build round it. You must be able to reach it. */
  authorize(id: number, deployableId: number): Outgoing[] {
    const p = this.alive(id);
    const d = this.deployables.get(deployableId);
    if (!p || !d || d.kind !== 'toolCupboard') return [];
    if (!this.inReach(p, deployableBox(d))) return [notice(id, 'Get closer to the tool cupboard')];
    d.auth ??= [];
    if (d.auth.includes(id)) return [notice(id, 'You are already authorised here')];
    d.auth.push(id);
    return [{ to: 'all', msg: { t: 'deployable', id: d.id, d, by: id } }, notice(id, 'Authorised: you can build round this tool cupboard')];
  }

  /** Makes a tool cupboard forget everyone but you. Only someone it trusts can do this. */
  clearAuth(id: number, deployableId: number): Outgoing[] {
    const p = this.alive(id);
    const d = this.deployables.get(deployableId);
    if (!p || !d || d.kind !== 'toolCupboard') return [];
    if (!this.inReach(p, deployableBox(d))) return [notice(id, 'Get closer to the tool cupboard')];
    if (!d.auth?.includes(id)) return [notice(id, 'Only someone authorised can clear the list')];
    d.auth = [id];
    return [{ to: 'all', msg: { t: 'deployable', id: d.id, d, by: id } }, notice(id, 'Cleared: only you are authorised now')];
  }

  /** Hangs the door in a belt slot in a doorway, closed (or open if someone is standing in it). */
  hangDoor(id: number, key: string, slot: number): Outgoing[] {
    const p = this.alive(id);
    const piece = this.pieces.get(key);
    if (!p || !piece || !isBeltSlot(slot)) return [];
    const stack = p.slots[slot];
    if (!stack || !DOOR_KINDS.includes(stack.item as DoorKind)) return [];
    if (piece.kind !== 'wall' || piece.edit !== 'door') return [notice(id, 'Hang it in a doorway: press G on a wall to make one')];
    if (piece.door) return [notice(id, 'There is already a door here')];
    if (!this.inReach(p, pieceBounds(piece))) return [notice(id, 'Too far away')];
    if (this.blockedAt(p, pieceBounds(piece))) return [notice(id, BLOCKED)];
    const kind = stack.item as DoorKind;
    piece.door = { kind, open: this.doorwayBusy(piece), hp: DOOR_HP[kind], locked: false };
    stack.count -= 1;
    if (stack.count === 0) p.slots[slot] = null;
    return [{ to: 'all', msg: { t: 'piece', key, piece, by: id } }, this.inventory(p)];
  }

  /** Opens or closes a door. A locked one only opens for those who know its code. */
  toggleDoor(id: number, key: string): Outgoing[] {
    const p = this.alive(id);
    const piece = this.pieces.get(key);
    if (!p || !piece?.door) return [];
    if (!this.inReach(p, doorBox(piece))) return [notice(id, 'Too far away')];
    const lock = this.locks.get(key);
    if (piece.door.locked && lock && !lock.auth.includes(id)) return [{ to: id, msg: { t: 'codeNeeded', key } }];
    if (piece.door.open && this.doorwayBusy(piece)) return [notice(id, 'Someone is standing in the doorway')];
    piece.door.open = !piece.door.open;
    return [{ to: 'all', msg: { t: 'piece', key, piece, by: id } }];
  }

  /** Fits the code lock in a belt slot to a door, set to a 4-digit code. */
  lock(id: number, key: string, slot: number, code: string): Outgoing[] {
    const p = this.alive(id);
    const piece = this.pieces.get(key);
    if (!p || !piece?.door || !isBeltSlot(slot) || p.slots[slot]?.item !== 'codeLock') return [];
    if (!/^\d{4}$/.test(code)) return [notice(id, 'The code must be 4 digits')];
    if (piece.door.locked) return [notice(id, 'This door already has a lock')];
    if (!this.inReach(p, doorBox(piece))) return [notice(id, 'Too far away')];
    if (this.blockedAt(p, pieceBounds(piece))) return [notice(id, BLOCKED)];
    this.locks.set(key, { code, auth: [id] });
    piece.door.locked = true;
    const stack = p.slots[slot]!;
    stack.count -= 1;
    if (stack.count === 0) p.slots[slot] = null;
    return [{ to: 'all', msg: { t: 'piece', key, piece, by: id } }, this.inventory(p), notice(id, `Locked with code ${code}. Tell it only to friends`)];
  }

  /** Tries a code on a locked door: the right one opens it and remembers you; a wrong one shocks you. */
  tryCode(id: number, key: string, code: string, now: number): Outgoing[] {
    const p = this.alive(id);
    const piece = this.pieces.get(key);
    const lock = this.locks.get(key);
    if (!p || !piece?.door || !lock) return [];
    if (!this.inReach(p, doorBox(piece))) return [notice(id, 'Too far away')];
    if (now < (this.nextCodeAt.get(id) ?? 0)) return [];
    this.nextCodeAt.set(id, now + CODE_DELAY * 1000);
    if (code !== lock.code) {
      p.hp = Math.max(1, p.hp - CODE_SHOCK);
      p.sentHp = Math.round(p.hp);
      return [notice(id, 'Wrong code: the lock shocks you'), { to: id, msg: { t: 'health', hp: p.sentHp, from: [p.x, p.y + 1, p.z] } }];
    }
    if (!lock.auth.includes(id)) lock.auth.push(id);
    if (!piece.door.open && !this.doorwayBusy(piece)) piece.door.open = true;
    return [{ to: 'all', msg: { t: 'piece', key, piece, by: id } }, notice(id, 'Code accepted')];
  }

  /** True when someone stands where a closed door would swing shut. */
  private doorwayBusy(piece: Piece): boolean {
    const b = doorBox(piece);
    return [...this.players.values()].some((o) => !o.dead && boxesTouch(b, playerBox(o), -0.02));
  }

  /**
   * Sticks the satchel or C4 in a belt slot to a wall, door, floor, deployable or the ground
   * at `at`, and lights it. `key` (and `door`) say which piece it is stuck to.
   */
  plant(id: number, slot: number, at: Vec3, now: number, key?: string, door = false): Outgoing[] {
    const p = this.alive(id);
    if (!p || !isBeltSlot(slot) || !isVec3(at)) return [];
    const stack = p.slots[slot];
    if (!stack || (stack.item !== 'satchel' && stack.item !== 'c4')) return [];
    const eye: Vec3 = [p.x, p.y + EYE_HEIGHT, p.z];
    if (Math.hypot(at[0] - eye[0], at[1] - eye[1], at[2] - eye[2]) > PLANT_RANGE + 0.6) return [notice(id, 'Too far away')];
    const piece = key ? this.pieces.get(key) : undefined;
    const onPiece = piece && distanceToBox(at, door && piece.door ? doorBox(piece) : pieceBounds(piece)) < 0.35;
    if (!onPiece && !this.solidNear(at)) return [notice(id, 'Stick it to a wall, a door or the ground')];
    const item = stack.item as ExplosiveId;
    stack.count -= 1;
    if (stack.count === 0) p.slots[slot] = null;
    const d = newDeployable(this.nextDeployableId++, item, at[0], at[1] - DEPLOYABLE_INFO[item].size[1] / 2, at[2], p.yaw, id);
    this.deployables.set(d.id, d);
    this.fuses.set(d.id, { at: now + EXPLOSIVES[item].fuse * 1000, ...(onPiece && { key, door: door && !!piece!.door }) });
    return [{ to: 'all', msg: { t: 'deployable', id: d.id, d, by: id } }, this.inventory(p)];
  }

  /** True when a point is on the ground or against a piece or deployable. */
  private solidNear(at: Vec3): boolean {
    if (Math.abs(at[1] - terrainHeight(this.seed, at[0], at[2])) < 0.4) return true;
    for (const piece of this.pieces.values()) if (pieceBoxes(piece).some((b) => distanceToBox(at, b) < 0.35)) return true;
    for (const d of this.deployables.values()) if (!CHARGE_KINDS.includes(d.kind) && distanceToBox(at, deployableBox(d)) < 0.35) return true;
    return false;
  }

  /**
   * Throws the beancan in a belt slot along `dir`. It flies in an arc until it hits a wall,
   * the ground or a floor, drops to whatever is under it, and goes off when its fuse runs out.
   */
  throwGrenade(id: number, slot: number, dir: Vec3, now: number): Outgoing[] {
    const p = this.alive(id);
    const item = p && isBeltSlot(slot) ? p.slots[slot]?.item : undefined;
    if (!p || !isVec3(dir) || (item !== 'beancan' && item !== 'supplySignal')) return [];
    if (now < p.nextAttackAt) return [];
    p.nextAttackAt = now + 800;
    const d = normalize(dir);
    let pos: Vec3 = [p.x, p.y + EYE_HEIGHT, p.z];
    const v: Vec3 = [d[0] * THROW_SPEED, d[1] * THROW_SPEED + 2, d[2] * THROW_SPEED];
    const boxes = [
      ...[...this.pieces.values()].flatMap((piece) => pieceBoxes(piece)),
      ...[...this.deployables.values()].filter((x) => !CHARGE_KINDS.includes(x.kind) && x.kind !== 'supplySignal').map(deployableBox),
    ];
    const step = 0.03;
    for (let t = 0; t < 3; t += step) {
      const next: Vec3 = [pos[0] + v[0] * step, pos[1] + v[1] * step, pos[2] + v[2] * step];
      v[1] -= 9.8 * step;
      const len = Math.hypot(next[0] - pos[0], next[1] - pos[1], next[2] - pos[2]);
      const sd: Vec3 = [(next[0] - pos[0]) / len, (next[1] - pos[1]) / len, (next[2] - pos[2]) / len];
      let hit = len;
      for (const b of boxes) hit = rayBox(pos, sd, b, hit) ?? hit;
      hit = rayTerrain(this.seed, pos, sd, hit) ?? hit;
      if (hit < len) {
        const back = Math.max(0, hit - 0.08);
        pos = [pos[0] + sd[0] * back, pos[1] + sd[1] * back, pos[2] + sd[2] * back];
        break;
      }
      pos = next;
    }
    const y = this.groundBelow(pos[0], pos[1], pos[2]);
    const stack = p.slots[slot]!;
    stack.count -= 1;
    if (stack.count === 0) p.slots[slot] = null;
    const g = newDeployable(this.nextDeployableId++, item, pos[0], y, pos[2], p.yaw, id);
    this.deployables.set(g.id, g);
    const out: Outgoing[] = [{ to: 'all', msg: { t: 'deployable', id: g.id, d: g, by: id } }, this.inventory(p)];
    if (item === 'beancan') this.fuses.set(g.id, { at: now + EXPLOSIVES.beancan.fuse * 1000 });
    else {
      this.signals.set(g.id, { call: now + SIGNAL_DELAY * 1000, gone: now + SIGNAL_SMOKE * 1000 });
      out.push(notice(id, 'Red smoke is up: the supply plane is on its way'));
    }
    return out;
  }

  /** The top of the ground, a floor or anything else solid under a point. */
  private groundBelow(x: number, y: number, z: number): number {
    let top = terrainHeight(this.seed, x, z);
    for (const piece of this.pieces.values()) {
      for (const b of pieceBoxes(piece)) {
        if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2] && b.max[1] <= y + 0.1) top = Math.max(top, b.max[1]);
      }
    }
    return top;
  }

  /**
   * A charge goes off: the wall or door it sits on takes the full blast, pieces and doors
   * nearby take up to half, deployables break open, and anyone in reach who isn't behind a
   * wall gets hurt.
   */
  private explode(d: Deployable, now: number): Outgoing[] {
    const fuse = this.fuses.get(d.id);
    const item = d.kind as ExplosiveId;
    const info = EXPLOSIVES[item];
    const c: Vec3 = [d.x, d.y + DEPLOYABLE_INFO[item].size[1] / 2, d.z];
    const out: Outgoing[] = [...this.removeDeployable(d.id), { to: 'all', msg: { t: 'explosion', at: c, item } }];
    const share = (dist: number) => (dist <= POINT_BLANK ? 1 : 0.5 * blastFalloff(dist, info.radius));
    for (const [key, piece] of [...this.pieces]) {
      const target = fuse?.key === key;
      const onDoor = target && fuse?.door && piece.door;
      const dist = target ? 0 : distanceToBox(c, pieceBounds(piece));
      if (dist > info.radius) continue;
      if (piece.door) {
        const doorDist = onDoor ? 0 : distanceToBox(c, doorBox(piece));
        if (doorDist <= info.radius) out.push(...this.damageDoor(key, piece, info.structure * share(doorDist), d.owner));
      }
      if (!onDoor) out.push(...this.damagePiece(key, piece, info.structure * share(dist), d.owner));
    }
    for (const other of [...this.deployables.values()]) {
      if (CHARGE_KINDS.includes(other.kind) || CRATE_KINDS.includes(other.kind) || other.kind === 'supplySignal') continue;
      const dist = distanceToBox(c, deployableBox(other));
      if (dist > info.radius) continue;
      other.hp -= info.structure * blastFalloff(dist, info.radius);
      if (other.hp > 0) {
        out.push({ to: 'all', msg: { t: 'deployable', id: other.id, d: other, by: d.owner } });
        continue;
      }
      // Whatever was inside spills out in a bag.
      const spilled = other.slots.filter(Boolean);
      out.push(...this.removeDeployable(other.id, d.owner));
      if (spilled.length && other.kind !== 'lootBag') out.push(...this.dropBag(other.x, other.y, other.z, other.slots, DEPLOYABLE_INFO[other.kind].name));
    }
    const owner = this.players.get(d.owner);
    for (const victim of [...this.players.values()]) {
      if (victim.dead) continue;
      const chest: Vec3 = [victim.x, victim.y + 1, victim.z];
      const dist = Math.hypot(chest[0] - c[0], chest[1] - c[1], chest[2] - c[2]);
      if (dist > info.radius || this.sheltered(c, chest, dist)) continue;
      const amount = info.people * blastFalloff(dist, info.radius) * armourFactor(victim.wear, 'chest');
      if (owner && owner !== victim) {
        out.push(...this.damage(victim, amount, owner, item, false, new Set<ArmourSlot>(['chest'])));
        continue;
      }
      victim.hp = Math.max(0, victim.hp - amount);
      victim.sentHp = Math.round(victim.hp);
      out.push({ to: victim.id, msg: { t: 'health', hp: victim.sentHp, from: c } });
      if (victim.hp <= 0) out.push(...this.kill(victim, null, null, false, 'explosion'));
    }
    for (const h of [...this.hounds.values()]) {
      if (h.deadAt) continue;
      const dist = Math.hypot(h.x - c[0], h.y + 0.5 - c[1], h.z - c[2]);
      if (dist > info.radius) continue;
      out.push(...this.hurtHound(h, info.people * blastFalloff(dist, info.radius), { kind: 'player', id: d.owner }, now));
    }
    return out;
  }

  /** True when a wall, door or floor stands between a blast and someone (ignoring what it sits in). */
  private sheltered(from: Vec3, to: Vec3, dist: number): boolean {
    const dir: Vec3 = [(to[0] - from[0]) / dist, (to[1] - from[1]) / dist, (to[2] - from[2]) / dist];
    for (const piece of this.pieces.values()) {
      for (const b of pieceBoxes(piece)) {
        if (distanceToBox(from, b) === 0) continue;
        if (rayBox(from, dir, b, dist) !== null) return true;
      }
    }
    return false;
  }

  /** Leaves a loot bag of whatever was in a broken box or furnace. */
  private dropBag(x: number, y: number, z: number, slots: Slots, label: string): Outgoing[] {
    const bag = newDeployable(this.nextDeployableId++, 'lootBag', x, y, z, 0, 0);
    bag.slots = [...slots, ...emptySlots(Math.max(0, INVENTORY_SIZE - slots.length))].slice(0, INVENTORY_SIZE);
    bag.label = label;
    this.deployables.set(bag.id, bag);
    this.bagExpiry.set(bag.id, LOOT_BAG_SECONDS);
    return [{ to: 'all', msg: { t: 'deployable', id: bag.id, d: bag, by: 0 } }];
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
    if (stack?.item === 'cookedMeat' || stack?.item === 'feedSack') {
      const fed = this.feed(p, slot, now, stack.item);
      if (fed) return fed;
      if (stack.item === 'feedSack') return [notice(id, 'Walk slowly up to a mule, elk, buffalo or camel and hold it out to them')];
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
    const mount = this.mountOf(p);
    const climate = { hunger: land.hunger * storm.hunger, thirst: land.thirst * storm.thirst * (mount ? (SPECIES[mount.species].thirst ?? 1) : 1) };
    // Riding is resting your legs: you tire as if standing.
    const { hp, cause } = tickVitals(p.vitals, dt, p.moving && !mount, level, radProtection(p), p.hp, MAX_HEALTH, climate);
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

  /**
   * Back to life with a rock, a building plan and full health: at a random spot, or in one of
   * your sleeping bags if it has cooled down since you last woke there.
   */
  respawn(id: number, bag?: number, now = Math.max(0, this.lastTick)): Outgoing[] {
    const p = this.players.get(id);
    if (!p || !p.dead) return [];
    const b = bag === undefined ? undefined : this.deployables.get(bag);
    if (bag !== undefined) {
      if (!b || b.kind !== 'sleepingBag' || b.owner !== id) return [notice(id, 'That sleeping bag is gone')];
      const wait = Math.ceil(((this.bagReady.get(b.id) ?? 0) - now) / 1000);
      if (wait > 0) return [notice(id, `That sleeping bag is ready in ${wait} s`)];
      this.bagReady.set(b.id, now + BAG_COOLDOWN * 1000);
    }
    const [x, z] = b ? [b.x, b.z] : this.spawnPoint();
    p.x = x;
    p.z = z;
    p.y = b ? b.y + 0.15 : terrainHeight(this.seed, x, z);
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
      // Never your own mount, which is right under your sights.
      if (h.deadAt || h.rider === shooter.id) continue;
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
    this.dismount(victim);
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
        .map((h) => ({ x: h.x, y: h.y, z: h.z, yaw: h.yaw, hp: h.hp, owner: h.owner!, name: h.name ?? SPECIES[h.species].name, species: h.species })),
      locks: [...this.locks],
      fuses: [...this.fuses].map(([id, f]) => [id, { in: Math.max(0, f.at - now), key: f.key, door: f.door }]),
      bagCooldowns: [...this.bagReady].filter(([, at]) => at > now).map(([id, at]) => [id, at - now]),
      crates: [...this.crateDue].map(([key, at]) => [key, Math.max(0, at - now)]),
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
    game.locks = new Map(save.locks ?? []);
    game.fuses = new Map((save.fuses ?? []).map(([id, f]) => [id, { at: now + f.in, key: f.key, door: f.door }]));
    game.bagReady = new Map((save.bagCooldowns ?? []).map(([id, ms]) => [id, now + ms]));
    game.crateDue = new Map((save.crates ?? []).map(([key, ms]) => [key, now + ms]));
    for (const d of [...game.deployables.values()]) {
      // A charge whose fuse was lost would never go off, and a signal's plane is gone; take them away.
      if ((CHARGE_KINDS.includes(d.kind) && !game.fuses.has(d.id)) || d.kind === 'supplySignal') game.deployables.delete(d.id);
      // A drop that was still falling has landed by now.
      delete d.fall;
    }
    for (const saved of save.hounds ?? []) {
      const h = newHound(game.nextHoundId++, -1, saved.x, saved.z, game.seed, saved.yaw, saved.species && SPECIES[saved.species] ? saved.species : 'ashhound');
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
    for (const [id, fuse] of [...this.fuses]) {
      const d = this.deployables.get(id);
      if (!d) this.fuses.delete(id);
      else if (fuse.at <= now) out.push(...this.explode(d, now));
    }
    out.push(...this.tickCrates(now), ...this.tickAirdrops(now));
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

  /** Fills every landmark crate spot that has stood empty long enough (all of them, at first). */
  private tickCrates(now: number): Outgoing[] {
    if (!this.loot || now < this.nextCrateCheck) return [];
    this.nextCrateCheck = now + 1000;
    const filled = new Set<string>();
    for (const d of this.deployables.values()) if (d.spot) filled.add(d.spot);
    const out: Outgoing[] = [];
    for (const s of this.spots) {
      if (filled.has(s.key) || (this.crateDue.get(s.key) ?? 0) > now) continue;
      this.crateDue.delete(s.key);
      const crate = this.fillCrate(newDeployable(this.nextDeployableId++, s.kind, s.x, s.y, s.z, s.rot, 0), s.land);
      crate.spot = s.key;
      this.deployables.set(crate.id, crate);
      out.push({ to: 'all', msg: { t: 'deployable', id: crate.id, d: crate, by: 0 } });
    }
    return out;
  }

  private fillCrate(d: Deployable, land: Parameters<typeof rollLoot>[1]): Deployable {
    rollLoot(d.kind as Parameters<typeof rollLoot>[0], land, this.crateRand).forEach((stack, i) => {
      if (i < d.slots.length) d.slots[i] = stack;
    });
    return d;
  }

  /**
   * The supply plane: one comes over every so often while anyone is playing, and whenever a
   * supply signal calls it. It drops a crate that drifts down under a parachute.
   */
  private tickAirdrops(now: number): Outgoing[] {
    const out: Outgoing[] = [];
    if (this.players.size > 0 && this.loot) {
      if (this.nextDropAt < 0) this.nextDropAt = now + FIRST_DROP * 60_000;
      if (now >= this.nextDropAt) {
        this.nextDropAt = now + DROP_EVERY * 60_000 * (0.8 + this.crateRand() * 0.4);
        out.push(...this.callPlane(...this.dropSpot(), now));
      }
    }
    for (const [id, signal] of [...this.signals]) {
      const d = this.deployables.get(id);
      if (!d) this.signals.delete(id);
      else if (signal.call && now >= signal.call) {
        signal.call = 0;
        out.push(...this.callPlane(d.x + (this.crateRand() - 0.5) * 6, d.z + (this.crateRand() - 0.5) * 6, now));
      } else if (now >= signal.gone) out.push(...this.removeDeployable(id));
    }
    this.drops = this.drops.filter((drop) => {
      if (now < drop.at) return true;
      const y = this.groundBelow(drop.x, PLANE_HEIGHT, drop.z);
      const crate = this.fillCrate(newDeployable(this.nextDeployableId++, 'supplyDrop', drop.x, y, drop.z, this.crateRand() * Math.PI * 2, 0), null);
      const from = PLANE_HEIGHT - 4;
      crate.fall = { from, start: now, land: now + ((from - y) / DROP_FALL) * 1000 };
      this.deployables.set(crate.id, crate);
      this.bagExpiry.set(crate.id, DROP_EXPIRY);
      out.push({ to: 'all', msg: { t: 'deployable', id: crate.id, d: crate, by: 0 } });
      return false;
    });
    return out;
  }

  /** Somewhere open for a scheduled drop: inside the map, off the landmarks and away from bases. */
  private dropSpot(): [number, number] {
    const span = HALF_WORLD * 0.7;
    let spot: [number, number] = [0, 0];
    for (let tries = 0; tries < 40; tries++) {
      spot = [(this.crateRand() - 0.5) * 2 * span, (this.crateRand() - 0.5) * 2 * span];
      if (atLandmark(this.seed, spot[0], spot[1], 6)) continue;
      if ([...this.pieces.values()].some((p) => Math.hypot(pieceBounds(p).min[0] - spot[0], pieceBounds(p).min[2] - spot[1]) < 25)) continue;
      break;
    }
    return spot;
  }

  /** Sends the plane across the map over (x, z), from a random side, and tells everyone. */
  private callPlane(x: number, z: number, now: number): Outgoing[] {
    const a = this.crateRand() * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const from: [number, number] = [x - dx * PLANE_REACH, z - dz * PLANE_REACH];
    const to: [number, number] = [x + dx * PLANE_REACH, z + dz * PLANE_REACH];
    this.drops.push({ at: now + (PLANE_REACH / PLANE_SPEED) * 1000, x, z });
    const over = BIOMES[biomeAt(this.seed, x, z)].name;
    return [
      { to: 'all', msg: { t: 'plane', from, to, y: PLANE_HEIGHT, start: now, speed: PLANE_SPEED, drop: [x, z], over } },
      { to: 'all', msg: { t: 'notice', text: `A supply plane is coming over ${over}` } },
    ];
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

  /** The hounds (or, with `mounts`, the animals to ride) a survivor has tamed and still has. */
  private pets(owner: number, mounts = false): Hound[] {
    return [...this.hounds.values()].filter((h) => h.owner === owner && !h.deadAt && !!SPECIES[h.species].ride === mounts);
  }

  /**
   * Holding out food to an animal within reach that eats it (cooked meat for hounds and bears,
   * a feed sack for the rest): a wild one takes it and calms down towards you, and is yours
   * after enough of it; your own one is healed by it. Returns null when no such animal is near
   * (or yours is already healthy), so you eat it yourself.
   */
  private feed(p: Player, slot: number, now: number, food: ItemId): Outgoing[] | null {
    let best: Hound | null = null;
    let bestD = Infinity;
    for (const h of this.hounds.values()) {
      const info = SPECIES[h.species];
      if (h.deadAt || info.food !== food || (h.owner !== null && h.owner !== p.id) || h.rider !== null || Math.abs(h.y - p.y) > 1.5) continue;
      const d = Math.hypot(h.x - p.x, h.z - p.z) - info.length / 2 + 0.75;
      if (d < ASHHOUND.feedRange && d < bestD) [best, bestD] = [h, d];
    }
    if (!best) return null;
    const h = best;
    const info = SPECIES[h.species];
    // Busy biting or eating: it takes the meat once it is done.
    if (now < h.animUntil) return [];
    if (h.owner === p.id && h.hp >= info.maxHp - 1) return null;
    const stack = p.slots[slot]!;
    const mount = !!info.ride;
    const most = mount ? MAX_MOUNTS : ASHHOUND.maxPets;
    if (h.owner === null && this.pets(p.id, mount).length >= most) {
      return [notice(p.id, mount ? `You can only keep ${most} animals to ride at a time` : `You can only keep ${most} hounds at a time`)];
    }
    stack.count -= 1;
    if (stack.count === 0) p.slots[slot] = null;
    h.anim = 'eat';
    h.animUntil = now + 1800;
    turnTo(h, yawTowards(h.x, h.z, p.x, p.z), 10);
    const out: Outgoing[] = [this.inventory(p)];
    if (h.owner === p.id) {
      h.hp = Math.min(info.maxHp, h.hp + Math.max(45, info.maxHp * 0.3));
      out.push(notice(p.id, h.species === 'ashhound' ? 'Your hound wolfs down the meat' : `Your ${info.name} eats from your hand`));
      return out;
    }
    if (h.fedBy !== p.id) h.fed = 0;
    h.fedBy = p.id;
    h.fed += 1;
    h.calmUntil = now + ASHHOUND.calm * 1000;
    h.fleeUntil = 0;
    if (h.target?.kind === 'player' && h.target.id === p.id) h.target = null;
    if (h.fed < info.tameFeeds) {
      const what = food === 'feedSack' ? 'the feed' : 'the meat';
      out.push(notice(p.id, `The ${info.name} takes ${what} (${h.fed}/${info.tameFeeds}). Feed it again to tame it`));
      return out;
    }
    // Tamed: it leaves its pack or herd, which in time raises another to fill the gap.
    this.litters.push({ pack: h.pack, at: now + info.respawn * 1000 });
    Object.assign(h, { owner: p.id, name: `${p.name}'s ${info.name}`, pack: -1, target: null, hp: info.maxHp, fed: 0, fedBy: null, fleeUntil: 0 });
    out.push(notice(p.id, mount ? `The ${info.name} is yours. It follows you: press E on it to ride` : `The ${info.name} is yours. It follows you and fights for you`));
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
    // Hurt, it turns on whoever did it, unless that is its own master (a skittish one runs).
    const info = SPECIES[h.species];
    const own = by.kind === 'player' && by.id === h.owner;
    if (!own && !(by.kind === 'hound' && by.id === h.id) && h.rider === null) {
      h.target = by;
      h.calmUntil = 0;
      if (h.owner === null) this.alertPack(h, by);
    }
    if (h.owner === null && h.hp < info.maxHp * info.flee && h.fleeUntil < now - 20000) {
      const from = this.preyAt(by);
      h.fleeFrom = from ? [from.x, from.z] : [h.x, h.z];
      h.fleeUntil = now + 5000;
      // A skittish wild animal runs even at full health; it only fights back when cornered.
      if (info.temper === 'skittish') h.target = null;
    }
    return out;
  }

  /** A dead hound leaves its meat in a bag, and its pack raises another in time. */
  private houndDies(h: Hound, now: number): Outgoing[] {
    h.deadAt = now;
    h.anim = 'dead';
    h.target = null;
    const info = SPECIES[h.species];
    const out: Outgoing[] = [];
    const rider = h.rider === null ? undefined : this.players.get(h.rider);
    if (rider) out.push(...this.dismount(rider));
    if (h.owner === null) this.litters.push({ pack: h.pack, at: now + info.respawn * 1000 });
    else if (this.players.has(h.owner)) out.push(notice(h.owner, `Your ${info.name} was killed`));
    const [lo, hi] = info.meat;
    const bag = newDeployable(this.nextDeployableId++, 'lootBag', h.x, h.y, h.z, h.yaw, 0);
    bag.slots = emptySlots(6);
    addItem(bag.slots, 'rawMeat', lo + Math.floor(this.houndRand() * (hi - lo + 1)));
    bag.label = info.name;
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
    herds(this.seed).forEach((herd, pack) => {
      for (let n = 0; n < herd.size; n++) this.litters.push({ pack, at: now });
    });
  }

  private tickWildlife(now: number, dt: number): Outgoing[] {
    if (!this.wildlife) return [];
    if (!this.wildlifeStarted) this.startWildlife(now);
    const dens = herds(this.seed);
    this.litters = this.litters.filter((l) => {
      if (l.at > now) return true;
      const { x: dx, z: dz, species } = dens[l.pack];
      const a = this.houndRand() * Math.PI * 2;
      const r = 1 + this.houndRand() * (species === 'ashhound' ? 5 : 8);
      const h = newHound(this.nextHoundId++, l.pack, dx + Math.cos(a) * r, dz + Math.sin(a) * r, this.seed, this.houndRand() * Math.PI * 2, species);
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
      if (h.rider !== null) {
        this.ridden(h, now, dt);
        continue;
      }
      out.push(...(h.owner === null ? this.tickWild(h, [dens[h.pack].x, dens[h.pack].z], now, dt) : this.tickTame(h, now, dt)));
    }
    spread([...this.hounds.values()]);
    for (const h of this.hounds.values()) if (!h.deadAt) h.y = terrainHeight(this.seed, h.x, h.z);
    return out;
  }

  /** Carrying its rider: it stands under them, facing where they go, at their pace. */
  private ridden(h: Hound, now: number, dt: number) {
    const p = this.players.get(h.rider!);
    if (!p || p.dead || p.riding !== h.id) {
      h.rider = null;
      if (p && p.riding === h.id) delete p.riding;
      return;
    }
    const moved = Math.hypot(p.x - h.x, p.z - h.z);
    // Facing where its rider looks (a player looks along -sin, -cos of their yaw).
    h.yaw = p.yaw + Math.PI;
    h.x = p.x;
    h.z = p.z;
    const pace = moved / dt;
    if (now >= h.animUntil) h.anim = pace > SPECIES[h.species].ride!.walk + 1 ? 'run' : pace > 3 ? 'trot' : pace > 0.3 ? 'walk' : 'idle';
    if (h.hp < SPECIES[h.species].maxHp) h.hp = Math.min(SPECIES[h.species].maxHp, h.hp + dt * 0.5);
  }

  private tickWild(h: Hound, den: [number, number], now: number, dt: number): Outgoing[] {
    const info = SPECIES[h.species];
    if (h.fed > 0 && now > h.calmUntil + 30000) [h.fed, h.fedBy] = [0, null];
    if (now < h.fleeUntil && h.fleeFrom) {
      const [fx, fz] = h.fleeFrom;
      const away = Math.hypot(h.x - fx, h.z - fz) || 1;
      this.go(h, h.x + ((h.x - fx) / away) * 10, h.z + ((h.z - fz) / away) * 10, info.run, now, dt, 0);
      return [];
    }
    // Let go of someone who got away, died, or has been feeding it.
    const at = h.target && this.preyAt(h.target);
    const calm = (prey: Prey) => prey.kind === 'player' && prey.id === h.fedBy && now < h.calmUntil;
    if (h.target && (!at || Math.hypot(at.x - den[0], at.z - den[1]) > info.leash || Math.hypot(at.x - h.x, at.z - h.z) > info.sight * 2 || calm(h.target))) {
      h.target = null;
    }
    if (!h.target && info.temper === 'hunter') {
      // The nearest survivor close enough to notice (and not just woken up). Tame animals are
      // left alone unless they start a fight.
      let best: Prey | null = null;
      // Hunters go further afield in the dark.
      let bestD: number = info.sight * (1 + 0.5 * (1 - daylight(now)));
      for (const p of this.players.values()) {
        if (p.dead || now < p.safeUntil || calm({ kind: 'player', id: p.id })) continue;
        const d = Math.hypot(p.x - h.x, p.z - h.z);
        if (d < bestD && Math.hypot(p.x - den[0], p.z - den[1]) < info.leash) [best, bestD] = [{ kind: 'player', id: p.id }, d];
      }
      if (best) {
        h.target = best;
        this.alertPack(h, best);
      }
    }
    if (!h.target && info.temper === 'skittish') {
      // Anyone rushing at it, on foot or riding, sends it off at a run. Walk up slowly instead.
      for (const p of this.players.values()) {
        if (p.dead || calm({ kind: 'player', id: p.id }) || p.speed < PLAYER_SPEED + 0.5) continue;
        if (Math.hypot(p.x - h.x, p.z - h.z) > info.sight) continue;
        h.fleeFrom = [p.x, p.z];
        h.fleeUntil = now + 3000 + this.houndRand() * 2000;
        h.wanderTo = null;
        for (const o of this.hounds.values()) {
          if (o !== h && o.pack === h.pack && o.owner === null && !o.deadAt && Math.hypot(o.x - h.x, o.z - h.z) < 20) [o.fleeFrom, o.fleeUntil] = [h.fleeFrom, h.fleeUntil];
        }
        return [];
      }
    }
    if (h.target) return this.hunt(h, now, dt);
    if (h.hp < info.maxHp) h.hp = Math.min(info.maxHp, h.hp + dt);
    // Nothing to do: amble about near home, resting (or grazing) between walks.
    if (now < h.restUntil) {
      this.go(h, h.x, h.z, 0, now, dt, 0);
      return [];
    }
    if (!h.wanderTo) {
      const a = this.houndRand() * Math.PI * 2;
      const r = 2 + this.houndRand() * (h.species === 'ashhound' ? 10 : 18);
      const to: [number, number] = [den[0] + Math.cos(a) * r, den[1] + Math.sin(a) * r];
      if (!clearOfRuins(this.seed, to[0], to[1])) {
        h.restUntil = now + 1000;
        return [];
      }
      h.wanderTo = to;
    }
    const [wx, wz] = h.wanderTo;
    this.go(h, wx, wz, info.walk, now, dt, 0);
    // There, or stuck against something: rest a while, then pick somewhere else.
    if (Math.hypot(wx - h.x, wz - h.z) < 0.5 || h.anim === 'idle') {
      h.wanderTo = null;
      h.restUntil = now + 3000 + this.houndRand() * 7000;
      // Grazers put their heads down for a while.
      if (h.species !== 'ashhound' && h.species !== 'bear' && this.houndRand() < 0.5) {
        h.anim = 'eat';
        h.animUntil = now + 4000;
      }
    }
    return [];
  }

  /** A tame animal keeps near its owner and goes for anyone fighting them. */
  private tickTame(h: Hound, now: number, dt: number): Outgoing[] {
    const info = SPECIES[h.species];
    const owner = this.players.get(h.owner!);
    if (h.hp < info.maxHp) h.hp = Math.min(info.maxHp, h.hp + dt * 0.5);
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
      // Wild animals that come for its owner.
      for (const o of this.hounds.values()) {
        if (o.owner === null && !o.deadAt && o.target?.kind === 'player' && o.target.id === owner.id && Math.hypot(o.x - h.x, o.z - h.z) < info.sight) {
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
      if (blocked(this.pieces.values(), h.x, h.y, h.z, bodyRadius(h.species))) [h.x, h.y, h.z] = [owner.x, owner.y, owner.z];
    }
    const near = 2.2 + info.length / 2;
    this.go(h, owner.x, owner.z, d > near + 5 ? info.run : d > near + 1 ? info.walk * 2 : 0, now, dt, near);
    return [];
  }

  /** Runs at its target and bites (or gores, or kicks) when close. */
  private hunt(h: Hound, now: number, dt: number): Outgoing[] {
    const info = SPECIES[h.species];
    const at = this.preyAt(h.target!)!;
    const d = Math.hypot(at.x - h.x, at.z - h.z);
    if (d > info.biteRange || Math.abs(at.y - h.y) > 1.3 + info.height / 2) {
      this.go(h, at.x, at.z, info.run, now, dt, info.biteRange * 0.7);
      return [];
    }
    turnTo(h, yawTowards(h.x, h.z, at.x, at.z), dt);
    if (now < h.nextBiteAt) {
      this.go(h, h.x, h.z, 0, now, dt, 0);
      if (h.anim === 'idle') h.anim = 'snarl';
      return [];
    }
    h.nextBiteAt = now + info.biteEvery * 1000;
    h.anim = 'attack';
    h.animUntil = now + 900;
    const by: Prey = { kind: 'hound', id: h.id };
    if (h.target!.kind === 'hound') return this.hurtHound(this.hounds.get(h.target!.id)!, info.bite, by, now);
    return this.bite(this.players.get(h.target!.id)!, h, now);
  }

  /** An animal's bite (or blow) on a survivor: mostly the legs, through whatever armour is there. */
  private bite(p: Player, h: Hound, now: number): Outgoing[] {
    const info = SPECIES[h.species];
    // Big animals hit higher.
    const zone: ArmourSlot = this.houndRand() < (info.height > 1.2 ? 0.3 : 0.6) ? 'legs' : 'chest';
    p.hp = Math.max(0, p.hp - info.bite * armourFactor(p.wear, zone));
    p.sentHp = Math.round(p.hp);
    if (h.owner !== null) this.hurt.set(h.owner, { prey: { kind: 'player', id: p.id }, at: now });
    this.hurtBy.set(p.id, { prey: { kind: 'hound', id: h.id }, at: now });
    const armour = !!p.wear[ARMOUR_SLOTS.indexOf(zone)];
    const out: Outgoing[] = [{ to: p.id, msg: { t: 'health', hp: p.sentHp, from: [h.x, h.y + info.height * 0.65, h.z], armour } }];
    // Wild hounds are named as a pack; other wild animals by what they are; tame ones by name.
    const wildHound = h.owner === null && h.species === 'ashhound';
    if (p.hp <= 0) return [...out, ...this.kill(p, null, null, false, wildHound ? 'ashhound' : undefined, h.name ?? (wildHound ? undefined : `A ${info.name}`))];
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
    const spot = this.deployables.get(id)?.spot;
    if (spot) this.crateDue.set(spot, Math.max(0, this.lastTick) + CRATE_RESPAWN * 1000);
    this.signals.delete(id);
    this.deployables.delete(id);
    this.furnaces.delete(id);
    this.bagExpiry.delete(id);
    this.fuses.delete(id);
    this.bagReady.delete(id);
    return [{ to: 'all', msg: { t: 'deployable', id, d: null, by } }];
  }

  /** Your inventory, or a furnace or box you are close enough to use. */
  private container(p: Player, c: SlotRef['c']): { slots: Slots; deployable: Deployable | null; wear?: boolean } | null {
    if (c === 'me') return { slots: p.slots, deployable: null };
    if (c === 'wear') return { slots: p.wear, deployable: null, wear: true };
    if (typeof c !== 'number') return null;
    const d = this.deployables.get(c);
    if (!d || d.slots.length === 0) return null;
    // A supply drop can't be opened while it is still in the air.
    if (d.fall && d.fall.land > this.lastTick) return null;
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
    ...(p.riding !== undefined && { riding: p.riding }),
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

/** What a survivor is told when someone else's tool cupboard stops them building. */
const BLOCKED = "Building blocked: you are inside someone else's tool cupboard range";

/** Metres from a point to the nearest point of a box (0 inside it). */
function distanceToBox(p: Vec3, b: Box): number {
  const d = [0, 1, 2].map((a) => Math.max(b.min[a] - p[a], 0, p[a] - b.max[a]));
  return Math.hypot(d[0], d[1], d[2]);
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

