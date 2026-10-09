// Paint that players pick for their cars, building pieces, guns and tools. One palette for all of
// them; 0 leaves the thing as it was made. The plain colours are free; the finishes at the end
// come in packs from the store.

export type Finish = 'chrome' | 'neon' | 'pearl' | 'camo';

export interface Paint {
  name: string;
  /** sRGB colour, or null to leave the original look. */
  hex: number | null;
  /** The store pack it comes in; free if none. */
  pack?: string;
  finish?: Finish;
  /** For camo: the three blotch colours over `hex`. */
  camo?: [number, number, number];
}

export const PAINTS: readonly Paint[] = [
  { name: 'Original', hex: null },
  { name: 'Black', hex: 0x1c1c1e },
  { name: 'White', hex: 0xe8e6e0 },
  { name: 'Grey', hex: 0x7a7d80 },
  { name: 'Red', hex: 0xa3201c },
  { name: 'Orange', hex: 0xd2621c },
  { name: 'Yellow', hex: 0xd8b022 },
  { name: 'Olive', hex: 0x5c6236 },
  { name: 'Green', hex: 0x2f7a3a },
  { name: 'Teal', hex: 0x1f7a78 },
  { name: 'Blue', hex: 0x2850a8 },
  { name: 'Purple', hex: 0x6a3a96 },
  { name: 'Pink', hex: 0xd86a9c },
  { name: 'Desert tan', hex: 0xb89a6a },
  { name: 'Brown', hex: 0x5a3a24 },
  { name: 'Gold', hex: 0xd4a83a },
  { name: 'Chrome', hex: 0xdfe4e8, pack: 'chrome', finish: 'chrome' },
  { name: 'Black Chrome', hex: 0x2c3036, pack: 'chrome', finish: 'chrome' },
  { name: 'Gold Chrome', hex: 0xe8b84a, pack: 'chrome', finish: 'chrome' },
  { name: 'Rose Chrome', hex: 0xe0a092, pack: 'chrome', finish: 'chrome' },
  { name: 'Neon Green', hex: 0x39ff6a, pack: 'neon', finish: 'neon' },
  { name: 'Neon Pink', hex: 0xff2fb4, pack: 'neon', finish: 'neon' },
  { name: 'Neon Blue', hex: 0x2fd8ff, pack: 'neon', finish: 'neon' },
  { name: 'Neon Orange', hex: 0xff7a1a, pack: 'neon', finish: 'neon' },
  { name: 'Woodland Camo', hex: 0x56653a, pack: 'camo', finish: 'camo', camo: [0x3a4628, 0x1f261a, 0x7a6a44] },
  { name: 'Desert Camo', hex: 0xc8a978, pack: 'camo', finish: 'camo', camo: [0xa58556, 0x7a5f3a, 0xe2cfa6] },
  { name: 'Arctic Camo', hex: 0xe6eaee, pack: 'camo', finish: 'camo', camo: [0xb4bcc4, 0x737d86, 0xffffff] },
  { name: 'Urban Camo', hex: 0x8a8d90, pack: 'camo', finish: 'camo', camo: [0x5a5d60, 0x2a2c2e, 0xb4b7ba] },
  { name: 'Pearl', hex: 0xf4f0e6, pack: 'legend', finish: 'pearl' },
  { name: 'Blood Moon', hex: 0x8a0e16, pack: 'legend', finish: 'pearl' },
  { name: 'Toxic', hex: 0x9cff2a, pack: 'legend', finish: 'neon' },
  { name: 'Galaxy', hex: 0x3a1a78, pack: 'legend', finish: 'pearl' },
];

/** True when the paint is free or its pack is among `packs`. */
export function paintOwned(n: number, packs: readonly string[]): boolean {
  const pack = PAINTS[n]?.pack;
  return !pack || packs.includes(pack);
}

/** A paint index from a message or a save: a whole number on the palette, or 0. */
export function cleanPaint(n: unknown): number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < PAINTS.length ? n : 0;
}
