import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOOK_KEYS, LOOK_PARTS, cleanLook, defaultLook, randomLook } from '../shared/look.ts';
import { Game } from '../server/game.ts';

test('a look from a client is kept in range', () => {
  assert.deepEqual(cleanLook(null), defaultLook());
  const look = cleanLook({ skin: 2, hair: -1, jacket: 99, trousers: 1.5, head: '3', face: 4, extra: 1 });
  assert.equal(look.skin, 2);
  assert.equal(look.hair, 0);
  assert.equal(look.jacket, 0);
  assert.equal(look.trousers, 0);
  assert.equal(look.head, 0);
  assert.equal(look.face, 4);
  assert.deepEqual(Object.keys(look).sort(), [...LOOK_KEYS].sort());
  for (let i = 0; i < 50; i++) {
    const r = randomLook();
    for (const k of LOOK_KEYS) assert.ok(r[k] >= 0 && r[k] < LOOK_PARTS[k].options.length);
  }
});

test('other players see the look a survivor joined with', () => {
  const game = new Game(1);
  const { out } = game.join('Ash', 0, { skin: 3, head: 2 })!;
  const welcome = out.find((o) => o.msg.t === 'welcome')!.msg as { you: { look: { skin: number; head: number } } };
  assert.equal(welcome.you.look.skin, 3);
  assert.equal(welcome.you.look.head, 2);
});
