import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { gridRaycast } from '../client/src/gridRaycast.ts';
import { mulberry32 } from '../shared/terrain.ts';

test('the ground raycast finds the same hits as testing every triangle', () => {
  const size = 40;
  const segments = 42;
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, Math.sin(pos.getX(i) * 0.7) * 2 + Math.cos(pos.getZ(i) * 0.4) * 3);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial();
  const slow = new THREE.Mesh(geo, material);
  const fast = new THREE.Mesh(geo, material);
  gridRaycast(fast, size, segments);
  const rand = mulberry32(7);
  const ray = new THREE.Raycaster();
  let hits = 0;
  for (let n = 0; n < 2000; n++) {
    const from = new THREE.Vector3((rand() - 0.5) * 50, rand() * 12 - 2, (rand() - 0.5) * 50);
    const dir = new THREE.Vector3(rand() - 0.5, rand() - 0.7, rand() - 0.5).normalize();
    ray.set(from, dir);
    ray.far = n % 3 === 0 ? Infinity : rand() * 30;
    const want = ray.intersectObject(slow)[0];
    const got = ray.intersectObject(fast)[0];
    assert.equal(!!got, !!want, `ray ${n}`);
    if (!want || !got) continue;
    hits++;
    assert.ok(Math.abs(got.distance - want.distance) < 1e-6, `ray ${n}: ${got.distance} vs ${want.distance}`);
    assert.ok(got.face!.normal.distanceTo(want.face!.normal) < 1e-6);
    assert.equal(got.object, fast);
  }
  assert.ok(hits > 500, `only ${hits} rays hit`);
});
