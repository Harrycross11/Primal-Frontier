// Entry point: join screen, then the game loop (input, physics, networking, rendering).

import * as THREE from 'three';
import { GATHER_RANGE } from '../../shared/constants.ts';
import {
  MAX_HP,
  PIECE_COST,
  STOREY,
  WALL_EDITS,
  pieceKey,
  pieceSupported,
  type Piece,
  type PieceKind,
} from '../../shared/building.ts';
import type { PlayerState, ServerMessage } from '../../shared/protocol.ts';
import { RESOURCE_INFO, type Inventory, type Material, type ResourceNode } from '../../shared/world.ts';
import { Avatar } from './avatar.ts';
import { inReach, proposePiece, type AimHit } from './build.ts';
import { Controller } from './controller.ts';
import { Graphics } from './graphics.ts';
import { Hud, type Slot } from './hud.ts';
import { Net } from './net.ts';
import { World, buildPieceMesh } from './world.ts';

const RESOURCE_NAMES = { tree: 'Living tree', deadTree: 'Dead tree', scrap: 'Scrap wreck' } as const;
const PIECE_NAMES: Record<PieceKind, string> = { wall: 'wall', floor: 'floor', stairs: 'stairs' };
const SLOTS: Slot[] = ['hands', 'wall', 'floor', 'stairs'];

interface Remote {
  state: PlayerState;
  avatar: Avatar;
  target: THREE.Vector3;
}

const hud = new Hud();

hud.onPlay(async (name) => {
  const net = new Net();
  try {
    await net.opened();
  } catch (e) {
    hud.showJoinError((e as Error).message);
    return;
  }
  net.send({ t: 'join', name });
  const welcome = await new Promise<Extract<ServerMessage, { t: 'welcome' } | { t: 'full' }>>((resolve) => {
    net.onMessage = (m) => {
      if (m.t === 'welcome' || m.t === 'full') resolve(m);
    };
  });
  if (welcome.t === 'full') {
    hud.showJoinError('This server is full (8 players). Try again later.');
    return;
  }
  hud.hideJoin();
  startGame(net, welcome);
});

function startGame(net: Net, welcome: Extract<ServerMessage, { t: 'welcome' }>) {
  const world = new World(welcome.seed);
  const gfx = new Graphics(document.getElementById('game')!, world.scene);
  const camera = gfx.camera;
  hud.setQuality(gfx.quality);

  const resources = welcome.resources;
  world.addResources(resources);
  for (const p of welcome.pieces) world.setPiece(pieceKey(p), p);

  const me = new Avatar(welcome.you.color);
  world.scene.add(me.root);
  const canvas = gfx.renderer.domElement;
  const controller = new Controller(world, () => resources, canvas);
  controller.teleport(welcome.you.x, welcome.you.y, welcome.you.z);

  const remotes = new Map<number, Remote>();
  const addRemote = (p: PlayerState) => {
    if (remotes.has(p.id) || p.id === welcome.id) return;
    const avatar = new Avatar(p.color, p.name);
    avatar.root.position.set(p.x, p.y, p.z);
    world.scene.add(avatar.root);
    remotes.set(p.id, { state: p, avatar, target: new THREE.Vector3(p.x, p.y, p.z) });
  };
  welcome.players.forEach(addRemote);

  let inventory: Inventory = welcome.inventory;
  let slot: Slot = 'hands';
  let material: Material = 'wood';
  hud.setInventory(inventory);
  hud.setSlot(slot, material);
  const refreshPlayers = () => hud.setPlayers([welcome.you.name, ...[...remotes.values()].map((r) => r.state.name)]);
  refreshPlayers();

  net.onMessage = (m) => {
    switch (m.t) {
      case 'state':
        for (const p of m.players) {
          const r = remotes.get(p.id);
          if (!r) continue;
          r.state = p;
          r.target.set(p.x, p.y, p.z);
        }
        break;
      case 'joined':
        addRemote(m.player);
        refreshPlayers();
        break;
      case 'left': {
        const r = remotes.get(m.id);
        if (r) world.scene.remove(r.avatar.root);
        remotes.delete(m.id);
        refreshPlayers();
        break;
      }
      case 'resource':
        resources[m.id].amount = m.amount;
        world.setResourceAmount(m.id, m.amount);
        break;
      case 'inventory':
        inventory = m.inventory;
        hud.setInventory(inventory);
        break;
      case 'piece':
        world.setPiece(m.key, m.piece);
        if (m.by !== welcome.id) remotes.get(m.by)?.avatar.swing();
        break;
      case 'correct':
        controller.teleport(m.x, m.y, m.z);
        break;
      case 'notice':
        hud.notice(m.text);
        break;
    }
  };
  net.onClose = () => hud.disconnected();

  // Input. Click captures the mouse. Left click uses the selected slot: gather and hit with
  // hands, or place the selected piece. G edits the wall you look at. R swaps material.
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (e.button === 0) primary();
    if (e.button === 2) setSlot(slot === 'hands' ? 'wall' : 'hands');
  });
  addEventListener('wheel', (e) => {
    if (document.pointerLockElement !== canvas) return;
    const n = SLOTS.indexOf(slot) + (e.deltaY > 0 ? 1 : -1);
    setSlot(SLOTS[(n + SLOTS.length) % SLOTS.length]);
  });
  addEventListener('keydown', (e) => {
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (n >= 0) setSlot(SLOTS[n]);
    if (e.code === 'KeyQ') setSlot('wall');
    if (e.code === 'KeyR') {
      material = material === 'wood' ? 'scrap' : 'wood';
      hud.setSlot(slot, material);
    }
    if (e.code === 'KeyE') hitTarget();
    if (e.code === 'KeyG') editTarget();
    if (e.code === 'KeyH') hud.toggleHelp();
    if (e.code === 'KeyO') {
      gfx.setQuality(gfx.quality === 'high' ? 'low' : 'high');
      hud.setQuality(gfx.quality);
    }
  });
  function setSlot(s: Slot) {
    slot = s;
    hud.setSlot(slot, material);
  }

  const raycaster = new THREE.Raycaster();
  let aim: AimHit | null = null;
  let aimResource: ResourceNode | null = null;
  let proposal: Piece | null = null;

  function updateAim() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    raycaster.far = camera.position.distanceTo(controller.eye) + 10;
    aim = null;
    aimResource = null;
    for (const h of raycaster.intersectObjects(world.pickables, true)) {
      if (!isVisible(h.object)) continue;
      // Ignore things between the camera and the player's back.
      if (h.distance < camera.position.distanceTo(controller.eye) - 0.5) continue;
      const rid = h.object.userData.resourceId as number | undefined;
      if (rid !== undefined) aimResource = resources[rid];
      const key = h.object.userData.pieceKey as string | undefined;
      aim = { point: h.point.clone(), piece: key ? (world.pieces.get(key) ?? null) : null };
      break;
    }
  }

  function isVisible(o: THREE.Object3D): boolean {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  function resourceInRange(node: ResourceNode) {
    return Math.hypot(node.x - controller.position.x, node.z - controller.position.z) <= GATHER_RANGE + RESOURCE_INFO[node.kind].radius;
  }

  function primary() {
    if (slot === 'hands') return hitTarget();
    if (!proposal) return;
    if (inventory[material] < PIECE_COST) return hud.notice(`Need ${PIECE_COST} ${material}`);
    net.send({ t: 'place', kind: proposal.kind, i: proposal.i, y: proposal.y, k: proposal.k, dir: proposal.dir, material });
    me.swing();
  }

  function hitTarget() {
    if (aimResource) {
      if (!resourceInRange(aimResource)) return hud.notice('Get closer to gather');
      net.send({ t: 'gather', id: aimResource.id });
      me.swing();
    } else if (aim?.piece) {
      if (!inReach(controller.eye, aim.piece)) return hud.notice('Too far away');
      net.send({ t: 'hit', key: pieceKey(aim.piece) });
      me.swing();
    }
  }

  function editTarget() {
    const piece = aim?.piece;
    if (!piece || piece.kind !== 'wall') return hud.notice('Look at a wall to edit it');
    if (!inReach(controller.eye, piece)) return hud.notice('Too far away');
    const next = WALL_EDITS[(WALL_EDITS.indexOf(piece.edit) + 1) % WALL_EDITS.length];
    net.send({ t: 'edit', key: pieceKey(piece), edit: next });
  }

  // Blue see-through preview of the piece about to be placed, red if it can't go there.
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x4fb3ff, transparent: true, opacity: 0.35, depthWrite: false });
  let ghost: THREE.Group | null = null;
  let ghostKey = '';
  function updateGhost() {
    proposal = null;
    if (slot !== 'hands') {
      const look = new THREE.Vector3();
      camera.getWorldDirection(look);
      proposal = proposePiece(world, slot, material, aim, controller.eye, look, controller.position.y);
    }
    const key = proposal ? `${pieceKey(proposal)}:${material}` : '';
    if (key !== ghostKey) {
      if (ghost) world.scene.remove(ghost);
      ghost = proposal ? buildPieceMesh(proposal, ghostMat) : null;
      if (ghost) world.scene.add(ghost);
      ghostKey = key;
    }
    if (proposal) {
      const ok = inventory[material] >= PIECE_COST && pieceSupported(world.seed, proposal, world.pieces.values());
      ghostMat.color.set(ok ? 0x4fb3ff : 0xff5a4a);
    }
  }

  function describeTarget(): { text: string; health?: number } {
    if (aimResource && aimResource.amount > 0) {
      const info = RESOURCE_INFO[aimResource.kind];
      const label = `${RESOURCE_NAMES[aimResource.kind]}: ${aimResource.amount} ${info.material}`;
      return { text: resourceInRange(aimResource) ? `${label}  ·  Left click to gather` : `${label}  ·  Get closer` };
    }
    if (aim?.piece && (slot === 'hands' || aim.piece.kind === 'wall')) {
      const p = aim.piece;
      const name = `${p.material === 'wood' ? 'Wood' : 'Scrap'} ${p.kind === 'wall' && p.edit !== 'solid' ? `${p.edit === 'half' ? 'half wall' : p.edit}` : PIECE_NAMES[p.kind]}`;
      const hints = [slot === 'hands' ? 'Left click to hit' : '', p.kind === 'wall' ? 'G to edit' : ''].filter(Boolean);
      return { text: [name, ...hints].join('  ·  '), health: p.hp / MAX_HP[p.material] };
    }
    if (slot !== 'hands' && proposal && inventory[material] < PIECE_COST) return { text: `Need ${PIECE_COST} ${material}` };
    return { text: '' };
  }

  // Test hooks for the automated smoke test (scripts/smoke.ts).
  const dist = (r: { x: number; z: number }) => Math.hypot(r.x - controller.position.x, r.z - controller.position.z);
  (window as unknown as { __pf: unknown }).__pf = {
    state: () => ({
      id: welcome.id,
      others: remotes.size,
      inventory,
      pieces: [...world.pieces.values()],
      position: controller.position.toArray(),
    }),
    walkTo: (x: number, z: number) => (controller.autoWalk = { x, z }),
    look: (yaw: number, pitch: number) => {
      controller.autoWalk = null;
      controller.yaw = yaw;
      controller.pitch = pitch;
    },
    nearestResource: (kind: string) => resources.filter((r) => r.kind === kind && r.amount > 0).sort((a, b) => dist(a) - dist(b))[0],
    gather: (id: number) => net.send({ t: 'gather', id }),
    place: (kind: PieceKind, i: number, y: number, k: number, dir: number, mat: Material) =>
      net.send({ t: 'place', kind, i, y, k, dir, material: mat }),
    edit: (key: string, edit: Piece['edit']) => net.send({ t: 'edit', key, edit }),
    setQuality: (q: 'high' | 'low') => {
      gfx.setQuality(q);
      hud.setQuality(q);
    },
    /** Nearest open patch of ground with nothing to bump into, for building in tests. */
    findClearSpot: () => {
      const p = controller.position;
      let best: { x: number; z: number } | null = null;
      for (let r = 2; r < 40 && !best; r += 2) {
        for (let a = 0; a < Math.PI * 2 && !best; a += Math.PI / 8) {
          const x = p.x + Math.cos(a) * r;
          const z = p.z + Math.sin(a) * r;
          const clearOfResources = resources.every((n) => n.amount <= 0 || Math.hypot(n.x - x, n.z - z) > 9);
          const clearOfDecor = world.decorColliders.every(
            (b) => x < b.min[0] - 9 || x > b.max[0] + 9 || z < b.min[2] - 9 || z > b.max[2] + 9,
          );
          if (clearOfResources && clearOfDecor && Math.abs(x) < 60 && Math.abs(z) < 60) best = { x, z };
        }
      }
      return best;
    },
    storey: STOREY,
  };

  // Game loop.
  const timer = new THREE.Timer();
  let sendTimer = 0;
  let time = 0;
  gfx.renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.05);
    time += dt;
    controller.update(dt);
    me.root.position.copy(controller.position);
    me.root.rotation.y = controller.yaw + Math.PI;
    me.update(dt, controller.moving);
    controller.updateCamera(camera);

    for (const r of remotes.values()) {
      r.avatar.root.position.lerp(r.target, Math.min(1, dt * 12));
      r.avatar.root.rotation.y = r.state.yaw + Math.PI;
      r.avatar.update(dt, r.state.moving);
    }

    updateAim();
    updateGhost();
    hud.setTarget(describeTarget());

    sendTimer += dt;
    if (sendTimer > 1 / 15) {
      sendTimer = 0;
      const p = controller.position;
      net.send({ t: 'move', x: p.x, y: p.y, z: p.z, yaw: controller.yaw, moving: controller.moving });
    }

    world.update(dt, controller.position, time);
    gfx.render();
  });
}
