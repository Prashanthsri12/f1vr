import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lowerBound, indexAtOrBefore, bracket, lerp, lerpAngle } from '../js/interp.js';

const T = [10, 20, 30, 40];

test('lowerBound basic, exact hits, out of range', () => {
  assert.equal(lowerBound(T, 5), 0);
  assert.equal(lowerBound(T, 10), 0);
  assert.equal(lowerBound(T, 15), 1);
  assert.equal(lowerBound(T, 40), 3);
  assert.equal(lowerBound(T, 41), 4);
});

test('indexAtOrBefore basic, exact hits, out of range', () => {
  assert.equal(indexAtOrBefore(T, 5), -1);
  assert.equal(indexAtOrBefore(T, 10), 0);
  assert.equal(indexAtOrBefore(T, 15), 0);
  assert.equal(indexAtOrBefore(T, 40), 3);
  assert.equal(indexAtOrBefore(T, 1e9), 3);
});

test('empty and single-element arrays', () => {
  assert.equal(lowerBound([], 1), 0);
  assert.equal(indexAtOrBefore([], 1), -1);
  assert.equal(lowerBound([5], 5), 0);
  assert.equal(lowerBound([5], 6), 1);
  assert.equal(indexAtOrBefore([5], 4), -1);
  assert.equal(indexAtOrBefore([5], 5), 0);
});

test('duplicates: lowerBound gives first, indexAtOrBefore gives last', () => {
  const d = [1, 2, 2, 2, 3];
  assert.equal(lowerBound(d, 2), 1);
  assert.equal(indexAtOrBefore(d, 2), 3);
});

test('works on Float64Array', () => {
  const f = Float64Array.from(T);
  assert.equal(lowerBound(f, 25), 2);
  assert.equal(indexAtOrBefore(f, 25), 1);
  const out = { i0: 0, i1: 0, f: 0 };
  assert.equal(bracket(f, 25, out), true);
  assert.deepEqual(out, { i0: 1, i1: 2, f: 0.5 });
});

test('bracket inside range interpolates fraction', () => {
  const out = { i0: 0, i1: 0, f: 0 };
  assert.equal(bracket(T, 12.5, out), true);
  assert.deepEqual(out, { i0: 0, i1: 1, f: 0.25 });
});

test('bracket exact hits', () => {
  const out = { i0: 0, i1: 0, f: 0 };
  assert.equal(bracket(T, 10, out), true);
  assert.deepEqual(out, { i0: 0, i1: 1, f: 0 });
  assert.equal(bracket(T, 30, out), true);
  assert.deepEqual(out, { i0: 2, i1: 3, f: 0 });
  assert.equal(bracket(T, 40, out), true);
  assert.deepEqual(out, { i0: 3, i1: 3, f: 0 });
});

test('bracket outside range clamps and returns false', () => {
  const out = { i0: 9, i1: 9, f: 9 };
  assert.equal(bracket(T, 0, out), false);
  assert.deepEqual(out, { i0: 0, i1: 0, f: 0 });
  assert.equal(bracket(T, 99, out), false);
  assert.deepEqual(out, { i0: 3, i1: 3, f: 0 });
  assert.equal(bracket(T, NaN, out), false);
});

test('bracket empty and single', () => {
  const out = { i0: 9, i1: 9, f: 9 };
  assert.equal(bracket([], 1, out), false);
  assert.deepEqual(out, { i0: -1, i1: -1, f: 0 });
  assert.equal(bracket([5], 5, out), true);
  assert.deepEqual(out, { i0: 0, i1: 0, f: 0 });
  assert.equal(bracket([5], 6, out), false);
  assert.deepEqual(out, { i0: 0, i1: 0, f: 0 });
});

test('bracket with duplicates never divides by zero', () => {
  const d = [1, 2, 2, 3];
  const out = { i0: 0, i1: 0, f: 0 };
  assert.equal(bracket(d, 2, out), true);
  assert.deepEqual(out, { i0: 2, i1: 3, f: 0 });
  assert.equal(bracket(d, 2.5, out), true);
  assert.deepEqual(out, { i0: 2, i1: 3, f: 0.5 });
  assert.equal(bracket([2, 2], 2, out), true);
  assert.deepEqual(out, { i0: 1, i1: 1, f: 0 });
});

test('bracket matches brute force on random data', () => {
  const times = new Float64Array(200);
  let acc = 0;
  for (let i = 0; i < times.length; i++) { acc += Math.floor(Math.random() * 3); times[i] = acc; }
  const out = { i0: 0, i1: 0, f: 0 };
  for (let k = 0; k < 500; k++) {
    const t = Math.random() * (acc + 2) - 1;
    let expected = -1;
    for (let i = 0; i < times.length; i++) if (times[i] <= t) expected = i;
    assert.equal(indexAtOrBefore(times, t), expected);
    const inside = bracket(times, t, out);
    assert.equal(inside, t >= times[0] && t <= acc);
    if (inside) {
      const v = lerp(times[out.i0], times[out.i1], out.f);
      assert.ok(Math.abs(v - t) < 1e-9, `t=${t} v=${v}`);
    }
  }
});

test('lerp', () => {
  assert.equal(lerp(0, 10, 0), 0);
  assert.equal(lerp(0, 10, 1), 10);
  assert.equal(lerp(-4, 4, 0.5), 0);
});

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const norm = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

test('lerpAngle takes the shortest path across the wrap', () => {
  close(lerpAngle(0, Math.PI / 2, 0.5), Math.PI / 4);
  // 350deg -> 10deg should go through 0, not 180
  const a = (350 * Math.PI) / 180, b = (10 * Math.PI) / 180;
  close(norm(lerpAngle(a, b, 0.5)), 0);
  close(norm(lerpAngle(b, a, 0.5)), 0);
  close(lerpAngle(a, b, 0), a);
  close(norm(lerpAngle(a, b, 1)), norm(b));
  // -170deg -> 170deg crosses ±180
  const c = (-170 * Math.PI) / 180, d = (170 * Math.PI) / 180;
  close(norm(lerpAngle(c, d, 0.5)), Math.PI);
  // multi-turn inputs
  close(norm(lerpAngle(0, 4 * Math.PI + 0.2, 0.5)), 0.1);
});
