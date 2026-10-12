import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheGet, cachePut, cacheClear } from '../js/cache.js';

// Node has no indexedDB, so this exercises the in-memory fallback.

test('miss returns undefined', async () => {
  assert.equal(await cacheGet('nope'), undefined);
});

test('put then get round-trips values', async () => {
  await cachePut('k1', [{ a: 1 }]);
  assert.deepEqual(await cacheGet('k1'), [{ a: 1 }]);
  await cachePut('k-empty', []);
  assert.deepEqual(await cacheGet('k-empty'), []);
});

test('stores are separate', async () => {
  await cachePut('same', 'resp');
  await cachePut('same', 'track', 'tracks');
  assert.equal(await cacheGet('same'), 'resp');
  assert.equal(await cacheGet('same', 'tracks'), 'track');
});

test('overwrite replaces value', async () => {
  await cachePut('ow', 1);
  await cachePut('ow', 2);
  assert.equal(await cacheGet('ow'), 2);
});

test('cacheClear empties every store', async () => {
  await cachePut('c1', 1);
  await cachePut('c2', 2, 'tracks');
  await cacheClear();
  assert.equal(await cacheGet('c1'), undefined);
  assert.equal(await cacheGet('c2', 'tracks'), undefined);
});
