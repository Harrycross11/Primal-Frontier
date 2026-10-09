import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game, PAINT_RADIUS, type Outgoing } from '../server/game.ts';
import { MAX_HP, buildBaseY, pieceKey, type Piece } from '../shared/building.ts';
import { addItem } from '../shared/items.ts';
import { PAINTS } from '../shared/paint.ts';
import { terrainHeight } from '../shared/terrain.ts';
import { VEHICLES, VEHICLE_KINDS, axes, seatAt, vehicleSpots } from '../shared/vehicles.ts';

const SEED = 1234;
const RED = PAINTS.findIndex((p) => p.name === 'Red');
const BLUE = PAINTS.findIndex((p) => p.name === 'Blue');

/** Level ground 12 m across. */
const FLAT = (() => {
  for (let z = -60; z < 60; z += 3) {
    for (let x = -60; x < 60; x += 3) {
      const h = terrainHeight(SEED, x, z);
      let ok = true;
      for (let dx = -6; dx <= 6 && ok; dx += 1) for (let dz = -6; dz <= 6 && ok; dz += 1) ok = Math.abs(terrainHeight(SEED, x + dx, z + dz) - h) < 0.4;
      if (ok) return { x: Math.round(x / 3) * 3, z: Math.round(z / 3) * 3 };
    }
  }
  throw new Error('no flat ground');
})();

function setup(players = 1) {
  const game = new Game(SEED);
  game.wildlife = false;
  game.loot = false;
  const ids = Array.from({ length: players }, (_, n) => game.join(`P${n}`, 0)!.id);
  game.tick(0);
  for (const id of ids) standAt(game, id, FLAT.x, FLAT.z);
  return { game, ids };
}

function standAt(game: Game, id: number, x: number, z: number) {
  Object.assign(game.players.get(id)!, { x, z, y: terrainHeight(SEED, x, z) });
}

const told = (out: Outgoing[], text: string) => out.some((o) => o.msg.t === 'notice' && o.msg.text.includes(text));

/** A wall on the tile `di` tiles east of the flat ground's corner. */
function wall(game: Game, di: number): string {
  const i = FLAT.x / 3 + di;
  const k = FLAT.z / 3 + 1;
  const piece: Piece = { kind: 'wall', i, y: buildBaseY(SEED, i * 3 + 1.5, k * 3), k, dir: 0, material: 'stone', edit: 'solid', hp: MAX_HP.stone };
  game.pieces.set(pieceKey(piece), piece);
  return pieceKey(piece);
}

test('each landmark has a different model of car, unpainted', () => {
  const { game } = setup();
  const kinds = [...game.vehicles.values()].map((v) => v.kind).filter((k) => k !== 'heli');
  assert.deepEqual(new Set(kinds), new Set(VEHICLE_KINDS), 'every model turns up somewhere');
  assert.equal(kinds.length, vehicleSpots(SEED).length);
  for (const v of game.vehicles.values()) assert.equal(v.paint, 0);
});

test('you can repaint a parked car and swap it for another model, keeping its share of health', () => {
  const { game, ids } = setup(2);
  const [a, b] = ids;
  const car = [...game.vehicles.values()].find((v) => v.kind === 'pickup')!;
  assert.ok(told(game.customiseCar(a, car.id, 'van', RED), 'Get closer'));
  const { rx, rz } = axes(car.yaw);
  standAt(game, a, car.x - rx * 2, car.z - rz * 2);
  car.hp = VEHICLES.pickup.maxHp / 2;
  car.fuel = 100;
  game.customiseCar(a, car.id, 'sedan', RED);
  assert.equal(car.kind, 'sedan');
  assert.equal(car.paint, RED);
  assert.equal(car.hp, VEHICLES.sedan.maxHp / 2, 'still half broken');
  assert.equal(car.fuel, VEHICLES.sedan.tank, 'fuel that no longer fits is lost');
  game.customiseCar(a, car.id, 'sedan', 999);
  assert.equal(car.paint, 0, 'nonsense paint is no paint');
  game.customiseCar(a, car.id, 'tank' as never, RED);
  assert.equal(car.kind, 'sedan', 'only real models');

  // Someone else at the wheel: hands off. The driver can change it, and moves to its new seat.
  standAt(game, b, car.x - rx * 2, car.z - rz * 2);
  game.drive(b, car.id);
  assert.ok(told(game.customiseCar(a, car.id, 'van', BLUE), 'Someone is driving'));
  const out = game.customiseCar(b, car.id, 'van', BLUE);
  assert.equal(car.kind, 'van');
  const seat = seatAt(car, SEED);
  assert.ok(out.some((o) => o.to === b && o.msg.t === 'driving' && o.msg.kind === 'van' && Math.abs(o.msg.x - seat[0]) < 0.01));
  const p = game.players.get(b)!;
  assert.ok(Math.hypot(p.x - seat[0], p.z - seat[2]) < 0.01);
});

test('building pieces take paint, one at a time or the whole base, but not in a stranger’s base', () => {
  const { game, ids } = setup(2);
  const [owner, stranger] = ids;
  const near = [wall(game, 0), wall(game, 1), wall(game, 2)];
  const far = wall(game, Math.ceil(PAINT_RADIUS / 3) + 2);
  const p = game.players.get(owner)!;
  p.slots[2] = { item: 'toolCupboard', count: 1 };
  game.deploy(owner, 2, FLAT.x - 1.5, terrainHeight(SEED, FLAT.x - 1.5, FLAT.z), FLAT.z, 0);

  game.paintPiece(owner, near[0], RED);
  assert.equal(game.pieces.get(near[0])!.paint, RED);
  assert.equal(game.pieces.get(near[1])!.paint, undefined);
  assert.ok(told(game.paintPiece(stranger, near[0], BLUE), 'Building blocked'));
  assert.equal(game.pieces.get(near[0])!.paint, RED);

  const out = game.paintPiece(owner, near[1], BLUE, true);
  for (const key of near) assert.equal(game.pieces.get(key)!.paint, BLUE);
  assert.equal(game.pieces.get(far)!.paint, undefined, 'too far to count as this base');
  assert.equal(out.filter((o) => o.msg.t === 'piece').length, 3);
  game.paintPiece(owner, near[2], 0);
  assert.equal(game.pieces.get(near[2])!.paint, undefined, 'back to bare stone');

  // New pieces can go up already painted.
  addItem(p.slots, 'wood', 100);
  p.active = p.slots.findIndex((s) => s?.item === 'buildingPlan');
  const i = FLAT.x / 3 + 1;
  const k = FLAT.z / 3 - 1;
  game.place(owner, 'foundation', i, buildBaseY(SEED, i * 3 + 1.5, k * 3 + 1.5), k, 0, 'wood', RED);
  assert.equal([...game.pieces.values()].find((x) => x.kind === 'foundation')?.paint, RED);
});

test('guns and tools take paint, which others see in your hands; other things do not', () => {
  const { game, ids } = setup(2);
  const [a, b] = ids;
  const p = game.players.get(a)!;
  p.slots[2] = { item: 'crossbow', count: 1, ammo: 0 };
  p.slots[3] = { item: 'wood', count: 10 };
  game.paintItem(a, 2, BLUE);
  assert.equal(p.slots[2]!.paint, BLUE);
  assert.ok(told(game.paintItem(a, 3, BLUE), "can't be painted"));
  assert.equal(p.slots[3]!.paint, undefined);
  game.move(a, p.x, p.y, p.z, 0, false, 100, 2);
  const out = game.tick(200);
  const seen = out.flatMap((o) => (o.msg.t === 'state' ? o.msg.players : [])).find((s) => s.id === a);
  assert.equal(seen?.held, 'crossbow');
  assert.equal(seen?.heldPaint, BLUE);
  void b;
});

test('paint is saved with the world', () => {
  const { game, ids } = setup();
  const [a] = ids;
  const key = wall(game, 0);
  game.paintPiece(a, key, RED);
  const car = [...game.vehicles.values()][0];
  car.paint = BLUE;
  const back = Game.restore(JSON.parse(JSON.stringify(game.save(0))), 0);
  assert.equal(back.pieces.get(key)!.paint, RED);
  assert.equal(back.vehicles.get(car.id)!.paint, BLUE);
});
