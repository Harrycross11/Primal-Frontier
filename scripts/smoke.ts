// End-to-end smoke test: starts the server, joins with two browser players, has one gather
// wood and scrap, build a small hut (floor, walls with a door and window edit, stairs), walk
// up the stairs, and checks the other player sees it all. Saves screenshots to .smoke/.
// Run `npm run build` first.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright';

const PORT = 3999;
const URL = `http://localhost:${PORT}`;
mkdirSync('.smoke', { recursive: true });

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SEED: '424242' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise<void>((resolve) => server.stdout!.on('data', (d) => String(d).includes('server on') && resolve()));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors: string[] = [];

async function joinAs(name: string): Promise<Page> {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // Software rendering in CI is slow; play on low graphics and switch to high for screenshots.
  await page.addInitScript(() => localStorage.setItem('pf-quality', 'low'));
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(URL);
  await page.fill('#name', name);
  await page.click('#play');
  await page.waitForFunction(() => (window as any).__pf !== undefined, null, { timeout: 120000 });
  return page;
}

const pf = <T>(p: Page, fn: string, ...args: unknown[]) =>
  p.evaluate(([f, a]) => (window as any).__pf[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>;
const state = (p: Page) => pf<any>(p, 'state');
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) process.exitCode = 1;
};

async function walkTo(page: Page, x: number, z: number, timeout = 150000) {
  await pf(page, 'walkTo', x, z);
  await page.waitForFunction(
    ([x, z]) => {
      const [px, , pz] = (window as any).__pf.state().position;
      return Math.hypot(px - x, pz - z) < 0.8;
    },
    [x, z],
    { timeout },
  );
}

async function gatherAll(page: Page, kind: string, want: number, material: 'wood' | 'scrap') {
  while ((await state(page)).inventory[material] < want) {
    const node = await pf<any>(page, 'nearestResource', kind);
    await walkTo(page, node.x + 1.4, node.z);
    while ((await state(page)).inventory[material] < want) {
      const before = (await state(page)).inventory[material];
      await pf(page, 'gather', node.id);
      await page.waitForTimeout(420);
      if ((await state(page)).inventory[material] === before) break; // node used up
    }
  }
}

try {
  const ash = await joinAs('Ash');
  const rook = await joinAs('Rook');
  await ash.waitForTimeout(800);
  check((await state(ash)).others === 1 && (await state(rook)).others === 1, 'both players see each other');
  await ash.screenshot({ path: '.smoke/1-spawn.png' });

  await gatherAll(ash, 'deadTree', 70, 'wood');
  await gatherAll(ash, 'scrap', 20, 'scrap');
  const inv = (await state(ash)).inventory;
  check(inv.wood >= 70 && inv.scrap >= 20, `gathered wood and scrap (inventory: ${JSON.stringify(inv)})`);

  // Build a hut on the tile next to Ash.
  const [px, py, pz] = (await state(ash)).position;
  const i = Math.floor(px / 3) + 1;
  const k = Math.floor(pz / 3);
  const y = Math.round(py);
  const S = 3;
  const place = (kind: string, ii: number, yy: number, kk: number, dir: number, mat = 'wood') =>
    pf(ash, 'place', kind, ii, yy, kk, dir, mat).then(() => ash.waitForTimeout(150));
  // Stand back so the walls aren't built on top of Ash.
  await walkTo(ash, px - 2, pz + 1.5);
  await place('floor', i, y, k, 0);
  await place('wall', i, y, k, 0); // -z edge
  await place('wall', i, y, k + 1, 0, 'scrap'); // +z edge
  await place('wall', i + 1, y, k, 1); // +x edge
  await place('wall', i, y, k, 1); // -x edge, facing Ash: becomes the door
  await place('floor', i, y + 3, k, 0); // roof
  await place('stairs', i - 1, y, k + 1, 1); // stairs up the outside to the roof, rising towards +x... next to the hut
  await ash.waitForTimeout(500);

  const pieces = (await state(ash)).pieces as any[];
  check(pieces.length === 7, `Ash built 7 pieces (${pieces.length})`);
  const doorKey = `wall:${i},${y},${k},1`;
  const windowKey = `wall:${i},${y},${k},0`;
  await pf(ash, 'edit', doorKey, 'door');
  await pf(ash, 'edit', windowKey, 'window');
  await ash.waitForTimeout(500);
  const rookPieces = (await state(rook)).pieces as any[];
  check(rookPieces.length === 7, 'Rook sees all 7 pieces');
  const edits = Object.fromEntries(rookPieces.filter((p) => p.kind === 'wall').map((p) => [`wall:${p.i},${p.y},${p.k},${p.dir}`, p.edit]));
  check(edits[doorKey] === 'door' && edits[windowKey] === 'window', 'Rook sees the door and window edits');

  // Walk up the stairs: they rise along +x across tile (i-1, k+1).
  await walkTo(ash, (i - 1) * S - 1, (k + 1) * S + 1.5);
  await walkTo(ash, (i - 1) * S + 2.9, (k + 1) * S + 1.5);
  const top = (await state(ash)).position[1];
  check(top > y + 2.3, `walked up the stairs (feet at ${top.toFixed(2)}, ground ${y})`);

  // Screenshots: Ash looking at the hut from outside, and Rook's view of Ash on the stairs.
  await walkTo(ash, (i - 1) * S - 4, k * S + 1.5);
  await pf(ash, 'look', Math.PI / 2 + 0.35, -0.05);
  await pf(ash, 'setQuality', 'high');
  await ash.waitForTimeout(3000);
  await ash.screenshot({ path: '.smoke/2-hut.png' });
  await pf(ash, 'setQuality', 'low');
  await walkTo(rook, i * S - 6, (k - 2) * S, 240000);
  await pf(rook, 'look', -Math.atan2(i * S + 1.5 - (i * S - 6), k * S + 1.5 - (k - 2) * S) + Math.PI, -0.1);
  await pf(rook, 'setQuality', 'high');
  await rook.waitForTimeout(3000);
  await rook.screenshot({ path: '.smoke/3-rook-view.png' });
  await pf(rook, 'setQuality', 'low');
  await rook.waitForTimeout(500);
  await rook.screenshot({ path: '.smoke/4-rook-low-quality.png' });

  check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  console.error(e, errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
  process.exit();
}
