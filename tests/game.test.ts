import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game } from '../server/game.ts';
import { MAX_PLAYERS } from '../shared/constants.ts';
import { terrainHeight } from '../shared/terrain.ts';
import { generateResources, RESOURCE_INFO } from '../shared/world.ts';
import { addItem, countItem, ITEMS, recipeFor, type ItemId } from '../shared/items.ts';
import { FURNACE_FUEL, FURNACE_ORE, FURNACE_OUTPUT } from '../shared/deployables.ts';
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

const have = (game: Game, id: number, item: ItemId) => countItem(game.players.get(id)!.slots, item);
const give = (game: Game, id: number, item: ItemId, n: number) => addItem(game.players.get(id)!.slots, item, n);
/** Puts the building plan (slot 1 at spawn) in the player's hands. */
const holdPlan = (game: Game, id: number) => (game.players.get(id)!.active = 1);

/** Runs the server clock forward in quarter-second ticks. Returns the new time. */
function run(game: Game, from: number, seconds: number): number {
  let t = from;
  game.tick(t);
  while (t < from + seconds * 1000) game.tick((t += 250));
  return t;
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
  game.gather(id, tree.id, 1000, 0);
  assert.equal(have(game, id, 'wood'), 0, 'too far away');

  standAt(game, id, tree.x + 1.5, tree.z);
  game.gather(id, tree.id, 2000, 0);
  assert.equal(have(game, id, 'wood'), 6, 'the starting rock chops at the base rate');
  game.gather(id, tree.id, 2100, 0);
  assert.equal(have(game, id, 'wood'), 6, 'cooldown');
  game.gather(id, tree.id, 3000, 0);
  assert.equal(have(game, id, 'wood'), 12);
  assert.equal(tree.amount, 48);
  assert.equal(player.slots[0]!.hp, ITEMS.rock.tool!.durability - 2, 'the rock wears down');
});

test('trees never regrow but scrap respawns', () => {
  const { game, id } = setup();
  const scrap = game.resources.find((r) => r.kind === 'scrap')!;
  standAt(game, id, scrap.x + 1, scrap.z);
  let t = 0;
  while (scrap.amount > 0) game.gather(id, scrap.id, (t += 1000), 0);
  game.tick(t + 1000);
  assert.equal(scrap.amount, 0);
  game.tick(t + 121_000);
  assert.equal(scrap.amount, 40);

  const tree = game.resources.find((r) => r.kind === 'deadTree')!;
  standAt(game, id, tree.x + 1, tree.z);
  while (tree.amount > 0) game.gather(id, tree.id, (t += 1000), 0);
  game.tick(t + 10_000_000);
  assert.equal(tree.amount, 0);
});

test('placing a piece costs materials and must connect to the ground or another piece', () => {
  const { game, id } = setup();
  standAt(game, id, 1.5, 7.5);
  const y = buildBaseY(SEED, 1.5, 4.5);

  holdPlan(game, id);
  game.place(id, 'floor', 0, y, 1, 0, 'wood');
  assert.equal(game.pieces.size, 0, 'no wood yet');

  give(game, id, 'wood', 100);
  game.place(id, 'floor', 0, y + 9, 1, 0, 'wood');
  assert.equal(game.pieces.size, 0, 'floating floor rejected');

  game.place(id, 'floor', 0, y, 1, 0, 'wood');
  assert.equal(game.pieces.size, 1);
  assert.equal(have(game, id, 'wood'), 100 - PIECE_COST);

  // A wall on the floor's edge, then a floor on top of that wall: all connected.
  game.place(id, 'wall', 0, y, 1, 0, 'wood');
  game.place(id, 'floor', 0, y + STOREY, 1, 0, 'wood');
  assert.equal(game.pieces.size, 3);
  game.place(id, 'wall', 0, y, 1, 0, 'wood');
  assert.equal(game.pieces.size, 3, 'same spot twice is ignored');
});

test('walls can be edited into windows, doors and half walls', () => {
  const { game, id } = setup();
  standAt(game, id, 1.5, 7.5);
  holdPlan(game, id);
  give(game, id, 'scrap', 50);
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
  const { game, id } = setup();
  standAt(game, id, 1.5, 7.5);
  holdPlan(game, id);
  give(game, id, 'wood', PIECE_COST);
  const y = buildBaseY(SEED, 1.5, 6);
  game.place(id, 'wall', 0, y, 2, 0, 'wood');
  const key = pieceKey({ kind: 'wall', i: 0, y, k: 2, dir: 0 });
  let t = 0;
  const hits = MAX_HP.wood / HIT_DAMAGE;
  for (let n = 0; n < hits - 1; n++) game.hit(id, key, (t += 1000));
  assert.ok(game.pieces.get(key)!.hp > 0);
  game.hit(id, key, (t += 1000));
  assert.equal(game.pieces.has(key), false);
  assert.equal(have(game, id, 'wood'), PIECE_COST / 2);
});

test('cannot build on top of a player or out of reach', () => {
  const { game, id } = setup();
  give(game, id, 'wood', 100);
  holdPlan(game, id);
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

test('building needs the building plan in hand', () => {
  const { game, id } = setup();
  standAt(game, id, 1.5, 7.5);
  give(game, id, 'wood', 100);
  game.place(id, 'floor', 0, buildBaseY(SEED, 1.5, 4.5), 1, 0, 'wood');
  assert.equal(game.pieces.size, 0, 'holding the rock');
  holdPlan(game, id);
  game.place(id, 'floor', 0, buildBaseY(SEED, 1.5, 4.5), 1, 0, 'stone');
  assert.equal(game.pieces.size, 0, 'no stone');
  give(game, id, 'stone', 10);
  game.place(id, 'floor', 0, buildBaseY(SEED, 1.5, 4.5), 1, 0, 'stone');
  assert.equal(game.pieces.size, 1, 'stone floor');
});

test('tools gather faster at what they are made for, and wood needs a tool', () => {
  const { game, id, player } = setup();
  const rock = game.resources.find((r) => r.kind === 'stone')!;
  standAt(game, id, rock.x + 1.2, rock.z);
  const base = RESOURCE_INFO.stone.perHit;
  game.gather(id, rock.id, 1000, 0);
  assert.equal(have(game, id, 'stone'), base, 'rock: base rate');
  give(game, id, 'stonePickaxe', 1);
  const pick = player.slots.findIndex((s) => s?.item === 'stonePickaxe');
  game.gather(id, rock.id, 2000, pick);
  assert.equal(have(game, id, 'stone'), base * 3, 'pickaxe doubles stone');

  const tree = game.resources.find((r) => r.kind === 'tree')!;
  standAt(game, id, tree.x + 1.2, tree.z);
  game.gather(id, tree.id, 3000, 1);
  assert.equal(have(game, id, 'wood'), 0, 'the building plan cannot chop');
});

test('hemp is picked whole by hand, and tools break when worn out', () => {
  const { game, id, player } = setup();
  const hemp = game.resources.find((r) => r.kind === 'hemp')!;
  standAt(game, id, hemp.x + 0.8, hemp.z);
  game.gather(id, hemp.id, 1000, 1);
  assert.equal(have(game, id, 'cloth'), RESOURCE_INFO.hemp.amount);
  assert.equal(hemp.amount, 0);

  player.slots[0]!.hp = 1;
  const scrap = game.resources.find((r) => r.kind === 'scrap')!;
  standAt(game, id, scrap.x + 1, scrap.z);
  game.gather(id, scrap.id, 2000, 0);
  assert.equal(player.slots[0], null, 'the rock broke');
});

test('crafting takes ingredients, takes time, and can be cancelled for a refund', () => {
  const { game, id } = setup();
  game.craft(id, 'stoneHatchet', 1);
  assert.equal(have(game, id, 'stoneHatchet'), 0, 'cannot afford');
  give(game, id, 'wood', 200);
  give(game, id, 'stone', 100);
  game.craft(id, 'stoneHatchet', 2);
  assert.equal(have(game, id, 'wood'), 200 - 2 * recipeFor('stoneHatchet')!.cost.wood!);
  let t = run(game, 0, 1);
  assert.equal(have(game, id, 'stoneHatchet'), 0, 'not done yet');
  t = run(game, t, recipeFor('stoneHatchet')!.time - 0.5);
  assert.equal(have(game, id, 'stoneHatchet'), 1);
  game.cancelCraft(id, 0);
  assert.equal(have(game, id, 'wood'), 200 - recipeFor('stoneHatchet')!.cost.wood!, 'second one refunded');
  assert.equal(game.players.get(id)!.queue.length, 0);
});

test('salvaged tools need a workbench nearby', () => {
  const { game, id, player } = setup();
  standAt(game, id, 4, 4);
  give(game, id, 'wood', 1000);
  give(game, id, 'metal', 500);
  give(game, id, 'scrap', 500);
  game.craft(id, 'salvagedAxe', 1);
  assert.equal(player.queue.length, 0, 'no workbench');
  game.craft(id, 'workbench', 1);
  run(game, 0, 15);
  const slot = player.slots.findIndex((s) => s?.item === 'workbench');
  assert.ok(slot >= 0 && slot < 6, 'the workbench lands on the belt');
  game.deploy(id, slot, 6, terrainHeight(SEED, 6, 4), 4, 0);
  assert.equal(game.deployables.size, 1);
  game.craft(id, 'salvagedAxe', 1);
  assert.equal(player.queue.length, 1);
});

test('a furnace burns wood to smelt ore into metal fragments', () => {
  const { game, id } = setup();
  standAt(game, id, 4, 4);
  give(game, id, 'furnace', 1);
  give(game, id, 'wood', 20);
  give(game, id, 'metalOre', 5);
  const p = game.players.get(id)!;
  const slot = p.slots.findIndex((s) => s?.item === 'furnace');
  game.deploy(id, slot, 6, terrainHeight(SEED, 6, 4), 4, 0);
  const furnace = [...game.deployables.values()][0];
  assert.equal(furnace.kind, 'furnace');

  const at = (item: ItemId) => p.slots.findIndex((s) => s?.item === item);
  game.furnace(id, furnace.id, true);
  assert.equal(furnace.on, false, 'no fuel');
  game.moveItem(id, { c: 'me', i: at('metalOre') }, { c: furnace.id, i: FURNACE_FUEL });
  assert.equal(furnace.slots[FURNACE_FUEL], null, 'ore is not fuel');
  game.moveItem(id, { c: 'me', i: at('wood') }, { c: furnace.id, i: FURNACE_FUEL }, 3);
  game.moveItem(id, { c: 'me', i: at('metalOre') }, { c: furnace.id, i: FURNACE_ORE });
  assert.equal(have(game, id, 'wood'), 17);
  game.furnace(id, furnace.id, true);
  let t = 0;
  game.tick(t);
  for (let n = 0; n < 40; n++) game.tick((t += 250));
  assert.equal(furnace.slots[FURNACE_OUTPUT]?.count, 5, 'all ore smelted');
  assert.equal(furnace.slots[FURNACE_ORE], null);
  assert.equal(furnace.on, false, 'goes out when the wood runs out');
  game.moveItem(id, { c: furnace.id, i: FURNACE_OUTPUT }, { c: 'me', i: 20 });
  assert.equal(have(game, id, 'metal'), 5);
});

test('storage boxes hold items; breaking your own box gives it and its contents back', () => {
  const { game, id, player } = setup();
  standAt(game, id, 4, 4);
  give(game, id, 'storageBox', 1);
  give(game, id, 'stone', 50);
  const slot = player.slots.findIndex((s) => s?.item === 'storageBox');
  game.deploy(id, slot, 3.6, terrainHeight(SEED, 3.6, 4), 4, 0);
  assert.equal(game.deployables.size, 0, 'cannot place it on top of yourself');
  game.deploy(id, slot, 6, terrainHeight(SEED, 6, 4), 4, 0);
  const box = [...game.deployables.values()][0];
  game.moveItem(id, { c: 'me', i: player.slots.findIndex((s) => s?.item === 'stone') }, { c: box.id, i: 3 });
  assert.equal(have(game, id, 'stone'), 0);
  assert.equal(box.slots[3]?.count, 50);
  standAt(game, id, 30, 30);
  assert.deepEqual(game.moveItem(id, { c: box.id, i: 3 }, { c: 'me', i: 10 }), [], 'too far to open');
  standAt(game, id, 4, 4);
  let t = 0;
  while (game.deployables.size) game.hitDeployable(id, box.id, (t += 1000));
  assert.equal(have(game, id, 'stone'), 50);
  assert.equal(have(game, id, 'storageBox'), 1);
});
