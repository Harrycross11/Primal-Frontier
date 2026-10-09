// The store and objectives: packs of extra paint finishes bought with coins, and the daily
// objectives that pay those coins. Kept on the player's account, which outlives world wipes.

/** Things that count towards objectives. */
export type Stat = 'wood' | 'stone' | 'metalOre' | 'sulfurOre' | 'pieces' | 'hounds' | 'drive' | 'craft' | 'crates' | 'tame' | 'minutes';

export interface Objective {
  id: string;
  label: string;
  stat: Stat;
  goal: number;
  reward: number;
}

/** Every objective there is; each day a few of them are on offer. */
export const OBJECTIVES: readonly Objective[] = [
  { id: 'wood', label: 'Chop 500 wood', stat: 'wood', goal: 500, reward: 150 },
  { id: 'stone', label: 'Mine 400 stone', stat: 'stone', goal: 400, reward: 150 },
  { id: 'metal', label: 'Mine 200 metal ore', stat: 'metalOre', goal: 200, reward: 200 },
  { id: 'sulfur', label: 'Mine 150 sulfur ore', stat: 'sulfurOre', goal: 150, reward: 200 },
  { id: 'build', label: 'Place 15 building pieces', stat: 'pieces', goal: 15, reward: 150 },
  { id: 'hounds', label: 'Kill 3 Ashhounds', stat: 'hounds', goal: 3, reward: 250 },
  { id: 'drive', label: 'Drive 1 km', stat: 'drive', goal: 1000, reward: 200 },
  { id: 'craft', label: 'Craft 10 items', stat: 'craft', goal: 10, reward: 150 },
  { id: 'crates', label: 'Loot 5 crates', stat: 'crates', goal: 5, reward: 200 },
  { id: 'tame', label: 'Tame an animal', stat: 'tame', goal: 1, reward: 300 },
  { id: 'survive', label: 'Survive 20 minutes', stat: 'minutes', goal: 20, reward: 150 },
];

/** How many objectives each day brings. */
export const DAILY_COUNT = 4;
/** Coins a brand-new account starts with, enough to try the store. */
export const START_COINS = 300;

/** The day (UTC) a moment falls in, as 'YYYY-MM-DD'. */
export function dayOf(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Today's objectives: the same for everyone, picked from the day itself. */
export function dailyObjectives(day: string): Objective[] {
  let seed = [...day].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261) >>> 0;
  const pool = [...OBJECTIVES];
  const out: Objective[] = [];
  while (out.length < DAILY_COUNT && pool.length) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    out.push(pool.splice(seed % pool.length, 1)[0]);
  }
  return out;
}

/** Milliseconds until the next day's objectives. */
export function untilTomorrow(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;
}

export interface Pack {
  id: string;
  name: string;
  blurb: string;
  price: number;
  /** CSS background for its card. */
  art: string;
}

export const PACKS: readonly Pack[] = [
  { id: 'chrome', name: 'Chrome Pack', blurb: 'Mirror-bright metal finishes', price: 600, art: 'linear-gradient(135deg, #e9eef2 0%, #8b96a0 40%, #f6f8fa 55%, #50585f 100%)' },
  { id: 'neon', name: 'Neon Pack', blurb: 'Paint that glows in the dark', price: 800, art: 'linear-gradient(135deg, #12001f 0%, #ff2fb4 45%, #2ff7ff 100%)' },
  { id: 'camo', name: 'Camo Pack', blurb: 'Woodland, desert, arctic and urban camo', price: 700, art: 'radial-gradient(circle at 20% 30%, #3d4a2a 0 18%, transparent 19%), radial-gradient(circle at 70% 60%, #6b5a3a 0 22%, transparent 23%), radial-gradient(circle at 45% 80%, #1f261a 0 15%, transparent 16%), #56653a' },
  { id: 'legend', name: 'Wasteland Legends', blurb: 'Pearl, blood moon, toxic and galaxy', price: 1200, art: 'linear-gradient(135deg, #1a0b2e 0%, #6b2fd8 40%, #c02a2a 70%, #f2c14e 100%)' },
];

/** Real-money bundles of coins, shown in the store once payments are set up. */
export const COIN_BUNDLES = [
  { coins: 1000, price: '£0.99' },
  { coins: 2800, price: '£2.49' },
  { coins: 5000, price: '£3.99' },
  { coins: 13500, price: '£9.99' },
] as const;

/** One objective as the player sees it today. */
export interface ObjectiveState extends Objective {
  progress: number;
  done: boolean;
}

/** What the menus show of a player's account. */
export interface AccountView {
  coins: number;
  packs: string[];
  objectives: ObjectiveState[];
  /** Milliseconds until tomorrow's objectives. */
  resetIn: number;
}
