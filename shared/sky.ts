// Time of day and weather, worked out from the server's clock so every survivor sees the same
// sky without it being sent each tick. A full day lasts 40 minutes: 30 of daylight and a
// 10-minute night you need a torch for. Storms drift between the lands: rain over the
// Ashlands and the forest, dust storms on the mesa and the flats, blizzards on the peaks.

import { BIOME_IDS, biomeWeights, type BiomeId } from './biomes.ts';
import { valueNoise } from './noise.ts';

/** Milliseconds in one day. */
export const DAY_MS = 40 * 60 * 1000;
/** Share of the day the sun is up. */
const DAYLIGHT = 0.75;

/** Where in the day it is, 0 to 1: 0 is sunrise, DAYLIGHT is sunset. */
export function dayPhase(now: number): number {
  return (((now / DAY_MS + 0.12) % 1) + 1) % 1;
}

/** The sun's height in the sky, -1 to 1 (above 0 it is up), and how far round it has come, 0 to 1. */
export function sunPath(now: number): { height: number; across: number } {
  const p = dayPhase(now);
  if (p < DAYLIGHT) return { height: Math.sin((p / DAYLIGHT) * Math.PI), across: p / DAYLIGHT };
  // Night: the sun is below the horizon, and the moon crosses instead.
  const n = (p - DAYLIGHT) / (1 - DAYLIGHT);
  return { height: -Math.sin(n * Math.PI), across: n };
}

/** How light it is, 0 (night) to 1 (day), easing through dawn and dusk. */
export function daylight(now: number): number {
  const { height } = sunPath(now);
  return Math.min(1, Math.max(0, (height + 0.08) / 0.3));
}

/** The time as a clock reads it, with sunrise at 6:00 and sunset at 20:00 (the night runs fast). */
export function clockText(now: number): string {
  const p = dayPhase(now);
  const hours = p < DAYLIGHT ? 6 + (p / DAYLIGHT) * 14 : (20 + ((p - DAYLIGHT) / (1 - DAYLIGHT)) * 10) % 24;
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export type WeatherKind = 'rain' | 'dust' | 'snow';
/** What each land's storms are made of. */
export const STORM: Record<BiomeId, WeatherKind> = { ashlands: 'rain', deadwood: 'rain', mesa: 'dust', flats: 'dust', frost: 'snow' };
/** Minutes a storm's rise and fall takes, roughly. */
const STORM_MINUTES = 6;

/**
 * How stormy one land is, 0 to 1. Each land's weather comes and goes on its own, so it can be
 * raining in the forest while the flats are clear. Storms are rarer on the Ashlands.
 */
export function stormIn(seed: number, land: BiomeId, now: number): number {
  const i = BIOME_IDS.indexOf(land);
  const t = now / (STORM_MINUTES * 60_000);
  const n = valueNoise(seed + 300 + i * 17, t, i * 7.3) * 0.75 + valueNoise(seed + 400 + i * 17, t * 3.1, i * 3.1) * 0.25;
  const threshold = land === 'ashlands' ? 0.66 : 0.58;
  return Math.min(1, Math.max(0, (n - threshold) / 0.14));
}

export interface Weather {
  rain: number;
  dust: number;
  snow: number;
}

const w = [0, 0, 0, 0, 0];

/** The weather at a spot: how hard it is raining, blowing dust and snowing, each 0 to 1. */
export function weatherAt(seed: number, x: number, z: number, now: number): Weather {
  biomeWeights(seed, x, z, w);
  const out: Weather = { rain: 0, dust: 0, snow: 0 };
  BIOME_IDS.forEach((land, i) => {
    if (w[i] > 0) out[STORM[land]] += w[i] * stormIn(seed, land, now);
  });
  return out;
}

/** How storms wear on you: blizzards make you hungry, dust storms thirsty. */
export function stormClimate(weather: Weather): { hunger: number; thirst: number } {
  return { hunger: 1 + weather.snow * 0.8, thirst: 1 + weather.dust * 0.6 };
}
