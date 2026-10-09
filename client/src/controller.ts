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
import { axes, touchesVehicle, type VehicleInfo, type VehicleState } from '../../shared/vehicles.ts';
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
  /** The car being driven, and how much fuel is in it. Your position is then the driver's seat. */
  car: (VehicleInfo & { fuel: () => number }) | null = null;
  /** The car's speed along its heading, m/s (negative in reverse). */
  carSpeed = 0;
  /** Looking round while driving: the camera's turn away from the car's heading. */
  private camYaw = 0;
  /** Cars to bump into (your own is left out while you drive it). */
  vehicles: () => VehicleState[] = () => [];
  /** Called when the car hits something, with how fast it was going. */
  onCrash: ((speed: number) => void) | null = null;
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
      if (this.car) this.camYaw = THREE.MathUtils.clamp(this.camYaw - e.movementX * 0.0025 * this.sensitivity, -2.6, 2.6);
      else this.yaw -= e.movementX * 0.0025 * this.sensitivity;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0025 * this.sensitivity, -1.3, 1.1);
    });
  }

  /** Mouse look speed multiplier, lowered while aiming down sights. */
  sensitivity = 1;

  get eye(): THREE.Vector3 {
    return this.position.clone().add(new THREE.Vector3(0, PLAYER_HEIGHT * 0.9, 0));
  }

  update(dt: number) {
    if (this.car) return this.drive(dt, this.car);
    this.camYaw = 0;
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
    // Further back in the saddle or at the wheel, so the animal or car is in view.
    const dist = (this.car ? 8 : this.mount ? 5.6 : 3.9) * (1 - 0.5 * zoom);
    const yaw = this.yaw + this.camYaw;
    const back = new THREE.Vector3(
      Math.sin(yaw) * Math.cos(this.pitch),
      -Math.sin(this.pitch),
      Math.cos(yaw) * Math.cos(this.pitch),
    );
    // Far enough right that the survivor sits left of the crosshair, so what they hold stays in view.
    const shoulder = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(this.car ? 0 : 0.85 - 0.15 * zoom);
    const pivot = this.position.clone().add(new THREE.Vector3(0, this.car ? 1.2 : 1.65, 0)).add(shoulder);
    if (this.car) {
      // Look over the middle of the car rather than the driver's shoulder.
      const { rx, rz } = axes(this.yaw);
      pivot.x += rx * this.car.seat.left;
      pivot.z += rz * this.car.seat.left;
    }
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

  /**
   * Driving: W speeds up, S brakes and then reverses, A and D steer (more sharply the faster you
   * go). The car stops dead against walls, trees, rocks and other cars.
   */
  private drive(dt: number, car: VehicleInfo & { fuel: () => number }) {
    const throttle = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const steer = (this.keys.has('KeyA') ? 1 : 0) - (this.keys.has('KeyD') ? 1 : 0);
    const fuel = car.fuel() > 0;
    let v = this.carSpeed;
    if (throttle > 0 && fuel) v = v < 0 ? v + car.accel * 2 * dt : Math.min(car.top, v + car.accel * dt);
    else if (throttle < 0) v = v > 0 ? v - car.accel * 2 * dt : fuel ? Math.max(-car.reverse, v - car.accel * 0.6 * dt) : v;
    else v -= Math.sign(v) * Math.min(Math.abs(v), 2.5 * dt);
    // Where the car's middle is, from the driver's seat.
    const centre = (yaw: number) => {
      const { fx, fz, rx, rz } = axes(yaw);
      return { x: this.position.x - fx * car.seat.ahead + rx * car.seat.left, z: this.position.z - fz * car.seat.ahead + rz * car.seat.left };
    };
    const c = centre(this.yaw);
    this.yaw += steer * car.turn * THREE.MathUtils.clamp(v / 4, -1, 1) * dt;
    const colliders = this.nearbyColliders(7);
    const { fx, fz } = axes(this.yaw);
    const step = v * dt;
    const steps = Math.max(1, Math.ceil(Math.abs(step) / 0.2));
    for (let s = 0; s < steps; s++) {
      const nx = THREE.MathUtils.clamp(c.x + (fx * step) / steps, -HALF_WORLD + 3, HALF_WORLD - 3);
      const nz = THREE.MathUtils.clamp(c.z + (fz * step) / steps, -HALF_WORLD + 3, HALF_WORLD - 3);
      if (this.carBlocked(car, nx, nz, this.yaw, colliders) && !this.carBlocked(car, c.x, c.z, this.yaw, colliders)) {
        if (Math.abs(v) > 3) this.onCrash?.(Math.abs(v));
        v = -v * 0.2;
        break;
      }
      c.x = nx;
      c.z = nz;
    }
    this.carSpeed = v;
    this.moving = Math.abs(v) > 0.3;
    if (Math.abs(v) > 2) this.camYaw *= Math.exp(-dt * 1.2);
    const { fx: ax, fz: az, rx, rz } = axes(this.yaw);
    this.position.set(c.x + ax * car.seat.ahead - rx * car.seat.left, terrainHeight(this.world.seed, c.x, c.z) + car.seat.y, c.z + az * car.seat.ahead - rz * car.seat.left);
    this.vy = 0;
    this.onGround = true;
  }

  /** True if a car with its middle at (x, z) facing `yaw` overlaps something solid. */
  private carBlocked(car: VehicleInfo, x: number, z: number, yaw: number, colliders: Box[]): boolean {
    const { fx, fz } = axes(yaw);
    const r = car.width / 2;
    const ground = terrainHeight(this.world.seed, x, z);
    const reach = car.length / 2 - r;
    for (const k of [-1, 0, 1]) {
      const px = x + fx * k * reach;
      const pz = z + fz * k * reach;
      for (const b of colliders) {
        if (b.max[1] < ground + 0.45 || b.min[1] > ground + 1.6) continue;
        const dx = Math.max(b.min[0] - px, 0, px - b.max[0]);
        const dz = Math.max(b.min[2] - pz, 0, pz - b.max[2]);
        if (dx * dx + dz * dz < r * r) return true;
      }
      for (const n of this.resources()) {
        if (n.amount <= 0 || n.kind === 'hemp' || n.kind === 'mushroom') continue;
        if (Math.hypot(px - n.x, pz - n.z) < RESOURCE_INFO[n.kind].radius * n.scale + r) return true;
      }
    }
    return this.vehicles().some((v) => touchesVehicle(v, x, z, r) || touchesVehicle(v, x + fx * reach, z + fz * reach, r) || touchesVehicle(v, x - fx * reach, z - fz * reach, r));
  }

  /** Building pieces and scenery within a few metres of the player. */
  private nearbyColliders(range = 4): Box[] {
    const p = this.position;
    const near = (b: Box) =>
      b.max[0] > p.x - range && b.min[0] < p.x + range && b.max[2] > p.z - range && b.min[2] < p.z + range;
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
    // Cars are solid: walk into one and you stop, but you can always step away from it.
    if (this.vehicles().some((v) => touchesVehicle(v, nx, nz, PLAYER_RADIUS) && !touchesVehicle(v, this.position.x, this.position.z, PLAYER_RADIUS))) return;
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
