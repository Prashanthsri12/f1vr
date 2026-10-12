import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBounds, dedupePoints, trimClosure, computeTransformParams, makeToScene,
  trackWidth, nearestSampleIndex, headingFromDelta, TARGET_SIZE, BASE_HEIGHT,
} from '../js/scene/track-math.js';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

// A 20000 x 10000 raw-unit rectangle-ish track with elevation 100..300
const rect = [
  { x: -10000, y: -5000, z: 100 },
  { x: 10000, y: -5000, z: 300 },
  { x: 10000, y: 5000, z: 200 },
  { x: -10000, y: 5000, z: 150 },
];

test('computeBounds', () => {
  const b = computeBounds(rect);
  assert.deepEqual(b, { minX: -10000, maxX: 10000, minY: -5000, maxY: 5000, minZ: 100, maxZ: 300 });
});

test('normalises longest horizontal dimension to 1.4 m, centred', () => {
  const pts = rect.map((p) => ({ x: p.x + 500, y: p.y - 2000, z: p.z }));
  const params = computeTransformParams(pts);
  close(params.scale, TARGET_SIZE / 20000);
  assert.deepEqual(params.center, { x: 500, y: -2000, z: 100 });
  const toScene = makeToScene(params);
  const out = { x: 0, y: 0, z: 0 };
  const xs = [], zs = [];
  for (const p of pts) { toScene(p.x, p.y, p.z, out); xs.push(out.x); zs.push(out.z); }
  close(Math.max(...xs) - Math.min(...xs), 1.4);
  close(Math.max(...zs) - Math.min(...zs), 0.7);
  close(Math.max(...xs) + Math.min(...xs), 0);
  close(Math.max(...zs) + Math.min(...zs), 0);
});

test('longest dimension along y also maps to 1.4 m', () => {
  const pts = rect.map((p) => ({ x: p.y, y: p.x, z: p.z }));
  const params = computeTransformParams(pts);
  close(params.scale, 1.4 / 20000);
});

test('API y maps to scene -z, API x to scene x', () => {
  const toScene = makeToScene(computeTransformParams(rect));
  const out = { x: 0, y: 0, z: 0 };
  toScene(10000, 5000, 100, out);
  close(out.x, 0.7);
  close(out.z, -0.35);
  toScene(-10000, -5000, 100, out);
  close(out.x, -0.7);
  close(out.z, 0.35);
});

test('elevation: lowest point at base height, z exaggerated x2', () => {
  const params = computeTransformParams(rect);
  const toScene = makeToScene(params);
  const out = { x: 0, y: 0, z: 0 };
  toScene(0, 0, 100, out);
  close(out.y, BASE_HEIGHT);
  toScene(0, 0, 300, out);
  close(out.y, BASE_HEIGHT + 200 * params.scale * 2);
  assert.ok(out.y > BASE_HEIGHT);
});

test('toScene writes into out and returns it (no allocation)', () => {
  const toScene = makeToScene(computeTransformParams(rect));
  const out = { x: 9, y: 9, z: 9 };
  assert.equal(toScene(1, 2, 3, out), out);
});

test('custom options', () => {
  const params = computeTransformParams(rect, { targetSize: 2, zExaggeration: 1, baseHeight: 0 });
  const toScene = makeToScene(params);
  const out = {};
  toScene(10000, 0, 300, out);
  close(out.x, 1);
  close(out.y, 200 * (2 / 20000));
});

test('degenerate bounds throw', () => {
  assert.throws(() => computeTransformParams([{ x: 1, y: 1, z: 0 }, { x: 1, y: 1, z: 5 }]));
});

test('dedupePoints drops zeros and near duplicates', () => {
  const pts = [
    { x: 0, y: 0, z: 0 },
    { x: 100, y: 100, z: 0 },
    { x: 100.5, y: 100, z: 0 },
    { x: 200, y: 100, z: 0 },
    { x: 0, y: 0, z: 0 },
    { x: 200, y: 300, z: 1 },
  ];
  const d = dedupePoints(pts, 1);
  assert.deepEqual(d.map((p) => p.x), [100, 200, 200]);
  assert.equal(dedupePoints([{ x: 0, y: 0, z: 0 }]).length, 0);
  // default minDist = 0.1% of extent
  const d2 = dedupePoints([{ x: 1, y: 1, z: 0 }, { x: 1.001, y: 1, z: 0 }, { x: 1001, y: 1, z: 0 }]);
  assert.equal(d2.length, 2);
});

test('trimClosure removes tail points that overlap the lap start', () => {
  // circle, 40 points, then 2 extra points past the start (overlap)
  const pts = [];
  for (let i = 0; i < 42; i++) {
    const a = (i / 40) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * 1000, y: Math.sin(a) * 1000, z: 0 });
  }
  const t = trimClosure(pts);
  assert.equal(t.length, 40);
  // a clean lap is left alone
  assert.equal(trimClosure(pts.slice(0, 40)).length, 40);
  assert.equal(pts.length, 42, 'input not mutated');
});

test('trackWidth is 1.5% of 1.4 m', () => close(trackWidth(), 0.021));

test('nearestSampleIndex', () => {
  const flat = [0, 0, 0, 1, 0, 1, 2, 0, 0];
  assert.equal(nearestSampleIndex(flat, 0.9, 1.1), 1);
  assert.equal(nearestSampleIndex(flat, 1.9, 0), 2);
});

test('headingFromDelta', () => {
  close(headingFromDelta(0, 1), 0);
  close(headingFromDelta(1, 0), Math.PI / 2);
  assert.ok(Number.isNaN(headingFromDelta(0, 0)));
});
