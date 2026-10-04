// Local player: keyboard and mouse input, simple physics against terrain and blocks,
// and an over-the-shoulder third-person camera.

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
import { terrainHeight } from '../../shared/terrain.ts';
import { RESOURCE_INFO, type ResourceNode } from '../../shared/world.ts';
import type { World } from './world.ts';

export class Controller {
  readonly position = new THREE.Vector3();
  yaw = 0;
  pitch = -0.15;
  moving = false;
  private vy = 0;
  private onGround = false;
  private keys = new Set<string>();
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
      this.yaw -= e.movementX * 0.0025;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0025, -1.2, 0.9);
    });
  }

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

    // Camera-relative directions: forward is where the camera looks.
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const dir = forward.multiplyScalar(fz).add(right.multiplyScalar(fx));

    if (this.autoWalk) {
      const dx = this.autoWalk.x - this.position.x;
      const dz = this.autoWalk.z - this.position.z;
      if (Math.hypot(dx, dz) < 0.5) this.autoWalk = null;
      else {
        dir.set(dx, 0, dz);
        this.yaw = Math.atan2(-dx, -dz);
      }
    }

    this.moving = dir.lengthSq() > 0;
    if (this.moving) {
      const speed = this.keys.has('ShiftLeft') ? PLAYER_SPRINT : PLAYER_SPEED;
      dir.normalize().multiplyScalar(speed * dt);
      this.tryMove(dir.x, 0);
      this.tryMove(0, dir.z);
      this.autoStep();
    }

    if (this.keys.has('Space') && this.onGround) {
      this.vy = JUMP_SPEED;
      this.onGround = false;
    }
    this.vy -= GRAVITY * dt;
    this.moveVertical(this.vy * dt);
  }

  /** Puts the camera behind and slightly right of the player, kept above the ground. */
  updateCamera(camera: THREE.PerspectiveCamera) {
    const dist = 4.2;
    const back = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      -Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    );
    const shoulder = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).multiplyScalar(0.55);
    const pivot = this.position.clone().add(new THREE.Vector3(0, 1.65, 0)).add(shoulder);
    const cam = pivot.clone().addScaledVector(back, dist);
    cam.y = Math.max(cam.y, terrainHeight(this.world.seed, cam.x, cam.z) + 0.4);
    camera.position.copy(cam);
    camera.lookAt(pivot.clone().addScaledVector(back, -10));
  }

  teleport(x: number, y: number, z: number) {
    this.position.set(x, y, z);
    this.vy = 0;
  }

  private tryMove(dx: number, dz: number) {
    const nx = THREE.MathUtils.clamp(this.position.x + dx, -HALF_WORLD + 1, HALF_WORLD - 1);
    const nz = THREE.MathUtils.clamp(this.position.z + dz, -HALF_WORLD + 1, HALF_WORLD - 1);
    if (this.hitsBlock(nx, this.position.y, nz) || this.hitsResource(nx, nz)) return;
    this.position.x = nx;
    this.position.z = nz;
  }

  /** Walking into a block shorter than knee height steps onto it, like a stair. */
  private autoStep() {
    if (!this.onGround) return;
    const p = this.position;
    if (this.hitsBlock(p.x, p.y + 0.01, p.z) && !this.hitsBlock(p.x, Math.floor(p.y) + 1, p.z)) {
      p.y = Math.floor(p.y) + 1;
    }
  }

  private moveVertical(dy: number) {
    const p = this.position;
    const ny = p.y + dy;
    const ground = terrainHeight(this.world.seed, p.x, p.z);
    if (this.hitsBlock(p.x, ny, p.z)) {
      if (dy < 0) {
        p.y = Math.floor(ny) + 1; // land on top of the block below
        this.onGround = true;
      } else {
        p.y = Math.ceil(ny + PLAYER_HEIGHT) - 1 - PLAYER_HEIGHT; // bump head on the block above
      }
      this.vy = 0;
    } else if (ny <= ground) {
      p.y = ground;
      this.vy = 0;
      this.onGround = true;
    } else {
      p.y = ny;
      this.onGround = false;
    }
  }

  private hitsBlock(x: number, y: number, z: number): boolean {
    const r = PLAYER_RADIUS;
    const e = 0.001;
    for (let bx = Math.floor(x - r); bx <= Math.floor(x + r); bx++) {
      for (let bz = Math.floor(z - r); bz <= Math.floor(z + r); bz++) {
        for (let by = Math.floor(y + e); by <= Math.floor(y + PLAYER_HEIGHT - e); by++) {
          if (this.world.hasBlock(bx, by, bz)) return true;
        }
      }
    }
    return false;
  }

  private hitsResource(x: number, z: number): boolean {
    for (const n of this.resources()) {
      if (n.amount <= 0) continue;
      const r = RESOURCE_INFO[n.kind].radius * n.scale + PLAYER_RADIUS;
      const was = Math.hypot(this.position.x - n.x, this.position.z - n.z);
      // Only block movement that goes further into the obstacle, so nobody gets stuck.
      if (Math.hypot(x - n.x, z - n.z) < r && Math.hypot(x - n.x, z - n.z) < was) return true;
    }
    return false;
  }
}
