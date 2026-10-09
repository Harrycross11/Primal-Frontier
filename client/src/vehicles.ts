// Cars as players see them: each model set on the ground and tilted with the slope, in its paint,
// wheels turning as it rolls, its engine growling while someone drives, smoking when badly hurt.

import * as THREE from 'three';
import type { Vec3 } from '../../shared/combat.ts';
import { terrainHeight } from '../../shared/terrain.ts';
import { VEHICLES, axes, rayVehicle, type VehicleKind, type VehicleState } from '../../shared/vehicles.ts';
import type { Effects } from './effects.ts';
import { character } from './models.ts';
import { painted, type PaintMode } from './paint.ts';

/** Which parts of a mesh take paint: the whole surface, only its coloured parts, or none. */
type PaintRule = (mesh: THREE.Mesh, material: THREE.Material) => PaintMode | null;

/** The model file for each kind of car, and where its paint goes. */
const MODELS: Record<VehicleKind, { file: string; paint: PaintRule }> = {
  pickup: { file: 'vehicle-pickup', paint: (_, m) => (m.name === 'body' ? 'all' : null) },
  sedan: { file: 'vehicle-sedan', paint: (_, m) => (m.name === 'CarBody' ? 'all' : null) },
  // One texture for everything: paint only its coloured panels, not the tyres, glass and chrome.
  van: { file: 'vehicle-van', paint: () => 'body' },
  jeep: { file: 'vehicle-jeep', paint: (mesh) => (mesh.name.startsWith('Body') ? 'soft' : null) },
  heli: { file: 'vehicle-heli', paint: (_, m) => (m.name === 'Body' ? 'all' : null) },
};

class VehicleView {
  readonly root = new THREE.Group();
  /** Tilted to the ground under it. */
  private body = new THREE.Group();
  private wheels: { pivot: THREE.Object3D; radius: number }[] = [];
  /** A minicopter's rotors, turning about their hubs: the main one flat, the tail one on its side. */
  private rotors: { pivot: THREE.Object3D; axis: 'x' | 'y' }[] = [];
  /** How fast the rotors turn, 0 to 1: they wind up when someone climbs in and down after. */
  private spin = 0;
  /** A minicopter's lean: nose down as it speeds up, banked into turns. */
  private lean = { pitch: 0, roll: 0, lastSpeed: 0, lastYaw: 0 };
  /** Every mesh with its unpainted material, for repainting. */
  private surfaces: { mesh: THREE.Mesh; base: THREE.Material }[] = [];
  private shownKind: VehicleKind;
  private shownPaint = 0;
  private target = new THREE.Vector3();
  private yaw: number;
  /** Speed along its heading as last seen, for the wheels and the engine. */
  speed = 0;
  smokeIn = 0;

  constructor(
    public state: VehicleState,
    private seed: number,
  ) {
    this.yaw = state.yaw;
    this.shownKind = state.kind;
    this.root.add(this.body);
    this.build();
    this.repaint();
    this.root.position.set(state.x, state.y, state.z);
    this.target.copy(this.root.position);
  }

  /** The scanned truck turned to face along -z (its heading), sat on the ground, wheels free to spin. */
  private build() {
    this.body.clear();
    this.wheels = [];
    this.rotors = [];
    this.surfaces = [];
    const info = VEHICLES[this.state.kind];
    const scene = character(MODELS[this.state.kind].file);
    if (!scene) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(info.width, info.height, info.length), new THREE.MeshStandardMaterial({ color: 0x4a6a6e, roughness: 0.7 }));
      box.position.y = info.height / 2 + 0.3;
      box.castShadow = true;
      this.body.add(box);
      this.surfaces.push({ mesh: box, base: box.material });
      return;
    }
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    // The file is long along z with its bonnet towards +z; turn it to drive along -z.
    const scale = info.length / size.z;
    const holder = new THREE.Group();
    holder.add(scene);
    scene.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
    holder.scale.setScalar(scale);
    holder.rotation.y = Math.PI;
    this.body.add(holder);
    // Each tyre spins round its own middle.
    scene.updateMatrixWorld(true);
    const tyres: THREE.Mesh[] = [];
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      this.surfaces.push({ mesh, base: mat });
      if (mat.name === 'tire' || /^wheel/i.test(mesh.name)) tyres.push(mesh);
    });
    // Rotors spin about their own hubs.
    const rotors: [THREE.Object3D, 'x' | 'y'][] = [];
    scene.traverse((o) => {
      if (/main.?rotor/i.test(o.name) && !rotors.some(([r]) => r === o.parent)) rotors.push([o, 'y']);
      else if (/tail.?rotor/i.test(o.name) && !rotors.some(([r]) => r === o.parent)) rotors.push([o, 'x']);
    });
    for (const [rotor, axis] of rotors) {
      const b = new THREE.Box3().setFromObject(rotor);
      const pivot = new THREE.Group();
      pivot.position.copy(scene.worldToLocal(b.getCenter(new THREE.Vector3())));
      scene.add(pivot);
      pivot.attach(rotor);
      this.rotors.push({ pivot, axis });
    }
    for (const tyre of tyres) {
      const b = new THREE.Box3().setFromObject(tyre);
      const centre = scene.worldToLocal(b.getCenter(new THREE.Vector3()));
      const pivot = new THREE.Group();
      pivot.position.copy(centre);
      tyre.parent!.add(pivot);
      pivot.attach(tyre);
      this.wheels.push({ pivot, radius: (b.max.y - b.min.y) / 2 });
    }
  }

  sync(state: VehicleState) {
    this.state = state;
    this.target.set(state.x, state.y, state.z);
    if (state.kind !== this.shownKind) {
      this.shownKind = state.kind;
      this.build();
      this.shownPaint = -1;
    }
    if (state.paint !== this.shownPaint) this.repaint();
  }

  /** Puts its paint on the parts of the body that take it. */
  private repaint() {
    this.shownPaint = this.state.paint;
    const rule = MODELS[this.state.kind].paint;
    for (const { mesh, base } of this.surfaces) {
      const mode = rule(mesh, base);
      mesh.material = mode ? painted(base, this.state.paint, mode) : base;
    }
  }

  /** Puts it right under its driver (you), rather than where the server last had it. */
  carry(x: number, z: number, yaw: number, speed: number, y = terrainHeight(this.seed, x, z)) {
    this.target.set(x, y, z);
    this.root.position.copy(this.target);
    this.yaw = yaw;
    this.speed = speed;
  }

  update(dt: number, mine: boolean) {
    if (!mine) {
      const was = this.root.position.clone();
      this.root.position.lerp(this.target, Math.min(1, dt * 10));
      let d = this.state.yaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 10);
      const { fx, fz } = axes(this.yaw);
      const moved = (this.root.position.x - was.x) * fx + (this.root.position.z - was.z) * fz;
      this.speed += ((dt > 0 ? moved / dt : 0) - this.speed) * Math.min(1, dt * 6);
    }
    this.root.rotation.y = this.yaw;
    const info = VEHICLES[this.state.kind];
    const p = this.root.position;
    if (info.flies) {
      // Rotors wind up while someone is at the controls with fuel in the tank.
      const running = this.state.driver !== undefined && this.state.fuel > 0;
      this.spin += ((running ? 1 : 0) - this.spin) * Math.min(1, dt * (running ? 0.8 : 0.3));
      for (const r of this.rotors) r.pivot.rotation[r.axis] += this.spin * dt * (r.axis === 'y' ? 38 : 70);
      // Nose down as it speeds up, up as it slows; banked into turns.
      const l = this.lean;
      const accel = dt > 0 ? (this.speed - l.lastSpeed) / dt : 0;
      let turn = this.yaw - l.lastYaw;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      const rate = dt > 0 ? turn / dt : 0;
      const ground = terrainHeight(this.seed, p.x, p.z);
      const airborne = p.y - ground > 0.3 ? 1 : 0;
      l.pitch += (THREE.MathUtils.clamp(-accel * 0.04 - this.speed * 0.008, -0.35, 0.25) * airborne - l.pitch) * Math.min(1, dt * 3);
      l.roll += (THREE.MathUtils.clamp(rate * this.speed * 0.02, -0.45, 0.45) * airborne - l.roll) * Math.min(1, dt * 3);
      l.lastSpeed = this.speed;
      l.lastYaw = this.yaw;
      this.body.rotation.set(l.pitch, 0, l.roll, 'YXZ');
      p.y = Math.max(p.y, ground);
      return;
    }
    // Lean with the ground: nose up a hill, side down a slope.
    const { fx, fz, rx, rz } = axes(this.yaw);
    const h = (along: number, side: number) => terrainHeight(this.seed, p.x + fx * along + rx * side, p.z + fz * along + rz * side);
    const half = info.length / 2 - 0.5;
    const pitch = Math.atan2(h(half, 0) - h(-half, 0), half * 2);
    const roll = Math.atan2(h(0, info.width / 2) - h(0, -info.width / 2), info.width);
    this.body.rotation.set(pitch, 0, -roll, 'YXZ');
    this.root.position.y = Math.max(p.y, (h(half, 0) + h(-half, 0)) / 2);
    for (const w of this.wheels) w.pivot.rotation.x += (this.speed * dt) / Math.max(0.1, w.radius * this.body.children[0].scale.x);
  }
}

export class Vehicles {
  readonly views = new Map<number, VehicleView>();
  /** The car you are driving, which your own aim passes over. */
  mine: number | null = null;

  constructor(
    private scene: THREE.Scene,
    private effects: Effects,
    private seed: number,
  ) {}

  /** Brings the cars in line with the server's list: new ones appear, wrecked ones go. */
  sync(list: VehicleState[]) {
    const seen = new Set<number>();
    for (const s of list) {
      seen.add(s.id);
      const view = this.views.get(s.id);
      if (view) view.sync(s);
      else {
        const v = new VehicleView(s, this.seed);
        this.views.set(s.id, v);
        this.scene.add(v.root);
      }
    }
    for (const [id, view] of this.views) {
      if (seen.has(id)) continue;
      this.scene.remove(view.root);
      this.views.delete(id);
      this.effects.engine(id, null, null);
    }
  }

  update(dt: number) {
    for (const [id, view] of this.views) {
      view.update(dt, id === this.mine);
      const running = view.state.driver !== undefined && view.state.fuel > 0;
      const info = VEHICLES[view.state.kind];
      this.effects.engine(id, view.root.position, running ? Math.min(1, Math.abs(view.speed) / info.top) : null);
      // Black smoke from under the bonnet once it is badly damaged.
      if (view.state.hp > info.maxHp * 0.35) continue;
      view.smokeIn -= dt;
      if (view.smokeIn > 0) continue;
      view.smokeIn = 0.25;
      const { fx, fz } = axes(view.root.rotation.y);
      const at = view.root.position.clone().add(new THREE.Vector3(fx * info.length * 0.35, 1.1, fz * info.length * 0.35));
      this.effects.puff(at, 0.5);
    }
  }

  /** The nearest car along a ray, if any, within `max`. */
  ray(o: Vec3, d: Vec3, max: number): { view: VehicleView; t: number } | null {
    let best: { view: VehicleView; t: number } | null = null;
    for (const view of this.views.values()) {
      if (view.state.id === this.mine) continue;
      const p = view.root.position;
      const t = rayVehicle(o, d, { ...view.state, x: p.x, y: p.y, z: p.z, yaw: view.root.rotation.y }, best?.t ?? max);
      if (t !== null) best = { view, t };
    }
    return best;
  }

  /** Every car's current place, for walking and driving into them. */
  solid(): VehicleState[] {
    return [...this.views.values()].filter((v) => v.state.id !== this.mine).map((v) => ({ ...v.state, x: v.root.position.x, z: v.root.position.z, yaw: v.root.rotation.y }));
  }
}
