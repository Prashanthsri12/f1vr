// Browser module (imports three). Runs with THREE_DIR set, see tests/support/three-hook.mjs;
// otherwise skipped under plain `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';

let THREE;
let createTableGrab;
try {
  THREE = await import('three');
  ({ createTableGrab } = await import('../js/input/table-grab.js'));
} catch {
  THREE = null;
}

const skip = THREE ? false : 'three is not installed for Node (browser-only import map)';

function rig() {
  const table = new THREE.Group();
  table.position.set(0, 0.9, -1);
  table.userData.defaultTransform = { position: table.position.clone(), quaternion: table.quaternion.clone(), scale: table.scale.clone() };
  const left = new THREE.Object3D();
  const right = new THREE.Object3D();
  return { table, left, right, grab: createTableGrab(table) };
}

test('one hand translates the table', { skip }, () => {
  const { table, right, grab } = rig();
  right.position.set(0.2, 1.0, -0.5);
  grab.begin('r', right);
  right.position.set(0.5, 1.1, -0.5);
  grab.update();
  assert.ok(table.position.distanceTo(new THREE.Vector3(0.3, 1.0, -1)) < 1e-9);
});

test('two hands scale (clamped) and rotate about the midpoint', { skip }, () => {
  const { table, left, right, grab } = rig();
  left.position.set(-0.2, 1, -0.6);
  right.position.set(0.2, 1, -0.6);
  grab.begin('l', left);
  grab.begin('r', right);
  left.position.set(-0.4, 1, -0.6);
  right.position.set(0.4, 1, -0.6);
  grab.update();
  assert.ok(Math.abs(table.scale.x - 2) < 1e-9);
  left.position.set(-2, 1, -0.6);
  right.position.set(2, 1, -0.6);
  grab.update();
  assert.equal(table.scale.x, 3);
});

test('releasing a hand re-anchors without a jump; reset restores default', { skip }, () => {
  const { table, left, right, grab } = rig();
  left.position.set(-0.2, 1, -0.6);
  right.position.set(0.2, 1, -0.6);
  grab.begin('l', left);
  grab.begin('r', right);
  right.position.set(0.3, 1, -0.6);
  grab.update();
  const before = table.position.clone();
  grab.end('l');
  grab.update();
  assert.ok(table.position.distanceTo(before) < 1e-9);
  grab.reset();
  assert.ok(table.position.distanceTo(new THREE.Vector3(0, 0.9, -1)) < 1e-9);
  assert.equal(table.scale.x, 1);
});

test('two-hand twist: the table point under a hand follows that hand', { skip }, () => {
  const { table, left, right, grab } = rig();
  left.position.set(-0.3, 1, -1);
  right.position.set(0.3, 1, -1);
  grab.begin('l', left);
  grab.begin('r', right);
  table.updateMatrixWorld(true);
  const local = table.worldToLocal(right.position.clone()); // table-space point under the right hand
  // Twist both hands 40° around the vertical axis through their midpoint.
  const pivot = new THREE.Vector3(0, 1, -1);
  const axis = new THREE.Vector3(0, 1, 0);
  for (const h of [left, right]) h.position.sub(pivot).applyAxisAngle(axis, THREE.MathUtils.degToRad(40)).add(pivot);
  grab.update();
  table.updateMatrixWorld(true);
  const followed = table.localToWorld(local.clone());
  assert.ok(followed.distanceTo(right.position) < 1e-9, `off by ${followed.distanceTo(right.position)}`);
});

test('two-hand scaling keeps the table height relative to the hands', { skip }, () => {
  const { table, left, right, grab } = rig();
  left.position.set(-0.2, 1.1, -0.6);
  right.position.set(0.2, 1.1, -0.6);
  grab.begin('l', left);
  grab.begin('r', right);
  left.position.set(-0.4, 1.1, -0.6);
  right.position.set(0.4, 1.1, -0.6);
  grab.update();
  assert.ok(Math.abs(table.position.y - 0.9) < 1e-9);
  assert.ok(Math.abs(table.position.z - -1.4) < 1e-9);
});
