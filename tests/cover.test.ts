import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Bots } from '../server/bots.ts';
import { Game } from '../server/game.ts';
import { EYE_HEIGHT, type Vec3 } from '../shared/combat.ts';
import { CoverMap, rayCover } from '../shared/cover.ts';
import { ITEMS } from '../shared/items.ts';
import { mulberry32, terrainHeight } from '../shared/terrain.ts';

const SEED = 1234;

function quiet(): Game {
  const game = new Game(SEED);
  game.wildlife = false;
  game.loot = false;
  game.cars = false;
  return game;
}

/** A big boulder on ground that is flat enough to stand either side of it. */
function boulder(game: Game) {
  return game.cover.all.find((c) => {
    if (!c.node || c.node.kind !== 'stone' || c.top - c.y < 1.6) return false;
    const h = terrainHeight(SEED, c.x, c.z);
    return [-8, 8].every((d) => Math.abs(terrainHeight(SEED, c.x + d, c.z) - h) < 0.6);
  })!;
}

function stand(game: Game, id: number, x: number, z: number) {
  const p = game.players.get(id)!;
  p.x = x;
  p.z = z;
  p.y = terrainHeight(game.seed, x, z);
}

test('cover is the same for the same seed, and a ray stops at a trunk', () => {
  const a = new CoverMap(SEED, new Game(SEED).resources);
  const b = new CoverMap(SEED, new Game(SEED).resources);
  assert.equal(a.all.length, b.all.length);
  assert.ok(a.all.length > 300, `cover pieces: ${a.all.length}`);
  const trunk = { x: 0, z: 0, y: 0, top: 9, r: 0.4 };
  assert.ok(Math.abs(rayCover([-5, 1.5, 0], [1, 0, 0], trunk, 20)! - 4.6) < 1e-6);
  assert.equal(rayCover([-5, 1.5, 1], [1, 0, 0], trunk, 20), null, 'passes beside it');
  assert.equal(rayCover([-5, 12, 0], [1, 0, 0], trunk, 20), null, 'passes over it');
  const wreck = { x: 0, z: 0, y: 0, top: 1.4, hx: 2, hz: 0.8, rot: Math.PI / 2 };
  // Turned a quarter, the long side runs along z.
  assert.ok(rayCover([0.5, 1, -5], [0, 0, 1], wreck, 20) !== null);
  assert.equal(rayCover([1.2, 1, -5], [0, 0, 1], wreck, 20), null);
});

test('a boulder stops bullets, and once it is mined away they get through', () => {
  const game = quiet();
  const rock = boulder(game);
  assert.ok(rock, 'a boulder to hide behind');
  const a = game.join('Ash', 0)!.id;
  const b = game.join('Bo', 0)!.id;
  stand(game, a, rock.x - 7, rock.z);
  stand(game, b, rock.x + 2.5, rock.z);
  const shooter = game.players.get(a)!;
  const target = game.players.get(b)!;
  shooter.slots[2] = { item: 'l96', count: 1, hp: ITEMS.l96.weapon!.durability, ammo: 5 };
  const aim = (): Vec3 => {
    const d: Vec3 = [target.x - shooter.x, target.y + 1.1 - (shooter.y + EYE_HEIGHT), target.z - shooter.z];
    const l = Math.hypot(...d);
    return [d[0] / l, d[1] / l, d[2] / l];
  };
  const out = game.fire(a, 2, aim(), true, 1000);
  assert.equal(target.hp, 100, 'hidden behind the rock');
  const shot = out.find((o) => o.msg.t === 'shot')!.msg as { ends: Vec3[] };
  assert.ok(shot.ends[0][0] < rock.x, 'the bullet ended at the rock');
  rock.node!.amount = 0;
  game.fire(a, 2, aim(), true, 4000);
  assert.ok(target.hp < 100, 'with the rock gone, the shot lands');
});

/** A bot armed with a revolver, and a human standing in the open `gap` metres from a boulder. */
function standoff(bots: number, crewOf: (n: number) => number = () => 0) {
  const game = quiet();
  const rock = boulder(game);
  const crew = new Bots(game, bots, mulberry32(7));
  crew.balance(0, 0);
  const ids = [...game.players.keys()];
  const human = game.join('Ash', 0)!.id;
  const h = game.players.get(human)!;
  h.safeUntil = -1e9;
  stand(game, human, rock.x - 14, rock.z);
  ids.forEach((id, n) => {
    stand(game, id, rock.x - 3 + n * 0.8, rock.z + 4);
    // All on one crew, with the same gun, so the test is about tactics rather than the draw.
    (crew as unknown as { bots: Map<number, { crew: number }> }).bots.get(id)!.crew = crewOf(n);
    const p = game.players.get(id)!;
    const slot = p.slots.findIndex((s) => s && ITEMS[s.item].weapon && ITEMS[s.item].weapon!.class !== 'melee');
    p.slots[slot] = { item: 'revolver', count: 1, hp: ITEMS.revolver.weapon!.durability, ammo: 8 };
    const ammo = p.slots.findIndex((s, i) => i > 0 && s && (s.item === 'arrow' || s.item === 'pistolAmmo' || s.item === 'handmadeShell'));
    p.slots[ammo] = { item: 'pistolAmmo', count: 64 };
  });
  return { game, crew, rock, ids, human, h };
}

/** Steps the bots and the game, keeping the human standing still and topped up. */
function hold(game: Game, crew: Bots, human: number, from: number, seconds: number, each?: (now: number) => void): number {
  const h = game.players.get(human)!;
  const at = { x: h.x, y: h.y, z: h.z };
  let now = from;
  for (let n = 0; n < seconds * 20; n++) {
    now += 50;
    Object.assign(h, at);
    h.hp = 100;
    h.dead = false;
    crew.tick(now);
    game.tick(now);
    each?.(now);
  }
  return now;
}

test('a bot in a gunfight gets behind cover and leans out to shoot', () => {
  const { game, crew, ids, human, h } = standoff(1);
  const bot = game.players.get(ids[0])!;
  let hidden = 0;
  let shots = 0;
  const eye: Vec3 = [h.x, h.y + EYE_HEIGHT, h.z];
  const seen = () => {
    const d: Vec3 = [bot.x - eye[0], bot.y + 1.1 - eye[1], bot.z - eye[2]];
    const l = Math.hypot(...d);
    return game.obstacle(eye, [d[0] / l, d[1] / l, d[2] / l], l) >= l - 0.3;
  };
  let fired = 0;
  hold(game, crew, human, 70_000, 25, () => {
    if (!seen()) hidden++;
    const ammo = bot.slots.find((s) => s?.item === 'revolver')?.ammo ?? 0;
    if (ammo < fired) shots++;
    fired = ammo;
  });
  assert.ok(hidden > 25 * 20 * 0.3, `hidden for ${hidden} of ${25 * 20} ticks`);
  assert.ok(hidden < 25 * 20, 'it came out to shoot');
  assert.ok(shots >= 3, `shots fired: ${shots}`);
});

test('crewmates in the same fight come at you from different sides', () => {
  const { game, crew, ids, human, h } = standoff(3);
  let widest = 0;
  hold(game, crew, human, 70_000, 30, () => {
    const angles = ids.map((id) => {
      const p = game.players.get(id)!;
      return Math.atan2(p.z - h.z, p.x - h.x);
    });
    for (const a of angles) {
      for (const b of angles) {
        const d = Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
        widest = Math.max(widest, d);
      }
    }
  });
  assert.ok(widest > 1.2, `widest spread round you: ${widest.toFixed(2)} rad`);
});

test('a bot shot from far off goes after whoever did it', () => {
  const game = quiet();
  const crew = new Bots(game, 1, mulberry32(9));
  crew.balance(0, 0);
  const id = [...game.players.keys()][0];
  const bot = game.players.get(id)!;
  const a = game.join('Ash', 0)!.id;
  const shooter = game.players.get(a)!;
  shooter.safeUntil = -1e9;
  // 60 m off, much further than a bot looks for trouble, with a clear line to it.
  const clear = (x: number, z: number) => {
    const y = terrainHeight(SEED, x, z);
    const o: Vec3 = [x, y + EYE_HEIGHT, z];
    const d: Vec3 = [bot.x - x, bot.y + 1.1 - o[1], bot.z - z];
    const l = Math.hypot(...d);
    return game.obstacle(o, [d[0] / l, d[1] / l, d[2] / l], l) >= l - 0.3;
  };
  let a0 = 0;
  while (a0 < 6.3 && !clear(bot.x + Math.cos(a0) * 60, bot.z + Math.sin(a0) * 60)) a0 += 0.1;
  stand(game, a, bot.x + Math.cos(a0) * 60, bot.z + Math.sin(a0) * 60);
  shooter.slots[2] = { item: 'l96', count: 1, hp: ITEMS.l96.weapon!.durability, ammo: 5 };
  let now = 70_000;
  crew.tick(now);
  game.tick(now);
  const start = Math.hypot(bot.x - shooter.x, bot.z - shooter.z);
  const d: Vec3 = [bot.x - shooter.x, bot.y + 1.1 - (shooter.y + EYE_HEIGHT), bot.z - shooter.z];
  const l = Math.hypot(...d);
  // Tough enough to live through a sniper round.
  bot.hp = 500;
  game.fire(a, 2, [d[0] / l, d[1] / l, d[2] / l], true, now);
  assert.ok(bot.hp < 500 && !bot.dead, 'the shot landed');
  for (let n = 0; n < 20 * 8; n++) {
    now += 50;
    crew.tick(now);
    game.tick(now);
  }
  assert.ok(Math.hypot(bot.x - shooter.x, bot.z - shooter.z) < start - 5, 'it came for the shooter');
});
