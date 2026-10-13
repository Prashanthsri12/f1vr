// Onboard camera (js/scene/onboard.js): 30 Hz throttle, pose handling and renderer state
// restore. Browser module (imports three): runs with THREE_DIR set, see tests/support/three-hook.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';

let THREE;
let Onboard;
try {
  THREE = await import('three');
  ({ Onboard } = await import('../js/scene/onboard.js'));
} catch (err) {
  if (process.env.THREE_DIR) throw err;
  THREE = null;
}
const skip = THREE ? false : 'three is not installed for Node (browser-only import map)';

function rig({ pose = true } = {}) {
  const calls = [];
  const xrTarget = { isXRRenderTarget: true };
  let target = xrTarget;
  const clear = new THREE.Color(0x123456);
  const renderer = {
    xr: { enabled: true },
    info: { render: { calls: 5 } },
    getRenderTarget: () => target,
    setRenderTarget: (t) => { target = t; calls.push(['target', t === xrTarget ? 'xr' : t ? 'rt' : null]); },
    getClearAlpha: () => 0,
    getClearColor: (c) => c.copy(clear),
    setClearColor: () => {},
    render: (root, cam) => calls.push(['render', root.name, renderer.xr.enabled, cam.isCamera]),
  };
  const table = new THREE.Group();
  table.name = 'table';
  const content = new THREE.Group();
  table.add(content);
  table.userData.content = content;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 2);
  const cars = {
    selectedIndex: 0,
    mesh,
    _zero: new THREE.Matrix4().makeScale(0, 0, 0),
    glow: { visible: true },
    trail: { visible: true },
    labels: { mesh: { visible: true } },
    getSelectedPose: (out) => { if (!pose) return NaN; out.set(0.1, 0, 0.2); return Math.PI / 2; },
  };
  const ob = new Onboard({ renderer, table, cars });
  return { ob, renderer, calls, cars, xrTarget, getTarget: () => target };
}

test('renders about 30 times a second on a 72 Hz display', { skip }, () => {
  const { ob } = rig();
  let n = 0;
  for (let i = 0; i < 72 * 4; i++) if (ob.update(1 / 72, true)) n++;
  assert.ok(n >= 118 && n <= 122, `${n} passes in 4 s`);
});

test('nothing renders while the tab is hidden; the first active frame renders', { skip }, () => {
  const { ob } = rig();
  for (let i = 0; i < 100; i++) assert.equal(ob.update(1 / 72, false), false);
  assert.equal(ob.update(1 / 72, true), true);
});

test('no pass when the selected car is hidden', { skip }, () => {
  const { ob, calls } = rig({ pose: false });
  assert.equal(ob.update(0.1, true), false);
  assert.equal(calls.length, 0);
  assert.equal(ob.noPose, 1);
});

test('renders the table with XR off, then restores XR, target and hidden parts', { skip }, () => {
  const { ob, renderer, calls, cars, xrTarget, getTarget } = rig();
  const m = new THREE.Matrix4().makeTranslation(1, 2, 3);
  cars.mesh.setMatrixAt(0, m);
  ob.update(0.1, true);
  assert.deepEqual(calls[0], ['target', 'rt']);
  assert.deepEqual(calls[1], ['render', 'table', false, true]);
  assert.deepEqual(calls[2], ['target', 'xr']);
  assert.equal(renderer.xr.enabled, true);
  assert.equal(getTarget(), xrTarget);
  assert.equal(cars.glow.visible, true);
  assert.equal(cars.trail.visible, true);
  assert.equal(cars.labels.mesh.visible, true);
  const back = new THREE.Matrix4();
  cars.mesh.getMatrixAt(0, back);
  assert.ok(back.equals(m), 'selected car matrix restored');
});

test('camera sits on the car and looks along its heading', { skip }, () => {
  const { ob } = rig();
  ob.update(0.1, true);
  const dir = new THREE.Vector3();
  ob.camera.getWorldDirection(dir);
  // heading π/2: nose along +X
  assert.ok(dir.x > 0.99, `dir ${dir.toArray()}`);
  assert.ok(Math.abs(ob.camera.position.z - 0.2) < 1e-6);
  assert.ok(ob.camera.position.x < 0.1 && ob.camera.position.x > 0.09, 'a little behind the car centre');
  assert.ok(ob.camera.position.y > 0, 'above the track');
});
