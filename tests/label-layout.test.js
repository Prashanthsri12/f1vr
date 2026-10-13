// Pure logic: car label declutter (js/scene/label-layout.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { declutterLabels, MODE_FULL, MODE_SHORT } from '../js/scene/label-layout.js';

function rig(n) {
  return {
    n,
    visible: new Uint8Array(n).fill(1),
    cx: new Float32Array(n), cy: new Float32Array(n),
    hw: new Float32Array(n).fill(0.03), hh: new Float32Array(n).fill(0.01),
    must: new Uint8Array(n), rank: new Int16Array(n),
    order: new Int16Array(n), modes: new Uint8Array(n),
  };
}
const run = (r) => declutterLabels(r.n, r.visible, r.cx, r.cy, r.hw, r.hh, r.must, r.rank, r.order, r.modes);

test('labels far apart all stay full', () => {
  const r = rig(4);
  for (let i = 0; i < 4; i++) { r.cx[i] = i * 0.2; r.rank[i] = i + 1; }
  assert.deepEqual([...run(r)], [MODE_FULL, MODE_FULL, MODE_FULL, MODE_FULL]);
});

test('overlapping labels: the better-ranked one stays full', () => {
  const r = rig(2);
  r.cx[0] = 0; r.cx[1] = 0.01;
  r.rank[0] = 8; r.rank[1] = 5;
  run(r);
  assert.equal(r.modes[1], MODE_FULL);
  assert.equal(r.modes[0], MODE_SHORT);
});

test('must labels stay full even when overlapping, and push others short', () => {
  const r = rig(3);
  // all on top of each other; label 2 (P12) is selected, label 0 is P1, label 1 is P6
  r.rank[0] = 1; r.rank[1] = 6; r.rank[2] = 12;
  r.must[0] = 1; r.must[2] = 1;
  run(r);
  assert.equal(r.modes[0], MODE_FULL);
  assert.equal(r.modes[2], MODE_FULL);
  assert.equal(r.modes[1], MODE_SHORT);
});

test('a short label does not block later labels', () => {
  const r = rig(3);
  r.cx[0] = 0; r.cx[1] = 0.04; r.cx[2] = 0.08; // 0–1 overlap, 1–2 overlap, 0–2 do not
  r.rank[0] = 1; r.rank[1] = 2; r.rank[2] = 3;
  run(r);
  assert.deepEqual([...r.modes], [MODE_FULL, MODE_SHORT, MODE_FULL]);
});

test('invisible labels are ignored', () => {
  const r = rig(2);
  r.rank[0] = 1; r.rank[1] = 2;
  r.visible[0] = 0;
  run(r);
  assert.equal(r.modes[1], MODE_FULL);
});

test('vertical separation avoids a clash', () => {
  const r = rig(2);
  r.cy[1] = 0.025; // more than hh0 + hh1 = 0.02
  r.rank[0] = 1; r.rank[1] = 2;
  run(r);
  assert.deepEqual([...r.modes], [MODE_FULL, MODE_FULL]);
});
