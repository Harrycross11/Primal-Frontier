import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game } from '../server/game.ts';
import { BIOME_IDS, biomeAt, biomeWeights, climateAt, type BiomeId } from '../shared/biomes.ts';
import { HALF_WORLD } from '../shared/constants.ts';
import { packDens } from '../shared/creatures.ts';
import { tickVitals } from '../shared/survival.ts';
import { generateResources } from '../shared/world.ts';

const SEEDS = [1234, 4321, 99];

/** Spots on a grid over the playable map, and which land each is in. */
function survey(seed: number): Map<BiomeId, number> {
  const area = new Map<BiomeId, number>();
  for (let x = -HALF_WORLD * 0.9; x < HALF_WORLD * 0.9; x += 6) {
    for (let z = -HALF_WORLD * 0.9; z < HALF_WORLD * 0.9; z += 6) {
      const b = biomeAt(seed, x, z);
      area.set(b, (area.get(b) ?? 0) + 1);
    }
  }
  return area;
}

test('every map has all five lands, the Ashlands in the middle, blended at the borders', () => {
  for (const seed of SEEDS) {
    assert.equal(biomeAt(seed, 0, 0), 'ashlands');
    const area = survey(seed);
    for (const id of BIOME_IDS) assert.ok((area.get(id) ?? 0) > 150, `${id} too small on seed ${seed}`);
    for (let n = 0; n < 200; n++) {
      const w = biomeWeights(seed, (n * 37) % 380 - 190, (n * 91) % 380 - 190);
      assert.ok(Math.abs(w.reduce((a, b) => a + b, 0) - 1) < 1e-9);
    }
  }
});

test('each land is richest in what it is known for', () => {
  const known: [BiomeId, string][] = [
    ['deadwood', 'tree'],
    ['mesa', 'metalOre'],
    ['flats', 'sulfurOre'],
    ['frost', 'hqmOre'],
    ['ashlands', 'scrap'],
  ];
  for (const seed of SEEDS) {
    const area = survey(seed);
    const nodes = generateResources(seed);
    for (const [land, kind] of known) {
      // Nodes per bit of ground, so a big land doesn't win by size alone.
      const density = (b: BiomeId) => nodes.filter((n) => n.kind === kind && biomeAt(seed, n.x, n.z) === b).length / (area.get(b) ?? 1);
      for (const other of BIOME_IDS) if (other !== land) assert.ok(density(land) > density(other), `${kind}: ${land} vs ${other} on seed ${seed}`);
    }
  }
});

test('survivors wake in the Ashlands and the hound packs den out in the wild lands', () => {
  for (const seed of SEEDS) {
    const game = new Game(seed);
    for (let n = 0; n < 8; n++) {
      const p = game.players.get(game.join(`S${n}`, 0)!.id)!;
      assert.equal(biomeAt(seed, p.x, p.z), 'ashlands');
    }
    const dens = packDens(seed).map(([x, z]) => biomeAt(seed, x, z));
    assert.ok(dens.filter((d) => d === 'deadwood').length >= 3);
    assert.ok(!dens.includes('ashlands'));
  }
});

test('the flats make you thirsty and the peaks make you hungry', () => {
  const seed = 1234;
  const spot = (land: BiomeId): [number, number] => {
    const w = [0, 0, 0, 0, 0];
    for (let x = -180; x < 180; x += 4) for (let z = -180; z < 180; z += 4) if (biomeWeights(seed, x, z, w)[BIOME_IDS.indexOf(land)] === 1) return [x, z];
    throw new Error(`no ${land}`);
  };
  const drain = (land: BiomeId) => {
    const v = { food: 100, water: 100, rads: 0 };
    tickVitals(v, 60, false, 0, 0, 100, 100, climateAt(seed, ...spot(land)));
    return { food: 100 - v.food, water: 100 - v.water };
  };
  const home = drain('ashlands');
  assert.ok(drain('flats').water > home.water * 1.5);
  assert.ok(Math.abs(drain('flats').food - home.food) < 1e-9);
  assert.ok(drain('frost').food > home.food * 1.5);
});
