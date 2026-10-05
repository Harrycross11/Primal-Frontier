// Tuning values shared by the client and the server, so both sides agree on the rules.

/** The playable map is a square this many metres wide, centred on (0, 0). */
export const WORLD_SIZE = 160;
export const HALF_WORLD = WORLD_SIZE / 2;

export const MAX_PLAYERS = 8;
/** Server snapshots per second. */
export const TICK_RATE = 20;

export const PLAYER_SPEED = 6; // m/s walking
export const PLAYER_SPRINT = 9.5; // m/s sprinting
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_RADIUS = 0.35;
export const JUMP_SPEED = 6.2;
export const GRAVITY = 18;

/** How far a player can reach to gather a resource, measured from their feet to the node. */
export const GATHER_RANGE = 3.5;
/** Minimum seconds between two gather hits. */
export const GATHER_COOLDOWN = 0.35;
/** How far a player can reach to place, edit or hit a building piece, from their eyes. */
export const BUILD_RANGE = 7;

/** Seconds before a picked-clean scrap pile reappears. Trees never regrow, by design. */
export const SCRAP_RESPAWN_SECONDS = 120;
