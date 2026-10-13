// Browser module (imports three). Runs with THREE_DIR set, see tests/support/three-hook.mjs;
// otherwise skipped under plain `node --test`.
import test from 'node:test';
import assert from 'node:assert/strict';

let THREE;
let rooms;
try {
  THREE = await import('three');
  rooms = await import('../js/scene/rooms.js');
} catch (err) {
  if (process.env.THREE_DIR) throw err;
  THREE = null;
}

const skip = THREE ? false : 'three is not installed for Node (browser-only import map)';

function drawables(group) {
  const out = [];
  group.traverse((o) => { if (o.isMesh || o.isPoints || o.isLine) out.push(o); });
  return out;
}

test('every theme builds within the draw-call budget with static matrices', { skip }, () => {
  for (const theme of rooms.THEMES) {
    const room = rooms.buildRoom(theme);
    assert.equal(room.theme, theme);
    const d = drawables(room.group);
    assert.ok(d.length > 0 && d.length <= 15, `${theme}: ${d.length} draw calls`);
    for (const o of d) assert.equal(o.matrixAutoUpdate, false, `${theme}: ${o.name || o.type} is static`);
    assert.equal(typeof room.background, 'number');
    assert.ok(room.fog && room.fog.far > room.fog.near);
    room.dispose();
  }
});

test('every theme is enclosed: rays from the head in all directions hit room geometry', { skip }, () => {
  const ray = new THREE.Raycaster();
  const origin = new THREE.Vector3(0, 1.6, 0);
  const dir = new THREE.Vector3();
  for (const theme of rooms.THEMES) {
    const room = rooms.buildRoom(theme);
    room.group.updateMatrixWorld(true);
    const meshes = drawables(room.group).filter((o) => o.isMesh);
    let misses = 0;
    // Directions are offset off round angles so rays never land exactly on a shared triangle
    // edge (a raycast precision artefact; the rasteriser has no gap there).
    for (let el = -84.7; el <= 85; el += 17) {
      for (let az = 0.37; az < 360; az += 15) {
        const e = el * Math.PI / 180;
        const a = az * Math.PI / 180;
        dir.set(Math.cos(e) * Math.sin(a), Math.sin(e), -Math.cos(e) * Math.cos(a));
        ray.set(origin, dir);
        if (ray.intersectObjects(meshes, false).length === 0) misses++;
      }
    }
    // Straight up and down too.
    for (const y of [1, -1]) {
      ray.set(origin, dir.set(0, y, 0));
      if (ray.intersectObjects(meshes, false).length === 0) misses++;
    }
    assert.equal(misses, 0, `${theme}: ${misses} rays escaped to passthrough`);
    room.dispose();
  }
});

test('unknown theme falls back to pitwall', { skip }, () => {
  const room = rooms.buildRoom('nope');
  assert.equal(room.theme, 'pitwall');
  room.dispose();
});

test('the room leaves the main screen and panels clear', { skip }, () => {
  // Nothing solid between the head and the main screen centre (0, 1.6, -2.8).
  const ray = new THREE.Raycaster();
  const origin = new THREE.Vector3(0, 1.6, 0);
  const target = new THREE.Vector3(0, 1.6, -2.8);
  const dir = target.clone().sub(origin).normalize();
  for (const theme of rooms.THEMES) {
    const room = rooms.buildRoom(theme);
    room.group.updateMatrixWorld(true);
    ray.set(origin, dir);
    const hits = ray.intersectObjects(drawables(room.group).filter((o) => o.isMesh), false);
    assert.ok(!hits.length || hits[0].distance > 2.8, `${theme}: room blocks the main screen at ${hits[0] && hits[0].distance}`);
    room.dispose();
  }
});
