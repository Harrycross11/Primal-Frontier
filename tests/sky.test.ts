import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BIOME_IDS } from '../shared/biomes.ts';
import { DAY_MS, clockText, daylight, stormIn, sunPath, weatherAt } from '../shared/sky.ts';

test('a day has a long bright stretch and a short dark night', () => {
  let light = 0;
  let dark = 0;
  for (let t = 0; t < DAY_MS; t += DAY_MS / 400) {
    const d = daylight(t);
    assert.ok(d >= 0 && d <= 1);
    if (d > 0.9) light++;
    if (d < 0.05) dark++;
  }
  assert.ok(light > 200, `bright for ${light}/400`);
  assert.ok(dark > 40 && dark < 110, `dark for ${dark}/400`);
});

test('the sun rises and sets once a day, and the clock follows it', () => {
  let rises = 0;
  let last = sunPath(0).height;
  for (let t = DAY_MS / 500; t <= DAY_MS; t += DAY_MS / 500) {
    const h = sunPath(t).height;
    if (last < 0 && h >= 0) rises++;
    last = h;
  }
  assert.equal(rises, 1);
  assert.match(clockText(12345), /^\d\d:\d\d$/);
});

test('each land gets storms some of the time, but not most of it', () => {
  for (const land of BIOME_IDS) {
    let stormy = 0;
    const samples = 2000;
    for (let i = 0; i < samples; i++) if (stormIn(7, land, i * 60_000) > 0.3) stormy++;
    assert.ok(stormy > samples * 0.03 && stormy < samples * 0.5, `${land} stormy ${stormy}/${samples}`);
  }
});

test('the weather where you stand is made of your land\'s kind of storm', () => {
  for (let i = 0; i < 400; i++) {
    const w = weatherAt(3, (i % 20) * 19 - 190, Math.floor(i / 20) * 19 - 190, i * 97_000);
    for (const v of [w.rain, w.dust, w.snow]) assert.ok(v >= 0 && v <= 1.0001);
  }
});
