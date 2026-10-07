import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game } from '../server/game.ts';
import { EYE_HEIGHT } from '../shared/combat.ts';
import { ASHHOUND, PACKS, PACK_SIZE, packDens, rayCreature } from '../shared/creatures.ts';
import { FURNACE_FUEL, FURNACE_ORE_SLOTS, FURNACE_OUTPUT_SLOTS } from '../shared/deployables.ts';
import { ITEMS, addItem, countItem, type ItemId } from '../shared/items.ts';
import { terrainHeight } from '../shared/terrain.ts';

const SEED = 4321;

/** A world with its packs born and one survivor who has been awake long enough to be hunted. */
function setup() {
  const game = new Game(SEED);
  const id = game.join('Ash', 0)!.id;
  const p = game.players.get(id)!;
  p.safeUntil = 0;
  game.tick(0);
  return { game, id, p };
}

function standAt(game: Game, id: number, x: number, z: number) {
  const p = game.players.get(id)!;
  p.x = x;
  p.z = z;
  p.y = terrainHeight(game.seed, x, z);
}

/** Runs the clock in quarter-second ticks; returns the new time. */
function run(game: Game, from: number, seconds: number, each?: (t: number) => void): number {
  let t = from;
  while (t < from + seconds * 1000) {
    game.tick((t += 250));
    each?.(t);
  }
  return t;
}

const alive = (game: Game) => [...game.hounds.values()].filter((h) => !h.deadAt);
const have = (game: Game, id: number, item: ItemId) => countItem(game.players.get(id)!.slots, item);

/** Puts an item in belt slot 2. */
function hold(game: Game, id: number, item: ItemId, count = 1) {
  const p = game.players.get(id)!;
  const w = ITEMS[item].weapon;
  p.slots[2] = { item, count, ...(w && { hp: w.durability, ammo: w.mag ?? 0 }) };
}

test('packs of hounds are born round their dens', () => {
  const { game } = setup();
  assert.equal(game.hounds.size, PACKS * PACK_SIZE);
  const dens = packDens(SEED);
  for (const h of game.hounds.values()) {
    const [x, z] = dens[h.pack];
    assert.ok(Math.hypot(h.x - x, h.z - z) < 7, 'near its den');
    assert.equal(h.owner, null);
  }
});

test('a ray finds a hound by its body and head', () => {
  const h = { x: 0, y: 0, z: 0, yaw: 0 };
  // From the side, at chest height.
  assert.equal(rayCreature([-5, 0.6, 0], [1, 0, 0], h, 50)?.head, false);
  // From in front, the head comes first.
  assert.equal(rayCreature([0, 0.7, 5], [0, 0, -1], h, 50)?.head, true);
  // Over its back.
  assert.equal(rayCreature([-5, 1.4, 0], [1, 0, 0], h, 50), null);
  // Turned side-on, a ray from in front now meets the flank.
  assert.equal(rayCreature([0, 0.6, 5], [0, 0, -1], { ...h, yaw: Math.PI / 2 }, 50)?.head, false);
});

test('wild hounds hunt a survivor who comes near, but not one who has just woken', () => {
  const { game, id, p } = setup();
  const h = alive(game)[0];
  standAt(game, id, h.x + 8, h.z);
  p.safeUntil = 1e9;
  run(game, 0, 3);
  assert.equal(p.hp, 100, 'left alone just after waking');
  p.safeUntil = 0;
  let t = 3000;
  while (p.hp === 100 && t < 12_000) game.tick((t += 250));
  assert.ok(p.hp < 100, 'bitten');
  assert.ok(alive(game).filter((o) => o.target?.id === id).length > 1, 'the pack joins in');
});

test('hounds can be killed for meat, cooked in a furnace, and the pack grows back', () => {
  const { game, id, p } = setup();
  const h = alive(game)[0];
  const count = alive(game).length;
  standAt(game, id, h.x - 6, h.z);
  p.safeUntil = 1e9;
  hold(game, id, 'assaultRifle');
  addItem(p.slots, 'rifleAmmo', 100);
  let t = 1000;
  for (let n = 0; n < 40 && !h.deadAt; n++) {
    const dir: [number, number, number] = [h.x - p.x, h.y + 0.55 - (p.y + EYE_HEIGHT), h.z - p.z];
    game.fire(id, 2, dir, true, (t += 400));
    if (!p.slots[2]!.ammo) game.reload(id, 2, (t += 4000));
  }
  assert.ok(h.deadAt, 'killed');
  const bag = [...game.deployables.values()].find((d) => d.label === 'Ashhound')!;
  const meat = bag.slots.find((s) => s?.item === 'rawMeat')!;
  assert.ok(meat.count >= ASHHOUND.meat[0] && meat.count <= ASHHOUND.meat[1]);

  // Cooked over a furnace.
  addItem(p.slots, 'furnace', 1);
  addItem(p.slots, 'wood', 10);
  addItem(p.slots, 'rawMeat', 2);
  const slot = p.slots.findIndex((s) => s?.item === 'furnace');
  game.deploy(id, slot, p.x + 2, terrainHeight(SEED, p.x + 2, p.z), p.z, 0);
  const furnace = [...game.deployables.values()].find((d) => d.kind === 'furnace')!;
  const at = (item: ItemId) => p.slots.findIndex((s) => s?.item === item);
  game.moveItem(id, { c: 'me', i: at('wood') }, { c: furnace.id, i: FURNACE_FUEL });
  game.moveItem(id, { c: 'me', i: at('rawMeat') }, { c: furnace.id, i: FURNACE_ORE_SLOTS[0] });
  game.furnace(id, furnace.id, true);
  t = run(game, t, 12);
  assert.equal(FURNACE_OUTPUT_SLOTS.map((i) => furnace.slots[i]).find((s) => s?.item === 'cookedMeat')?.count, 2);

  t = run(game, t, ASHHOUND.respawn + ASHHOUND.corpse);
  assert.equal(alive(game).length, count, 'a new hound joins the pack');
  assert.ok(!game.hounds.has(h.id), 'the body is gone');
});

test('three feeds of cooked meat tame a hound, which then follows and heals on more meat', () => {
  const { game, id, p } = setup();
  const h = alive(game)[0];
  p.safeUntil = 1e9;
  hold(game, id, 'cookedMeat', 5);
  let t = 1000;
  for (let n = 1; n <= ASHHOUND.tameFeeds; n++) {
    standAt(game, id, h.x + 1.2, h.z);
    const out = game.use(id, 2, (t += 2500));
    assert.ok(out.some((o) => o.msg.t === 'notice'), `feed ${n}`);
    assert.equal(h.fed, n === ASHHOUND.tameFeeds ? 0 : n);
  }
  assert.equal(h.owner, id);
  assert.equal(h.name, "Ash's Ashhound");
  assert.equal(have(game, id, 'cookedMeat'), 2);
  // It stays calm even once the survivor is fair game again.
  p.safeUntil = 0;
  standAt(game, id, h.x + 15, h.z + 15);
  t = run(game, t, 6);
  assert.ok(Math.hypot(h.x - p.x, h.z - p.z) < 4, 'came to heel');

  h.hp = 40;
  standAt(game, id, h.x + 1, h.z);
  game.use(id, 2, (t += 2500));
  assert.equal(h.hp, 85, 'fed meat heals it');
  assert.equal(have(game, id, 'cookedMeat'), 1);
});

test("a tame hound goes for whoever hurts its owner, and is saved with the world", () => {
  const { game, id, p } = setup();
  const h = alive(game)[0];
  Object.assign(h, { owner: id, name: "Ash's Ashhound", pack: -1 });
  p.safeUntil = 1e9;
  // Move everyone far from the dens, where the wild packs will not interfere.
  const [dx, dz] = packDens(SEED)[0];
  const x = -dx * 0.2;
  const z = -dz * 0.2;
  standAt(game, id, x, z);
  Object.assign(h, { x: x + 2, z, y: terrainHeight(SEED, x + 2, z) });
  const foe = game.join('Bo', 0)!.id;
  standAt(game, foe, x + 6, z);
  hold(game, foe, 'machete');
  standAt(game, foe, x + 1.5, z);
  game.melee(foe, 2, [-1, -0.3, 0], 2000);
  assert.ok(p.hp < 100, 'owner was cut');
  run(game, 2000, 4);
  assert.deepEqual(h.target, { kind: 'player', id: foe });
  assert.ok(game.players.get(foe)!.hp < 100, 'the hound bit back');

  const save = game.save(10_000);
  assert.equal(save.hounds?.length, 1);
  const back = Game.restore(JSON.parse(JSON.stringify(save)), 20_000);
  const again = [...back.hounds.values()].find((o) => o.owner === id)!;
  assert.equal(again.name, "Ash's Ashhound");
  assert.ok(Math.abs(again.x - h.x) < 0.01);
});

test('nobody keeps more than two hounds', () => {
  const { game, id, p } = setup();
  p.safeUntil = 1e9;
  const [a, b, c] = alive(game);
  a.owner = id;
  b.owner = id;
  hold(game, id, 'cookedMeat', 3);
  standAt(game, id, c.x + 1, c.z);
  // Far from the others so the feed goes to the wild one.
  Object.assign(a, { x: c.x + 30, z: c.z });
  Object.assign(b, { x: c.x + 30, z: c.z + 2 });
  const out = game.use(id, 2, 5000);
  assert.ok(out.some((o) => o.msg.t === 'notice' && o.msg.text.includes('only keep')));
  assert.equal(c.fed, 0);
});
