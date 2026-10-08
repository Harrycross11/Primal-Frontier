import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game, type Outgoing } from '../server/game.ts';
import { biomeAt } from '../shared/biomes.ts';
import { LAND_SPECIES, SPECIES, herds, type Species } from '../shared/creatures.ts';
import { PLAYER_SPRINT } from '../shared/constants.ts';
import { terrainHeight } from '../shared/terrain.ts';
import type { Hound } from '../server/wildlife.ts';

const SEED = 4321;

function setup() {
  const game = new Game(SEED);
  game.loot = false;
  const id = game.join('Rider', 0)!.id;
  const p = game.players.get(id)!;
  p.safeUntil = 0;
  game.tick(0);
  return { game, id, p };
}

function run(game: Game, from: number, seconds: number, out: Outgoing[] = []): number {
  let t = from;
  while (t < from + seconds * 1000) out.push(...game.tick((t += 250)));
  return t;
}

function standAt(game: Game, id: number, x: number, z: number) {
  const p = game.players.get(id)!;
  Object.assign(p, { x, z, y: terrainHeight(game.seed, x, z) });
}

const of = (game: Game, species: Species) => [...game.hounds.values()].filter((h) => h.species === species && !h.deadAt);

/** Stands a little way off an animal's flank, where it can be fed. */
function besides(game: Game, id: number, h: Hound) {
  standAt(game, id, h.x + SPECIES[h.species].width / 2 + 1, h.z);
}

test("each land's own animal lives in herds out in that land", () => {
  for (const seed of [SEED, 1, 42, 2024]) {
    const list = herds(seed);
    for (const species of LAND_SPECIES) {
      const mine = list.filter((h) => h.species === species);
      assert.ok(mine.length >= 1, `seed ${seed}: there are ${species}`);
      for (const h of mine) assert.equal(biomeAt(seed, h.x, h.z), SPECIES[species].land, `${species} live in their land`);
    }
  }
  const { game } = setup();
  for (const species of LAND_SPECIES) assert.ok(of(game, species).length >= SPECIES[species].herd, `${species} are born`);
});

test('a skittish elk runs from someone sprinting at it, but not from someone walking up', () => {
  const { game, id, p } = setup();
  const elk = of(game, 'elk')[0];
  // Walking up: it stays put.
  standAt(game, id, elk.x + 8, elk.z);
  let t = 0;
  for (let n = 0; n < 8; n++) {
    game.move(id, p.x - 0.5, p.y, p.z, 0, true, (t += 250));
    game.tick(t);
  }
  assert.ok(elk.fleeUntil < t, 'not spooked by a walk');
  // Sprinting at it: off it goes.
  for (let n = 0; n < 4; n++) {
    game.move(id, p.x - PLAYER_SPRINT * 0.25, p.y, p.z, 0, true, (t += 250));
    game.tick(t);
  }
  assert.ok(elk.fleeUntil > t, 'spooked by a sprint');
});

test('feed sacks tame a mule, which you can then ride faster than you can run, and get off again', () => {
  const { game, id, p } = setup();
  const mule = of(game, 'mule')[0];
  p.slots[2] = { item: 'feedSack', count: 5 };
  let t = 1000;
  for (let n = 1; n <= SPECIES.mule.tameFeeds; n++) {
    besides(game, id, mule);
    const out = game.use(id, 2, t);
    assert.ok(out.some((o) => o.msg.t === 'notice'), `feed ${n}`);
    t = run(game, t, 2.5);
  }
  assert.equal(mule.owner, id, 'tamed');
  assert.equal(p.slots[2]?.count, 5 - SPECIES.mule.tameFeeds);

  // Climb on.
  besides(game, id, mule);
  const on = game.ride(id, mule.id);
  assert.ok(on.some((o) => o.msg.t === 'mounted' && o.msg.id === mule.id));
  assert.equal(p.riding, mule.id);
  // Galloping faster than anyone can sprint is fine in the saddle.
  const speed = SPECIES.mule.ride!.sprint;
  for (let n = 0; n < 8; n++) {
    t += 250;
    const out = game.move(id, p.x + speed * 0.25, p.y, p.z, 0, true, t);
    assert.equal(out.length, 0, 'not corrected');
    game.tick(t);
  }
  assert.ok(Math.hypot(mule.x - p.x, mule.z - p.z) < 0.01, 'the mule carries you');
  assert.equal(mule.anim, 'run');
  // And off again, beside it.
  const off = game.ride(id, null);
  assert.ok(off.some((o) => o.msg.t === 'mounted' && o.msg.id === null));
  assert.equal(p.riding, undefined);
  assert.equal(mule.rider, null);
  assert.ok(Math.hypot(mule.x - p.x, mule.z - p.z) > 0.5);
});

test("nobody else can ride your animal, and you can't ride a wild one", () => {
  const { game, id } = setup();
  const other = game.join('Thief', 0)!.id;
  const mule = of(game, 'mule')[0];
  besides(game, id, mule);
  assert.ok(game.ride(id, mule.id).some((o) => o.msg.t === 'notice'), 'wild');
  mule.owner = id;
  besides(game, other, mule);
  assert.ok(game.ride(other, mule.id).some((o) => o.msg.t === 'notice'), 'not theirs');
  assert.equal(mule.rider, null);
});

test('hurt one buffalo and the herd charges', () => {
  const { game, id, p } = setup();
  const [a] = of(game, 'buffalo');
  standAt(game, id, a.x + 6, a.z);
  let t = run(game, 0, 2);
  assert.ok(of(game, 'buffalo').every((b) => !b.target), 'left alone while nobody hurts them');
  p.slots[2] = { item: 'assaultRifle', count: 1, hp: 100, ammo: 30 };
  const herdmates = of(game, 'buffalo').filter((b) => b.pack === a.pack);
  // Shoot it from beside it.
  const dir: [number, number, number] = [a.x - p.x, a.y + 1.1 - (p.y + 1.6), a.z - p.z];
  game.fire(id, 2, dir, true, (t += 100));
  assert.ok(a.hp < SPECIES.buffalo.maxHp, 'hit');
  assert.ok(herdmates.filter((b) => b.target?.id === id).length > 1, 'the herd comes for you');
  const before = p.hp;
  t = run(game, t, 6);
  assert.ok(p.hp < before, 'and gores you');
});

test('riding a camel keeps you from getting thirsty', () => {
  const thirst = (riding: boolean) => {
    const { game, id, p } = setup();
    const camel = of(game, 'camel')[0];
    camel.owner = id;
    besides(game, id, camel);
    if (riding) game.ride(id, camel.id);
    p.vitals.water = 200;
    run(game, 0, 60);
    return 200 - p.vitals.water;
  };
  assert.ok(thirst(true) < thirst(false) * 0.5);
});

test('a frost bear hunts anyone who strays close, and cooked meat tames it', () => {
  const { game, id, p } = setup();
  const bear = of(game, 'bear')[0];
  standAt(game, id, bear.x + 8, bear.z);
  run(game, 0, 1);
  assert.equal(bear.target?.id, id, 'it comes for you');
  p.slots[2] = { item: 'cookedMeat', count: 10 };
  let t = 2000;
  for (let n = 0; n < SPECIES.bear.tameFeeds; n++) {
    besides(game, id, bear);
    game.use(id, 2, t);
    t = run(game, t, 2.5);
  }
  assert.equal(bear.owner, id);
  assert.equal(bear.target, null);
});
