// The season pass: one free track of tiers that fills with season XP, earned from daily
// objectives and from time spent alive. Each tier gives a reward the moment you reach it: coins,
// a paint finish, something for your survivor to wear, or a title shown over your name. What
// you unlock is kept on your account for good; the XP starts again when a new season begins.

import { LOOK_PARTS, LOOK_REWARDS, type LookPart } from './look.ts';
import { PAINTS } from './paint.ts';
import type { Objective } from './shop.ts';

export type Reward =
  | { kind: 'coins'; coins: number }
  | { kind: 'paint'; id: string }
  | { kind: 'look'; id: string }
  | { kind: 'title'; id: string; title: string };

/** XP to climb one tier. */
export const TIER_XP = 1000;
/** XP for each minute alive in the world. */
export const XP_PER_MINUTE = 10;
/** Coins paid instead of a reward you already have (from an earlier season's track). */
export const OWNED_COINS = 250;

/** XP for finishing an objective: twice its coins. */
export const objectiveXp = (o: Pick<Objective, 'reward'>) => o.reward * 2;

const coins = (n: number): Reward => ({ kind: 'coins', coins: n });
const paint = (id: string): Reward => ({ kind: 'paint', id });
const look = (id: string): Reward => ({ kind: 'look', id });
const title = (id: string, text: string): Reward => ({ kind: 'title', id, title: text });

/** Season 1: ash, embers and rust. Tier 1 first. */
const ASHFALL: readonly Reward[] = [
  coins(100),
  paint('ashfall-ash'),
  title('title-scavenger', 'Scavenger'),
  coins(150),
  look('ashfall-jacket-ash'),
  coins(150),
  paint('ashfall-ember'),
  coins(200),
  title('title-ash-walker', 'Ash Walker'),
  look('ashfall-boots'),
  coins(200),
  paint('ashfall-rust-chrome'),
  coins(250),
  look('ashfall-trousers'),
  coins(300),
  title('title-firestarter', 'Firestarter'),
  look('ashfall-pack'),
  coins(300),
  paint('ashfall-camo'),
  coins(350),
  look('ashfall-jacket-ember'),
  coins(400),
  title('title-ember-born', 'Ember Born'),
  coins(400),
  coins(500),
  coins(500),
  coins(600),
  coins(750),
  title('title-lord-of-ash', 'Lord of Ash'),
  paint('ashfall-firestorm'),
];

interface SeasonPlan {
  name: string;
  /** The day (UTC) it starts, 'YYYY-MM-DD'. It runs until the next one starts. */
  start: string;
  track: readonly Reward[];
}

/**
 * Every season with its own track, in order. After the last one, a new season starts on the
 * first of each month with the latest track again (rewards already owned pay coins instead),
 * until the next season is added here.
 */
const SEASONS: readonly SeasonPlan[] = [{ name: 'Ashfall', start: '2026-10-25', track: ASHFALL }];
/** When the first season after the planned ones starts. */
const AFTER = '2026-12-01';

export interface Season {
  /** 1 for the first season. */
  n: number;
  name: string;
  start: number;
  end: number;
  track: readonly Reward[];
}

const at = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** The season with this number. */
export function seasonNumber(n: number): Season {
  if (n <= SEASONS.length) {
    const plan = SEASONS[Math.max(0, n - 1)];
    const next = SEASONS[n]?.start ?? AFTER;
    return { n: Math.max(1, n), name: plan.name, start: at(plan.start), end: at(next), track: plan.track };
  }
  // A month each after the planned ones.
  const first = new Date(at(AFTER));
  const month = (k: number) => Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + k, 1);
  const k = n - SEASONS.length - 1;
  return { n, name: `Season ${n}`, start: month(k), end: month(k + 1), track: SEASONS[SEASONS.length - 1].track };
}

/** The season running at a moment (the first season for any moment before it). */
export function seasonAt(now: number): Season {
  let n = 1;
  while (seasonNumber(n).end <= now) n++;
  return seasonNumber(n);
}

/** The tier reached with this much XP. */
export const tierOf = (xp: number, track: readonly Reward[]) => Math.min(track.length, Math.floor(Math.max(0, xp) / TIER_XP));

/** A reward as players read it: "300 coins", "Ember paint", "Ashfall grey jacket", "Title: Scavenger". */
export function rewardLabel(r: Reward): string {
  if (r.kind === 'coins') return `${r.coins.toLocaleString('en-GB')} coins`;
  if (r.kind === 'title') return `${r.title} title`;
  if (r.kind === 'paint') return `${PAINTS.find((p) => p.pack === r.id)?.name ?? r.id} paint`;
  const found = lookReward(r.id);
  return found ? `${LOOK_PARTS[found.part].options[found.option][0]} ${LOOK_PARTS[found.part].label.toLowerCase()}` : r.id;
}

/** The part and option a look reward unlocks. */
export function lookReward(id: string): { part: LookPart; option: number } | null {
  for (const [part, options] of Object.entries(LOOK_REWARDS) as [LookPart, Record<number, string>][]) {
    for (const [option, unlock] of Object.entries(options)) if (unlock === id) return { part, option: Number(option) };
  }
  return null;
}

/** Every unlock any season gives, for checking saves and messages. */
export const REWARD_IDS: ReadonlySet<string> = new Set(
  [...SEASONS.flatMap((s) => s.track)].flatMap((r) => (r.kind === 'coins' ? [] : [r.id])),
);

/** Every title there is, by its unlock. */
export const TITLES: ReadonlyMap<string, string> = new Map(
  SEASONS.flatMap((s) => s.track).flatMap((r) => (r.kind === 'title' ? [[r.id, r.title] as const] : [])),
);

/** The season pass as the menus show it. */
export interface SeasonView {
  n: number;
  name: string;
  /** Milliseconds until it ends. */
  endsIn: number;
  xp: number;
  tier: number;
  /** The title worn over your name, by its unlock, or null. */
  title: string | null;
}
