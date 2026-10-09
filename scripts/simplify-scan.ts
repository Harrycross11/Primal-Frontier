// Cuts a raw photo scan (millions of triangles, split into many meshes) down to a game-ready
// mesh. Raw scans are textured with a photo atlas cut into thousands of UV islands, so the
// ordinary simplifier stops early at every seam; meshoptimizer's permissive mode lets edges
// collapse across seams while weighing the UVs, so the texture still lines up. The scan's
// "unlit" material (lighting is baked into the photo) is replaced by a plain rough one so the
// game's sun and shadows light it. Scans textured with several photo sheets keep one part per
// sheet, each cut down in proportion to its size.
//
//     npx tsx scripts/simplify-scan.ts in.glb out.glb 8000 [--keep-heading] [--split]
//
// --keep-heading leaves the scan facing as it was; otherwise it is turned so its length runs
// along x (for the car wrecks). --split keeps each top-level object separate, for a file that
// is a set of loose pieces. --drop=<pattern> leaves out meshes whose names match, such as the
// floor a scan was shown on.

import { Document, NodeIO, type Material, type Node, type Texture } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const [input, output, budgetArg] = args.filter((a) => !a.startsWith('--'));
const budget = Number(budgetArg ?? 8000);

const io = new NodeIO();
const src = await io.read(input);

/** One photo sheet's worth of triangles, from one top-level object (or all of them). */
interface Part {
  group: number;
  material: Material | null;
  pos: number[];
  nor: number[];
  uv: number[];
  idx: number[];
}
const parts = new Map<string, Part>();

function mul(m: number[], x: number, y: number, z: number, w: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
  ];
}

// Bake every node's transform into the vertices.
const dropArg = args.find((a) => a.startsWith('--drop='));
const drop = dropArg ? new RegExp(dropArg.slice('--drop='.length)) : null;
function visit(node: Node, group: number) {
  const mesh = node.getMesh();
  if (mesh && !(drop && drop.test(mesh.getName()))) {
    const m = node.getWorldMatrix() as unknown as number[];
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial();
      const key = `${group}/${material?.getName() ?? ''}/${material ? src.getRoot().listMaterials().indexOf(material) : -1}`;
      let part = parts.get(key);
      if (!part) parts.set(key, (part = { group, material, pos: [], nor: [], uv: [], idx: [] }));
      const p = prim.getAttribute('POSITION')!;
      const n = prim.getAttribute('NORMAL');
      const t = prim.getAttribute('TEXCOORD_0');
      const base = part.pos.length / 3;
      const a: number[] = [];
      for (let i = 0; i < p.getCount(); i++) {
        p.getElement(i, a);
        part.pos.push(...mul(m, a[0], a[1], a[2], 1));
        if (n) {
          n.getElement(i, a);
          const v = mul(m, a[0], a[1], a[2], 0);
          const l = Math.hypot(...v) || 1;
          part.nor.push(v[0] / l, v[1] / l, v[2] / l);
        } else part.nor.push(0, 1, 0);
        if (t) {
          t.getElement(i, a);
          part.uv.push(a[0], a[1]);
        } else part.uv.push(0, 0);
      }
      const ind = prim.getIndices();
      if (ind) for (let i = 0; i < ind.getCount(); i++) part.idx.push(base + ind.getScalar(i));
      else for (let i = 0; i < p.getCount(); i++) part.idx.push(base + i);
    }
  }
  for (const c of node.listChildren()) visit(c, group);
}
const split = flags.has('--split');
let top = 0;
for (const scene of src.getRoot().listScenes()) {
  // A set's pieces may sit under one wrapper node; split where they divide.
  let level = scene.listChildren();
  while (split && level.length === 1 && !level[0].getMesh()) level = level[0].listChildren();
  for (const n of level) visit(n, split ? top++ : 0);
}

await MeshoptSimplifier.ready;
const total = [...parts.values()].reduce((s, p) => s + p.idx.length / 3, 0);
const simple = new Map<Part, Uint32Array>();
for (const part of parts.values()) {
  const share = Math.max(64, Math.round((budget * part.idx.length) / 3 / total));
  const [out] = MeshoptSimplifier.simplifyWithAttributes(
    new Uint32Array(part.idx),
    new Float32Array(part.pos),
    3,
    new Float32Array(part.uv),
    2,
    [0.5, 0.5],
    null,
    share * 3,
    0.05,
    ['Permissive'],
  );
  simple.set(part, out);
}

// Scans sit at any angle; turn the wreck so its length runs along x, found as the heading with
// the smallest footprint.
let yaw = 0;
if (!flags.has('--keep-heading')) {
  let best = { area: Infinity, angle: 0, long: 0, short: 0 };
  for (let d = 0; d < 180; d += 0.5) {
    const a = (d * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (const [part, tris] of simple) {
      for (let i = 0; i < tris.length; i += 3) {
        const v = tris[i] * 3;
        const x = part.pos[v] * c - part.pos[v + 2] * s;
        const z = part.pos[v] * s + part.pos[v + 2] * c;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
      }
    }
    if ((x1 - x0) * (z1 - z0) < best.area) best = { area: (x1 - x0) * (z1 - z0), angle: a, long: x1 - x0, short: z1 - z0 };
  }
  yaw = best.angle + (best.long < best.short ? Math.PI / 2 : 0);
}
const cy = Math.cos(yaw);
const sy = Math.sin(yaw);
const turn = (a: number[], i: number) => {
  const x = a[i];
  a[i] = x * cy - a[i + 2] * sy;
  a[i + 2] = x * sy + a[i + 2] * cy;
};

const doc = new Document();
const buffer = doc.createBuffer();
const acc = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: Float32Array | Uint32Array) =>
  doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
const copied = new Map<Texture, Texture>();
const copy = (t: Texture | null) => {
  if (!t) return null;
  let out = copied.get(t);
  if (!out) copied.set(t, (out = doc.createTexture(t.getName()).setImage(t.getImage()!).setMimeType(t.getMimeType())));
  return out;
};
const mats = new Map<Material | null, Material>();
const scene = doc.createScene();
const meshes = new Map<number, ReturnType<Document['createMesh']>>();
let before = 0;
let after = 0;
for (const [part, tris] of simple) {
  before += part.idx.length / 3;
  after += tris.length / 3;
  // Keep only the vertices the simplified triangles still use.
  const remap = new Map<number, number>();
  const outPos: number[] = [];
  const outNor: number[] = [];
  const outUv: number[] = [];
  const outIdx = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) {
    const v = tris[i];
    let r = remap.get(v);
    if (r === undefined) {
      remap.set(v, (r = remap.size));
      outPos.push(part.pos[v * 3], part.pos[v * 3 + 1], part.pos[v * 3 + 2]);
      outNor.push(part.nor[v * 3], part.nor[v * 3 + 1], part.nor[v * 3 + 2]);
      turn(outPos, outPos.length - 3);
      turn(outNor, outNor.length - 3);
      outUv.push(part.uv[v * 2], part.uv[v * 2 + 1]);
    }
    outIdx[i] = r;
  }
  let mat = mats.get(part.material);
  if (!mat) {
    mat = doc.createMaterial('scan').setRoughnessFactor(0.9).setMetallicFactor(0).setDoubleSided(true);
    const photo = copy(part.material?.getBaseColorTexture() ?? null);
    if (photo) mat.setBaseColorTexture(photo);
    const bumps = copy(part.material?.getNormalTexture() ?? null);
    if (bumps) mat.setNormalTexture(bumps);
    mats.set(part.material, mat);
  }
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', acc('VEC3', new Float32Array(outPos)))
    .setAttribute('NORMAL', acc('VEC3', new Float32Array(outNor)))
    .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(outUv)))
    .setIndices(acc('SCALAR', outIdx))
    .setMaterial(mat);
  let mesh = meshes.get(part.group);
  if (!mesh) {
    meshes.set(part.group, (mesh = doc.createMesh(`scan-${part.group}`)));
    scene.addChild(doc.createNode(`scan-${part.group}`).setMesh(mesh));
  }
  mesh.addPrimitive(prim);
}
await io.write(output, doc);
console.log(`${before} -> ${after} triangles in ${simple.size} parts`);
