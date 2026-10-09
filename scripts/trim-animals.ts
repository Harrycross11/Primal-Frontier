// Cuts the rigged animal models down to what the game plays: drops the animation clips it never
// uses and shrinks the textures, before compress-assets.py packs them. Run after fetching them
// raw from Sketchfab (fetch-models.py does this itself).
//
//     npx tsx scripts/trim-animals.ts in.glb out.glb Idle Walk Run ...

import { NodeIO } from '@gltf-transform/core';

const [input, output, ...keep] = process.argv.slice(2);
const io = new NodeIO();
const doc = await io.read(input);
const root = doc.getRoot();
for (const anim of root.listAnimations()) {
  if (keep.includes(anim.getName())) continue;
  for (const c of anim.listChannels()) c.dispose();
  for (const s of anim.listSamplers()) {
    s.getInput()?.dispose();
    s.getOutput()?.dispose();
    s.dispose();
  }
  anim.dispose();
}
// Accessors no longer used by anything left behind by the dropped clips.
for (const a of root.listAccessors()) if (a.listParents().length <= 1) a.dispose();
console.log(output, root.listAnimations().map((a) => a.getName()).join(', '));
await io.write(output, doc);
