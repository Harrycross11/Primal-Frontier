import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { Accounts, type Account } from '../server/accounts.ts';
import type { WorldSave } from '../server/game.ts';
import { Saves } from '../server/saves.ts';
import { FileStore, PgStore, openStore, type Store } from '../server/store.ts';

// Every store here is a fresh temporary folder, or a database named by TEST_DATABASE_URL on this
// machine: never DATABASE_URL, so the tests can't touch the real game's save.

const NOW = Date.UTC(2026, 9, 25, 12);
const quiet = { log() {}, warn() {}, error() {} };
const tempFile = () => join(mkdtempSync(join(tmpdir(), 'pf-accounts-')), 'world.json');

/** Makes an account, saves it the way the server does, then reads it back through a fresh store and fresh accounts, as a restarted server would. */
async function survivesRestart(open: () => Store) {
  const saves = new Saves(open(), quiet);
  assert.ok(await saves.open());
  const accounts = new Accounts();
  accounts.load((await saves.store!.loadAccounts()) ?? []);
  accounts.get('browser-token-1', NOW).coins = 1234;
  assert.equal(await accounts.register('browser-token-1', 'Test Survivor', 'hunter22', NOW), 'ok');
  await saves.saveAccounts(accounts);
  assert.equal(accounts.dirty, false);

  const again = new Saves(open(), quiet);
  const back = await again.open();
  assert.ok(back);
  const restarted = new Accounts();
  restarted.load(back.accounts);
  assert.deepEqual(await restarted.signIn('test survivor', 'hunter22'), { token: 'browser-token-1', name: 'Test Survivor' });
  assert.equal(await restarted.signIn('Test Survivor', 'wrong-password'), null);
  assert.equal(restarted.view('browser-token-1', NOW).coins, 1234);
  assert.equal(restarted.view('browser-token-1', NOW).name, 'Test Survivor');
  // The name stays taken after the restart.
  assert.equal(await restarted.register('another-browser', 'TEST SURVIVOR', 'password1', NOW), 'taken');
}

test('a registered account survives a restart (file store)', async () => {
  const file = tempFile();
  await survivesRestart(() => new FileStore(file));
});

test('a registered account survives a restart (database)', { skip: !process.env.TEST_DATABASE_URL && 'set TEST_DATABASE_URL to a local test database to run this' }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.match(url, /@(localhost|127\.0\.0\.1)[:/]/, 'TEST_DATABASE_URL must be a database on this machine');
  assert.notEqual(url, process.env.DATABASE_URL);
  const stores: PgStore[] = [];
  const open = () => {
    const store = new PgStore(url);
    stores.push(store);
    return store;
  };
  // A clean slate in the test database.
  const first = open();
  await first.loadAccounts();
  await (first as unknown as { pool: { query(q: string): Promise<unknown> } }).pool.query('DELETE FROM accounts');
  try {
    await survivesRestart(open);
  } finally {
    await Promise.all(stores.map((s) => s.close()));
  }
});

/** A store that works until told to fail, counting what it is asked to write. */
class FlakyStore implements Store {
  readonly name = 'flaky test store';
  readonly durable = true;
  failReads = false;
  failWrites = false;
  writes = 0;
  world: WorldSave | null = { version: 2, startedAt: 1 } as WorldSave;
  accounts: [string, Account][] = [];
  async load() {
    if (this.failReads) throw new Error('connection refused');
    return this.world;
  }
  async loadAccounts() {
    if (this.failReads) throw new Error('connection refused');
    return this.accounts;
  }
  async save(world: WorldSave) {
    if (this.failWrites) throw new Error('connection reset');
    this.writes++;
    this.world = world;
  }
  async saveAccounts(accounts: [string, Account][]) {
    if (this.failWrites) throw new Error('connection reset');
    this.writes++;
    this.accounts = JSON.parse(JSON.stringify(accounts));
  }
  async clear() {
    this.writes++;
    this.world = null;
  }
}

test('a save that cannot be read is never written over', async () => {
  const store = new FlakyStore();
  store.failReads = true;
  const saves = new Saves(store, quiet);
  assert.equal(await saves.open(2, 1), null);
  assert.equal(saves.state, 'down');
  assert.equal(saves.canKeepAccounts, false);
  assert.match(saves.status().error!, /connection refused/);

  // The fresh world and accounts the server plays on meanwhile are not saved over the real ones.
  const accounts = new Accounts();
  accounts.get('guest', NOW);
  saves.worldSaving = true;
  await saves.save(() => ({ version: 2, startedAt: 999 }) as WorldSave, accounts);
  await saves.clear();
  await assert.rejects(saves.saveAccounts(accounts));
  assert.equal(store.writes, 0);
  assert.equal(store.world?.startedAt, 1);

  // Once it answers, saving carries on.
  store.failReads = false;
  assert.ok(await saves.open());
  assert.equal(saves.state, 'ok');
  await saves.saveAccounts(accounts);
  assert.equal(store.accounts.length, 1);
});

test('a failed account save is reported, kept for later and then recovers', async () => {
  const store = new FlakyStore();
  const saves = new Saves(store, quiet);
  await saves.open();
  const accounts = new Accounts();
  await accounts.register('token-a', 'Ashwalker', 'secret-pw', NOW);
  store.failWrites = true;
  await assert.rejects(saves.saveAccounts(accounts), /connection reset/);
  assert.equal(saves.state, 'down');
  assert.equal(saves.canKeepAccounts, false);
  assert.equal(accounts.dirty, true, 'still waiting to be saved');
  // The regular save doesn't throw, but it doesn't pretend either.
  await saves.save(() => ({ version: 2, startedAt: 1 }) as WorldSave, accounts);
  assert.equal(saves.state, 'down');

  // The server takes the name back when the save fails, so nobody is told they have an account they don't.
  accounts.unregister('token-a');
  assert.equal(await accounts.signIn('Ashwalker', 'secret-pw'), null);
  assert.equal(await accounts.register('token-b', 'Ashwalker', 'secret-pw', NOW), 'ok');

  store.failWrites = false;
  await saves.save(() => ({ version: 2, startedAt: 1 }) as WorldSave, accounts);
  assert.equal(saves.state, 'ok');
  assert.equal(saves.status().error, null);
  assert.equal(store.accounts.find(([t]) => t === 'token-b')?.[1].login?.name, 'Ashwalker');
});

test('an unreadable accounts file is an error, not an empty list to save over', async () => {
  const file = tempFile();
  const accountsFile = join(file, '..', 'accounts.json');
  writeFileSync(accountsFile, '[["tok", {"coins": 5');
  const saves = new Saves(new FileStore(file), quiet);
  assert.equal(await saves.open(), null);
  await saves.save(() => ({ version: 2, startedAt: 1 }) as WorldSave, new Accounts());
  assert.equal(readFileSync(accountsFile, 'utf8'), '[["tok", {"coins": 5');
});

test('without a database, Render saves only to a disk it wipes', () => {
  assert.equal(openStore({ RENDER: 'true' }).durable, false);
  assert.equal(new Saves(openStore({ RENDER: 'true', SAVE_FILE: tempFile() })).store!.durable, false);
  assert.equal(openStore({ RENDER: 'true', DURABLE_DISK: '1' }).durable, true);
  assert.equal(openStore({}).durable, true);
  assert.equal(openStore({ DATABASE_URL: 'postgres://u:secret@db.example.com:5432/game' }).name, 'database db.example.com/game');
});

// ---------- The real server, stopped and started ----------

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

interface Running {
  child: ChildProcess;
  port: number;
  output: () => string;
}

async function startServer(env: Record<string, string>): Promise<Running> {
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
    env: { PATH: process.env.PATH, PORT: String(port), BOTS: '0', EVENT_FIRST: 'Infinity', SEED: '4242', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout!.on('data', (d) => (output += d));
  child.stderr!.on('data', (d) => (output += d));
  const started = Date.now();
  while (!/PRIME server on/.test(output)) {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`server stopped:\n${output}`);
    if (Date.now() - started > 60_000) throw new Error(`server didn't start:\n${output}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  return { child, port, output: () => output };
}

/** Stops it as a crash or a host pulling the plug would: no chance to save. */
async function kill(server: Running) {
  const { child } = server;
  if (child.exitCode !== null || child.signalCode !== null) return;
  const gone = new Promise((r) => child.once('exit', r));
  child.kill('SIGKILL');
  await gone;
}

/** Sends one message on a fresh connection and waits for the first answer of one of `kinds`. */
async function ask(port: number, msg: object, kinds: string[]): Promise<Record<string, unknown>> {
  const ws = new WebSocket(`ws://localhost:${port}/ws`);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  ws.send(JSON.stringify(msg));
  return new Promise((resolve) => {
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (kinds.includes(m.t)) {
        ws.close();
        resolve(m);
      }
    });
  });
}

test('an account made just before the server dies is there when it comes back', { timeout: 180_000 }, async () => {
  const env = { SAVE_FILE: tempFile() };
  const first = await startServer(env);
  let second: Running | null = null;
  try {
    const made = await ask(first.port, { t: 'register', name: 'Throwaway Tester', password: 'not-my-real-pw', token: 'fresh-browser-token' }, ['signedIn', 'authError']);
    assert.deepEqual(made, { t: 'signedIn', name: 'Throwaway Tester', token: 'fresh-browser-token' });
    // Long before the minute's save comes round.
    await kill(first);

    second = await startServer(env);
    const signedIn = await ask(second.port, { t: 'signIn', name: 'throwaway tester', password: 'not-my-real-pw' }, ['signedIn', 'authError']);
    assert.deepEqual(signedIn, { t: 'signedIn', name: 'Throwaway Tester', token: 'fresh-browser-token' });
    const lobby = await ask(second.port, { t: 'hello', token: 'fresh-browser-token' }, ['lobby']);
    assert.equal((lobby.account as { name: string }).name, 'Throwaway Tester');
    assert.equal(lobby.saving, 'ok');
  } finally {
    await kill(first);
    if (second) await kill(second);
  }
});

test('a server that cannot reach its database says so and turns new accounts away', { timeout: 120_000 }, async () => {
  // Nothing listens on port 1: the database is "down".
  const server = await startServer({ DATABASE_URL: 'postgres://pf:pf@127.0.0.1:1/pf', SAVE_OPEN_TRIES: '1' });
  try {
    assert.match(server.output(), /SAVE PROBLEM: could not read the saved world/);
    assert.match(server.output(), /WILL NOT BE SAVED/);
    const health = await (await fetch(`http://localhost:${server.port}/health`)).json();
    assert.equal(health.saving.state, 'down');
    assert.equal(health.saving.worldSaving, false);
    assert.doesNotMatch(JSON.stringify(health), /pf:pf/, 'no password in /health');
    const lobby = await ask(server.port, { t: 'hello', token: 'down-test-browser-token' }, ['lobby']);
    assert.equal(lobby.saving, 'down');
    const made = await ask(server.port, { t: 'register', name: 'Nobody Saved', password: 'password', token: 'down-test-browser-token' }, ['signedIn', 'authError']);
    assert.equal(made.t, 'authError');
    assert.match(String(made.text), /can't be saved right now/);
    const signIn = await ask(server.port, { t: 'signIn', name: 'Somebody', password: 'password' }, ['signedIn', 'authError']);
    assert.match(String(signIn.text), /can't be checked right now/);
  } finally {
    await kill(server);
  }
});

test('on Render with no database, new accounts are turned away instead of lost', { timeout: 120_000 }, async () => {
  const server = await startServer({ RENDER: 'true', SAVE_FILE: tempFile() });
  try {
    assert.match(server.output(), /SAVE PROBLEM: DATABASE_URL is not set/);
    const made = await ask(server.port, { t: 'register', name: 'Lost Soon', password: 'password', token: 'render-test-browser-token' }, ['signedIn', 'authError']);
    assert.equal(made.t, 'authError');
    assert.match(String(made.text), /isn't set up to keep accounts/);
    const health = await (await fetch(`http://localhost:${server.port}/health`)).json();
    assert.equal(health.saving.state, 'temporary');
  } finally {
    await kill(server);
  }
});

test('moving to a new database copies accounts and the world without overwriting or changing anything', async () => {
  const { carryOver } = await import('../server/saves.ts');
  const oldFile = tempFile();
  const old = new FileStore(oldFile);
  const before = new Accounts();
  await before.register('old-browser-token-1', 'Old Timer', 'old-password', NOW);
  await before.register('old-browser-token-2', 'Name Clash', 'old-password', NOW);
  before.get('old-browser-token-1', NOW).coins = 777;
  await old.saveAccounts(before.dump());
  await old.save({ version: 2, startedAt: 5 } as WorldSave);
  const oldAccountsText = readFileSync(join(oldFile, '..', 'accounts.json'), 'utf8');

  const fresh = new FileStore(tempFile());
  const already = new Accounts();
  await already.register('new-browser-token', 'Name Clash', 'new-password', NOW);
  await fresh.saveAccounts(already.dump());

  assert.deepEqual(await carryOver(old, fresh, quiet), { accounts: 2, world: true });
  const merged = new Accounts();
  merged.load(await fresh.loadAccounts());
  assert.deepEqual(await merged.signIn('Old Timer', 'old-password'), { token: 'old-browser-token-1', name: 'Old Timer' });
  assert.equal(merged.view('old-browser-token-1', NOW).coins, 777);
  // The new store's own account keeps its name.
  assert.deepEqual(await merged.signIn('Name Clash', 'new-password'), { token: 'new-browser-token', name: 'Name Clash' });
  assert.equal((await fresh.load())?.startedAt, 5);
  // The old store is only read.
  assert.equal(readFileSync(join(oldFile, '..', 'accounts.json'), 'utf8'), oldAccountsText);
  // Running it again (every start) copies nothing more.
  assert.deepEqual(await carryOver(old, fresh, quiet), { accounts: 0, world: false });
});
