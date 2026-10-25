// Computer-controlled survivors, so a quiet server still feels lived in. Each one plays through
// the same Game calls a connected player's messages make: it walks, chops wood, builds and locks
// a small hut with a box of loot inside, fights whoever comes too close and now and then raids
// someone's door with satchel charges. In a gunfight it runs for cover, ducks out to shoot,
// reloads and patches itself up out of sight, and crewmates spread out to come at you from
// the sides. Bots fill the server up to a target head count and leave one by one as real
// players join.

import { PLAYER_HEIGHT, PLAYER_RADIUS, PLAYER_SPEED, HALF_WORLD } from '../shared/constants.ts';
import { EYE_HEIGHT, type Vec3 } from '../shared/combat.ts';
import { coverExtent, type Cover } from '../shared/cover.ts';
import { DOORWAY, STOREY, TILE, boxesTouch, buildBaseY, pieceBoxes, pieceKey, type Piece } from '../shared/building.ts';
import { BELT_SIZE, ITEMS, addItem, countItem, type ItemId, type Slots } from '../shared/items.ts';
import type { Deployable, DeployableKind } from '../shared/deployables.ts';
import { randomLook } from '../shared/look.ts';
import { atLandmark } from '../shared/landmarks.ts';
import { radiationAt } from '../shared/survival.ts';
import { terrainHeight } from '../shared/terrain.ts';
import { RESOURCE_INFO, type ResourceNode } from '../shared/world.ts';
import { playerBox, type Game, type Outgoing } from './game.ts';

const NAMES = ['Kade', 'Mara', 'Rook', 'Vex', 'Juno', 'Dusty', 'Hollis', 'Wren', 'Tamsin', 'Cole', 'Ash', 'Briggs'];
/** What each bot carries besides its hatchet: a gun or bow, and ammunition for it. */
const LOADOUTS: [ItemId, ItemId, number][] = [
  ['huntingBow', 'arrow', 40],
  ['revolver', 'pistolAmmo', 64],
  ['waterpipe', 'handmadeShell', 24],
  ['semiPistol', 'pistolAmmo', 60],
];
/** How close an armed survivor gets before a bot starts shooting, in metres. */
const ENGAGE = 30;
/** Closer than this, bots of rival crews fight each other too. */
const ENGAGE_BOT = 16;
const GIVE_UP = 45;
/** How far it follows someone who shot it from further off. */
const GIVE_UP_SHOT = 90;
/** How far a crewmate's fight draws a bot in to help. */
const HELP = 45;
/** How far a bot will run to get behind something, in metres. */
const COVER_RUN = 15;
/** Cover lower than this hides nobody standing behind it. */
const COVER_LOW = 1.15;
/** Below this health it ducks into cover to bandage itself. */
const HURT = 50;
/** Seconds without sight of its enemy before it goes round the side. */
const FLANK_AFTER = 5;
/** How far round its enemy a flanker swings, in radians. */
const FLANK_ANGLE = 1.15;
/** Seconds after the hounds' own grace that bots leave a fresh spawn alone too. */
const GRACE = 40;
/** Radians of aim error, so bots can be outshot. */
const AIM_ERROR = 0.05;
/** Wood a bot gathers before it builds its hut (seven pieces cost 70; the rest is for show). */
const HUT_WOOD = 200;
/** Seconds between raids for each bot, roughly. */
const RAID_EVERY = [360, 720];
const RESPAWN_AFTER = 8;
/** Seconds a raider spends going through a base's boxes once the door is down. */
const LOOT_FOR = 60;
/** What a raider empties. */
const LOOTED: DeployableKind[] = ['storageBox', 'furnace', 'campfire', 'lootBag'];

type Phase = 'gather' | 'build' | 'roam' | 'raid' | 'fight';

interface Bot {
  id: number;
  /** Bots of different crews fight on sight; crewmates leave each other alone. */
  crew: number;
  phase: Phase;
  /** Where it is walking to, if anywhere. */
  goal: { x: number; z: number; near: number } | null;
  node: ResourceNode | null;
  enemy: { kind: 'player' | 'hound'; id: number } | null;
  /** Its hut: the tile, the floor's height and the doorway's key. */
  home: { i: number; k: number; y: number; door: string } | null;
  buildStep: number;
  spotTries: number;
  raidAt: number;
  raid: Raid | null;
  deadAt: number;
  nextShotAt: number;
  strafe: number;
  strafeUntil: number;
  /** What it is hiding behind, and which side of it it leans out of to shoot. */
  cover: { c: Cover; side: number; checkAt: number; saw: boolean; blind: number } | null;
  /** Cover it couldn't see its enemy from either side of, and until when to leave it be. */
  blind: Map<Cover, number>;
  /** When it may next look round for cover, after finding none. */
  coverLookAt: number;
  /** In cover it hides until `hideUntil`, then leans out to shoot until `peekUntil`, and again. */
  hideUntil: number;
  peekUntil: number;
  /** When it last had a clear line to its enemy, and when it first did in this stretch of sight. */
  sawAt: number;
  sightAt: number;
  /** Where it is going to come at its enemy from the side, and when it last set off to. */
  flank: { x: number; z: number; until: number } | null;
  flankedAt: number;
  nextHealAt: number;
  /** For noticing when it is stuck against something. */
  lastPos: { x: number; z: number; at: number };
}

interface Raid {
  /** The doorway being blown open. */
  key: string;
  planted: number;
  leaveAt: number;
  /** The middle of the doorway and the way out of it, towards where the raider came from. */
  door: { x: number; z: number; nx: number; nz: number } | null;
  /** Once the door is down: when it stops going through the boxes, and when it takes the next stack. */
  lootUntil: number;
  nextTake: number;
}

type Survivor = NonNullable<ReturnType<Game['players']['get']>>;

export class Bots {
  private bots = new Map<number, Bot>();
  private names = [...NAMES];
  private lastTick = -1;

  constructor(
    private game: Game,
    /** How many survivors the server should feel like it has; bots make up the difference. */
    private fill: number,
    private rand: () => number = Math.random,
  ) {}

  isBot(id: number): boolean {
    return this.bots.has(id);
  }

  get count(): number {
    return this.bots.size;
  }

  /** Adds or removes bots so humans plus bots come to `fill` (never more than the server holds). */
  balance(humans: number, now: number): Outgoing[] {
    const out: Outgoing[] = [];
    const want = Math.max(0, this.fill - humans);
    while (this.bots.size > want) out.push(...this.removeOne());
    while (this.bots.size < want) {
      const joined = this.add(now);
      if (!joined) break;
      out.push(...joined);
    }
    return out;
  }

  /** Takes one bot out of the world to make room for a real player. */
  removeOne(): Outgoing[] {
    const id = [...this.bots.keys()].pop();
    if (id === undefined) return [];
    this.bots.delete(id);
    const p = this.game.players.get(id);
    if (p) this.names.push(p.name.replace(/^Bot /, ''));
    return this.game.leave(id);
  }

  private add(now: number): Outgoing[] | null {
    const name = this.names.splice(Math.floor(this.rand() * this.names.length), 1)[0] ?? 'Drifter';
    const joined = this.game.join(`Bot ${name}`, now, randomLook(this.rand));
    if (!joined) return null;
    const p = this.game.players.get(joined.id)!;
    this.scatter(p);
    this.kit(p);
    this.bots.set(joined.id, {
      id: joined.id,
      crew: this.bots.size % 2,
      phase: 'gather',
      goal: null,
      node: null,
      enemy: null,
      home: this.adoptHut(p),
      buildStep: 0,
      spotTries: 0,
      raidAt: now + this.between(RAID_EVERY) * 1000,
      raid: null,
      deadAt: 0,
      nextShotAt: 0,
      strafe: 1,
      strafeUntil: 0,
      cover: null,
      blind: new Map(),
      coverLookAt: 0,
      hideUntil: 0,
      peekUntil: 0,
      sawAt: 0,
      sightAt: 0,
      flank: null,
      flankedAt: 0,
      nextHealAt: 0,
      lastPos: { x: p.x, z: p.z, at: now },
    });
    // Others still hear that someone joined; the bot itself has nobody to send to.
    return joined.out.filter((o) => o.to !== joined.id);
  }

  /** Moves a fresh spawn a few metres from the spawn point, so bots arriving together spread out. */
  private scatter(p: Survivor) {
    const a = this.rand() * Math.PI * 2;
    const r = 3 + this.rand() * 9;
    const x = Math.max(-HALF_WORLD + 2, Math.min(HALF_WORLD - 2, p.x + Math.cos(a) * r));
    const z = Math.max(-HALF_WORLD + 2, Math.min(HALF_WORLD - 2, p.z + Math.sin(a) * r));
    if (this.walled(x, terrainHeight(this.game.seed, x, z), z)) return;
    p.x = x;
    p.z = z;
    p.y = terrainHeight(this.game.seed, x, z);
  }

  /** A hatchet, a weapon with ammunition, loaded, and two bandages, on top of the starting rock and building plan. */
  private kit(p: Survivor) {
    const [weapon, ammo, rounds] = LOADOUTS[Math.floor(this.rand() * LOADOUTS.length)];
    addItem(p.slots, 'stoneHatchet', 1);
    addItem(p.slots, weapon, 1);
    addItem(p.slots, ammo, rounds);
    addItem(p.slots, 'bandage', 2);
    const gun = p.slots.find((s) => s?.item === weapon);
    if (gun) gun.ammo = ITEMS[weapon].weapon?.mag ?? 1;
  }

  /** An empty bot hut left from before a restart, for a new bot to call home. */
  private adoptHut(p: Survivor): Bot['home'] {
    const taken = new Set([...this.bots.values()].map((b) => b.home?.door));
    let best: Bot['home'] = null;
    let bestD = Infinity;
    for (const [key, piece] of this.game.pieces) {
      if (!piece.bot || !piece.door || taken.has(key)) continue;
      const d = Math.hypot(piece.i * TILE - p.x, piece.k * TILE - p.z);
      if (d < bestD) {
        bestD = d;
        best = { i: piece.i, k: piece.k, y: piece.y, door: key };
      }
    }
    return best;
  }

  tick(now: number): Outgoing[] {
    const dt = this.lastTick < 0 ? 0 : Math.min((now - this.lastTick) / 1000, 0.5);
    this.lastTick = now;
    const out: Outgoing[] = [];
    for (const bot of this.bots.values()) {
      const p = this.game.players.get(bot.id);
      if (!p) {
        this.bots.delete(bot.id);
        continue;
      }
      out.push(...this.think(bot, p, now, dt));
    }
    // Nobody is listening for a bot's own messages.
    return out.filter((o) => typeof o.to !== 'number' || !this.bots.has(o.to));
  }

  private think(bot: Bot, p: Survivor, now: number, dt: number): Outgoing[] {
    if (p.dead) {
      if (!bot.deadAt) bot.deadAt = now;
      if (now - bot.deadAt < RESPAWN_AFTER * 1000) return [];
      bot.deadAt = 0;
      bot.phase = bot.home ? 'roam' : 'gather';
      bot.raid = null;
      this.calm(bot);
      bot.goal = null;
      const out = this.game.respawn(bot.id, undefined, now);
      this.scatter(p);
      out.push(...this.game.move(bot.id, p.x, p.y, p.z, p.yaw, false, now, 0));
      this.kit(p);
      return out;
    }
    // Bots don't need to eat; keeping them fed stops them starving where nobody sees.
    p.vitals.food = Math.max(p.vitals.food, 150);
    p.vitals.water = Math.max(p.vitals.water, 150);
    p.vitals.rads = 0;

    const foe = this.findEnemy(bot, p, now);
    if (foe) {
      bot.enemy = foe;
      return this.fight(bot, p, now, dt);
    }
    if (bot.enemy) this.calm(bot);
    if (bot.phase === 'fight') bot.phase = bot.raid ? 'raid' : bot.home ? 'roam' : 'gather';
    if (bot.phase !== 'raid' && bot.home && now > bot.raidAt && this.pickRaid(bot, p)) bot.phase = 'raid';
    switch (bot.phase) {
      case 'gather':
        return this.gather(bot, p, now, dt);
      case 'build':
        return this.build(bot, p, now, dt);
      case 'raid':
        return this.doRaid(bot, p, now, dt);
      default:
        return this.roam(bot, p, now, dt);
    }
  }

  // Fighting.

  private findEnemy(bot: Bot, p: Survivor, now: number): Bot['enemy'] {
    const shotBy = this.game.lastHurtBy(p.id, 8);
    if (bot.enemy) {
      const at = this.enemyAt(bot.enemy);
      const limit = bot.enemy.kind === 'player' && bot.enemy.id === shotBy ? GIVE_UP_SHOT : GIVE_UP;
      if (at && Math.hypot(at.x - p.x, at.z - p.z) < limit) return bot.enemy;
    }
    let best: Bot['enemy'] = null;
    let bestD = Infinity;
    for (const other of this.game.players.values()) {
      if (other.id === p.id || other.dead) continue;
      const mate = this.bots.get(other.id);
      if (mate && mate.crew === bot.crew) continue;
      // Fresh spawns get a minute's grace, so nobody is shot before they've found their feet,
      // unless they start it.
      if (!mate && other.id !== shotBy && now < other.safeUntil + GRACE * 1000) continue;
      const d = Math.hypot(other.x - p.x, other.z - p.z);
      // Whoever just shot it, from however far, or anyone close.
      const reach = other.id === shotBy ? GIVE_UP_SHOT : mate ? ENGAGE_BOT : ENGAGE;
      if (d < reach && d < bestD) {
        best = { kind: 'player', id: other.id };
        bestD = d;
      }
    }
    // Wild animals that have come for it.
    for (const h of this.game.hounds.values()) {
      if (h.hp <= 0 || h.target?.kind !== 'player' || h.target.id !== p.id) continue;
      const d = Math.hypot(h.x - p.x, h.z - p.z);
      if (d < 20 && d < bestD) {
        best = { kind: 'hound', id: h.id };
        bestD = d;
      }
    }
    if (best) return best;
    // A crewmate in a gunfight nearby: go and help.
    for (const mate of this.bots.values()) {
      if (mate === bot || mate.crew !== bot.crew || mate.enemy?.kind !== 'player') continue;
      const m = this.game.players.get(mate.id);
      const foe = this.game.players.get(mate.enemy.id);
      if (!m || m.dead || !foe || foe.dead || this.bots.get(foe.id)?.crew === bot.crew) continue;
      if (Math.hypot(m.x - p.x, m.z - p.z) < HELP && Math.hypot(foe.x - p.x, foe.z - p.z) < HELP) return mate.enemy;
    }
    return null;
  }

  /** Forgets the fight it was in. */
  private calm(bot: Bot) {
    bot.enemy = null;
    bot.cover = null;
    bot.flank = null;
    bot.sawAt = bot.sightAt = 0;
    bot.blind.clear();
  }

  private enemyAt(e: NonNullable<Bot['enemy']>): { x: number; y: number; z: number; height: number } | null {
    if (e.kind === 'player') {
      const t = this.game.players.get(e.id);
      return t && !t.dead ? { x: t.x, y: t.y, z: t.z, height: PLAYER_HEIGHT * 0.7 } : null;
    }
    const h = this.game.hounds.get(e.id);
    return h && h.hp > 0 ? { x: h.x, y: h.y, z: h.z, height: 0.6 } : null;
  }

  private fight(bot: Bot, p: Survivor, now: number, dt: number): Outgoing[] {
    bot.phase = 'fight';
    const t = this.enemyAt(bot.enemy!)!;
    const gunSlot = this.beltSlot(p, (s) => !!ITEMS[s.item].weapon && ITEMS[s.item].weapon!.class !== 'melee');
    const gun = gunSlot >= 0 ? p.slots[gunSlot]! : null;
    const w = gun ? ITEMS[gun.item].weapon! : null;
    const hasAmmo = !!gun && ((gun.ammo ?? 0) > 0 || countItem(p.slots, w!.ammo!) > 0);
    // Against people it fights like one; an animal, or with nothing to shoot, it just goes at.
    if (hasAmmo && bot.enemy!.kind === 'player') return this.gunfight(bot, p, t, gunSlot, now, dt);
    return this.brawl(bot, p, t, hasAmmo ? gunSlot : -1, now, dt);
  }

  /** Out in the open: keeps at range sidestepping, or with nothing to shoot, closes in to swing. */
  private brawl(bot: Bot, p: Survivor, t: NonNullable<ReturnType<Bots['enemyAt']>>, gunSlot: number, now: number, dt: number): Outgoing[] {
    const gun = gunSlot >= 0 ? p.slots[gunSlot]! : null;
    const w = gun ? ITEMS[gun.item].weapon! : null;
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const dist = Math.hypot(dx, dz);
    const out: Outgoing[] = [];
    const want = w ? Math.min(w.range * 0.4, 14) : 1.2;
    if (now > bot.strafeUntil) {
      bot.strafe = this.rand() < 0.5 ? -1 : 1;
      bot.strafeUntil = now + 900 + this.rand() * 1400;
    }
    const ux = dx / (dist || 1);
    const uz = dz / (dist || 1);
    const closing = dist > want + 2 ? 1 : dist < want - 3 ? -0.7 : 0;
    const vx = ux * closing + -uz * bot.strafe * (w ? 0.6 : 0);
    const vz = uz * closing + ux * bot.strafe * (w ? 0.6 : 0);
    out.push(...this.step(bot, p, vx, vz, PLAYER_SPEED * 0.9, Math.atan2(-dx, -dz), now, dt, gun ? gunSlot : 0));
    if (now < bot.nextShotAt) return out;
    if (gun && w) {
      const shot = this.shoot(bot, p, t, gunSlot, now);
      return shot ? [...out, ...shot] : out;
    }
    if (dist < 2.2) {
      bot.nextShotAt = now + 700;
      return [...out, ...this.game.melee(bot.id, 0, this.aim(p, t, t.y + t.height), now)];
    }
    return out;
  }

  /**
   * A gunfight with a person. It gets behind the nearest tree, rock, wreck or wall that hides it
   * from them, leans out to fire a few shots and ducks back, reloads and bandages out of sight,
   * and when it has lost sight of them for a while (or a crewmate is already pinning them down)
   * it swings round to come at them from the side.
   */
  private gunfight(bot: Bot, p: Survivor, t: NonNullable<ReturnType<Bots['enemyAt']>>, gunSlot: number, now: number, dt: number): Outgoing[] {
    const gun = p.slots[gunSlot]!;
    const w = ITEMS[gun.item].weapon!;
    const dist = Math.hypot(t.x - p.x, t.z - p.z);
    const want = Math.min(w.range * 0.4, 14);
    const view = this.sight(p, t);
    if (view !== null) {
      // A beat to react when someone first comes into view, so it can be outdrawn.
      if (now - bot.sawAt > 1500) {
        bot.sightAt = now;
        bot.nextShotAt = Math.max(bot.nextShotAt, now + 350 + this.rand() * 350);
      }
      bot.sawAt = now;
    } else if (!bot.sawAt) bot.sawAt = now;
    const reloading = (gun.ammo ?? 0) === 0;
    const bandage = this.beltOrPack(p, 'bandage');
    const patching = p.hp < HURT && bandage;
    const yaw = Math.atan2(-(t.x - p.x), -(t.z - p.z));
    const run = (x: number, z: number, near = 0.35) => {
      const dx = x - p.x;
      const dz = z - p.z;
      const d = Math.hypot(dx, dz);
      if (d <= near) return this.step(bot, p, 0, 0, 0, yaw, now, dt, gunSlot);
      return this.step(bot, p, dx / d, dz / d, PLAYER_SPEED * (d > 3 ? 0.95 : 0.6), yaw, now, dt, gunSlot);
    };

    // Going round the side: until it gets there, or sees them well from the new angle.
    if (bot.flank) {
      const there = Math.hypot(bot.flank.x - p.x, bot.flank.z - p.z) < 1.5;
      const seen = view !== null && now - bot.sightAt > 600 && this.angleRound(bot, p, t) > 0.6;
      if (there || seen || now > bot.flank.until) {
        bot.flank = null;
        bot.cover = null;
      } else {
        const out = run(bot.flank.x, bot.flank.z);
        return [...out, ...(this.shootIfClear(bot, p, t, gunSlot, view, now) ?? [])];
      }
    }
    if (this.shouldFlank(bot, p, t, view, now, reloading || !!patching)) {
      const spot = this.flankSpot(bot, p, t, want);
      if (spot) {
        bot.flank = { ...spot, until: now + 9000 };
        bot.flankedAt = now;
        bot.cover = null;
        return run(spot.x, spot.z);
      }
    }

    // Keep the cover it has while it still hides it; look again every so often.
    if (bot.cover && now > bot.cover.checkAt) {
      const spot = this.coverSpot(bot.cover.c, t);
      const ok = this.hides(t, spot) && Math.hypot(spot.x - p.x, spot.z - p.z) < COVER_RUN && Math.hypot(spot.x - t.x, spot.z - t.z) > 4;
      if (ok) bot.cover.checkAt = now + 1000;
      else bot.cover = null;
    }
    if (!bot.cover && now >= bot.coverLookAt) {
      bot.cover = this.findCover(bot, p, t, want, w.range, now);
      if (!bot.cover) bot.coverLookAt = now + 1000;
      if (bot.cover) {
        // Get there and settle before the first lean out.
        bot.hideUntil = now + 500;
        bot.peekUntil = bot.hideUntil + 1600 + this.rand() * 1400;
      }
    }

    if (!bot.cover) {
      // Nothing to hide behind: fight in the open, closing in when it can't see them.
      if (view === null && now - bot.sawAt > 1500) {
        const out = run(t.x, t.z, want * 0.6);
        return out;
      }
      return this.brawl(bot, p, t, gunSlot, now, dt);
    }

    const c = bot.cover;
    const hide = this.coverSpot(c.c, t);
    const out: Outgoing[] = [];
    // Hiding to reload or bandage, or between leans.
    if (reloading || patching || now < bot.hideUntil) {
      out.push(...run(hide.x, hide.z));
      const behind = Math.hypot(hide.x - p.x, hide.z - p.z) < 0.8;
      if (reloading && now >= bot.nextShotAt) {
        bot.nextShotAt = now + (w.reload ?? 1) * 1000 + 200;
        bot.hideUntil = Math.max(bot.hideUntil, bot.nextShotAt);
        bot.peekUntil = bot.hideUntil + 1600 + this.rand() * 1400;
        out.push(...this.game.reload(bot.id, gunSlot, now));
      }
      if (patching && behind && now >= bot.nextHealAt) {
        bot.nextHealAt = now + 1200;
        out.push(...this.game.use(bot.id, this.ensureInBelt(p, 'bandage'), now));
      }
      return out;
    }
    if (now > bot.peekUntil) {
      // Back in for a moment, then out again, sometimes from the other side. Out of both sides
      // with nothing to shoot at, this cover is no good: find another, or go round.
      if (!c.saw && ++c.blind >= 2) {
        bot.blind.set(c.c, now + 15000);
        bot.cover = null;
        return run(hide.x, hide.z);
      }
      bot.hideUntil = now + 700 + this.rand() * 1300;
      bot.peekUntil = bot.hideUntil + 1400 + this.rand() * 1600;
      if (!c.saw || this.rand() < 0.3) c.side = this.peekSide(c.c, t, -c.side).side;
      if (c.saw) c.blind = 0;
      c.saw = false;
      return run(hide.x, hide.z);
    }
    const peek = this.peekSpot(c.c, t, c.side);
    if (view !== null && Math.hypot(peek.x - p.x, peek.z - p.z) < 0.5) c.saw = true;
    out.push(...run(peek.x, peek.z, 0.25));
    out.push(...(this.shootIfClear(bot, p, t, gunSlot, view, now) ?? []));
    return out;
  }

  /** Fires (or reloads) if it has a clear line to its enemy and its next shot is ready. */
  private shootIfClear(bot: Bot, p: Survivor, t: NonNullable<ReturnType<Bots['enemyAt']>>, gunSlot: number, view: number | null, now: number): Outgoing[] | null {
    if (view === null || now < bot.nextShotAt) return null;
    return this.shoot(bot, p, t, gunSlot, now, view);
  }

  private shoot(bot: Bot, p: Survivor, t: NonNullable<ReturnType<Bots['enemyAt']>>, gunSlot: number, now: number, at = t.y + t.height): Outgoing[] | null {
    const gun = p.slots[gunSlot]!;
    const w = ITEMS[gun.item].weapon!;
    if ((gun.ammo ?? 0) === 0) {
      bot.nextShotAt = now + (w.reload ?? 1) * 1000 + 200;
      return this.game.reload(bot.id, gunSlot, now);
    }
    if (Math.hypot(t.x - p.x, t.z - p.z) > w.range * 0.9) return null;
    bot.nextShotAt = now + Math.max(w.delay * 1000, 450) + this.rand() * 250;
    return this.game.fire(bot.id, gunSlot, this.aim(p, t, at), false, now);
  }

  /** Where to aim at the enemy's height `at`, a little off, so bots can be outshot. */
  private aim(p: Survivor, t: { x: number; z: number }, at: number): Vec3 {
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const dy = at - (p.y + EYE_HEIGHT);
    const len = Math.hypot(dx, dy, dz) || 1;
    const e = () => (this.rand() - 0.5) * 2 * AIM_ERROR;
    return [dx / len + e(), dy / len + e(), dz / len + e()];
  }

  /** The height on its enemy it has a clear line to from where it stands (chest, else head), or null. */
  private sight(p: Survivor, t: NonNullable<ReturnType<Bots['enemyAt']>>): number | null {
    const eye: Vec3 = [p.x, p.y + EYE_HEIGHT, p.z];
    for (const y of [t.y + t.height, t.y + EYE_HEIGHT]) if (this.clear(eye, [t.x, y, t.z])) return y;
    return null;
  }

  /** True when nothing solid stands between two points. */
  private clear(from: Vec3, to: Vec3): boolean {
    const d: Vec3 = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
    const len = Math.hypot(...d);
    if (len < 0.01) return true;
    return this.game.obstacle(from, [d[0] / len, d[1] / len, d[2] / len], len) >= len - 0.3;
  }

  /** True when a survivor standing at `spot` is hidden, chest and all, from the enemy's eyes. */
  private hides(t: { x: number; y: number; z: number }, spot: { x: number; z: number }): boolean {
    const gy = terrainHeight(this.game.seed, spot.x, spot.z);
    const eye: Vec3 = [t.x, t.y + EYE_HEIGHT, t.z];
    return !this.clear(eye, [spot.x, gy + 1.1, spot.z]) && !this.clear(eye, [spot.x, gy + 0.6, spot.z]);
  }

  /** Just behind a piece of cover, on the far side from the enemy. */
  private coverSpot(c: Cover, t: { x: number; z: number }): { x: number; z: number } {
    const [ux, uz] = unit(c.x - t.x, c.z - t.z);
    const back = coverExtent(c, ux, uz) + PLAYER_RADIUS + 0.4;
    return { x: c.x + ux * back, z: c.z + uz * back };
  }

  /** Leaning out of one side of a piece of cover, far enough to see past it. */
  private peekSpot(c: Cover, t: { x: number; z: number }, side: number): { x: number; z: number } {
    const [ux, uz] = unit(c.x - t.x, c.z - t.z);
    const back = coverExtent(c, ux, uz) + PLAYER_RADIUS + 0.4;
    const out = coverExtent(c, -uz, ux) + PLAYER_RADIUS + 0.35;
    return { x: c.x + ux * back - uz * side * out, z: c.z + uz * back + ux * side * out };
  }

  /** The side of a piece of cover it can see its enemy from, `prefer` if both will do, and whether either will. */
  private peekSide(c: Cover, t: NonNullable<ReturnType<Bots['enemyAt']>>, prefer: number): { side: number; sees: boolean } {
    for (const side of [prefer, -prefer]) {
      const s = this.peekSpot(c, t, side);
      const gy = terrainHeight(this.game.seed, s.x, s.z);
      if (this.walled(s.x, gy, s.z)) continue;
      if (this.clear([s.x, gy + EYE_HEIGHT, s.z], [t.x, t.y + t.height, t.z])) return { side, sees: true };
    }
    return { side: prefer, sees: false };
  }

  /** The best thing to hide behind within a short run, not too close to the enemy nor out of range. */
  private findCover(bot: Bot, p: Survivor, t: NonNullable<ReturnType<Bots['enemyAt']>>, want: number, range: number, now: number): Bot['cover'] {
    const seed = this.game.seed;
    const taken = [...this.bots.values()].filter((b) => b !== bot && b.cover).map((b) => b.cover!.c);
    let best: Cover | null = null;
    let bestSide = { side: 1, sees: false };
    let bestScore = Infinity;
    for (const c of this.game.cover.near(p.x, p.z, COVER_RUN)) {
      if ((bot.blind.get(c) ?? 0) > now) continue;
      const spot = this.coverSpot(c, t);
      const gy = terrainHeight(seed, spot.x, spot.z);
      if (c.top - gy < COVER_LOW) continue;
      const run = Math.hypot(spot.x - p.x, spot.z - p.z);
      const from = Math.hypot(spot.x - t.x, spot.z - t.z);
      if (run > COVER_RUN || from < 5 || from > range * 0.85) continue;
      if (this.walled(spot.x, gy, spot.z) || radiationAt(seed, spot.x, spot.z) > 0) continue;
      // Taller than a head is better; a crewmate's spot is theirs; nearer to the range it likes is better.
      let score = run + Math.abs(from - want) * 0.35 + (c.top - gy < EYE_HEIGHT + 0.25 ? 3 : 0);
      if (taken.includes(c)) score += 25;
      if (score >= bestScore || !this.hides(t, spot)) continue;
      // Somewhere it can lean out and see them from, if it can.
      const side = this.peekSide(c, t, this.rand() < 0.5 ? -1 : 1);
      if (!side.sees) score += 12;
      if (score >= bestScore) continue;
      best = c;
      bestSide = side;
      bestScore = score;
    }
    if (!best) return null;
    return { c: best, side: bestSide.side, checkAt: now + 1000, saw: false, blind: 0 };
  }

  /**
   * Time to go round the side: when a crewmate is already in this fight and this bot is the
   * one to swing wide, or when it hasn't seen its enemy for a while. Not while hiding to
   * reload or bandage, and not again too soon.
   */
  private shouldFlank(bot: Bot, p: Survivor, t: { x: number; z: number }, view: number | null, now: number, busy: boolean): boolean {
    if (busy || now - bot.flankedAt < 12000) return false;
    if (Math.hypot(t.x - p.x, t.z - p.z) < 7) return false;
    if (this.crew(bot).indexOf(bot) > 0 && now - bot.flankedAt > 20000) return true;
    return view === null && now - bot.sawAt > FLANK_AFTER * 1000;
  }

  /** Its crewmates in the same fight, itself among them, in a fixed order. */
  private crew(bot: Bot): Bot[] {
    const e = bot.enemy;
    return [...this.bots.values()].filter((b) => b.crew === bot.crew && b.enemy?.kind === e?.kind && b.enemy?.id === e?.id).sort((a, b) => a.id - b.id);
  }

  /** How far round its enemy it has come from where its first crewmate is shooting from, in radians. */
  private angleRound(bot: Bot, p: Survivor, t: { x: number; z: number }): number {
    const lead = this.crew(bot).find((b) => b !== bot);
    const q = lead && this.game.players.get(lead.id);
    if (!q) return Math.PI;
    const a = Math.atan2(p.z - t.z, p.x - t.x) - Math.atan2(q.z - t.z, q.x - t.x);
    return Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
  }

  /** A spot swung round the enemy from where it stands, preferring cover there. */
  private flankSpot(bot: Bot, p: Survivor, t: NonNullable<ReturnType<Bots['enemyAt']>>, want: number): { x: number; z: number } | null {
    const seed = this.game.seed;
    const team = this.crew(bot);
    const n = team.indexOf(bot);
    // Crewmates go opposite ways; on its own it picks a side.
    const first = n > 0 ? (n % 2 ? 1 : -1) : this.rand() < 0.5 ? -1 : 1;
    const from = Math.atan2(p.z - t.z, p.x - t.x);
    const r = Math.max(8, Math.min(Math.hypot(p.x - t.x, p.z - t.z), want + 4));
    for (const side of [first, -first]) {
      for (const swing of [FLANK_ANGLE, FLANK_ANGLE * 0.6]) {
        const a = from + side * swing;
        const x = t.x + Math.cos(a) * r;
        const z = t.z + Math.sin(a) * r;
        if (Math.abs(x) > HALF_WORLD - 4 || Math.abs(z) > HALF_WORLD - 4 || radiationAt(seed, x, z) > 0) continue;
        if (this.walled(x, terrainHeight(seed, x, z), z)) continue;
        // Something to duck behind when it gets there, if there is anything close by.
        let spot = { x, z };
        let bestD = 6;
        for (const c of this.game.cover.near(x, z, 6)) {
          const s = this.coverSpot(c, t);
          const d = Math.hypot(s.x - x, s.z - z);
          if (d < bestD && c.top - terrainHeight(seed, s.x, s.z) >= COVER_LOW && !this.walled(s.x, terrainHeight(seed, s.x, s.z), s.z)) {
            spot = s;
            bestD = d;
          }
        }
        return spot;
      }
    }
    return null;
  }

  // Wood, and a hut.

  private gather(bot: Bot, p: Survivor, now: number, dt: number): Outgoing[] {
    if (countItem(p.slots, 'wood') >= HUT_WOOD) {
      bot.node = null;
      bot.phase = bot.home ? 'roam' : 'build';
      bot.buildStep = 0;
      bot.goal = null;
      return [];
    }
    if (!bot.node || bot.node.amount <= 0) {
      bot.node = this.nearestNode(p, ['tree', 'deadTree']);
      if (!bot.node) return this.roam(bot, p, now, dt);
    }
    const n = bot.node;
    const reach = 2.2 + RESOURCE_INFO[n.kind].radius;
    if (Math.hypot(n.x - p.x, n.z - p.z) > reach) return this.walkTo(bot, p, n.x, n.z, reach - 0.4, now, dt);
    const slot = this.beltSlot(p, (s) => s.item === 'stoneHatchet');
    const use = slot >= 0 ? slot : 0;
    const out = this.face(p, n.x, n.z, now, use);
    return [...out, ...this.game.gather(bot.id, n.id, now, use)];
  }

  private nearestNode(p: Survivor, kinds: ResourceNode['kind'][]): ResourceNode | null {
    let best: ResourceNode | null = null;
    let bestD = 150;
    for (const n of this.game.resources) {
      if (!kinds.includes(n.kind) || n.amount <= 0) continue;
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < bestD && radiationAt(this.game.seed, n.x, n.z) === 0) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }

  private build(bot: Bot, p: Survivor, now: number, dt: number): Outgoing[] {
    if (bot.buildStep === 0 && bot.home) {
      // Back to fix up the hut it has: whatever is missing gets put back.
      bot.goal = { x: bot.home.i * TILE + TILE / 2, z: bot.home.k * TILE - 2.2, near: 0.6 };
      bot.buildStep = 1;
    }
    if (!bot.goal || bot.buildStep === 0) {
      const spot = this.findSpot(p);
      if (!spot || bot.spotTries > 6) {
        // Nowhere to build round here: live without a hut for now.
        bot.phase = 'roam';
        bot.spotTries = 0;
        return [];
      }
      bot.spotTries++;
      bot.home = { ...spot, door: pieceKey({ kind: 'wall', i: spot.i, y: spot.y, k: spot.k, dir: 0 }) };
      bot.goal = { x: spot.i * TILE + TILE / 2, z: spot.k * TILE - 2.2, near: 0.6 };
      bot.buildStep = 1;
    }
    const home = bot.home!;
    const g = bot.goal!;
    if (Math.hypot(g.x - p.x, g.z - p.z) > g.near) return this.walkTo(bot, p, g.x, g.z, g.near, now, dt);
    if (now < bot.nextShotAt) return [];
    bot.nextShotAt = now + 600;
    return this.buildNext(bot, p, home, now);
  }

  /** One step of the hut each call: floor, box and cupboard, walls, ceiling, doorway, door and lock. */
  private buildNext(bot: Bot, p: Survivor, home: NonNullable<Bot['home']>, now: number): Outgoing[] {
    const { i, k, y } = home;
    const game = this.game;
    const plan = this.ensureInBelt(p, 'buildingPlan');
    const pieces: Pick<Piece, 'kind' | 'i' | 'y' | 'k' | 'dir'>[] = [
      { kind: 'floor', i, y, k, dir: 0 },
      { kind: 'wall', i, y, k: k + 1, dir: 0 },
      { kind: 'wall', i, y, k, dir: 1 },
      { kind: 'wall', i: i + 1, y, k, dir: 1 },
      { kind: 'wall', i, y, k, dir: 0 },
      { kind: 'floor', i, y: y + STOREY, k, dir: 0 },
    ];
    const step = bot.buildStep;
    const fail = () => {
      // Something was in the way: tear up the plan and look for somewhere else.
      bot.buildStep = 0;
      bot.goal = null;
      bot.home = null;
      return [];
    };
    if (step === 1 || (step >= 4 && step <= 8)) {
      const piece = pieces[step === 1 ? 0 : step - 3];
      const key = pieceKey(piece);
      if (!game.pieces.has(key)) {
        game.players.get(bot.id)!.active = plan;
        const out = game.place(bot.id, piece.kind, piece.i, piece.y, piece.k, piece.dir, 'wood');
        const placed = game.pieces.get(key);
        if (!placed) return step === 1 ? fail() : (bot.buildStep++, out);
        placed.bot = true;
        bot.buildStep++;
        return out;
      }
      bot.buildStep++;
      return [];
    }
    if (step === 2 || step === 3) {
      // A box with some loot in it, and a cupboard to claim the land.
      const kind = step === 2 ? 'storageBox' : 'toolCupboard';
      addItem(p.slots, kind, 1);
      const slot = this.ensureInBelt(p, kind);
      const x = i * TILE + (step === 2 ? 0.8 : 2.2);
      const z = k * TILE + 2.4;
      const out = game.deploy(bot.id, slot, x, y, z, Math.PI);
      const d = [...game.deployables.values()].find((d) => d.owner === bot.id && d.kind === kind && Math.hypot(d.x - x, d.z - z) < 0.1);
      if (d && kind === 'storageBox') this.stock(d.slots);
      if (!d) p.slots[slot] = null;
      bot.buildStep++;
      return out;
    }
    if (step === 9) {
      bot.buildStep++;
      return game.edit(bot.id, home.door, 'door');
    }
    if (step === 10) {
      addItem(p.slots, 'woodenDoor', 1);
      bot.buildStep++;
      return game.hangDoor(bot.id, home.door, this.ensureInBelt(p, 'woodenDoor'));
    }
    if (step === 11) {
      addItem(p.slots, 'codeLock', 1);
      bot.buildStep = 0;
      bot.goal = null;
      bot.phase = 'roam';
      const code = String(Math.floor(this.rand() * 10000)).padStart(4, '0');
      const out = game.lock(bot.id, home.door, this.ensureInBelt(p, 'codeLock'), code);
      // Close it, so it has to be raided.
      const door = game.pieces.get(home.door)?.door;
      if (door?.open) door.open = false;
      if (!game.pieces.get(home.door)?.door) bot.home = null;
      return out;
    }
    bot.buildStep = 0;
    return [];
  }

  /** What a raider finds in a bot's box: a little of everything worth taking. */
  private stock(slots: Slots) {
    const r = () => this.rand();
    addItem(slots, 'scrap', 40 + Math.floor(r() * 120));
    addItem(slots, 'metal', 50 + Math.floor(r() * 150));
    addItem(slots, 'cloth', 10 + Math.floor(r() * 40));
    if (r() < 0.6) addItem(slots, 'pistolAmmo', 20 + Math.floor(r() * 40));
    if (r() < 0.5) addItem(slots, 'gunpowder', 20 + Math.floor(r() * 60));
    if (r() < 0.3) addItem(slots, 'bandage', 2);
  }

  /** A clear, flat tile near where it stands, away from other buildings, landmarks and radiation. */
  private findSpot(p: Survivor): { i: number; k: number; y: number } | null {
    const seed = this.game.seed;
    for (let r = 4; r < 50; r += 3) {
      for (let a = this.rand() * 6; a < this.rand() * 6 + Math.PI * 2; a += 0.5) {
        const i = Math.round((p.x + Math.cos(a) * r) / TILE);
        const k = Math.round((p.z + Math.sin(a) * r) / TILE);
        const cx = i * TILE + TILE / 2;
        const cz = k * TILE + TILE / 2;
        if (Math.abs(cx) > HALF_WORLD - 12 || Math.abs(cz) > HALF_WORLD - 12) continue;
        if (atLandmark(seed, cx, cz, 10) || radiationAt(seed, cx, cz) > 0) continue;
        const y = buildBaseY(seed, cx, cz);
        let flat = true;
        // Ground no higher than the floor, so nobody walking in through the doorway hits their
        // head, and in front of the doorway no more than a step below it.
        for (let dx = -1; dx <= 4 && flat; dx++) {
          for (let dz = -3; dz <= 4 && flat; dz++) {
            const h = terrainHeight(seed, i * TILE + dx, k * TILE + dz) - y;
            flat = h > (dz < 1 && dx >= 0 && dx <= 3 ? -0.25 : -0.8) && h < 0.15;
          }
        }
        if (!flat) continue;
        if (this.game.resources.some((n) => Math.hypot(n.x - cx, n.z - cz) < 4 + RESOURCE_INFO[n.kind].radius)) continue;
        if ([...this.game.pieces.values()].some((q) => Math.hypot(q.i * TILE - cx, q.k * TILE - cz) < 14)) continue;
        if ([...this.game.deployables.values()].some((d) => Math.hypot(d.x - cx, d.z - cz) < 8)) continue;
        return { i, k, y };
      }
    }
    return null;
  }

  // Wandering and raiding.

  private roam(bot: Bot, p: Survivor, now: number, dt: number): Outgoing[] {
    if (!bot.home && countItem(p.slots, 'wood') < HUT_WOOD) {
      bot.phase = 'gather';
      return [];
    }
    // Homeless with wood to spare, or home raided: every so often, build or mend it.
    const door = bot.home && this.game.pieces.get(bot.home.door)?.door;
    if ((!bot.home && this.rand() < 0.002) || (bot.home && (!door || !door.locked) && this.rand() < 0.01)) {
      if (countItem(p.slots, 'wood') < 80) addItem(p.slots, 'wood', 80);
      bot.phase = 'build';
      bot.buildStep = 0;
      return [];
    }
    if (!bot.goal || Math.hypot(bot.goal.x - p.x, bot.goal.z - p.z) <= bot.goal.near) {
      // Somewhere within a stroll of home (or of here), never into a hot crater.
      const cx = bot.home ? bot.home.i * TILE : p.x;
      const cz = bot.home ? bot.home.k * TILE : p.z;
      for (let tries = 0; tries < 8; tries++) {
        const a = this.rand() * Math.PI * 2;
        const r = 10 + this.rand() * 45;
        const x = Math.max(-HALF_WORLD + 10, Math.min(HALF_WORLD - 10, cx + Math.cos(a) * r));
        const z = Math.max(-HALF_WORLD + 10, Math.min(HALF_WORLD - 10, cz + Math.sin(a) * r));
        if (radiationAt(this.game.seed, x, z) > 0) continue;
        bot.goal = { x, z, near: 1.5 };
        break;
      }
      if (!bot.goal) return [];
    }
    return this.walkTo(bot, p, bot.goal.x, bot.goal.z, bot.goal.near, now, dt, 0.55);
  }

  /** Someone else's door within a long walk, human-built ones first, then other bots' huts. */
  private pickRaid(bot: Bot, p: Survivor): boolean {
    let best: string | null = null;
    let bestScore = Infinity;
    for (const [key, piece] of this.game.pieces) {
      if (!piece.door || key === bot.home?.door) continue;
      const d = Math.hypot(piece.i * TILE - p.x, piece.k * TILE - p.z);
      if (d > 220) continue;
      // Bots mostly leave each other's huts alone; it's real players' bases they come for.
      if (piece.bot && this.rand() < 0.75) continue;
      const score = d + (piece.bot ? 120 : 0);
      if (score < bestScore) {
        best = key;
        bestScore = score;
      }
    }
    if (!best) {
      bot.raidAt = this.lastTick + this.between(RAID_EVERY) * 1000;
      return false;
    }
    bot.raid = { key: best, planted: 0, leaveAt: 0, door: null, lootUntil: 0, nextTake: 0 };
    bot.goal = null;
    return true;
  }

  private doRaid(bot: Bot, p: Survivor, now: number, dt: number): Outgoing[] {
    const raid = bot.raid!;
    const piece = this.game.pieces.get(raid.key);
    const done = () => {
      bot.raid = null;
      bot.phase = 'roam';
      bot.goal = null;
      bot.raidAt = now + this.between(RAID_EVERY) * 1000;
      return [];
    };
    // The door is down: go in and empty the boxes.
    if (!piece?.door) return raid.door ? this.loot(bot, p, raid, now, dt, done) : done();
    // Wait out the fuse at a safe distance, then go again if the door held.
    if (raid.leaveAt) {
      if (now < raid.leaveAt) return this.walkTo(bot, p, bot.goal!.x, bot.goal!.z, 1, now, dt);
      if (raid.planted >= 4) return done();
      raid.leaveAt = 0;
    }
    const { x: dx, z: dz, nx, nz } = this.doorFace(piece, p);
    const standX = dx + nx * 1.6;
    const standZ = dz + nz * 1.6;
    if (Math.hypot(standX - p.x, standZ - p.z) > 0.7) return this.walkTo(bot, p, standX, standZ, 0.6, now, dt);
    if (countItem(p.slots, 'satchel') < 1) addItem(p.slots, 'satchel', 2);
    const slot = this.ensureInBelt(p, 'satchel');
    const out = this.face(p, dx, dz, now, slot);
    const at: [number, number, number] = [dx + nx * 0.12, piece.y + 1.1, dz + nz * 0.12];
    out.push(...this.game.plant(bot.id, slot, at, now, raid.key, true));
    raid.planted++;
    raid.door = { x: dx, z: dz, nx, nz };
    // Run back out of the blast and wait.
    raid.leaveAt = now + 9000;
    bot.goal = { x: dx + nx * 12, z: dz + nz * 12, near: 1 };
    return out;
  }

  /**
   * Through the broken doorway to the boxes inside, taking one stack at a time until they are
   * empty, its pockets are full or a minute is up. What it takes drops with it when it dies.
   */
  private loot(bot: Bot, p: Survivor, raid: Raid, now: number, dt: number, done: () => Outgoing[]): Outgoing[] {
    const door = raid.door!;
    raid.lootUntil ||= now + LOOT_FOR * 1000;
    if (now > raid.lootUntil) return done();
    const inward = (x: number, z: number) => (door.x - x) * door.nx + (door.z - z) * door.nz;
    let box: Deployable | null = null;
    let best = Infinity;
    for (const d of this.game.deployables.values()) {
      if (!LOOTED.includes(d.kind) || !d.slots.some(Boolean)) continue;
      if (Math.hypot(d.x - door.x, d.z - door.z) > 9 || inward(d.x, d.z) < 0) continue;
      const dist = Math.hypot(d.x - p.x, d.z - p.z);
      if (dist < best) {
        box = d;
        best = dist;
      }
    }
    if (!box) return done();
    // Line up outside the doorway first, so it walks straight through rather than into a wall.
    const outside = -inward(p.x, p.z);
    if (outside > 2.3) return this.walkTo(bot, p, door.x + door.nx * 1.6, door.z + door.nz * 1.6, 0.6, now, dt);
    if (outside > -0.6) return this.walkTo(bot, p, door.x - door.nx * 1.2, door.z - door.nz * 1.2, 0.4, now, dt);
    if (best > 1.6) return this.walkTo(bot, p, box.x, box.z, 1.4, now, dt);
    const out = this.face(p, box.x, box.z, now, p.active);
    if (now < raid.nextTake) return out;
    raid.nextTake = now + 700;
    const from = box.slots.findIndex(Boolean);
    // The backpack before the belt, which holds its weapons.
    const free = p.slots.findIndex((s, i) => !s && i >= BELT_SIZE);
    if (free < 0) return done();
    out.push(...this.game.moveItem(bot.id, { c: box.id, i: from }, { c: 'me', i: free }));
    return out;
  }

  /** The middle of a doorway and the way out of it towards the bot's side. */
  private doorFace(piece: Piece, p: Survivor): { x: number; z: number; nx: number; nz: number } {
    const mid = (DOORWAY.from + DOORWAY.to) / 2;
    if (piece.dir === 0) {
      const x = piece.i * TILE + mid;
      const z = piece.k * TILE;
      return { x, z, nx: 0, nz: p.z < z ? -1 : 1 };
    }
    const x = piece.i * TILE;
    const z = piece.k * TILE + mid;
    return { x, z, nx: p.x < x ? -1 : 1, nz: 0 };
  }

  // Getting about.

  private walkTo(bot: Bot, p: Survivor, x: number, z: number, near: number, now: number, dt: number, pace = 0.8): Outgoing[] {
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.hypot(dx, dz);
    if (d <= near) {
      // Standing still on purpose isn't being stuck.
      bot.lastPos = { x: p.x, z: p.z, at: now };
      return this.step(bot, p, 0, 0, 0, p.yaw, now, dt, p.active);
    }
    // Stuck against something for a while: give up on this goal.
    if (now - bot.lastPos.at > 4000) {
      const moved = Math.hypot(p.x - bot.lastPos.x, p.z - bot.lastPos.z);
      bot.lastPos = { x: p.x, z: p.z, at: now };
      if (moved < 1.5) {
        bot.goal = null;
        bot.node = null;
        if (bot.phase === 'build') bot.buildStep = 0;
        if (bot.phase === 'raid') {
          bot.raid = null;
          bot.phase = 'roam';
          // Not straight back to the same door.
          bot.raidAt = now + this.between(RAID_EVERY) * 1000;
        }
        return [];
      }
    }
    return this.step(bot, p, dx / d, dz / d, PLAYER_SPEED * pace, Math.atan2(-dx, -dz), now, dt, p.active);
  }

  /** Moves along (vx, vz) at `speed`, sidestepping walls, and tells the game. */
  private step(bot: Bot, p: Survivor, vx: number, vz: number, speed: number, yaw: number, now: number, dt: number, slot: number): Outgoing[] {
    const len = Math.hypot(vx, vz);
    let x = p.x;
    let z = p.z;
    if (len > 0.01 && speed > 0) {
      const stride = speed * dt;
      const base = Math.atan2(vz, vx);
      for (const turn of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
        const nx = p.x + Math.cos(base + turn) * stride;
        const nz = p.z + Math.sin(base + turn) * stride;
        if (!this.walled(nx, this.standY(nx, nz, p.y), nz)) {
          x = nx;
          z = nz;
          break;
        }
      }
    }
    x = Math.max(-HALF_WORLD + 2, Math.min(HALF_WORLD - 2, x));
    z = Math.max(-HALF_WORLD + 2, Math.min(HALF_WORLD - 2, z));
    const moving = x !== p.x || z !== p.z;
    return this.game.move(bot.id, x, this.standY(x, z, p.y), z, yaw, moving, now, slot);
  }

  /** The ground at a point, or the floor laid over it if that is within a step of `from`. */
  private standY(x: number, z: number, from: number): number {
    let y = terrainHeight(this.game.seed, x, z);
    const i = Math.floor(x / TILE);
    const k = Math.floor(z / TILE);
    for (const piece of this.game.pieces.values()) {
      if (piece.i !== i || piece.k !== k || (piece.kind !== 'floor' && piece.kind !== 'foundation')) continue;
      if (piece.y > y && piece.y <= from + 0.8) y = piece.y;
    }
    return y;
  }

  /** True if a survivor standing at (x, y, z) would be in a building piece, a tree trunk, a rock or a wreck. */
  private walled(x: number, y: number, z: number): boolean {
    if (this.game.cover.solidAt(x, y, z, PLAYER_RADIUS * 0.8)) return true;
    const me = playerBox({ x, y: y + 0.3, z });
    for (const piece of this.game.pieces.values()) {
      if (Math.abs(piece.i * TILE + TILE / 2 - x) > 5 || Math.abs(piece.k * TILE + TILE / 2 - z) > 5) continue;
      if (pieceBoxes(piece).some((b) => boxesTouch(b, me, -0.02))) return true;
    }
    return false;
  }

  private face(p: Survivor, x: number, z: number, now: number, slot: number): Outgoing[] {
    return this.game.move(p.id, p.x, p.y, p.z, Math.atan2(-(x - p.x), -(z - p.z)), false, now, slot);
  }

  /** The belt slot holding an item, moving it onto the belt first if it is only in the pack. */
  private ensureInBelt(p: Survivor, item: ItemId): number {
    const belt = p.slots.findIndex((s, n) => n < 6 && s?.item === item);
    if (belt >= 0) return belt;
    const from = p.slots.findIndex((s) => s?.item === item);
    if (from < 0) return -1;
    // The last belt slot is the bots' spare hand.
    const spare = 5;
    const was = p.slots[spare];
    p.slots[spare] = p.slots[from];
    p.slots[from] = was;
    return spare;
  }

  /** True if it carries any of an item, on the belt or in the pack. */
  private beltOrPack(p: Survivor, item: ItemId): boolean {
    return p.slots.some((s) => s?.item === item);
  }

  private beltSlot(p: Survivor, test: (s: NonNullable<Slots[number]>) => boolean): number {
    return p.slots.findIndex((s, n) => n < 6 && !!s && test(s));
  }

  private between([a, b]: number[]): number {
    return a + this.rand() * (b - a);
  }
}

function unit(x: number, z: number): [number, number] {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}
