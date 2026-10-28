// Turns a rigged, photo-scanned person from Sketchfab into one the game can draw cheaply and
// pose with its own skeleton code (client/src/scanBody.ts):
//
// - every part (head, jacket, trousers, boots...) is merged into one skinned mesh with one
//   material, so a player costs one draw call however many parts the scan came in;
// - the parts' photos are packed side by side into one atlas, the face given the most room;
// - it is simplified to about the triangle budget, the head kept finer than the rest;
// - the bones are renamed to Mixamo's names, whichever rig it came with (Mixamo, Renderpeople
//   or Unreal's), since that is what the game looks for;
// - animations it came with are dropped (the game animates the bones itself), and the bones are
//   put back in the pose the mesh was bound in.
//
//     npx tsx scripts/prepare-character.ts in.glb out.glb 12000 [--atlas=1536] [--drop=<pattern>]
//
// --drop leaves out parts whose material names match, such as hair cards that need see-through
// textures. Needs Python 3 with Pillow to paint the atlas.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Document, NodeIO, type Node, type Primitive } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';

const args = process.argv.slice(2);
const option = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const [input, output, budgetArg] = args.filter((a) => !a.startsWith('--'));
const budget = Number(budgetArg ?? 12000);
const atlasSize = Number(option('atlas') ?? 1536);
const drop = option('drop') ? new RegExp(option('drop')!, 'i') : null;

const io = new NodeIO();
const doc = await io.read(input);
const root = doc.getRoot();
await MeshoptSimplifier.ready;

for (const a of root.listAnimations()) {
  for (const sampler of a.listSamplers()) {
    sampler.getInput()?.dispose();
    sampler.getOutput()?.dispose();
    sampler.dispose();
  }
  for (const c of a.listChannels()) c.dispose();
  a.dispose();
}

// ---- Bones: Mixamo's names, whatever rig it came with.

const SIDE: Record<string, string> = { l: 'Left', r: 'Right' };
const FINGER: Record<string, string> = { thumb: 'Thumb', index: 'Index', middle: 'Middle', ring: 'Ring', pinky: 'Pinky' };
const LIMB: Record<string, string> = {
  shoulder: 'Shoulder',
  clavicle: 'Shoulder',
  upperarm: 'Arm',
  lowerarm: 'ForeArm',
  hand: 'Hand',
  thigh: 'UpLeg',
  upperleg: 'UpLeg',
  calf: 'Leg',
  lowerleg: 'Leg',
  foot: 'Foot',
  ball: 'ToeBase',
  toe: 'ToeBase',
};
const MIDDLE: Record<string, string> = { hip: 'Hips', pelvis: 'Hips', spine_01: 'Spine', spine_02: 'Spine1', spine_03: 'Spine2', neck: 'Neck', neck_01: 'Neck', head: 'Head', head_end: 'HeadTop_End' };

/** The Mixamo name for a bone of another rig, or null to leave it be. */
function mixamoName(raw: string): string | null {
  if (/mixamorig/.test(raw)) return null;
  // Renderpeople prefix every bone with the model's name; exports add a node number.
  const name = raw.replace(/^rp_.*?_(?=(root|hip|spine|neck|head|jaw|eye|mouth|shoulder|upperarm|lowerarm|hand|thumb|index|middle|ring|pinky|thigh|calf|upperleg|lowerleg|foot|ball|toe))/, '').replace(/_\d+$/, '').toLowerCase();
  if (MIDDLE[name]) return MIDDLE[name];
  let m = name.match(/^(thumb|index|middle|ring|pinky)_0(\d)_([lr])$/);
  if (m) return `${SIDE[m[3]]}Hand${FINGER[m[1]]}${m[2]}`;
  m = name.match(/^(upperarm|lowerarm|thigh|calf|upperleg|lowerleg)_twist(?:_\d+)?_([lr])$/);
  if (m) return `${SIDE[m[2]]}${LIMB[m[1]]}Twist`;
  m = name.match(/^([a-z]+)_([lr])$/);
  if (m && LIMB[m[1]]) return `${SIDE[m[2]]}${LIMB[m[1]]}`;
  return null;
}

const skins = root.listSkins();
if (skins.length !== 1) throw new Error(`expected one skin, found ${skins.length}`);
const skin = skins[0];
const joints = skin.listJoints();
for (const j of joints) {
  const name = mixamoName(j.getName());
  if (name) j.setName(`mixamorig:${name}`);
}
const headJoint = joints.findIndex((j) => /mixamorig:?Head$/.test(j.getName().replace(/_\d+$/, '')));
if (headJoint < 0) throw new Error('no head bone');

// ---- Bones back in the pose the mesh was bound in (animated scans come posed mid-step).

type M4 = number[];
function mul(a: M4, b: M4): M4 {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function invert(m: M4): M4 {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * det, (a02 * b10 - a01 * b11 - a03 * b09) * det, (a31 * b05 - a32 * b04 + a33 * b03) * det, (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det, (a00 * b11 - a02 * b08 + a03 * b07) * det, (a32 * b02 - a30 * b05 - a33 * b01) * det, (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det, (a01 * b08 - a00 * b10 - a03 * b06) * det, (a30 * b04 - a31 * b02 + a33 * b00) * det, (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det, (a00 * b09 - a01 * b07 + a02 * b06) * det, (a31 * b01 - a30 * b03 - a32 * b00) * det, (a20 * b03 - a21 * b01 + a22 * b00) * det,
  ];
}
/** Splits a matrix with no shear into translation, rotation and scale. */
function decompose(m: M4): { t: [number, number, number]; r: [number, number, number, number]; s: [number, number, number] } {
  const sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
  const r00 = m[0] / sx, r10 = m[1] / sx, r20 = m[2] / sx, r01 = m[4] / sy, r11 = m[5] / sy, r21 = m[6] / sy, r02 = m[8] / sz, r12 = m[9] / sz, r22 = m[10] / sz;
  const tr = r00 + r11 + r22;
  let q: [number, number, number, number];
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(r21 - r12) / s, (r02 - r20) / s, (r10 - r01) / s, s / 4];
  } else if (r00 > r11 && r00 > r22) {
    const s = Math.sqrt(1 + r00 - r11 - r22) * 2;
    q = [s / 4, (r01 + r10) / s, (r02 + r20) / s, (r21 - r12) / s];
  } else if (r11 > r22) {
    const s = Math.sqrt(1 + r11 - r00 - r22) * 2;
    q = [(r01 + r10) / s, s / 4, (r12 + r21) / s, (r02 - r20) / s];
  } else {
    const s = Math.sqrt(1 + r22 - r00 - r11) * 2;
    q = [(r02 + r20) / s, (r12 + r21) / s, s / 4, (r10 - r01) / s];
  }
  return { t: [m[12], m[13], m[14]], r: q, s: [sx, sy, sz] };
}

// In the bind pose each bone's world matrix is the inverse of its inverse bind matrix, carried
// by whatever turns and scales the skeleton as a whole (often a Z-up fix or a centimetre scale).
// Files differ in where that lives (the mesh's node, the topmost bone, the hips), so each is
// tried and the one that stands the body up straightest, head over hips, is kept.
const meshNodes = root.listNodes().filter((n) => n.getSkin() === skin && n.getMesh());
const ibm = skin.getInverseBindMatrices()!;
const depth = (n: Node) => {
  let d = 0;
  for (let p = n.getParentNode(); p; p = p.getParentNode()) d++;
  return d;
};
const hips = joints.find((j) => /mixamorig:?Hips$/.test(j.getName().replace(/_\d+$/, '')))!;
const top = joints.reduce((best, j) => (depth(j) < depth(best) ? j : best));
const carried = (j: Node) => mul(j.getWorldMatrix() as unknown as M4, ibm.getElement(joints.indexOf(j), []) as M4);
const upright = (carry: M4) => {
  const at = (i: number) => mul(carry, invert(ibm.getElement(i, []) as M4)).slice(12, 15);
  const [h, p] = [at(headJoint), at(joints.indexOf(hips))];
  return (h[1] - p[1]) / Math.hypot(h[0] - p[0], h[1] - p[1], h[2] - p[2]);
};
const carry = [meshNodes[0].getWorldMatrix() as unknown as M4, carried(top), carried(hips)].reduce((best, c) => (upright(c) > upright(best) + 1e-3 ? c : best));
// Some exporters leave the inverse bind matrix of a bone no point hangs on as all zeros or as just
// the skeleton's scale, with no turn and no offset (Tony's upper arms and right forearm, whose twist
// bones carry the sleeves). Such a bone keeps its place under its parent.
const usable = (m: M4) => m.some((v, i) => i !== 15 && i % 5 !== 0 && Math.abs(v) > 1e-9);
const bindWorld = new Map<Node, M4>();
joints.forEach((j, i) => {
  const m = ibm.getElement(i, []) as M4;
  if (usable(m)) bindWorld.set(j, mul(carry, invert(m)));
});
// Parents first, so each bone's parent already stands in its bind pose.
for (const j of [...joints].sort((a, b) => depth(a) - depth(b))) {
  const parent = j.getParentNode();
  const parentWorld = parent ? (bindWorld.get(parent) ?? (parent.getWorldMatrix() as unknown as M4)) : new Array(16).fill(0).map((_, i) => (i % 5 === 0 ? 1 : 0));
  if (!bindWorld.has(j)) bindWorld.set(j, mul(parentWorld, j.getMatrix() as unknown as M4));
  const { t, r, s } = decompose(mul(invert(parentWorld), bindWorld.get(j)!));
  j.setTranslation(t).setRotation(r).setScale(s);
}

// ---- Parts: every skinned primitive, with the photo it wears.

interface Part {
  prim: Primitive;
  name: string;
  image: Uint8Array | null;
  mime: string;
  factor: number[];
  /** The span of its UVs, in whole tiles. */
  u: [number, number];
  v: [number, number];
  /** Surface area, for its share of the atlas and of the triangles. */
  area: number;
  head: boolean;
}
const parts: Part[] = [];
for (const node of meshNodes) {
  for (const prim of node.getMesh()!.listPrimitives()) {
    const material = prim.getMaterial();
    const name = material?.getName() ?? '';
    if (drop?.test(name)) continue;
    const pos = prim.getAttribute('POSITION')!;
    const uv = prim.getAttribute('TEXCOORD_0');
    const jn = prim.getAttribute('JOINTS_0')!;
    const wt = prim.getAttribute('WEIGHTS_0')!;
    const idx = prim.getIndices();
    const tri = (i: number) => (idx ? idx.getScalar(i) : i);
    const count = idx ? idx.getCount() : pos.getCount();
    let area = 0;
    const a: number[] = [], b: number[] = [], c: number[] = [];
    for (let i = 0; i < count; i += 3) {
      pos.getElement(tri(i), a);
      pos.getElement(tri(i + 1), b);
      pos.getElement(tri(i + 2), c);
      const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], f = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      area += Math.hypot(e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]) / 2;
    }
    let onHead = 0;
    const jj: number[] = [], ww: number[] = [];
    for (let i = 0; i < pos.getCount(); i++) {
      jn.getElement(i, jj);
      wt.getElement(i, ww);
      if (jj[ww.indexOf(Math.max(...ww))] === headJoint) onHead++;
    }
    let u: [number, number] = [0, 1];
    let v: [number, number] = [0, 1];
    if (uv) {
      let [u0, u1, v0, v1] = [Infinity, -Infinity, Infinity, -Infinity];
      for (let i = 0; i < uv.getCount(); i++) {
        uv.getElement(i, a);
        [u0, u1, v0, v1] = [Math.min(u0, a[0]), Math.max(u1, a[0]), Math.min(v0, a[1]), Math.max(v1, a[1])];
      }
      u = [Math.floor(u0 + 1e-4), Math.max(Math.floor(u0 + 1e-4) + 1, Math.ceil(u1 - 1e-4))];
      v = [Math.floor(v0 + 1e-4), Math.max(Math.floor(v0 + 1e-4) + 1, Math.ceil(v1 - 1e-4))];
    }
    const tex = material?.getBaseColorTexture();
    parts.push({
      prim,
      name,
      image: uv ? (tex?.getImage() ?? null) : null,
      mime: tex?.getMimeType() ?? '',
      factor: material?.getBaseColorFactor() ?? [1, 1, 1, 1],
      u,
      v,
      area,
      head: onHead > pos.getCount() / 2,
    });
  }
}
// A face needs the most detail: it is what players look at.
const weight = (p: Part) => p.area * (p.head ? 4 : 1) * (p.image ? 1 : 0.02);

/** Paints the atlas (Pillow): each photo tinted by its colour factor, repeated as its UVs repeat,
 * stretched over its box and, smaller, into the box inside its margin. */
const PAINT = `
import json, sys
from PIL import Image
job = json.load(open(sys.argv[1]))
size = job['size']
atlas = Image.new('RGB', (size, size), (128, 128, 128))
for t in job['tiles']:
    x0, y0, x1, y1 = t['box']
    g = t['gutter']
    rgb = tuple(int(255 * min(1, c) ** (1 / 2.2)) for c in t['factor'][:3])
    if t['file']:
        im = Image.open(t['file']).convert('RGB')
        if any(c < 0.999 for c in t['factor'][:3]):
            bands = [b.point(lambda v, k=k: v * k) for b, k in zip(im.split(), t['factor'][:3])]
            im = Image.merge('RGB', bands)
        rx, ry = t['repeat']
        if rx > 1 or ry > 1:
            tiled = Image.new('RGB', (im.width * rx, im.height * ry))
            for i in range(rx):
                for j in range(ry):
                    tiled.paste(im, (i * im.width, j * im.height))
            im = tiled
    else:
        im = Image.new('RGB', (8, 8), rgb)
    atlas.paste(im.resize((x1 - x0, y1 - y0), Image.LANCZOS), (x0, y0))
    atlas.paste(im.resize((max(1, x1 - x0 - 2 * g), max(1, y1 - y0 - 2 * g)), Image.LANCZOS), (x0 + g, y0 + g))
atlas.save(job['out'], 'JPEG', quality=92)
`;

// ---- The atlas: each part's photo gets a share of the sheet by its weight (a treemap).

type Rect = [number, number, number, number];
function treemap(items: number[], rect: Rect, out: Rect[]) {
  if (items.length === 1) {
    out[items[0]] = rect;
    return;
  }
  const total = items.reduce((s, i) => s + weights[i], 0);
  let acc = 0;
  let cut = 1;
  for (; cut < items.length - 1; cut++) {
    if (acc + weights[items[cut - 1]] > total / 2) break;
    acc += weights[items[cut - 1]];
  }
  acc = items.slice(0, cut).reduce((s, i) => s + weights[i], 0);
  const [x, y, w, h] = rect;
  const k = acc / total;
  const [a, b]: [Rect, Rect] = w >= h ? [[x, y, w * k, h], [x + w * k, y, w * (1 - k), h]] : [[x, y, w, h * k], [x, y + h * k, w, h * (1 - k)]];
  treemap(items.slice(0, cut), a, out);
  treemap(items.slice(cut), b, out);
}
// Even a plain-coloured part needs a few pixels of its own.
const weights = parts.map(weight).map((w, _, all) => Math.max(w, all.reduce((s, x) => s + x, 0) * 0.002));
const order = parts.map((_, i) => i).sort((a, b) => weights[b] - weights[a]);
const rects: Rect[] = [];
treemap(order, [0, 0, 1, 1], rects);
// One photo and nothing else to share it with: keep it at its own size, up to 1024.
const size = parts.length === 1 ? Math.min(1024, atlasSize) : atlasSize;
// Rounded to whole pixels, with a few pixels of each photo's edge spilling into a margin so the
// mipmaps never blend neighbours together.
const GUTTER = 4;
const px = rects.map(([x, y, w, h]) => [Math.round(x * size), Math.round(y * size), Math.round((x + w) * size), Math.round((y + h) * size)]);
const tmp = mkdtempSync(join(tmpdir(), 'character-'));
const tiles = parts.map((p, i) => {
  let file = null;
  if (p.image) {
    file = join(tmp, `${i}.${p.mime.split('/')[1] ?? 'png'}`);
    writeFileSync(file, p.image);
  }
  return { file, factor: p.factor, box: px[i], gutter: GUTTER, repeat: [p.u[1] - p.u[0], p.v[1] - p.v[0]] };
});
const atlasFile = join(tmp, 'atlas.jpg');
writeFileSync(join(tmp, 'job.json'), JSON.stringify({ size, tiles, out: atlasFile }));
const paint = spawnSync('python3', ['-c', PAINT, join(tmp, 'job.json')], { stdio: 'inherit' });
if (paint.status) throw new Error('painting the atlas failed');

// ---- One mesh: every part's vertices in one buffer, UVs moved onto the atlas.

const P: number[] = [], N: number[] = [], T: number[] = [], J: number[] = [], W: number[] = [];
/** Triangles in groups that are simplified apart: the head, and the rest. */
const groups: { idx: number[]; weight: number }[] = [
  { idx: [], weight: 0 },
  { idx: [], weight: 0 },
];
const before = parts.reduce((s, p) => s + (p.prim.getIndices()?.getCount() ?? p.prim.getAttribute('POSITION')!.getCount()) / 3, 0);
parts.forEach((p, i) => {
  const prim = p.prim;
  const pos = prim.getAttribute('POSITION')!;
  const nor = prim.getAttribute('NORMAL');
  const uv = prim.getAttribute('TEXCOORD_0');
  const jn = prim.getAttribute('JOINTS_0')!;
  const wt = prim.getAttribute('WEIGHTS_0')!;
  const base = P.length / 3;
  const [x0, y0, x1, y1] = px[i];
  const a: number[] = [];
  for (let k = 0; k < pos.getCount(); k++) {
    P.push(...pos.getElement(k, a));
    N.push(...(nor ? nor.getElement(k, a) : [0, 1, 0]));
    const [u, v] = uv ? uv.getElement(k, a) : [0.5, 0.5];
    // Into the photo's box, inside its margin.
    T.push(
      (x0 + GUTTER + ((u - p.u[0]) / (p.u[1] - p.u[0])) * (x1 - x0 - GUTTER * 2)) / size,
      (y0 + GUTTER + ((v - p.v[0]) / (p.v[1] - p.v[0])) * (y1 - y0 - GUTTER * 2)) / size,
    );
    const w = wt.getElement(k, []);
    const sum = w.reduce((s, x) => s + x, 0) || 1;
    J.push(...jn.getElement(k, []));
    W.push(...w.map((x) => x / sum));
  }
  const idx = prim.getIndices();
  const count = idx ? idx.getCount() : pos.getCount();
  const jj: number[] = [], ww: number[] = [];
  for (let k = 0; k < count; k += 3) {
    const tri = [0, 1, 2].map((d) => base + (idx ? idx.getScalar(k + d) : k + d));
    // A triangle on the head (by the bone that moves it most) goes in the finer group.
    const onHead = tri.filter((t) => {
      jj.splice(0, 4, ...J.slice(t * 4, t * 4 + 4));
      ww.splice(0, 4, ...W.slice(t * 4, t * 4 + 4));
      return jj[ww.indexOf(Math.max(...ww))] === headJoint;
    }).length >= 2;
    groups[onHead ? 0 : 1].idx.push(...tri);
  }
});
// Each group's share of the triangles follows its surface, the head's counted four times over.
const positions = new Float32Array(P);
function groupArea(idx: number[]): number {
  let s = 0;
  for (let k = 0; k < idx.length; k += 3) {
    const [a, b, c] = [idx[k], idx[k + 1], idx[k + 2]].map((t) => [P[t * 3], P[t * 3 + 1], P[t * 3 + 2]]);
    const e = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], f = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    s += Math.hypot(e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]) / 2;
  }
  return s;
}
groups[0].weight = groupArea(groups[0].idx) * 4;
groups[1].weight = groupArea(groups[1].idx);
const totalWeight = groups[0].weight + groups[1].weight;
const kept: number[] = [];
for (const g of groups) {
  if (!g.idx.length) continue;
  const target = Math.min(g.idx.length, Math.floor((budget * g.weight) / totalWeight) * 3);
  // Seams between the head and body, and between parts, are borders and stay where they are.
  const [out] = MeshoptSimplifier.simplify(new Uint32Array(g.idx), positions, 3, target, 0.2, []);
  kept.push(...out);
}

// Only the vertices still used, renumbered.
const remap = new Map<number, number>();
for (const t of kept) if (!remap.has(t)) remap.set(t, remap.size);
const n = remap.size;
const out = { P: new Float32Array(n * 3), N: new Float32Array(n * 3), T: new Float32Array(n * 2), J: new Uint16Array(n * 4), W: new Float32Array(n * 4) };
for (const [from, to] of remap) {
  out.P.set(P.slice(from * 3, from * 3 + 3), to * 3);
  out.N.set(N.slice(from * 3, from * 3 + 3), to * 3);
  out.T.set(T.slice(from * 2, from * 2 + 2), to * 2);
  out.J.set(J.slice(from * 4, from * 4 + 4), to * 4);
  out.W.set(W.slice(from * 4, from * 4 + 4), to * 4);
}
const indices = new Uint32Array(kept.map((t) => remap.get(t)!));

// ---- Write it back: one primitive with one plain, rough material in place of all the parts.

const buffer = root.listBuffers()[0];
const acc = (type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4', array: Float32Array | Uint16Array | Uint32Array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
const texture = doc.createTexture('atlas').setImage(new Uint8Array(readFileSync(atlasFile))).setMimeType('image/jpeg');
const material = doc.createMaterial('scan').setBaseColorTexture(texture).setRoughnessFactor(0.9).setMetallicFactor(0);
const prim = doc
  .createPrimitive()
  .setIndices(acc('SCALAR', indices))
  .setAttribute('POSITION', acc('VEC3', out.P))
  .setAttribute('NORMAL', acc('VEC3', out.N))
  .setAttribute('TEXCOORD_0', acc('VEC2', out.T))
  .setAttribute('JOINTS_0', acc('VEC4', out.J))
  .setAttribute('WEIGHTS_0', acc('VEC4', out.W))
  .setMaterial(material);
const body = doc.createMesh('body').addPrimitive(prim);
const old = new Set(meshNodes.map((node) => node.getMesh()!));
meshNodes[0].setMesh(body);
for (const node of meshNodes.slice(1)) node.dispose();
for (const mesh of old) {
  for (const p of mesh.listPrimitives()) {
    for (const a of [...p.listAttributes(), p.getIndices()]) a?.dispose();
    p.dispose();
  }
  mesh.dispose();
}
// Anything not skinned to the body (eyes on their own, props) goes too.
for (const node of root.listNodes()) if (node.getMesh() && node.getMesh() !== body) node.setMesh(null);
for (const m of root.listMaterials()) if (m !== material) m.dispose();
for (const t of root.listTextures()) if (t !== texture) t.dispose();
for (const m of root.listMeshes()) if (m !== body) m.dispose();
for (const a of root.listAccessors()) if (!a.listParents().some((p) => p !== root)) a.dispose();

await io.write(output, doc);
rmSync(tmp, { recursive: true });
console.log(parts.map((p, i) => `${p.name}${p.head ? ' (head)' : ''} ${px[i].join(',')}`).join('\n'));
console.log(`${parts.length} parts -> 1, ${before} -> ${indices.length / 3} triangles, atlas ${size}px`);
