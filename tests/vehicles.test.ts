import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game, type Outgoing } from '../server/game.ts';
import { MAX_HEALTH } from '../shared/combat.ts';
import { ITEMS, countItem } from '../shared/items.ts';
import { atLandmark } from '../shared/landmarks.ts';
import { terrainHeight } from '../shared/terrain.ts';
import { START_FUEL, VEHICLES, VEHICLE_RESPAWN, axes, rayVehicle, seatAt, vehicleSpots } from '../shared/vehicles.ts';

const SEED = 1234;
const INFO = VEHICLES.pickup;

function setup() {
  const game = new Game(SEED);
  game.wildlife = false;
  game.loot = false;
  const id = game.join('Driver', 0)!.id;
  game.tick(0);
  const car = [...game.vehicles.values()][0];
  return { game, id, car, p: game.players.get(id)! };
}

function standAt(game: Game, id: number, x: number, z: number) {
  const p = game.players.get(id)!;
  Object.assign(p, { x, z, y: terrainHeight(SEED, x, z) });
}

/** Beside the driver's door. */
function besideCar(game: Game, id: number, car: { x: number; z: number; yaw: number }) {
  const { rx, rz } = axes(car.yaw);
  standAt(game, id, car.x - rx * 2, car.z - rz * 2);
}

const told = (out: Outgoing[], text: string) => out.some((o) => o.msg.t === 'notice' && o.msg.text.includes(text));

test('a car is parked just outside every landmark', () => {
  const { game } = setup();
  const spots = vehicleSpots(SEED);
  assert.equal(game.vehicles.size, spots.length);
  for (const s of spots) assert.equal(atLandmark(SEED, s.x, s.z, 0), false, 'off the landmark pad');
  for (const v of game.vehicles.values()) assert.equal(v.fuel, START_FUEL);
});

test('you get in at the wheel, drive at car speed, burn fuel and get out beside it', () => {
  const { game, id, car, p } = setup();
  standAt(game, id, car.x + 30, car.z);
  assert.ok(told(game.drive(id, car.id), 'Get closer'));
  besideCar(game, id, car);
  const inside = game.drive(id, car.id);
  assert.ok(inside.some((o) => o.msg.t === 'driving' && o.msg.id === car.id));
  assert.equal(car.driver, id);
  const seat = seatAt(car, SEED);
  assert.ok(Math.hypot(p.x - seat[0], p.z - seat[2]) < 0.01, 'in the driving seat');

  // Drive 15 m/s along the heading for two seconds: far quicker than anyone can run.
  const { fx, fz } = axes(car.yaw);
  let t = 1000;
  game.move(id, p.x, p.y, p.z, car.yaw, false, t);
  for (let n = 1; n <= 20; n++) {
    t += 100;
    const x = p.x + fx * 1.5;
    const z = p.z + fz * 1.5;
    const out = game.move(id, x, terrainHeight(SEED, x, z) + INFO.seat.y, z, car.yaw, true, t);
    assert.equal(out.length, 0, 'not corrected');
    game.tick(t);
  }
  const s = vehicleSpots(SEED)[car.spot];
  assert.ok(Math.hypot(car.x - s.x, car.z - s.z) > 25, 'the car went with its driver');
  assert.ok(car.fuel < START_FUEL - 0.8 && car.fuel > START_FUEL - 1.2, 'about a unit of fuel for 30 m');

  const out = game.drive(id, null);
  assert.ok(out.some((o) => o.msg.t === 'driving' && o.msg.id === null));
  assert.equal(car.driver, undefined);
  assert.ok(Math.hypot(p.x - car.x, p.z - car.z) > INFO.width / 2, 'standing outside');
});

test('only one driver at a time', () => {
  const { game, id, car } = setup();
  const other = game.join('Passenger', 0)!.id;
  besideCar(game, id, car);
  besideCar(game, other, car);
  game.drive(id, car.id);
  assert.ok(told(game.drive(other, car.id), 'already driving'));
});

test('low grade fuel fills the tank, up to what it holds', () => {
  const { game, id, car, p } = setup();
  besideCar(game, id, car);
  p.slots[2] = { item: 'lowGradeFuel', count: 200 };
  game.refuel(id, car.id, 2);
  assert.equal(car.fuel, INFO.tank);
  assert.equal(countItem(p.slots, 'lowGradeFuel'), 200 - (INFO.tank - START_FUEL));
  assert.ok(told(game.refuel(id, car.id, 2), 'full'));
  assert.ok(ITEMS.lowGradeFuel);
});

test('cars can be shot and blown up, and a new one turns up later', () => {
  const { game, id, car } = setup();
  const shooter = game.players.get(id)!;
  const { fx, fz } = axes(car.yaw);
  // Ten metres in front of it, aiming at the bonnet.
  standAt(game, id, car.x + fx * 10, car.z + fz * 10);
  const eye: [number, number, number] = [shooter.x, shooter.y + 1.6, shooter.z];
  const target: [number, number, number] = [car.x, car.y + 0.7, car.z];
  const d: [number, number, number] = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const len = Math.hypot(...d);
  assert.ok(rayVehicle(eye, d.map((v) => v / len) as [number, number, number], car, 50) !== null, 'the ray meets the body');
  shooter.slots[2] = { item: 'assaultRifle', count: 1, hp: 100, ammo: 30 };
  game.fire(id, 2, d, true, 1000);
  assert.ok(car.hp < INFO.maxHp, 'dented');

  // A driver caught in the wreck is thrown out and hurt.
  const driver = game.join('Unlucky', 0)!.id;
  besideCar(game, driver, car);
  game.drive(driver, car.id);
  const out = (game as unknown as { hurtVehicle: (...a: unknown[]) => Outgoing[] }).hurtVehicle(car, 10_000, shooter, 2000);
  assert.ok(out.some((o) => o.msg.t === 'explosion' && o.msg.item === 'car'));
  assert.equal(game.vehicles.has(car.id), false);
  assert.ok(game.players.get(driver)!.hp < MAX_HEALTH);
  assert.equal(game.players.get(driver)!.driving, undefined);

  game.tick(2000 + (VEHICLE_RESPAWN - 5) * 1000);
  assert.equal([...game.vehicles.values()].some((v) => v.spot === car.spot), false, 'not yet');
  game.tick(2000 + (VEHICLE_RESPAWN + 1) * 1000);
  assert.ok([...game.vehicles.values()].some((v) => v.spot === car.spot), 'back at its spot');
});

test('a car going fast hurts whoever it hits', () => {
  const { game, id, car, p } = setup();
  besideCar(game, id, car);
  game.drive(id, car.id);
  const { fx, fz } = axes(car.yaw);
  const victim = game.players.get(game.join('Walker', 0)!.id)!;
  // Standing 6 m ahead of the car's nose.
  standAt(game, victim.id, car.x + fx * (INFO.length / 2 + 6), car.z + fz * (INFO.length / 2 + 6));
  let t = 1000;
  game.tick(t);
  game.move(id, p.x, p.y, p.z, car.yaw, false, t);
  for (let n = 0; n < 6; n++) {
    t += 100;
    const x = p.x + fx * 1.5;
    const z = p.z + fz * 1.5;
    game.move(id, x, terrainHeight(SEED, x, z) + INFO.seat.y, z, car.yaw, true, t);
    game.tick(t);
  }
  assert.ok(victim.hp < MAX_HEALTH, 'run over');
});

test('cars are saved with the world, where they were left', () => {
  const { game, car } = setup();
  car.x += 3;
  car.fuel = 42;
  const back = Game.restore(JSON.parse(JSON.stringify(game.save(0))), 0);
  const again = back.vehicles.get(car.id)!;
  assert.equal(again.x, car.x);
  assert.equal(again.fuel, 42);
  back.tick(0);
  assert.equal(back.vehicles.size, vehicleSpots(SEED).length, 'no extra cars');
});
