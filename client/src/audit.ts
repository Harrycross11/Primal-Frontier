// A check for things still drawn with shapes built in code rather than scanned models: lists each
// such mesh in the world and each item whose icon or held model is made that way. Called from the
// test hooks (window.__pf.audit) by the screenshot scripts; players never run it.

import * as THREE from 'three';
import { ITEMS, type ItemId } from '../../shared/items.ts';
import { buildItemModel } from './itemModels.ts';
import { isScanned } from './models.ts';
import { buildHeldItem } from './props.ts';
import { buildGun } from './guns.ts';

interface Row {
  label: string;
  meshes: number;
  tris: number;
}

const trisOf = (m: THREE.Mesh) => {
  const g = m.geometry;
  const n = (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
  return n * ((m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1);
};

const describe = (m: THREE.Mesh) => {
  const mat = ([] as THREE.Material[]).concat(m.material)[0] as THREE.MeshStandardMaterial | undefined;
  const look = !mat ? '?' : mat.map ? 'photo' : mat.vertexColors ? 'painted' : `#${mat.color?.getHexString?.() ?? '?'}`;
  return `${m.geometry.type}${(m as THREE.InstancedMesh).isInstancedMesh ? ' x' + (m as THREE.InstancedMesh).count : ''} ${look}`;
};

/** How much of an object is drawn from scans, by triangles, and the code-built parts. */
function split(root: THREE.Object3D) {
  let scanned = 0;
  let built = 0;
  const parts: string[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.noAudit) return;
    const t = trisOf(m);
    if (isScanned(m.geometry)) scanned += t;
    else {
      built += t;
      parts.push(describe(m));
    }
  });
  return { scanned, built, parts };
}

/** What in `scene` is built in code, grouped by what it belongs to, biggest first. */
export function auditScene(scene: THREE.Object3D, labelOf: (o: THREE.Object3D) => string | undefined): Row[] {
  const rows = new Map<string, Row>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || isScanned(m.geometry) || m.userData.noAudit) return;
    for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible) return;
    let label: string | undefined;
    for (let p: THREE.Object3D | null = m; p && !label; p = p.parent) label = labelOf(p);
    // Instanced copies are counted together, whatever their count.
    const key = `${label ?? 'world'} | ${describe(m).replace(/ x\d+/, ' instanced')}`;
    const row = rows.get(key) ?? { label: key, meshes: 0, tris: 0 };
    row.meshes++;
    row.tris += trisOf(m);
    rows.set(key, row);
  });
  return [...rows.values()].sort((a, b) => b.tris - a.tris);
}

/** Every item whose icon, or the model a survivor holds, is partly or wholly built in code. */
export function auditItems() {
  const out: { item: ItemId; icon: string; held: string; parts: string[] }[] = [];
  const pct = (s: { scanned: number; built: number }) => (s.scanned + s.built === 0 ? 'none' : `${Math.round((100 * s.built) / (s.scanned + s.built))}% built`);
  for (const item of Object.keys(ITEMS) as ItemId[]) {
    const icon = buildItemModel(item);
    const held = ITEMS[item].weapon && ITEMS[item].weapon!.class !== 'melee' ? (buildGun(item) ?? buildHeldItem(item)) : buildHeldItem(item);
    const a = icon ? split(icon.model) : { scanned: 0, built: 0, parts: [] };
    const b = held ? split(held) : { scanned: 0, built: 0, parts: [] };
    if (a.built || b.built) out.push({ item, icon: pct(a), held: held ? pct(b) : 'not held', parts: [...new Set([...a.parts, ...b.parts])] });
  }
  return out;
}
