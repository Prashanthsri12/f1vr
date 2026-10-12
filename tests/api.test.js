import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_URL, buildUrl, RequestQueue, ApiError, fetchJson, getQueue } from '../js/api.js';
import { cacheGet } from '../js/cache.js';

// ---------- helpers ----------

/** Fake clock + sleep: sleeping advances the clock instantly. */
function fakeTime(start = 1_000_000) {
  const clock = { t: start, sleeps: [] };
  clock.now = () => clock.t;
  clock.sleep = async (ms) => { clock.sleeps.push(ms); clock.t += ms; };
  return clock;
}

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function makeQueue(fetchFn, opts = {}) {
  const clock = fakeTime();
  const q = new RequestQueue({ fetchFn, now: clock.now, sleep: clock.sleep, random: () => 0, ...opts });
  return { q, clock };
}

// ---------- buildUrl ----------

test('buildUrl plain params, insertion order, encoding', () => {
  assert.equal(buildUrl('laps', { session_key: 9472, driver_number: 1 }),
    `${BASE_URL}/laps?session_key=9472&driver_number=1`);
  assert.equal(buildUrl('/meetings', { country_name: 'Saudi Arabia' }),
    `${BASE_URL}/meetings?country_name=Saudi%20Arabia`);
  assert.equal(buildUrl('sessions'), `${BASE_URL}/sessions`);
  assert.equal(buildUrl('sessions', { a: undefined, b: null }), `${BASE_URL}/sessions`);
});

test('buildUrl operator keys', () => {
  const url = buildUrl('car_data', {
    session_key: 9472, driver_number: 1,
    'date>=': '2024-03-02T15:10:00', 'date<': '2024-03-02T15:10:05',
  });
  assert.equal(url, `${BASE_URL}/car_data?session_key=9472&driver_number=1`
    + '&date%3E%3D2024-03-02T15%3A10%3A00&date%3C2024-03-02T15%3A10%3A05');
  assert.equal(buildUrl('laps', { 'lap_number<=': 3, 'speed>': 300 }),
    `${BASE_URL}/laps?lap_number%3C%3D3&speed%3E300`);
});

test('buildUrl Date values become ISO strings', () => {
  const url = buildUrl('location', { 'date>=': new Date(Date.UTC(2024, 2, 2, 15, 10)) });
  assert.equal(url, `${BASE_URL}/location?date%3E%3D2024-03-02T15%3A10%3A00.000Z`);
});

// ---------- RequestQueue ----------

test('resolves parsed JSON', async () => {
  const { q } = makeQueue(async () => json([{ a: 1 }]));
  assert.deepEqual(await q.enqueue('u'), [{ a: 1 }]);
});

test('default fetch is called unbound-safe (no this) and passes the url', async () => {
  const seen = [];
  const { q } = makeQueue(function (url) { seen.push([url, this]); return Promise.resolve(json([])); });
  await q.enqueue('http://x/1');
  assert.equal(seen[0][0], 'http://x/1');
  assert.equal(seen[0][1], undefined);
});

test('runs strictly one request at a time', async () => {
  let active = 0, maxActive = 0;
  const { q } = makeQueue(async () => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setImmediate(r));
    active--;
    return json([]);
  });
  await Promise.all(Array.from({ length: 8 }, (_, i) => q.enqueue('u' + i)));
  assert.equal(maxActive, 1);
});

test('enforces 3/s and 30/min sliding windows', async () => {
  const starts = [];
  let clockRef;
  const { q, clock } = makeQueue(async () => { starts.push(clockRef.now()); return json([]); });
  clockRef = clock;
  const t0 = clock.now();
  await Promise.all(Array.from({ length: 65 }, (_, i) => q.enqueue('u' + i)));
  assert.equal(starts.length, 65);
  for (let i = 3; i < starts.length; i++) {
    assert.ok(starts[i] - starts[i - 3] >= 1000, `per-second violated at ${i}`);
  }
  for (let i = 30; i < starts.length; i++) {
    assert.ok(starts[i] - starts[i - 30] >= 60000, `per-minute violated at ${i}`);
  }
  // first 3 go immediately; 31st must wait a full minute; 61st two minutes
  assert.equal(starts[2], t0);
  assert.equal(starts[30] - t0, 60000);
  assert.equal(starts[60] - t0, 120000);
});

test('priority ordering: higher first, FIFO within a priority', async () => {
  const order = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const { q } = makeQueue(async (url) => {
    order.push(url);
    if (url === 'first') await gate;
    return json([]);
  });
  const ps = [q.enqueue('first')];
  await new Promise((r) => setImmediate(r)); // let 'first' start
  ps.push(q.enqueue('low-a', { priority: 0 }));
  ps.push(q.enqueue('high-a', { priority: 10 }));
  ps.push(q.enqueue('low-b'));
  ps.push(q.enqueue('mid', { priority: 5 }));
  ps.push(q.enqueue('high-b', { priority: 10 }));
  ps.push(q.enqueue('neg', { priority: -1 }));
  assert.equal(q.pending, 7);
  release();
  await Promise.all(ps);
  assert.deepEqual(order, ['first', 'high-a', 'high-b', 'mid', 'low-a', 'low-b', 'neg']);
  assert.equal(q.pending, 0);
});

test('retries 429 and 5xx with exponential backoff', async () => {
  const responses = [json({}, 429), json({}, 503), json({}, 500), json([1])];
  const { q, clock } = makeQueue(async () => responses.shift());
  assert.deepEqual(await q.enqueue('u'), [1]);
  assert.deepEqual(clock.sleeps.filter((ms) => ms >= 1000), [1000, 2000, 4000]);
});

test('jitter adds up to 25% of the base delay', async () => {
  const responses = [json({}, 503), json([])];
  const { q, clock } = makeQueue(async () => responses.shift(), { random: () => 0.5 });
  await q.enqueue('u');
  assert.deepEqual(clock.sleeps, [1125]);
});

test('honours Retry-After seconds when longer than backoff', async () => {
  const responses = [json({}, 429, { 'Retry-After': '7' }), json(['ok'])];
  const { q, clock } = makeQueue(async () => responses.shift());
  assert.deepEqual(await q.enqueue('u'), ['ok']);
  assert.ok(clock.sleeps.includes(7000), String(clock.sleeps));
});

test('exhausted retries throw ApiError with status', async () => {
  let calls = 0;
  const { q } = makeQueue(async () => { calls++; return json({ detail: 'down' }, 503); }, { maxRetries: 3 });
  await assert.rejects(q.enqueue('http://x/y'), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 503);
    assert.equal(err.url, 'http://x/y');
    return true;
  });
  assert.equal(calls, 4);
});

test('non-retryable 4xx throws immediately', async () => {
  let calls = 0;
  const { q } = makeQueue(async () => { calls++; return json({ detail: 'bad' }, 400); });
  await assert.rejects(q.enqueue('u'), (err) => err instanceof ApiError && err.status === 400
    && err.body.detail === 'bad');
  assert.equal(calls, 1);
});

test('network errors are retried, then reported with status 0', async () => {
  let calls = 0;
  const { q } = makeQueue(async () => { calls++; if (calls < 3) throw new TypeError('fetch failed'); return json([2]); });
  assert.deepEqual(await q.enqueue('u'), [2]);
  const { q: q2 } = makeQueue(async () => { throw new TypeError('offline'); }, { maxRetries: 1 });
  await assert.rejects(q2.enqueue('u'), (err) => err instanceof ApiError && err.status === 0);
});

test('a failing request does not block the queue', async () => {
  const { q } = makeQueue(async (url) => (url === 'bad' ? json({}, 400) : json([url])));
  const bad = q.enqueue('bad');
  const good = q.enqueue('good');
  await assert.rejects(bad);
  assert.deepEqual(await good, ['good']);
});

// ---------- fetchJson (shared queue, stubbed global fetch) ----------

test('fetchJson: cache-first, 404 and {detail} map to [] (cached), dedupe, errors reject', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.includes('driver_number=404')) return json({ detail: 'No results found.' }, 404);
    if (url.includes('driver_number=200')) return json({ detail: 'No results found.' });
    if (url.includes('driver_number=400')) return json({ detail: 'bad filter' }, 400);
    return json([{ ok: url }]);
  };
  const tag = 'test' + Date.now();

  // hit + cache
  const a1 = await fetchJson('laps', { session_key: tag, driver_number: 1 });
  const a2 = await fetchJson('laps', { session_key: tag, driver_number: 1 });
  assert.deepEqual(a1, a2);
  assert.equal(calls.length, 1);
  assert.deepEqual(await cacheGet(buildUrl('laps', { session_key: tag, driver_number: 1 })), a1);

  // 404 -> [] cached
  assert.deepEqual(await fetchJson('laps', { session_key: tag, driver_number: 404 }), []);
  assert.deepEqual(await cacheGet(buildUrl('laps', { session_key: tag, driver_number: 404 })), []);
  assert.deepEqual(await fetchJson('laps', { session_key: tag, driver_number: 404 }), []);
  assert.equal(calls.length, 2);

  // 200 with {detail} -> []
  assert.deepEqual(await fetchJson('laps', { session_key: tag, driver_number: 200 }), []);
  assert.equal(calls.length, 3);

  // concurrent identical requests share one fetch (this one waits ~1s for the 3/s window)
  const [d1, d2] = await Promise.all([
    fetchJson('laps', { session_key: tag, driver_number: 7 }),
    fetchJson('laps', { session_key: tag, driver_number: 7 }, { priority: 5 }),
  ]);
  assert.deepEqual(d1, d2);
  assert.equal(calls.length, 4);

  // other errors reject and are not cached
  await assert.rejects(fetchJson('laps', { session_key: tag, driver_number: 400 }),
    (err) => err instanceof ApiError && err.status === 400);
  assert.equal(await cacheGet(buildUrl('laps', { session_key: tag, driver_number: 400 })), undefined);

  // cache:false bypasses the cache
  await fetchJson('laps', { session_key: tag, driver_number: 1 }, { cache: false });
  assert.equal(calls.length, 6);
  assert.equal(getQueue(), getQueue());
});
