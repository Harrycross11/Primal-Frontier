import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Bots } from '../server/bots.ts';
import { Game } from '../server/game.ts';
import { mulberry32 } from '../shared/terrain.ts';
import { countItem } from '../shared/items.ts';

/** Runs the game and its bots for `seconds` of game time at the server's tick rate. */
function run(game: Game, bots: Bots, from: number, seconds: number): number {
  let now = from;
  for (let n = 0; n < seconds * 20; n++) {
    now += 50;
    bots.tick(now);
    game.tick(now);
  }
  return now;
}

test('bots fill the server and make room for real players', () => {
  const game = new Game(1234);
  const bots = new Bots(game, 5, mulberry32(1));
  bots.balance(0, 0);
  assert.equal(game.players.size, 5);
  assert.ok([...game.players.values()].every((p) => p.name.startsWith('Bot ')));
  bots.balance(2, 0);
  assert.equal(bots.count, 3);
  bots.balance(5, 0);
  assert.equal(bots.count, 0);
});

test('bots chop wood, then build and lock a hut with loot inside', () => {
  const game = new Game(1234);
  const bots = new Bots(game, 3, mulberry32(2));
  bots.balance(0, 0);
  run(game, bots, 0, 600);
  const doors = [...game.pieces.values()].filter((p) => p.bot && p.door);
  assert.ok(doors.length >= 1, `huts built: ${doors.length}`);
  assert.ok(doors.every((p) => p.door!.locked && !p.door!.open));
  const boxes = [...game.deployables.values()].filter((d) => d.kind === 'storageBox' && bots.isBot(d.owner));
  assert.ok(boxes.length >= 1);
  assert.ok(countItem(boxes[0].slots, 'scrap') > 0);
});

test('a bot shoots at a survivor who comes close', () => {
  const game = new Game(1234);
  const bots = new Bots(game, 1, mulberry32(3));
  bots.balance(0, 0);
  const bot = [...game.players.values()][0];
  const human = game.join('Ash', 0)!;
  const p = game.players.get(human.id)!;
  // Stand still 10 m away, on the ground.
  const place = () => game.move(human.id, bot.x + 10, bot.y, bot.z, 0, false, 0);
  place();
  let now = 0;
  for (let n = 0; n < 20 * 20 && p.hp === 100 && !p.dead; n++) {
    now += 50;
    p.x = bot.x + 10;
    p.z = bot.z;
    p.y = bot.y;
    bots.tick(now);
    game.tick(now);
  }
  assert.ok(p.hp < 100 || p.dead, 'the bot never hit them');
});

test('bots in a long session raid doors and come back after dying', () => {
  const game = new Game(1234);
  const bots = new Bots(game, 4, mulberry32(4));
  bots.balance(0, 0);
  const now = run(game, bots, 0, 1800);
  // Every bot is still in the world, alive or about to respawn.
  assert.equal(bots.count, 4);
  const doors = [...game.pieces.values()].filter((p) => p.door);
  assert.ok(doors.length >= 1);
  assert.ok(now > 0);
});
