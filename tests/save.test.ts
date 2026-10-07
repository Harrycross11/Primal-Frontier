import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Game } from '../server/game.ts';
import { FileStore } from '../server/store.ts';
import { buildBaseY } from '../shared/building.ts';
import { addItem, countItem } from '../shared/items.ts';
import { terrainHeight } from '../shared/terrain.ts';

const TOKEN = 'a-private-browser-token-123';

/** A world with one survivor who has built a floor and is carrying wood. */
function builtWorld() {
  const game = new Game(77);
  game.startedAt = 1_000;
  const id = game.join('Ash', 0, null, TOKEN)!.id;
  const p = game.players.get(id)!;
  p.x = 1.5;
  p.z = 7.5;
  p.y = terrainHeight(game.seed, p.x, p.z);
  addItem(p.slots, 'wood', 300);
  p.active = 1;
  game.place(id, 'floor', 0, buildBaseY(game.seed, 1.5, 4.5), 1, 0, 'wood');
  return { game, id };
}

test('a saved world comes back with its buildings, seed and survivors', async () => {
  const { game, id } = builtWorld();
  assert.equal(game.pieces.size, 1);
  const wood = countItem(game.players.get(id)!.slots, 'wood');
  game.resources[3].amount = 1;

  const store = new FileStore(join(mkdtempSync(join(tmpdir(), 'pf-')), 'world.json'));
  await store.save(game.save(5_000));
  const back = Game.restore((await store.load())!, 9_000);

  assert.equal(back.seed, 77);
  assert.equal(back.startedAt, 1_000);
  assert.deepEqual([...back.pieces.keys()], [...game.pieces.keys()]);
  assert.equal(back.resources[3].amount, 1);

  // The same browser gets the same survivor back, with what they carried and where they stood.
  const again = back.join('', 10_000, null, TOKEN)!.id;
  assert.equal(again, id);
  const p = back.players.get(again)!;
  assert.equal(p.name, 'Ash');
  assert.equal(countItem(p.slots, 'wood'), wood);
  assert.equal(p.x, 1.5);
  // Someone else is somebody new.
  assert.notEqual(back.join('Bo', 10_000, null, 'another-browser-token-456')!.id, id);
});

test('leaving and rejoining keeps your things, but only for your own browser', () => {
  const { game, id } = builtWorld();
  game.leave(id);
  const stranger = game.join('Ash', 0)!.id;
  assert.equal(countItem(game.players.get(stranger)!.slots, 'wood'), 0, 'same name, no token: a fresh survivor');
  const back = game.join('Ash', 0, null, TOKEN)!.id;
  assert.equal(back, id);
  assert.ok(countItem(game.players.get(back)!.slots, 'wood') > 0);
  // A second tab with the same token does not get a copy of the same survivor.
  const twin = game.join('Ash', 0, null, TOKEN)!.id;
  assert.notEqual(twin, id);
  assert.equal(countItem(game.players.get(twin)!.slots, 'wood'), 0);
});

test('a survivor who left dead comes back fresh', () => {
  const { game, id } = builtWorld();
  const p = game.players.get(id)!;
  p.dead = true;
  p.hp = 0;
  game.leave(id);
  const back = game.players.get(game.join('Ash', 0, null, TOKEN)!.id)!;
  assert.equal(back.dead, false);
  assert.equal(countItem(back.slots, 'wood'), 0);
});
