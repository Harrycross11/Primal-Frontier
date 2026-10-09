// Players' accounts: coins, store packs and today's objectives, by the private token their browser
// keeps. Saved apart from the world, so a wipe never takes away what someone earned or bought.

import { PACKS, START_COINS, dailyObjectives, dayOf, untilTomorrow, type AccountView, type Objective, type Stat } from '../shared/shop.ts';

export interface Account {
  coins: number;
  packs: string[];
  /** The day the progress below counts for. */
  day: string;
  progress: Partial<Record<Stat, number>>;
  /** Objectives finished (and paid) today. */
  done: string[];
}

export type BuyResult = 'bought' | 'owned' | 'short' | 'unknown';

export class Accounts {
  private all = new Map<string, Account>();
  /** Something changed since the last save. */
  dirty = false;

  /** A token's account, opened with the starting coins the first time it is seen. */
  get(token: string, now: number): Account {
    let a = this.all.get(token);
    if (!a) {
      a = { coins: START_COINS, packs: [], day: dayOf(now), progress: {}, done: [] };
      this.all.set(token, a);
      this.dirty = true;
    }
    // A new day brings new objectives.
    if (a.day !== dayOf(now)) Object.assign(a, { day: dayOf(now), progress: {}, done: [] });
    return a;
  }

  view(token: string, now: number): AccountView {
    const a = this.get(token, now);
    return {
      coins: a.coins,
      packs: [...a.packs],
      objectives: dailyObjectives(a.day).map((o) => ({ ...o, progress: Math.min(o.goal, Math.floor(a.progress[o.stat] ?? 0)), done: a.done.includes(o.id) })),
      resetIn: untilTomorrow(now),
    };
  }

  /** Counts towards today's objectives; pays out and returns any it finishes. */
  bump(token: string, stat: Stat, amount: number, now: number): Objective[] {
    if (!(amount > 0)) return [];
    const a = this.get(token, now);
    const today = dailyObjectives(a.day).filter((o) => o.stat === stat && !a.done.includes(o.id));
    if (!today.length) return [];
    a.progress[stat] = (a.progress[stat] ?? 0) + amount;
    this.dirty = true;
    const finished = today.filter((o) => a.progress[stat]! >= o.goal);
    for (const o of finished) {
      a.done.push(o.id);
      a.coins += o.reward;
    }
    return finished;
  }

  buy(token: string, pack: string, now: number): BuyResult {
    const info = PACKS.find((p) => p.id === pack);
    if (!info) return 'unknown';
    const a = this.get(token, now);
    if (a.packs.includes(pack)) return 'owned';
    if (a.coins < info.price) return 'short';
    a.coins -= info.price;
    a.packs.push(pack);
    this.dirty = true;
    return 'bought';
  }

  /** Everyone's accounts, for saving. */
  dump(): [string, Account][] {
    return [...this.all];
  }

  load(saved: [string, Account][]) {
    for (const [token, a] of saved) {
      if (typeof token !== 'string' || !a || typeof a.coins !== 'number') continue;
      this.all.set(token, {
        coins: Math.max(0, Math.floor(a.coins)),
        packs: Array.isArray(a.packs) ? a.packs.filter((p) => PACKS.some((k) => k.id === p)) : [],
        day: typeof a.day === 'string' ? a.day : '',
        progress: a.progress && typeof a.progress === 'object' ? a.progress : {},
        done: Array.isArray(a.done) ? a.done : [],
      });
    }
  }
}
