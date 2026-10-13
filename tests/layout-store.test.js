// layout-store.js with a stub localStorage (no three needed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLayout, saveLayout, clearLayout } from '../js/panels/layout-store.js';

const KEY = 'f1vr.layout.v1';

function stubStorage() {
  const m = new Map();
  globalThis.localStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
  return m;
}

test('empty storage loads {}', () => {
  stubStorage();
  assert.deepEqual(loadLayout(), {});
});

test('save then load round-trips', () => {
  stubStorage();
  const items = {
    leaderboard: { p: [1, 2, 3], q: [0, 0, 0, 1], s: 1.75 },
    'driver-picker': { p: [0, 1, -0.6], q: [0, 0.7071, 0, 0.7071], s: 0.5 },
  };
  saveLayout(items);
  assert.deepEqual(loadLayout(), items);
});

test('scale: missing (older saves) loads as 1, out of range is clamped, junk becomes 1', () => {
  const m = stubStorage();
  const pq = { p: [0, 0, 0], q: [0, 0, 0, 1] };
  m.set(KEY, JSON.stringify({
    items: {
      old: pq,
      big: { ...pq, s: 9 },
      small: { ...pq, s: 0.1 },
      zero: { ...pq, s: 0 },
      neg: { ...pq, s: -2 },
      str: { ...pq, s: '2' },
      nan: { ...pq, s: null },
      ok: { ...pq, s: 1.25 },
    },
  }));
  const l = loadLayout();
  assert.equal(l.old.s, 1);
  assert.equal(l.big.s, 2.5);
  assert.equal(l.small.s, 0.5);
  assert.equal(l.zero.s, 1);
  assert.equal(l.neg.s, 1);
  assert.equal(l.str.s, 1);
  assert.equal(l.nan.s, 1);
  assert.equal(l.ok.s, 1.25);
});

test('clear removes the saved layout', () => {
  const m = stubStorage();
  saveLayout({ ticker: { p: [0, 0, 0], q: [0, 0, 0, 1] } });
  assert.ok(m.has(KEY));
  clearLayout();
  assert.ok(!m.has(KEY));
  assert.deepEqual(loadLayout(), {});
});

test('invalid entries are rejected, valid ones kept', () => {
  const m = stubStorage();
  m.set(KEY, JSON.stringify({
    items: {
      ok: { p: [1, 2, 3], q: [0, 0, 0, 1] },
      shortP: { p: [1, 2], q: [0, 0, 0, 1] },
      shortQ: { p: [1, 2, 3], q: [0, 0, 1] },
      strings: { p: ['1', 2, 3], q: [0, 0, 0, 1] },
      nulls: { p: [null, 2, 3], q: [0, 0, 0, 1] },
      missing: { p: [1, 2, 3] },
      notObj: 5,
      nul: null,
    },
  }));
  assert.deepEqual(loadLayout(), { ok: { p: [1, 2, 3], q: [0, 0, 0, 1], s: 1 } });
});

test('bad JSON and wrong shapes load {}', () => {
  const m = stubStorage();
  for (const raw of ['{not json', JSON.stringify({ items: 'nope' }), 'null', '[]', '5']) {
    m.set(KEY, raw);
    assert.deepEqual(loadLayout(), {}, raw);
  }
});

test('throwing storage is tolerated', () => {
  const boom = () => { throw new Error('SecurityError'); };
  globalThis.localStorage = { getItem: boom, setItem: boom, removeItem: boom };
  assert.deepEqual(loadLayout(), {});
  assert.doesNotThrow(() => saveLayout({ a: { p: [0, 0, 0], q: [0, 0, 0, 1] } }));
  assert.doesNotThrow(() => clearLayout());
});

test('missing localStorage is tolerated', () => {
  delete globalThis.localStorage;
  assert.deepEqual(loadLayout(), {});
  assert.doesNotThrow(() => saveLayout({}));
  assert.doesNotThrow(() => clearLayout());
});
