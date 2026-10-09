import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game } from '../server/game.ts';
import { DOOR_HP, MAX_HP, buildBaseY, pieceBoxes, pieceKey, type Piece } from '../shared/building.ts';
import { MAX_HEALTH } from '../shared/combat.ts';
import { TC_RANGE, privilege } from '../shared/deployables.ts';
import { EXPLOSIVES } from '../shared/explosives.ts';
import { addItem, countItem, type ItemId } from '../shared/items.ts';
import { terrainHeight } from '../shared/terrain.ts';

const SEED = 1234;

/** Level ground 12 m across, so walls and players sit where the test expects. */
const FLAT = (() => {
  for (let z = -60; z < 60; z += 3) {
    for (let x = -60; x < 60; x += 3) {
      const h = terrainHeight(SEED, x, z);
      let ok = true;
      for (let dx = -6; dx <= 6 && ok; dx += 1) for (let dz = -6; dz <= 6 && ok; dz += 1) ok = Math.abs(terrainHeight(SEED, x + dx, z + dz) - h) < 0.4;
      if (ok) return { x: Math.round(x / 3) * 3, z: Math.round(z / 3) * 3 };
    }
  }
  throw new Error('no flat ground');
})();

function setup(players = 2) {
  const game = new Game(SEED);
  game.wildlife = false;
  const ids = Array.from({ length: players }, (_, n) => game.join(`P${n}`, 0)!.id);
  for (const id of ids) standAt(game, id, FLAT.x + 0.5, FLAT.z + 1.5);
  return { game, ids };
}

function standAt(game: Game, id: number, x: number, z: number) {
  const p = game.players.get(id)!;
  p.x = x;
  p.z = z;
  p.y = terrainHeight(game.seed, x, z);
}

/** Puts `count` of an item in belt slot 2 and in the player's hands. */
function hold(game: Game, id: number, item: ItemId, count = 1) {
  const p = game.players.get(id)!;
  p.slots[2] = { item, count };
  p.active = 2;
}

const have = (game: Game, id: number, item: ItemId) => countItem(game.players.get(id)!.slots, item);

/** A wall at the flat spot running along x, edited as asked. */
function wall(game: Game, edit: Piece['edit'] = 'solid', material: Piece['material'] = 'wood', k = FLAT.z / 3 + 1): string {
  const i = FLAT.x / 3;
  const y = buildBaseY(SEED, FLAT.x + 1.5, k * 3);
  const piece: Piece = { kind: 'wall', i, y, k, dir: 0, material, edit, hp: MAX_HP[material] };
  const key = pieceKey(piece);
  game.pieces.set(key, piece);
  return key;
}

/** Sets down a tool cupboard for `owner` at the flat spot, returning its id. */
function cupboard(game: Game, owner: number): number {
  hold(game, owner, 'toolCupboard');
  game.deploy(owner, 2, FLAT.x - 1.5, terrainHeight(SEED, FLAT.x - 1.5, FLAT.z), FLAT.z, 0);
  const tc = [...game.deployables.values()].find((d) => d.kind === 'toolCupboard');
  assert.ok(tc, 'tool cupboard placed');
  return tc!.id;
}

function run(game: Game, from: number, seconds: number): number {
  let t = from;
  game.tick(t);
  while (t < from + seconds * 1000) game.tick((t += 250));
  return t;
}

test('a tool cupboard stops strangers building round it until it trusts them', () => {
  const { game, ids } = setup();
  const [owner, stranger] = ids;
  const tc = cupboard(game, owner);
  assert.equal(privilege(game.deployables.values(), FLAT.x, FLAT.z, owner), 'authorised');
  assert.equal(privilege(game.deployables.values(), FLAT.x, FLAT.z, stranger), 'blocked');
  assert.equal(privilege(game.deployables.values(), FLAT.x + TC_RANGE + 5, FLAT.z, stranger), 'none');

  addItem(game.players.get(stranger)!.slots, 'wood', 100);
  game.players.get(stranger)!.active = 1;
  const y = buildBaseY(SEED, FLAT.x + 1.5, FLAT.z + 1.5);
  const tryBuild = () => game.place(stranger, 'floor', FLAT.x / 3, y, FLAT.z / 3, 0, 'wood');
  const refused = tryBuild();
  assert.ok(refused.some((o) => o.msg.t === 'notice' && o.msg.text.startsWith('Building blocked')));
  assert.equal(game.pieces.size, 0);

  game.authorize(stranger, tc);
  tryBuild();
  assert.equal(game.pieces.size, 1, 'builds once authorised');

  // Clearing the list leaves only whoever cleared it.
  game.clearAuth(owner, tc);
  assert.deepEqual(game.deployables.get(tc)!.auth, [owner]);
});

test('inside a stranger\'s cupboard range, hands barely scratch wood and leave stone alone', () => {
  const { game, ids } = setup();
  const [owner, raider] = ids;
  cupboard(game, owner);
  const woodKey = wall(game, 'solid', 'wood');
  const stoneKey = wall(game, 'solid', 'stone', FLAT.z / 3 - 1);
  let t = 0;
  game.hit(raider, woodKey, (t += 1000));
  assert.equal(game.pieces.get(woodKey)!.hp, MAX_HP.wood - 3);
  game.hit(raider, stoneKey, (t += 1000));
  assert.equal(game.pieces.get(stoneKey)!.hp, MAX_HP.stone);
  // The owner can still knock their own wall down by hand.
  game.hit(owner, woodKey, (t += 1000));
  assert.ok(game.pieces.get(woodKey)!.hp < MAX_HP.wood - 3 - 10);
});

test('doors hang in doorways, block the way when shut and open only with the code', () => {
  const { game, ids } = setup();
  const [owner, other] = ids;
  const key = wall(game, 'door');
  const piece = game.pieces.get(key)!;
  const solidOpen = pieceBoxes(piece).length;

  hold(game, owner, 'woodenDoor');
  game.hangDoor(owner, key, 2);
  assert.equal(piece.door?.kind, 'woodenDoor');
  assert.equal(piece.door?.open, false);
  assert.equal(pieceBoxes(piece).length, solidOpen + 1, 'a closed door fills the doorway');
  assert.equal(have(game, owner, 'woodenDoor'), 0);

  game.toggleDoor(other, key);
  assert.equal(piece.door!.open, true, 'an unlocked door opens for anyone');
  game.toggleDoor(other, key);

  hold(game, owner, 'codeLock');
  game.lock(owner, key, 2, '12');
  assert.equal(piece.door!.locked, false, 'the code must be 4 digits');
  game.lock(owner, key, 2, '4821');
  assert.equal(piece.door!.locked, true);
  assert.ok(!JSON.stringify(piece).includes('4821'), 'the code is never sent with the piece');

  const asked = game.toggleDoor(other, key);
  assert.ok(asked.some((o) => o.msg.t === 'codeNeeded'));
  assert.equal(piece.door!.open, false);
  const before = game.players.get(other)!.hp;
  game.tryCode(other, key, '0000', 1000);
  assert.equal(game.players.get(other)!.hp, before - 5, 'a wrong code shocks');
  assert.equal(piece.door!.open, false);
  game.tryCode(other, key, '4821', 1500);
  assert.equal(piece.door!.open, false, 'too soon after the last try');
  game.tryCode(other, key, '4821', 2500);
  assert.equal(piece.door!.open, true);
  // Now it knows them.
  game.toggleDoor(other, key);
  game.toggleDoor(other, key);
  assert.equal(piece.door!.open, true);

  game.toggleDoor(owner, key);
  assert.equal(piece.door!.open, false, 'the owner never needs the code');
});

test('satchel charges blow open a wooden door; C4 takes out a stone wall in one', () => {
  const { game, ids } = setup();
  const [owner, raider] = ids;
  cupboard(game, owner);
  const doorKey = wall(game, 'door');
  const piece = game.pieces.get(doorKey)!;
  piece.door = { kind: 'woodenDoor', open: false, hp: DOOR_HP.woodenDoor, locked: false };
  standAt(game, raider, FLAT.x + 1.5, FLAT.z + 5.2);
  const doorFace: [number, number, number] = [FLAT.x + 1.5, piece.y + 1, FLAT.z + 3.06];

  let t = 0;
  hold(game, raider, 'satchel', 2);
  game.plant(raider, 2, doorFace, t, doorKey, true);
  game.plant(raider, 2, doorFace, t, doorKey, true);
  assert.equal(have(game, raider, 'satchel'), 0);
  const charges = [...game.deployables.values()].filter((d) => d.kind === 'satchel');
  assert.equal(charges.length, 2);
  // Run away from the blast.
  standAt(game, raider, FLAT.x + 1.5, FLAT.z + 12);
  t = run(game, t, EXPLOSIVES.satchel.fuse - 0.5);
  assert.ok(piece.door, 'still there just before the fuse runs out');
  let blasts = 0;
  for (let n = 0; n < 8; n++) blasts += game.tick((t += 250)).filter((o) => o.msg.t === 'explosion').length;
  assert.equal(blasts, 2);
  assert.equal(piece.door, undefined, 'the door is blown off');
  assert.ok(game.pieces.has(doorKey), 'the door frame survives');
  assert.equal(game.players.get(raider)!.hp, MAX_HEALTH, 'far enough away to be safe');

  const stoneKey = wall(game, 'solid', 'stone', FLAT.z / 3 + 2);
  const stone = game.pieces.get(stoneKey)!;
  standAt(game, raider, FLAT.x + 1.5, FLAT.z + 8);
  hold(game, raider, 'c4');
  game.plant(raider, 2, [FLAT.x + 1.5, stone.y + 1, FLAT.z + 6.12], t, stoneKey);
  standAt(game, raider, FLAT.x + 1.5, FLAT.z + 20);
  run(game, t, EXPLOSIVES.c4.fuse + 0.5);
  assert.ok(!game.pieces.has(stoneKey), 'one C4 for a stone wall');
});

test('a blast hurts people in the open but not behind a wall', () => {
  const { game, ids } = setup(3);
  const [bomber, open, hidden] = ids;
  const key = wall(game, 'solid', 'scrap');
  const piece = game.pieces.get(key)!;
  // The charge sits on the near side of the wall; one player stands beside it, one behind it.
  standAt(game, bomber, FLAT.x + 1.5, FLAT.z + 1.7);
  standAt(game, open, FLAT.x + 3.2, FLAT.z + 1.7);
  standAt(game, hidden, FLAT.x + 1.5, FLAT.z + 4.6);
  hold(game, bomber, 'beancan');
  // Dropped at the wall's foot.
  game.throwGrenade(bomber, 2, [0, -1, 0.15], 0);
  const g = [...game.deployables.values()].find((d) => d.kind === 'beancan')!;
  assert.ok(g, 'thrown');
  assert.ok(Math.abs(g.y - terrainHeight(SEED, g.x, g.z)) < 0.3, 'it lands on the ground');
  standAt(game, bomber, FLAT.x - 8, FLAT.z - 8);
  run(game, 0, EXPLOSIVES.beancan.fuse + 0.5);
  assert.ok(game.players.get(open)!.hp < MAX_HEALTH, 'hurt in the open');
  assert.equal(game.players.get(hidden)!.hp, MAX_HEALTH, 'safe behind the wall');
  assert.ok(piece.hp < MAX_HP.scrap, 'the wall took some of it');
});

test('you can wake up in your own sleeping bag, once a minute', () => {
  const { game, ids } = setup(1);
  const [id] = ids;
  hold(game, id, 'sleepingBag');
  const bx = FLAT.x + 2;
  game.deploy(id, 2, bx, terrainHeight(SEED, bx, FLAT.z), FLAT.z, 0);
  const bag = [...game.deployables.values()].find((d) => d.kind === 'sleepingBag')!;
  assert.ok(bag);
  const p = game.players.get(id)!;
  p.hp = 0;
  p.dead = true;
  game.respawn(id, bag.id, 1000);
  assert.equal(p.dead, false);
  assert.ok(Math.hypot(p.x - bag.x, p.z - bag.z) < 0.01, 'wakes on the bag');
  p.dead = true;
  const out = game.respawn(id, bag.id, 20_000);
  assert.ok(p.dead, 'still cooling down');
  assert.ok(out.some((o) => o.msg.t === 'notice' && /ready in \d+ s/.test(o.msg.text)));
  game.respawn(id, bag.id, 62_000);
  assert.equal(p.dead, false);
});

test('locks, lit charges and bag cooldowns survive a restart', () => {
  const { game, ids } = setup();
  const [owner] = ids;
  const key = wall(game, 'door');
  hold(game, owner, 'woodenDoor');
  game.hangDoor(owner, key, 2);
  hold(game, owner, 'codeLock');
  game.lock(owner, key, 2, '1111');
  hold(game, owner, 'satchel');
  const p = game.players.get(owner)!;
  game.plant(owner, 2, [p.x + 1, terrainHeight(SEED, p.x + 1, p.z) + 0.05, p.z], 0);
  const back = Game.restore(JSON.parse(JSON.stringify(game.save(1000))), 50_000);
  back.wildlife = false;
  const o2 = back.join('P1', 50_000)!.id;
  standAt(back, o2, FLAT.x + 0.5, FLAT.z + 1.5);
  assert.ok(back.toggleDoor(o2, key).some((o) => o.msg.t === 'codeNeeded'), 'still locked');
  assert.equal([...back.deployables.values()].filter((d) => d.kind === 'satchel').length, 1);
  run(back, 50_000, EXPLOSIVES.satchel.fuse);
  assert.equal([...back.deployables.values()].filter((d) => d.kind === 'satchel').length, 0, 'it still goes off');
});
