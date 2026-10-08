// Entry point: join screen, then the game loop (input, physics, networking, rendering).

import * as THREE from 'three';
import './atmosphere.ts';
import { BUILD_RANGE, GATHER_RANGE } from '../../shared/constants.ts';
import {
  MAX_HP,
  PIECE_COST,
  STOREY,
  WALL_EDITS,
  pieceBounds,
  pieceKey,
  pieceSupported,
  type Piece,
  type PieceKind,
} from '../../shared/building.ts';
import { DEPLOYABLE_INFO, DEPLOYABLE_KINDS, WORKBENCH_LEVEL, deployableBox, type Deployable, type DeployableKind } from '../../shared/deployables.ts';
import { FIST, rayPlayer, type Vec3 } from '../../shared/combat.ts';
import { ASHHOUND } from '../../shared/creatures.ts';
import { ITEMS, countItem, itemTotals, type ItemId, type Slots } from '../../shared/items.ts';
import type { PlayerState, ServerMessage, SlotRef } from '../../shared/protocol.ts';
import { terrainHeight } from '../../shared/terrain.ts';
import { MATERIALS, RESOURCE_INFO, generateDecor, type Material, type ResourceNode } from '../../shared/world.ts';
import { Avatar } from './avatar.ts';
import { distanceToBox, inReach, proposePiece, type AimHit } from './build.ts';
import { Controller } from './controller.ts';
import { Creatures } from './creatures.ts';
import { Graphics, QUALITIES } from './graphics.ts';
import { Hud } from './hud.ts';
import { LookPicker } from './lookPicker.ts';
import { loadModels } from './models.ts';
import { Effects, type Surface } from './effects.ts';
import { iconSvg } from './icons.ts';
import { InventoryUi } from './inventory.ts';
import { Net } from './net.ts';
import { buildDeployable } from './props.ts';
import { WorldMap } from './map.ts';
import { World, buildPieceMesh } from './world.ts';
import { itemIconUrl } from './itemIcons.ts';

const RESOURCE_NAMES = {
  tree: 'Living tree',
  deadTree: 'Dead tree',
  scrap: 'Scrap wreck',
  stone: 'Stone boulder',
  metalOre: 'Metal ore',
  sulfurOre: 'Sulfur ore',
  hqmOre: 'High quality metal ore',
  hemp: 'Hemp',
  mushroom: 'Mushrooms',
  waterBarrel: 'Rain barrel',
} as const;
const PIECE_NAMES: Record<PieceKind, string> = { wall: 'Wall', floor: 'Floor', stairs: 'Stairs' };
const PIECE_KINDS: PieceKind[] = ['wall', 'floor', 'stairs'];
const SCOPED: ItemId[] = ['boltRifle', 'l96', 'svd', 'm82'];
/** How close you must be to open a furnace or box (the server allows a little more). */
const OPEN_RANGE = 3;
/** What each resource sounds like and sheds when hit. */
const RESOURCE_SURFACE: Record<ResourceNode['kind'], Surface> = {
  tree: 'wood',
  deadTree: 'wood',
  scrap: 'scrap',
  stone: 'stone',
  metalOre: 'ore',
  sulfurOre: 'ore',
  hqmOre: 'ore',
  hemp: 'hemp',
  mushroom: 'hemp',
  waterBarrel: 'dirt',
};
const SURVIVAL_DEATHS = { starvation: 'You starved to death.', thirst: 'You died of thirst.', radiation: 'Radiation poisoning killed you.', ashhound: 'An Ashhound pack tore you apart.' } as const;
const SURVIVAL_FEED = { starvation: 'starved', thirst: 'died of thirst', radiation: 'died of radiation poisoning', ashhound: 'was killed by Ashhounds' } as const;

interface Remote {
  state: PlayerState;
  avatar: Avatar;
  target: THREE.Vector3;
}

const hud = new Hud();

/** A private random id kept in this browser, so the server gives back your survivor next time. */
function survivorToken(): string | undefined {
  try {
    let token = localStorage.getItem('pf-token');
    if (!token) localStorage.setItem('pf-token', (token = crypto.randomUUID()));
    return token;
  } catch {
    return undefined;
  }
}

// Start loading the scanned models straight away; joining waits for them.
const modelsReady = loadModels((done, total) => hud.setLoading(done, total));
const picker = new LookPicker(modelsReady);

hud.onPlay(async (name) => {
  const net = new Net();
  try {
    await net.opened();
  } catch (e) {
    hud.showJoinError((e as Error).message);
    return;
  }
  net.send({ t: 'join', name, look: picker.look, token: survivorToken() });
  const welcome = await new Promise<Extract<ServerMessage, { t: 'welcome' } | { t: 'full' }>>((resolve) => {
    net.onMessage = (m) => {
      if (m.t === 'welcome' || m.t === 'full') resolve(m);
    };
  });
  if (welcome.t === 'full') {
    hud.showJoinError('This server is full (8 players). Try again later.');
    return;
  }
  await modelsReady;
  picker.dispose();
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
  for (const d of welcome.deployables) world.setDeployable(d.id, d);

  const effects = new Effects(world.scene);
  effects.listener = camera;
  effects.startAmbience();
  const creatures = new Creatures(world.scene, effects);
  const map = new WorldMap(welcome.seed, generateDecor(welcome.seed));
  const mapMarks = () => ({
    x: controller.position.x,
    z: controller.position.z,
    yaw: controller.yaw,
    hounds: [...creatures.views.values()].filter((v) => v.state.owner === welcome.you.id && v.state.anim !== 'dead').map((v) => v.root.position),
  });
  creatures.sync(welcome.creatures);
  const me = new Avatar(welcome.you.color, undefined, welcome.you.look);
  world.scene.add(me.root);
  const canvas = gfx.renderer.domElement;
  const controller = new Controller(world, () => resources, canvas);
  controller.teleport(welcome.you.x, welcome.you.y, welcome.you.z);
  me.onStep = (sprint) => effects.footstep(surfaceUnder(controller.position), null, sprint);
  controller.onLand = (speed) => effects.landSound(surfaceUnder(controller.position), speed);

  /** What a survivor is standing on: a floor or stairs of some material, or the bare ground. */
  function surfaceUnder(p: THREE.Vector3): Surface {
    if (p.y - terrainHeight(world.seed, p.x, p.z) < 0.15) return 'dirt';
    let best: Piece | null = null;
    for (const piece of world.pieces.values()) {
      if (piece.kind === 'wall') continue;
      const b = pieceBounds(piece);
      if (p.x >= b.min[0] && p.x <= b.max[0] && p.z >= b.min[2] && p.z <= b.max[2] && Math.abs(p.y - b.max[1]) < 3.2) best = piece;
    }
    return best ? best.material : 'dirt';
  }

  const remotes = new Map<number, Remote>();
  const addRemote = (p: PlayerState) => {
    if (remotes.has(p.id) || p.id === welcome.id) return;
    const avatar = new Avatar(p.color, p.name, p.look);
    avatar.root.position.set(p.x, p.y, p.z);
    avatar.onStep = (sprint) => effects.footstep(surfaceUnder(avatar.root.position), avatar.root.position, sprint);
    world.scene.add(avatar.root);
    remotes.set(p.id, { state: p, avatar, target: new THREE.Vector3(p.x, p.y, p.z) });
  };
  welcome.players.forEach(addRemote);

  // Health and combat.
  let hp = welcome.hp;
  let dead = false;
  hud.setHealth(hp);
  let vitals = { ...welcome.vitals, level: 0 };
  hud.setVitals(vitals);
  /** Left button held, for automatic guns. */
  let triggerHeld = false;
  /** Right button held with a gun: aiming down sights. */
  let aiming = false;
  let lastAttack = 0;
  let reloadingUntil = 0;
  const baseFov = camera.fov;

  // Inventory and what is in your hands.
  let slots: Slots = welcome.slots;
  let pieceKind: PieceKind = 'wall';
  let material: Material = 'wood';
  const held = (): ItemId | null => slots[ui.active]?.item ?? null;
  const ui = new InventoryUi({
    move: (from, to, count) => {
      effects.uiSound('move');
      net.send({ t: 'moveItem', from, to, count });
    },
    craft: (item, count) => {
      effects.uiSound('click');
      net.send({ t: 'craft', item, count });
    },
    cancel: (index) => {
      effects.uiSound('click');
      net.send({ t: 'cancelCraft', index });
    },
    furnace: (id, on) => {
      effects.uiSound('click');
      net.send({ t: 'furnace', id, on });
    },
  });
  ui.slots = slots;
  ui.wear = welcome.wear;
  ui.render();
  const refreshPlayers = () => hud.setPlayers([welcome.you.name, ...[...remotes.values()].map((r) => r.state.name)]);
  refreshPlayers();

  const sendMove = () => {
    const p = controller.position;
    net.send({ t: 'move', x: p.x, y: p.y, z: p.z, yaw: controller.yaw, moving: controller.moving, slot: ui.active });
  };

  net.onMessage = (m) => {
    switch (m.t) {
      case 'state':
        for (const p of m.players) {
          const r = remotes.get(p.id);
          if (!r) continue;
          r.state = p;
          r.target.set(p.x, p.y, p.z);
        }
        creatures.sync(m.creatures);
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
      case 'resource': {
        const node = resources[m.id];
        const was = node.amount;
        node.amount = m.amount;
        world.setResourceAmount(m.id, m.amount);
        if (m.by !== undefined && m.amount < was) {
          // Chips fly off the side facing whoever hit it.
          const who = m.by === welcome.id ? controller.position : remotes.get(m.by)?.avatar.root.position;
          const at = new THREE.Vector3(node.x, node.y + (node.kind === 'tree' || node.kind === 'deadTree' ? 1.1 : 0.6), node.z);
          if (who) at.add(new THREE.Vector3(who.x - node.x, 0, who.z - node.z).setLength(RESOURCE_INFO[node.kind].radius * node.scale * 0.9));
          const surface = RESOURCE_SURFACE[node.kind];
          if (node.kind === 'waterBarrel') effects.consumeSound('drink', at);
          else {
            const tool = m.by === welcome.id ? held() : (remotes.get(m.by)?.avatar.heldItem ?? null);
            effects.gatherSound(surface, at, m.amount === 0, tool);
            effects.chipsAt(at, surface, node.y, m.amount === 0 ? 16 : 7, m.amount === 0 ? 1.5 : 1);
          }
          if (m.by !== welcome.id) remotes.get(m.by)?.avatar.swing();
        }
        break;
      }
      case 'inventory': {
        // "+6 Wood" for whatever arrived.
        const before = itemTotals(slots);
        const after = itemTotals(m.slots);
        for (const [item, n] of Object.entries(after) as [ItemId, number][]) {
          const gained = n - (before[item] ?? 0);
          if (gained > 0) hud.pickup(iconSvg(item), ITEMS[item].name, gained);
        }
        slots = m.slots;
        ui.slots = slots;
        ui.wear = m.wear;
        ui.render();
        break;
      }
      case 'crafting':
        ui.setQueue(m.queue);
        break;
      case 'crafted':
        effects.craftedSound();
        break;
      case 'vitals':
        vitals = m;
        hud.setVitals(m);
        break;
      case 'piece': {
        const old = world.pieces.get(m.key);
        world.setPiece(m.key, m.piece);
        pieceEffects(old ?? null, m.piece);
        if (m.by !== welcome.id) remotes.get(m.by)?.avatar.swing();
        break;
      }
      case 'deployable': {
        const old = world.deployables.get(m.id);
        world.setDeployable(m.id, m.d);
        if (m.d?.kind !== 'lootBag' && old?.kind !== 'lootBag') deployableEffects(old ?? null, m.d);
        if (ui.container?.id === m.id) {
          if (m.d) {
            ui.container = m.d;
            ui.render();
          } else ui.hide();
        }
        if (m.by !== welcome.id) remotes.get(m.by)?.avatar.swing();
        break;
      }
      case 'correct':
        controller.teleport(m.x, m.y, m.z);
        break;
      case 'shot': {
        const shooter = m.by === welcome.id ? me : remotes.get(m.by)?.avatar;
        const muzzle = shooter ? shooter.muzzlePosition() : new THREE.Vector3(...m.from);
        effects.shot(muzzle, m.ends.map((e) => new THREE.Vector3(...e)), m.item);
        if (shooter && shooter !== me) {
          shooter.recoil();
          effects.muzzle(muzzle, m.item);
          effects.sound(m.item, muzzle.distanceTo(controller.position), panOf(muzzle));
        }
        break;
      }
      case 'hitmarker':
        hud.hitmarker(m.head);
        effects.hitSound(m.head, m.kill, m.armour);
        break;
      case 'health':
        // Flash red for a real hit; hunger, thirst and radiation chip away more quietly.
        if (m.hp < hp && (m.from || hp - m.hp >= 3)) {
          hud.hurt();
          if (m.from) {
            effects.hurtSound(!!m.armour);
            // Which way the hit came from, relative to where the camera faces.
            const to = new THREE.Vector3(m.from[0] - controller.position.x, 0, m.from[2] - controller.position.z);
            const ahead = new THREE.Vector3(-Math.sin(controller.yaw), 0, -Math.cos(controller.yaw));
            const angle = Math.atan2(ahead.x * to.z - ahead.z * to.x, ahead.x * to.x + ahead.z * to.z);
            hud.damageFrom(angle);
          }
        }
        hp = m.hp;
        hud.setHealth(hp);
        if (dead && hp > 0) {
          dead = false;
          me.setDead(false);
        }
        break;
      case 'died': {
        dead = true;
        triggerHeld = aiming = false;
        me.setDead(true);
        ui.hide();
        document.exitPointerLock?.();
        const how = m.item ? ` with a ${ITEMS[m.item].name}` : '';
        hud.showDeath(m.by ? `${m.by} killed you${how}.` : m.cause ? SURVIVAL_DEATHS[m.cause] : 'You died.', () => net.send({ t: 'respawn' }));
        break;
      }
      case 'notice':
        hud.notice(m.text);
        break;
      case 'kill': {
        const mine = m.killer === welcome.you.name || m.victim === welcome.you.name;
        hud.killFeed(m.killer, m.victim, m.item ? ITEMS[m.item].name : null, m.head, mine, m.cause ? SURVIVAL_FEED[m.cause] : null);
        break;
      }
    }
  };
  net.onClose = () => hud.disconnected();

  /** Sounds, dust and chips for a building piece going up, taking a hit or breaking. */
  function pieceEffects(old: Piece | null, piece: Piece | null) {
    const p = piece ?? old;
    if (!p) return;
    const b = pieceBounds(p);
    const at = new THREE.Vector3((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    const surface: Surface = p.material;
    if (!old && piece) {
      effects.buildSound(piece.material, at);
      world.popPiece(pieceKey(piece));
      effects.puff(new THREE.Vector3(at.x, b.min[1] + 0.1, at.z), 1.6);
    } else if (old && !piece) {
      effects.breakSound(old.material, at);
      effects.chipsAt(at, surface, b.min[1], 22, 1.6);
      effects.puff(at, 2.4);
    } else if (old && piece && piece.hp < old.hp) {
      const hitAt = aim?.piece && pieceKey(aim.piece) === pieceKey(piece) ? aim.point : at;
      effects.gatherSound(surface, hitAt);
      effects.chipsAt(hitAt, surface, b.min[1], 6);
      world.popPiece(pieceKey(piece), 'shake');
    } else if (old && piece && piece.edit !== old.edit) {
      effects.buildSound(piece.material, at);
    }
  }

  /** The same for a workbench, furnace or box. */
  function deployableEffects(old: Deployable | null, d: Deployable | null) {
    const x = d ?? old;
    if (!x) return;
    const at = new THREE.Vector3(x.x, x.y + 0.5, x.z);
    const material = x.kind === 'furnace' ? 'stone' : 'wood';
    if (!old && d) effects.buildSound(material, at);
    else if (old && !d) {
      effects.breakSound(material, at);
      effects.chipsAt(at, material, x.y, 14, 1.3);
    } else if (old && d && d.hp < old.hp) {
      effects.gatherSound(material, at);
      effects.chipsAt(at, material, x.y, 5);
    }
  }

  // Input. Click captures the mouse. Left click uses what is in your hands: hit and gather
  // with tools, place with the building plan or a deployable. Tab opens the inventory.
  canvas.addEventListener('click', () => {
    effects.startAmbience();
    if (document.pointerLockElement !== canvas && !ui.open) canvas.requestPointerLock?.();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas || dead) return;
    if (e.button === 0) {
      triggerHeld = true;
      primary();
    }
    if (e.button === 2 && heldGun()) aiming = true;
    if (e.button === 2 && held() === 'buildingPlan') {
      pieceKind = PIECE_KINDS[(PIECE_KINDS.indexOf(pieceKind) + 1) % PIECE_KINDS.length];
    }
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas) triggerHeld = aiming = false;
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) triggerHeld = false;
    if (e.button === 2) aiming = false;
  });
  addEventListener('wheel', (e) => {
    if (document.pointerLockElement !== canvas) return;
    selectSlot((ui.active + (e.deltaY > 0 ? 1 : -1) + 6) % 6);
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'Tab' || e.code === 'KeyI') {
      e.preventDefault();
      return ui.open ? closeScreen() : openScreen(null);
    }
    if (e.code === 'Escape' && ui.open) return closeScreen();
    if (e.code === 'Escape' && map.open) return map.close();
    if (ui.open || dead) return;
    if (e.code === 'KeyM') map.toggle(mapMarks());
    const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(e.code);
    if (n >= 0) selectSlot(n);
    if (e.code === 'KeyR' && held() === 'buildingPlan') material = MATERIALS[(MATERIALS.indexOf(material) + 1) % MATERIALS.length];
    if (e.code === 'KeyR' && heldGun()) reload();
    if (e.code === 'KeyE') interact();
    if (e.code === 'KeyG') editTarget();
    if (e.code === 'KeyH') hud.toggleHelp();
    if (e.code === 'KeyO') {
      gfx.setQuality(QUALITIES[(QUALITIES.indexOf(gfx.quality) + 1) % QUALITIES.length]);
      hud.setQuality(gfx.quality);
    }
  });
  function selectSlot(n: number) {
    if (n !== ui.active) {
      aiming = false;
      reloadingUntil = 0;
    }
    ui.active = n;
    ui.render();
    sendMove();
  }
  function openScreen(container: Deployable | null) {
    ui.workbench = workbenchLevel();
    ui.show(container);
    document.exitPointerLock?.();
  }
  function closeScreen() {
    ui.hide();
    canvas.requestPointerLock?.();
  }
  function workbenchLevel() {
    const p = controller.position;
    let level = 0;
    for (const d of world.deployables.values()) {
      const l = WORKBENCH_LEVEL[d.kind] ?? 0;
      if (l > level && Math.hypot(d.x - p.x, d.z - p.z) <= 4 && Math.abs(d.y - p.y) < 3) level = l;
    }
    return level;
  }

  /** The bow or gun in your hands, if any. */
  function heldGun() {
    const item = held();
    const w = item ? ITEMS[item].weapon : undefined;
    return w && w.class !== 'melee' ? w : null;
  }

  /** Where the crosshair points, out to `range` metres: the first thing hit, or empty air. */
  function aimTarget(range: number): THREE.Vector3 {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(0, 0), camera);
    const o = ray.ray.origin;
    const d = ray.ray.direction;
    ray.far = range + camera.position.distanceTo(controller.eye);
    let t = ray.far;
    for (const h of ray.intersectObjects(world.pickables, true)) {
      if (!isVisible(h.object) || h.distance < camera.position.distanceTo(controller.eye) - 0.5) continue;
      t = h.distance;
      break;
    }
    for (const r of remotes.values()) {
      if (r.state.dead) continue;
      const hit = rayPlayer([o.x, o.y, o.z], [d.x, d.y, d.z], r.avatar.root.position, t);
      if (hit) t = hit.t;
    }
    const hound = creatures.ray([o.x, o.y, o.z], [d.x, d.y, d.z], t);
    if (hound) t = hound.t;
    return o.clone().addScaledVector(d, t);
  }

  /** Where a sound sits left to right of the camera, -1 to 1. */
  function panOf(at: THREE.Vector3): number {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const to = at.clone().sub(camera.position).normalize();
    return to.dot(right) * 0.8;
  }

  function dirTo(target: THREE.Vector3): Vec3 {
    const d = target.sub(controller.eye).normalize();
    return [d.x, d.y, d.z];
  }

  function fire() {
    const item = held();
    const w = heldGun();
    const stack = slots[ui.active];
    if (!item || !w || !stack) return;
    const now = performance.now();
    if (now < reloadingUntil || now - lastAttack < w.delay * 1000) return;
    if (!stack.ammo) {
      triggerHeld = false;
      if (countItem(slots, w.ammo!) === 0) effects.dryFire();
      return reload();
    }
    lastAttack = now;
    stack.ammo -= 1;
    ui.render();
    net.send({ t: 'fire', slot: ui.active, d: dirTo(aimTarget(w.range)), aim: aiming });
    // Kick the view up and a little to the side.
    const kick = (w.recoil ?? 0) * (aiming ? 0.6 : 1);
    controller.pitch = Math.min(1.1, controller.pitch + kick);
    controller.yaw += (Math.random() - 0.5) * kick * 0.6;
    me.recoil();
    effects.muzzle(me.muzzlePosition(), item);
    effects.sound(item, 0);
    if (!w.auto) triggerHeld = false;
  }

  function reload() {
    const w = heldGun();
    const stack = slots[ui.active];
    if (!w?.ammo || !w.mag || !stack) return;
    if (performance.now() < reloadingUntil || (stack.ammo ?? 0) >= w.mag) return;
    if (countItem(slots, w.ammo) === 0) return hud.notice(`No ${ITEMS[w.ammo].name.toLowerCase()}: craft some first`);
    net.send({ t: 'reload', slot: ui.active });
    reloadingUntil = performance.now() + (w.reload ?? 1) * 1000;
    me.reloadAnim(w.reload ?? 1);
    if (w.class === 'gun') effects.reloadSound(w.reload ?? 1);
  }

  /** Swing whatever is in your hands (or your fists) at whoever is in front of you. */
  function melee() {
    const item = held();
    const w = (item ? ITEMS[item].weapon : FIST) ?? FIST;
    const now = performance.now();
    if (now - lastAttack < w.delay * 1000) return;
    lastAttack = now;
    net.send({ t: 'melee', slot: ui.active, d: dirTo(aimTarget(w.range + 2)) });
    me.swing();
    effects.swingSound(w.damage > 40, item);
  }

  const raycaster = new THREE.Raycaster();
  let aim: AimHit | null = null;
  let aimResource: ResourceNode | null = null;
  let aimDeployable: Deployable | null = null;
  /** The survivor under the crosshair within a few metres, for melee. */
  let aimPlayer: Remote | null = null;
  /** Likewise an Ashhound, for melee and feeding. */
  let aimHound: ReturnType<Creatures['ray']> = null;
  let aimSurface: { point: THREE.Vector3; y: number } | null = null;
  let proposal: Piece | null = null;

  function updateAim() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    raycaster.far = camera.position.distanceTo(controller.eye) + 10;
    aim = null;
    aimResource = null;
    aimDeployable = null;
    aimSurface = null;
    for (const h of raycaster.intersectObjects(world.pickables, true)) {
      if (!isVisible(h.object)) continue;
      // Ignore things between the camera and the player's back.
      if (h.distance < camera.position.distanceTo(controller.eye) - 0.5) continue;
      const rid = h.object.userData.resourceId as number | undefined;
      if (rid !== undefined) aimResource = resources[rid];
      const did = h.object.userData.deployableId as number | undefined;
      if (did !== undefined) aimDeployable = world.deployables.get(did) ?? null;
      const key = h.object.userData.pieceKey as string | undefined;
      const piece = key ? (world.pieces.get(key) ?? null) : null;
      aim = { point: h.point.clone(), piece };
      // Somewhere a workbench, furnace or box could stand: open ground or the top of a floor.
      if (h.object.name === 'terrain') aimSurface = { point: h.point.clone(), y: terrainHeight(world.seed, h.point.x, h.point.z) };
      else if (piece?.kind === 'floor' && Math.abs(h.point.y - piece.y) < 0.05) aimSurface = { point: h.point.clone(), y: piece.y };
      break;
    }
    // A survivor in front of whatever else the crosshair is on.
    aimPlayer = null;
    const o = raycaster.ray.origin;
    const d = raycaster.ray.direction;
    let best = aim ? camera.position.distanceTo(aim.point) : raycaster.far;
    for (const r of remotes.values()) {
      if (r.state.dead) continue;
      const hit = rayPlayer([o.x, o.y, o.z], [d.x, d.y, d.z], r.avatar.root.position, best);
      if (hit) {
        best = hit.t;
        aimPlayer = r;
        aimResource = null;
        aimDeployable = null;
      }
    }
    aimHound = creatures.ray([o.x, o.y, o.z], [d.x, d.y, d.z], best);
    if (aimHound) {
      aimPlayer = null;
      aimResource = null;
      aimDeployable = null;
    }
  }

  function isVisible(o: THREE.Object3D): boolean {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  function houndInReach(at: THREE.Vector3) {
    return Math.hypot(at.x - controller.position.x, at.z - controller.position.z) < ASHHOUND.feedRange;
  }

  function resourceInRange(node: ResourceNode) {
    return Math.hypot(node.x - controller.position.x, node.z - controller.position.z) <= GATHER_RANGE + RESOURCE_INFO[node.kind].radius;
  }

  function deployableInRange(d: Deployable, range: number) {
    return distanceToBox(controller.eye, deployableBox(d)) <= range;
  }

  function primary() {
    const item = held();
    if (heldGun()) return fire();
    if (item && ITEMS[item].armour) return net.send({ t: 'use', slot: ui.active });
    if (item && (ITEMS[item].heal || ITEMS[item].consume)) {
      net.send({ t: 'use', slot: ui.active });
      me.swing();
      const c = ITEMS[item].consume;
      // Held out to a hound rather than eaten.
      if (item === 'cookedMeat' && aimHound && houndInReach(aimHound.view.root.position)) return;
      if (c) effects.consumeSound(c.rads ? 'pills' : c.food ? 'eat' : 'drink', null);
      return;
    }
    if ((aimPlayer || aimHound) && item !== 'buildingPlan' && !DEPLOYABLE_KINDS.includes(item as DeployableKind)) return melee();
    if (item === 'buildingPlan') {
      if (!proposal) return;
      if (countItem(slots, material) < PIECE_COST) return hud.notice(`Need ${PIECE_COST} ${ITEMS[material].name.toLowerCase()}`);
      net.send({ t: 'place', kind: proposal.kind, i: proposal.i, y: proposal.y, k: proposal.k, dir: proposal.dir, material });
      me.swing();
      return;
    }
    if (item && DEPLOYABLE_KINDS.includes(item as DeployableKind)) {
      if (!deployGhost.visible) return hud.notice('Aim at open ground or a floor nearby');
      const p = deployGhost.position;
      net.send({ t: 'deploy', slot: ui.active, x: p.x, y: p.y, z: p.z, rot: deployGhost.rotation.y });
      return;
    }
    hitTarget();
  }

  function hitTarget() {
    if (aimResource) {
      if (!resourceInRange(aimResource)) return hud.notice('Get closer to gather');
      net.send({ t: 'gather', id: aimResource.id, slot: ui.active });
      me.swing();
      effects.swingSound(false, held());
    } else if (aimDeployable) {
      if (!deployableInRange(aimDeployable, BUILD_RANGE)) return hud.notice('Too far away');
      net.send({ t: 'hitDeployable', id: aimDeployable.id });
      me.swing();
    } else if (aim?.piece) {
      if (!inReach(controller.eye, aim.piece)) return hud.notice('Too far away');
      net.send({ t: 'hit', key: pieceKey(aim.piece) });
      me.swing();
    } else melee();
  }

  /** E: open a furnace or box, or pick a hemp plant. */
  function interact() {
    if (aimDeployable && aimDeployable.slots.length > 0) {
      if (!deployableInRange(aimDeployable, OPEN_RANGE)) return hud.notice('Get closer to open it');
      return openScreen(aimDeployable);
    }
    if (aimResource && RESOURCE_INFO[aimResource.kind].tool === 'pickup' && resourceInRange(aimResource)) {
      net.send({ t: 'gather', id: aimResource.id, slot: ui.active });
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
  const ghostEdgeMat = new THREE.LineBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.9, depthWrite: false });
  let ghost: THREE.Group | null = null;
  let ghostKey = '';
  function updateGhost() {
    proposal = null;
    if (held() === 'buildingPlan') {
      const look = new THREE.Vector3();
      camera.getWorldDirection(look);
      proposal = proposePiece(world, pieceKind, material, aim, controller.eye, look, controller.position.y);
    }
    const key = proposal ? `${pieceKey(proposal)}:${material}` : '';
    if (key !== ghostKey) {
      if (ghost) world.scene.remove(ghost);
      ghost = proposal ? buildPieceMesh(proposal, ghostMat) : null;
      // Bright edges, so the outline reads against any background.
      for (const m of ghost?.children ?? []) {
        const mesh = m as THREE.Mesh;
        if (mesh.isMesh) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), ghostEdgeMat));
      }
      if (ghost) world.scene.add(ghost);
      ghostKey = key;
    }
    if (proposal) {
      const ok = countItem(slots, material) >= PIECE_COST && pieceSupported(world.seed, proposal, world.pieces.values());
      ghostMat.color.set(ok ? 0x4fb3ff : 0xff5a4a);
      ghostEdgeMat.color.set(ok ? 0xbfe6ff : 0xffb0a0);
      // A slow pulse, so the preview reads as a preview and not a built piece.
      ghostMat.opacity = 0.26 + 0.08 * Math.sin(performance.now() / 260);
    }
  }

  // The same kind of preview for a workbench, furnace or box in your hands.
  const deployGhost = new THREE.Group();
  deployGhost.visible = false;
  world.scene.add(deployGhost);
  let deployGhostKind: DeployableKind | null = null;
  function updateDeployGhost() {
    const item = held();
    const kind = item && DEPLOYABLE_KINDS.includes(item as DeployableKind) ? (item as DeployableKind) : null;
    if (kind !== deployGhostKind) {
      deployGhost.clear();
      if (kind) {
        const model = buildDeployable(kind);
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.material = ghostMat;
            m.castShadow = false;
          }
        });
        deployGhost.add(model);
      }
      deployGhostKind = kind;
    }
    deployGhost.visible = false;
    if (!kind || !aimSurface) return;
    const box = deployableBox({ kind, x: aimSurface.point.x, y: aimSurface.y, z: aimSurface.point.z, rot: controller.yaw });
    if (distanceToBox(controller.eye, box) > BUILD_RANGE) return;
    deployGhost.position.set(aimSurface.point.x, aimSurface.y, aimSurface.point.z);
    deployGhost.rotation.y = controller.yaw;
    deployGhost.visible = true;
    ghostMat.color.set(0x4fb3ff);
  }

  function describeTarget(): { text: string; health?: number } {
    const item = held();
    if (aimResource?.kind === 'waterBarrel') {
      const r = aimResource;
      if (r.amount <= 0) return { text: 'Rain barrel: dry, it will refill' };
      const label = `Rain barrel: ${Math.round((r.amount / RESOURCE_INFO.waterBarrel.amount) * 100)}% full`;
      return { text: resourceInRange(r) ? `${label}  ·  E to drink` : `${label}  ·  Get closer` };
    }
    if (aimResource && aimResource.amount > 0) {
      const info = RESOURCE_INFO[aimResource.kind];
      const label = `${RESOURCE_NAMES[aimResource.kind]}: ${aimResource.amount} ${ITEMS[info.yields].name.toLowerCase()}`;
      const how = info.tool === 'pickup' ? 'E to pick' : 'Left click to gather';
      return { text: resourceInRange(aimResource) ? `${label}  ·  ${how}` : `${label}  ·  Get closer` };
    }
    if (aimPlayer) return { text: aimPlayer.state.name };
    if (aimHound) {
      const s = aimHound.view.state;
      const text = creatures.describe(aimHound.view, welcome.id, item, houndInReach(aimHound.view.root.position));
      return s.anim === 'dead' ? { text } : { text, health: s.hp };
    }
    if (aimDeployable) {
      const d = aimDeployable;
      if (d.kind === 'lootBag') return { text: `${d.label ?? 'Someone'}'s loot bag  ·  E to open` };
      const bench = WORKBENCH_LEVEL[d.kind];
      const hints = [d.slots.length > 0 ? 'E to open' : bench ? `Unlocks level ${bench} recipes nearby` : '', 'Hit to pick up'];
      const name = d.kind === 'furnace' && d.on ? 'Furnace (burning)' : DEPLOYABLE_INFO[d.kind].name;
      return { text: [name, ...hints].filter(Boolean).join('  ·  '), health: d.hp / DEPLOYABLE_INFO[d.kind].hp };
    }
    if (aim?.piece && (item !== 'buildingPlan' || aim.piece.kind === 'wall')) {
      const p = aim.piece;
      const name = `${ITEMS[p.material].name} ${p.kind === 'wall' && p.edit !== 'solid' ? `${p.edit === 'half' ? 'half wall' : p.edit}` : PIECE_NAMES[p.kind].toLowerCase()}`;
      const hints = [item !== 'buildingPlan' ? 'Left click to hit' : '', p.kind === 'wall' ? 'G to edit' : ''].filter(Boolean);
      return { text: [name, ...hints].join('  ·  '), health: p.hp / MAX_HP[p.material] };
    }
    if (item === 'buildingPlan' && proposal && countItem(slots, material) < PIECE_COST) return { text: `Need ${PIECE_COST} ${ITEMS[material].name.toLowerCase()}` };
    return { text: '' };
  }

  const buildInfo = document.getElementById('build-info')!;
  function updateBuildInfo() {
    const show = held() === 'buildingPlan';
    buildInfo.hidden = !show;
    if (!show) return;
    const html = `<b>${PIECE_NAMES[pieceKind]}</b> · ${ITEMS[material].name} (${countItem(slots, material)}, ${PIECE_COST} each)<br/><small>Right click: wall, floor, stairs · R: wood, stone, scrap</small>`;
    if (buildInfo.innerHTML !== html) buildInfo.innerHTML = html;
  }

  // Test hooks for the automated smoke test (scripts/smoke.ts).
  const dist = (r: { x: number; z: number }) => Math.hypot(r.x - controller.position.x, r.z - controller.position.z);
  let portrait: { angle: number; distance: number } | null = null;
  let fixedView: { from: number[]; to: number[] } | null = null;
  let watched: { id: number; offset: number[] } | null = null;
  (window as unknown as { __pf: unknown }).__pf = {
    state: () => ({
      id: welcome.id,
      others: remotes.size,
      inventory: { wood: 0, stone: 0, scrap: 0, ...itemTotals(slots) },
      hp,
      dead,
      slots,
      active: ui.active,
      deployables: [...world.deployables.values()],
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
    /** Selects a belt slot holding this item, if there is one. */
    hold: (item: ItemId) => {
      const n = slots.findIndex((s, i) => i < 6 && s?.item === item);
      if (n >= 0) selectSlot(n);
      return n >= 0;
    },
    select: (n: number) => selectSlot(n),
    gather: (id: number) => {
      // Swing whatever tool is on the belt if your hands hold something else.
      const h = held();
      if (!h || !ITEMS[h].tool) {
        const n = slots.findIndex((s, i) => i < 6 && s && ITEMS[s.item].tool);
        if (n >= 0) selectSlot(n);
      }
      net.send({ t: 'gather', id, slot: ui.active });
    },
    place: (kind: PieceKind, i: number, y: number, k: number, dir: number, mat: Material) => {
      const n = slots.findIndex((s, i) => i < 6 && s?.item === 'buildingPlan');
      if (n >= 0) selectSlot(n);
      net.send({ t: 'place', kind, i, y, k, dir, material: mat });
    },
    craft: (item: ItemId, count = 1) => net.send({ t: 'craft', item, count }),
    /** Fires the gun in your hands at a point in the world. */
    shootAt: (x: number, y: number, z: number, aim = true) => {
      const w = heldGun();
      if (!w) return false;
      net.send({ t: 'fire', slot: ui.active, d: dirTo(new THREE.Vector3(x, y, z)), aim });
      me.recoil();
      effects.muzzle(me.muzzlePosition(), held()!);
      return true;
    },
    reload: () => net.send({ t: 'reload', slot: ui.active }),
    /** Uses (eats, feeds, applies) whatever is in your hands. */
    use: () => net.send({ t: 'use', slot: ui.active }),
    hounds: () => [...creatures.views.values()].map((v) => v.state),
    respawn: () => net.send({ t: 'respawn' }),
    aim: (on: boolean) => (aiming = on),
    deployAt: (item: DeployableKind, x: number, z: number, rot = 0) => {
      const n = slots.findIndex((s, i) => i < 6 && s?.item === item);
      if (n < 0) return false;
      selectSlot(n);
      net.send({ t: 'deploy', slot: n, x, y: terrainHeight(world.seed, x, z), z, rot });
      return true;
    },
    moveItem: (from: SlotRef, to: SlotRef, count?: number) => net.send({ t: 'moveItem', from, to, count }),
    furnace: (id: number, on: boolean) => net.send({ t: 'furnace', id, on }),
    openScreen: (id: number | null) => openScreen(id === null ? null : (world.deployables.get(id) ?? null)),
    closeScreen: () => ui.hide(),
    edit: (key: string, edit: Piece['edit']) => net.send({ t: 'edit', key, edit }),
    /** Points the camera at your own survivor from the front, for character screenshots. */
    portrait: (angle: number | null, distance = 2.6) => (portrait = angle === null ? null : { angle, distance }),
    /** Keeps the camera on a hound from an offset, for screenshots of them moving about. */
    watchHound: (id: number | null, offset: number[] = [2.6, 1.2, 1.6]) => (watched = id === null ? null : { id, offset }),
    /** Places the camera at a fixed spot looking at a target, for scenery screenshots. */
    view: (from: number[] | null, to: number[] = [0, 0, 0]) => (fixedView = from ? { from, to } : null),
    setQuality: (q: 'high' | 'low') => {
      gfx.setQuality(q);
      hud.setQuality(q);
    },
    /** Nearest open patch of ground with nothing to bump into, for building in tests. */
    findClearSpot: (clear = 9) => {
      const p = controller.position;
      let best: { x: number; z: number } | null = null;
      for (let r = 2; r < 60 && !best; r += 2) {
        for (let a = 0; a < Math.PI * 2 && !best; a += Math.PI / 8) {
          const x = p.x + Math.cos(a) * r;
          const z = p.z + Math.sin(a) * r;
          const clearOfResources = resources.every((n) => n.amount <= 0 || Math.hypot(n.x - x, n.z - z) > clear);
          const clearOfDecor = world.decorColliders.every(
            (b) => x < b.min[0] - clear || x > b.max[0] + clear || z < b.min[2] - clear || z > b.max[2] + clear,
          );
          if (clearOfResources && clearOfDecor && Math.abs(x) < 60 && Math.abs(z) < 60) best = { x, z };
        }
      }
      return best;
    },
    storey: STOREY,
    iconUrl: (item: ItemId) => itemIconUrl(item),
  };

  // Game loop.
  const timer = new THREE.Timer();
  let sendTimer = 0;
  let time = 0;
  gfx.renderer.setAnimationLoop((now) => {
    timer.update(now);
    // The first frame's timestamp can come from before the timer started; never step backwards.
    const dt = Math.max(0, Math.min(timer.getDelta(), 0.05));
    time += dt;
    if (!dead) controller.update(dt);
    me.root.position.copy(controller.position);
    me.root.rotation.y = controller.yaw + Math.PI;
    me.setHeld(dead ? null : held());
    me.setWear(ui.wear.map((s) => s?.item ?? null));
    me.aimPitch = controller.pitch;
    me.update(dt, controller.moving && !dead);
    // Aiming down sights: zoom in over the shoulder, or look through the scope.
    const gun = heldGun();
    const ads = aiming && !!gun && !dead;
    const scoped = ads && SCOPED.includes(held()!);
    const fov = ads ? baseFov / (scoped ? 4 : 1.4) : baseFov;
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov += (fov - camera.fov) * Math.min(1, dt * 14);
      camera.updateProjectionMatrix();
    }
    controller.sensitivity = camera.fov / baseFov;
    const throughScope = scoped && camera.fov < baseFov * 0.5;
    hud.setScope(throughScope);
    me.root.visible = !throughScope;
    controller.updateCamera(camera, ads ? 1 : 0, throughScope);
    if (triggerHeld && gun?.auto && !ui.open) fire();
    if (portrait) {
      const a = controller.yaw + Math.PI + portrait.angle;
      const p = controller.position;
      camera.position.set(p.x + Math.sin(a) * portrait.distance, p.y + 1.45, p.z + Math.cos(a) * portrait.distance);
      camera.lookAt(p.x, p.y + 1.05, p.z);
    }
    const hound = watched && creatures.views.get(watched.id);
    if (hound) fixedView = { from: hound.root.position.clone().add(new THREE.Vector3().fromArray(watched!.offset)).toArray(), to: hound.root.position.clone().setY(hound.root.position.y + 0.5).toArray() };
    if (fixedView) {
      camera.position.fromArray(fixedView.from);
      camera.lookAt(new THREE.Vector3().fromArray(fixedView.to));
    }

    for (const r of remotes.values()) {
      r.avatar.root.position.lerp(r.target, Math.min(1, dt * 12));
      r.avatar.root.rotation.y = r.state.yaw + Math.PI;
      r.avatar.setHeld(r.state.held);
      r.avatar.setDead(r.state.dead);
      r.avatar.setWear(r.state.wear ?? []);
      r.avatar.update(dt, r.state.moving);
    }
    creatures.update(dt);

    updateAim();
    updateGhost();
    updateDeployGhost();
    updateBuildInfo();
    ui.tick();
    effects.update(dt);
    effects.geiger(dead ? 0 : vitals.level, dt);
    hud.setTarget(dead ? { text: '' } : describeTarget());
    const stack = slots[ui.active];
    hud.setAmmo(
      gun?.ammo && stack
        ? { loaded: stack.ammo ?? 0, mag: gun.mag ?? 0, carried: countItem(slots, gun.ammo), name: ITEMS[gun.ammo].name, reloading: performance.now() < reloadingUntil }
        : null,
    );

    sendTimer += dt;
    if (sendTimer > 1 / 15) {
      sendTimer = 0;
      if (!dead) sendMove();
    }

    world.update(dt, controller.position, time);
    map.update(dt, mapMarks());
    gfx.render();
  });
}
