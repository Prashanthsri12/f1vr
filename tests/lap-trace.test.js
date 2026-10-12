import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LapTraceCache, buildTrace } from '../js/panels/lap-trace.js';

const T0 = Date.parse('2024-03-02T15:10:00Z');

function fakeData(nLaps = 10) {
  const laps = [];
  for (let i = 1; i <= nLaps; i++) {
    laps.push({ lap_number: i, date_start: T0 + (i - 1) * 90000, date_end: T0 + i * 90000 });
  }
  laps.push({ lap_number: nLaps + 1, date_start: T0 + nLaps * 90000, date_end: null });
  return { session: { key: 9472 }, getDriverLaps: (n) => (n === 1 ? laps : []) };
}

function fakeFetch() {
  const calls = [];
  const fn = async (endpoint, params, opts) => {
    calls.push({ endpoint, params, opts });
    const start = Date.parse(params['date>=']);
    // 1 s samples at a constant 180 km/h (50 m/s), unordered + one sample before the start
    return [
      { date: new Date(start + 2000).toISOString(), speed: 180 },
      { date: new Date(start).toISOString(), speed: 180 },
      { date: new Date(start + 1000).toISOString(), speed: 180 },
      { date: new Date(start - 500).toISOString(), speed: 10 },
    ];
  };
  return { fn, calls };
}

test('buildTrace integrates distance from speed and sorts by time', () => {
  const tr = buildTrace([
    { date: new Date(T0 + 1000).toISOString(), speed: 360 },
    { date: new Date(T0).toISOString(), speed: 0 },
  ]);
  assert.deepEqual(Array.from(tr.time), [T0, T0 + 1000]);
  assert.equal(tr.dist[0], 0);
  assert.equal(tr.dist[1], 50); // avg 180 km/h = 50 m/s for 1 s
  assert.ok(tr.time instanceof Float64Array && tr.dist instanceof Float32Array && tr.speed instanceof Float32Array);
});

test('miss returns null, fetches once (deduped), then returns the trace', async () => {
  const { fn, calls } = fakeFetch();
  const c = new LapTraceCache({ fetchJson: fn });
  const data = fakeData();
  assert.equal(c.getTrace(data, 1, 3), null);
  assert.equal(c.getTrace(data, 1, 3), null);
  await c.pending(1, 3);
  assert.equal(calls.length, 1);
  const { endpoint, params, opts } = calls[0];
  assert.equal(endpoint, 'car_data');
  assert.equal(params.session_key, 9472);
  assert.equal(params.driver_number, 1);
  assert.equal(Date.parse(params['date>=']), T0 + 2 * 90000);
  assert.equal(Date.parse(params['date<']), T0 + 3 * 90000 + 500);
  assert.equal(opts.priority, -1);
  const tr = c.getTrace(data, 1, 3);
  assert.equal(tr.time.length, 3); // pre-start sample dropped
  assert.equal(tr.dist[2], 100);
  assert.equal(calls.length, 1);
});

test('laps without date_end or unknown laps are skipped without fetching', () => {
  const { fn, calls } = fakeFetch();
  const c = new LapTraceCache({ fetchJson: fn });
  assert.equal(c.getTrace(fakeData(), 1, 11), null);
  assert.equal(c.getTrace(fakeData(), 1, 99), null);
  assert.equal(c.getTrace(fakeData(), 44, 1), null);
  assert.equal(calls.length, 0);
});

test('keeps only the 6 most recently used laps', async () => {
  const { fn, calls } = fakeFetch();
  const c = new LapTraceCache({ fetchJson: fn });
  const data = fakeData();
  for (let lap = 1; lap <= 6; lap++) { c.getTrace(data, 1, lap); await c.pending(1, lap); }
  assert.equal(c.size, 6);
  assert.ok(c.getTrace(data, 1, 1)); // touch lap 1 -> most recent
  c.getTrace(data, 1, 7); await c.pending(1, 7);
  assert.equal(c.size, 6);
  assert.ok(c.getTrace(data, 1, 1), 'lap 1 kept (recently used)');
  assert.equal(c.getTrace(data, 1, 2), null, 'lap 2 evicted');
  await c.pending(1, 2);
  assert.equal(calls.length, 8);
});

test('fetch errors resolve to null and are not retried', async () => {
  let n = 0;
  const c = new LapTraceCache({ fetchJson: async () => { n++; throw new Error('boom'); } });
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal(c.getTrace(fakeData(), 1, 2), null);
    await c.pending(1, 2);
    assert.equal(c.getTrace(fakeData(), 1, 2), null);
    assert.equal(n, 1);
  } finally { console.warn = warn; }
});
