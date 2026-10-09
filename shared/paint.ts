// Paint that players pick for their cars, building pieces, guns and tools. One palette for all of
// them; 0 leaves the thing as it was made.

export interface Paint {
  name: string;
  /** sRGB colour, or null to leave the original look. */
  hex: number | null;
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
];

/** A paint index from a message or a save: a whole number on the palette, or 0. */
export function cleanPaint(n: unknown): number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < PAINTS.length ? n : 0;
}
