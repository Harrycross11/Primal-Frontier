// Takes showcase screenshots: one player with a starter kit builds a small two-storey hut,
// then the camera looks at it in high and low graphics. Saves to .smoke/. Run `npm run build` first.

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const PORT = 3997;
mkdirSync('.smoke', { recursive: true });
const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), SEED: process.env.SEED ?? '424242', START_KIT: '500', NO_SAVE: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise<void>((resolve) => server.stdout!.on('data', (d) => String(d).includes('server on') && resolve()));
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror', e.message));
  await page.addInitScript(() => localStorage.setItem('pf-quality', 'low'));
  await page.goto(`http://localhost:${PORT}`);
  await page.fill('#name', 'Ash');
  await page.click('#play');
  await page.waitForFunction(() => (window as any).__pf !== undefined, null, { timeout: 120000 });
  const pf = (fn: string, ...args: unknown[]) =>
    page.evaluate(([f, a]) => (window as any).__pf[f as string](...(a as unknown[])), [fn, args] as const);
  const walkTo = async (x: number, z: number) => {
    await pf('walkTo', x, z);
    await page.waitForFunction(
      ([x, z]) => {
        const [px, , pz] = (window as any).__pf.state().position;
        return Math.hypot(px - x, pz - z) < 0.8;
      },
      [x, z],
      { timeout: 300000 },
    );
  };

  const spot = (await pf('findClearSpot', 12)) as { x: number; z: number };
  await walkTo(spot.x, spot.z);
  const [px, py, pz] = ((await pf('state')) as any).position;
  const i = Math.floor(px / 3) + 1;
  const k = Math.floor(pz / 3);
  const y = Math.round(py);
  await walkTo(i * 3 + 3, k * 3 - 2);
  const place = async (kind: string, ii: number, yy: number, kk: number, dir: number, mat = 'wood') => {
    await pf('place', kind, ii, yy, kk, dir, mat);
    await page.waitForTimeout(120);
  };
  // Ground floor: wood walls with a door and a window, scrap back wall.
  await place('floor', i, y, k, 0);
  await place('floor', i + 1, y, k, 0);
  await place('wall', i, y, k, 1);
  await place('wall', i, y, k, 0);
  await place('wall', i + 1, y, k, 0);
  await place('wall', i, y, k + 1, 0, 'scrap');
  await place('wall', i + 1, y, k + 1, 0, 'scrap');
  await place('wall', i + 2, y, k, 1, 'scrap');
  // Second storey: a floor over both tiles and half walls as a balcony rail.
  await place('floor', i, y + 3, k, 0);
  await place('floor', i + 1, y + 3, k, 0);
  await place('wall', i, y + 3, k, 0);
  await place('wall', i + 1, y + 3, k, 0);
  await place('stairs', i - 1, y, k + 1, 1);
  await page.waitForTimeout(400);
  await pf('edit', `wall:${i},${y},${k},1`, 'door');
  await pf('edit', `wall:${i},${y},${k},0`, 'window');
  await pf('edit', `wall:${i + 1},${y},${k},0`, 'window');
  await pf('edit', `wall:${i},${y + 3},${k},0`, 'half');
  await pf('edit', `wall:${i + 1},${y + 3},${k},0`, 'half');
  const pieces = ((await pf('state')) as any).pieces.length;
  console.log('pieces built:', pieces, 'of 13');

  // View from the front-left corner, looking at the hut.
  const cx = (i + 1) * 3;
  const cz = k * 3 + 1.5;
  const vx = cx - 6;
  const vz = cz - 10;
  await walkTo(vx, vz);
  const yaw = Math.atan2(-(cx - vx), -(cz - vz));
  await pf('look', yaw, -0.08);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: '.smoke/hut-low.png', timeout: 300000 });
  await pf('setQuality', 'high');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '.smoke/hut-high.png', timeout: 300000 });
  await pf('look', yaw + 2.2, -0.02);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: '.smoke/landscape-high.png', timeout: 300000 });
  console.log('screenshots saved');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
  process.exit();
}
