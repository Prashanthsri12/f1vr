// getRecenterPose (world.js) and applyRecenter (track.js). Browser modules (import three):
// run with THREE_DIR set (see tests/support/three-hook.mjs), otherwise skipped.
import test from 'node:test';
import assert from 'node:assert/strict';

let THREE;
let getRecenterPose;
let applyRecenter;
let createTable;
try {
  THREE = await import('three');
  ({ getRecenterPose } = await import('../js/scene/world.js'));
  ({ applyRecenter, createTable } = await import('../js/scene/track.js'));
} catch (err) {
  if (process.env.THREE_DIR) throw err;
  THREE = null;
}

const skip = THREE ? false : 'three is not installed for Node (browser-only import map)';

function angDiff(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

/** Head object at `pos` with yaw / pitch / roll (radians, YXZ like a camera). */
function head(pos, yaw, pitch = 0, roll = 0) {
  const h = new THREE.Object3D();
  h.position.fromArray(pos);
  h.rotation.set(pitch, yaw, roll, 'YXZ');
  h.updateMatrixWorld(true);
  return h;
}

test('getRecenterPose: floor position and yaw for various facings', { skip }, () => {
  for (const yaw of [0, 0.5, Math.PI / 2, -Math.PI / 2, 2.8, -2.8, Math.PI]) {
    for (const pitch of [0, -0.6, 0.6, -1.3]) {
      const out = getRecenterPose(head([1.2, 1.65, -0.4], yaw, pitch, 0.2), {});
      assert.ok(Math.abs(out.x - 1.2) < 1e-9);
      assert.ok(Math.abs(out.z + 0.4) < 1e-9);
      assert.ok(angDiff(out.yaw, yaw) < 1e-6, `yaw ${yaw} pitch ${pitch} -> ${out.yaw}`);
    }
  }
});

test('getRecenterPose: looking straight down or up keeps the facing', { skip }, () => {
  for (const yaw of [0, 1, -2, 3]) {
    const down = getRecenterPose(head([0, 1.6, 0], yaw, -Math.PI / 2), {});
    assert.ok(angDiff(down.yaw, yaw) < 1e-4, `down yaw ${yaw} -> ${down.yaw}`);
    const up = getRecenterPose(head([0, 1.6, 0], yaw, Math.PI / 2), {});
    assert.ok(angDiff(up.yaw, yaw) < 1e-4, `up yaw ${yaw} -> ${up.yaw}`);
    const nearlyDown = getRecenterPose(head([0, 1.6, 0], yaw, -Math.PI / 2 + 0.05), {});
    assert.ok(angDiff(nearlyDown.yaw, yaw) < 1e-4, `nearly down yaw ${yaw} -> ${nearlyDown.yaw}`);
  }
});

test('getRecenterPose returns out', { skip }, () => {
  const out = { x: 0, z: 0, yaw: 0 };
  assert.equal(getRecenterPose(head([0, 1.6, 0], 0), out), out);
});

test('applyRecenter: table in front of the new pose, reset target updated, scale kept', { skip }, () => {
  const table = createTable(null);
  table.scale.setScalar(1.7);
  table.position.set(3, 0.5, 3);
  applyRecenter(table, { x: 1, z: 2, yaw: Math.PI / 2 }); // facing -X
  // Default (0, 0.9, -1) rotated to face -X is (-1, 0.9, 0); plus (1, 0, 2).
  assert.ok(table.position.distanceTo(new THREE.Vector3(0, 0.9, 2)) < 1e-9, table.position.toArray().join());
  const yaw = new THREE.Euler().setFromQuaternion(table.quaternion, 'YXZ').y;
  assert.ok(angDiff(yaw, Math.PI / 2) < 1e-9);
  assert.equal(table.scale.x, 1.7, 'scale kept');
  const def = table.userData.defaultTransform;
  assert.ok(def.position.equals(table.position));
  assert.ok(Math.abs(def.quaternion.dot(table.quaternion)) > 1 - 1e-12);
  assert.ok(table.userData.baseTransform.position.equals(new THREE.Vector3(0, 0.9, -1)), 'base unchanged');
  // A second re-centre starts from the base, not the previous re-centre.
  applyRecenter(table, { x: 0, z: 0, yaw: 0 });
  assert.ok(table.position.distanceTo(new THREE.Vector3(0, 0.9, -1)) < 1e-9);
  assert.ok(Math.abs(table.quaternion.w) > 1 - 1e-12);
  table.userData.dispose();
});

test('applyRecenter + getRecenterPose: table 1 m ahead of the head', { skip }, () => {
  const table = createTable(null);
  const h = head([0.4, 1.7, 1.1], -0.9, -0.3);
  applyRecenter(table, getRecenterPose(h, {}));
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(h.quaternion);
  fwd.y = 0;
  fwd.normalize();
  const expected = new THREE.Vector3(0.4, 0.9, 1.1).addScaledVector(fwd, 1);
  assert.ok(table.position.distanceTo(expected) < 1e-9, table.position.toArray().join());
  table.userData.dispose();
});
