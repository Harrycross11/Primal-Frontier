import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DELAY, Track } from '../client/src/track.ts';

const at = () => ({ x: 0, y: 0, z: 0, yaw: 0 });

test('a tracked thing moves steadily between snapshots, drawn a little in the past', () => {
  const t = new Track();
  // Walking 4 m/s along x, a snapshot every 50 ms arriving a little unevenly.
  const arrive = [0, 55, 98, 152, 200, 247, 301];
  arrive.forEach((ms, i) => t.push(ms, i * 0.2, 0, 0, 0));
  let last = -Infinity;
  for (let now = DELAY + 60; now < 300 + DELAY; now += 16) {
    const p = t.sample(now, at());
    assert.ok(p.x >= last, `never steps back (${p.x} after ${last})`);
    last = p.x;
  }
  // Halfway between the snapshots either side of the moment drawn.
  assert.ok(Math.abs(t.sample(76.5 + DELAY, at()).x - 0.3) < 1e-9);
});

test('when snapshots stop it coasts briefly then holds', () => {
  const t = new Track();
  t.push(0, 0, 0, 0, 0);
  t.push(50, 1, 0, 0, 0);
  const coast = t.sample(50 + DELAY + 50, at()).x;
  assert.ok(coast > 1 && coast < 3);
  assert.equal(t.sample(50 + DELAY + 5000, at()).x, t.sample(50 + DELAY + 9000, at()).x);
});

test('turns the short way round and jumps straight to a respawn', () => {
  const t = new Track();
  t.push(0, 0, 0, 0, Math.PI - 0.1);
  t.push(50, 0, 0, 0, -Math.PI + 0.1);
  const yaw = t.sample(25 + DELAY, at()).yaw;
  assert.ok(Math.abs(Math.abs(yaw) - Math.PI) < 1e-9, `turned through the back, got ${yaw}`);
  t.push(100, 500, 0, 0, 0);
  assert.equal(t.sample(100 + DELAY, at()).x, 500);
});
