import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game } from '../server/game.ts';
import { MAX_PLAYERS } from '../shared/constants.ts';
import { terrainHeight } from '../shared/terrain.ts';
import { generateResources } from '../shared/world.ts';

const SEED = 1234;

function setup() {
  const game = new Game(SEED);
  const id = game.join('Tester', 0)!.id;
  const player = game.players.get(id)!;
  return { game, id, player };
}

function standAt(game: Game, id: number, x: number, z: number) {
  const p = game.players.get(id)!;
  p.x = x;
  p.z = z;
  p.y = terrainHeight(game.seed, x, z);
}

test('terrain and resources are the same for the same seed', () => {
  assert.equal(terrainHeight(SEED, 10.5, -3.2), terrainHeight(SEED, 10.5, -3.2));
  assert.deepEqual(generateResources(SEED), generateResources(SEED));
  assert.notDeepEqual(generateResources(SEED), generateResources(SEED + 1));
});

test('the map is scarce: few living trees, mostly dead wood and scrap', () => {
  const nodes = generateResources(SEED);
  const living = nodes.filter((n) => n.kind === 'tree').length;
  assert.ok(living > 0 && living < nodes.length / 4);
});

test('joining sends a welcome and tells others; the server caps players', () => {
  const game = new Game(SEED);
  const first = game.join('Ash', 0)!;
  assert.equal(first.out[0].msg.t, 'welcome');
  for (let i = 1; i < MAX_PLAYERS; i++) assert.ok(game.join(`P${i}`, 0));
  assert.equal(game.join('One too many', 0), null);
});

test('gathering takes from the node, fills the inventory and respects range and cooldown', () => {
  const { game, id, player } = setup();
  const tree = game.resources.find((r) => r.kind === 'tree')!;
  standAt(game, id, tree.x + 20, tree.z);
  game.gather(id, tree.id, 1000);
  assert.equal(player.inventory.wood, 0, 'too far away');

  standAt(game, id, tree.x + 1.5, tree.z);
  game.gather(id, tree.id, 2000);
  assert.equal(player.inventory.wood, 2);
  game.gather(id, tree.id, 2100);
  assert.equal(player.inventory.wood, 2, 'cooldown');
  game.gather(id, tree.id, 3000);
  assert.equal(player.inventory.wood, 4);
  assert.equal(tree.amount, 8);
});

test('trees never regrow but scrap respawns', () => {
  const { game, id } = setup();
  const scrap = game.resources.find((r) => r.kind === 'scrap')!;
  standAt(game, id, scrap.x + 1, scrap.z);
  let t = 0;
  while (scrap.amount > 0) game.gather(id, scrap.id, (t += 1000));
  game.tick(t + 1000);
  assert.equal(scrap.amount, 0);
  game.tick(t + 121_000);
  assert.equal(scrap.amount, 8);

  const tree = game.resources.find((r) => r.kind === 'deadTree')!;
  standAt(game, id, tree.x + 1, tree.z);
  while (tree.amount > 0) game.gather(id, tree.id, (t += 1000));
  game.tick(t + 10_000_000);
  assert.equal(tree.amount, 0);
});

test('placing a block costs materials and must touch the ground', () => {
  const { game, id, player } = setup();
  standAt(game, id, 0.5, 0.5);
  const x = 3;
  const z = 0;
  const y = Math.floor(terrainHeight(SEED, x + 0.5, z + 0.5) + 0.05);

  game.place(id, x, y, z, 'wood');
  assert.equal(game.blocks.size, 0, 'no wood yet');

  player.inventory.wood = 10;
  game.place(id, x, y + 4, z, 'wood');
  assert.equal(game.blocks.size, 0, 'floating block rejected');

  game.place(id, x, y, z, 'wood');
  assert.equal(game.blocks.size, 1);
  assert.equal(player.inventory.wood, 8);

  game.place(id, x, y + 1, z, 'wood');
  assert.equal(game.blocks.size, 2, 'stacking on a block is allowed');
});

test('players cannot build inside someone or out of reach, and breaking refunds half', () => {
  const { game, id, player } = setup();
  standAt(game, id, 0.5, 0.5);
  player.inventory.scrap = 10;
  const y = Math.floor(player.y);
  game.place(id, 0, y, 0, 'scrap');
  assert.equal(game.blocks.size, 0, 'cell overlaps the player');

  game.place(id, 30, Math.floor(terrainHeight(SEED, 30.5, 0.5)), 0, 'scrap');
  assert.equal(game.blocks.size, 0, 'out of reach');

  const by = Math.floor(terrainHeight(SEED, 2.5, 0.5) + 0.05);
  game.place(id, 2, by, 0, 'scrap');
  assert.equal(player.inventory.scrap, 8);
  game.break(id, 2, by, 0);
  assert.equal(game.blocks.size, 0);
  assert.equal(player.inventory.scrap, 9);
});

test('impossible movement is corrected', () => {
  const { game, id, player } = setup();
  const start = { x: player.x, z: player.z };
  const out = game.move(id, player.x + 50, player.y, player.z, 0, true, 100);
  assert.equal(out[0]?.msg.t, 'correct');
  assert.equal(player.x, start.x);

  const nx = player.x + 0.4;
  assert.deepEqual(game.move(id, nx, terrainHeight(SEED, nx, player.z), player.z, 0, true, 200), []);
  assert.equal(player.x, nx);
});
