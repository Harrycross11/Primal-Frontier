import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Accounts } from '../server/accounts.ts';
import { Game, type Outgoing } from '../server/game.ts';
import { PAINTS } from '../shared/paint.ts';
import { DAILY_COUNT, OBJECTIVES, PACKS, START_COINS, dailyObjectives, dayOf } from '../shared/shop.ts';

const SEED = 1234;
const TOKEN = 'test-token-0123456789';
const DAY = 86_400_000;
const CHROME = PAINTS.findIndex((p) => p.name === 'Chrome');

/** The first moment (from 2026) on a day whose objectives include `id`. */
function dayWith(id: string): number {
  for (let t = Date.UTC(2026, 0, 1); ; t += DAY) if (dailyObjectives(dayOf(t)).some((o) => o.id === id)) return t;
}

const told = (out: Outgoing[], text: string) => out.some((o) => o.msg.t === 'notice' && o.msg.text.includes(text));

test('each day brings a few different objectives, the same for everyone', () => {
  const today = dailyObjectives('2026-10-09');
  assert.equal(today.length, DAILY_COUNT);
  assert.equal(new Set(today.map((o) => o.id)).size, DAILY_COUNT);
  assert.deepEqual(dailyObjectives('2026-10-09'), today);
  const seen = new Set<string>();
  for (let d = 1; d <= 28; d++) for (const o of dailyObjectives(`2026-02-${String(d).padStart(2, '0')}`)) seen.add(o.id);
  assert.equal(seen.size, OBJECTIVES.length, 'every objective comes up within a month');
});

test('objectives pay coins once, and a new day starts them afresh but keeps coins and packs', () => {
  const now = dayWith('wood');
  const accounts = new Accounts();
  assert.equal(accounts.view(TOKEN, now).coins, START_COINS);
  assert.deepEqual(accounts.bump(TOKEN, 'wood', 300, now), []);
  const done = accounts.bump(TOKEN, 'wood', 250, now);
  assert.equal(done[0]?.id, 'wood');
  const paid = START_COINS + done[0].reward;
  assert.equal(accounts.view(TOKEN, now).coins, paid);
  assert.deepEqual(accounts.bump(TOKEN, 'wood', 1000, now), [], 'paid only once');
  const wood = accounts.view(TOKEN, now).objectives.find((o) => o.id === 'wood')!;
  assert.equal(wood.done, true);
  assert.equal(wood.progress, wood.goal);

  assert.equal(accounts.buy(TOKEN, 'nope', now), 'unknown');
  accounts.get(TOKEN, now).coins = 5000;
  assert.equal(accounts.buy(TOKEN, 'chrome', now), 'bought');
  assert.equal(accounts.buy(TOKEN, 'chrome', now), 'owned');
  const tomorrow = accounts.view(TOKEN, now + DAY);
  assert.ok(tomorrow.objectives.every((o) => o.progress === 0 && !o.done));
  assert.deepEqual(tomorrow.packs, ['chrome']);

  // Saved and loaded, as the server does apart from the world.
  const back = new Accounts();
  back.load(JSON.parse(JSON.stringify(accounts.dump())));
  assert.equal(back.view(TOKEN, now + DAY).coins, 5000 - PACKS.find((p) => p.id === 'chrome')!.price);
  assert.deepEqual(back.view(TOKEN, now + DAY).packs, ['chrome']);
});

test('store paints need their pack, which coins unlock', () => {
  const game = new Game(SEED);
  game.wildlife = false;
  game.loot = false;
  const { id } = game.join('Buyer', 0, null, TOKEN)!;
  const p = game.players.get(id)!;
  p.slots[2] = { item: 'crossbow', count: 1, ammo: 0 };
  assert.ok(told(game.paintItem(id, 2, CHROME), 'Chrome Pack'));
  assert.equal(p.slots[2]!.paint, undefined);
  assert.equal(game.buy({ id }, 'chrome', 0).ok, false, 'not enough coins to start with');
  game.accounts.get(TOKEN, 0).coins = 1000;
  const bought = game.buy({ token: TOKEN }, 'chrome', 0);
  assert.ok(bought.ok, bought.text);
  game.paintItem(id, 2, CHROME);
  assert.equal(p.slots[2]!.paint, CHROME);
  assert.equal(game.accounts.view(TOKEN, 0).coins, 400);
});

test('playing counts towards objectives and says when one is done', () => {
  const start = dayWith('survive');
  const game = new Game(SEED);
  game.wildlife = false;
  game.loot = false;
  game.cars = false;
  const { id } = game.join('Survivor', start, null, TOKEN)!;
  const p = game.players.get(id)!;
  let heard = false;
  for (let s = 0; s <= 20 * 60 + 2 && !heard; s++) {
    Object.assign(p, { hp: 100, vitals: { ...p.vitals, food: 400, water: 250 } });
    heard = game.tick(start + s * 1000).some((o) => o.to === id && o.msg.t === 'objectiveDone' && o.msg.label === 'Survive 20 minutes');
  }
  assert.ok(heard, 'told after 20 minutes alive');
  assert.ok(game.accounts.view(TOKEN, start).objectives.find((o) => o.id === 'survive')!.done);
});
