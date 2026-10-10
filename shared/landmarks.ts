// The landmark in each land: an abandoned place built from scanned models, standing on a
// levelled pad (see landmarkSites in terrain.ts), with loot crates that refill after they are
// emptied. Shared so the server puts the crates where the client draws the buildings.

import { BIOME_IDS, type BiomeId } from './biomes.ts';
import { SITE_RADIUS, landmarkSites, type Site } from './terrain.ts';

/** A solid part of a prop to walk into: [minX, maxX, minZ, maxZ, height], in the prop's own frame. */
export type Solid = [number, number, number, number, number];

export interface LandmarkProp {
  /** A model in client/public/models. */
  model: string;
  x: number;
  z: number;
  /** Quarter turns, so its solid parts stay boxes along the world's axes. */
  turn: number;
  /** Raised off the pad, for a container stacked on another. */
  y?: number;
  solid?: Solid[];
}

export type CrateKind = 'crate' | 'militaryCrate';

export interface CrateSpot {
  kind: CrateKind;
  x: number;
  z: number;
  turn: number;
}

export interface Landmark {
  name: string;
  props: LandmarkProp[];
  crates: CrateSpot[];
  /** Where its recycler stands, clear of the props and crates. */
  recycler: { x: number; z: number };
}

// Solid parts of each model at the size the game draws it (see FIT in client/src/models.ts).
const CONTAINER: Solid[] = [[-3.05, 3.05, -1.59, 1.59, 2.81]];
const CONTAINER2: Solid[] = [[-1.64, 1.64, -4.5, 4.5, 3.44]];
const WATER_TOWER: Solid[] = [[-1.7, 1.7, -2, 2, 12]];
const GUARD_TOWER: Solid[] = [[-1.4, 1.2, -1.5, 1.0, 5.1]];
const PUMP_JACK: Solid[] = [[-2.8, 2.8, -0.84, 0.84, 3]];
const TENT: Solid[] = [[-4.4, 4.4, -4.1, 4.1, 3.2]];
const WRECK: Solid[] = [[-2.3, 2.3, -0.95, 0.95, 1.4]];
const LOGS: Solid[] = [[-1.6, 1.6, -0.9, 0.9, 1]];

export const LANDMARKS: Record<BiomeId, Landmark> = {
  // An old roadside garage, its forecourt still level under the ash.
  ashlands: {
    name: "Smith's Garage",
    props: [
      {
        model: 'lm-petrol',
        x: 0,
        z: 0,
        turn: 0,
        solid: [
          [-6.6, 3.85, -10.25, -1.2, 5],
          [-4.4, -3.9, 4.7, 5.2, 6.5],
          [4.2, 4.7, 4.7, 5.2, 6.5],
        ],
      },
      { model: 'wreck-b', x: 10.5, z: 3, turn: 1, solid: WRECK },
      { model: 'wreck-e', x: -11, z: 10, turn: 0, solid: WRECK },
      { model: 'lm-container2', x: -14, z: -6, turn: 0, solid: CONTAINER2 },
      { model: 'barrel', x: 5.5, z: -9, turn: 0 },
      { model: 'barrel', x: 6.3, z: -8.2, turn: 1 },
    ],
    recycler: { x: -14, z: 3 },
    crates: [
      { kind: 'crate', x: 7, z: -5, turn: 0 },
      { kind: 'crate', x: -11, z: 3.5, turn: 1 },
      { kind: 'crate', x: 2, z: 13, turn: 1 },
      { kind: 'militaryCrate', x: -10, z: -11, turn: 0 },
    ],
  },
  // Where the last loggers lived: a house, a tool shed, the camp's water tower and cut logs.
  deadwood: {
    name: 'Logging Camp',
    props: [
      { model: 'lm-house', x: 0, z: -7, turn: 0, solid: [[-4.76, 4.76, -5.5, 5.5, 4.6]] },
      { model: 'lm-shed', x: 11, z: 6, turn: 3, solid: [[-1.96, 1.96, -2.32, 2.32, 4.2]] },
      { model: 'lm-waterTower', x: -11, z: 9, turn: 0, solid: WATER_TOWER },
      { model: 'lm-container', x: 12, z: -9, turn: 1, solid: CONTAINER },
      { model: 'log', x: -12, z: -5, turn: 0, solid: LOGS },
      { model: 'log', x: -12, z: -3.4, turn: 0 },
      { model: 'log', x: -12, z: -4.2, turn: 0, y: 0.6 },
    ],
    recycler: { x: -9, z: 3.5 },
    crates: [
      { kind: 'crate', x: 6, z: 1, turn: 0 },
      { kind: 'crate', x: -6, z: 4, turn: 1 },
      { kind: 'crate', x: 15, z: -3, turn: 0 },
      { kind: 'militaryCrate', x: -8, z: 12, turn: 1 },
    ],
  },
  // A depot for the old mines: a warehouse, stacked containers, a lookout and a water tower.
  mesa: {
    name: 'Mining Outpost',
    props: [
      { model: 'lm-warehouse', x: 0, z: -2, turn: 0, solid: [[-5.74, 5.74, -6.93, 6.89, 4.4]] },
      { model: 'lm-container', x: -12, z: 7, turn: 1, solid: CONTAINER },
      { model: 'lm-container', x: -12, z: 7, turn: 1, y: 2.81 },
      { model: 'lm-container2', x: 12, z: -4, turn: 0, solid: CONTAINER2 },
      { model: 'lm-guardTower', x: 12, z: 11, turn: 2, solid: GUARD_TOWER },
      { model: 'lm-waterTower', x: -12, z: -11, turn: 1, solid: WATER_TOWER },
    ],
    recycler: { x: -18, z: -0.5 },
    crates: [
      { kind: 'crate', x: 5, z: 8.5, turn: 1 },
      { kind: 'crate', x: -4, z: 8.5, turn: 0 },
      { kind: 'crate', x: -15, z: 0, turn: 1 },
      { kind: 'militaryCrate', x: 15, z: -11, turn: 0 },
    ],
  },
  // Nodding donkeys on the dry lake bed, the crew's tent and a tank of water.
  flats: {
    name: 'Oil Field',
    props: [
      { model: 'lm-pumpJack', x: -10, z: -7, turn: 0, solid: PUMP_JACK },
      { model: 'lm-pumpJack', x: 6, z: -12, turn: 0, solid: PUMP_JACK },
      { model: 'lm-pumpJack', x: 12, z: 5, turn: 1, solid: PUMP_JACK },
      { model: 'lm-tent', x: -7, z: 9, turn: 0, solid: TENT },
      { model: 'lm-container2', x: 4, z: 5, turn: 1, solid: CONTAINER2 },
      { model: 'lm-waterTower', x: -15, z: -15, turn: 0, solid: WATER_TOWER },
    ],
    recycler: { x: -17, z: 1.5 },
    crates: [
      { kind: 'crate', x: 0, z: -3, turn: 0 },
      { kind: 'crate', x: 12, z: -4, turn: 1 },
      { kind: 'crate', x: -14, z: 2, turn: 1 },
      { kind: 'militaryCrate', x: 3, z: 10, turn: 0 },
    ],
  },
  // An army relay post up in the snow: the mast, two tents, a lookout and a container.
  frost: {
    name: 'Radio Station',
    props: [
      { model: 'lm-radioTower', x: 0, z: 0, turn: 0, solid: [[-2.6, 2.6, -2.6, 2.6, 30]] },
      { model: 'lm-tent', x: -11, z: -7, turn: 1, solid: TENT },
      { model: 'lm-tent', x: -11, z: 8, turn: 1, solid: TENT },
      { model: 'lm-guardTower', x: 12, z: -11, turn: 3, solid: GUARD_TOWER },
      { model: 'lm-container', x: 11, z: 8, turn: 0, solid: CONTAINER },
    ],
    recycler: { x: -19, z: 0 },
    crates: [
      { kind: 'militaryCrate', x: 4.5, z: -4, turn: 0 },
      { kind: 'militaryCrate', x: -4.5, z: 4, turn: 1 },
      { kind: 'crate', x: 14, z: 1, turn: 1 },
      { kind: 'crate', x: -16, z: 0.5, turn: 0 },
    ],
  },
};

/** A point in a landmark's own frame, turned and moved to where the landmark stands. */
export function toWorld(site: Site, x: number, z: number): [number, number] {
  const a = (site.turn * Math.PI) / 2;
  const c = Math.round(Math.cos(a));
  const s = Math.round(Math.sin(a));
  // Three.js's turn about y: x' = x cos + z sin, z' = -x sin + z cos.
  return [site.x + x * c + z * s, site.z - x * s + z * c];
}

/** Each landmark, where it stands. */
export function landmarks(seed: number): { site: Site; land: BiomeId; landmark: Landmark }[] {
  return landmarkSites(seed).map((site) => ({ site, land: BIOME_IDS[site.land], landmark: LANDMARKS[BIOME_IDS[site.land]] }));
}

/** Every crate spot on the map, with a key that stays the same for that spot. */
export function crateSpots(seed: number): { key: string; kind: CrateKind; land: BiomeId; x: number; y: number; z: number; rot: number }[] {
  return landmarks(seed).flatMap(({ site, land, landmark }) =>
    landmark.crates.map((c, i) => {
      const [x, z] = toWorld(site, c.x, c.z);
      return { key: `${land}:${i}`, kind: c.kind, land, x, y: site.y, z, rot: ((c.turn + site.turn) * Math.PI) / 2 };
    }),
  );
}

/** Every landmark's recycler, in world space. */
export function recyclerSpots(seed: number): { key: string; land: BiomeId; x: number; y: number; z: number; rot: number }[] {
  return landmarks(seed).map(({ site, land, landmark }) => {
    const [x, z] = toWorld(site, landmark.recycler.x, landmark.recycler.z);
    return { key: `${land}:recycler`, land, x, y: site.y, z, rot: (site.turn * Math.PI) / 2 };
  });
}

/** True within `pad` metres beyond a landmark's levelled ground, where nobody may build. */
export function atLandmark(seed: number, x: number, z: number, pad = 0): boolean {
  return landmarkSites(seed).some((s) => Math.hypot(s.x - x, s.z - z) < SITE_RADIUS + pad);
}
