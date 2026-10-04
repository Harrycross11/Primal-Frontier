import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game } from '../server/game.ts';
import { MAX_PLAYERS } from '../shared/constants.ts';
import { terrainHeight } from '../shared/terrain.ts';
import { generateResources } from '../shared/world.ts';
import {
  HIT_DAMAGE,
  MAX_HP,
  PIECE_COST,
  STOREY,
  buildBaseY,
  pieceKey,
  stairsHeight,
} from '../shared/building.ts';

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
  assert.equal(player.inventory.wood, 6);
  game.gather(id, tree.id, 2100);
  assert.equal(player.inventory.wood, 6, 'cooldown');
  game.gather(id, tree.id, 3000);
  assert.equal(player.inventory.wood, 12);
  assert.equal(tree.amount, 48);
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
  assert.equal(scrap.amount, 40);

  const tree = game.resources.find((r) => r.kind === 'deadTree')!;
  standAt(game, id, tree.x + 1, tree.z);
  while (tree.amount > 0) game.gather(id, tree.id, (t += 1000));
  game.tick(t + 10_000_000);
  assert.equal(tree.amount, 0);
});

test('placing a piece costs materials and must connect to the ground or another piece', () => {
  const { game, id, player } = setup();
  standAt(game, id, 1.5, 7.5);
  const y = buildBaseY(SEED, 1.5, 4.5);

  game.place(id, 'floor', 0, y, 1, 0, 'wood');
  assert.equal(game.pieces.size, 0, 'no wood yet');

  player.inventory.wood = 100;
  game.place(id, 'floor', 0, y + 9, 1, 0, 'wood');
  assert.equal(game.pieces.size, 0, 'floating floor rejected');

  game.place(id, 'floor', 0, y, 1, 0, 'wood');
  assert.equal(game.pieces.size, 1);
  assert.equal(player.inventory.wood, 100 - PIECE_COST);

  // A wall on the floor's edge, then a floor on top of that wall: all connected.
  game.place(id, 'wall', 0, y, 1, 0, 'wood');
  game.place(id, 'floor', 0, y + STOREY, 1, 0, 'wood');
  assert.equal(game.pieces.size, 3);
  game.place(id, 'wall', 0, y, 1, 0, 'wood');
  assert.equal(game.pieces.size, 3, 'same spot twice is ignored');
});

test('walls can be edited into windows, doors and half walls', () => {
  const { game, id, player } = setup();
  standAt(game, id, 1.5, 7.5);
  player.inventory.scrap = 50;
  const y = buildBaseY(SEED, 1.5, 6);
  game.place(id, 'wall', 0, y, 2, 0, 'scrap');
  const key = pieceKey({ kind: 'wall', i: 0, y, k: 2, dir: 0 });
  assert.ok(game.pieces.has(key));
  for (const edit of ['window', 'door', 'half', 'solid'] as const) {
    game.edit(id, key, edit);
    assert.equal(game.pieces.get(key)!.edit, edit);
  }
  game.edit(id, key, 'banana' as never);
  assert.equal(game.pieces.get(key)!.edit, 'solid');
});

test('hitting a piece damages it until it breaks and refunds half', () => {
  const { game, id, player } = setup();
  standAt(game, id, 1.5, 7.5);
  player.inventory.wood = PIECE_COST;
  const y = buildBaseY(SEED, 1.5, 6);
  game.place(id, 'wall', 0, y, 2, 0, 'wood');
  const key = pieceKey({ kind: 'wall', i: 0, y, k: 2, dir: 0 });
  let t = 0;
  const hits = MAX_HP.wood / HIT_DAMAGE;
  for (let n = 0; n < hits - 1; n++) game.hit(id, key, (t += 1000));
  assert.ok(game.pieces.get(key)!.hp > 0);
  game.hit(id, key, (t += 1000));
  assert.equal(game.pieces.has(key), false);
  assert.equal(player.inventory.wood, PIECE_COST / 2);
});

test('cannot build on top of a player or out of reach', () => {
  const { game, id, player } = setup();
  player.inventory.wood = 100;
  standAt(game, id, 1.5, 1.5);
  game.place(id, 'floor', 0, buildBaseY(SEED, 1.5, 1.5) + 1, 0, 0, 'wood');
  assert.equal(game.pieces.size, 0, 'floor through the player');
  game.place(id, 'floor', 10, buildBaseY(SEED, 31.5, 1.5), 0, 0, 'wood');
  assert.equal(game.pieces.size, 0, 'too far away');
});

test('stairs surfaces rise across their tile in the right direction', () => {
  const s = { kind: 'stairs', i: 0, y: 2, k: 0, dir: 1, material: 'wood', edit: 'solid', hp: 1 } as const;
  assert.equal(stairsHeight(s, 0.01, 1.5)?.toFixed(2), '2.01');
  assert.equal(stairsHeight(s, 2.99, 1.5)?.toFixed(2), '4.99');
  assert.equal(stairsHeight(s, 4, 1.5), null);
  const down = { ...s, dir: 3 };
  assert.ok(stairsHeight(down, 0.1, 1.5)! > stairsHeight(down, 2.9, 1.5)!);
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
