// Explosives for raiding: a beancan grenade you throw, a satchel charge you stick to a wall or
// door, and timed explosive charges (C4) that take out almost anything in one go. Each burns
// down a fuse, then wrecks building pieces and doors and hurts anyone nearby who isn't behind
// a wall. Shared so the client knows the fuse lengths and describes them the same way.

export type ExplosiveId = 'beancan' | 'satchel' | 'c4';
export const EXPLOSIVE_IDS: ExplosiveId[] = ['beancan', 'satchel', 'c4'];

export interface ExplosiveInfo {
  /** Seconds from lighting it to the bang (counting a beancan's flight). */
  fuse: number;
  /** Metres the blast reaches. */
  radius: number;
  /** Damage to the wall or door it sits on; others in the blast take up to half as much. */
  structure: number;
  /** Damage to someone standing on top of it, less with distance, before armour. */
  people: number;
}

export const EXPLOSIVES: Record<ExplosiveId, ExplosiveInfo> = {
  beancan: { fuse: 3.5, radius: 3, structure: 60, people: 55 },
  satchel: { fuse: 7, radius: 3.5, structure: 110, people: 80 },
  c4: { fuse: 10, radius: 4, structure: 320, people: 160 },
};

/** How fast a beancan leaves your hand, in metres a second. */
export const THROW_SPEED = 13;
/** How far from your eyes you can stick a charge to something, in metres. */
export const PLANT_RANGE = 3;
/** Pieces this close to the blast take its full force, like the one it sits on. */
export const POINT_BLANK = 0.6;

export function isExplosive(item: string): item is ExplosiveId {
  return (EXPLOSIVE_IDS as string[]).includes(item);
}

/** The share of a blast's damage that reaches `distance` metres away, 1 at the middle to 0 at the edge. */
export function blastFalloff(distance: number, radius: number): number {
  return Math.max(0, 1 - distance / radius);
}
