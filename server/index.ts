// Dedicated game server: serves the built client over HTTP and runs the game over a WebSocket at /ws.

import type { Species } from '../shared/creatures.ts';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { WebSocket, WebSocketServer } from 'ws';
import { MAX_PLAYERS, TICK_RATE } from '../shared/constants.ts';
import type { ClientMessage, ServerMessage } from '../shared/protocol.ts';
import { Bots } from './bots.ts';
import { Events } from './events.ts';
import { EVENT_EVERY, FIRST_EVENT } from '../shared/events.ts';
import { Game, cleanToken, type Outgoing, type WorldSave } from './game.ts';
import { Saves, carryOver, type SaveState } from './saves.ts';
import { PgStore, openStore } from './store.ts';
import type { RegisterResult } from './accounts.ts';

const PORT = Number(process.env.PORT ?? 3000);
const SEED = Number(process.env.SEED ?? Math.floor(Math.random() * 2 ** 31));
/** Days a world lasts before it is wiped for a fresh one, like a Rust server's monthly wipe. */
const WIPE_DAYS = Number(process.env.WIPE_DAYS ?? 30);
/** How often the world is saved, in seconds. */
const SAVE_EVERY = 60;
const CLIENT_DIR = resolve(import.meta.dirname, '../dist/client');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.mp3': 'audio/mpeg',
  '.wasm': 'application/wasm',
};

/** Files worth gzipping: text, the sky's HDR image and the Draco decoder. Images and sounds
 * are already as small as gzip would make them. */
const GZIP = new Set(['.html', '.js', '.css', '.svg', '.json', '.hdr', '.wasm']);
/** Models are gzipped only where it pays: animals' animations shrink by about half, while the
 * rest (compressed meshes and pictures) barely change and are sent as they are. */
const GZIP_IF_SMALLER = new Set(['.glb']);
const gzipped = new Map<string, { mtime: number; data: Buffer | null }>();

/**
 * How long browsers may keep a file without asking again. Built scripts have their content's
 * hash in their name, so they never change; models, textures and sounds change only with a
 * deploy, so a day is safe; the page itself is always checked.
 */
function cacheFor(path: string): string {
  if (path.startsWith('assets/')) return 'public, max-age=31536000, immutable';
  if (/^(models|textures|sounds|draco)\//.test(path)) return 'public, max-age=86400';
  return 'no-cache';
}

/**
 * A tag naming each file's content. Every deploy writes the files afresh, so their dates change
 * even when nothing in them did; the tag lets a returning browser keep the models and textures it
 * already has, instead of fetching the whole game again after each update.
 */
const tags = new Map<string, { mtime: number; size: number; tag: string }>();
function contentTag(file: string, mtime: number, size: number): string {
  const hit = tags.get(file);
  if (hit && hit.mtime === mtime && hit.size === size) return hit.tag;
  const tag = `"${createHash('sha1').update(readFileSync(file)).digest('base64url')}"`;
  tags.set(file, { mtime, size, tag });
  return tag;
}

const http = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: game.players.size, seed: game.seed, startedAt: new Date(game.startedAt).toISOString(), saving: saves.status() }));
    return;
  }
  let file = normalize(join(CLIENT_DIR, decodeURIComponent(url.pathname)));
  if (!file.startsWith(CLIENT_DIR)) {
    res.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(CLIENT_DIR, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(500, { 'content-type': 'text/plain' }).end('Client not built. Run `npm run build` first.');
    return;
  }
  const stat = statSync(file);
  const ext = extname(file);
  const headers: Record<string, string> = {
    'content-type': TYPES[ext] ?? 'application/octet-stream',
    'cache-control': cacheFor(relative(CLIENT_DIR, file).replaceAll('\\', '/')),
    'last-modified': stat.mtime.toUTCString(),
    etag: contentTag(file, stat.mtimeMs, stat.size),
    vary: 'accept-encoding',
  };
  // A browser sending the tag is asking by content, which outlasts a deploy; the date is only
  // checked when it has no tag.
  const match = req.headers['if-none-match'];
  const since = req.headers['if-modified-since'];
  const fresh = match ? match.split(',').some((t) => t.trim().replace(/^W\//, '') === headers.etag) : since && Math.floor(stat.mtimeMs / 1000) <= Math.floor(Date.parse(since) / 1000);
  if (fresh) {
    res.writeHead(304, headers).end();
    return;
  }
  if ((GZIP.has(ext) || GZIP_IF_SMALLER.has(ext)) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    let hit = gzipped.get(file);
    if (!hit || hit.mtime !== stat.mtimeMs) {
      const data = gzipSync(readFileSync(file));
      gzipped.set(file, (hit = { mtime: stat.mtimeMs, data: GZIP.has(ext) || data.length < stat.size * 0.9 ? data : null }));
    }
    if (hit.data) {
      res.writeHead(200, { ...headers, 'content-encoding': 'gzip', 'content-length': String(hit.data.length) });
      res.end(hit.data);
      return;
    }
  }
  res.writeHead(200, { ...headers, 'content-length': String(stat.size) });
  createReadStream(file).pipe(res);
});

// START_KIT=500 gives everyone 500 of each basic resource; START_ITEMS='{"metal":3000}' gives exact items.
const startKit = process.env.START_ITEMS ? JSON.parse(process.env.START_ITEMS) : Number(process.env.START_KIT ?? 0);
const wipeDue = (startedAt: number, now: number) => now - startedAt >= WIPE_DAYS * 86_400_000;

// The world carries on from its last save, unless it is time for a wipe. NO_SAVE=1 starts fresh
// and saves nothing (for tests and screenshots).
const store = process.env.NO_SAVE ? null : openStore();
const saves = new Saves(store);
if (store && !store.durable) {
  console.error(
    'SAVE PROBLEM: DATABASE_URL is not set, so the world and accounts are saved to this server\'s own disk, which Render wipes whenever the server sleeps or restarts. ' +
      'New accounts are turned away until a database is set up: see docs/hosting.md.',
  );
}
// Moving to another database: OLD_DATABASE_URL names the one saves were kept in, and anything
// it has that the new one doesn't is copied over (the old one is only read).
if (store && process.env.OLD_DATABASE_URL?.trim()) {
  const old = new PgStore(process.env.OLD_DATABASE_URL.trim());
  await carryOver(old, store)
    .then(({ accounts, world }) => console.log(`moving saves from ${old.name}: ${accounts} accounts${world ? ' and the world' : ''} copied to ${store.name}`))
    .catch((e) => console.error(`SAVE PROBLEM: could not copy saves from the old database ${old.name} (tried again on the next start): ${e instanceof Error ? e.message : e}`));
  await old.close().catch(() => {});
}
// A database that is asleep (or a free one that is paused) gets half a minute to answer.
const saved = await saves.open(Number(process.env.SAVE_OPEN_TRIES ?? 5), 2000);
let game!: Game;
let bots!: Bots;
let events!: Events;
// A save from before the map last changed would put bases in the wrong places: wipe instead.
const playable = (world: WorldSave | null, now: number): world is WorldSave => !!world && world.version === 2 && !wipeDue(world.startedAt, now);

/** Puts a world in play: the saved one if it can carry on, otherwise a fresh one. Accounts carry over. */
function startWorld(world: WorldSave | null, now: number) {
  const accounts = game?.accounts;
  if (playable(world, now)) {
    game = Game.restore(world, now, startKit);
    console.log(`world restored from ${store!.name}, started ${new Date(world.startedAt).toISOString()}`);
  } else {
    game = new Game(SEED, startKit);
    game.startedAt = now;
    if (world) console.log((world as WorldSave).version === 2 ? 'the world was due a wipe: starting a fresh one' : 'the map has changed: starting a fresh world');
  }
  if (accounts) game.accounts = accounts;
  // START_AT='x,z' spawns everyone at one spot, for screenshots.
  if (process.env.START_AT) game.spawnAt = process.env.START_AT.split(',').map(Number) as [number, number];
  // Computer-controlled survivors keep the world busy: BOTS is how many survivors the server
  // should feel like it has, and bots make up whatever real players don't. None by default in
  // screenshot runs (START_AT), where they would wander into shot.
  bots = new Bots(game, Number(process.env.BOTS ?? (process.env.START_AT ? 0 : 5)));
  // HOLD_FIRE=1 stops bots and raiders shooting (for screenshots).
  bots.holdFire = !!process.env.HOLD_FIRE;
  // Raiders take a landmark every so often (EVENT_FIRST and EVENT_EVERY, in minutes, change when;
  // EVENT_AT names the landmark or land to always use).
  // None in screenshot runs unless asked for.
  events = new Events(game, bots, {
    first: Number(process.env.EVENT_FIRST ?? (process.env.START_AT ? Infinity : FIRST_EVENT)),
    every: Number(process.env.EVENT_EVERY ?? EVENT_EVERY),
    at: process.env.EVENT_AT,
  });
}

startWorld(saved?.world ?? null, Date.now());
// Coins, packs and objectives outlive wipes: they are kept apart from the world.
game.accounts.load(saved?.accounts ?? []);
if (saved) saves.worldSaving = true;
else {
  // Playing on is better than turning everyone away, but this world isn't the saved one: it is
  // never saved over it. The save is tried again until it answers.
  console.error(`SAVE PROBLEM: playing on a fresh world that WILL NOT BE SAVED, and turning away new accounts, until ${store!.name} answers. The saved world and accounts are left untouched.`);
  setTimeout(reopen, 30_000);
}

/** Tries the save again after it couldn't be read at start-up, and brings it back once it can. */
async function reopen() {
  const back = await saves.open();
  if (!back) {
    setTimeout(reopen, 30_000);
    return;
  }
  game.accounts.load(back.accounts);
  console.log(`${store!.name} answers again: ${back.accounts.length} accounts loaded`);
  if (!playable(back.world, Date.now())) {
    saves.worldSaving = true;
    return;
  }
  // The saved world takes over once nobody is playing in this one.
  const swap = () => {
    if (sockets.size) return void setTimeout(swap, 10_000);
    startWorld(back.world, Date.now());
    saves.worldSaving = true;
    if (!process.env.BOTS_WAIT) bots.balance(0, Date.now());
  };
  swap();
}
const sockets = new Map<number, WebSocket>();
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 4096 });

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Past this much unsent data a player's connection is behind, so world snapshots wait. */
const BEHIND = 64 * 1024;

function deliver(out: Outgoing[]) {
  for (const o of out) {
    const data = JSON.stringify(o.msg);
    if (o.to === 'all' || o.to === 'others') {
      for (const [id, ws] of sockets) {
        if (o.to === 'others' && id === o.except) continue;
        // A slow connection skips snapshots (the next one replaces it anyway) so that builds,
        // hits and inventory changes queued behind them still arrive promptly.
        if (o.msg.t === 'state' && ws.bufferedAmount > BEHIND) continue;
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      }
    } else {
      const ws = sockets.get(o.to);
      if (ws) send(ws, o.msg);
    }
  }
}

/** What to tell someone whose account couldn't be named. */
const REGISTER_ERRORS: Record<Exclude<RegisterResult, 'ok'>, string> = {
  badName: 'Names are 3 to 16 letters, numbers, spaces, dashes or underscores.',
  badPassword: 'Passwords need at least 6 characters.',
  already: 'This account already has a name. Sign out to make another.',
  taken: 'That name is taken. Try another.',
};

/** Why a new account is turned away when it couldn't be kept. */
const SAVE_TROUBLE: Partial<Record<SaveState, string>> = {
  down: 'Accounts can\'t be saved right now (the server can\'t reach its save). Nothing was made: try again in a few minutes.',
  temporary: 'This server isn\'t set up to keep accounts yet, so one made now would be lost. You can still play as a guest.',
};

wss.on('connection', (ws) => {
  let id: number | null = null;
  /** When this connection last tried to sign in or make an account. */
  let tries: number[] = [];

  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    const now = Date.now();
    if (id === null) {
      // The main menu asks after your account and the server before you play.
      if (msg.t === 'hello' || msg.t === 'buy' || msg.t === 'wearTitle') {
        const token = cleanToken(msg.token);
        if (msg.t === 'buy') {
          const result = game.buy({ token }, String(msg.pack), now);
          send(ws, { t: 'notice', text: result.text });
        }
        if (msg.t === 'wearTitle' && token && !game.accounts.wearTitle(token, typeof msg.id === 'string' ? msg.id : null, now)) {
          send(ws, { t: 'notice', text: 'Reach that tier of the season pass to wear its title' });
        }
        const wipeIn = Math.max(0, game.startedAt + WIPE_DAYS * 86_400_000 - now);
        send(ws, { t: 'lobby', account: token ? game.accounts.view(token, now) : null, online: game.headCount, max: MAX_PLAYERS, wipeIn, seed: game.seed, now, saving: saves.state, startedAt: new Date(game.startedAt).toISOString() });
        return;
      }
      if (msg.t === 'register' || msg.t === 'signIn') {
        // A few tries a minute, so passwords can't be guessed by the thousand.
        tries = tries.filter((t) => now - t < 60_000);
        if (tries.length >= 8) {
          send(ws, { t: 'authError', text: 'Too many tries. Wait a minute and try again.' });
          return;
        }
        tries.push(now);
        const name = String(msg.name ?? '').trim();
        const password = String(msg.password ?? '');
        if (msg.t === 'signIn') {
          game.accounts.signIn(name, password).then((found) => {
            // With the save out of reach the account may just not be loaded: say so, rather than that it doesn't exist.
            if (!found) send(ws, { t: 'authError', text: saves.state === 'down' ? 'Accounts can\'t be checked right now (the server can\'t reach its save). Try again in a few minutes.' : 'That name and password don\'t match an account.' });
            else send(ws, { t: 'signedIn', ...found });
          });
          return;
        }
        const token = cleanToken(msg.token);
        if (!token) {
          send(ws, { t: 'authError', text: 'This browser isn\'t keeping site data (private mode or blocked storage), so it can\'t hold an account.' });
          return;
        }
        const trouble = saves.canKeepAccounts ? null : SAVE_TROUBLE[saves.state];
        if (trouble) {
          send(ws, { t: 'authError', text: trouble });
          return;
        }
        const accounts = game.accounts;
        accounts.register(token, name, password, now).then(async (result) => {
          if (result !== 'ok') return send(ws, { t: 'authError', text: REGISTER_ERRORS[result] });
          // Saved before anyone is told it exists, so a restart a moment later can't lose it.
          try {
            await saves.saveAccounts(accounts);
          } catch {
            accounts.unregister(token);
            return send(ws, { t: 'authError', text: 'Your account couldn\'t be saved just now, so it wasn\'t made. Try again in a minute.' });
          }
          console.log(`account "${name}" made and saved`);
          send(ws, { t: 'signedIn', name, token });
        });
        return;
      }
      if (msg.t !== 'join') return;
      // A bot gives up its place to a real player.
      if (game.headCount >= MAX_PLAYERS) deliver(bots.removeOne());
      const joined = game.join(msg.name, now, msg.look, msg.token);
      if (!joined) {
        send(ws, { t: 'full' });
        ws.close();
        return;
      }
      id = joined.id;
      sockets.set(id, ws);
      deliver(joined.out);
      deliver(events.welcome(id));
      // START_PET=mule gives everyone who joins a tame one beside them (for screenshots).
      if (process.env.START_PET) game.givePet(id, process.env.START_PET as Species);
      deliver(bots.balance(sockets.size, now));
      console.log(`player ${id} joined (${game.players.size} online)`);
      return;
    }
    switch (msg.t) {
      case 'move':
        deliver(game.move(id, msg.x, msg.y, msg.z, msg.yaw, !!msg.moving, now, msg.slot));
        break;
      case 'gather':
        deliver(game.gather(id, msg.id, now, msg.slot));
        break;
      case 'drive':
        deliver(game.drive(id, msg.id));
        break;
      case 'buy': {
        const result = game.buy({ id }, String(msg.pack), now);
        deliver([{ to: id, msg: { t: 'notice', text: result.text } }, ...[game.account(id, now)].filter((o) => o !== null)]);
        break;
      }
      case 'ping':
        send(ws, { t: 'pong', at: Number(msg.at) || 0 });
        break;
      case 'getAccount': {
        const o = game.account(id, now);
        if (o) deliver([o]);
        break;
      }
      case 'refuel':
        deliver(game.refuel(id, msg.id, msg.slot));
        break;
      case 'invite':
        deliver(game.invite(id, msg.id, now));
        break;
      case 'acceptInvite':
        deliver(game.acceptInvite(id, now));
        break;
      case 'leaveTeam':
        deliver(game.leaveTeam(id));
        break;
      case 'place':
        deliver(game.place(id, msg.kind, msg.i, msg.y, msg.k, msg.dir, msg.material, msg.paint));
        break;
      case 'paintPiece':
        deliver(game.paintPiece(id, String(msg.key), msg.paint, msg.all === true));
        break;
      case 'paintItem':
        deliver(game.paintItem(id, msg.slot, msg.paint));
        break;
      case 'customiseCar':
        deliver(game.customiseCar(id, msg.id, msg.kind, msg.paint));
        break;
      case 'hit':
        deliver(game.hit(id, String(msg.key), now, msg.door === true));
        break;
      case 'hitDeployable':
        deliver(game.hitDeployable(id, msg.id, now));
        break;
      case 'edit':
        deliver(game.edit(id, String(msg.key), msg.edit));
        break;
      case 'craft':
        deliver(game.craft(id, msg.item, msg.count));
        break;
      case 'learn':
        deliver(game.learn(id, msg.item));
        break;
      case 'cancelCraft':
        deliver(game.cancelCraft(id, msg.index));
        break;
      case 'moveItem':
        deliver(game.moveItem(id, msg.from, msg.to, msg.count));
        break;
      case 'deploy':
        deliver(game.deploy(id, msg.slot, msg.x, msg.y, msg.z, msg.rot));
        break;
      case 'furnace':
        deliver(game.furnace(id, msg.id, msg.on));
        break;
      case 'fire':
        deliver(game.fire(id, msg.slot, msg.d, !!msg.aim, now));
        break;
      case 'reload':
        deliver(game.reload(id, msg.slot, now));
        break;
      case 'melee':
        deliver(game.melee(id, msg.slot, msg.d, now));
        break;
      case 'use':
        deliver(game.use(id, msg.slot, now));
        break;
      case 'ride':
        deliver(game.ride(id, typeof msg.id === 'number' ? msg.id : null));
        break;
      case 'respawn':
        deliver(game.respawn(id, typeof msg.bag === 'number' ? msg.bag : undefined, now));
        break;
      case 'authorize':
        deliver(game.authorize(id, msg.id));
        break;
      case 'clearAuth':
        deliver(game.clearAuth(id, msg.id));
        break;
      case 'hangDoor':
        deliver(game.hangDoor(id, String(msg.key), msg.slot));
        break;
      case 'door':
        deliver(game.toggleDoor(id, String(msg.key)));
        break;
      case 'lock':
        deliver(game.lock(id, String(msg.key), msg.slot, String(msg.code)));
        break;
      case 'code':
        deliver(game.tryCode(id, String(msg.key), String(msg.code), now));
        break;
      case 'plant':
        deliver(game.plant(id, msg.slot, msg.at, now, typeof msg.key === 'string' ? msg.key : undefined, msg.door === true));
        break;
      case 'throw':
        deliver(game.throwGrenade(id, msg.slot, msg.d, now));
        break;
      case 'hack':
        deliver(events.hack(id, Number(msg.id), now));
        break;
    }
  });

  ws.on('close', () => {
    if (id === null) return;
    sockets.delete(id);
    deliver(game.leave(id));
    deliver(bots.balance(sockets.size, Date.now()));
    console.log(`player ${id} left (${game.players.size} online)`);
  });
});

// BOTS_WAIT=1 holds the bots back until someone joins (for filming them).
if (!process.env.BOTS_WAIT) bots.balance(0, Date.now());
setInterval(() => {
  const now = Date.now();
  deliver(bots.tick(now));
  deliver(events.tick(now));
  deliver(game.tick(now));
}, 1000 / TICK_RATE);

/** Saves the world and changed accounts; a failure is logged and shown in /health, not fatal. */
const save = () => saves.save(() => game.save(Date.now()), game.accounts);
setInterval(save, SAVE_EVERY * 1000);

// When the month is up, everyone is warned, the save is forgotten and the server stops; the host
// starts it again on a fresh world. Players' screens wait for it and bring them into the new one.
let wiping = false;
setInterval(async () => {
  if (wiping || !wipeDue(game.startedAt, Date.now())) return;
  wiping = true;
  deliver([{ to: 'all', msg: { t: 'wipe', text: 'The world is wiping now. A fresh one is on its way.' } }]);
  // Accounts are saved one last time; the world is not, so nothing writes it back after the clear.
  saves.worldSaving = false;
  await save();
  await saves.clear().catch(() => {});
  setTimeout(() => process.exit(0), 5000);
}, 60 * 1000);

// The host stops the server for a deploy or when it goes idle: save first.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    await save();
    await saves.settled();
    process.exit(0);
  });
}

http.listen(PORT, () => {
  console.log(`PRIME server on http://localhost:${PORT} (world seed ${game.seed}, saving to ${store?.name ?? 'nowhere'}: ${saves.state})`);
});
