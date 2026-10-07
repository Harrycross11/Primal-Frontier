// Where the world is saved between restarts: a Postgres database when DATABASE_URL is set (the
// online server, whose own disk is wiped on every restart), otherwise a file (local play).

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import pg from 'pg';
import type { WorldSave } from './game.ts';

export interface Store {
  /** What kind of store it is, for the log. */
  readonly name: string;
  load(): Promise<WorldSave | null>;
  save(world: WorldSave): Promise<void>;
  /** Forgets the saved world, for a wipe. */
  clear(): Promise<void>;
}

export function openStore(): Store {
  const url = process.env.DATABASE_URL;
  return url ? new PgStore(url) : new FileStore(process.env.SAVE_FILE ?? 'data/world.json');
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
    await mkdir(dirname(this.path), { recursive: true });
    // Written beside it and swapped in, so a crash mid-write never leaves half a save.
    const temp = `${this.path}.tmp`;
    await writeFile(temp, JSON.stringify(world));
    await rename(temp, this.path);
  }

  async clear() {
    await rm(this.path, { force: true });
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
    this.ready = this.pool.query('CREATE TABLE IF NOT EXISTS world_save (id INT PRIMARY KEY, data JSONB NOT NULL, saved_at TIMESTAMPTZ NOT NULL DEFAULT now())');
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
}
