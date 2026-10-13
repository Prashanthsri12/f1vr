// Browser module (imports three). Runs with THREE_DIR set, see tests/support/three-hook.mjs;
// otherwise skipped under plain `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';

let THREE;
let buildCarParts;
let mergeGeometries;
try {
  THREE = await import('three');
  ({ buildCarParts } = await import('../js/scene/car-model.js'));
  ({ mergeGeometries } = await import('three/addons/utils/BufferGeometryUtils.js'));
} catch (err) {
  if (process.env.THREE_DIR) throw err;
  THREE = null;
}
const skip = THREE ? false : 'three is not installed for Node (browser-only import map)';

/** A fake car: white body box (long along X), four dark wheels, a glass box, under a scaled group. */
function fakeCar() {
  const root = new THREE.Group();
  const g = new THREE.Group();
  g.scale.setScalar(2);
  g.position.set(5, 1, -3);
  root.add(g);
  const body = new THREE.MeshStandardMaterial({ name: 'grey', color: 0xf0f0f0 });
  const tyre = new THREE.MeshStandardMaterial({ name: 'carTire', color: 0x444444 });
  const glass = new THREE.MeshStandardMaterial({ name: 'glass', color: 0x4c6077 });
  g.add(new THREE.Mesh(new THREE.BoxGeometry(2, 0.3, 0.8), body));
  for (const [x, z] of [[-0.7, -0.45], [-0.7, 0.45], [0.7, -0.45], [0.7, 0.45]]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 8), tyre);
    w.position.set(x, -0.1, z);
    g.add(w);
  }
  const c = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.2), glass);
  c.position.y = 0.2;
  g.add(c);
  return root;
}

test('flattens to one part per material and marks the body for tinting', { skip }, () => {
  const m = buildCarParts(fakeCar(), 0.025, mergeGeometries);
  assert.equal(m.parts.length, 3);
  assert.equal(m.parts[0].tint, true);
  assert.equal(m.parts[0].material.name, 'grey');
  assert.equal(m.parts[0].material.color.getHex(), 0xffffff);
  assert.equal(m.parts.filter((p) => p.tint).length, 1);
});

test('normalises: length along Z, base at y = 0, centred', { skip }, () => {
  const m = buildCarParts(fakeCar(), 0.025, mergeGeometries);
  const box = new THREE.Box3();
  for (const p of m.parts) box.union(p.geometry.boundingBox);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.z - 0.025) < 1e-6, `length ${size.z}`);
  assert.ok(size.x < size.z);
  assert.ok(Math.abs(box.min.y) < 1e-6);
  assert.ok(Math.abs(box.min.x + box.max.x) < 1e-6 && Math.abs(box.min.z + box.max.z) < 1e-6);
  assert.ok(Math.abs(m.height - size.y) < 1e-9);
});

test('shell covers every part; triangle count adds up', { skip }, () => {
  const m = buildCarParts(fakeCar(), 0.025, mergeGeometries);
  const sum = m.parts.reduce((s, p) => s + p.geometry.attributes.position.count, 0);
  assert.equal(m.shell.attributes.position.count, sum);
  assert.equal(m.triangles, sum / 3);
});

test('without a body name, the largest light part is tinted', { skip }, () => {
  const root = fakeCar();
  root.traverse((o) => { if (o.isMesh) o.material.name = ''; });
  const m = buildCarParts(root, 0.025, mergeGeometries);
  const tinted = m.parts.find((p) => p.tint);
  assert.ok(tinted.geometry.attributes.position.count === 36); // the body box (non-indexed)
});
