import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Bots } from '../server/bots.ts';
import { Events } from '../server/events.ts';
import { Game, type Outgoing } from '../server/game.ts';
import { MAX_PLAYERS } from '../shared/constants.ts';
import { HACK_SECONDS, RAIDERS, REINFORCEMENTS } from '../shared/events.ts';
import { stashSpots } from '../shared/landmarks.ts';
import { mulberry32 } from '../shared/terrain.ts';

function setup(fill = 0) {
  const game = new Game(1234);
  game.wildlife = false;
  const bots = new Bots(game, fill, mulberry32(7));
  const events = new Events(game, bots, { first: 1, every: 30 }, mulberry32(8));
  return { game, bots, events };
}

/** Runs the world for `seconds`, keeping whoever `hold` names standing still, and collects everything sent. */
function run(s: ReturnType<typeof setup>, from: number, seconds: number, hold?: () => void): { now: number; out: Outgoing[] } {
  let now = from;
  const out: Outgoing[] = [];
  for (let n = 0; n < seconds * 20; n++) {
    now += 50;
    hold?.();
    out.push(...s.bots.tick(now), ...s.events.tick(now), ...s.game.tick(now));
  }
  return { now, out };
}

const notices = (out: Outgoing[]) => out.flatMap((o) => (o.msg.t === 'notice' ? [o.msg.text] : []));

test('a raid starts a while after someone joins, with raiders round a locked crate', () => {
  const s = setup();
  const me = s.game.join('Ash', 0)!;
  const { out } = run(s, 0, 61);
  const e = s.events.current;
  assert.ok(e, 'no raid started');
  assert.ok(notices(out).some((t) => t.startsWith('Raiders have taken')));
  assert.ok(stashSpots(s.game.seed).some((spot) => spot.name === e.place));
  const crate = s.game.deployables.get(e.crate)!;
  assert.equal(crate.kind, 'lockedCrate');
  assert.equal(crate.locked, true);
  assert.ok(crate.slots.filter(Boolean).length >= 6);
  const raiders = [...s.game.players.values()].filter((p) => p.raider);
  assert.equal(raiders.length, RAIDERS);
  assert.ok(raiders.every((r) => Math.hypot(r.x - e.x, r.z - e.z) < 20));
  // Raiders take no place on the server.
  assert.equal(s.game.headCount, 1);
  assert.ok(me.id > 0);
});

test('the crate stays shut until hacked, and the hack brings backup', () => {
  const s = setup();
  const me = s.game.join('Ash', 0)!;
  const p = s.game.players.get(me.id)!;
  let { now } = run(s, 0, 61);
  const e = s.events.current!;
  const crate = s.game.deployables.get(e.crate)!;
  // Nobody shoots in this test: the raiders are only counted.
  for (const r of s.game.players.values()) if (r.raider) r.slots.fill(null);
  const stand = () => {
    p.x = crate.x + 1.6;
    p.z = crate.z;
    p.y = crate.y;
    p.hp = 100;
  };
  stand();
  // Can't take anything while it's locked.
  s.game.moveItem(me.id, { c: crate.id, i: 0 }, { c: 'me', i: 10 });
  assert.equal(p.slots[10], null);
  const hacked = s.events.hack(me.id, crate.id, now);
  assert.ok(notices(hacked).some((t) => t.includes('is hacking the locked crate')));
  assert.equal(crate.hackEnd, now + HACK_SECONDS * 1000);
  assert.equal([...s.game.players.values()].filter((r) => r.raider).length, RAIDERS + REINFORCEMENTS);
  // A second press only says how long is left.
  assert.ok(notices(s.events.hack(me.id, crate.id, now))[0].startsWith('Already being hacked'));
  ({ now } = run(s, now, HACK_SECONDS + 1, stand));
  assert.equal(crate.locked, false);
  assert.equal(s.events.current?.open, true);
  // Empty it: the raid is over and the raiders go.
  for (let i = 0; i < crate.slots.length; i++) if (crate.slots[i]) s.game.moveItem(me.id, { c: crate.id, i }, { c: 'me', i: p.slots.findIndex((x) => !x) });
  const after = run(s, now, 1, stand);
  assert.equal(s.events.current, null);
  assert.ok(notices(after.out).some((t) => t.includes('has been looted')));
  assert.ok(![...s.game.players.values()].some((r) => r.raider));
  assert.ok(!s.game.deployables.has(crate.id));
});

test('you must be at the crate to hack it', () => {
  const s = setup();
  const me = s.game.join('Ash', 0)!;
  const { now } = run(s, 0, 61);
  const e = s.events.current!;
  const p = s.game.players.get(me.id)!;
  p.x = e.x + 30;
  p.z = e.z;
  assert.deepEqual(notices(s.events.hack(me.id, e.crate, now)), ['Get closer to the crate']);
  assert.equal(s.game.deployables.get(e.crate)!.hackEnd, undefined);
});

test('raiders shoot a survivor who comes for the crate, and stay down when killed', () => {
  const s = setup();
  const me = s.game.join('Ash', 0)!;
  const p = s.game.players.get(me.id)!;
  let { now } = run(s, 0, 61);
  const e = s.events.current!;
  // Past the grace a fresh spawn gets, standing in the open near the crate.
  p.safeUntil = 0;
  const stand = () => {
    if (p.dead) return;
    p.x = e.x + 12;
    p.z = e.z;
    p.y = s.game.deployables.get(e.crate)!.y;
  };
  ({ now } = run(s, now, 20, stand));
  assert.ok(p.hp < 100 || p.dead, 'no raider hit them');
  // Every raider falls: they don't come back, and everyone hears they are down.
  const raiders = [...s.game.players.values()].filter((r) => r.raider);
  for (const r of raiders) {
    r.hp = 0;
    r.dead = true;
  }
  const after = run(s, now, 12);
  assert.ok(notices(after.out).some((t) => t.startsWith('Every raider at')));
  assert.ok(![...s.game.players.values()].some((r) => r.raider));
  assert.equal(s.events.current?.raiders, 0);
});

test('nobody coming: the raiders pull out and take the crate with them', () => {
  const s = setup();
  s.game.join('Ash', 0);
  let { now } = run(s, 0, 61);
  const crate = s.events.current!.crate;
  ({ now } = run(s, now, 30 * 60 + 1));
  assert.equal(s.events.current, null);
  assert.ok(!s.game.deployables.has(crate));
  assert.ok(![...s.game.players.values()].some((r) => r.raider));
  assert.ok(now > 0);
});

test('raiders never stop a player joining a full server, nor push out the drifters', () => {
  const s = setup(5);
  s.bots.balance(0, 0);
  s.game.join('Ash', 0);
  s.bots.balance(1, 0);
  run(s, 0, 61);
  assert.ok(s.events.current);
  assert.equal(s.bots.count, 4);
  // Fill every place with people: the raiders don't count.
  for (let n = s.game.headCount; n < MAX_PLAYERS; n++) assert.ok(s.game.join(`P${n}`, 0));
  assert.equal(s.game.headCount, MAX_PLAYERS);
});

test('a raider is never saved with the world', () => {
  const s = setup();
  s.game.join('Ash', 0);
  run(s, 0, 61);
  const restored = Game.restore(s.game.save(70_000), 70_000);
  assert.ok(![...restored.deployables.values()].some((d) => d.kind === 'lockedCrate'));
});
