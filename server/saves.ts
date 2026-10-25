// Keeps the world and players' accounts saved, and is careful about it: nothing is written over a
// save that couldn't be read (a paused or sleeping database at start-up would otherwise have its
// world and accounts replaced by an empty one), a new account is saved before its owner is told
// it exists, and every failure is logged plainly and shown in /health and the menu.

import type { Account, Accounts } from './accounts.ts';
import type { WorldSave } from './game.ts';
import type { Store } from './store.ts';

/**
 * ok: saving works and outlives restarts. down: the store can't be read or written just now.
 * temporary: saving to a disk the host wipes on restart (Render's free plan with no database).
 * off: nothing is saved (NO_SAVE, tests and screenshots).
 */
export type SaveState = 'ok' | 'down' | 'temporary' | 'off';

export interface Saved {
  world: WorldSave | null;
  accounts: [string, Account][];
}

type Log = Pick<Console, 'log' | 'warn' | 'error'>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class Saves {
  /** The saved world and accounts were read, so writing can't lose anything. */
  private opened = false;
  /** The last write failed. */
  private failing = false;
  /** One write at a time: a file written twice at once could be left with either. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Whether the world in play is the saved one (or there was none), so saving it is safe. */
  worldSaving = false;
  /** What went wrong last, for /health. */
  lastError: string | null = null;
  /** When something was last saved (ms since 1970). */
  savedAt = 0;

  constructor(
    readonly store: Store | null,
    private log: Log = console,
  ) {}

  get state(): SaveState {
    if (!this.store) return 'off';
    if (!this.opened || this.failing) return 'down';
    return this.store.durable ? 'ok' : 'temporary';
  }

  /** Whether a new account would outlive a restart, so it is worth making (or saving is off on purpose, for tests). */
  get canKeepAccounts() {
    return this.state === 'ok' || this.state === 'off';
  }

  /** For /health: how saving is going, without anything secret. */
  status() {
    return { store: this.store?.name ?? 'none', state: this.state, durable: !!this.store?.durable, worldSaving: this.worldSaving, savedAt: this.savedAt ? new Date(this.savedAt).toISOString() : null, error: this.lastError };
  }

  /**
   * Reads the saved world and accounts, trying `tries` times with the wait doubling from
   * `firstWait` (a sleeping database takes a few seconds to wake). Null if it never could: then
   * nothing is written until `open` works, so the save is left as it was.
   */
  async open(tries = 1, firstWait = 2000): Promise<Saved | null> {
    if (!this.store) return { world: null, accounts: [] };
    for (let i = 0; i < tries; i++) {
      try {
        const world = await this.store.load();
        const accounts = await this.store.loadAccounts();
        this.opened = true;
        this.failing = false;
        this.lastError = null;
        return { world, accounts };
      } catch (e) {
        this.lastError = `could not read the save: ${say(e)}`;
        this.log.error(`SAVE PROBLEM: could not read the saved world and accounts from ${this.store.name} (try ${i + 1} of ${tries}): ${say(e)}`);
        if (i < tries - 1) await wait(firstWait * 2 ** i);
      }
    }
    return null;
  }

  /** Saves the world (if it is the saved one) and any accounts that changed. A failure is logged and kept for /health, not thrown. */
  save(world: () => WorldSave, accounts: Accounts): Promise<void> {
    if (!this.store || !this.opened) return Promise.resolve();
    const store = this.store;
    return this.write(async () => {
      if (this.worldSaving) await store.save(world());
      await this.writeAccounts(accounts);
    }).catch(() => {});
  }

  /** Saves every account now, rejecting if it couldn't (or can't be saved for good). */
  saveAccounts(accounts: Accounts): Promise<void> {
    if (!this.store) return Promise.resolve();
    if (!this.opened) return Promise.reject(new Error(this.lastError ?? 'saving is off'));
    return this.write(() => this.writeAccounts(accounts, true));
  }

  /** Forgets the saved world, for a wipe (accounts are kept). */
  clear(): Promise<void> {
    if (!this.store || !this.opened) return Promise.resolve();
    const store = this.store;
    return this.write(() => store.clear());
  }

  /** Waits for the writes already asked for. */
  settled(): Promise<void> {
    return this.queue.then(() => {});
  }

  private async writeAccounts(accounts: Accounts, always = false) {
    if (!always && !accounts.dirty) return;
    // Cleared first, so anything that changes while this write is under way is saved next time.
    accounts.dirty = false;
    try {
      await this.store!.saveAccounts(accounts.dump());
    } catch (e) {
      accounts.dirty = true;
      throw e;
    }
  }

  private write(job: () => Promise<void>): Promise<void> {
    const done = this.queue.then(job).then(
      () => {
        if (this.failing) this.log.log(`saving to ${this.store!.name} works again`);
        this.failing = false;
        this.lastError = null;
        this.savedAt = Date.now();
      },
      (e) => {
        this.failing = true;
        this.lastError = `could not save: ${say(e)}`;
        this.log.error(`SAVE PROBLEM: could not save to ${this.store!.name}: ${say(e)}`);
        throw e;
      },
    );
    this.queue = done.catch(() => {});
    return done;
  }
}

/**
 * Copies what an old store holds into a new one (moving to another database), without changing
 * the old one or writing over anything the new one already has: accounts it doesn't know are
 * added, and the old world only if the new store has none. Safe to run on every start.
 */
export async function carryOver(from: Store, to: Store, log: Log = console): Promise<{ accounts: number; world: boolean }> {
  const [oldWorld, oldAccounts] = [await from.load(), await from.loadAccounts()];
  const [world, accounts] = [await to.load(), await to.loadAccounts()];
  const tokens = new Set(accounts.map(([token]) => token));
  const names = new Set(accounts.flatMap(([, a]) => (a.login ? [a.login.name.toLowerCase()] : [])));
  const added: [string, Account][] = [];
  for (const [token, a] of oldAccounts) {
    if (tokens.has(token)) continue;
    // Someone took the name in the new store meanwhile: the account comes over (coins, packs), its name doesn't.
    if (a.login && names.has(a.login.name.toLowerCase())) {
      log.warn(`moving saves: the name "${a.login.name}" is already taken in ${to.name}, so that account comes over without it`);
      const { login: _, ...rest } = a;
      added.push([token, rest as Account]);
    } else added.push([token, a]);
  }
  if (added.length) await to.saveAccounts([...accounts, ...added]);
  const copyWorld = !world && !!oldWorld;
  if (copyWorld) await to.save(oldWorld);
  return { accounts: added.length, world: copyWorld };
}
