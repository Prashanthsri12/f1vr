import test from 'node:test';
import assert from 'node:assert/strict';
import { retimeSeries } from '../js/retime.js';

/** Constant 250 km/h along x with ±150 ms timestamp jitter. */
function jittered(n = 60) {
  const speed = 250 / 3.6 * 10; // raw units (dm) per second
  const times = new Float64Array(n);
  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n).fill(5);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let i = 0; i < n; i++) {
    const t = i * 270;
    x[i] = speed * t / 1000;
    times[i] = 1e12 + t + rnd() * 300;
  }
  times.sort();
  return { times, x, y, z };
}

const speedJitter = ({ times, x }) => {
  let sum = 0, prev = null;
  for (let i = 1; i < times.length; i++) {
    const v = (x[i] - x[i - 1]) / (times[i] - times[i - 1]);
    if (prev !== null) sum += Math.abs(v - prev);
    prev = v;
  }
  return sum / (times.length - 2);
};

test('retime removes most timestamp jitter at constant speed', () => {
  const s = jittered();
  const before = speedJitter(s);
  retimeSeries(s.times, s.x, s.y, s.z);
  const after = speedJitter(s);
  assert.ok(after < before * 0.35, `jitter ${before} -> ${after}`);
});

test('retime keeps times strictly increasing and endpoints fixed', () => {
  const s = jittered();
  const first = s.times[0], last = s.times[s.times.length - 1];
  retimeSeries(s.times, s.x, s.y, s.z);
  assert.equal(s.times[0], first);
  assert.equal(s.times[s.times.length - 1], last);
  for (let i = 1; i < s.times.length; i++) assert.ok(s.times[i] > s.times[i - 1]);
});

test('retime leaves stationary cars and zero points alone', () => {
  const times = Float64Array.from([0, 300, 550, 900, 1200, 1500]);
  const orig = Float64Array.from(times);
  const x = Float32Array.from([10, 10, 0, 10, 10, 10]);
  const y = Float32Array.from([10, 10, 0, 10, 10, 10]);
  const z = Float32Array.from([1, 1, 0, 1, 1, 1]);
  retimeSeries(times, x, y, z);
  assert.deepEqual([...times], [...orig]);
});
