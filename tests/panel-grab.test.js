// Browser module (imports three). Runs with THREE_DIR set, see tests/support/three-hook.mjs;
// otherwise skipped under plain `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';

let THREE;
let createPanelGrab;
let MIN_DIST;
let MAX_DIST;
let MIN_SCALE;
let MAX_SCALE;
try {
  THREE = await import('three');
  ({ createPanelGrab, MIN_DIST, MAX_DIST, MIN_SCALE, MAX_SCALE } = await import('../js/input/panel-grab.js'));
} catch (err) {
  if (process.env.THREE_DIR) throw err;
  THREE = null;
}

const skip = THREE ? false : 'three is not installed for Node (browser-only import map)';

function near(a, b, eps = 1e-5, msg = '') {
  assert.ok(a.distanceTo(b) < eps, `${msg}: expected ${b.toArray()} got ${a.toArray()}`);
}

/** A panel mesh inside a (possibly transformed) layout rig, placed like PanelManager.add. */
function rig({ rigPos = [0, 0, 0], rigYaw = 0 } = {}) {
  const scene = new THREE.Scene();
  const group = new THREE.Group();
  group.position.fromArray(rigPos);
  group.rotation.y = rigYaw;
  scene.add(group);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.2));
  mesh.position.set(-0.8, 1.4, -1.15);
  mesh.lookAt(0, 1.4, 0); // no parent yet: rig-local
  group.add(mesh);
  scene.updateMatrixWorld(true);
  const panel = { name: 'leaderboard', mesh };
  const released = [];
  const grab = createPanelGrab({ getMovable: (p) => (p === panel ? mesh : null), onRelease: () => released.push(1) });
  return { mesh, panel, grab, released };
}

/** World point at plane-local (x, y). */
function localPoint(mesh, x, y) {
  mesh.updateWorldMatrix(true, false);
  return mesh.localToWorld(new THREE.Vector3(x, y, 0));
}

function checkFollow({ rigPos, rigYaw }) {
  const { mesh, panel, grab } = rig({ rigPos, rigYaw });
  const rigOrigin = new THREE.Vector3(...rigPos);
  const origin = new THREE.Vector3(0.2, 1.3, 0).applyEuler(new THREE.Euler(0, rigYaw, 0)).add(rigOrigin);
  const hit = localPoint(mesh, 0.1, 0.3);
  const dist = origin.distanceTo(hit);
  assert.equal(grab.begin('r', panel, hit, origin), true);

  const dir = new THREE.Vector3(0.6, 0.1, -0.8).normalize();
  const face = new THREE.Vector3(rigPos[0], 1.6, rigPos[2]);
  grab.update('r', origin, dir, face);

  const expected = origin.clone().addScaledVector(dir, dist);
  near(localPoint(mesh, 0.1, 0.3), expected, 1e-5, 'grab point on the ray at a fixed distance');

  mesh.updateWorldMatrix(true, false);
  const front = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
  const toFace = face.clone().sub(expected);
  toFace.y = 0;
  toFace.normalize();
  near(front, toFace, 1e-5, '+Z faces facePos (yaw taken from the grab point)');
  const up = new THREE.Vector3(0, 1, 0).transformDirection(mesh.matrixWorld);
  near(up, new THREE.Vector3(0, 1, 0), 1e-5, 'upright');
}

test('grab point follows the ray at a fixed distance and faces the user', { skip }, () => {
  checkFollow({ rigPos: [0, 0, 0], rigYaw: 0 });
});

test('same result inside a translated and rotated rig', { skip }, () => {
  checkFollow({ rigPos: [1.5, 0, -0.7], rigYaw: 1.1 });
  checkFollow({ rigPos: [-2, 0, 3], rigYaw: -2.6 });
});

test('an unchanged ray keeps the grab point where it was hit', { skip }, () => {
  const { mesh, panel, grab } = rig();
  const origin = new THREE.Vector3(0, 1.3, 0);
  const hit = localPoint(mesh, -0.2, 0.1);
  const dir = hit.clone().sub(origin).normalize();
  grab.begin('r', panel, hit, origin);
  grab.update('r', origin, dir, new THREE.Vector3(0, 1.6, 0));
  near(localPoint(mesh, -0.2, 0.1), hit, 1e-5, 'no jump');
});

test('distance is clamped on begin and by adjust', { skip }, () => {
  const { mesh, panel, grab } = rig();
  const dir = new THREE.Vector3(0, 0, -1);
  const face = new THREE.Vector3(0, 1.6, 5);
  const measure = (origin) => {
    grab.update('r', origin, dir, face);
    return localPoint(mesh, 0, 0).distanceTo(origin);
  };
  const hit = localPoint(mesh, 0, 0);
  const close = hit.clone().add(new THREE.Vector3(0, 0, 0.1));
  grab.begin('r', panel, hit, close);
  assert.ok(Math.abs(measure(close) - MIN_DIST) < 1e-5, 'begin clamps up');
  grab.adjust('r', 100);
  assert.ok(Math.abs(measure(close) - MAX_DIST) < 1e-5, 'adjust clamps at max');
  grab.adjust('r', -100);
  assert.ok(Math.abs(measure(close) - MIN_DIST) < 1e-5, 'adjust clamps at min');
  grab.adjust('r', 0.25);
  assert.ok(Math.abs(measure(close) - (MIN_DIST + 0.25)) < 1e-5);
  grab.end('r');
  const hit2 = localPoint(mesh, 0, 0);
  const far = hit2.clone().add(new THREE.Vector3(0, 0, 10));
  grab.begin('r', panel, hit2, far);
  assert.ok(Math.abs(measure(far) - MAX_DIST) < 1e-5, 'begin clamps down');
  assert.equal(MIN_DIST, 0.5);
  assert.equal(MAX_DIST, 4);
});

test('one carrier and at most one stretcher per unit; one grab per pointer', { skip }, () => {
  const { mesh, panel, grab } = rig();
  const hit = localPoint(mesh, 0, 0);
  const o = new THREE.Vector3(0, 1.3, 0);
  assert.equal(grab.begin('a', panel, hit, o), true);
  assert.equal(grab.isHeld(panel), true);
  assert.equal(grab.begin('b', panel, hit, new THREE.Vector3(0.3, 1.3, 0)), true, 'second pointer stretches');
  assert.equal(grab.begin('c', panel, hit, o), false, 'no third pointer');
  assert.equal(grab.has('a'), true);
  assert.equal(grab.has('b'), true);
  assert.equal(grab.begin('a', panel, hit, o), false, 'same id twice');
  grab.end('a');
  assert.equal(grab.has('b'), false, 'releasing the carrier ends the stretch');
  assert.equal(grab.isHeld(panel), false);
  assert.equal(grab.begin('b', panel, hit, o), true, 'free again after release');
});

test('scaleBy resizes about the grab point (it stays on the ray) and clamps to 0.5–2.5', { skip }, () => {
  const { mesh, panel, grab } = rig({ rigPos: [0.4, 0, -0.3], rigYaw: 0.7 });
  const origin = new THREE.Vector3(0.5, 1.3, 0);
  const hit = localPoint(mesh, 0.3, 0.4);
  const dist = origin.distanceTo(hit);
  grab.begin('r', panel, hit, origin);
  const dir = hit.clone().sub(origin).normalize();
  const face = new THREE.Vector3(0.4, 1.6, -0.3);
  grab.scaleBy('r', 1.8);
  grab.update('r', origin, dir, face);
  assert.ok(Math.abs(mesh.scale.x - 1.8) < 1e-9);
  near(localPoint(mesh, 0.3, 0.4), origin.clone().addScaledVector(dir, dist), 1e-5, 'grab point fixed while growing');
  grab.scaleBy('r', 10);
  assert.equal(mesh.scale.x, MAX_SCALE);
  grab.scaleBy('r', 0.001);
  assert.equal(mesh.scale.x, MIN_SCALE);
  grab.update('r', origin, dir, face);
  near(localPoint(mesh, 0.3, 0.4), origin.clone().addScaledVector(dir, dist), 1e-5, 'grab point fixed while shrinking');
  assert.equal(MIN_SCALE, 0.5);
  assert.equal(MAX_SCALE, 2.5);
});

test('two-pointer stretch scales by the change in pointer distance', { skip }, () => {
  const { mesh, panel, grab, released } = rig();
  const a = new THREE.Vector3(0, 1.3, 0);
  const b = new THREE.Vector3(0.2, 1.3, 0);
  const hitA = localPoint(mesh, 0, 0);
  const dirA = hitA.clone().sub(a).normalize();
  const face = new THREE.Vector3(0, 1.6, 0);
  grab.begin('a', panel, hitA, a);
  grab.update('a', a, dirA, face);
  grab.begin('b', panel, localPoint(mesh, 0.2, 0), b);
  grab.update('b', new THREE.Vector3(0.6, 1.3, 0), dirA, face); // 0.2 m -> 0.6 m apart
  assert.ok(Math.abs(mesh.scale.x - 2.5) < 1e-9, 'x3 clamped to 2.5');
  grab.update('b', new THREE.Vector3(0.3, 1.3, 0), dirA, face); // 0.3 m apart
  assert.ok(Math.abs(mesh.scale.x - 1.5) < 1e-9);
  grab.update('a', a, dirA, face);
  near(localPoint(mesh, 0, 0), a.clone().addScaledVector(dirA, a.distanceTo(hitA)), 1e-5, 'carrier grab point stays on its ray');
  grab.end('b');
  assert.equal(released.length, 1, 'stretch end saves');
  assert.equal(grab.isGrabbing(), true, 'carrier still holds it');
  grab.update('b', new THREE.Vector3(5, 1.3, 0), dirA, face);
  assert.ok(Math.abs(mesh.scale.x - 1.5) < 1e-9, 'ended stretcher has no effect');
});

test('scaleUnit resizes a unit that is not held; canMove reports movable panels', { skip }, () => {
  const { mesh, panel, grab, released } = rig();
  assert.equal(grab.canMove(panel), true);
  assert.equal(grab.canMove({ name: 'wrist-menu', mesh: new THREE.Mesh() }), false);
  assert.equal(grab.canMove(null), false);
  assert.equal(grab.scaleUnit(panel, 1.2), true);
  assert.ok(Math.abs(mesh.scale.x - 1.2) < 1e-9);
  assert.equal(released.length, 1);
  grab.scaleUnit(panel, 100);
  assert.equal(mesh.scale.x, MAX_SCALE);
  assert.equal(grab.scaleUnit({ name: 'x', mesh: new THREE.Mesh() }, 2), false);
  assert.equal(grab.scaleUnit(null, 2), false);
});

test('non-movable panels and null are refused', { skip }, () => {
  const { grab } = rig();
  const o = new THREE.Vector3();
  assert.equal(grab.begin('a', { name: 'wrist-menu', mesh: new THREE.Mesh() }, o, o), false);
  assert.equal(grab.begin('a', null, o, o), false);
  assert.equal(grab.isGrabbing(), false);
});

test('onRelease fires once per active grab; isGrabbing tracks state', { skip }, () => {
  const { mesh, panel, grab, released } = rig();
  grab.end('nobody');
  assert.equal(released.length, 0);
  grab.begin('a', panel, localPoint(mesh, 0, 0), new THREE.Vector3(0, 1.3, 0));
  assert.equal(grab.isGrabbing(), true);
  grab.end('a');
  assert.equal(released.length, 1);
  assert.equal(grab.isGrabbing(), false);
  grab.end('a');
  assert.equal(released.length, 1);
  assert.doesNotThrow(() => {
    grab.update('x', new THREE.Vector3(), new THREE.Vector3(0, 0, -1), new THREE.Vector3());
    grab.adjust('x', 1);
  });
});

test('a group unit (driver picker) moves its children rigidly', { skip }, () => {
  const scene = new THREE.Scene();
  const rigG = new THREE.Group();
  rigG.position.set(0.5, 0, 0.5);
  rigG.rotation.y = 0.4;
  scene.add(rigG);
  const group = new THREE.Group();
  group.position.set(0, 1.0, -0.62);
  rigG.add(group);
  const tileA = new THREE.Mesh();
  tileA.position.set(-0.2, 0, 0);
  group.add(tileA);
  const tileB = new THREE.Mesh();
  tileB.position.set(0.2, 0.05, -0.1);
  group.add(tileB);
  scene.updateMatrixWorld(true);
  const grab = createPanelGrab({ getMovable: () => group });
  const origin = new THREE.Vector3(0.6, 1.3, 0.4);
  const hit = tileA.getWorldPosition(new THREE.Vector3());
  const ab = tileB.getWorldPosition(new THREE.Vector3()).distanceTo(hit);
  assert.equal(grab.begin('r', { name: 'driver:1', mesh: tileA }, hit, origin), true);
  const dir = new THREE.Vector3(-0.3, -0.2, -0.9).normalize();
  grab.update('r', origin, dir, new THREE.Vector3(0.5, 1.6, 0.5));
  scene.updateMatrixWorld(true);
  const a = tileA.getWorldPosition(new THREE.Vector3());
  const b = tileB.getWorldPosition(new THREE.Vector3());
  near(a, origin.clone().addScaledVector(dir, origin.distanceTo(hit)), 1e-5, 'grabbed tile on the ray');
  assert.ok(Math.abs(a.distanceTo(b) - ab) < 1e-6, 'rigid move');
});
