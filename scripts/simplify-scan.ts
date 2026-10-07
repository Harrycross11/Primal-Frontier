// Cuts a raw photo scan (millions of triangles, split into many meshes) down to one game-ready
// mesh. Raw scans are textured with a photo atlas cut into thousands of UV islands, so the
// ordinary simplifier stops early at every seam; meshoptimizer's permissive mode lets edges
// collapse across seams while weighing the UVs, so the texture still lines up. The scan's
// "unlit" material (lighting is baked into the photo) is replaced by a plain rough one so the
// game's sun and shadows light it.
//
//     npx tsx scripts/simplify-scan.ts in.glb out.glb 8000

import { Document, NodeIO, type Material, type Node } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';

const [input, output, budgetArg] = process.argv.slice(2);
const budget = Number(budgetArg ?? 8000);

const io = new NodeIO();
const src = await io.read(input);

// Bake every node's transform into one list of vertices.
const pos: number[] = [];
const nor: number[] = [];
const uv: number[] = [];
const idx: number[] = [];
let material = null as Material | null;

function mul(m: number[], x: number, y: number, z: number, w: number): [number, number, number] {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12] * w,
    m[1] * x + m[5] * y + m[9] * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
  ];
}

function visit(node: Node) {
  const mesh = node.getMesh();
  if (mesh) {
    const m = node.getWorldMatrix() as unknown as number[];
    for (const prim of mesh.listPrimitives()) {
      const p = prim.getAttribute('POSITION')!;
      const n = prim.getAttribute('NORMAL');
      const t = prim.getAttribute('TEXCOORD_0');
      const base = pos.length / 3;
      material ??= prim.getMaterial();
      const a: number[] = [];
      for (let i = 0; i < p.getCount(); i++) {
        p.getElement(i, a);
        pos.push(...mul(m, a[0], a[1], a[2], 1));
        if (n) {
          n.getElement(i, a);
          const v = mul(m, a[0], a[1], a[2], 0);
          const l = Math.hypot(...v) || 1;
          nor.push(v[0] / l, v[1] / l, v[2] / l);
        } else nor.push(0, 1, 0);
        if (t) {
          t.getElement(i, a);
          uv.push(a[0], a[1]);
        } else uv.push(0, 0);
      }
      const ind = prim.getIndices();
      if (ind) for (let i = 0; i < ind.getCount(); i++) idx.push(base + ind.getScalar(i));
      else for (let i = 0; i < p.getCount(); i++) idx.push(base + i);
    }
  }
  for (const c of node.listChildren()) visit(c);
}
for (const scene of src.getRoot().listScenes()) for (const n of scene.listChildren()) visit(n);

await MeshoptSimplifier.ready;
const positions = new Float32Array(pos);
const [simple, error] = MeshoptSimplifier.simplifyWithAttributes(
  new Uint32Array(idx),
  positions,
  3,
  new Float32Array(uv),
  2,
  [0.5, 0.5],
  null,
  budget * 3,
  0.05,
  ['Permissive'],
);

// Scans sit at any angle; turn the wreck so its length runs along x, found as the heading with
// the smallest footprint.
let best = { area: Infinity, angle: 0, long: 0, short: 0 };
for (let d = 0; d < 180; d += 0.5) {
  const a = (d * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  let x0 = Infinity,
    x1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity;
  for (let i = 0; i < simple.length; i += 3) {
    const v = simple[i] * 3;
    const x = pos[v] * c - pos[v + 2] * s;
    const z = pos[v] * s + pos[v + 2] * c;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  if ((x1 - x0) * (z1 - z0) < best.area) best = { area: (x1 - x0) * (z1 - z0), angle: a, long: x1 - x0, short: z1 - z0 };
}
const yaw = best.angle + (best.long < best.short ? Math.PI / 2 : 0);
const cy = Math.cos(yaw);
const sy = Math.sin(yaw);
const turn = (a: number[], i: number) => {
  const x = a[i];
  a[i] = x * cy - a[i + 2] * sy;
  a[i + 2] = x * sy + a[i + 2] * cy;
};

// Keep only the vertices the simplified triangles still use.
const remap = new Map<number, number>();
const outPos: number[] = [];
const outNor: number[] = [];
const outUv: number[] = [];
const outIdx = new Uint32Array(simple.length);
for (let i = 0; i < simple.length; i++) {
  const v = simple[i];
  let r = remap.get(v);
  if (r === undefined) {
    remap.set(v, (r = remap.size));
    outPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    outNor.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
    turn(outPos, outPos.length - 3);
    turn(outNor, outNor.length - 3);
    outUv.push(uv[v * 2], uv[v * 2 + 1]);
  }
  outIdx[i] = r;
}

const doc = new Document();
const buffer = doc.createBuffer();
const acc = (type: 'VEC3' | 'VEC2' | 'SCALAR', array: Float32Array | Uint32Array) =>
  doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
const mat = doc.createMaterial('scan').setRoughnessFactor(0.9).setMetallicFactor(0).setDoubleSided(true);
const photo = material?.getBaseColorTexture();
if (photo) mat.setBaseColorTexture(doc.createTexture('photo').setImage(photo.getImage()!).setMimeType(photo.getMimeType()));
const prim = doc
  .createPrimitive()
  .setAttribute('POSITION', acc('VEC3', new Float32Array(outPos)))
  .setAttribute('NORMAL', acc('VEC3', new Float32Array(outNor)))
  .setAttribute('TEXCOORD_0', acc('VEC2', new Float32Array(outUv)))
  .setIndices(acc('SCALAR', outIdx))
  .setMaterial(mat);
doc.createScene().addChild(doc.createNode('scan').setMesh(doc.createMesh('scan').addPrimitive(prim)));
await io.write(output, doc);
console.log(`${idx.length / 3} -> ${simple.length / 3} triangles (error ${(error * 100).toFixed(2)}%)`);
