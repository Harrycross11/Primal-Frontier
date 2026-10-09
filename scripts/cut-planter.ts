// Cuts the plants out of the raised garden box scan, leaving just its walls: the scan comes
// full of leafy greens, but the game grows its own crops in it (and lays its own soil). Keeps
// only the triangles within a wall's thickness of the box's outside and below its rim. The
// scan's units: the rim stands 0.15 above the scan's origin, the walls are about 4 cm thick.
//
// Leaves draped over the rim are told apart by colour, which needs the photo decoded: with
// --dump the script writes each triangle's middle UV and the photo, for scripts/fetch-models.py
// to mark the green ones in a mask file (one byte per triangle) passed back with --mask.
//
//     npx tsx scripts/cut-planter.ts in.glb --dump uvs.bin photo.jpg
//     npx tsx scripts/cut-planter.ts in.glb out.glb --mask green.bin

import { readFileSync, writeFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';

const args = process.argv.slice(2);
const dump = args.indexOf('--dump');
const maskAt = args.indexOf('--mask');
const [input, output] = args;
const mask = maskAt >= 0 ? readFileSync(args[maskAt + 1]) : null;
const uvs: number[] = [];
const RIM = 0.152;
const WALL = 0.05;

const io = new NodeIO();
const doc = await io.read(input);
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')!;
    const indices = prim.getIndices();
    const count = indices ? indices.getCount() : pos.getCount();
    const at = (i: number) => (indices ? indices.getScalar(i) : i);
    const world = (v: number) => {
      const p = pos.getElement(v, [0, 0, 0]);
      return [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
    };
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    // The box's outline, from its lower half: leaves spill past it higher up.
    for (let v = 0; v < pos.getCount(); v++) {
      const p = world(v);
      if (p[1] > 0) continue;
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], p[k]);
        hi[k] = Math.max(hi[k], p[k]);
      }
    }
    const uv = prim.getAttribute('TEXCOORD_0')!;
    const kept: number[] = [];
    for (let i = 0; i < count; i += 3) {
      const tri = [at(i), at(i + 1), at(i + 2)];
      if (dump >= 0) {
        for (const k of [0, 1]) uvs.push(tri.reduce((s, v) => s + uv.getElement(v, [0, 0])[k], 0) / 3);
        continue;
      }
      const c = [0, 1, 2].map((k) => tri.reduce((s, v) => s + world(v)[k], 0) / 3);
      const fromEdge = Math.min(c[0] - lo[0], hi[0] - c[0], c[2] - lo[2], hi[2] - c[2]);
      if (c[1] <= RIM && fromEdge > -0.005 && fromEdge < WALL && !mask?.[i / 3]) kept.push(...tri);
    }
    if (dump >= 0) continue;
    const out = doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(kept));
    prim.setIndices(out);
    console.log('kept', kept.length / 3, 'of', count / 3, 'triangles');
  }
}
if (dump >= 0) {
  writeFileSync(args[dump + 1], Buffer.from(new Float32Array(uvs).buffer));
  writeFileSync(args[dump + 2], Buffer.from(doc.getRoot().listTextures()[0].getImage()!));
} else await io.write(output, doc);
