import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Game, INVITE_SECONDS, MAX_TEAM, type Outgoing } from '../server/game.ts';
import { MAX_HP, buildBaseY, pieceKey, type Piece } from '../shared/building.ts';
import { MAX_HEALTH } from '../shared/combat.ts';
import { privilege } from '../shared/deployables.ts';
import { terrainHeight } from '../shared/terrain.ts';

const SEED = 1234;

/** Level ground 12 m across, so players and walls sit where the test expects. */
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

function setup(players = 2) {
  const game = new Game(SEED);
  game.wildlife = false;
  game.loot = false;
  const ids = Array.from({ length: players }, (_, n) => game.join(`P${n}`, 0)!.id);
  ids.forEach((id, n) => standAt(game, id, FLAT.x + n * 0.9, FLAT.z));
  return { game, ids };
}

function standAt(game: Game, id: number, x: number, z: number) {
  const p = game.players.get(id)!;
  p.x = x;
  p.z = z;
  p.y = terrainHeight(game.seed, FLAT.x, FLAT.z);
}

const said = (out: Outgoing[], to: number, text: string) => out.some((o) => o.to === to && o.msg.t === 'notice' && o.msg.text.includes(text));

/** Makes `ids` one team, the first one inviting the rest. */
function team(game: Game, ids: number[]) {
  for (const id of ids.slice(1)) {
    game.invite(ids[0], id, 0);
    game.acceptInvite(id, 0);
  }
}

test('an invite makes a team, which everyone on it hears about', () => {
  const { game, ids } = setup(3);
  const [a, b, c] = ids;
  const out = game.invite(a, b, 0);
  assert.ok(out.some((o) => o.to === b && o.msg.t === 'invited' && o.msg.from === 'P0'));
  assert.equal(game.teamOf(a), undefined, 'no team until they say yes');
  const joined = game.acceptInvite(b, 1000);
  assert.ok(said(joined, a, 'P1 joined the team') && said(joined, b, 'P1 joined the team'));
  assert.ok(joined.some((o) => o.to === a && o.msg.t === 'team' && o.msg.members.length === 2));
  assert.deepEqual(game.team(a), [a, b]);

  // Anyone on the team can bring in more; an old invite has run out.
  game.invite(b, c, 2000);
  assert.ok(said(game.acceptInvite(c, 2000 + (INVITE_SECONDS + 1) * 1000), c, 'No team invite'));
  game.invite(b, c, 70_000);
  game.acceptInvite(c, 71_000);
  assert.deepEqual(game.team(c), [a, b, c]);
  assert.ok(said(game.invite(a, c, 72_000), a, 'already on your team'));
});

test("you can't invite someone already on a team, or join a full one", () => {
  const { game, ids } = setup(MAX_TEAM + 2);
  team(game, ids.slice(0, MAX_TEAM));
  assert.equal(game.team(ids[0]).length, MAX_TEAM);
  assert.ok(said(game.invite(ids[MAX_TEAM], ids[1], 0), ids[MAX_TEAM], 'already on a team'));
  assert.ok(said(game.invite(ids[0], ids[MAX_TEAM], 0), ids[0], `at most ${MAX_TEAM}`));
});

test('teammates do not hurt each other, but do once they part ways', () => {
  const { game, ids } = setup();
  const [a, b] = ids;
  const victim = game.players.get(b)!;
  team(game, ids);
  const swing = (now: number) => game.melee(a, 0, [0.9, -0.45, 0], now);
  swing(1000);
  assert.equal(victim.hp, MAX_HEALTH, 'no friendly fire');
  const out = game.leaveTeam(b);
  assert.ok(said(out, a, 'the team is no more'));
  assert.equal(game.teamOf(a), undefined, 'a team of one is no team');
  swing(5000);
  assert.ok(victim.hp < MAX_HEALTH, 'strangers again');
});

test("a teammate's tool cupboard and code locks trust the whole team", () => {
  const { game, ids } = setup(3);
  const [owner, mate, stranger] = ids;
  const p = game.players.get(owner)!;
  p.slots[2] = { item: 'toolCupboard', count: 1 };
  game.deploy(owner, 2, FLAT.x - 1.5, terrainHeight(SEED, FLAT.x - 1.5, FLAT.z), FLAT.z, 0);
  team(game, [owner, mate]);
  assert.equal(privilege(game.deployables.values(), FLAT.x, FLAT.z, game.team(mate)), 'authorised');
  assert.equal(privilege(game.deployables.values(), FLAT.x, FLAT.z, game.team(stranger)), 'blocked');

  // A locked door in a doorway beside them.
  const k = FLAT.z / 3 + 1;
  const piece: Piece = { kind: 'wall', i: FLAT.x / 3, y: buildBaseY(SEED, FLAT.x + 1.5, k * 3), k, dir: 0, material: 'wood', edit: 'door', hp: MAX_HP.wood };
  const key = pieceKey(piece);
  game.pieces.set(key, piece);
  p.slots[2] = { item: 'woodenDoor', count: 1 };
  game.hangDoor(owner, key, 2);
  p.slots[2] = { item: 'codeLock', count: 1 };
  game.lock(owner, key, 2, '4321');
  assert.ok(piece.door?.locked);
  for (const id of ids) standAt(game, id, FLAT.x + 1.5, FLAT.z + 1.5);
  assert.ok(game.toggleDoor(stranger, key).some((o) => o.msg.t === 'codeNeeded'), 'a stranger needs the code');
  game.toggleDoor(mate, key);
  assert.equal(piece.door!.open, true, 'a teammate walks straight in');
});

test('teams are saved with the world', () => {
  const { game, ids } = setup();
  team(game, ids);
  const back = Game.restore(JSON.parse(JSON.stringify(game.save(0))), 0);
  assert.deepEqual(back.team(ids[0]), ids);
});
