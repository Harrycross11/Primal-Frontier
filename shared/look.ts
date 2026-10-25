// How a survivor looks, picked before joining: skin, hair and clothing colours, and what they
// wear on their head, face and back. Each part is an index into its list of options; the first
// option is how the scanned survivor looks as it was scanned (null colour: left as scanned).

export const LOOK_PARTS = {
  skin: {
    label: 'Skin',
    options: [
      ['Weathered', null],
      ['Pale', 0xd6b49e],
      ['Fair', 0xc89e80],
      ['Olive', 0xa27a58],
      ['Brown', 0x7e5638],
      ['Dark', 0x553a2a],
    ],
  },
  hair: {
    label: 'Hair',
    options: [
      ['Dark brown', null],
      ['Black', 0x1c1a19],
      ['Chestnut', 0x6a4430],
      ['Auburn', 0x8a3f22],
      ['Blond', 0xb8955c],
      ['Grey', 0x8c8a86],
    ],
  },
  jacket: {
    label: 'Jacket',
    options: [
      ['Worn grey', null],
      ['Olive drab', 0x5f6440],
      ['Oilskin', 0x6e5136],
      ['Charcoal', 0x3c3d3f],
      ['Navy', 0x34445e],
      ['Khaki', 0x8c7c58],
      ['Rust', 0x74452f],
      ['Forest', 0x3e5640],
      ['Oxblood', 0x5e2c2a],
      ['Ashfall grey', 0x4b4844],
      ['Ember', 0x7c2c1a],
    ],
  },
  trousers: {
    label: 'Trousers',
    options: [
      ['Worn grey', null],
      ['Denim', 0x3e4c66],
      ['Black', 0x2a2a2b],
      ['Brown', 0x56442f],
      ['Khaki', 0x7c6e50],
      ['Olive', 0x4e533a],
      ['Camo grey', 0x5c5c56],
      ['Ash', 0x46443f],
    ],
  },
  boots: {
    label: 'Boots',
    options: [
      ['Scuffed', null],
      ['Black', 0x222120],
      ['Brown', 0x5a3e2a],
      ['Tan', 0x9a7a54],
      ['Ember red', 0x5e2216],
    ],
  },
  head: {
    label: 'Headwear',
    options: [
      ['None', null],
      ['Hood', null],
      ['Beanie', null],
      ['Cap', null],
      ['Bandana', null],
      ['Wide hat', null],
    ],
  },
  face: {
    label: 'Face',
    options: [
      ['Bare', null],
      ['Respirator', null],
      ['Goggles', null],
      ['Goggles and respirator', null],
      ['Scarf mask', null],
    ],
  },
  pack: {
    label: 'Backpack',
    options: [
      ['Canvas', 0x6a6150],
      ['Olive', 0x4e5638],
      ['Black', 0x2c2c2c],
      ['Tan', 0x8a7652],
      ['None', null],
      ['Ember', 0x7a3a22],
    ],
  },
} as const satisfies Record<string, { label: string; options: readonly (readonly [string, number | null])[] }>;

export type LookPart = keyof typeof LOOK_PARTS;
export type Look = Record<LookPart, number>;

export const LOOK_KEYS = Object.keys(LOOK_PARTS) as LookPart[];

/** Options that are season pass rewards, by part and option, with the unlock that gives them. */
export const LOOK_REWARDS: Partial<Record<LookPart, Record<number, string>>> = {
  jacket: { 9: 'ashfall-jacket-ash', 10: 'ashfall-jacket-ember' },
  trousers: { 7: 'ashfall-trousers' },
  boots: { 4: 'ashfall-boots' },
  pack: { 5: 'ashfall-pack' },
};

/** True when an option is free or its unlock is among `owned`. */
export function lookOwned(part: LookPart, option: number, owned: readonly string[]): boolean {
  const id = LOOK_REWARDS[part]?.[option];
  return !id || owned.includes(id);
}

/** The look with anything not unlocked put back to how it was scanned. */
export function ownedLook(look: Look, owned: readonly string[]): Look {
  return Object.fromEntries(LOOK_KEYS.map((k) => [k, lookOwned(k, look[k], owned) ? look[k] : 0])) as Look;
}

/** The survivor as scanned, with nothing added. */
export function defaultLook(): Look {
  return Object.fromEntries(LOOK_KEYS.map((k) => [k, 0])) as Look;
}

/** A look from untrusted input: every part a whole number in range, else the default. */
export function cleanLook(raw: unknown): Look {
  const look = defaultLook();
  if (!raw || typeof raw !== 'object') return look;
  for (const k of LOOK_KEYS) {
    const v = (raw as Record<string, unknown>)[k];
    if (Number.isInteger(v) && (v as number) >= 0 && (v as number) < LOOK_PARTS[k].options.length) look[k] = v as number;
  }
  return look;
}

/** The colour picked for a part, or null to leave it as scanned. */
export function lookColor(look: Look, part: LookPart): number | null {
  return LOOK_PARTS[part].options[look[part]][1];
}

/** A random look from what `owned` unlocks, from `random` in [0, 1). */
export function randomLook(random: () => number = Math.random, owned: readonly string[] = []): Look {
  return Object.fromEntries(
    LOOK_KEYS.map((k) => {
      const free = LOOK_PARTS[k].options.flatMap((_, n) => (lookOwned(k, n, owned) ? [n] : []));
      return [k, free[Math.floor(random() * free.length)]];
    }),
  ) as Look;
}
