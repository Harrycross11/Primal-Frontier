// The 3D world: lit terrain, scenery, resources, player-built pieces and floating ash.

import * as THREE from 'three';
import { WORLD_SIZE } from '../../shared/constants.ts';
import { MAX_HP, STOREY, THICK, TILE, pieceBoxes, pieceKey, type Box, type Piece } from '../../shared/building.ts';
import { DEPLOYABLE_INFO, type Deployable } from '../../shared/deployables.ts';
import { craters, mulberry32, terrainHeight } from '../../shared/terrain.ts';
import { generateDecor, type Decor, type ResourceNode } from '../../shared/world.ts';
import { buildCar } from './car.ts';
import { HAZE, SUN_DIRECTION } from './graphics.ts';
import { buildBoulder, buildDeployable, buildHemp } from './props.ts';
import { buildScenery } from './scenery.ts';
import {
  barkSurface,
  concreteSurface,
  dotTexture,
  grassTexture,
  groundSurface,
  macroNoiseTexture,
  metalSurface,
  plankSurface,
  rustSurface,
  sandSurface,
  sheetMetalSurface,
  stoneWallSurface,
  woodGrainSurface,
  woodWallSurface,
  worldBox,
} from './textures.ts';

export class World {
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly terrain: THREE.Mesh;
  readonly resourceMeshes = new Map<number, THREE.Group>();
  readonly pieces = new Map<string, Piece>();
  readonly pieceMeshes = new Map<string, THREE.Group>();
  readonly deployables = new Map<number, Deployable>();
  readonly deployableMeshes = new Map<number, THREE.Group>();
  /** Objects the crosshair can target. */
  readonly pickables: THREE.Object3D[] = [];
  /** Solid boxes from scenery, for player collision. */
  readonly decorColliders: Box[] = [];
  /** Objects the camera should not pass through. */
  readonly cameraBlockers: THREE.Object3D[] = [];
  private bounce = new Map<number, number>();
  /** Pieces settling into place after being built (rise) or jolted by a hit (shake): seconds left. */
  private pops = new Map<string, { t: number; kind: 'rise' | 'shake' }>();
  private windTime = { value: 0 };
  private ash: THREE.Points;
  private materials: Record<string, THREE.MeshStandardMaterial>;

  constructor(readonly seed: number) {
    this.scene.fog = new THREE.FogExp2(HAZE, 0.0125);

    this.scene.add(new THREE.HemisphereLight(0xcdbca2, 0x3c342c, 0.45));
    this.sun = new THREE.DirectionalLight(0xffd6a0, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    // Soft-edged shadows: wider filtering, like a sun seen through dust.
    this.sun.shadow.radius = 2.5;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -32;
    sc.right = sc.top = 32;
    sc.near = 1;
    sc.far = 200;
    this.scene.add(this.sun, this.sun.target);

    const std = (opts: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(opts);
    const planks = plankSurface();
    const metal = metalSurface();
    const concrete = concreteSurface();
    const bark = barkSurface();
    const barkDark = barkSurface(true);
    const barrel = rustSurface('#3f5a3c');
    this.materials = {
      wood: std({ ...woodWallSurface(), roughness: 0.9 }),
      scrap: std({ ...sheetMetalSurface(), roughness: 0.6, metalness: 0.55 }),
      concrete: std({ ...concrete, roughness: 0.95 }),
      stone: std({ ...stoneWallSurface(), roughness: 0.95 }),
      timber: std({ ...woodGrainSurface(), color: 0x8a7462, roughness: 0.9 }),
      steel: std({ ...rustSurface('#55575a'), roughness: 0.55, metalness: 0.7 }),
      lintel: std({ ...concrete, color: 0xb0a898, roughness: 0.95 }),
      rebar: std({ color: 0x5a3a28, roughness: 0.7, metalness: 0.6 }),
      bark: std({ ...bark, roughness: 0.95 }),
      barkDark: std({ ...barkDark, roughness: 0.95 }),
      leaves: std({ color: 0x5f6b34, roughness: 0.9, flatShading: true }),
      barrel: std({ ...barrel, roughness: 0.7, metalness: 0.5 }),
      rock: std({ ...concrete, color: 0x8a8278, roughness: 1, flatShading: true }),
      pole: std({ ...bark, color: 0x8a7a6a, roughness: 0.95 }),
    };

    this.terrain = this.buildTerrain();
    this.scene.add(this.terrain);
    this.pickables.push(this.terrain);
    this.cameraBlockers.push(this.terrain);
    this.buildGrass();
    const decor = generateDecor(seed);
    for (const d of decor) this.addDecor(d);
    buildScenery(this.scene, seed, decor);
    this.ash = this.buildAsh();
  }

  private buildTerrain(): THREE.Mesh {
    const segments = 220;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const colors = new Float32Array(pos.count * 3);
    const ash = new THREE.Color(0xa49a8a);
    const scorched = new THREE.Color(0x4a443e);
    const glass = new THREE.Color(0x76806e);
    const pale = new THREE.Color(0xb8ae9c);
    const list = craters(this.seed);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, terrainHeight(this.seed, x, z));
      uv.setXY(i, x / 6, z / 6);
      c.copy(ash);
      for (const cr of list) {
        const d = Math.hypot(x - cr.x, z - cr.z) / cr.radius;
        if (d < 1) c.lerp(glass, (1 - d) * 0.7);
        else if (d < 1.6) c.lerp(scorched, (1 - (d - 1) / 0.6) * 0.75);
      }
      const n = Math.sin(x * 0.11 + Math.sin(z * 0.07) * 3) * Math.cos(z * 0.09 + x * 0.03);
      c.lerp(n > 0 ? pale : scorched, Math.abs(n) * 0.25);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = groundSurface();
    const mat = new THREE.MeshStandardMaterial({
      map: ground.map,
      normalMap: ground.normalMap,
      roughnessMap: ground.roughnessMap,
      normalScale: new THREE.Vector2(1.2, 1.2),
      vertexColors: true,
      roughness: 1,
    });
    // Break up the texture repeat: mix the cracked earth at two scales, blend in drifts of
    // rippled sand, and vary brightness over tens of metres.
    const sand = sandSurface();
    const macro = macroNoiseTexture();
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.sandMap = { value: sand.map };
      shader.uniforms.sandNormal = { value: sand.normalMap };
      shader.uniforms.macroMap = { value: macro };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform sampler2D sandMap;\nuniform sampler2D sandNormal;\nuniform sampler2D macroMap;')
        .replace(
          '#include <map_fragment>',
          `float sandy = 0.0;
          #ifdef USE_MAP
            vec4 macro = texture2D(macroMap, vMapUv * 0.045);
            vec4 macro2 = texture2D(macroMap, vMapUv * 0.013 + vec2(0.3, 0.6));
            vec4 crackA = texture2D(map, vMapUv);
            vec4 crackB = texture2D(map, vMapUv * 0.37 + vec2(0.17, 0.53));
            vec4 grit = texture2D(sandMap, vMapUv * 1.6);
            sandy = smoothstep(0.5, 0.62, macro.g * 0.6 + macro2.r * 0.4);
            vec4 ground = mix(crackA, crackB, 0.4);
            vec4 sampledDiffuseColor = mix(ground, grit, sandy);
            sampledDiffuseColor.rgb *= mix(0.8, 1.15, macro2.g) * mix(0.92, 1.06, macro.r);
            diffuseColor *= sampledDiffuseColor;
          #endif`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#ifdef USE_NORMALMAP_TANGENTSPACE
            vec3 mapN = mix(texture2D(normalMap, vNormalMapUv).xyz, texture2D(sandNormal, vNormalMapUv * 1.6).xyz, sandy) * 2.0 - 1.0;
            mapN.xy *= normalScale;
            normal = normalize(tbn * mapN);
          #else
            #include <normal_fragment_maps>
          #endif`,
        );
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  private buildGrass() {
    const tex = grassTexture();
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 });
    // Tufts sway in gusts: the tips move, the roots stay put, and each clump is out of step.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.windTime = this.windTime;
      // Double-sided materials flip the normal on back faces, which points it into the ground
      // and turns every blade seen from behind black. Keep the upward normal on both sides.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''),
      );
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float windTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec2 root = instanceMatrix[3].xz;
            float gust = sin(windTime * 1.3 + root.x * 0.15 + root.y * 0.07) * 0.5 + 0.5;
            float sway = sin(windTime * 3.1 + root.x * 1.7 + root.y * 2.3) * (0.05 + gust * 0.12);
            transformed.x += sway * position.y * 1.6;
            transformed.z += sway * position.y * 0.7;
          #endif`,
        );
    };
    const blade = new THREE.PlaneGeometry(0.7, 0.55);
    blade.translate(0, 0.27, 0);
    const cross = mergeCross(blade);
    // Point every normal up so the tufts are lit like the ground instead of going black edge-on.
    const n = cross.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    const count = 4500;
    const mesh = new THREE.InstancedMesh(cross, mat, count);
    const rand = mulberry32(this.seed ^ 0xabcdef);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    let placed = 0;
    for (let n = 0; n < count * 3 && placed < count; n++) {
      // Grass survives in clumps, away from blast sites.
      const x = (rand() - 0.5) * WORLD_SIZE * 0.85;
      const z = (rand() - 0.5) * WORLD_SIZE * 0.85;
      const patch = Math.sin(x * 0.08) * Math.cos(z * 0.06) + Math.sin((x + z) * 0.05);
      if (patch < 0.3) continue;
      const y = terrainHeight(this.seed, x, z);
      if (y < 1) continue;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
      s.setScalar(0.6 + rand() * 0.9);
      p.set(x, y - 0.02, z);
      mesh.setMatrixAt(placed++, m.compose(p, q, s));
    }
    mesh.count = placed;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  private buildAsh(): THREE.Points {
    const count = 1400;
    const pos = new Float32Array(count * 3);
    const rand = mulberry32(7);
    for (let i = 0; i < count; i++) pos.set([(rand() - 0.5) * 50, rand() * 20, (rand() - 0.5) * 50], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ size: 0.07, map: dotTexture(), color: 0xe8e2d8, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    pts.frustumCulled = false;
    this.scene.add(pts);
    return pts;
  }

  private addDecor(d: Decor) {
    const g = new THREE.Group();
    g.position.set(d.x, d.y, d.z);
    g.rotation.y = d.rot;
    const rand = mulberry32(d.variant + 1);
    const solid = (mesh: THREE.Mesh, collide: boolean) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      if (collide) this.cameraBlockers.push(mesh);
      return mesh;
    };
    if (d.kind === 'ruin') {
      // A burnt-out concrete house: broken walls of uneven height, a floor slab and rebar.
      const w = 7 + rand() * 4;
      const l = 6 + rand() * 4;
      const slab = solid(new THREE.Mesh(worldBox(w + 0.6, 0.4, l + 0.6, 2), this.materials.concrete), false);
      slab.position.y = 0.1;
      const walls: [number, number, number, number][] = [
        [0, -l / 2, w, 0], // along x at -z
        [0, l / 2, w, 0],
        [-w / 2, 0, l, 1],
        [w / 2, 0, l, 1],
      ];
      for (const [cx, cz, len, axis] of walls) {
        if (rand() < 0.2) continue; // a wall that fell down entirely
        const pieces = 3 + Math.floor(rand() * 3);
        for (let s = 0; s < pieces; s++) {
          if (rand() < 0.15) continue;
          const segLen = len / pieces;
          const h = 0.6 + rand() * 3.4;
          const off = -len / 2 + segLen * (s + 0.5);
          const mesh = solid(
            new THREE.Mesh(axis === 0 ? worldBox(segLen, h, 0.35, 2) : worldBox(0.35, h, segLen, 2), this.materials.concrete),
            true,
          );
          mesh.position.set(cx + (axis === 0 ? off : 0), h / 2 + 0.2, cz + (axis === 1 ? off : 0));
          if (h > 2 && rand() < 0.6) {
            const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1 + rand()), this.materials.rebar);
            bar.position.set(mesh.position.x, h + 0.6, mesh.position.z);
            bar.rotation.set((rand() - 0.5) * 0.8, 0, (rand() - 0.5) * 0.8);
            g.add(bar);
          }
          this.pushCollider(g, mesh, axis === 0 ? segLen : 0.35, h, axis === 0 ? 0.35 : segLen);
        }
      }
      for (let n = 0; n < 6; n++) {
        const chunk = solid(new THREE.Mesh(new THREE.DodecahedronGeometry(0.2 + rand() * 0.4, 0), this.materials.concrete), false);
        chunk.position.set((rand() - 0.5) * (w + 4), 0.15, (rand() - 0.5) * (l + 4));
        chunk.rotation.set(rand() * 3, rand() * 3, rand() * 3);
      }
    } else if (d.kind === 'pole') {
      const pole = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 8, 8), this.materials.pole), true);
      pole.position.y = 4;
      const bar = solid(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.14, 0.14), this.materials.pole), false);
      bar.position.y = 7.4;
      g.rotation.z = (rand() - 0.5) * 0.25;
      g.rotation.x = (rand() - 0.5) * 0.2;
      this.decorColliders.push({ min: [d.x - 0.2, d.y, d.z - 0.2], max: [d.x + 0.2, d.y + 8, d.z + 0.2] });
    } else if (d.kind === 'rock') {
      const geo = new THREE.IcosahedronGeometry(1, 1);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 0.75 + rand() * 0.45;
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
      }
      geo.computeVertexNormals();
      const rock = solid(new THREE.Mesh(geo, this.materials.rock), d.scale > 1);
      rock.scale.setScalar(d.scale);
      rock.position.y = d.scale * 0.25;
      if (d.scale > 1) {
        const r = d.scale * 0.7;
        this.decorColliders.push({ min: [d.x - r, d.y - 1, d.z - r], max: [d.x + r, d.y + d.scale * 0.8, d.z + r] });
      }
    } else {
      const tipped = rand() < 0.4;
      const barrel = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14), this.materials.barrel), false);
      barrel.position.y = tipped ? 0.3 : 0.45;
      if (tipped) barrel.rotation.z = Math.PI / 2;
    }
    this.scene.add(g);
  }

  /** Registers a box-shaped mesh inside a rotated group as an axis-aligned collider. */
  private pushCollider(g: THREE.Group, mesh: THREE.Mesh, w: number, h: number, d: number) {
    g.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(w, h, d));
    b.applyMatrix4(mesh.matrixWorld);
    // Rotated walls become generous boxes; shrink them a little so doorways stay usable.
    const size = b.getSize(new THREE.Vector3());
    const shrink = Math.min(size.x, size.z) > 1 ? 0.3 : 0;
    this.decorColliders.push({
      min: [b.min.x + shrink, b.min.y, b.min.z + shrink],
      max: [b.max.x - shrink, b.max.y, b.max.z - shrink],
    });
  }

  addResources(nodes: ResourceNode[]) {
    for (const node of nodes) {
      const rand = mulberry32(node.id * 7 + 3);
      const g =
        node.kind === 'tree'
          ? this.livingTree(rand)
          : node.kind === 'deadTree'
            ? this.deadTree(rand)
            : node.kind === 'scrap'
              ? this.wreck(rand)
              : node.kind === 'hemp'
                ? buildHemp(rand)
                : buildBoulder(rand, node.kind);
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

  private branch(parent: THREE.Object3D, mat: THREE.Material, len: number, radius: number, depth: number, rand: () => number) {
    const geo = new THREE.CylinderGeometry(radius * 0.6, radius, len, 6);
    geo.translate(0, len / 2, 0);
    const mesh = new THREE.Mesh(geo, mat);
    parent.add(mesh);
    if (depth <= 0) return mesh;
    const kids = 2 + Math.floor(rand() * 2);
    for (let n = 0; n < kids; n++) {
      const pivot = new THREE.Group();
      pivot.position.y = len * (0.55 + rand() * 0.4);
      pivot.rotation.set((rand() - 0.5) * 0.4, rand() * Math.PI * 2, 0.5 + rand() * 0.5);
      pivot.rotateZ(0);
      mesh.add(pivot);
      this.branch(pivot, mat, len * (0.5 + rand() * 0.2), radius * 0.55, depth - 1, rand);
    }
    return mesh;
  }

  private livingTree(rand: () => number): THREE.Group {
    const g = new THREE.Group();
    const trunk = this.branch(g, this.materials.bark, 2.6, 0.26, 2, rand);
    trunk.rotation.z = (rand() - 0.5) * 0.1;
    // Sparse, sickly foliage clumps: alive, but only just.
    for (let n = 0; n < 6; n++) {
      const geo = new THREE.IcosahedronGeometry(0.7 + rand() * 0.6, 1);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 0.8 + rand() * 0.35;
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k);
      }
      geo.computeVertexNormals();
      const clump = new THREE.Mesh(geo, this.materials.leaves);
      const a = rand() * Math.PI * 2;
      const r = rand() * 1.2;
      clump.position.set(Math.cos(a) * r, 2.8 + rand() * 1.4, Math.sin(a) * r);
      g.add(clump);
    }
    return g;
  }

  private deadTree(rand: () => number): THREE.Group {
    const g = new THREE.Group();
    const trunk = this.branch(g, this.materials.barkDark, 2.4 + rand(), 0.2, 2, rand);
    trunk.rotation.z = (rand() - 0.5) * 0.25;
    return g;
  }

  /** A rusted-out old car, with a loose sheet of scrap lying beside it. */
  private wreck(rand: () => number): THREE.Group {
    const g = buildCar(rand);
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(1, 0.04, 0.7), this.materials.scrap);
    sheet.position.set(2.4, 0.1, 1.1);
    sheet.rotation.set(0.2, rand() * 3, 0.15);
    g.add(sheet);
    return g;
  }

  /** Adds, updates or removes a building piece. */
  setPiece(key: string, piece: Piece | null) {
    const old = this.pieceMeshes.get(key);
    if (old) {
      this.scene.remove(old);
      this.pieceMeshes.delete(key);
      this.pickables.splice(this.pickables.indexOf(old), 1);
      this.cameraBlockers.splice(this.cameraBlockers.indexOf(old), 1);
    }
    if (!piece) {
      this.pieces.delete(key);
      return;
    }
    this.pieces.set(key, piece);
    const g = buildPieceMesh(piece, this.pieceMaterial(piece));
    this.addFraming(g, piece);
    g.traverse((o) => {
      o.userData.pieceKey = key;
      o.castShadow = true;
      o.receiveShadow = true;
    });
    this.scene.add(g);
    this.pieceMeshes.set(key, g);
    this.pickables.push(g);
    this.cameraBlockers.push(g);
  }

  /** Adds, updates or removes a workbench, furnace or box. */
  /** Animates a piece: rising into place when just built, or a short shake when hit. */
  popPiece(key: string, kind: 'rise' | 'shake' = 'rise') {
    if (this.pieceMeshes.has(key)) this.pops.set(key, { t: kind === 'rise' ? 0.28 : 0.18, kind });
  }

  setDeployable(id: number, d: Deployable | null) {
    const old = this.deployableMeshes.get(id);
    if (!d) {
      if (old) {
        this.scene.remove(old);
        this.pickables.splice(this.pickables.indexOf(old), 1);
        this.cameraBlockers.splice(this.cameraBlockers.indexOf(old), 1);
      }
      this.deployableMeshes.delete(id);
      this.deployables.delete(id);
      return;
    }
    this.deployables.set(id, d);
    let g = old;
    if (!g) {
      g = buildDeployable(d.kind);
      g.position.set(d.x, d.y, d.z);
      g.rotation.y = d.rot;
      g.traverse((o) => (o.userData.deployableId = id));
      this.scene.add(g);
      this.deployableMeshes.set(id, g);
      this.pickables.push(g);
      this.cameraBlockers.push(g);
    }
    g.userData.setOn?.(d.on);
    g.userData.health = d.hp / DEPLOYABLE_INFO[d.kind].hp;
  }

  /**
   * The structure around a wall's infill, so it reads as something built: timber posts,
   * rails and a brace for wood; steel posts for scrap; stone lintels and sills for stone.
   * Window and door openings get a frame of the same.
   */
  private addFraming(g: THREE.Group, piece: Piece) {
    if (piece.kind !== 'wall') return;
    const m = piece.material;
    const mat = m === 'wood' ? this.materials.timber : m === 'scrap' ? this.materials.steel : this.materials.lintel;
    const S = TILE;
    const H = piece.edit === 'half' ? STOREY / 2 : STOREY;
    const P = m === 'scrap' ? 0.12 : 0.16;
    const depth = THICK + 0.08;
    // [a0, h0, a1, h1] rectangles in the wall's own length/height coordinates.
    const parts: [number, number, number, number][] = [];
    if (m !== 'stone') {
      parts.push([0, 0, P, H], [S - P, 0, S, H], [P, H - P, S - P, H], [P, 0, S - P, P]);
      if (piece.edit === 'half') parts.push([P, H / 2 - P / 2, S - P, H / 2 + P / 2]);
    }
    const J = m === 'stone' ? 0.22 : P * 0.8;
    if (piece.edit === 'window') {
      // Sill, head and jambs; the stone ones overhang the opening a little.
      const over = m === 'stone' ? 0.15 : 0;
      parts.push([0.9 - over, 1.1 - J, S - 0.9 + over, 1.1], [0.9 - over, 2.1, S - 0.9 + over, 2.1 + J]);
      if (m !== 'stone') parts.push([0.9 - J, 1.1, 0.9, 2.1], [S - 0.9, 1.1, S - 0.9 + J, 2.1]);
    } else if (piece.edit === 'door') {
      const d0 = S / 2 - 0.65;
      const d1 = S / 2 + 0.65;
      parts.push([d0 - (m === 'stone' ? 0.2 : J), 2.3, d1 + (m === 'stone' ? 0.2 : J), 2.3 + J]);
      if (m !== 'stone') parts.push([d0 - J, P, d0, 2.3], [d1, P, d1 + J, 2.3]);
    }
    const t = depth / 2;
    const x0 = piece.i * TILE;
    const z0 = piece.k * TILE;
    // Walls along z sit a hair lower so their posts never share a face with crossing walls.
    const dy = piece.dir === 1 ? -0.004 : 0;
    for (const [a0, h0, a1, h1] of parts) {
      const w = a1 - a0;
      const h = h1 - h0 + dy * 2;
      const geo = piece.dir === 0 ? worldBox(w, h, depth, 1.2) : worldBox(depth, h, w, 1.2);
      const mesh = new THREE.Mesh(geo, mat);
      const a = (a0 + a1) / 2;
      const y = piece.y + (h0 + h1) / 2;
      if (piece.dir === 0) mesh.position.set(x0 + a, y, z0);
      else mesh.position.set(x0, y, z0 + a);
      g.add(mesh);
    }
    // A diagonal brace across solid wood walls, like a barn's.
    if (m === 'wood' && piece.edit === 'solid') {
      const len = Math.hypot(S - 2 * P, H - 2 * P);
      const brace = new THREE.Mesh(worldBox(len, P * 0.8, t * 2 - 0.02, 1.2), mat);
      brace.rotation.set(0, piece.dir === 0 ? 0 : -Math.PI / 2, Math.atan2(H - 2 * P, S - 2 * P));
      if (piece.dir === 0) brace.position.set(x0 + S / 2, piece.y + H / 2, z0);
      else brace.position.set(x0, piece.y + H / 2, z0 + S / 2);
      g.add(brace);
    }
  }

  /** Damaged pieces get darker, so you can see a wall is about to break. */
  private pieceMaterial(piece: Piece): THREE.Material {
    const base = this.materials[piece.material];
    const health = piece.hp / MAX_HP[piece.material];
    if (health >= 0.999) return base;
    const m = base.clone();
    m.color.multiplyScalar(0.45 + 0.55 * health);
    return m;
  }

  /** Keeps shadows sharp around the player, drifts the ash and animates hit bounces. */
  update(dt: number, focus: THREE.Vector3, time: number) {
    this.windTime.value = time;
    this.sun.position.copy(focus).addScaledVector(SUN_DIRECTION, 80);
    this.sun.target.position.copy(focus);

    const pos = this.ash.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i) + Math.sin(time * 0.3 + i) * dt * 0.3 + dt * 0.6;
      let y = pos.getY(i) - dt * (0.25 + (i % 5) * 0.05);
      let z = pos.getZ(i) + Math.cos(time * 0.2 + i * 1.3) * dt * 0.3;
      // Keep the flakes in a box around the player.
      if (x - focus.x > 25) x -= 50;
      if (x - focus.x < -25) x += 50;
      if (z - focus.z > 25) z -= 50;
      if (z - focus.z < -25) z += 50;
      if (y < focus.y - 4) y += 20;
      if (y > focus.y + 16) y -= 20;
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;

    for (const [id, t] of this.bounce) {
      const g = this.resourceMeshes.get(id)!;
      const left = t - dt;
      const k = Math.sin((left / 0.25) * Math.PI) * 0.06;
      g.scale.setScalar(g.userData.baseScale * (1 + k));
      if (left <= 0) {
        g.scale.setScalar(g.userData.baseScale);
        this.bounce.delete(id);
      } else this.bounce.set(id, left);
    }

    for (const [key, pop] of this.pops) {
      const g = this.pieceMeshes.get(key);
      pop.t -= dt;
      if (!g || pop.t <= 0) {
        g?.position.set(0, 0, 0);
        this.pops.delete(key);
        continue;
      }
      if (pop.kind === 'rise') {
        // Ease out with a small overshoot, like the piece thumps down into its frame.
        const k = 1 - pop.t / 0.28;
        const back = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
        g.position.y = -0.35 * (1 - back);
      } else {
        const a = (pop.t / 0.18) * 0.045;
        g.position.set(Math.sin(pop.t * 90) * a, 0, Math.cos(pop.t * 77) * a);
      }
    }
  }
}

/** Turns a piece's collision boxes into meshes, so what you see is exactly what you bump into. */
export function buildPieceMesh(piece: Piece, material: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  for (const b of pieceBoxes(piece)) {
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const d = b.max[2] - b.min[2];
    const mesh = new THREE.Mesh(worldBox(w, h, d), material);
    mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    g.add(mesh);
  }
  g.userData.pieceKey = pieceKey(piece);
  return g;
}

/** Two crossed planes from one, so grass looks full from every angle. */
function mergeCross(plane: THREE.PlaneGeometry): THREE.BufferGeometry {
  const a = plane.clone();
  const b = plane.clone().rotateY(Math.PI / 2);
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array([...a.attributes.position.array, ...b.attributes.position.array]);
  const norm = new Float32Array([...a.attributes.normal.array, ...b.attributes.normal.array]);
  const uv = new Float32Array([...a.attributes.uv.array, ...b.attributes.uv.array]);
  const offset = a.attributes.position.count;
  const index = [...a.index!.array, ...[...b.index!.array].map((i) => i + offset)];
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}
