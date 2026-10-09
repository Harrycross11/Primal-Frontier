// Cars to drive: a rusty pickup parked just outside each landmark, which runs on low grade fuel,
// can be shot or blown up, and turns up again where it was parked a while after it is wrecked.
// Shared so the server and the client agree on where they are, how big and how fast.

import type { Box } from './building.ts';
import { rayBox, type Vec3 } from './combat.ts';
import { SITE_RADIUS, landmarkSites, terrainHeight } from './terrain.ts';

export type VehicleKind = 'pickup';

export interface VehicleInfo {
  name: string;
  maxHp: number;
  /** Top speed forwards and backwards, m/s. */
  top: number;
  reverse: number;
  /** How quickly it picks up speed, m/s². */
  accel: number;
  /** Turning rate at speed, rad/s. */
  turn: number;
  /** Body size: length along its heading, width, and height of the solid lower body. */
  length: number;
  width: number;
  height: number;
  /** Where the driver sits: height above the ground, and how far left of and ahead of the middle. */
  seat: { y: number; left: number; ahead: number };
  /** Fuel it can hold, in units of low grade fuel. */
  tank: number;
  /** Metres it goes on one unit of fuel. */
  range: number;
}

export const VEHICLES: Record<VehicleKind, VehicleInfo> = {
  pickup: {
    name: 'Rusty Pickup',
    maxHp: 600,
    top: 17,
    reverse: 5,
    accel: 5.5,
    turn: 1.5,
    length: 4.8,
    width: 1.95,
    height: 1.15,
    seat: { y: 0.55, left: 0.42, ahead: -0.1 },
    tank: 100,
    range: 30,
  },
};

/** How close you must be to get in or fill it up. */
export const VEHICLE_RANGE = 3.5;
/** Seconds before a wrecked car is back where it was parked. */
export const VEHICLE_RESPAWN = 600;
/** Fuel in the tank of a car that has just turned up. */
export const START_FUEL = 20;

export interface VehicleState {
  id: number;
  kind: VehicleKind;
  x: number;
  y: number;
  z: number;
  /** Heading, as a player's yaw: it drives along (-sin yaw, -cos yaw). */
  yaw: number;
  hp: number;
  fuel: number;
  /** Who is at the wheel. */
  driver?: number;
}

/** Where each car is parked: just outside each landmark, on the side facing the middle of the map. */
export function vehicleSpots(seed: number): { x: number; z: number; yaw: number }[] {
  return landmarkSites(seed).map((s) => {
    const len = Math.hypot(s.x, s.z);
    // The middle land's landmark may sit near the very centre; park that car to its south.
    const [ux, uz] = len > 10 ? [-s.x / len, -s.z / len] : [0, 1];
    const d = SITE_RADIUS + 3;
    const x = s.x + ux * d;
    const z = s.z + uz * d;
    // Parked side-on to the landmark.
    return { x, z, yaw: Math.atan2(uz, -ux) };
  });
}

/** Forward and right along the ground for a heading. */
export function axes(yaw: number): { fx: number; fz: number; rx: number; rz: number } {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  return { fx, fz, rx: -fz, rz: fx };
}

/** Where the driver sits, in the world. */
export function seatAt(v: Pick<VehicleState, 'kind' | 'x' | 'z' | 'yaw'>, seed: number): Vec3 {
  const { seat } = VEHICLES[v.kind];
  const { fx, fz, rx, rz } = axes(v.yaw);
  const x = v.x + fx * seat.ahead - rx * seat.left;
  const z = v.z + fz * seat.ahead - rz * seat.left;
  return [x, terrainHeight(seed, v.x, v.z) + seat.y, z];
}

/**
 * Where a ray first meets the car's body, if within `max`. The body is a box turned to its
 * heading; only the lower part is solid, so whoever is in the cab can still be shot.
 */
export function rayVehicle(o: Vec3, d: Vec3, v: VehicleState, max: number): number | null {
  const info = VEHICLES[v.kind];
  const { fx, fz, rx, rz } = axes(v.yaw);
  // Into the car's own frame: x to its right, z ahead.
  const ox = o[0] - v.x;
  const oz = o[2] - v.z;
  const local: Vec3 = [ox * rx + oz * rz, o[1] - v.y, ox * fx + oz * fz];
  const dir: Vec3 = [d[0] * rx + d[2] * rz, d[1], d[0] * fx + d[2] * fz];
  const box: Box = { min: [-info.width / 2, 0.25, -info.length / 2], max: [info.width / 2, info.height, info.length / 2] };
  return rayBox(local, dir, box, max);
}

/** True when a circle of radius r at (x, z) overlaps the car's body. */
export function touchesVehicle(v: VehicleState, x: number, z: number, r: number): boolean {
  const info = VEHICLES[v.kind];
  const { fx, fz, rx, rz } = axes(v.yaw);
  const dx = x - v.x;
  const dz = z - v.z;
  const along = dx * fx + dz * fz;
  const side = dx * rx + dz * rz;
  return Math.abs(along) < info.length / 2 + r && Math.abs(side) < info.width / 2 + r;
}
