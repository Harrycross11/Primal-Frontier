// Dedicated game server: serves the built client over HTTP and runs the game over a WebSocket at /ws.

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { WebSocket, WebSocketServer } from 'ws';
import { TICK_RATE } from '../shared/constants.ts';
import type { ClientMessage, ServerMessage } from '../shared/protocol.ts';
import { Game, type Outgoing } from './game.ts';
import { openStore } from './store.ts';

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

/** Files worth gzipping: text, the sky's HDR image and the Draco decoder. Images, sounds and
 * compressed models are already as small as gzip would make them. */
const GZIP = new Set(['.html', '.js', '.css', '.svg', '.json', '.hdr', '.wasm']);
const gzipped = new Map<string, { mtime: number; data: Buffer }>();

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

const http = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, players: game.players.size, seed: game.seed, startedAt: new Date(game.startedAt).toISOString() }));
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
    vary: 'accept-encoding',
  };
  const since = req.headers['if-modified-since'];
  if (since && Math.floor(stat.mtimeMs / 1000) <= Math.floor(Date.parse(since) / 1000)) {
    res.writeHead(304, headers).end();
    return;
  }
  if (GZIP.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] ?? '')) {
    let hit = gzipped.get(file);
    if (!hit || hit.mtime !== stat.mtimeMs) gzipped.set(file, (hit = { mtime: stat.mtimeMs, data: gzipSync(readFileSync(file)) }));
    res.writeHead(200, { ...headers, 'content-encoding': 'gzip', 'content-length': String(hit.data.length) });
    res.end(hit.data);
    return;
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
const saved = await store?.load().catch((e) => {
  console.error('could not load the saved world, starting a fresh one', e);
  return null;
});
let game: Game;
if (saved && !wipeDue(saved.startedAt, Date.now())) {
  game = Game.restore(saved, Date.now(), startKit);
  console.log(`world restored from ${store!.name}, started ${new Date(saved.startedAt).toISOString()}`);
} else {
  game = new Game(SEED, startKit);
  game.startedAt = Date.now();
  if (saved) console.log('the world was due a wipe: starting a fresh one');
}
// START_AT='x,z' spawns everyone at one spot, for screenshots.
if (process.env.START_AT) game.spawnAt = process.env.START_AT.split(',').map(Number) as [number, number];
const sockets = new Map<number, WebSocket>();
const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 4096 });

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function deliver(out: Outgoing[]) {
  for (const o of out) {
    const data = JSON.stringify(o.msg);
    if (o.to === 'all' || o.to === 'others') {
      for (const [id, ws] of sockets) {
        if (o.to === 'others' && id === o.except) continue;
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      }
    } else {
      const ws = sockets.get(o.to);
      if (ws) send(ws, o.msg);
    }
  }
}

wss.on('connection', (ws) => {
  let id: number | null = null;

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
      if (msg.t !== 'join') return;
      const joined = game.join(msg.name, now, msg.look, msg.token);
      if (!joined) {
        send(ws, { t: 'full' });
        ws.close();
        return;
      }
      id = joined.id;
      sockets.set(id, ws);
      deliver(joined.out);
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
      case 'place':
        deliver(game.place(id, msg.kind, msg.i, msg.y, msg.k, msg.dir, msg.material));
        break;
      case 'hit':
        deliver(game.hit(id, String(msg.key), now));
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
      case 'respawn':
        deliver(game.respawn(id));
        break;
    }
  });

  ws.on('close', () => {
    if (id === null) return;
    sockets.delete(id);
    deliver(game.leave(id));
    console.log(`player ${id} left (${game.players.size} online)`);
  });
});

setInterval(() => deliver(game.tick(Date.now())), 1000 / TICK_RATE);

let saving: Promise<void> = Promise.resolve();
/** Saves the world; one save at a time, and a failure is logged rather than fatal. */
function save(): Promise<void> {
  if (!store) return Promise.resolve();
  const world = game.save(Date.now());
  saving = saving.then(() => store.save(world)).catch((e) => console.error('could not save the world', e));
  return saving;
}
setInterval(save, SAVE_EVERY * 1000);

// When the month is up, everyone is warned, the save is forgotten and the server stops; the host
// starts it again on a fresh world.
setInterval(async () => {
  if (!wipeDue(game.startedAt, Date.now())) return;
  deliver([{ to: 'all', msg: { t: 'notice', text: 'The world is wiping now. Rejoin in a minute for a fresh start.' } }]);
  await saving;
  await store?.clear();
  setTimeout(() => process.exit(0), 5000);
}, 60 * 60 * 1000);

// The host stops the server for a deploy or when it goes idle: save first.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    await save();
    process.exit(0);
  });
}

http.listen(PORT, () => {
  console.log(`Primal Frontier server on http://localhost:${PORT} (world seed ${game.seed}, saving to ${store?.name ?? 'nowhere'})`);
});
