// Entry point: join screen, then the game loop (input, physics, networking, rendering).

import * as THREE from 'three';
import './atmosphere.ts';
import { BUILD_RANGE, GATHER_RANGE } from '../../shared/constants.ts';
import {
  DOOR_HP,
  DOOR_KINDS,
  MAX_HP,
  PIECE_COST,
  STOREY,
  WALL_EDITS,
  pieceBounds,
  pieceKey,
  pieceSupported,
  type DoorKind,
  type Piece,
  type PieceKind,
  PIECE_KINDS,
} from '../../shared/building.ts';
import { CHARGE_KINDS, CRATE_KINDS, DEPLOYABLE_INFO, DEPLOYABLE_KINDS, WORKBENCH_LEVEL, deployableBox, privilege, type Deployable, type DeployableKind } from '../../shared/deployables.ts';
import { PLANT_RANGE, isExplosive, type ExplosiveId } from '../../shared/explosives.ts';
import { BIOMES, biomeAt } from '../../shared/biomes.ts';
import { FIST, rayPlayer, type Vec3 } from '../../shared/combat.ts';
import { ASHHOUND, MOUNT_RANGE, SPECIES } from '../../shared/creatures.ts';
import { ITEMS, countItem, itemTotals, type ItemId, type Slots } from '../../shared/items.ts';
import type { PlayerState, ServerMessage, SlotRef } from '../../shared/protocol.ts';
import { atLandmark } from '../../shared/landmarks.ts';
import { terrainHeight } from '../../shared/terrain.ts';
import { MATERIALS, RESOURCE_INFO, generateDecor, type Material, type ResourceNode } from '../../shared/world.ts';
import { Avatar } from './avatar.ts';
import { distanceToBox, inReach, proposePiece, type AimHit } from './build.ts';
import { Controller } from './controller.ts';
import { Creatures } from './creatures.ts';
import { Vehicles } from './vehicles.ts';
import { VEHICLES, VEHICLE_KINDS, VEHICLE_RANGE, axes, touchesVehicle, type VehicleKind } from '../../shared/vehicles.ts';
import { DayNight, type Fire } from './daynight.ts';
import { Graphics, QUALITIES } from './graphics.ts';
import { Hud } from './hud.ts';
import { Lobby, carStyle, renderObjectives, timeLeft } from './lobby.ts';
import { PaintPanel, type PaintTarget } from './paintPanel.ts';
import { PauseMenu } from './pauseMenu.ts';
import { PAINTS, paintOwned } from '../../shared/paint.ts';
import { PACKS } from '../../shared/shop.ts';
import { LookPicker } from './lookPicker.ts';
import { MenuStage } from './menuStage.ts';
import { loadModels } from './models.ts';
import { Effects, type Surface } from './effects.ts';
import { iconSvg } from './icons.ts';
import { InventoryUi } from './inventory.ts';
import { Net } from './net.ts';
import { buildCharge, buildDeployable, buildPlane, buildSignal } from './props.ts';
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
const PIECE_NAMES: Record<PieceKind, string> = { foundation: 'Foundation', wall: 'Wall', floor: 'Floor', stairs: 'Stairs', ramp: 'Ramp', roof: 'Roof' };
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
const SURVIVAL_DEATHS = {
  starvation: 'You starved to death.',
  thirst: 'You died of thirst.',
  radiation: 'Radiation poisoning killed you.',
  ashhound: 'An Ashhound pack tore you apart.',
  explosion: 'You were caught in an explosion.',
} as const;
const SURVIVAL_FEED = {
  starvation: 'starved',
  thirst: 'died of thirst',
  radiation: 'died of radiation poisoning',
  ashhound: 'was killed by Ashhounds',
  explosion: 'blew up',
} as const;
/** Seconds before a sleeping bag can be woken up in again (the server holds the real timer). */
const BAG_COOLDOWN = 60;

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
const picker = new LookPicker();
const lobby = new Lobby();
/** The live world behind the main menu, built once the server says which world it is. */
let stage: MenuStage | null = null;
let staging = false;
picker.onChange = (look) => stage?.setLook(look);

// The main menu talks to the server before you play: your coins, objectives and the store.
let net = new Net();
const lobbyMessages = (m: ServerMessage) => {
  if (m.t === 'lobby') {
    lobby.update(m.account, m.online, m.max, m.wipeIn);
    if (!staging) {
      staging = true;
      const { seed, now } = m;
      modelsReady.then(() => {
        try {
          stage = new MenuStage(seed, now, picker.look, lobby.car);
          lobby.attach(stage);
          (window as unknown as { __menu: MenuStage }).__menu = stage;
        } catch (e) {
          // No WebGL, say: the menu still works over a plain background.
          console.warn('menu stage failed', e);
        }
      });
    }
  }
  if (m.t === 'notice') lobby.toast(m.text);
};
net.onMessage = lobbyMessages;
lobby.onBuy = (pack) => net.send({ t: 'buy', pack, token: survivorToken() });
net
  .opened()
  .then(() => net.send({ t: 'hello', token: survivorToken() }))
  .catch(() => lobby.update(null));
// Keep the server count and objectives fresh while the menu is open.
const lobbyTimer = setInterval(() => net.send({ t: 'hello', token: survivorToken() }), 20000);

hud.onPlay(async (name) => {
  try {
    await net.opened();
  } catch {
    // The menu's connection dropped: try a fresh one.
    net = new Net();
    net.onMessage = lobbyMessages;
    try {
      await net.opened();
    } catch (e) {
      hud.showJoinError((e as Error).message);
      return;
    }
  }
  net.send({ t: 'join', name, look: picker.look, token: survivorToken() });
  const welcome = await new Promise<Extract<ServerMessage, { t: 'welcome' } | { t: 'full' }>>((resolve) => {
    net.onMessage = (m) => {
      if (m.t === 'welcome' || m.t === 'full') resolve(m);
      else lobbyMessages(m);
    };
  });
  if (welcome.t === 'full') {
    hud.showJoinError('This server is full (8 players). Try again later.');
    // The server closes a full connection; the menu needs a new one.
    net = new Net();
    net.onMessage = lobbyMessages;
    return;
  }
  clearInterval(lobbyTimer);
  await modelsReady;
  hud.hideJoin();
  // The menu's world is the one being joined, so the game carries on in it.
  const ready = stage?.seed === welcome.seed ? stage.handOver(welcome.now) : null;
  if (!ready) stage?.dispose();
  stage = null;
  startGame(net, welcome, ready);
});

function startGame(net: Net, welcome: Extract<ServerMessage, { t: 'welcome' }>, ready: ReturnType<MenuStage['handOver']> | null) {
  const world = ready?.world ?? new World(welcome.seed);
  const gfx = ready?.gfx ?? new Graphics(document.getElementById('game')!, world.scene);
  const camera = gfx.camera;
  hud.setQuality(gfx.quality);

  const resources = welcome.resources;
  if (ready) {
    // The menu drew the world as freshly generated; bring it in line with the server's.
    const live = new Set(resources.map((r) => r.id));
    for (const id of world.resourceMeshes.keys()) if (!live.has(id)) world.setResourceAmount(id, 0);
    const fresh = resources.filter((r) => !world.resourceMeshes.has(r.id));
    world.addResources(fresh);
    // Only the used-up ones and the water barrels differ from fresh (setting the rest would bounce them).
    for (const r of resources) if (r.amount <= 0 || world.resourceMeshes.get(r.id)?.userData.keep) world.setResourceAmount(r.id, r.amount);
  } else world.addResources(resources);
  for (const p of welcome.pieces) world.setPiece(pieceKey(p), p);
  for (const d of welcome.deployables) world.setDeployable(d.id, d);

  const dayNight = ready?.dayNight ?? new DayNight(world, gfx, welcome.seed, welcome.now);
  world.serverNow = () => dayNight.now;
  const clock = document.getElementById('clock')!;
  let clockIn = 0;
  /** Everything burning that could light the dark: torches in hand and lit furnaces. */
  const fires = (): Fire[] => {
    const out: Fire[] = [];
    const own = dead ? null : me.flamePosition();
    if (own) out.push({ at: own, strength: 1 });
    for (const r of remotes.values()) {
      const at = r.avatar.flamePosition();
      if (at) out.push({ at, strength: 1 });
    }
    for (const d of world.deployables.values()) {
      if (d.kind === 'furnace' && d.on) out.push({ at: new THREE.Vector3(d.x, d.y + 0.9, d.z), strength: 0.7 });
    }
    return out;
  };

  const effects = new Effects(world.scene);
  effects.listener = camera;
  effects.startAmbience();
  const creatures = new Creatures(world.scene, effects);
  const vehicles = new Vehicles(world.scene, effects, welcome.seed);
  vehicles.sync(welcome.vehicles);
  const map = new WorldMap(welcome.seed, generateDecor(welcome.seed));
  const mapMarks = () => ({
    x: controller.position.x,
    z: controller.position.z,
    yaw: controller.yaw,
    hounds: [...creatures.views.values()].filter((v) => v.state.owner === welcome.you.id && v.state.anim !== 'dead').map((v) => v.root.position),
    drops: [...world.deployables.values()].filter((d) => d.kind === 'supplyDrop'),
    cars: [...vehicles.views.values()].map((v) => v.root.position),
    mates: mates().map((r) => ({ x: r.avatar.root.position.x, z: r.avatar.root.position.z, name: r.state.name })),
  });
  creatures.sync(welcome.creatures);
  const me = new Avatar(welcome.you.color, undefined, welcome.you.look);
  world.scene.add(me.root);
  const canvas = gfx.renderer.domElement;
  const controller = new Controller(world, () => resources, canvas);
  controller.teleport(welcome.you.x, welcome.you.y, welcome.you.z);
  me.onStep = (sprint) => effects.footstep(surfaceUnder(controller.position), null, sprint);
  controller.onLand = (speed) => effects.landSound(surfaceUnder(controller.position), speed);
  controller.onCrash = (speed) => effects.crash(controller.position.clone(), speed);
  controller.vehicles = () => vehicles.solid();

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
  /** Everyone on your team (you too, online or not), and who on it is online. */
  let teamIds: number[] = welcome.team;
  const mates = () => [...remotes.values()].filter((r) => teamIds.includes(r.state.id));
  const addRemote = (p: PlayerState) => {
    if (remotes.has(p.id) || p.id === welcome.id) return;
    const avatar = new Avatar(p.color, p.name, p.look);
    avatar.root.position.set(p.x, p.y, p.z);
    avatar.onStep = (sprint) => effects.footstep(surfaceUnder(avatar.root.position), avatar.root.position, sprint);
    world.scene.add(avatar.root);
    remotes.set(p.id, { state: p, avatar, target: new THREE.Vector3(p.x, p.y, p.z) });
    if (teamIds.includes(p.id)) avatar.setTag(p.name, p.color, true);
  };
  welcome.players.forEach(addRemote);
  /** Who last asked you onto their team. */
  let invitedBy: string | null = null;

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
  /** When each of your sleeping bags can next be woken up in (performance.now ms). */
  const bagReadyAt = new Map<number, number>();
  const baseFov = camera.fov;

  // Inventory and what is in your hands.
  let slots: Slots = welcome.slots;
  let pieceKind: PieceKind = 'wall';
  let material: Material = 'wood';
  /** The paint new building pieces go up in. */
  let buildPaint = 0;
  const paintPanel = new PaintPanel();
  paintPanel.onClose = () => canvas.requestPointerLock?.();
  paintPanel.onLocked = (pack) => hud.notice(`That comes in the ${PACKS.find((p) => p.id === pack)?.name}: get it in the store on the main menu`, 3);
  // Coins, store packs and today's objectives.
  let account = welcome.account ?? null;
  paintPanel.owned = account?.packs ?? [];
  const pause = new PauseMenu();
  pause.setAccount(account);
  pause.quality = gfx.quality;
  pause.onResume = () => {
    pause.hide();
    canvas.requestPointerLock?.();
  };
  pause.onOpen = () => net.send({ t: 'getAccount' });
  pause.onQuality = (q) => {
    gfx.setQuality(q);
    hud.setQuality(gfx.quality);
  };
  // Letting go of the mouse (Esc) in the middle of play brings up the menu.
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === canvas) return pause.hide();
    if (!ui.open && !paintPanel.isOpen && !hud.codeOpen && !dead) pause.showMenu();
  });
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
  const refreshPlayers = () =>
    hud.setPlayers([welcome.you.name, ...[...remotes.values()].map((r) => (teamIds.includes(r.state.id) ? `${r.state.name} (team)` : r.state.name))]);
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
        vehicles.sync(m.vehicles);
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
        const kind = (m.d ?? old)?.kind;
        if (kind && kind !== 'lootBag' && kind !== 'supplySignal' && !CHARGE_KINDS.includes(kind) && !CRATE_KINDS.includes(kind)) deployableEffects(old ?? null, m.d);
        if (!old && (m.d?.kind === 'beancan' || m.d?.kind === 'supplySignal')) {
          // The grenade or signal flies there from the thrower's hand before it shows where it landed.
          const thrower = m.by === welcome.id ? me : remotes.get(m.by)?.avatar;
          const mesh = world.deployableMeshes.get(m.id);
          if (thrower && mesh) {
            mesh.visible = false;
            const from = thrower.root.position.clone().setY(thrower.root.position.y + 1.6);
            const flying = m.d.kind === 'beancan' ? buildCharge('beancan', true) : buildSignal(true);
            effects.toss(flying, from, new THREE.Vector3(m.d.x, m.d.y, m.d.z), () => (mesh.visible = true));
          }
        }
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
      case 'driving': {
        driving = m.id;
        const view = m.id === null ? undefined : vehicles.views.get(m.id);
        // Swapped for another model from the driver's seat.
        if (view && m.kind) view.sync({ ...view.state, kind: m.kind });
        const info = view ? VEHICLES[view.state.kind] : undefined;
        controller.car = view && info ? { ...info, fuel: () => vehicles.views.get(view.state.id)?.state.fuel ?? 0 } : null;
        controller.carSpeed = 0;
        if (!controller.car) driving = null;
        controller.yaw = m.yaw;
        controller.teleport(m.x, m.y, m.z);
        vehicles.mine = driving;
        if (driving !== null) hud.notice(view!.state.fuel > 0 ? 'W and S to drive, A and D to steer, E to get out' : 'The tank is empty: fill it with low grade fuel', 4);
        break;
      }
      case 'mounted': {
        riding = m.id;
        const view = m.id === null ? undefined : creatures.views.get(m.id);
        const ride = view ? SPECIES[view.species].ride : undefined;
        controller.mount = ride ?? null;
        if (m.id === null || !ride) riding = null;
        controller.teleport(m.x, m.y + (ride?.seat ?? 0), m.z);
        creatures.mine = riding;
        if (riding !== null) hud.notice('E to get off, Shift to gallop');
        break;
      }
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
          hud.hideDeath();
        }
        break;
      case 'died': {
        dead = true;
        triggerHeld = aiming = false;
        // Thrown off whatever you were riding or driving.
        riding = driving = vehicles.mine = creatures.mine = null;
        controller.mount = controller.car = null;
        me.setDead(true);
        ui.hide();
        document.exitPointerLock?.();
        const how = m.item ? ` with a ${ITEMS[m.item].name}` : '';
        const bags = [...world.deployables.values()]
          .filter((d) => d.kind === 'sleepingBag' && d.owner === welcome.id)
          .map((d, n) => ({
            id: d.id,
            label: `sleeping bag ${n + 1} (${BIOMES[biomeAt(world.seed, d.x, d.z)].name}, ${Math.round(Math.hypot(d.x - controller.position.x, d.z - controller.position.z))} m away)`,
            wait: () => Math.max(0, Math.ceil(((bagReadyAt.get(d.id) ?? 0) - performance.now()) / 1000)),
          }));
        hud.showDeath(
          m.by ? `${m.by} killed you${how}.` : m.cause ? SURVIVAL_DEATHS[m.cause] : 'You died.',
          () => net.send({ t: 'respawn' }),
          bags,
          (bag) => {
            net.send({ t: 'respawn', bag });
            bagReadyAt.set(bag, performance.now() + BAG_COOLDOWN * 1000);
          },
        );
        break;
      }
      case 'notice':
        hud.notice(m.text);
        break;
      case 'account':
        account = m.account;
        paintPanel.owned = account.packs;
        pause.setAccount(account);
        break;
      case 'objectiveDone':
        hud.objectiveDone(m.label, m.reward);
        effects.objective();
        break;
      case 'plane': {
        const from = new THREE.Vector3(m.from[0], m.y, m.from[1]);
        const to = new THREE.Vector3(m.to[0], m.y, m.to[1]);
        effects.plane(buildPlane(), from, to, m.speed, Math.max(0, (dayNight.now - m.start) / 1000));
        break;
      }
      case 'explosion': {
        const at = new THREE.Vector3(...m.at);
        effects.explosion(at, m.item, terrainHeight(world.seed, at.x, at.z));
        break;
      }
      case 'team': {
        const was = teamIds;
        teamIds = m.members.length ? m.members : [welcome.id];
        for (const r of remotes.values()) {
          if (was.includes(r.state.id) !== teamIds.includes(r.state.id)) r.avatar.setTag(r.state.name, r.state.color, teamIds.includes(r.state.id));
        }
        refreshPlayers();
        break;
      }
      case 'invited':
        invitedBy = m.from;
        hud.notice(`${m.from} invited you to their team. Press Y to join`, 8);
        break;
      case 'codeNeeded':
        hud.askCode('This door is locked. Enter its code', (code) => {
          if (code) net.send({ t: 'code', key: m.key, code });
          canvas.requestPointerLock?.();
        });
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
    const was = old?.door;
    const now = piece?.door;
    if (old && piece && (was || now)) {
      const metal = (now ?? was)!.kind === 'metalDoor';
      const doorAt = new THREE.Vector3(at.x, b.min[1] + 1.1, at.z);
      if (!was && now) return effects.buildSound(metal ? 'scrap' : 'wood', doorAt);
      if (was && !now) {
        effects.breakSound(metal ? 'scrap' : 'wood', doorAt);
        effects.chipsAt(doorAt, metal ? 'scrap' : 'wood', b.min[1], 18, 1.4);
        return;
      }
      if (was && now && was.open !== now.open) return effects.doorSound(now.open, metal, doorAt);
      if (was && now && now.hp < was.hp) {
        effects.gatherSound(metal ? 'scrap' : 'wood', doorAt);
        effects.chipsAt(doorAt, metal ? 'scrap' : 'wood', b.min[1], 6);
        return;
      }
      if (was && now && was.locked !== now.locked) return effects.uiSound('click');
    }
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
    if (hud.codeOpen) return;
    if (pause.open) {
      if (e.code === 'Escape') pause.onResume();
      return;
    }
    if (paintPanel.isOpen) {
      if (e.code === 'Escape' || e.code === 'KeyP') paintPanel.close();
      return;
    }
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
    if (e.code === 'KeyP') openPaint();
    if (e.code === 'KeyT') {
      if (!aimPlayer) hud.notice('Look at someone to invite them to your team');
      else if (teamIds.includes(aimPlayer.state.id)) hud.notice(`${aimPlayer.state.name} is on your team`);
      else net.send({ t: 'invite', id: aimPlayer.state.id });
    }
    if (e.code === 'KeyY') {
      if (!invitedBy) hud.notice('No team invite to answer');
      else net.send({ t: 'acceptInvite' });
      invitedBy = null;
    }
    if (e.code === 'KeyL') {
      if (teamIds.length < 2) hud.notice("You aren't on a team");
      else net.send({ t: 'leaveTeam' });
    }
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
  /** The animal you are riding, if you are. */
  let riding: number | null = null;
  /** The car you are driving, if you are. */
  let driving: number | null = null;
  /** A car under the crosshair. */
  let aimVehicle: ReturnType<Vehicles['ray']> = null;
  let aimSurface: { point: THREE.Vector3; y: number } | null = null;
  /** The face the crosshair is on (world space), and whether it is a door rather than its wall. */
  let aimNormal: THREE.Vector3 | null = null;
  let aimDoor = false;
  let proposal: Piece | null = null;

  function updateAim() {
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    raycaster.far = camera.position.distanceTo(controller.eye) + 10;
    aim = null;
    aimResource = null;
    aimDeployable = null;
    aimSurface = null;
    aimNormal = null;
    aimDoor = false;
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
      aimDoor = !!h.object.userData.door && !!piece?.door;
      if (h.face) aimNormal = h.face.normal.clone().transformDirection(h.object.matrixWorld);
      // Somewhere a workbench, furnace or box could stand: open ground or the top of a floor.
      if (h.object.name === 'terrain') aimSurface = { point: h.point.clone(), y: terrainHeight(world.seed, h.point.x, h.point.z) };
      else if ((piece?.kind === 'floor' || piece?.kind === 'foundation') && Math.abs(h.point.y - piece.y) < 0.05) aimSurface = { point: h.point.clone(), y: piece.y };
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
      best = aimHound.t;
    }
    aimVehicle = vehicles.ray([o.x, o.y, o.z], [d.x, d.y, d.z], best);
    if (aimVehicle) {
      aimPlayer = null;
      aimHound = null;
      aimResource = null;
      aimDeployable = null;
      aim = null;
    }
  }

  function isVisible(o: THREE.Object3D): boolean {
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  /** Close enough to an animal to feed it (or, with `range`, to climb on). */
  function houndInReach(at: THREE.Vector3, range: number = ASHHOUND.feedRange) {
    const length = aimHound ? SPECIES[aimHound.view.species].length : 1.5;
    return Math.hypot(at.x - controller.position.x, at.z - controller.position.z) - length / 2 + 0.75 < range;
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
    if (item === 'feedSack') {
      net.send({ t: 'use', slot: ui.active });
      return me.swing();
    }
    if (item && (ITEMS[item].heal || ITEMS[item].consume)) {
      net.send({ t: 'use', slot: ui.active });
      me.swing();
      const c = ITEMS[item].consume;
      // Held out to an animal rather than eaten.
      if (item === 'cookedMeat' && aimHound && SPECIES[aimHound.view.species].food === item && houndInReach(aimHound.view.root.position)) return;
      if (c) effects.consumeSound(c.rads ? 'pills' : c.food ? 'eat' : 'drink', null);
      return;
    }
    if (item && isExplosive(item)) return useExplosive(item);
    if (item === 'supplySignal') return throwHeld();
    if (item === 'lowGradeFuel') {
      if (!aimVehicle) return hud.notice('Aim at a car to fill it up');
      if (!carInReach(aimVehicle.view.state)) return hud.notice('Get closer to fill it up');
      net.send({ t: 'refuel', id: aimVehicle.view.state.id, slot: ui.active });
      return me.swing();
    }
    if (item && DOOR_KINDS.includes(item as DoorKind)) {
      const p = aim?.piece;
      if (p?.kind !== 'wall' || p.edit !== 'door') return hud.notice('Aim at a doorway: press G on a wall to make one');
      if (p.door) return hud.notice('There is already a door here');
      if (!inReach(controller.eye, p)) return hud.notice('Too far away');
      net.send({ t: 'hangDoor', key: pieceKey(p), slot: ui.active });
      me.swing();
      return;
    }
    if (item === 'codeLock') {
      const p = aim?.piece;
      if (!p?.door) return hud.notice('Aim at a door to fit the lock');
      if (p.door.locked) return hud.notice('This door already has a lock');
      const slot = ui.active;
      return hud.askCode('Pick a 4-digit code for this door', (code) => {
        if (code) net.send({ t: 'lock', key: pieceKey(p), slot, code });
        canvas.requestPointerLock?.();
      });
    }
    if ((aimPlayer || aimHound || aimVehicle) && item !== 'buildingPlan' && !DEPLOYABLE_KINDS.includes(item as DeployableKind)) return melee();
    if (item === 'buildingPlan') {
      if (!proposal) return;
      if (countItem(slots, material) < PIECE_COST) return hud.notice(`Need ${PIECE_COST} ${ITEMS[material].name.toLowerCase()}`);
      net.send({ t: 'place', kind: proposal.kind, i: proposal.i, y: proposal.y, k: proposal.k, dir: proposal.dir, material, ...(buildPaint && { paint: buildPaint }) });
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

  /** Lobs the beancan or supply signal in your hands a little above where you look. */
  function throwHeld() {
    const now = performance.now();
    if (now - lastAttack < 800) return;
    lastAttack = now;
    const look = new THREE.Vector3();
    camera.getWorldDirection(look);
    look.y += 0.18;
    look.normalize();
    net.send({ t: 'throw', slot: ui.active, d: [look.x, look.y, look.z] });
    me.swing();
    effects.swingSound(false, null);
  }

  /** Throws a beancan, or sticks a satchel or C4 to whatever the crosshair is on. */
  function useExplosive(item: ExplosiveId) {
    const now = performance.now();
    if (now - lastAttack < 800) return;
    if (item === 'beancan') return throwHeld();
    const spot = plantSpot(item);
    if (!spot) return hud.notice('Get closer to a wall, a door or the ground to stick it on');
    lastAttack = now;
    net.send({ t: 'plant', slot: ui.active, at: spot, ...(aim?.piece && { key: pieceKey(aim.piece), door: aimDoor }) });
    me.swing();
  }

  /** Where a satchel or C4 would sit on the surface under the crosshair, if it is close enough. */
  function plantSpot(item: 'satchel' | 'c4'): Vec3 | null {
    if (!aim || !aimNormal || aim.point.distanceTo(controller.eye) > PLANT_RANGE) return null;
    const [, h, depth] = DEPLOYABLE_INFO[item].size;
    const p = aim.point.clone();
    // Stood up on a floor or the ground; against a wall or door, its back to the surface.
    if (aimNormal.y > 0.7) p.y += h / 2;
    else p.addScaledVector(aimNormal, depth / 2 + 0.01);
    return [p.x, p.y, p.z];
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
      net.send({ t: 'hit', key: pieceKey(aim.piece), ...(aimDoor && { door: true }) });
      me.swing();
    } else melee();
  }

  /** E: open a furnace, box or door, authorise yourself on a tool cupboard, or pick a hemp plant. */
  /** Close enough to a car to get in or fill it up. */
  function carInReach(v: { kind: keyof typeof VEHICLES; x: number; z: number; yaw: number }) {
    const view = vehicles.views.get((v as { id?: number }).id ?? -1);
    const at = view ? { ...v, x: view.root.position.x, z: view.root.position.z, yaw: view.root.rotation.y } : v;
    return touchesVehicle({ ...at, id: 0, y: 0, hp: 1, fuel: 0, paint: 0 }, controller.position.x, controller.position.z, VEHICLE_RANGE - VEHICLES[v.kind].width / 2 - 0.2);
  }

  function interact() {
    if (driving !== null) return net.send({ t: 'drive', id: null });
    if (riding !== null) return net.send({ t: 'ride', id: null });
    if (aimVehicle) {
      const s = aimVehicle.view.state;
      if (s.driver !== undefined) return hud.notice('Someone is driving it');
      if (!carInReach(s)) return hud.notice('Get closer to get in');
      return net.send({ t: 'drive', id: s.id });
    }
    const animal = aimHound?.view;
    if (animal && animal.state.owner === welcome.id && SPECIES[animal.species].ride && animal.state.anim !== 'dead') {
      if (!houndInReach(animal.root.position, MOUNT_RANGE)) return hud.notice('Get closer to climb on');
      return net.send({ t: 'ride', id: animal.state.id });
    }
    if (aimDeployable?.kind === 'toolCupboard') {
      if (!deployableInRange(aimDeployable, OPEN_RANGE)) return hud.notice('Get closer to the tool cupboard');
      if (aimDeployable.auth?.includes(welcome.id)) return hud.notice('You are already authorised here. G clears everyone else');
      return net.send({ t: 'authorize', id: aimDeployable.id });
    }
    if (aim?.piece?.door) {
      if (!inReach(controller.eye, aim.piece)) return hud.notice('Too far away');
      return net.send({ t: 'door', key: pieceKey(aim.piece) });
    }
    if (aimDeployable && aimDeployable.slots.length > 0) {
      if (!deployableInRange(aimDeployable, OPEN_RANGE)) return hud.notice('Get closer to open it');
      if (falling(aimDeployable)) return hud.notice("Wait for it to land");
      return openScreen(aimDeployable);
    }
    if (aimResource && RESOURCE_INFO[aimResource.kind].tool === 'pickup' && resourceInRange(aimResource)) {
      net.send({ t: 'gather', id: aimResource.id, slot: ui.active });
      me.swing();
    }
  }

  function editTarget() {
    if (aimDeployable?.kind === 'toolCupboard') {
      if (!deployableInRange(aimDeployable, OPEN_RANGE)) return hud.notice('Get closer to the tool cupboard');
      return net.send({ t: 'clearAuth', id: aimDeployable.id });
    }
    const piece = aim?.piece;
    if (!piece || piece.kind !== 'wall') return hud.notice('Look at a wall to edit it');
    if (!inReach(controller.eye, piece)) return hud.notice('Too far away');
    const next = WALL_EDITS[(WALL_EDITS.indexOf(piece.edit) + 1) % WALL_EDITS.length];
    net.send({ t: 'edit', key: pieceKey(piece), edit: next });
  }

  /**
   * P: paint whatever is to hand. The car you drive or stand by (and its model), the building piece
   * you look at, the gun or tool in your hands, or with a building plan the pieces you place next.
   */
  function openPaint() {
    const targets: PaintTarget[] = [];
    const car = driving !== null ? vehicles.views.get(driving) : aimVehicle && carInReach(aimVehicle.view.state) && aimVehicle.view.state.driver === undefined ? aimVehicle.view : undefined;
    if (car) {
      const s = car.state;
      const style = carStyle();
      targets.push({
        label: VEHICLES[s.kind].name,
        paint: s.paint,
        model: s.kind,
        preset: paintOwned(style.paint, account?.packs ?? []) ? { label: `My style: ${PAINTS[style.paint].name} ${VEHICLES[style.kind].name}`, paint: style.paint, model: style.kind } : undefined,
        models: VEHICLE_KINDS.map((k) => ({ id: k, name: VEHICLES[k].name, blurb: VEHICLES[k].blurb })),
        apply: (paint, model) => {
          // Shown at once; the server's next update confirms it.
          car.sync({ ...car.state, paint, kind: (model ?? s.kind) as VehicleKind });
          net.send({ t: 'customiseCar', id: s.id, kind: (model ?? s.kind) as VehicleKind, paint });
        },
      });
    }
    const item = held();
    const stack = slots[ui.active];
    if (!car && stack && (ITEMS[stack.item].kind === 'weapon' || ITEMS[stack.item].kind === 'tool')) {
      const slot = ui.active;
      targets.push({ label: ITEMS[stack.item].name, paint: stack.paint ?? 0, apply: (paint) => net.send({ t: 'paintItem', slot, paint }) });
    }
    const piece = !car && aim?.piece && inReach(controller.eye, aim.piece) ? aim.piece : undefined;
    if (piece) {
      const key = pieceKey(piece);
      const name = `${ITEMS[piece.material].name} ${PIECE_NAMES[piece.kind].toLowerCase()}`;
      const entry: PaintTarget = {
        label: name,
        paint: piece.paint ?? 0,
        wholeBase: true,
        apply: (paint, _, all) => {
          if (item === 'buildingPlan') buildPaint = paint;
          net.send({ t: 'paintPiece', key, paint, ...(all && { all: true }) });
        },
      };
      // With a plan in hand the piece comes first; otherwise what you hold does.
      if (item === 'buildingPlan') targets.unshift(entry);
      else targets.push(entry);
    }
    if (item === 'buildingPlan') targets.push({ label: 'New pieces', paint: buildPaint, apply: (paint) => (buildPaint = paint) });
    if (!targets.length) return hud.notice('Get next to a car, look at a building piece, or hold a gun or tool to paint it');
    paintPanel.open(targets);
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
      const ok = countItem(slots, material) >= PIECE_COST && pieceSupported(world.seed, proposal, world.pieces.values()) && !blockedAt(pieceBounds(proposal));
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
    ghostMat.color.set(blockedAt(box) ? 0xff5a4a : 0x4fb3ff);
  }

  /** True inside the range of a tool cupboard that doesn't trust you, or on a landmark's ground. */
  function blockedAt(b: { min: number[]; max: number[] }): boolean {
    if (atLandmark(world.seed, (b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2, 4)) return true;
    return privilege(world.deployables.values(), (b.min[0] + b.max[0]) / 2, (b.min[2] + b.max[2]) / 2, teamIds) === 'blocked';
  }

  /** A supply drop still under its parachute. */
  function falling(d: Deployable): boolean {
    return !!d.fall && dayNight.now < d.fall.land;
  }

  function describeTarget(): { text: string; health?: number } {
    const item = held();
    const mine = driving === null ? undefined : vehicles.views.get(driving);
    if (mine) {
      const s = mine.state;
      const info = VEHICLES[s.kind];
      const kmh = Math.round(Math.abs(controller.carSpeed) * 3.6);
      const fuel = s.fuel > 0 ? `Fuel ${Math.ceil(s.fuel)}/${info.tank}` : 'Out of fuel: get out and fill it with low grade fuel';
      return { text: `${info.name}  ·  ${kmh} km/h  ·  ${fuel}  ·  E to get out  ·  P to paint`, health: s.hp / info.maxHp };
    }
    if (aimVehicle) {
      const s = aimVehicle.view.state;
      const info = VEHICLES[s.kind];
      const fuel = `fuel ${Math.ceil(s.fuel)}/${info.tank}`;
      const how = item === 'lowGradeFuel' ? 'Left click to fill it up' : s.driver !== undefined ? 'Someone is driving' : carInReach(s) ? 'E to drive  ·  P to paint or swap model' : 'Get closer to get in';
      return { text: `${info.name} (${fuel})  ·  ${how}`, health: s.hp / info.maxHp };
    }
    if (item && isExplosive(item) && item !== 'beancan') {
      const spot = plantSpot(item);
      if (!aimPlayer && !aimHound) return { text: spot ? `${ITEMS[item].name}  ·  Left click to stick it here` : `${ITEMS[item].name}  ·  Get close to a wall or door` };
    }
    if (item === 'beancan' && !aimPlayer && !aimHound) return { text: 'Beancan Grenade  ·  Left click to throw' };
    if (item === 'supplySignal' && !aimPlayer && !aimHound) return { text: 'Supply Signal  ·  Left click to throw it and call the plane' };
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
    if (aimPlayer) {
      const s = aimPlayer.state;
      return { text: teamIds.includes(s.id) ? `${s.name} (your team)` : `${s.name}  ·  T to invite to your team` };
    }
    if (aimHound) {
      const s = aimHound.view.state;
      const text = creatures.describe(aimHound.view, welcome.id, item, houndInReach(aimHound.view.root.position));
      return s.anim === 'dead' ? { text } : { text, health: s.hp };
    }
    if (aimDeployable) {
      const d = aimDeployable;
      if (d.kind === 'lootBag') return { text: `${d.label ?? 'Someone'}'s loot bag  ·  E to open` };
      if (CRATE_KINDS.includes(d.kind)) return { text: `${DEPLOYABLE_INFO[d.kind].name}  ·  ${falling(d) ? 'Still coming down' : 'E to open'}` };
      if (d.kind === 'supplySignal') return { text: 'Supply Signal  ·  The plane is on its way' };
      if (CHARGE_KINDS.includes(d.kind)) return { text: `${DEPLOYABLE_INFO[d.kind].name}  ·  About to blow: get away!` };
      const mine = d.owner === welcome.id;
      if (d.kind === 'toolCupboard') {
        const trusted = d.auth?.includes(welcome.id);
        const who = d.auth?.length ?? 0;
        const hints = trusted
          ? [`You are authorised (${who} ${who === 1 ? 'person' : 'people'})`, 'G to clear everyone else']
          : ['E to authorise yourself and build here'];
        if (mine) hints.push('Hit to pick up');
        return { text: ['Tool Cupboard', ...hints].join('  ·  '), health: d.hp / DEPLOYABLE_INFO[d.kind].hp };
      }
      if (d.kind === 'sleepingBag') {
        const text = mine ? 'Your sleeping bag  ·  You can wake up here  ·  Hit to pick up' : 'Sleeping bag  ·  Hit to break it';
        return { text, health: d.hp / DEPLOYABLE_INFO[d.kind].hp };
      }
      const bench = WORKBENCH_LEVEL[d.kind];
      const hints = [d.slots.length > 0 ? 'E to open' : bench ? `Unlocks level ${bench} recipes nearby` : '', 'Hit to pick up'];
      const name = d.kind === 'furnace' && d.on ? 'Furnace (burning)' : DEPLOYABLE_INFO[d.kind].name;
      return { text: [name, ...hints].filter(Boolean).join('  ·  '), health: d.hp / DEPLOYABLE_INFO[d.kind].hp };
    }
    if (aim?.piece?.door && (aimDoor || item === 'codeLock')) {
      const door = aim.piece.door;
      const name = `${ITEMS[door.kind].name}${door.locked ? ' (locked)' : ''}`;
      const hints = [item === 'codeLock' && !door.locked ? 'Left click to fit the lock' : `E to ${door.open ? 'close' : 'open'}`, 'Left click to hit'];
      return { text: [name, ...hints].join('  ·  '), health: door.hp / DOOR_HP[door.kind] };
    }
    if (item && DOOR_KINDS.includes(item as DoorKind) && aim?.piece?.kind === 'wall') {
      const p = aim.piece;
      return { text: p.edit !== 'door' ? 'Make a doorway first: press G on the wall' : p.door ? 'There is already a door here' : 'Doorway  ·  Left click to hang the door' };
    }
    if (item === 'buildingPlan' && proposal && blockedAt(pieceBounds(proposal))) return { text: "Building blocked: someone else's tool cupboard is near" };
    if (aim?.piece && (item !== 'buildingPlan' || aim.piece.kind === 'wall')) {
      const p = aim.piece;
      const name = `${ITEMS[p.material].name} ${p.kind === 'wall' && p.edit !== 'solid' ? `${p.edit === 'half' ? 'half wall' : p.edit}` : PIECE_NAMES[p.kind].toLowerCase()}`;
      const hints = [item !== 'buildingPlan' ? 'Left click to hit' : '', p.kind === 'wall' ? 'G to edit' : '', p.door ? `E to ${p.door.open ? 'close' : 'open'} the door` : ''].filter(Boolean);
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
    const paint = buildPaint ? ` · ${PAINTS[buildPaint].name} paint` : '';
    const html = `<b>${PIECE_NAMES[pieceKind]}</b> · ${ITEMS[material].name} (${countItem(slots, material)}, ${PIECE_COST} each)${paint}<br/><small>Right click: foundation, wall, floor, stairs, ramp, roof · R: wood, stone, scrap · P: paint</small>`;
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
    paint: () => openPaint(),
    pause: () => pause.showMenu(),
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
      net.send({ t: 'place', kind, i, y, k, dir, material: mat, ...(buildPaint && { paint: buildPaint }) });
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
    /** Holds the clock supply drops fall by at a server time (ms), or lets it run again, for screenshots. */
    clockAt: (ms: number | null) => (world.serverNow = ms === null ? () => dayNight.now : () => ms),
    /** Flies a supply plane over, `elapsed` seconds into its crossing, for screenshots. */
    showPlane: (from: number[], to: number[], speed: number, elapsed: number) =>
      effects.plane(buildPlane(), new THREE.Vector3().fromArray(from), new THREE.Vector3().fromArray(to), speed, elapsed),
    /** Climbs on one of your animals, or gets off with null. */
    ride: (id: number | null) => net.send({ t: 'ride', id }),
    /** Handles a message as if the server sent it: the screenshot browser is too slow to hear the real one in time. */
    receive: (m: ServerMessage) => net.onMessage(m),
    /** The nearest car's state. */
    cars: () => [...vehicles.views.values()].map((v) => v.state).sort((a, b) => Math.hypot(a.x - controller.position.x, a.z - controller.position.z) - Math.hypot(b.x - controller.position.x, b.z - controller.position.z))[0],
    /** Throws what is in your hands. */
    throwHeld: () => throwHeld(),
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
    /** Sets the time of day (0 is sunrise, 0.75 sunset) and holds the weather, for screenshots. */
    sky: (phase: number | null, weather?: { rain: number; dust: number; snow: number } | null) => {
      dayNight.held = phase;
      if (weather !== undefined) dayNight.forced = weather;
    },
    /** Sends any message to the server as this player, for tests and screenshots. */
    send: (m: Parameters<Net['send']>[0]) => net.send(m),
    /** What the crosshair is on: a piece key, a door, a deployable, and where. */
    aimInfo: () => ({ key: aim?.piece ? pieceKey(aim.piece) : null, door: aimDoor, deployable: aimDeployable?.id ?? null, point: aim?.point.toArray() ?? null }),
    storey: STOREY,
    iconUrl: (item: ItemId) => itemIconUrl(item),
  };

  // Game loop.
  const timer = new THREE.Timer();
  let sendTimer = 0;
  let time = 0;
  let chargeIn = 0;
  let smokeIn = 0;
  gfx.renderer.setAnimationLoop((now) => {
    timer.update(now);
    // The first frame's timestamp can come from before the timer started; never step backwards.
    const dt = Math.max(0, Math.min(timer.getDelta(), 0.05));
    time += dt;
    if (!dead) controller.update(dt);
    me.root.position.copy(controller.position);
    me.root.rotation.y = controller.yaw + Math.PI;
    me.seated = riding !== null || driving !== null;
    // Your own car goes where you drive it at once, rather than waiting on the server.
    const car = driving === null ? undefined : vehicles.views.get(driving);
    if (car && controller.car) {
      const { fx, fz, rx, rz } = axes(controller.yaw);
      const s = controller.car.seat;
      car.carry(controller.position.x - fx * s.ahead + rx * s.left, controller.position.z - fz * s.ahead + rz * s.left, controller.yaw, controller.carSpeed);
    }
    // Your own mount goes where you steer it at once, rather than waiting on the server.
    const mount = riding === null ? undefined : creatures.views.get(riding);
    if (mount) mount.carry(controller.position.x, controller.position.y - (controller.mount?.seat ?? 0), controller.position.z, controller.yaw + Math.PI);
    me.setHeld(dead ? null : held(), dead ? 0 : (slots[ui.active]?.paint ?? 0));
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
    if (hound) fixedView = { from: hound.root.position.clone().add(new THREE.Vector3().fromArray(watched!.offset)).toArray(), to: hound.root.position.clone().setY(hound.root.position.y + SPECIES[hound.species].height * 0.6).toArray() };
    if (fixedView) {
      camera.position.fromArray(fixedView.from);
      camera.lookAt(new THREE.Vector3().fromArray(fixedView.to));
    }

    // A nearby blast shakes the view.
    if (effects.shake > 0.01) {
      const k = effects.shake * 0.09;
      camera.position.add(new THREE.Vector3((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k));
      effects.shake *= Math.exp(-dt * 5);
    }
    // Supply signals pour out red smoke, and so does a supply drop for a while after it lands.
    smokeIn -= dt;
    if (smokeIn <= 0) {
      smokeIn = 0.16;
      for (const d of world.deployables.values()) {
        const now = world.serverNow();
        const landed = d.kind === 'supplyDrop' && d.fall && now > d.fall.land && now < d.fall.land + 90_000;
        if (d.kind === 'supplySignal' || landed) effects.redSmoke(new THREE.Vector3(d.x, d.y + (landed ? 1.4 : 0.2), d.z));
      }
    }
    // Lit charges beep or hiss.
    chargeIn -= dt;
    if (chargeIn <= 0) {
      chargeIn = 0.9;
      for (const d of world.deployables.values()) if (CHARGE_KINDS.includes(d.kind)) effects.chargeSound(d.kind as ExplosiveId, new THREE.Vector3(d.x, d.y, d.z));
    }

    for (const r of remotes.values()) {
      r.avatar.root.position.lerp(r.target, Math.min(1, dt * 12));
      r.avatar.root.rotation.y = r.state.yaw + Math.PI;
      r.avatar.setHeld(r.state.held, r.state.heldPaint ?? 0);
      r.avatar.setDead(r.state.dead);
      r.avatar.setWear(r.state.wear ?? []);
      r.avatar.seated = r.state.riding !== undefined || r.state.driving !== undefined;
      r.avatar.update(dt, r.state.moving && !r.avatar.seated);
    }
    creatures.update(dt);
    vehicles.update(dt);

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
    dayNight.update(dt, controller.position, camera, fires());
    if (performance.now() > clockIn) {
      clockIn = performance.now() + 1000;
      clock.textContent = dayNight.label();
      const w = dayNight.storm;
      effects.setWeather(w.rain, w.dust, w.snow);
    }
    map.update(dt, mapMarks());
    gfx.render();
  });
}
