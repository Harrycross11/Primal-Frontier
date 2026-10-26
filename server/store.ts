// Where the world is saved between restarts: a Postgres database when DATABASE_URL is set (the
// online server, whose own disk is wiped on every restart), otherwise a file (local play).
// Reading never quietly gives back nothing when the save is there but can't be read: it throws,
// so the server knows not to write over it (see saves.ts).

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import pg from 'pg';
import type { Account } from './accounts.ts';
import type { WorldSave } from './game.ts';

export interface Store {
  /** What kind of store it is, for the log. */
  readonly name: string;
  /** Whether what it keeps outlives the server being stopped and started on a fresh machine. */
  readonly durable: boolean;
  load(): Promise<WorldSave | null>;
  save(world: WorldSave): Promise<void>;
  /** Forgets the saved world, for a wipe. Accounts are kept. */
  clear(): Promise<void>;
  /** Players' coins, store packs and objectives, which outlive wipes. */
  loadAccounts(): Promise<[string, Account][]>;
  saveAccounts(accounts: [string, Account][]): Promise<void>;
}

/**
 * A database when DATABASE_URL is set, otherwise a file. Render (which sets RENDER) gives free
 * servers a disk that is wiped whenever they sleep or restart, so a file there is not durable;
 * DURABLE_DISK=1 says the file is on a disk that is kept (a paid plan's mounted disk).
 */
export function openStore(env: NodeJS.ProcessEnv = process.env): Store {
  const url = env.DATABASE_URL?.trim();
  if (url) return new PgStore(url);
  return new FileStore(env.SAVE_FILE ?? 'data/world.json', !env.RENDER || !!env.DURABLE_DISK);
}

/** The file's contents, or null if there is no such file; any other trouble throws. */
async function readIfThere(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

let writes = 0;
/** Writes beside the file and swaps it in, so a crash mid-write never leaves half a file. */
async function writeSafely(path: string, data: string) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}-${++writes}.tmp`;
  await writeFile(temp, data);
  await rename(temp, path);
}

export class FileStore implements Store {
  readonly name: string;
  constructor(
    private path: string,
    readonly durable = true,
  ) {
    this.name = `file ${path}`;
  }

  async load(): Promise<WorldSave | null> {
    const text = await readIfThere(this.path);
    return text === null ? null : JSON.parse(text);
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
    const text = await readIfThere(this.accountsPath);
    if (text === null) return [];
    const saved = JSON.parse(text);
    if (!Array.isArray(saved)) throw new Error(`${this.accountsPath} is not a list of accounts`);
    return saved;
  }

  async saveAccounts(accounts: [string, Account][]) {
    await writeSafely(this.accountsPath, JSON.stringify(accounts));
  }
}

/** One row in one table: the whole world as JSON. */
export class PgStore implements Store {
  readonly name: string;
  readonly durable = true;
  private pool: pg.Pool;
  private tables: Promise<unknown> | null = null;

  constructor(url: string) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || url.includes('host=/');
    // Which database, without the password, for the log.
    this.name = `database ${(() => {
      try {
        const u = new URL(url);
        return `${u.hostname}${u.pathname}`;
      } catch {
        return '(DATABASE_URL)';
      }
    })()}`;
    // Hosted databases (Neon, Supabase, Render) only accept encrypted connections. A database that
    // is asleep or paused fails within 15 s rather than leaving every save waiting forever.
    this.pool = new pg.Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 15_000, ssl: local ? undefined : { rejectUnauthorized: false } });
    // A hosted database drops idle connections (when it sleeps, or its pooler restarts). Unheard,
    // that error would stop the whole server; the pool opens a fresh connection next time.
    this.pool.on('error', (e) => console.warn('database connection dropped (a new one opens on the next save):', e.message));
  }

  /** Makes the tables the first time it works; a failure is tried again on the next call, so a database that was asleep at start-up is picked up once it wakes. */
  private get ready(): Promise<unknown> {
    this.tables ??= Promise.all([
      this.pool.query('CREATE TABLE IF NOT EXISTS world_save (id INT PRIMARY KEY, data JSONB NOT NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT now())'),
      this.pool.query('CREATE TABLE IF NOT EXISTS accounts (token TEXT PRIMARY KEY, data JSONB NOT NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT now())'),
    ]).catch((e) => {
      this.tables = null;
      throw e;
    });
    return this.tables;
  }

  /** Closes the connections (tests). */
  close(): Promise<void> {
    return this.pool.end();
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
