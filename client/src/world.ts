// Builds the scene: ash-grey terrain, hazy sky, resources and player-built blocks.

import * as THREE from 'three';
import { WORLD_SIZE } from '../../shared/constants.ts';
import { terrainHeight } from '../../shared/terrain.ts';
import { blockKey, type Block, type BlockType, type ResourceNode } from '../../shared/world.ts';

const SKY = 0xb9a58c;

export class World {
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly terrain: THREE.Mesh;
  readonly resourceMeshes = new Map<number, THREE.Group>();
  readonly blockMeshes = new Map<string, THREE.Mesh>();
  /** Everything the crosshair can hit. */
  readonly pickables: THREE.Object3D[] = [];
  private blockMaterials: Record<BlockType, THREE.Material>;
  private blockGeometry = new THREE.BoxGeometry(1, 1, 1);
  private bounce = new Map<number, number>();

  constructor(readonly seed: number) {
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 25, 110);

    this.scene.add(new THREE.HemisphereLight(0xe8d9c0, 0x4a4238, 1.4));
    this.sun = new THREE.DirectionalLight(0xffe2b8, 2.2);
    this.sun.position.set(30, 50, 20);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -35;
    sc.right = sc.top = 35;
    sc.far = 150;
    this.scene.add(this.sun, this.sun.target);

    this.terrain = this.buildTerrain();
    this.scene.add(this.terrain);
    this.pickables.push(this.terrain);

    this.blockMaterials = {
      wood: new THREE.MeshLambertMaterial({ map: plankTexture() }),
      scrap: new THREE.MeshLambertMaterial({ map: rustTexture() }),
    };
  }

  private buildTerrain(): THREE.Mesh {
    const segments = WORLD_SIZE;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const ash = new THREE.Color(0x8d8578);
    const dark = new THREE.Color(0x4f4a44);
    const glass = new THREE.Color(0x6f7a6a);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = terrainHeight(this.seed, x, z);
      pos.setY(i, h);
      const speck = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
      const n = speck - Math.floor(speck);
      c.copy(ash).lerp(dark, THREE.MathUtils.clamp((2.5 - h) / 4, 0, 1));
      if (h < 0.5) c.lerp(glass, 0.35);
      c.offsetHSL(0, 0, (n - 0.5) * 0.06);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  addResources(nodes: ResourceNode[]) {
    for (const node of nodes) {
      const g = node.kind === 'tree' ? livingTree() : node.kind === 'deadTree' ? deadTree() : scrapPile();
      g.position.set(node.x, node.y, node.z);
      g.rotation.y = node.rot;
      g.scale.setScalar(node.scale);
      g.userData.baseScale = node.scale;
      g.traverse((o) => {
        o.userData.resourceId = node.id;
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.scene.add(g);
      this.resourceMeshes.set(node.id, g);
      this.pickables.push(g);
      this.setResourceAmount(node.id, node.amount);
    }
  }

  setResourceAmount(id: number, amount: number) {
    const g = this.resourceMeshes.get(id);
    if (!g) return;
    const was = g.visible;
    g.visible = amount > 0;
    if (was && g.visible) this.bounce.set(id, 0.25);
  }

  setBlock(b: Block | { x: number; y: number; z: number; type: null }) {
    const key = blockKey(b.x, b.y, b.z);
    const old = this.blockMeshes.get(key);
    if (old) {
      this.scene.remove(old);
      this.blockMeshes.delete(key);
      this.pickables.splice(this.pickables.indexOf(old), 1);
    }
    if (!b.type) return;
    const mesh = new THREE.Mesh(this.blockGeometry, this.blockMaterials[b.type]);
    mesh.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.cell = { x: b.x, y: b.y, z: b.z };
    this.scene.add(mesh);
    this.blockMeshes.set(key, mesh);
    this.pickables.push(mesh);
  }

  hasBlock(x: number, y: number, z: number): boolean {
    return this.blockMeshes.has(blockKey(x, y, z));
  }

  /** Keeps the shadow camera centred on the local player and animates hit bounces. */
  update(dt: number, focus: THREE.Vector3) {
    this.sun.position.set(focus.x + 30, focus.y + 50, focus.z + 20);
    this.sun.target.position.copy(focus);
    for (const [id, t] of this.bounce) {
      const g = this.resourceMeshes.get(id)!;
      const left = t - dt;
      const k = Math.sin((left / 0.25) * Math.PI) * 0.08;
      g.scale.setScalar(g.userData.baseScale * (1 + k));
      if (left <= 0) {
        g.scale.setScalar(g.userData.baseScale);
        this.bounce.delete(id);
      } else this.bounce.set(id, left);
    }
  }
}

function lambert(color: number) {
  return new THREE.MeshLambertMaterial({ color, flatShading: true });
}

function livingTree(): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 3, 6), lambert(0x5b4030));
  trunk.position.y = 1.5;
  g.add(trunk);
  // Sickly olive leaves: alive, but only just.
  const leaves = lambert(0x6b7a3a);
  for (const [x, y, z, r] of [
    [0, 3.4, 0, 1.3],
    [0.6, 2.8, 0.3, 0.9],
    [-0.5, 3, -0.4, 0.95],
  ]) {
    const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leaves);
    blob.position.set(x, y, z);
    g.add(blob);
  }
  return g;
}

function deadTree(): THREE.Group {
  const g = new THREE.Group();
  const bark = lambert(0x3d342e);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.22, 2.6, 5), bark);
  trunk.position.y = 1.3;
  trunk.rotation.z = 0.08;
  g.add(trunk);
  for (const [y, rz, ry, len] of [
    [1.6, 0.9, 0, 0.9],
    [2.0, -0.8, 1.5, 0.7],
    [1.2, 1.1, 3, 0.6],
  ]) {
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, len, 4), bark);
    branch.position.y = y;
    branch.rotation.set(0, ry, rz);
    branch.translateY(len / 2);
    g.add(branch);
  }
  return g;
}

function scrapPile(): THREE.Group {
  const g = new THREE.Group();
  const rust = lambert(0x8a4b2a);
  const metal = lambert(0x5d6066);
  // A wrecked car shell, a tyre and loose sheet metal.
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 1.0), rust);
  body.position.y = 0.35;
  body.rotation.z = 0.12;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.45, 0.9), metal);
  cabin.position.set(-0.2, 0.85, 0);
  cabin.rotation.z = 0.2;
  const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.11, 6, 10), lambert(0x222222));
  tyre.position.set(1.2, 0.12, 0.5);
  tyre.rotation.x = Math.PI / 2;
  const sheet = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.6), metal);
  sheet.position.set(0.6, 0.2, -0.75);
  sheet.rotation.set(0.3, 0.5, 0.2);
  g.add(body, cabin, tyre, sheet);
  return g;
}

function canvasTexture(draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  draw(canvas.getContext('2d')!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function plankTexture() {
  return canvasTexture((ctx) => {
    ctx.fillStyle = '#9a6b3f';
    ctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#8a5e36' : '#a87648';
      ctx.fillRect(0, i * 16 + 1, 64, 14);
      ctx.fillStyle = '#5a3a20';
      ctx.fillRect(0, i * 16, 64, 1);
      ctx.fillRect(((i * 23) % 50) + 6, i * 16 + 6, 2, 2);
    }
    ctx.strokeStyle = '#4a2f18';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 62, 62);
  });
}

function rustTexture() {
  return canvasTexture((ctx) => {
    ctx.fillStyle = '#6b6f75';
    ctx.fillRect(0, 0, 64, 64);
    let s = 7;
    const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 120; i++) {
      ctx.fillStyle = r() > 0.5 ? '#8a4b2a' : '#a35d32';
      ctx.fillRect(Math.floor(r() * 64), Math.floor(r() * 64), 3 + Math.floor(r() * 5), 2 + Math.floor(r() * 4));
    }
    ctx.fillStyle = '#3b3e42';
    for (const [x, y] of [
      [6, 6],
      [56, 6],
      [6, 56],
      [56, 56],
    ])
      ctx.fillRect(x, y, 3, 3);
    ctx.strokeStyle = '#3b3e42';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 62, 62);
  });
}
