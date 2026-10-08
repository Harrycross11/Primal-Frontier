// Local player: keyboard and mouse input, physics against terrain, scenery and building
// pieces (including walking up stairs), and an over-the-shoulder third-person camera.

import * as THREE from 'three';
import {
  GRAVITY,
  HALF_WORLD,
  JUMP_SPEED,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PLAYER_SPRINT,
} from '../../shared/constants.ts';
import { isSlope, pieceBoxes, stairsHeight, type Box } from '../../shared/building.ts';
import { deployableBox } from '../../shared/deployables.ts';
import { terrainHeight } from '../../shared/terrain.ts';
import { RESOURCE_INFO, type ResourceNode } from '../../shared/world.ts';
import type { World } from './world.ts';

/** Ledges up to this height are stepped onto automatically. */
const STEP = 0.55;

export class Controller {
  readonly position = new THREE.Vector3();
  yaw = 0;
  pitch = -0.12;
  moving = false;
  private vy = 0;
  private onGround = false;
  private keys = new Set<string>();
  private raycaster = new THREE.Raycaster();
  /** The animal being ridden: its pace at a walk and flat out, and how high its saddle sits. */
  mount: { walk: number; sprint: number; seat: number } | null = null;
  /** Called on touching down after a jump or fall, with the downward speed. */
  onLand: ((speed: number) => void) | null = null;
  /** Used by automated tests to walk somewhere without a keyboard. */
  autoWalk: { x: number; z: number } | null = null;

  constructor(
    private world: World,
    private resources: () => ResourceNode[],
    private dom: HTMLElement,
  ) {
    addEventListener('keydown', (e) => this.keys.add(e.code));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.dom) return;
      this.yaw -= e.movementX * 0.0025 * this.sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0025 * this.sensitivity, -1.3, 1.1);
    });
  }

  /** Mouse look speed multiplier, lowered while aiming down sights. */
  sensitivity = 1;

  get eye(): THREE.Vector3 {
    return this.position.clone().add(new THREE.Vector3(0, PLAYER_HEIGHT * 0.9, 0));
  }

  update(dt: number) {
    let fx = 0;
    let fz = 0;
    if (this.keys.has('KeyW')) fz += 1;
    if (this.keys.has('KeyS')) fz -= 1;
    if (this.keys.has('KeyA')) fx -= 1;
    if (this.keys.has('KeyD')) fx += 1;

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const dir = forward.multiplyScalar(fz).add(right.multiplyScalar(fx));

    if (this.autoWalk) {
      const dx = this.autoWalk.x - this.position.x;
      const dz = this.autoWalk.z - this.position.z;
      if (Math.hypot(dx, dz) < 0.4) this.autoWalk = null;
      else {
        dir.set(dx, 0, dz);
        this.yaw = Math.atan2(-dx, -dz);
      }
    }

    const colliders = this.nearbyColliders();
    this.moving = dir.lengthSq() > 0;
    if (this.moving) {
      const m = this.mount;
      const speed = this.keys.has('ShiftLeft') ? (m?.sprint ?? PLAYER_SPRINT) : (m?.walk ?? PLAYER_SPEED);
      dir.normalize().multiplyScalar(speed * dt);
      // Sub-steps stop fast movement from tunnelling through thin walls.
      const steps = Math.ceil(dir.length() / 0.1);
      for (let s = 0; s < steps; s++) {
        this.tryMove(dir.x / steps, 0, colliders);
        this.tryMove(0, dir.z / steps, colliders);
      }
    }

    if (this.mount) {
      // In the saddle: carried over the ground at the animal's back.
      this.position.y = terrainHeight(this.world.seed, this.position.x, this.position.z) + this.mount.seat;
      this.vy = 0;
      this.onGround = true;
      return;
    }
    if (this.keys.has('Space') && this.onGround) {
      this.vy = JUMP_SPEED;
      this.onGround = false;
    }
    this.vy -= GRAVITY * dt;
    const falling = -this.vy;
    const wasOnGround = this.onGround;
    this.moveVertical(this.vy * dt, colliders);
    if (this.onGround && !wasOnGround && falling > 4) this.onLand?.(falling);
  }

  /**
   * Camera behind and slightly right of the player; pulled in if a wall is in the way.
   * `zoom` (0 to 1) brings it closer over the shoulder when aiming; `scoped` looks from the eyes.
   */
  updateCamera(camera: THREE.PerspectiveCamera, zoom = 0, scoped = false) {
    if (scoped) {
      const eye = this.eye;
      const look = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
      camera.position.copy(eye);
      camera.lookAt(eye.addScaledVector(look, 10));
      return;
    }
    // Further back in the saddle, so the animal is in view.
    const dist = (this.mount ? 5.6 : 3.9) * (1 - 0.5 * zoom);
    const back = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      -Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    // Far enough right that the survivor sits left of the crosshair, so what they hold stays in view.
    const shoulder = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(0.85 - 0.15 * zoom);
    const pivot = this.position.clone().add(new THREE.Vector3(0, 1.65, 0)).add(shoulder);
    this.raycaster.set(pivot, back);
    this.raycaster.far = dist;
    const hit = this.raycaster.intersectObjects(this.world.cameraBlockers, true)[0];
    const d = hit ? Math.max(hit.distance - 0.25, 0.4) : dist;
    const cam = pivot.clone().addScaledVector(back, d);
    cam.y = Math.max(cam.y, terrainHeight(this.world.seed, cam.x, cam.z) + 0.3);
    camera.position.copy(cam);
    camera.lookAt(pivot.clone().addScaledVector(back, -10));
  }

  teleport(x: number, y: number, z: number) {
    this.position.set(x, y, z);
    this.vy = 0;
  }

  /** Building pieces and scenery within a few metres of the player. */
  private nearbyColliders(): Box[] {
    const p = this.position;
    const near = (b: Box) =>
      b.max[0] > p.x - 4 && b.min[0] < p.x + 4 && b.max[2] > p.z - 4 && b.min[2] < p.z + 4;
    const out = this.world.decorColliders.filter(near);
    for (const piece of this.world.pieces.values()) {
      if (isSlope(piece)) continue; // stairs and ramps are slopes, handled in groundHeight
      for (const b of pieceBoxes(piece)) if (near(b)) out.push(b);
    }
    for (const d of this.world.deployables.values()) {
      const b = deployableBox(d);
      if (near(b)) out.push(b);
    }
    return out;
  }

  /** True if the player's body (above knee height) at (x, y, z) overlaps a collider. */
  private blocked(x: number, y: number, z: number, colliders: Box[]): boolean {
    const r = PLAYER_RADIUS;
    const y0 = y + STEP;
    const y1 = y + PLAYER_HEIGHT;
    for (const b of colliders) {
      if (x + r > b.min[0] && x - r < b.max[0] && z + r > b.min[2] && z - r < b.max[2] && y1 > b.min[1] && y0 < b.max[1]) {
        return true;
      }
    }
    return false;
  }

  /** The highest surface under the player that they can stand on from height y. */
  private groundHeight(x: number, y: number, z: number, colliders: Box[]): number {
    let ground = terrainHeight(this.world.seed, x, z);
    const r = PLAYER_RADIUS * 0.8;
    for (const b of colliders) {
      if (x + r > b.min[0] && x - r < b.max[0] && z + r > b.min[2] && z - r < b.max[2] && b.max[1] <= y + STEP) {
        ground = Math.max(ground, b.max[1]);
      }
    }
    for (const piece of this.world.pieces.values()) {
      if (!isSlope(piece)) continue;
      const h = stairsHeight(piece, x, z);
      if (h !== null && h <= y + STEP + 0.2) ground = Math.max(ground, h);
    }
    return ground;
  }

  private tryMove(dx: number, dz: number, colliders: Box[]) {
    const nx = THREE.MathUtils.clamp(this.position.x + dx, -HALF_WORLD + 1, HALF_WORLD - 1);
    const nz = THREE.MathUtils.clamp(this.position.z + dz, -HALF_WORLD + 1, HALF_WORLD - 1);
    if (this.blocked(nx, this.position.y, nz, colliders) || this.hitsResource(nx, nz)) return;
    this.position.x = nx;
    this.position.z = nz;
  }

  private moveVertical(dy: number, colliders: Box[]) {
    const p = this.position;
    const ground = this.groundHeight(p.x, p.y, p.z, colliders);
    let ny = p.y + dy;
    if (dy > 0) {
      // Bump the head on a ceiling.
      const r = PLAYER_RADIUS;
      for (const b of colliders) {
        const over = p.x + r > b.min[0] && p.x - r < b.max[0] && p.z + r > b.min[2] && p.z - r < b.max[2];
        if (over && b.min[1] >= p.y + PLAYER_HEIGHT - 0.05 && b.min[1] < ny + PLAYER_HEIGHT) {
          ny = b.min[1] - PLAYER_HEIGHT;
          this.vy = 0;
        }
      }
    }
    // Stay glued to the ground when walking down stairs or slopes instead of hopping.
    const snap = this.onGround && dy <= 0 && p.y - ground < STEP;
    if (ny <= ground || snap) {
      p.y = ground;
      this.vy = 0;
      this.onGround = true;
    } else {
      p.y = ny;
      this.onGround = false;
    }
  }

  private hitsResource(x: number, z: number): boolean {
    for (const n of this.resources()) {
      if (n.amount <= 0 || n.kind === 'hemp' || n.kind === 'mushroom') continue;
      const r = RESOURCE_INFO[n.kind].radius * n.scale + PLAYER_RADIUS;
      const was = Math.hypot(this.position.x - n.x, this.position.z - n.z);
      // Only block movement that goes further into the obstacle, so nobody gets stuck.
      if (Math.hypot(x - n.x, z - n.z) < r && Math.hypot(x - n.x, z - n.z) < was) return true;
    }
    return false;
  }
}
