// Players' accounts: coins, store packs and today's objectives, by the private token their browser
// keeps. Saved apart from the world, so a wipe never takes away what someone earned or bought.
// Giving an account a name and password lets any browser sign in to it and play as the same
// survivor, with the same coins and packs.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { PACKS, START_COINS, dailyObjectives, dayOf, untilTomorrow, type AccountView, type Objective, type Stat } from '../shared/shop.ts';

export interface Account {
  coins: number;
  packs: string[];
  /** The day the progress below counts for. */
  day: string;
  progress: Partial<Record<Stat, number>>;
  /** Objectives finished (and paid) today. */
  done: string[];
  /** The name and password it signs in with, once it has them. Only a hash of the password is kept. */
  login?: Login;
}

interface Login {
  name: string;
  salt: string;
  hash: string;
}

export type BuyResult = 'bought' | 'owned' | 'short' | 'unknown';
export type RegisterResult = 'ok' | 'taken' | 'badName' | 'badPassword' | 'already';

/** 3 to 16 letters, digits, spaces, dashes or underscores. */
export const validName = (name: string) => /^[A-Za-z0-9_ -]{3,16}$/.test(name) && name.trim() === name;
export const validPassword = (password: string) => password.length >= 6 && password.length <= 72;

const derive = promisify(scrypt) as (password: string, salt: string, length: number) => Promise<Buffer>;
async function hashOf(password: string, salt: string): Promise<string> {
  return (await derive(password, salt, 32)).toString('hex');
}

export class Accounts {
  private all = new Map<string, Account>();
  /** Each sign-in name (lower case) and the token of the account it opens. */
  private names = new Map<string, string>();
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
      name: a.login?.name ?? null,
    };
  }

  /** Gives the account behind `token` a name and password, so it can be signed in to anywhere. */
  async register(token: string, name: string, password: string, now: number): Promise<RegisterResult> {
    if (!validName(name)) return 'badName';
    if (!validPassword(password)) return 'badPassword';
    const a = this.get(token, now);
    if (a.login) return 'already';
    if (this.names.has(name.toLowerCase())) return 'taken';
    const salt = randomBytes(16).toString('hex');
    const hash = await hashOf(password, salt);
    // Someone may have taken the name while the hash was worked out.
    if (this.names.has(name.toLowerCase()) || a.login) return 'taken';
    a.login = { name, salt, hash };
    this.names.set(name.toLowerCase(), token);
    this.dirty = true;
    return 'ok';
  }

  /** The token of the account with this name and password, or null. */
  async signIn(name: string, password: string): Promise<{ token: string; name: string } | null> {
    const token = typeof name === 'string' ? this.names.get(name.toLowerCase()) : undefined;
    const login = token ? this.all.get(token)?.login : undefined;
    // Work out a hash either way, so a wrong name takes as long as a wrong password.
    const hash = Buffer.from(await hashOf(String(password).slice(0, 72), login?.salt ?? 'no-such-account'), 'hex');
    if (!token || !login || !timingSafeEqual(hash, Buffer.from(login.hash, 'hex'))) return null;
    return { token, name: login.name };
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
        login: a.login && typeof a.login.name === 'string' && typeof a.login.salt === 'string' && typeof a.login.hash === 'string' ? a.login : undefined,
      });
      if (a.login?.name) this.names.set(a.login.name.toLowerCase(), token);
    }
  }
}
