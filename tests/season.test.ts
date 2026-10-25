import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Accounts } from '../server/accounts.ts';
import { Game } from '../server/game.ts';
import { LOOK_REWARDS, randomLook } from '../shared/look.ts';
import { PAINTS, paintOwned } from '../shared/paint.ts';
import { OWNED_COINS, REWARD_IDS, TIER_XP, TITLES, XP_PER_MINUTE, lookReward, objectiveXp, rewardLabel, seasonAt, seasonNumber } from '../shared/season.ts';
import { START_COINS, dailyObjectives, dayOf } from '../shared/shop.ts';

const TOKEN = 'season-token-0123456789';
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 26, 12);

test('seasons follow each other with no gap, and every reward on a track exists', () => {
  const first = seasonAt(NOW);
  assert.equal(first.n, 1);
  assert.equal(first.name, 'Ashfall');
  assert.equal(seasonAt(0).n, 1, 'before the first season counts as the first');
  for (let n = 1; n < 6; n++) assert.equal(seasonNumber(n).end, seasonNumber(n + 1).start);
  assert.equal(seasonAt(first.end).n, 2);
  assert.equal(seasonAt(first.end - 1).n, 1);
  assert.ok(first.track.length >= 20);
  for (const r of first.track) {
    if (r.kind === 'paint') assert.ok(PAINTS.some((p) => p.pack === r.id && p.season === 1), r.id);
    if (r.kind === 'look') assert.ok(lookReward(r.id), r.id);
    if (r.kind === 'title') assert.equal(TITLES.get(r.id), r.title);
    assert.ok(!/undefined|NaN/.test(rewardLabel(r)), rewardLabel(r));
  }
  // Every season paint and outfit is on a track, so nothing is locked for good.
  for (const p of PAINTS) if (p.season) assert.ok(REWARD_IDS.has(p.pack!), p.name);
  for (const options of Object.values(LOOK_REWARDS)) for (const id of Object.values(options!)) assert.ok(REWARD_IDS.has(id), id);
});

test('XP climbs tiers that pay out once, and a reward already owned pays coins instead', () => {
  const accounts = new Accounts();
  const { track } = seasonAt(NOW);
  assert.equal(accounts.view(TOKEN, NOW).season.tier, 0);
  assert.deepEqual(accounts.addXp(TOKEN, TIER_XP - 1, NOW), []);
  const one = accounts.addXp(TOKEN, 1, NOW);
  assert.deepEqual(one, [{ tier: 1, reward: track[0] }]);
  assert.equal(track[0].kind, 'coins');
  const coins = START_COINS + (track[0].kind === 'coins' ? track[0].coins : 0);
  assert.equal(accounts.view(TOKEN, NOW).coins, coins);

  // Tier 2 is a paint: owned already (say from before), it pays coins.
  const paint = track[1];
  assert.equal(paint.kind, 'paint');
  if (paint.kind !== 'paint') return;
  accounts.get(TOKEN, NOW).packs.push(paint.id);
  const two = accounts.addXp(TOKEN, TIER_XP, NOW);
  assert.deepEqual(two, [{ tier: 2, reward: { kind: 'coins', coins: OWNED_COINS } }]);
  assert.equal(accounts.view(TOKEN, NOW).coins, coins + OWNED_COINS);

  // A big jump pays every tier on the way, and the top tier stops the climb.
  const all = accounts.addXp(TOKEN, TIER_XP * 100, NOW);
  assert.equal(all.length, track.length - 2);
  assert.equal(accounts.view(TOKEN, NOW).season.tier, track.length);
  assert.deepEqual(accounts.addXp(TOKEN, TIER_XP, NOW), []);
  const owned = accounts.view(TOKEN, NOW).packs;
  for (const r of track) if (r.kind !== 'coins') assert.ok(owned.includes(r.id), r.id);
  assert.equal(new Set(owned).size, owned.length, 'nothing unlocked twice');
});

test('finished objectives bring XP, and a new season starts the XP again but keeps rewards', () => {
  const accounts = new Accounts();
  const today = dailyObjectives(dayOf(NOW))[0];
  const finished = accounts.bump(TOKEN, today.stat, today.goal, NOW);
  assert.deepEqual(finished.map((o) => o.id), [today.id]);
  accounts.objectiveXp(TOKEN, finished, NOW);
  assert.equal(accounts.view(TOKEN, NOW).season.xp, objectiveXp(today));
  accounts.addXp(TOKEN, TIER_XP * 3, NOW);
  const tier3 = accounts.view(TOKEN, NOW);
  assert.equal(tier3.season.tier, 3);

  // Saved and loaded with the accounts, apart from the world.
  const back = new Accounts();
  back.load(JSON.parse(JSON.stringify(accounts.dump())));
  assert.deepEqual(back.view(TOKEN, NOW).season, tier3.season);

  const next = seasonAt(NOW).end + DAY;
  const fresh = back.view(TOKEN, next);
  assert.equal(fresh.season.n, 2);
  assert.equal(fresh.season.xp, 0);
  assert.equal(fresh.season.tier, 0);
  assert.deepEqual(fresh.packs, tier3.packs, 'rewards stay');
  assert.equal(fresh.coins, tier3.coins);
});

test('accounts saved before the season pass load with a fresh pass', () => {
  const accounts = new Accounts();
  accounts.load([[TOKEN, { coins: 900, packs: ['chrome', 'not-a-thing'], day: '2026-10-01', progress: {}, done: [] } as never]]);
  const view = accounts.view(TOKEN, NOW);
  assert.equal(view.coins, 900);
  assert.deepEqual(view.packs, ['chrome']);
  assert.equal(view.season.n, 1);
  assert.equal(view.season.xp, 0);
  assert.equal(view.season.title, null);
});

test('titles can only be worn once unlocked, and show over the name in game', () => {
  const game = new Game(1234);
  game.wildlife = false;
  game.loot = false;
  const [id] = [...TITLES.keys()];
  assert.equal(game.accounts.wearTitle(TOKEN, id, NOW), false);
  assert.equal(game.accounts.wearTitle(TOKEN, 'nope', NOW), false);
  game.accounts.addXp(TOKEN, TIER_XP * 3, NOW);
  assert.equal(game.accounts.wearTitle(TOKEN, id, NOW), true);
  assert.equal(game.accounts.view(TOKEN, NOW).season.title, id);
  const { out } = game.join('Ash', NOW, null, TOKEN)!;
  const welcome = out.find((o) => o.msg.t === 'welcome')!.msg as { you: { title?: string } };
  assert.equal(welcome.you.title, TITLES.get(id));
  assert.equal(game.accounts.wearTitle(TOKEN, null, NOW), true);
  assert.equal(game.accounts.view(TOKEN, NOW).season.title, null);
});

test('season outfits and paints stay locked until reached, even if a client asks', () => {
  const game = new Game(1234);
  game.wildlife = false;
  game.loot = false;
  const jacket = Number(Object.keys(LOOK_REWARDS.jacket!)[0]);
  const { id } = game.join('Ash', NOW, { jacket }, TOKEN)!;
  assert.equal(game.players.get(id)!.look.jacket, 0, 'not unlocked: back to the scanned jacket');
  game.leave(id);

  const paint = PAINTS.findIndex((p) => p.season);
  assert.equal(paintOwned(paint, game.accounts.view(TOKEN, NOW).packs), false);
  game.accounts.addXp(TOKEN, TIER_XP * 30, NOW);
  assert.equal(paintOwned(paint, game.accounts.view(TOKEN, NOW).packs), true);
  const again = game.join('Ash', NOW, { jacket }, TOKEN)!;
  assert.equal(game.players.get(again.id)!.look.jacket, jacket);
  // Bots never get them.
  for (let i = 0; i < 200; i++) assert.ok(!(randomLook().jacket in LOOK_REWARDS.jacket!));
});

test('time alive earns season XP and says when a tier is reached', () => {
  const game = new Game(1234);
  game.wildlife = false;
  game.loot = false;
  game.cars = false;
  const { id } = game.join('Survivor', NOW, null, TOKEN)!;
  const p = game.players.get(id)!;
  let heard: { tier: number; reward: string } | null = null;
  const minutes = Math.ceil(TIER_XP / XP_PER_MINUTE) + 1;
  for (let s = 0; s <= minutes * 60 && !heard; s++) {
    Object.assign(p, { hp: 100, vitals: { ...p.vitals, food: 400, water: 250 } });
    const msg = game.tick(NOW + s * 1000).find((o) => o.to === id && o.msg.t === 'tierUp')?.msg;
    if (msg?.t === 'tierUp') heard = msg;
  }
  assert.ok(heard, 'a tier within a couple of hours alive');
  assert.equal(heard!.tier, 1);
  assert.match(heard!.reward, /coins/);
});
