// End-to-end smoke test: starts the server, joins with two browser players, has one walk to
// scrap, gather it and build a block, and checks the other player sees it. Saves screenshots to .smoke/.
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
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  await page.goto(URL);
  await page.fill('#name', name);
  await page.click('#play');
  await page.waitForFunction(() => (window as any).__pf !== undefined, null, { timeout: 20000 });
  return page;
}

const state = (p: Page) => p.evaluate(() => (window as any).__pf.state());
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) process.exitCode = 1;
};

try {
  const ash = await joinAs('Ash');
  const rook = await joinAs('Rook');
  await ash.waitForTimeout(800);
  check((await state(ash)).others === 1 && (await state(rook)).others === 1, 'both players see each other');
  await ash.screenshot({ path: '.smoke/1-spawn.png' });

  // Walk Ash to the nearest scrap wreck and gather it.
  const scrap = await ash.evaluate(() => (window as any).__pf.nearestResource('scrap'));
  await ash.evaluate(([x, z]) => (window as any).__pf.walkTo(x + 1.6, z), [scrap.x, scrap.z]);
  await ash.waitForFunction(
    ([x, z]) => {
      const [px, , pz] = (window as any).__pf.state().position;
      return Math.hypot(px - (x + 1.6), pz - z) < 1.2;
    },
    [scrap.x, scrap.z],
    { timeout: 30000 },
  );
  for (let i = 0; i < 4; i++) {
    await ash.evaluate((id) => (window as any).__pf.gather(id), scrap.id);
    await ash.waitForTimeout(450);
  }
  const inv = (await state(ash)).inventory;
  check(inv.scrap >= 4, `gathered scrap (inventory: ${JSON.stringify(inv)})`);

  // Build two blocks next to Ash and check Rook sees them.
  const cell = await ash.evaluate(() => (window as any).__pf.groundCellNear(2, 0));
  await ash.evaluate((c) => (window as any).__pf.place(c.x, c.y, c.z, 'scrap'), cell);
  await ash.waitForTimeout(300);
  await ash.evaluate((c) => (window as any).__pf.place(c.x, c.y + 1, c.z, 'scrap'), cell);
  await ash.waitForTimeout(500);
  check((await state(ash)).blocks === 2, 'Ash built 2 blocks');
  check((await state(rook)).blocks === 2, 'Rook sees the 2 blocks');
  await ash.screenshot({ path: '.smoke/2-built.png' });

  // Rook walks to Ash so the screenshot shows two players together.
  const [ax, , az] = (await state(ash)).position;
  await rook.evaluate(([x, z]) => (window as any).__pf.walkTo(x - 2, z + 2), [ax, az]);
  await rook.waitForFunction(
    ([x, z]) => {
      const [px, , pz] = (window as any).__pf.state().position;
      return Math.hypot(px - (x - 2), pz - (z + 2)) < 1.2;
    },
    [ax, az],
    { timeout: 60000 },
  );
  await ash.waitForTimeout(800);
  await ash.screenshot({ path: '.smoke/3-together.png' });
  await rook.screenshot({ path: '.smoke/4-rook-view.png' });

  check(errors.length === 0, `no browser errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
  process.exit();
}
