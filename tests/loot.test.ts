import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CRATE_RESPAWN, DROP_FALL, FIRST_DROP, Game, SIGNAL_DELAY, type Outgoing } from '../server/game.ts';
import { BIOME_IDS, biomeAt } from '../shared/biomes.ts';
import { CRATE_KINDS, type Deployable } from '../shared/deployables.ts';
import { countItem, type ItemId } from '../shared/items.ts';
import { LANDMARKS, crateSpots, landmarks } from '../shared/landmarks.ts';
import { LOOT, rollLoot } from '../shared/loot.ts';
import { SITE_RADIUS, landmarkSites, mulberry32, terrainHeight } from '../shared/terrain.ts';

const SEED = 1234;

function setup() {
  const game = new Game(SEED);
  game.wildlife = false;
  const id = game.join('Looter', 0)!.id;
  return { game, id };
}

function standAt(game: Game, id: number, x: number, z: number) {
  const p = game.players.get(id)!;
  p.x = x;
  p.z = z;
  p.y = terrainHeight(game.seed, x, z);
}

/** Ticks the game a quarter second at a time, collecting what it sends. */
function run(game: Game, from: number, seconds: number, out: Outgoing[] = []): number {
  let t = from;
  out.push(...game.tick(t));
  while (t < from + seconds * 1000) out.push(...game.tick((t += 250)));
  return t;
}

const crates = (game: Game) => [...game.deployables.values()].filter((d) => d.spot);

test('every land has a landmark on level ground, inside that land', () => {
  for (const seed of [SEED, 1, 42, 2024, 31337]) {
    const sites = landmarkSites(seed);
    assert.equal(sites.length, BIOME_IDS.length);
    for (const s of sites) {
      assert.equal(biomeAt(seed, s.x, s.z), BIOME_IDS[s.land], `seed ${seed}: ${BIOME_IDS[s.land]} landmark is in its land`);
      for (const [dx, dz] of [
        [0, 0],
        [SITE_RADIUS - 1, 0],
        [0, -(SITE_RADIUS - 1)],
        [-15, 15],
      ]) {
        assert.ok(Math.abs(terrainHeight(seed, s.x + dx, s.z + dz) - s.y) < 1e-9, 'the pad is level');
      }
    }
    for (const a of sites) for (const b of sites) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 2 * SITE_RADIUS, 'landmarks stay apart');
  }
  assert.deepEqual(Object.keys(LANDMARKS).sort(), [...BIOME_IDS].sort());
});

test('crates fill up at every landmark, give their loot, and come back after they are emptied', () => {
  const { game, id } = setup();
  run(game, 0, 1);
  const spots = crateSpots(SEED);
  assert.equal(crates(game).length, spots.length, 'a crate at every spot');
  for (const c of crates(game)) assert.ok(c.slots.some(Boolean), `${c.kind} has loot`);
  assert.ok(crates(game).some((c) => c.kind === 'militaryCrate'));

  const crate = crates(game)[0];
  standAt(game, id, crate.x + 1, crate.z);
  const out = game.hitDeployable(id, crate.id, 5000);
  assert.ok(out.some((o) => o.msg.t === 'notice'), 'crates are opened, not broken');
  assert.ok(game.deployables.has(crate.id));

  // Nothing can be put in.
  const p = game.players.get(id)!;
  const empty = crate.slots.findIndex((s) => !s);
  game.moveItem(id, { c: 'me', i: 0 }, { c: crate.id, i: empty }, 1);
  assert.equal(p.slots[0]?.item, 'rock', 'the rock stays with you');

  // Take everything: the crate goes, and comes back full later.
  const want = new Map<ItemId, number>();
  for (const s of crate.slots) if (s) want.set(s.item, (want.get(s.item) ?? 0) + s.count);
  crate.slots.forEach((s, i) => {
    if (s) game.moveItem(id, { c: crate.id, i }, { c: 'me', i: 6 + i });
  });
  for (const [item, n] of want) assert.ok(countItem(p.slots, item) >= n, `got the ${item}`);
  assert.equal(game.deployables.has(crate.id), false, 'the emptied crate is gone');
  let t = run(game, 5000, CRATE_RESPAWN - 10);
  assert.equal(crates(game).some((c) => c.spot === crate.spot), false, 'not back yet');
  t = run(game, t, 15);
  const back = crates(game).find((c) => c.spot === crate.spot);
  assert.ok(back && back.slots.some(Boolean), 'refilled');
});

test("nobody can build or set things down at a landmark", () => {
  const { game, id } = setup();
  const [{ site, landmark }] = landmarks(SEED);
  standAt(game, id, site.x + 2, site.z + 2);
  const p = game.players.get(id)!;
  p.slots[2] = { item: 'storageBox', count: 1 };
  const out = game.deploy(id, 2, site.x + 3, site.y, site.z + 2, 0);
  assert.ok(out.some((o) => o.msg.t === 'notice' && o.msg.text.includes(landmark.name)));
  assert.equal(countItem(p.slots, 'storageBox'), 1);
});

test('a supply signal calls the plane, which drops a crate on a parachute', () => {
  const { game, id } = setup();
  game.loot = false;
  // Out on open ground, clear of the landmarks.
  const site = landmarkSites(SEED)[0];
  const x = site.x + SITE_RADIUS + 30;
  const z = site.z;
  standAt(game, id, x, z);
  const p = game.players.get(id)!;
  p.slots[2] = { item: 'supplySignal', count: 1 };
  game.throwGrenade(id, 2, [0, -1, 0.3], 0);
  const signal = [...game.deployables.values()].find((d) => d.kind === 'supplySignal');
  assert.ok(signal, 'the signal is smoking on the ground');
  assert.equal(countItem(p.slots, 'supplySignal'), 0);

  const out: Outgoing[] = [];
  let t = run(game, 0, SIGNAL_DELAY + 0.5, out);
  const plane = out.find((o) => o.msg.t === 'plane')?.msg;
  assert.ok(plane && plane.t === 'plane', 'the plane is on its way');
  assert.ok(Math.hypot(plane.drop[0] - signal!.x, plane.drop[1] - signal!.z) < 5, 'it drops by the smoke');

  // It flies in, drops, and the crate floats down.
  let drop: Deployable | undefined;
  while (!drop && t < 60_000) {
    t = run(game, t, 1);
    drop = [...game.deployables.values()].find((d) => d.kind === 'supplyDrop');
  }
  assert.ok(drop?.fall, 'a crate is falling');
  assert.ok(drop!.slots.filter(Boolean).length >= LOOT.supplyDrop.rolls[0]);
  standAt(game, id, drop!.x + 1, drop!.z);
  const i = drop!.slots.findIndex(Boolean);
  game.moveItem(id, { c: drop!.id, i }, { c: 'me', i: 10 });
  assert.ok(drop!.slots[i], "can't loot it in the air");
  t = run(game, t, (drop!.fall!.from - drop!.y) / DROP_FALL + 1);
  game.moveItem(id, { c: drop!.id, i }, { c: 'me', i: 10 });
  assert.equal(drop!.slots[i], null, 'looted once it lands');
  assert.ok(CRATE_KINDS.includes(drop!.kind));
});

test('a supply plane comes over on its own once people are playing', () => {
  const { game } = setup();
  const out: Outgoing[] = [];
  run(game, 0, FIRST_DROP * 60 + 1, out);
  assert.ok(out.some((o) => o.msg.t === 'plane'));
  assert.ok(out.some((o) => o.msg.t === 'notice' && o.msg.text.startsWith('A supply plane')));
});

test('crates waiting to refill are remembered across a restart', () => {
  const { game, id } = setup();
  run(game, 0, 1);
  const crate = crates(game)[0];
  standAt(game, id, crate.x + 1, crate.z);
  crate.slots.forEach((s, i) => {
    if (s) game.moveItem(id, { c: crate.id, i }, { c: 'me', i: 6 + i });
  });
  assert.equal(game.deployables.has(crate.id), false);
  const back = Game.restore(JSON.parse(JSON.stringify(game.save(60_000))), 0);
  back.wildlife = false;
  run(back, 0, 5);
  assert.equal(crates(back).length, crateSpots(SEED).length - 1, 'still empty after the restart');
  run(back, 5000, CRATE_RESPAWN);
  assert.equal(crates(back).length, crateSpots(SEED).length);
});

test('crates hold a few different things from their table', () => {
  const rand = mulberry32(7);
  for (const kind of ['crate', 'militaryCrate', 'supplyDrop'] as const) {
    for (let n = 0; n < 50; n++) {
      const stacks = rollLoot(kind, 'mesa', rand);
      const fromTable = stacks.filter((s) => LOOT[kind].table.some((r) => r.item === s.item));
      assert.ok(fromTable.length >= LOOT[kind].rolls[0]);
      const items = stacks.map((s) => s.item);
      for (const s of stacks) assert.ok(s.count >= 1);
      assert.ok(new Set(items).size >= items.length - 1, 'no repeats from the table');
    }
  }
});
