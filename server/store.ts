// Where the world is saved between restarts: a Postgres database when DATABASE_URL is set (the
// online server, whose own disk is wiped on every restart), otherwise a file (local play).

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import pg from 'pg';
import type { Account } from './accounts.ts';
import type { WorldSave } from './game.ts';

export interface Store {
  /** What kind of store it is, for the log. */
  readonly name: string;
  load(): Promise<WorldSave | null>;
  save(world: WorldSave): Promise<void>;
  /** Forgets the saved world, for a wipe. Accounts are kept. */
  clear(): Promise<void>;
  /** Players' coins, store packs and objectives, which outlive wipes. */
  loadAccounts(): Promise<[string, Account][]>;
  saveAccounts(accounts: [string, Account][]): Promise<void>;
}

export function openStore(): Store {
  const url = process.env.DATABASE_URL;
  return url ? new PgStore(url) : new FileStore(process.env.SAVE_FILE ?? 'data/world.json');
}

/** Writes beside the file and swaps it in, so a crash mid-write never leaves half a file. */
async function writeSafely(path: string, data: string) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, data);
  await rename(temp, path);
}

export class FileStore implements Store {
  readonly name: string;
  constructor(private path: string) {
    this.name = `file ${path}`;
  }

  async load(): Promise<WorldSave | null> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8'));
    } catch {
      return null;
    }
  }

  async save(world: WorldSave) {
    await writeSafely(this.path, JSON.stringify(world));
  }

  async clear() {
    await rm(this.path, { force: true });
  }

  /** Beside the world's file, as accounts.json. */
  private get accountsPath() {
    return join(dirname(this.path), 'accounts.json');
  }

  async loadAccounts(): Promise<[string, Account][]> {
    try {
      return JSON.parse(await readFile(this.accountsPath, 'utf8'));
    } catch {
      return [];
    }
  }

  async saveAccounts(accounts: [string, Account][]) {
    await writeSafely(this.accountsPath, JSON.stringify(accounts));
  }
}

/** One row in one table: the whole world as JSON. */
export class PgStore implements Store {
  readonly name = 'database';
  private pool: pg.Pool;
  private ready: Promise<unknown>;

  constructor(url: string) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || url.includes('host=/');
    // Hosted databases (Neon, Supabase, Render) only accept encrypted connections.
    this.pool = new pg.Pool({ connectionString: url, max: 2, ssl: local ? undefined : { rejectUnauthorized: false } });
    this.ready = Promise.all([
      this.pool.query('CREATE TABLE IF NOT EXISTS world_save (id INT PRIMARY KEY, data JSONB NOT NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT now())'),
      this.pool.query('CREATE TABLE IF NOT EXISTS accounts (token TEXT PRIMARY KEY, data JSONB NOT NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT now())'),
    ]);
  }

  async load(): Promise<WorldSave | null> {
    await this.ready;
    const { rows } = await this.pool.query('SELECT data FROM world_save WHERE id = 1');
    return rows[0]?.data ?? null;
  }

  async save(world: WorldSave) {
    await this.ready;
    await this.pool.query(
      'INSERT INTO world_save (id, data, saved_at) VALUES (1, $1, now()) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, saved_at = now()',
      [JSON.stringify(world)],
    );
  }

  async clear() {
    await this.ready;
    await this.pool.query('DELETE FROM world_save WHERE id = 1');
  }

  async loadAccounts(): Promise<[string, Account][]> {
    await this.ready;
    const { rows } = await this.pool.query('SELECT token, data FROM accounts');
    return rows.map((r) => [r.token, r.data]);
  }

  /** One upsert for every account, in one statement. */
  async saveAccounts(accounts: [string, Account][]) {
    await this.ready;
    if (!accounts.length) return;
    await this.pool.query(
      `INSERT INTO accounts (token, data, saved_at)
       SELECT a->>0, a->1, now() FROM jsonb_array_elements($1::jsonb) AS a
       ON CONFLICT (token) DO UPDATE SET data = EXCLUDED.data, saved_at = now()`,
      [JSON.stringify(accounts)],
    );
  }
}
