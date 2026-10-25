// Live server events: every so often a crew of raiders takes over one of the landmarks and sets
// down a locked crate full of the best loot in the game. Anyone can hack it open, but the hack
// takes a couple of minutes, the raiders fight for it and more come running once it starts.
// Everyone on the server hears about it, so there is always something to go after.

/** Minutes after someone starts playing before the first raid, and between raids after that. */
export const FIRST_EVENT = 8;
export const EVENT_EVERY = 35;
/** Raiders holding the landmark at first, and the ones who come running when the hack starts. */
export const RAIDERS = 4;
export const REINFORCEMENTS = 2;
/** Seconds the hack takes. */
export const HACK_SECONDS = 120;
/** Minutes the raiders hold the landmark if nobody comes for the crate. */
export const EVENT_MINUTES = 30;
/** Minutes an opened crate stays before the raid is over. */
export const OPEN_MINUTES = 10;
/** How far round the crate the raiders keep watch, in metres. */
export const POST_RADIUS = 14;

export interface LiveEvent {
  kind: 'raid';
  /** The landmark the raiders hold, and where the locked crate stands. */
  place: string;
  x: number;
  z: number;
  /** The locked crate's deployable id. */
  crate: number;
  /** Raiders still standing. */
  raiders: number;
  /** When the hack finishes (server ms), once somebody has started it. */
  hackEnd?: number;
  /** Who started the hack. */
  hacker?: string;
  /** The crate is open for anyone to loot. */
  open: boolean;
  /** When the raiders pull out (server ms). */
  ends: number;
}

/** "1:05": minutes and seconds left until a server time. */
export function countdown(until: number, now: number): string {
  const s = Math.max(0, Math.ceil((until - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
