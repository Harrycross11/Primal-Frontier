// Entry point: join screen, then the game loop (input, physics, networking, rendering).

import * as THREE from 'three';
import { BUILD_RANGE, GATHER_RANGE, PLAYER_HEIGHT, PLAYER_RADIUS } from '../../shared/constants.ts';
import type { PlayerState, ServerMessage } from '../../shared/protocol.ts';
import { terrainHeight } from '../../shared/terrain.ts';
import {
  BLOCK_COST,
  RESOURCE_INFO,
  cellInBounds,
  type BlockType,
  type Inventory,
  type ResourceNode,
} from '../../shared/world.ts';
import { Avatar } from './avatar.ts';
import { Controller } from './controller.ts';
import { Hud } from './hud.ts';
import { Net } from './net.ts';
import { World } from './world.ts';

const RESOURCE_NAMES = { tree: 'Living tree', deadTree: 'Dead tree', scrap: 'Scrap wreck' } as const;

interface Remote {
  state: PlayerState;
  avatar: Avatar;
  target: THREE.Vector3;
}

type Target =
  | { kind: 'resource'; node: ResourceNode; inRange: boolean }
  | { kind: 'block'; cell: { x: number; y: number; z: number }; place: Cell | null; inRange: boolean }
  | { kind: 'ground'; place: Cell | null; inRange: boolean }
  | null;
type Cell = { x: number; y: number; z: number };

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
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.getElementById('game')!.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 400);
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  const world = new World(welcome.seed);
  const resources = welcome.resources;
  world.addResources(resources);
  for (const b of welcome.blocks) world.setBlock(b);

  const me = new Avatar(welcome.you.color);
  world.scene.add(me.root);
  const controller = new Controller(world, () => resources, renderer.domElement);
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
  let selected: BlockType = 'wood';
  hud.setInventory(inventory);
  hud.setSelected(selected);
  hud.setPlayers([welcome.you.name, ...welcome.players.map((p) => p.name)]);
  const refreshPlayers = () => hud.setPlayers([welcome.you.name, ...[...remotes.values()].map((r) => r.state.name)]);

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
      case 'block':
        world.setBlock({ x: m.x, y: m.y, z: m.z, type: m.type } as never);
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

  // Input: click to capture the mouse, left click to gather or break, right click (or F) to place.
  const canvas = renderer.domElement;
  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas) return;
    if (e.button === 0) hit();
    if (e.button === 2) place();
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Digit1') selected = 'wood';
    if (e.code === 'Digit2') selected = 'scrap';
    if (e.code === 'Digit1' || e.code === 'Digit2') hud.setSelected(selected);
    if (e.code === 'KeyE') hit();
    if (e.code === 'KeyF') place();
    if (e.code === 'KeyH') hud.toggleHelp();
  });

  const raycaster = new THREE.Raycaster();
  let target: Target = null;

  function findTarget(): Target {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    raycaster.far = camera.position.distanceTo(controller.eye) + BUILD_RANGE + 1;
    const hits = raycaster.intersectObjects(world.pickables, true);
    for (const h of hits) {
      if (!h.object.visible || !isVisible(h.object)) continue;
      const rid = h.object.userData.resourceId as number | undefined;
      if (rid !== undefined) {
        const node = resources[rid];
        const reach = GATHER_RANGE + RESOURCE_INFO[node.kind].radius;
        return { kind: 'resource', node, inRange: Math.hypot(node.x - controller.position.x, node.z - controller.position.z) <= reach };
      }
      const normal = h.face?.normal.clone().transformDirection(h.object.matrixWorld) ?? new THREE.Vector3(0, 1, 0);
      if (h.object.userData.cell) {
        const cell = h.object.userData.cell as Cell;
        const place = { x: cell.x + Math.round(normal.x), y: cell.y + Math.round(normal.y), z: cell.z + Math.round(normal.z) };
        return { kind: 'block', cell, place: validPlace(place), inRange: inReach(cell) };
      }
      if (h.object === world.terrain) {
        const p = h.point;
        const place = { x: Math.floor(p.x), y: Math.floor(p.y + 0.05), z: Math.floor(p.z) };
        return { kind: 'ground', place: validPlace(place), inRange: inReach(place) };
      }
    }
    return null;
  }

  function isVisible(o: THREE.Object3D): boolean {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  function inReach(c: Cell): boolean {
    return controller.eye.distanceTo(new THREE.Vector3(c.x + 0.5, c.y + 0.5, c.z + 0.5)) <= BUILD_RANGE;
  }

  function validPlace(c: Cell): Cell | null {
    if (!cellInBounds(c.x, c.y, c.z) || world.hasBlock(c.x, c.y, c.z)) return null;
    const p = controller.position;
    const overlapsMe =
      p.x + PLAYER_RADIUS > c.x && p.x - PLAYER_RADIUS < c.x + 1 &&
      p.z + PLAYER_RADIUS > c.z && p.z - PLAYER_RADIUS < c.z + 1 &&
      p.y + PLAYER_HEIGHT > c.y && p.y < c.y + 1;
    return overlapsMe ? null : c;
  }

  function hit() {
    if (!target) return;
    if (target.kind === 'resource') {
      if (!target.inRange) return hud.notice('Get closer to gather');
      net.send({ t: 'gather', id: target.node.id });
      me.swing();
    } else if (target.kind === 'block') {
      if (!target.inRange) return hud.notice('Too far away');
      net.send({ t: 'break', ...target.cell });
      me.swing();
    }
  }

  function place() {
    if (!target || target.kind === 'resource' || !target.place) return;
    if (!inReach(target.place)) return hud.notice('Too far away');
    const cost = BLOCK_COST[selected];
    if (inventory[cost.material] < cost.amount) return hud.notice(`Need ${cost.amount} ${cost.material}`);
    net.send({ t: 'place', ...target.place, block: selected });
    me.swing();
  }

  // Placement preview.
  const ghost = new THREE.Mesh(
    new THREE.BoxGeometry(1.02, 1.02, 1.02),
    new THREE.MeshBasicMaterial({ color: 0x7cff6b, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  ghost.visible = false;
  world.scene.add(ghost);

  // Test hooks for the automated smoke test (scripts/smoke.ts).
  (window as unknown as { __pf: unknown }).__pf = {
    state: () => ({
      id: welcome.id,
      others: remotes.size,
      inventory,
      blocks: world.blockMeshes.size,
      position: controller.position.toArray(),
    }),
    walkTo: (x: number, z: number) => (controller.autoWalk = { x, z }),
    nearestResource: (kind: string) =>
      resources
        .filter((r) => r.kind === kind && r.amount > 0)
        .sort((a, b) => dist(a) - dist(b))[0],
    gather: (id: number) => net.send({ t: 'gather', id }),
    place: (x: number, y: number, z: number, block: BlockType) => net.send({ t: 'place', x, y, z, block }),
    groundCellNear: (dx: number, dz: number) => {
      const x = Math.floor(controller.position.x + dx);
      const z = Math.floor(controller.position.z + dz);
      return { x, y: Math.floor(terrainHeight(welcome.seed, x + 0.5, z + 0.5) + 0.05), z };
    },
  };
  const dist = (r: ResourceNode) => Math.hypot(r.x - controller.position.x, r.z - controller.position.z);

  // Game loop.
  const clock = new THREE.Clock();
  let sendTimer = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
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

    target = findTarget();
    hud.setTarget(describe(target, selected, inventory));
    const showGhost = !!target && target.kind !== 'resource' && !!target.place && inReach(target.place);
    ghost.visible = showGhost;
    if (showGhost && target && target.kind !== 'resource' && target.place) {
      ghost.position.set(target.place.x + 0.5, target.place.y + 0.5, target.place.z + 0.5);
      const cost = BLOCK_COST[selected];
      (ghost.material as THREE.MeshBasicMaterial).color.set(inventory[cost.material] >= cost.amount ? 0x7cff6b : 0xff5a36);
    }

    sendTimer += dt;
    if (sendTimer > 1 / 15) {
      sendTimer = 0;
      const p = controller.position;
      net.send({ t: 'move', x: p.x, y: p.y, z: p.z, yaw: controller.yaw, moving: controller.moving });
    }

    world.update(dt, controller.position);
    renderer.render(world.scene, camera);
  });
}

function describe(t: Target, selected: BlockType, inv: Inventory): string {
  if (!t) return '';
  if (t.kind === 'resource') {
    const info = RESOURCE_INFO[t.node.kind];
    const label = `${RESOURCE_NAMES[t.node.kind]}: ${t.node.amount} ${info.material} left`;
    return t.inRange ? `${label}  ·  Left click to gather` : `${label}  ·  Get closer`;
  }
  const cost = BLOCK_COST[selected];
  const canAfford = inv[cost.material] >= cost.amount;
  const placeHint = t.place && t.inRange ? (canAfford ? 'Right click to build' : `Need ${cost.amount} ${cost.material} to build`) : '';
  if (t.kind === 'block') return [t.inRange ? 'Left click to break' : 'Too far', placeHint].filter(Boolean).join('  ·  ');
  return placeHint;
}
