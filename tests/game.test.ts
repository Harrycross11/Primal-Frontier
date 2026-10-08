import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game } from '../server/game.ts';
import { MAX_PLAYERS } from '../shared/constants.ts';
import { terrainHeight } from '../shared/terrain.ts';
import { BARREL_DRINK, generateResources, RESOURCE_INFO } from '../shared/world.ts';
import {
  FOOD_DRAIN,
  RADS_DECAY,
  RADS_HARMLESS,
  REGEN,
  SPAWN_FOOD,
  SPAWN_WATER,
  STARVE_DAMAGE,
  THIRST_DAMAGE,
  WATER_DRAIN,
  radZones,
  radiationAt,
} from '../shared/survival.ts';
import { addItem, countItem, ITEMS, recipeFor, type ItemId, type Slots } from '../shared/items.ts';
import { FURNACE_FUEL, FURNACE_ORE_SLOTS, FURNACE_OUTPUT_SLOTS, LOOT_BAG_SECONDS } from '../shared/deployables.ts';
import { EYE_HEIGHT, MAX_HEALTH } from '../shared/combat.ts';
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
  game.wildlife = false;
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

/** Moves the stack of an item into a belt slot. */
function toBelt(slots: Slots, item: ItemId, slot: number) {
  const at = slots.findIndex((s) => s?.item === item);
  [slots[slot], slots[at]] = [slots[at], slots[slot]];
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
  game.wildlife = false;
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
  const out = game.gather(id, tree.id, 2000, 0);
  assert.equal(have(game, id, 'wood'), 6, 'the starting rock chops at the base rate');
  assert.ok(out.some((o) => o.to === 'all' && o.msg.t === 'resource' && o.msg.by === id), 'everyone hears who chopped it');
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
  let crafted = false;
  const end = t + (recipeFor('stoneHatchet')!.time - 0.5) * 1000;
  while (t < end) {
    const out = game.tick((t += 250));
    if (out.some((o) => o.to === id && o.msg.t === 'crafted' && o.msg.item === 'stoneHatchet')) crafted = true;
  }
  assert.equal(have(game, id, 'stoneHatchet'), 1);
  assert.ok(crafted, 'the crafter is told it finished');
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

test('a furnace burns wood to charcoal and smelts ore into metal fragments', () => {
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
  game.moveItem(id, { c: 'me', i: at('metalOre') }, { c: furnace.id, i: FURNACE_ORE_SLOTS[0] });
  assert.equal(have(game, id, 'wood'), 17);
  game.furnace(id, furnace.id, true);
  let t = 0;
  game.tick(t);
  for (let n = 0; n < 40; n++) game.tick((t += 250));
  const out = (item: ItemId) => FURNACE_OUTPUT_SLOTS.find((i) => furnace.slots[i]?.item === item)!;
  assert.equal(furnace.slots[out('metal')]?.count, 5, 'all ore smelted');
  assert.equal(furnace.slots[out('charcoal')]?.count, 3, 'one charcoal per wood burned');
  assert.equal(furnace.slots[FURNACE_ORE_SLOTS[0]], null);
  assert.equal(furnace.on, false, 'goes out when the wood runs out');
  game.moveItem(id, { c: furnace.id, i: out('metal') }, { c: 'me', i: 20 });
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

test('furnaces smelt sulfur and high quality ore side by side', () => {
  const { game, id, player } = setup();
  standAt(game, id, 4, 4);
  give(game, id, 'furnace', 1);
  give(game, id, 'wood', 50);
  give(game, id, 'sulfurOre', 4);
  give(game, id, 'hqmOre', 2);
  game.deploy(id, player.slots.findIndex((s) => s?.item === 'furnace'), 6, terrainHeight(SEED, 6, 4), 4, 0);
  const furnace = [...game.deployables.values()][0];
  const at = (item: ItemId) => player.slots.findIndex((s) => s?.item === item);
  game.moveItem(id, { c: 'me', i: at('wood') }, { c: furnace.id, i: FURNACE_FUEL });
  game.moveItem(id, { c: 'me', i: at('sulfurOre') }, { c: furnace.id, i: FURNACE_ORE_SLOTS[0] });
  game.moveItem(id, { c: 'me', i: at('hqmOre') }, { c: furnace.id, i: FURNACE_ORE_SLOTS[1] });
  game.furnace(id, furnace.id, true);
  run(game, 0, 6);
  const total = (item: ItemId) => FURNACE_OUTPUT_SLOTS.reduce((n, i) => n + (furnace.slots[i]?.item === item ? furnace.slots[i]!.count : 0), 0);
  assert.equal(total('sulfur'), 4);
  assert.equal(total('hqm'), 2);
});

test('better guns need higher workbench levels', () => {
  const { game, id, player } = setup();
  standAt(game, id, 4, 4);
  for (const item of ['metal', 'hqm', 'scrap', 'wood', 'cloth'] as ItemId[]) give(game, id, item, 900);
  give(game, id, 'workbench', 1);
  game.craft(id, 'revolver', 1);
  assert.equal(player.queue.length, 0, 'revolver needs a workbench');
  game.deploy(id, player.slots.findIndex((s) => s?.item === 'workbench'), 6, terrainHeight(SEED, 6, 4), 4, 0);
  game.craft(id, 'revolver', 1);
  assert.equal(player.queue.length, 1);
  game.craft(id, 'thompson', 1);
  assert.equal(player.queue.length, 1, 'the Thompson needs level 2');
  game.craft(id, 'workbench2', 1);
  run(game, 0, 40);
  game.deploy(id, player.slots.findIndex((s) => s?.item === 'workbench2'), 2, terrainHeight(SEED, 2, 1.5), 1.5, 0);
  game.craft(id, 'thompson', 1);
  assert.equal(player.queue.length, 1);
});

/** A stretch of ground that stays level for 12 m along x, so test shots are not blocked by hills. */
const FLAT = (() => {
  for (let z = -60; z < 60; z += 3) {
    for (let x = -60; x < 60; x += 3) {
      const h = terrainHeight(SEED, x, z);
      let ok = true;
      for (let d = 0; d <= 12 && ok; d += 0.5) ok = Math.abs(terrainHeight(SEED, x + d, z) - h) < 0.12;
      if (ok) return { x, z };
    }
  }
  throw new Error('no flat ground');
})();

/** Two players facing each other along x, `gap` metres apart, the shooter holding `item` in slot 2. */
function duel(item: ItemId, gap = 10) {
  const game = new Game(SEED);
  game.wildlife = false;
  const a = game.join('Ash', 0)!.id;
  const b = game.join('Bo', 0)!.id;
  standAt(game, a, FLAT.x, FLAT.z);
  standAt(game, b, FLAT.x + gap, FLAT.z);
  game.players.get(b)!.y = game.players.get(a)!.y;
  const slots = game.players.get(a)!.slots;
  slots[2] = { item, count: 1, hp: ITEMS[item].weapon!.durability, ammo: 0 };
  return { game, a, b, shooter: game.players.get(a)!, target: game.players.get(b)! };
}

const AT_BODY: [number, number, number] = [1, -0.5 / 10, 0];

test('guns need reloading from ammo in the inventory', () => {
  const { game, a, shooter } = duel('revolver');
  assert.equal(game.fire(a, 2, AT_BODY, false, 1000).some((o) => o.msg.t === 'shot'), false, 'empty');
  give(game, a, 'pistolAmmo', 5);
  game.reload(a, 2, 1000);
  assert.equal(shooter.slots[2]!.ammo, 5);
  assert.equal(have(game, a, 'pistolAmmo'), 0);
  assert.equal(game.fire(a, 2, AT_BODY, false, 1500).some((o) => o.msg.t === 'shot'), false, 'still reloading');
  assert.ok(game.fire(a, 2, AT_BODY, false, 5000).some((o) => o.msg.t === 'shot'));
  assert.equal(shooter.slots[2]!.ammo, 4);
  assert.equal(game.fire(a, 2, AT_BODY, false, 5050).some((o) => o.msg.t === 'shot'), false, 'fire rate');
});

test('a shot hurts the player it hits, more on the head, and walls stop it', () => {
  const { game, a, target, shooter } = duel('boltRifle');
  shooter.slots[2]!.ammo = 4;
  game.fire(a, 2, AT_BODY, true, 1000);
  assert.equal(target.hp, MAX_HEALTH - 80, 'body shot');
  target.hp = MAX_HEALTH;
  const head = 1.62 - EYE_HEIGHT;
  game.fire(a, 2, [10, head, 0], true, 4000);
  assert.ok(target.hp <= 0, 'headshot kills');
  assert.equal(target.dead, true);

  const second = duel('boltRifle');
  second.shooter.slots[2]!.ammo = 4;
  // A stone wall across the line between them.
  const i = Math.floor((FLAT.x + 5) / 3);
  const k = Math.floor(FLAT.z / 3);
  second.game.pieces.set('w', { kind: 'wall', i, y: Math.floor(second.shooter.y), k, dir: 1, material: 'stone', edit: 'solid', hp: 250 });
  second.game.fire(second.a, 2, AT_BODY, true, 1000);
  assert.equal(second.target.hp, MAX_HEALTH, 'the wall took the bullet');
});

test('dying drops everything in a loot bag, and you respawn with a rock', () => {
  const { game, a, b, target, shooter } = duel('l96');
  give(game, b, 'metal', 300);
  shooter.slots[2]!.ammo = 5;
  const out = [...game.fire(a, 2, AT_BODY, true, 1000), ...game.fire(a, 2, AT_BODY, true, 4000)];
  assert.equal(target.dead, true);
  const feed = out.find((o) => o.msg.t === 'kill');
  assert.deepEqual(feed, { to: 'all', msg: { t: 'kill', killer: 'Ash', victim: 'Bo', item: 'l96', head: false } }, 'everyone sees it in the kill feed');
  const bag = [...game.deployables.values()].find((d) => d.kind === 'lootBag')!;
  assert.ok(bag, 'a loot bag was left');
  assert.equal(bag.label, 'Bo');
  assert.equal(have(game, b, 'metal'), 0);
  assert.deepEqual(game.move(b, 1, 1, 1, 0, true, 5000), [], 'the dead cannot act');

  // The shooter loots the bag; it disappears once empty.
  standAt(game, a, bag.x - 1, bag.z);
  for (let i = 0; i < bag.slots.length; i++) if (bag.slots[i]) game.moveItem(a, { c: bag.id, i }, { c: 'me', i: 10 + i });
  assert.equal(have(game, a, 'metal'), 300);
  assert.equal(game.deployables.has(bag.id), false);

  game.respawn(b);
  assert.equal(target.dead, false);
  assert.equal(target.hp, MAX_HEALTH);
  assert.equal(have(game, b, 'rock'), 1);
});

test('loot bags disappear after a while', () => {
  const { game, a, b, target, shooter } = duel('l96');
  shooter.slots[2]!.ammo = 5;
  target.hp = 10;
  game.fire(a, 2, AT_BODY, true, 1000);
  assert.equal(game.deployables.size, 1);
  run(game, 0, LOOT_BAG_SECONDS + 1);
  assert.equal(game.deployables.size, 0);
  void b;
});

test('shotguns fire many pellets; melee weapons hit up close; bandages heal', () => {
  const close = duel('doubleBarrel', 4);
  close.shooter.slots[2]!.ammo = 2;
  const out = close.game.fire(close.a, 2, AT_BODY, false, 1000);
  const shot = out.find((o) => o.msg.t === 'shot')!.msg as { ends: unknown[] };
  assert.equal(shot.ends.length, 12);
  assert.ok(close.target.hp < MAX_HEALTH - 40, 'most pellets hit at 4 m');

  const knife = duel('machete', 1.5);
  knife.game.melee(knife.a, 2, [1, -0.3, 0], 1000);
  assert.equal(knife.target.hp, MAX_HEALTH - 35);
  knife.game.melee(knife.a, 2, [1, -0.3, 0], 1100);
  assert.equal(knife.target.hp, MAX_HEALTH - 35, 'swing delay');
  const far = duel('machete', 6);
  far.game.melee(far.a, 2, [1, -0.1, 0], 1000);
  assert.equal(far.target.hp, MAX_HEALTH, 'out of reach');

  give(knife.game, knife.b, 'bandage', 1);
  const slot = knife.target.slots.findIndex((s) => s?.item === 'bandage');
  knife.game.use(knife.b, slot, 2000);
  assert.equal(knife.target.hp, MAX_HEALTH - 20);
  assert.equal(have(knife.game, knife.b, 'bandage'), 0);
});

test('armour is worn in its own slot and cuts damage to the part it covers', () => {
  const { game, a, b, target, shooter } = duel('boltRifle');
  shooter.slots[2]!.ammo = 4;
  give(game, b, 'metalChestplate', 1);
  give(game, b, 'burlapHeadwrap', 1);
  const plate = target.slots.findIndex((s) => s?.item === 'metalChestplate');
  // A chest plate will not go on your head; on the chest it fits.
  game.moveItem(b, { c: 'me', i: plate }, { c: 'wear', i: 0 });
  assert.equal(target.wear.filter(Boolean).length, 0);
  game.moveItem(b, { c: 'me', i: plate }, { c: 'wear', i: 1 });
  assert.equal(target.wear[1]?.item, 'metalChestplate');
  assert.equal(target.slots[plate], null);
  // Using armour from the belt puts it on.
  const wrap = target.slots.findIndex((s) => s?.item === 'burlapHeadwrap');
  game.use(b, wrap, 1000);
  assert.equal(target.wear[0]?.item, 'burlapHeadwrap');

  const out = game.fire(a, 2, AT_BODY, true, 1000);
  assert.equal(target.hp, MAX_HEALTH - 40, 'the plate stops half of a body shot');
  assert.ok(out.some((o) => o.msg.t === 'hitmarker' && o.msg.armour));
  assert.equal(target.wear[1]!.hp, ITEMS.metalChestplate.armour!.durability - 1, 'the plate wears');
  assert.equal(game.players.get(a)!.slots[2]!.item, 'boltRifle');

  // Legs are not covered.
  target.hp = MAX_HEALTH;
  game.fire(a, 2, [10, 0.6 - EYE_HEIGHT, 0], true, 4000);
  assert.equal(target.hp, MAX_HEALTH - 80, 'leg shot');

  // Others see what you wear.
  const state = game.tick(5000).find((o) => o.msg.t === 'state')!.msg as { players: { id: number; wear: (ItemId | null)[] }[] };
  assert.deepEqual(state.players.find((p) => p.id === b)!.wear, ['burlapHeadwrap', 'metalChestplate', null]);
});

test('worn armour drops in the loot bag and breaks when worn out', () => {
  const { game, a, b, target, shooter } = duel('l96');
  shooter.slots[2]!.ammo = 5;
  target.wear[1] = { item: 'burlapShirt', count: 1, hp: 1 };
  game.fire(a, 2, AT_BODY, true, 1000);
  assert.equal(target.wear[1], null, 'the worn-out shirt fell apart');
  target.wear[2] = { item: 'roadsignKilt', count: 1, hp: 50 };
  target.hp = 1;
  game.fire(a, 2, AT_BODY, true, 4000);
  assert.equal(target.dead, true);
  const bag = [...game.deployables.values()].find((d) => d.kind === 'lootBag')!;
  assert.ok(bag.slots.some((s) => s?.item === 'roadsignKilt'));
  assert.deepEqual(target.wear, [null, null, null]);
  game.respawn(b);
  assert.deepEqual(target.wear, [null, null, null]);
});

test('hunger and thirst drain over time, faster on the move, and hurt when empty', () => {
  const { game, id, player } = setup();
  const v = player.vitals;
  assert.equal(v.food, SPAWN_FOOD);
  assert.equal(v.water, SPAWN_WATER);
  let t = run(game, 0, 60);
  assert.ok(Math.abs(v.food - (SPAWN_FOOD - FOOD_DRAIN * 60)) < 0.01, 'food drains standing still');
  assert.ok(v.water < SPAWN_WATER - WATER_DRAIN * 59, 'water drains faster than food');
  const still = v.water;
  player.moving = true;
  t = run(game, t, 60);
  assert.ok(still - v.water > WATER_DRAIN * 60 * 1.3, 'moving burns more');
  player.moving = false;

  v.food = 0;
  v.water = 0;
  const hp = player.hp;
  const out: ReturnType<Game['tick']> = [];
  for (const end = t + 10_000; t < end; ) out.push(...game.tick((t += 250)));
  assert.ok(Math.abs(hp - player.hp - (STARVE_DAMAGE + THIRST_DAMAGE) * 10) < 0.5, 'starving and thirsty hurts');
  assert.ok(out.some((o) => o.to === id && o.msg.t === 'vitals' && o.msg.food === 0), 'the player is told');
  assert.ok(out.some((o) => o.to === id && o.msg.t === 'health'));

  // Starve to death: the kill feed says why.
  player.hp = 1;
  const death: ReturnType<Game['tick']> = [];
  for (const end = t + 5_000; t < end; ) death.push(...game.tick((t += 250)));
  assert.equal(player.dead, true);
  assert.ok(death.some((o) => o.msg.t === 'kill' && o.msg.cause === 'thirst' && o.msg.killer === null));
  game.respawn(id);
  assert.equal(player.vitals.food, SPAWN_FOOD, 'respawning resets hunger');
});

test('food and water fill you up; a full stomach heals you slowly', () => {
  const { game, id, player } = setup();
  give(game, id, 'cannedBeans', 2);
  toBelt(player.slots, 'cannedBeans', 2);
  player.vitals.food = 30;
  game.use(id, 2, 1000);
  assert.equal(player.vitals.food, 30 + ITEMS.cannedBeans.consume!.food!);
  assert.equal(have(game, id, 'cannedBeans'), 1);
  player.vitals.food = 100;
  player.vitals.water = 100;
  game.use(id, 2, 5000);
  assert.equal(have(game, id, 'cannedBeans'), 1, 'not eaten when full');

  player.hp = 50;
  run(game, 10_000, 20);
  assert.ok(player.hp > 50 + REGEN * 15, 'well fed survivors heal');
});

test('rain barrels quench thirst and run dry; wrecks hide food', () => {
  const { game, id, player } = setup();
  const barrel = game.resources.find((r) => r.kind === 'waterBarrel')!;
  standAt(game, id, barrel.x + 1, barrel.z);
  player.vitals.water = 10;
  game.gather(id, barrel.id, 1000, 0);
  assert.equal(player.vitals.water, 10 + BARREL_DRINK);
  assert.equal(barrel.amount, RESOURCE_INFO.waterBarrel.amount - RESOURCE_INFO.waterBarrel.perHit);
  assert.equal(have(game, id, 'bottledWater'), 0, 'drunk on the spot, not carried');
  player.vitals.water = 100;
  game.gather(id, barrel.id, 2000, 0);
  assert.equal(barrel.amount, RESOURCE_INFO.waterBarrel.amount - RESOURCE_INFO.waterBarrel.perHit, 'not thirsty, no drink');

  // Hit enough wrecks and something to eat or drink turns up.
  give(game, id, 'salvagedPickaxe', 1);
  let found = 0;
  let t = 10_000;
  for (const wreck of game.resources.filter((r) => r.kind === 'scrap')) {
    standAt(game, id, wreck.x + 1, wreck.z);
    while (wreck.amount > 0 && player.slots.some((s) => !s)) game.gather(id, wreck.id, (t += 1000), 0);
    found = have(game, id, 'cannedBeans') + have(game, id, 'bottledWater');
    if (found >= 2) break;
  }
  assert.ok(found >= 2, 'wrecks give the odd can or bottle');
});

test('the craters are radioactive: poisoning builds up, hurts, and pills and burlap help', () => {
  const { game, id, player } = setup();
  const zone = radZones(SEED)[0];
  assert.ok(radiationAt(SEED, zone.x, zone.z) > 0);
  assert.equal(radiationAt(SEED, zone.x + zone.radius + 1, zone.z), 0, 'nothing outside');
  for (const p of [...Array(MAX_PLAYERS - 1)].map(() => game.join('x', 0)!.id)) {
    const q = game.players.get(p)!;
    assert.equal(radiationAt(SEED, q.x, q.z), 0, 'nobody spawns in a zone');
  }

  standAt(game, id, zone.x, zone.z);
  player.vitals.food = player.vitals.water = 100;
  let t = run(game, 0, 10);
  const naked = player.vitals.rads;
  assert.ok(naked > 10, 'radiation builds up in the crater');
  t = run(game, t, 20);
  assert.ok(player.vitals.rads > RADS_HARMLESS && player.hp < MAX_HEALTH, 'and hurts once it is high');

  // Pills flush it out.
  give(game, id, 'antiRadPills', 1);
  toBelt(player.slots, 'antiRadPills', 3);
  const before = player.vitals.rads;
  game.use(id, 3, t + 1000);
  assert.ok(Math.abs(before - 40 - player.vitals.rads) < 0.01);

  // A full burlap set keeps a good share of it out.
  const { game: g2, id: b, player: dressed } = setup();
  dressed.wear = [
    { item: 'burlapHeadwrap', count: 1, hp: 60 },
    { item: 'burlapShirt', count: 1, hp: 60 },
    { item: 'burlapTrousers', count: 1, hp: 60 },
  ];
  standAt(g2, b, zone.x, zone.z);
  run(g2, 0, 10);
  assert.ok(dressed.vitals.rads < naked * 0.7, 'burlap blocks some radiation');

  // Out of the zone it fades.
  standAt(game, id, zone.x + zone.radius + 5, zone.z);
  const inside = player.vitals.rads;
  run(game, t + 2000, 20);
  assert.ok(player.vitals.rads < inside - RADS_DECAY * 15);
});

test('high quality ore sits inside the craters', () => {
  const nodes = generateResources(SEED);
  const hot = nodes.filter((n) => n.kind === 'hqmOre' && radiationAt(SEED, n.x, n.z) > 0);
  assert.ok(hot.length >= 4);
  assert.ok(nodes.some((n) => n.kind === 'mushroom') && nodes.some((n) => n.kind === 'waterBarrel'));
});
