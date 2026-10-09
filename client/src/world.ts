// The 3D world: lit terrain, scenery, resources, player-built pieces and floating ash.

import * as THREE from 'three';
import { scanMesh } from './lod.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD_SIZE } from '../../shared/constants.ts';
import { DOORWAY, MAX_HP, ROOF_RISE, STOREY, THICK, TILE, pieceBoxes, pieceKey, type Box, type Piece } from '../../shared/building.ts';
import { DEPLOYABLE_INFO, type Deployable } from '../../shared/deployables.ts';
import { BIOME_IDS, biomeWeights } from '../../shared/biomes.ts';
import { craters, mulberry32, terrainHeight } from '../../shared/terrain.ts';
import { RESOURCE_INFO, generateDecor, type Decor, type ResourceNode } from '../../shared/world.ts';
import { landmarks, toWorld } from '../../shared/landmarks.ts';
import { buildCar } from './car.ts';
import { HAZE, SUN_DIRECTION } from './graphics.ts';
import { buildBoulder, buildDeployable, buildDoorLeaf, buildHemp, buildMushrooms, buildRadSign, buildWaterBarrel, scannedRock } from './props.ts';
import { radZones } from '../../shared/survival.ts';
import { BOULDERS, WRECKS, model, variants, type Model } from './models.ts';
import { paintRock, rockGeometry, rockMaterial } from './rocks.ts';
import { buildScenery, type Patch } from './scenery.ts';
import { terrainLayers } from './terrainLayers.ts';
import { painted } from './paint.ts';
import {
  barkSurface,
  concreteSurface,
  dotTexture,
  grassTexture,
  leafTexture,
  groundSurface,
  macroNoiseTexture,
  metalSurface,
  plankSurface,
  rustSurface,
  sheetMetalSurface,
  stoneWallSurface,
  woodGrainSurface,
  woodWallSurface,
  worldBox,
} from './textures.ts';

/** Size of the map's squares, metres, and how far off they still show. */
const CELL = 50;
const VIEW = 240;
/**
 * How far off smaller things still show: a clump of hemp or a barrel is a speck in the haze
 * long before the view ends, and drawing thousands of specks is what slows a frame down.
 */
const VIEW_SMALL = 90;
const VIEW_MEDIUM = 170;
const GRASS_CELL = 24;
const GRASS_VIEW = 95;

export class World {
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly fires: THREE.PointLight[] = [];
  /** How far open each door has swung, 0 shut to 1 open, so a rebuilt door carries on swinging. */
  private doorSwing = new Map<string, number>();
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
  /** Everything placed on the map, grouped into squares that are hidden when far off. */
  private cells = new Map<string, THREE.Group>();
  private grassCells: THREE.InstancedMesh[] = [];
  private patches: Patch[] = [];
  private cullIn = 0;
  /** Ready-made trees to copy, so a forest shares a handful of shapes. */
  private treeShapes = new Map<string, THREE.Group[]>();
  private materials: Record<string, THREE.MeshStandardMaterial>;
  /** The server's clock (ms), for supply drops falling on their own schedule. */
  serverNow = () => Date.now();

  constructor(readonly seed: number) {
    this.scene.fog = new THREE.FogExp2(HAZE, 0.0085);

    // Shade is lit by the sky, so it runs cool and blue against the warm sun, with a little
    // warm light bounced up off the ground.
    this.hemi = new THREE.HemisphereLight(0xa9bad0, 0x4a3e32, 0.6);
    this.scene.add(this.hemi);
    // Firelight from torches and furnaces at night. A fixed set, so lighting one never makes
    // every material recompile; the brightest nearby fires get them.
    for (let n = 0; n < 4; n++) {
      const light = new THREE.PointLight(0xff9a48, 0, 16, 1.6);
      this.fires.push(light);
      this.scene.add(light);
    }
    this.sun = new THREE.DirectionalLight(0xffe0b8, 2.8);
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
      barrel: std({ ...barrel, roughness: 0.7, metalness: 0.5 }),
      pole: std({ ...bark, color: 0x8a7a6a, roughness: 0.95 }),
    };

    this.terrain = this.buildTerrain();
    this.scene.add(this.terrain);
    this.pickables.push(this.terrain);
    this.cameraBlockers.push(this.terrain);
    this.buildGrass();
    this.buildRadSigns();
    const decor = generateDecor(seed);
    for (const d of decor) this.addDecor(d);
    this.addLandmarks();
    this.patches = buildScenery(this.scene, seed, decor);
    this.ash = this.buildAsh();
  }

  private buildTerrain(): THREE.Mesh {
    const segments = 420;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    const colors = new Float32Array(pos.count * 3);
    /** How much each wild land claims the spot (Deadwood, mesa, flats, peaks); the rest is Ashlands. */
    const lands = new Float32Array(pos.count * 4);
    const ash = new THREE.Color(0xa49a8a);
    const scorched = new THREE.Color(0x4a443e);
    const glass = new THREE.Color(0x76806e);
    const pale = new THREE.Color(0xb8ae9c);
    const list = craters(this.seed);
    const c = new THREE.Color();
    const w = [0, 0, 0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, terrainHeight(this.seed, x, z));
      uv.setXY(i, x / 6, z / 6);
      biomeWeights(this.seed, x, z, w);
      let snow = w[4];
      c.copy(ash);
      for (const cr of list) {
        const d = Math.hypot(x - cr.x, z - cr.z) / cr.radius;
        if (d < 1) c.lerp(glass, (1 - d) * 0.7);
        else if (d < 1.6) c.lerp(scorched, (1 - (d - 1) / 0.6) * 0.75);
        // The blast melted the snow round each crater.
        if (d < 1.8) snow *= Math.min(1, Math.max(0, d - 1.2) / 0.6);
      }
      const n = Math.sin(x * 0.11 + Math.sin(z * 0.07) * 3) * Math.cos(z * 0.09 + x * 0.03);
      c.lerp(n > 0 ? pale : scorched, Math.abs(n) * 0.18);
      // The photos carry each land's colour, so the tints are relative to plain ash.
      colors.set([c.r / ash.r, c.g / ash.g, c.b / ash.b], i * 3);
      lands.set([w[1], w[2], w[3], snow], i * 4);
    }
    geo.setAttribute('land', new THREE.BufferAttribute(lands, 4));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    // The material's own maps only switch on three.js's normal mapping; the shader below
    // samples every land's photos from the texture arrays instead.
    const ground = groundSurface();
    const mat = new THREE.MeshStandardMaterial({
      map: ground.map,
      normalMap: ground.normalMap,
      roughnessMap: ground.roughnessMap,
      normalScale: new THREE.Vector2(1.2, 1.2),
      vertexColors: true,
      // The scanned earth is paler than the lighting was tuned for.
      color: new THREE.Color(0.62, 0.62, 0.62),
      roughness: 1,
    });
    const layers = terrainLayers();
    const macro = macroNoiseTexture();
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.layerDiff = { value: layers.diffuse };
      shader.uniforms.layerNorm = { value: layers.normal };
      shader.uniforms.macroMap = { value: macro };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;\nvarying vec3 vGroundNormal;\nattribute vec4 land;\nvarying vec4 vLand;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGroundNormal = normalize(mat3(modelMatrix) * objectNormal);\nvLand = land;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGroundPos;\nvarying vec3 vGroundNormal;\nvarying vec4 vLand;')
        .replace(
          '#include <map_pars_fragment>',
          `#include <map_pars_fragment>
          uniform highp sampler2DArray layerDiff;
          uniform highp sampler2DArray layerNorm;
          uniform sampler2D macroMap;
          // Layers in the arrays (see terrainLayers.ts).
          const float L_ASH = 0.0, L_FOREST = 1.0, L_RED = 2.0, L_LAKE = 3.0, L_SNOW = 4.0, L_CLIFF = 5.0, L_DIRT = 6.0;
          // Each photo at two scales and offsets, so its repeat never shows.
          vec4 groundPhoto(highp sampler2DArray t, vec2 uv, float layer) {
            return mix(texture(t, vec3(uv, layer)), texture(t, vec3(uv * 0.31 + vec2(0.17, 0.53), layer)), 0.4);
          }
          // A land's share at this pixel, nudged by noise of its own near its edges.
          float edgeNoise(float w, vec2 offset) {
            if (w < 0.001) return -1.0;
            float big = texture(macroMap, vGroundPos.xz * 0.0075 + offset).r;
            float small = texture(macroMap, vGroundPos.xz * 0.031 + offset.yx).r;
            return w + ((big - 0.5) * 0.75 + (small - 0.5) * 0.3) * smoothstep(0.0, 0.3, w) * smoothstep(1.0, 0.7, w);
          }
          // Shared by the colour and the bumps: how much each surface shows at this pixel.
          float gW[8];
          float gSteep;
          vec3 gNormal;`,
        )
        .replace(
          '#include <map_fragment>',
          `{
            vec2 uv = vGroundPos.xz / 2.4;
            vec4 macro = texture(macroMap, vGroundPos.xz * 0.0075);
            vec4 macro2 = texture(macroMap, vGroundPos.xz * 0.0022 + vec2(0.3, 0.6));
            vec4 macro3 = texture(macroMap, vGroundPos.xz * 0.03 + vec2(0.7, 0.2));
            // Where lands meet they interleave in ragged patches rather than fading evenly:
            // each land's share is pushed up or down by its own noise, then the strongest win.
            float wA = max(0.0, 1.0 - vLand.x - vLand.y - vLand.z - vLand.w);
            float hA = edgeNoise(wA, vec2(0.0, 0.0));
            float hF = edgeNoise(vLand.x, vec2(0.37, 0.11));
            float hM = edgeNoise(vLand.y, vec2(0.71, 0.53));
            float hL = edgeNoise(vLand.z, vec2(0.13, 0.82));
            float hS = edgeNoise(vLand.w, vec2(0.59, 0.29));
            float top = max(max(max(hA, hF), max(hM, hL)), hS) - 0.16;
            float bA = max(hA - top, 0.0);
            float bF = max(hF - top, 0.0);
            float bM = max(hM - top, 0.0);
            float bL = max(hL - top, 0.0);
            float bS = max(hS - top, 0.0);
            float sum = bA + bF + bM + bL + bS + 1e-5;
            bA /= sum; bF /= sum; bM /= sum; bL /= sum; bS /= sum;
            // Drifts of dusty dirt over the ash and the flats.
            float drift = smoothstep(0.5, 0.62, macro.r * 0.6 + macro2.r * 0.4);
            float dirtA = drift * bA;
            float dirtL = drift * bL * 0.6;
            // Bare rock on steep ground: cliffs, mesa sides, crater walls and ridges.
            vec3 gn = normalize(vGroundNormal);
            gSteep = smoothstep(0.8, 0.62, gn.y + (macro3.r - 0.5) * 0.12);
            float level = 1.0 - gSteep;
            gW[0] = (bA - dirtA) * level; gW[1] = bF * level; gW[2] = bM * level; gW[3] = (bL - dirtL) * level;
            gW[4] = bS * level; gW[5] = gSteep; gW[6] = (dirtA + dirtL) * level;
            vec3 col = vec3(0.0);
            vec3 nrm = vec3(0.0);
            if (gW[0] > 0.004) { col += groundPhoto(layerDiff, uv, L_ASH).rgb * gW[0]; nrm += groundPhoto(layerNorm, uv, L_ASH).xyz * gW[0]; }
            if (gW[1] > 0.004) {
              // A sickly forest floor: the grass in the photo drained towards brown.
              vec3 f = groundPhoto(layerDiff, uv * 0.8, L_FOREST).rgb;
              f = mix(vec3(dot(f, vec3(0.3, 0.55, 0.15))), f, 0.75) * vec3(0.92, 0.9, 0.78);
              col += f * gW[1]; nrm += groundPhoto(layerNorm, uv * 0.8, L_FOREST).xyz * gW[1];
            }
            if (gW[2] > 0.004) { col += groundPhoto(layerDiff, uv * 0.7, L_RED).rgb * vec3(1.12, 1.0, 0.92) * gW[2]; nrm += groundPhoto(layerNorm, uv * 0.7, L_RED).xyz * gW[2]; }
            if (gW[3] > 0.004) {
              // The old lake bed, bleached by salt, crazed with the ash's cracks in places.
              vec3 l = groundPhoto(layerDiff, uv * 0.6, L_LAKE).rgb;
              vec3 crack = groundPhoto(layerDiff, uv * 1.3, L_ASH).rgb;
              l = mix(l, crack, smoothstep(0.4, 0.7, macro3.r));
              l = mix(vec3(dot(l, vec3(0.3, 0.55, 0.15))), l, 0.45) * 1.55 + 0.05;
              col += l * gW[3]; nrm += mix(groundPhoto(layerNorm, uv * 0.6, L_LAKE), groundPhoto(layerNorm, uv * 1.3, L_ASH), smoothstep(0.4, 0.7, macro3.r)).xyz * gW[3];
            }
            if (gW[4] > 0.004) { col += groundPhoto(layerDiff, uv * 0.5, L_SNOW).rgb * 1.45 * gW[4]; nrm += mix(groundPhoto(layerNorm, uv * 0.5, L_SNOW).xyz, vec3(0.5, 0.5, 1.0), 0.4) * gW[4]; }
            if (gW[6] > 0.004) {
              vec3 d = groundPhoto(layerDiff, uv * 1.6, L_DIRT).rgb;
              // The scanned dirt is redder than this ashen land; pull it toward grey.
              d = mix(vec3(dot(d, vec3(0.3, 0.55, 0.15))), d, 0.55);
              col += d * gW[6]; nrm += groundPhoto(layerNorm, uv * 1.6, L_DIRT).xyz * gW[6];
            }
            if (gW[5] > 0.004) {
              // Cliff rock projected from the two sides, blended by facing, in layered bands.
              vec2 sx = vGroundPos.zy * 0.25;
              vec2 sz = vGroundPos.xy * 0.25;
              float ax = abs(gn.x) + 1e-4;
              float az = abs(gn.z) + 1e-4;
              vec3 rock = (texture(layerDiff, vec3(sx, L_CLIFF)).rgb * ax + texture(layerDiff, vec3(sz, L_CLIFF)).rgb * az) / (ax + az);
              rock *= 0.85 + 0.15 * sin(vGroundPos.y * 2.3 + sin(vGroundPos.x * 0.21 + vGroundPos.z * 0.17) * 2.0);
              // Grey rock under the snow, red on the mesa, ash-brown elsewhere.
              float grey = dot(rock, vec3(0.3, 0.55, 0.15));
              vec3 tint = mix(vec3(grey) * 1.05, rock * vec3(1.15, 0.95, 0.85), bM);
              tint = mix(tint, vec3(grey) * vec3(0.95, 0.98, 1.05), bS);
              col += tint * 1.1 * gW[5];
              nrm += ((texture(layerNorm, vec3(sx, L_CLIFF)).xyz * ax + texture(layerNorm, vec3(sz, L_CLIFF)).xyz * az) / (ax + az)) * gW[5];
            }
            // Snow settles on ledges even on the rock.
            float snowCap = bS * gSteep * smoothstep(0.45, 0.75, gn.y + macro3.r * 0.3);
            col = mix(col, groundPhoto(layerDiff, uv * 0.5, L_SNOW).rgb * 1.4, snowCap);
            col *= mix(0.82, 1.12, macro2.r) * mix(0.93, 1.05, macro.r);
            gNormal = nrm;
            diffuseColor.rgb *= col;
          }`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#ifdef USE_NORMALMAP_TANGENTSPACE
            vec3 mapN = gNormal * 2.0 - 1.0;
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

  /** Warning signs round each radioactive crater, facing out so you see them on the way in. */
  private buildRadSigns() {
    for (const zone of radZones(this.seed)) {
      for (let n = 0; n < 5; n++) {
        const a = (n / 5) * Math.PI * 2 + zone.x * 0.1;
        const x = zone.x + Math.cos(a) * zone.radius;
        const z = zone.z + Math.sin(a) * zone.radius;
        const sign = buildRadSign();
        sign.position.set(x, terrainHeight(this.seed, x, z) - 0.05, z);
        sign.rotation.y = Math.atan2(Math.cos(a), Math.sin(a));
        this.scene.add(sign);
      }
    }
  }

  private buildGrass() {
    // Four photo-scanned clumps of dry grass, each drawn from three sides into one card (see
    // CREDITS.md). The painted tuft stands in if the file doesn't load.
    const mat = new THREE.MeshStandardMaterial({ alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
    /** Clumps side by side in the texture; each tuft shows one of them. */
    const cards = { value: 4 };
    mat.map = new THREE.TextureLoader().load('/models/grass-cards.png', undefined, undefined, () => {
      mat.map = grassTexture();
      cards.value = 1;
      mat.needsUpdate = true;
    });
    mat.map.colorSpace = THREE.SRGBColorSpace;
    mat.map.anisotropy = 4;
    // Tufts sway in gusts: the tips move, the roots stay put, and each clump is out of step.
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.windTime = this.windTime;
      shader.uniforms.cards = cards;
      // Double-sided materials flip the normal on back faces, which points it into the ground
      // and turns every blade seen from behind black. Keep the upward normal on both sides.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
        // Darker down among the roots, where the tuft shades itself. Thin blades would vanish in
        // the distance as the texture shrinks; sharpening the cut-out edge keeps them solid.
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          diffuseColor.rgb *= mix(0.5, 1.05, smoothstep(0.0, 0.55, vMapUv.y));
          diffuseColor.a = (diffuseColor.a - 0.5) / max(fwidth(diffuseColor.a), 0.0001) + 0.5;`,
        );
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float windTime;\nuniform float cards;\nattribute float card;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv.x = (vMapUv.x + mod(card, cards)) / cards;')
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
    const blade = new THREE.PlaneGeometry(0.75, 0.75);
    blade.translate(0, 0.36, 0);
    // Three cards at 60 degrees, so a tuft looks full from every side.
    const cross = mergeCards([0, 1, 2].map((k) => blade.clone().rotateY((k * Math.PI) / 3)));
    // Point every normal up so the tufts are lit like the ground instead of going black edge-on.
    const n = cross.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    // Laid out in squares, each its own mesh, so only the grass round the player is drawn.
    // How thick it grows in each land, and its colour: green-grey in the forest, burnt on the
    // mesa, a few dead tufts on the flats, buried under the snow on the peaks.
    const density = [1, 1.7, 0.35, 0.08, 0];
    const greens = [new THREE.Color(1, 1, 1), new THREE.Color(0.78, 0.92, 0.62), new THREE.Color(1.15, 0.85, 0.62), new THREE.Color(1.1, 1.05, 0.9), new THREE.Color(1, 1, 1)];
    const rand = mulberry32(this.seed ^ 0xabcdef);
    const tint = new THREE.Color();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const w = [0, 0, 0, 0, 0];
    const half = WORLD_SIZE * 0.45;
    const perCell = Math.round(0.95 * GRASS_CELL * GRASS_CELL);
    for (let cx = -half; cx < half; cx += GRASS_CELL) {
      for (let cz = -half; cz < half; cz += GRASS_CELL) {
        const card = new Float32Array(perCell);
        const geo = cross.clone();
        geo.setAttribute('card', new THREE.InstancedBufferAttribute(card, 1));
        const mesh = new THREE.InstancedMesh(geo, mat, perCell);
        let placed = 0;
        for (let n = 0; n < perCell * 3 && placed < perCell; n++) {
          const x = cx + rand() * GRASS_CELL;
          const z = cz + rand() * GRASS_CELL;
          biomeWeights(this.seed, x, z, w);
          let thick = 0;
          for (let b = 0; b < 5; b++) thick += w[b] * density[b];
          if (rand() > thick / 1.7) continue;
          // Thick in the patches, thinning out around them, with the odd lone tuft elsewhere.
          // The forest floor is more evenly covered.
          const patch = Math.sin(x * 0.08) * Math.cos(z * 0.06) + Math.sin((x + z) * 0.05) + w[1] * 0.9;
          if (patch < 0.3 && rand() > Math.max(0.04, (patch + 0.2) * 1.4)) continue;
          const y = terrainHeight(this.seed, x, z);
          if (y < 1 || steepAt(this.seed, x, z, y)) continue;
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI);
          const k = (0.55 + rand() * 0.9) * (1 + w[1] * 0.25);
          s.set(k * (0.9 + rand() * 0.3), k * (0.75 + rand() * 0.5), k);
          p.set(x, y - 0.02, z);
          // Each tuft a little drier or greener, lighter or darker than its neighbours.
          const dry = rand();
          tint.setRGB(1.0 + dry * 0.15, 0.9 + dry * 0.06, 0.68 + dry * 0.06).multiplyScalar(0.85 + rand() * 0.3);
          let gr = 0;
          let gg = 0;
          let gb = 0;
          for (let b = 0; b < 5; b++) {
            gr += greens[b].r * w[b];
            gg += greens[b].g * w[b];
            gb += greens[b].b * w[b];
          }
          tint.r *= gr;
          tint.g *= gg;
          tint.b *= gb;
          mesh.setColorAt(placed, tint);
          card[placed] = Math.floor(rand() * 4);
          mesh.setMatrixAt(placed++, m.compose(p, q, s));
        }
        if (placed === 0) {
          geo.dispose();
          continue;
        }
        mesh.count = placed;
        mesh.receiveShadow = true;
        // The occlusion pass would shade each card as a solid square.
        mesh.userData.noAO = true;
        mesh.userData.centre = new THREE.Vector3(cx + GRASS_CELL / 2, 0, cz + GRASS_CELL / 2);
        mesh.computeBoundingSphere();
        this.scene.add(mesh);
        this.grassCells.push(mesh);
      }
    }
  }

  /** The square of the map a spot is in, for things that show out to `view` metres, made on first use. */
  private cellAt(x: number, z: number, view = VIEW): THREE.Group {
    const i = Math.floor(x / CELL);
    const j = Math.floor(z / CELL);
    const key = `${i},${j},${view}`;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = new THREE.Group();
      cell.userData.centre = new THREE.Vector3((i + 0.5) * CELL, 0, (j + 0.5) * CELL);
      cell.userData.view = view;
      this.cells.set(key, cell);
      this.scene.add(cell);
    }
    return cell;
  }

  /** Hides the squares too far off to see through the haze, and the grass beyond a short way. */
  private cull(focus: THREE.Vector3) {
    const flat = (v: THREE.Vector3) => Math.hypot(v.x - focus.x, v.z - focus.z);
    for (const cell of this.cells.values()) cell.visible = flat(cell.userData.centre) < cell.userData.view + CELL * 0.71;
    for (const g of this.grassCells) g.visible = flat(g.userData.centre) < GRASS_VIEW + GRASS_CELL * 0.71;
    for (const p of this.patches) {
      const far = flat(p.centre);
      p.mesh.visible = far < p.view;
      // Batches of scanned logs, stumps and bushes a good way off draw a lighter shape.
      if (p.low && p.mesh.visible) (p.mesh as THREE.Mesh).geometry = far > p.lowFrom! ? p.low : p.full!;
    }
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
      new THREE.PointsMaterial({ size: 0.04, map: dotTexture(), color: 0xe8e2d8, transparent: true, opacity: 0.55, depthWrite: false }),
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
    const solid = <T extends THREE.Object3D>(mesh: T, collide: boolean) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      if (collide) this.cameraBlockers.push(mesh);
      return mesh;
    };
    if (d.kind === 'ruin' && model('ruin-a')) {
      this.scannedRuin(g, d, rand);
    } else if (d.kind === 'ruin') {
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
    } else if (d.kind === 'rock' && model(BOULDERS[0])) {
      const rock = solid(scannedRock(rand, new THREE.Color(1, 1, 1))!, d.scale > 1);
      rock.scale.setScalar(d.scale);
      rock.position.y = -0.1 * d.scale;
      if (d.scale > 1) {
        const r = d.scale * 0.7;
        this.decorColliders.push({ min: [d.x - r, d.y - 1, d.z - r], max: [d.x + r, d.y + d.scale * 0.8, d.z + r] });
      }
    } else if (d.kind === 'rock') {
      const { geo, cavity } = rockGeometry(rand, { detail: d.scale > 1 ? 4 : 3, stretch: [1.2, 0.75, 1], cuts: 5 });
      paintRock(geo, cavity, new THREE.Color(0x8a8278), rand);
      const rock = solid(new THREE.Mesh(geo, rockMaterial('decor-rock', { vertexColors: true })), d.scale > 1);
      rock.scale.setScalar(d.scale);
      rock.position.y = d.scale * 0.25;
      if (d.scale > 1) {
        const r = d.scale * 0.7;
        this.decorColliders.push({ min: [d.x - r, d.y - 1, d.z - r], max: [d.x + r, d.y + d.scale * 0.8, d.z + r] });
      }
    } else {
      const tipped = rand() < 0.4;
      const scan = model('barrel');
      if (scan) {
        const barrel = solid(new THREE.Mesh(scan.geometry, scan.material), false);
        // The scan stands on its base; tipped over, it lies on its side.
        if (tipped) {
          barrel.rotation.z = Math.PI / 2;
          barrel.position.set(0.45, 0.3, 0);
        }
      } else {
        const barrel = solid(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14), this.materials.barrel), false);
        barrel.position.y = tipped ? 0.3 : 0.45;
        if (tipped) barrel.rotation.z = Math.PI / 2;
      }
    }
    const view = d.kind === 'ruin' ? VIEW : d.kind === 'pole' || (d.kind === 'rock' && d.scale > 1) ? VIEW_MEDIUM : VIEW_SMALL;
    this.cellAt(d.x, d.z, view).add(g);
  }

  /**
   * A ruin built from scans: the gutted concrete frame, the broken stairwell block, or the
   * graffiti wall, each with a heap of broken concrete and loose chunks around it. Turned to a
   * quarter turn so its colliders, which are boxes along the world axes, fit it closely.
   */
  private scannedRuin(g: THREE.Group, d: Decor, rand: () => number) {
    g.rotation.y = Math.round(d.rot / (Math.PI / 2)) * (Math.PI / 2);
    const place = (m: Model, x: number, z: number, turn = 0, scale = 1, collide = true, detail = true) => {
      const mesh = detail ? scanMesh(m.geometry, m.material) : new THREE.Mesh(m.geometry, m.material);
      mesh.position.set(x, -0.15 * scale, z);
      mesh.rotation.y = turn;
      mesh.scale.setScalar(scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      g.add(mesh);
      if (collide) this.cameraBlockers.push(mesh);
      return mesh;
    };
    /** An invisible wall for walking into, in the ruin's own space. */
    const block = (x: number, z: number, w: number, h: number, depth: number) => {
      const o = new THREE.Mesh();
      o.position.set(x, h / 2, z);
      g.add(o);
      this.pushCollider(g, o, w, h, depth);
    };
    const pile = model('rubble-pile');
    const kind = d.variant % 3;
    if (kind === 0) {
      // The concrete frame: walk in through the gaps in the middle of each side.
      const frame = model('ruin-a')!;
      place(frame, 0, 0, d.variant % 2 ? Math.PI : 0);
      const size = frame.geometry.boundingBox!.getSize(new THREE.Vector3());
      const [w, l, h] = [size.x, size.z, size.y];
      for (const s of [-1, 1]) {
        for (const e of [-1, 1]) {
          block((s * w) / 4 + (s * 1.5) / 2, (e * l) / 2, w / 2 - 1.5, h, 0.5);
          block((e * w) / 2, (s * l) / 4 + (s * 1.5) / 2, 0.5, h, l / 2 - 1.5);
        }
      }
      if (pile) place(pile, w / 2 + 2.5, (rand() - 0.5) * l * 0.6, rand() * 6, 0.8 + rand() * 0.3, false);
    } else if (kind === 1 && model('ruin-b')) {
      // The stairwell block, solid to walk into, with its fallen front piled up beside it.
      const tower = model('ruin-b')!;
      place(tower, 0, 0);
      const size = tower.geometry.boundingBox!.getSize(new THREE.Vector3());
      block(0, 0, size.x * 0.9, size.y, size.z * 0.9);
      if (pile) place(pile, (rand() - 0.5) * size.x, size.z / 2 + 2.6, rand() * 6, 0.9 + rand() * 0.3, false);
    } else {
      // A lone graffiti-covered wall, all that is left standing, with the rest heaped beside it.
      const wall = model('ruin-wall') ?? model('ruin-a')!;
      place(wall, 0, 0);
      const size = wall.geometry.boundingBox!.getSize(new THREE.Vector3());
      block(0, 0, size.x * 0.85, 3, 0.8);
      if (pile) place(pile, (rand() - 0.5) * 2, size.z / 2 + 3, rand() * 6, 1 + rand() * 0.3, false);
    }
    // Loose chunks of concrete kicked out across the ground.
    const chunks = variants('rubble-chunks');
    for (let n = 0; n < 14 && chunks.length; n++) {
      const a = rand() * Math.PI * 2;
      const r = 5 + rand() * 6;
      const chunk = place(chunks[n % chunks.length], Math.cos(a) * r, Math.sin(a) * r, rand() * 6, 0.6 + rand() * 1.4, false, false);
      chunk.position.y = -0.05;
    }
  }

  /**
   * The landmark in each land: its scanned buildings and props laid out on the levelled pad,
   * with their solid parts to walk into, and junk kicked about between them.
   */
  private addLandmarks() {
    for (const { site, landmark } of landmarks(this.seed)) {
      const rand = mulberry32(site.land * 9973 + 17);
      for (const prop of landmark.props) {
        const [x, z] = toWorld(site, prop.x, prop.z);
        const turn = prop.turn + site.turn;
        const scan = model(prop.model);
        let mesh: THREE.Mesh;
        if (scan) mesh = new THREE.Mesh(scan.geometry, scan.material);
        else {
          // A plain block where the model would be, if it failed to load.
          const [x0, x1, z0, z1, h] = prop.solid?.[0] ?? [-1, 1, -1, 1, 1];
          mesh = new THREE.Mesh(worldBox(x1 - x0, h, z1 - z0, 2), this.materials.concrete);
          mesh.geometry.translate((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
        }
        mesh.position.set(x, site.y + (prop.y ?? 0) - 0.02, z);
        mesh.rotation.y = (turn * Math.PI) / 2;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);
        if (prop.solid) this.cameraBlockers.push(mesh);
        for (const [x0, x1, z0, z1, h] of prop.solid ?? []) {
          // Turn the box's corners with the prop, then the landmark, and take their bounds.
          const turned = { ...site, x, z, turn };
          const a = toWorld(turned, x0, z0);
          const b = toWorld(turned, x1, z1);
          const y = site.y + (prop.y ?? 0);
          this.decorColliders.push({ min: [Math.min(a[0], b[0]), y - 0.5, Math.min(a[1], b[1])], max: [Math.max(a[0], b[0]), y + h, Math.max(a[1], b[1])] });
        }
      }
      // Loose stones, a few old tyres and barrels lying about.
      const stones = variants('stones');
      const tyre = model('tyre');
      const barrel = model('barrel');
      for (let n = 0; n < 22; n++) {
        const a = rand() * Math.PI * 2;
        const r = 4 + rand() * 18;
        const piece = n < 3 ? tyre : n < 5 ? barrel : stones[Math.floor(rand() * stones.length)];
        if (!piece) continue;
        const m = new THREE.Mesh(piece.geometry, piece.material);
        const px = site.x + Math.cos(a) * r;
        const pz = site.z + Math.sin(a) * r;
        if (this.decorColliders.some((c) => px > c.min[0] - 0.5 && px < c.max[0] + 0.5 && pz > c.min[2] - 0.5 && pz < c.max[2] + 0.5)) continue;
        m.position.set(px, site.y - 0.04, pz);
        m.rotation.y = rand() * Math.PI * 2;
        m.scale.setScalar(piece === tyre || piece === barrel ? 1 : 1 + rand() * 1.5);
        m.castShadow = true;
        m.receiveShadow = true;
        this.scene.add(m);
      }
    }
  }

  /**
   * A supply drop swinging gently down under its parachute, which folds away once it lands.
   */
  private drift(g: THREE.Group, d: Deployable, fall: NonNullable<Deployable['fall']>, time: number) {
    const k = Math.min(1, Math.max(0, (this.serverNow() - fall.start) / (fall.land - fall.start)));
    g.position.y = fall.from + (d.y - fall.from) * k;
    const sway = (1 - k) * 0.07;
    g.rotation.set(Math.sin(time * 1.1) * sway, d.rot, Math.cos(time * 0.9) * sway);
    const chute = g.getObjectByName('chute');
    if (chute) chute.visible = k < 1;
  }

  /** Registers a box-shaped mesh inside a rotated group as an axis-aligned collider. */
  private pushCollider(g: THREE.Group, mesh: THREE.Object3D, w: number, h: number, d: number) {
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

  /** The nearest standing resource of this kind within `range` of a spot, or null. */
  nearest(kind: ResourceNode['kind'], at: THREE.Vector3, range: number): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestD = range * range;
    for (const g of this.resourceMeshes.values()) {
      if (g.userData.kind !== kind || !g.visible) continue;
      const d = g.position.distanceToSquared(at);
      if (d < bestD) [best, bestD] = [g.position, d];
    }
    return best;
  }

  addResources(nodes: ResourceNode[]) {
    for (const node of nodes) {
      const rand = mulberry32(node.id * 7 + 3);
      const g =
        node.kind === 'tree'
          ? this.treeShape('tree', node.id)
          : node.kind === 'deadTree'
            ? this.treeShape('deadTree', node.id)
            : node.kind === 'scrap'
              ? this.wreck(rand)
              : node.kind === 'hemp'
                ? this.smallShape('hemp', node.id, buildHemp)
                : node.kind === 'mushroom'
                  ? this.smallShape('mushroom', node.id, buildMushrooms)
                  : node.kind === 'waterBarrel'
                    ? buildWaterBarrel()
                    : buildBoulder(rand, node.kind);
      // A barrel stays put when drunk dry; only its water level changes.
      if (node.kind === 'waterBarrel') g.userData.keep = true;
      g.position.set(node.x, node.y, node.z);
      g.rotation.y = node.rot;
      g.scale.setScalar(node.scale);
      g.userData.baseScale = node.scale;
      g.userData.kind = node.kind;
      g.traverse((o) => {
        o.userData.resourceId = node.id;
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      const view =
        node.kind === 'tree' || node.kind === 'deadTree'
          ? VIEW
          : node.kind === 'hemp' || node.kind === 'mushroom' || node.kind === 'waterBarrel'
            ? VIEW_SMALL
            : VIEW_MEDIUM;
      this.cellAt(node.x, node.z, view).add(g);
      this.resourceMeshes.set(node.id, g);
      this.pickables.push(g);
      this.setResourceAmount(node.id, node.amount);
    }
  }

  setResourceAmount(id: number, amount: number) {
    const g = this.resourceMeshes.get(id);
    if (!g) return;
    if (g.userData.keep) {
      g.userData.setLevel?.(amount / RESOURCE_INFO.waterBarrel.amount);
      return;
    }
    const was = g.visible;
    g.visible = amount > 0;
    if (was && g.visible) this.bounce.set(id, 0.25);
  }

  /**
   * A copy of one of a dozen ready-made trees. Each is merged down to a mesh per material, as a
   * forest of trees built limb by limb would take thousands of draw calls.
   */
  private treeShape(kind: 'tree' | 'deadTree', id: number): THREE.Group {
    let shapes = this.treeShapes.get(kind);
    if (!shapes) {
      shapes = [];
      for (let n = 0; n < 12; n++) {
        const rand = mulberry32(n * 7 + 3 + (kind === 'tree' ? 0 : 500));
        shapes.push(mergeByMaterial(kind === 'tree' ? this.livingTree(rand) : this.deadTree(rand)));
      }
      this.treeShapes.set(kind, shapes);
    }
    return shapes[id % shapes.length].clone();
  }

  /**
   * A copy of one of a dozen hemp clumps or mushroom patches, merged to a mesh per material:
   * built leaf by leaf, each clump would be dozens of draw calls.
   */
  private smallShape(kind: 'hemp' | 'mushroom', id: number, make: (rand: () => number) => THREE.Group): THREE.Group {
    let shapes = this.treeShapes.get(kind);
    if (!shapes) {
      shapes = [];
      for (let n = 0; n < 12; n++) shapes.push(mergeByMaterial(make(mulberry32(n * 13 + (kind === 'hemp' ? 900 : 1300)))));
      this.treeShapes.set(kind, shapes);
    }
    return shapes[id % shapes.length].clone();
  }

  /**
   * A tapering limb that forks into smaller ones. Each limb starts as wide as its parent is at
   * that height, so joints don't step. Tips are collected so leaves can hang off them.
   */
  private branch(parent: THREE.Object3D, mat: THREE.Material, len: number, radius: number, depth: number, rand: () => number, tips?: THREE.Object3D[]) {
    const top = radius * (depth > 0 ? 0.62 : 0.3);
    const geo = new THREE.CylinderGeometry(top, radius, len, depth > 1 ? 9 : 6, 4);
    geo.translate(0, len / 2, 0);
    // A slight random bend so limbs aren't ruler-straight.
    const p = geo.attributes.position;
    const bendX = (rand() - 0.5) * 0.18 * len;
    const bendZ = (rand() - 0.5) * 0.18 * len;
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) / len;
      const k = Math.sin(t * Math.PI);
      p.setXYZ(i, p.getX(i) + bendX * k, p.getY(i), p.getZ(i) + bendZ * k);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    parent.add(mesh);
    if (depth <= 0) {
      const tip = new THREE.Object3D();
      tip.position.y = len;
      mesh.add(tip);
      tips?.push(tip);
      return mesh;
    }
    const kids = 2 + Math.floor(rand() * 2);
    for (let n = 0; n < kids; n++) {
      const pivot = new THREE.Group();
      const at = 0.55 + rand() * 0.4;
      pivot.position.set(bendX * Math.sin(at * Math.PI), len * at, bendZ * Math.sin(at * Math.PI));
      pivot.rotation.set((rand() - 0.5) * 0.4, (n / kids) * Math.PI * 2 + rand() * 1.2, 0.45 + rand() * 0.5);
      mesh.add(pivot);
      this.branch(pivot, mat, len * (0.5 + rand() * 0.2), (radius + (top - radius) * at) * 0.72, depth - 1, rand, tips);
    }
    return mesh;
  }

  private leafMat?: THREE.MeshStandardMaterial;

  /** Leaf cards: cut-out sprays of leaves that sway, lit as if the crown were one soft ball. */
  private foliageMaterial(): THREE.MeshStandardMaterial {
    if (this.leafMat) return this.leafMat;
    const m = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, color: 0xdedcc8 });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.windTime = this.windTime;
      // Keep the crown's outward normals on both sides of each card (see the grass for why).
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
        // Light through the leaves: the shaded side of a crown still glows a little.
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vec3(0.05, 0.06, 0.02);');
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float windTime;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 rootW = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float h = max(0.0, position.y - 1.5);
        float gust = sin(windTime * 0.9 + rootW.x * 0.11 + rootW.z * 0.05) * 0.5 + 0.5;
        float flutter = sin(windTime * 4.0 + position.x * 3.0 + position.z * 2.0) * 0.025;
        transformed.x += (sin(windTime * 1.7 + rootW.z * 0.3) * (0.03 + gust * 0.05) + flutter) * h;
        transformed.z += (cos(windTime * 1.3 + rootW.x * 0.3) * 0.02 + flutter) * h;`,
      );
    };
    return (this.leafMat = m);
  }

  private livingTree(rand: () => number): THREE.Group {
    const g = new THREE.Group();
    const tips: THREE.Object3D[] = [];
    const trunk = this.branch(g, this.materials.bark, 2.4 + rand() * 0.8, 0.28, 3, rand, tips);
    trunk.rotation.z = (rand() - 0.5) * 0.1;
    // Root flare: a short wide cone where the trunk meets the ground.
    const flare = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, 0.45, 9, 1, true).translate(0, 0.2, 0), this.materials.bark);
    g.add(flare);
    g.updateMatrixWorld(true);
    // A spray of crossed leaf cards at every twig tip, merged into one mesh per tree.
    const crown = new THREE.Vector3();
    const points = tips.map((t) => t.getWorldPosition(new THREE.Vector3()));
    for (const pt of points) crown.add(pt);
    crown.divideScalar(Math.max(1, points.length));
    crown.y -= 0.4;
    const cards: THREE.BufferGeometry[] = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    // The sickliest trees keep only some of their leaves.
    const keep = 0.65 + rand() * 0.35;
    for (const pt of points) {
      if (rand() > keep) continue;
      const size = 1.5 + rand() * 0.9;
      for (let n = 0; n < 3; n++) {
        const card = new THREE.PlaneGeometry(size, size);
        e.set(rand() * Math.PI, (n / 3) * Math.PI + rand() * 0.5, rand() * Math.PI);
        card.applyQuaternion(q.setFromEuler(e));
        card.translate(pt.x, pt.y, pt.z);
        cards.push(card);
      }
    }
    if (cards.length) {
      const geo = mergeCards(cards);
      // Normals point out from the crown's centre, so light falls across it like a soft ball.
      const pos = geo.attributes.position;
      const nrm = geo.attributes.normal;
      const v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).sub(crown);
        v.y *= 1.4;
        v.normalize();
        nrm.setXYZ(i, v.x, v.y, v.z);
      }
      const leaves = new THREE.Mesh(geo, this.foliageMaterial());
      leaves.userData.noAO = true;
      g.add(leaves);
    }
    return g;
  }

  private deadTree(rand: () => number): THREE.Group {
    const g = new THREE.Group();
    const trunk = this.branch(g, this.materials.barkDark, 2.4 + rand(), 0.22, 3, rand);
    trunk.rotation.z = (rand() - 0.5) * 0.25;
    const flare = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.4, 0.4, 9, 1, true).translate(0, 0.18, 0), this.materials.barkDark);
    g.add(flare);
    return g;
  }

  /** A rusted-out old car, with a loose sheet of scrap lying beside it. */
  private wreck(rand: () => number): THREE.Group {
    const scan = model(WRECKS[Math.floor(rand() * WRECKS.length)]);
    let g: THREE.Group;
    if (scan) {
      g = new THREE.Group();
      const car = scanMesh(scan.geometry, scan.material);
      // Settled into the dirt, sometimes facing the other way.
      car.position.y = -0.05;
      if (rand() < 0.5) car.rotation.y = Math.PI;
      g.add(car);
    } else g = buildCar(rand);
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
    if (piece.door) g.add(this.doorFor(key, piece));
    else this.doorSwing.delete(key);
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
    g.userData.setGrow?.(d);
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

  /** The door hung in a doorway, on a hinge at the doorway's edge, swung as far as it had got. */
  private doorFor(key: string, piece: Piece): THREE.Group {
    const door = piece.door!;
    const hinge = new THREE.Group();
    const x0 = piece.i * TILE;
    const z0 = piece.k * TILE;
    if (piece.dir === 0) hinge.position.set(x0 + DOORWAY.from, piece.y, z0);
    else hinge.position.set(x0, piece.y, z0 + DOORWAY.from);
    const leaf = buildDoorLeaf(door.kind, door.locked);
    leaf.traverse((o) => (o.userData.door = true));
    hinge.add(leaf);
    hinge.userData.base = piece.dir === 0 ? 0 : -Math.PI / 2;
    hinge.userData.open = door.open ? 1 : 0;
    hinge.name = 'door';
    const swing = this.doorSwing.get(key) ?? hinge.userData.open;
    this.doorSwing.set(key, swing);
    hinge.rotation.y = hinge.userData.base - swing * (Math.PI / 2);
    return hinge;
  }

  /** Damaged pieces get darker, so you can see a wall is about to break. */
  private pieceMaterial(piece: Piece): THREE.Material {
    const base = painted(this.materials[piece.material], piece.paint ?? 0);
    const health = piece.hp / MAX_HP[piece.material];
    if (health >= 0.999) return base;
    const m = base.clone();
    // Cloning drops the paint's shader change; keep it.
    m.onBeforeCompile = base.onBeforeCompile;
    m.customProgramCacheKey = base.customProgramCacheKey;
    m.color.multiplyScalar(0.45 + 0.55 * health);
    return m;
  }

  /** Keeps shadows sharp around the player, drifts the ash and animates hit bounces. */
  /**
   * The whole world photographed from straight above in daylight, as a square canvas `size`
   * pixels across with +x to the right and +z down: the picture the map is drawn on. Rendered
   * in tiles through the game's own canvas, so it gets the same lighting and tone mapping.
   */
  aerial(renderer: THREE.WebGLRenderer, hide: THREE.Object3D[] = [], size = 1000): HTMLCanvasElement {
    const tiles = 4;
    const px = Math.ceil(size / tiles);
    const out = document.createElement('canvas');
    out.width = out.height = px * tiles;
    const ctx = out.getContext('2d')!;
    const canvas = renderer.domElement;
    const ratio = renderer.getPixelRatio();
    // Everything shown, nothing in the air, no haze, and a high, even sun with no shadow map.
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      const loose = (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite;
      if (loose && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    });
    const shown: THREE.Object3D[] = [];
    for (const o of [...this.cells.values(), ...this.grassCells, ...this.patches.map((p) => p.mesh)]) {
      if (!o.visible) {
        o.visible = true;
        shown.push(o);
      }
    }
    // The sky goes too, so any ground past the land's edge reads as dark earth rather than haze.
    for (const o of hide) {
      if (o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    }
    const background = this.scene.background;
    this.scene.background = new THREE.Color(0x3a332b);
    const fog = this.scene.fog;
    this.scene.fog = null;
    const sunWas = this.sun.visible;
    this.sun.visible = false;
    const hemiWas = this.hemi.intensity;
    this.hemi.intensity = 0.9;
    const fires = this.fires.map((f) => f.intensity);
    for (const f of this.fires) f.intensity = 0;
    const exposure = renderer.toneMappingExposure;
    renderer.toneMappingExposure = 1.05;
    const light = new THREE.DirectionalLight(0xfff0dc, 2.7);
    light.position.set(-0.55, 1, -0.35);
    this.scene.add(light);
    const tile = WORLD_SIZE / tiles;
    const cam = new THREE.OrthographicCamera(-tile / 2, tile / 2, tile / 2, -tile / 2, 1, 900);
    cam.up.set(0, 0, -1);
    renderer.setScissorTest(true);
    renderer.setViewport(0, 0, px, px);
    renderer.setScissor(0, 0, px, px);
    for (let ty = 0; ty < tiles; ty++) {
      for (let tx = 0; tx < tiles; tx++) {
        const cx = -WORLD_SIZE / 2 + (tx + 0.5) * tile;
        const cz = -WORLD_SIZE / 2 + (ty + 0.5) * tile;
        cam.position.set(cx, 400, cz);
        cam.lookAt(cx, 0, cz);
        cam.updateMatrixWorld();
        renderer.render(this.scene, cam);
        ctx.drawImage(canvas, 0, canvas.height - px * ratio, px * ratio, px * ratio, tx * px, ty * px, px, px);
      }
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, Math.floor(canvas.width / ratio), Math.floor(canvas.height / ratio));
    this.scene.remove(light);
    light.dispose();
    renderer.toneMappingExposure = exposure;
    this.fires.forEach((f, n) => (f.intensity = fires[n]));
    this.hemi.intensity = hemiWas;
    this.sun.visible = sunWas;
    this.scene.fog = fog;
    this.scene.background = background;
    for (const o of shown) o.visible = false;
    for (const o of hidden) o.visible = true;
    return out;
  }

  update(dt: number, focus: THREE.Vector3, time: number) {
    this.windTime.value = time;
    this.sun.position.copy(focus).addScaledVector(SUN_DIRECTION, 80);
    this.sun.target.position.copy(focus);
    this.cullIn -= dt;
    if (this.cullIn <= 0) {
      this.cullIn = 0.3;
      this.cull(focus);
    }

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

    // Doors swing towards open or shut; lit charges spark and blink.
    for (const [key, swing] of this.doorSwing) {
      const hinge = this.pieceMeshes.get(key)?.getObjectByName('door');
      if (!hinge) continue;
      const target = hinge.userData.open as number;
      if (swing === target) continue;
      const next = swing + Math.sign(target - swing) * Math.min(Math.abs(target - swing), dt * 3.5);
      this.doorSwing.set(key, next);
      hinge.rotation.y = hinge.userData.base - next * (Math.PI / 2);
    }
    for (const [id, g] of this.deployableMeshes) {
      g.userData.tick?.(time);
      const fall = this.deployables.get(id)?.fall;
      if (fall) this.drift(g, this.deployables.get(id)!, fall, time);
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
  g.userData.pieceKey = pieceKey(piece);
  const cx = (piece.i + 0.5) * TILE;
  const cz = (piece.k + 0.5) * TILE;
  if (piece.kind === 'ramp') {
    // One smooth slab from the low edge to the high one (you walk it like stairs).
    const run = Math.hypot(TILE, STOREY);
    const slab = new THREE.Mesh(worldBox(TILE, THICK, run), material);
    slab.position.set(cx, piece.y + STOREY / 2 - THICK / 2, cz);
    slab.rotation.order = 'YXZ';
    slab.rotation.y = (piece.dir * Math.PI) / 2;
    slab.rotation.x = Math.atan2(STOREY, TILE);
    g.add(slab);
    return g;
  }
  if (piece.kind === 'roof') {
    // A low four-sided pyramid with a little overhang.
    const geo = new THREE.ConeGeometry((TILE / 2) * Math.SQRT2 * 1.06, ROOF_RISE, 4, 1, false, Math.PI / 4);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let n = 0; n < uv.count; n++) uv.setXY(n, uv.getX(n) * 2.4, uv.getY(n) * 1.4);
    const roof = new THREE.Mesh(geo, material);
    roof.position.set(cx, piece.y + ROOF_RISE / 2, cz);
    g.add(roof);
    return g;
  }
  for (const b of pieceBoxes(piece, false)) {
    const w = b.max[0] - b.min[0];
    const h = b.max[1] - b.min[1];
    const d = b.max[2] - b.min[2];
    const mesh = new THREE.Mesh(worldBox(w, h, d), material);
    mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    g.add(mesh);
  }
  return g;
}

/** Joins plane geometries (position, normal, uv only) into one. */
/** True where the ground is too steep for grass and loose things to lie (cliffs, crater walls). */
function steepAt(seed: number, x: number, z: number, y: number): boolean {
  return Math.hypot(terrainHeight(seed, x + 0.8, z) - y, terrainHeight(seed, x, z + 0.8) - y) > 0.8;
}

/** One mesh per material in place of a whole tree of them (keeping each part's noAO flag). */
function mergeByMaterial(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const parts = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; noAO: boolean }>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.Material;
    const geo = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrixWorld);
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
    const entry = parts.get(mat) ?? { geos: [], noAO: !!mesh.userData.noAO };
    entry.geos.push(geo);
    parts.set(mat, entry);
  });
  const g = new THREE.Group();
  for (const [mat, { geos, noAO }] of parts) {
    const merged = mergeGeometries(geos);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.userData.noAO = noAO;
    g.add(mesh);
  }
  return g;
}

function mergeCards(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const count = parts.reduce((n, p) => n + p.attributes.position.count, 0);
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const index: number[] = [];
  let at = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, at * 3);
    nrm.set(p.attributes.normal.array as Float32Array, at * 3);
    uv.set(p.attributes.uv.array as Float32Array, at * 2);
    for (const i of p.index!.array) index.push(i + at);
    at += p.attributes.position.count;
    p.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(index);
  return geo;
}
