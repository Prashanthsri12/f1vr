// Tests for js/session-data.js (+ session-index.js, chunk-loader.js).
// Uses trimmed real fixtures from session 9472 (2024 Bahrain GP race; drivers
// 1, 2, 11, 16; laps 1-12 and 54-57; location/car_data 15:12:47-15:13:17)
// and synthetic data for chunk-boundary and visibility cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SessionData, SESSION_TYPES_WITH_INTERVALS } from '../js/session-data.js';
import { normaliseSession, gapValue } from '../js/session-index.js';
import { CHUNK_MS } from '../js/chunk-loader.js';
import { retimeSeries } from '../js/retime.js';

const FIX = new URL('./fixtures/', import.meta.url);
const fx = (name) => JSON.parse(readFileSync(new URL(name + '.json', FIX), 'utf8'));
const ENDPOINTS = ['sessions', 'drivers', 'laps', 'stints', 'pit', 'race_control', 'weather',
  'team_radio', 'position', 'intervals', 'session_result', 'location', 'car_data'];
const fixtures = () => Object.fromEntries(ENDPOINTS.map((e) => [e, fx(e)]));
const ms = Date.parse;
const iso = (t) => new Date(t).toISOString();
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

/**
 * Fake fetchJson serving `data[endpoint]` filtered by driver_number and the
 * date>= / date< params. Records calls. With deferred, each call waits for
 * call.resolve() / call.reject(err).
 */
function makeFetch(data, { deferred = false } = {}) {
  const calls = [];
  const fn = (endpoint, params = {}, opts = {}) => {
    const call = { endpoint, params, priority: opts.priority ?? 0 };
    calls.push(call);
    const lo = params['date>='] != null ? ms(params['date>=']) : -Infinity;
    const hi = params['date<'] != null ? ms(params['date<']) : Infinity;
    const recs = (data[endpoint] || []).filter((r) =>
      (params.driver_number == null || r.driver_number === params.driver_number)
      && (r.date == null || (ms(r.date) >= lo && ms(r.date) < hi)));
    if (!deferred) return Promise.resolve(recs);
    return new Promise((res, rej) => {
      call.resolve = () => res(recs);
      call.reject = rej;
    });
  };
  fn.calls = calls;
  return fn;
}

const RACE_START = ms('2024-03-02T15:03:42.341Z');
const T_LOC = ms('2024-03-02T15:13:00Z'); // inside the location/car_data fixture

// ---------------------------------------------------------------- real fixtures

test('load: requests, progress and static facts (race)', async () => {
  const fetchJson = makeFetch(fixtures());
  const progress = [];
  const d = await SessionData.load(9472, { fetchJson, onProgress: (p) => progress.push(p) });
  assert.equal(fetchJson.calls[0].endpoint, 'sessions');
  assert.deepEqual(fetchJson.calls[0].params, { session_key: 9472 });
  assert.deepEqual(fetchJson.calls.map((c) => c.endpoint).sort(),
    ['drivers', 'intervals', 'laps', 'pit', 'position', 'race_control', 'session_result', 'sessions', 'stints',
      'team_radio', 'weather']);
  assert.equal(progress.length, 11);
  assert.equal(progress.at(-1).done, 11);
  assert.equal(progress.at(-1).total, 11);

  assert.deepEqual(d.session, { key: 9472, meetingKey: 1229, name: 'Race', type: 'Race', circuit: 'Sakhir',
    country: 'Bahrain', year: 2024, start: ms('2024-03-02T15:00:00Z'), end: ms('2024-03-02T17:00:00Z') });
  assert.deepEqual(d.drivers.map((x) => x.number), [1, 2, 11, 16]);
  assert.deepEqual(d.driverByNumber.get(16), { number: 16, acronym: 'LEC', fullName: d.driverByNumber.get(16).fullName,
    teamName: 'Ferrari', teamColour: '#e8002d', headshotUrl: d.driverByNumber.get(16).headshotUrl });
  assert.equal(d.totalLaps, 57);
  assert.equal(iso(d.raceStartTime), '2024-03-02T15:03:42.341Z');
  assert.equal(iso(d.dataStartTime), '2024-03-02T14:03:47.739Z');
  assert.equal(d.dataEndTime, ms('2024-03-02T17:00:00Z'));
  assert.equal(d.hasIntervals, true);
  assert.equal(d.hasDrs, true); // known up front from race_control Drs messages
  assert.ok(SESSION_TYPES_WITH_INTERVALS.includes('Sprint'));
});

test('load: practice session skips intervals; gaps null', async () => {
  const data = fixtures();
  data.sessions = [{ ...data.sessions[0], session_name: 'Practice 1', session_type: 'Practice' }];
  const fetchJson = makeFetch(data);
  const d = await SessionData.load(9472, { fetchJson });
  assert.ok(!fetchJson.calls.some((c) => c.endpoint === 'intervals'));
  assert.equal(d.hasIntervals, false);
  const row = d.getLeaderboardAt(T_LOC)[0];
  assert.equal(row.gapToLeader, null);
  assert.equal(row.interval, null);
  assert.equal(row.retired, false);
});

test('normalisation helpers', () => {
  assert.equal(gapValue('+1 LAP'), '+1 LAP');
  assert.equal(gapValue('4.5'), 4.5);
  assert.equal(gapValue(null), null);
  assert.equal(gapValue(3), 3);
  const s = normaliseSession(undefined, 42);
  assert.equal(s.key, 42);
  assert.equal(s.start, null);
});

test('leaderboard at race start + ~9 min matches raw data', async () => {
  const d = await SessionData.load(9472, { fetchJson: makeFetch(fixtures()) });
  const lb = d.getLeaderboardAt(T_LOC);
  assert.deepEqual(lb.map((r) => r.position), [...lb.map((r) => r.position)].sort((a, b) => a - b));
  const ver = lb.find((r) => r.driverNumber === 1);
  // VER: P1, on lap 6 (lap 7 starts ~15:13:25), stint 1 SOFT age 3 at lap 1 -> 8
  assert.equal(ver.position, 1);
  assert.equal(ver.lapNumber, 6);
  assert.equal(ver.compound, 'SOFT');
  assert.equal(ver.tyreAge, 8);
  assert.equal(ver.pitStops, 0);
  assert.equal(ver.gapToLeader, 0);
  const laps = fx('laps').filter((l) => l.driver_number === 1 && l.lap_number <= 5);
  assert.equal(ver.bestLap, Math.min(...laps.map((l) => l.lap_duration)));
  assert.equal(ver.lastLap, laps.find((l) => l.lap_number === 5).lap_duration);
  // LEC gap/interval = latest intervals record at or before t
  const lecIv = fx('intervals').filter((r) => r.driver_number === 16 && ms(r.date) <= T_LOC).at(-1);
  const lec = lb.find((r) => r.driverNumber === 16);
  assert.equal(lec.gapToLeader, lecIv.gap_to_leader);
  assert.equal(lec.interval, lecIv.interval);
  // SAR pitted on lap 10 (15:21:55): no stop counted yet
  assert.equal(lb.find((r) => r.driverNumber === 2).pitStops, 0);
});

test('leaderboard at the end: pit counts, tyre age, lap strings', async () => {
  const d = await SessionData.load(9472, { fetchJson: makeFetch(fixtures()) });
  const lb = d.getLeaderboardAt(d.dataEndTime);
  const ver = lb.find((r) => r.driverNumber === 1);
  assert.equal(ver.lapNumber, 57);
  assert.equal(ver.pitStops, 2);
  assert.equal(ver.compound, 'SOFT');
  assert.equal(ver.tyreAge, 19); // stint 3 from lap 38, age 0
  const sar = lb.find((r) => r.driverNumber === 2);
  assert.equal(sar.gapToLeader, '+2 LAPS');
  assert.equal(sar.pitStops, 3);
  assert.equal(sar.tyreAge, 55 - 41);
  assert.equal(sar.retired, false); // lapped finisher, not retired
  assert.ok(lb.every((r) => !r.retired));
});

test('time queries: position, lap, weather, race control, radio', async () => {
  const d = await SessionData.load(9472, { fetchJson: makeFetch(fixtures()) });
  assert.equal(d.getPositionAt(1, d.dataStartTime - 1), null);
  assert.equal(d.getPositionAt(1, T_LOC), 1);
  assert.equal(d.getLapStartTime(1), d.raceStartTime);
  assert.equal(d.getLapStartTime(99), null);
  assert.equal(d.getLeaderLapAt(RACE_START - 1), 0);
  assert.equal(d.getLeaderLapAt(RACE_START), 1);
  assert.equal(d.getLeaderLapAt(T_LOC), 6);
  assert.equal(d.getLeaderLapAt(d.dataEndTime), 57);

  const w = d.getWeatherAt(T_LOC);
  assert.ok(w.date <= T_LOC && typeof w.air_temperature === 'number');
  assert.equal(d.getWeatherAt(d.dataStartTime - 600000), null);

  const rc = d.getRaceControlAt(T_LOC, 3);
  assert.equal(rc.length, 3);
  assert.ok(rc[0].date >= rc[1].date && rc[1].date >= rc[2].date && rc[0].date <= T_LOC);
  assert.equal(d.getRaceControlAt(0).length, 0);

  const radio = d.getTeamRadioUpTo(1, T_LOC);
  assert.deepEqual(radio.map((r) => r.date), [ms('2024-03-02T15:09:49.409Z')]);
  assert.equal(d.getTeamRadioUpTo(99, T_LOC).length, 0);
});

test('real location + car_data chunk: interpolation and visibility', async () => {
  const fetchJson = makeFetch(fixtures());
  const d = await SessionData.load(9472, { fetchJson });
  d.setSelectedDriver(1);
  d.setPlayhead(T_LOC, 1);
  assert.equal(d.isReady(T_LOC), false);
  await flush();
  assert.equal(d.isReady(T_LOC), true);
  const loc = fetchJson.calls.find((c) => c.endpoint === 'location');
  assert.deepEqual(loc.params, { session_key: 9472, 'date>=': '2024-03-02T15:12:47.000Z', 'date<': '2024-03-02T15:13:47.000Z' });

  // independent check against the raw samples of driver 11 (re-timed like the loader does)
  const raw = fx('location').filter((r) => r.driver_number === 11).sort((p, q) => ms(p.date) - ms(q.date));
  const rt = Float64Array.from(raw, (r) => ms(r.date));
  retimeSeries(rt, Float32Array.from(raw, (r) => r.x), Float32Array.from(raw, (r) => r.y), Float32Array.from(raw, (r) => r.z));
  const i = rt.findIndex((t) => t > T_LOC);
  const a = raw[i - 1]; const b = raw[i];
  const f = (T_LOC - rt[i - 1]) / (rt[i] - rt[i - 1]);
  const out = { x: 0, y: 0, z: 0 };
  assert.equal(d.getCarPositionAt(11, T_LOC, out), true);
  assert.ok(Math.abs(out.x - (a.x + (b.x - a.x) * f)) < 1e-3);
  assert.ok(Math.abs(out.y - (a.y + (b.y - a.y) * f)) < 1e-3);

  const cars = [];
  d.getCarsAt(T_LOC, cars);
  assert.deepEqual(cars.map((c) => [c.number, c.visible]), [[1, true], [2, false], [11, true], [16, true]]);
  const first = cars[0];
  d.getCarsAt(T_LOC + 100, cars);
  assert.equal(cars[0], first, 'entries are reused');

  const tel = {};
  assert.equal(d.getTelemetryAt(1, T_LOC, tel), true);
  assert.ok(tel.speed > 0 && tel.rpm > 0 && tel.gear >= 1 && tel.gear <= 8);
  assert.equal(d.getTelemetryAt(11, T_LOC, tel), false); // not selected -> not loaded
  assert.equal(d.hasDrs, true); // race_control fixture has Drs-category messages
});

// ---------------------------------------------------------------- synthetic data

const T0 = ms('2024-01-01T00:00:00.000Z');
const SYN_END = T0 + 10 * 60000;

function syntheticRaw() {
  const location = [];
  const carData = [];
  for (let t = T0 + 100; t < SYN_END; t += 250) {
    const s = (t - T0) / 1000;
    location.push({ date: iso(t), driver_number: 1, x: s, y: 2 * s, z: 5 });
    const zero = t >= T0 + 60000 && t < T0 + 120000;
    location.push({ date: iso(t), driver_number: 2, x: zero ? 0 : s, y: zero ? 0 : s, z: zero ? 0 : 1 });
    if (!(t > T0 + 30000 && t < T0 + 40000)) location.push({ date: iso(t), driver_number: 3, x: s, y: s, z: s });
    carData.push({ date: iso(t), driver_number: 1, speed: s, rpm: 10000 + s, n_gear: Math.floor(s) % 8 + 1,
      throttle: 50, brake: 0, drs: t < T0 + 120000 ? 1 : 12 });
  }
  const position = [1, 2, 3].map((n) => ({ date: iso(T0), driver_number: n, position: n }));
  const drivers = [1, 2, 3].map((n) => ({ driver_number: n, name_acronym: 'D' + n, team_colour: 'FF0000' }));
  return { location, car_data: carData, position, drivers, laps: [], stints: [], pit: [], race_control: [],
    weather: [], team_radio: [], intervals: [] };
}

function syntheticSession(raw, fetchOpts, extra = {}) {
  const session = normaliseSession({ session_key: 1, session_name: 'Race', session_type: 'Race',
    date_start: iso(T0), date_end: iso(SYN_END) }, 1);
  const fetchJson = makeFetch(raw, fetchOpts);
  const d = new SessionData(session, raw, { fetchJson, raceLike: true, ...extra });
  return { d, fetchJson };
}

test('chunk scheduling: buffer, de-dup, priorities, speed, eviction, status', async () => {
  const { d, fetchJson } = syntheticSession(syntheticRaw(), { deferred: true });
  const statuses = [];
  const unsub = d.onStatus((s) => statuses.push(s));
  const locK = () => fetchJson.calls.filter((c) => c.endpoint === 'location')
    .map((c) => (ms(c.params['date>=']) - T0) / CHUNK_MS);

  d.setPlayhead(T0 + 5000, 1);
  assert.deepEqual(locK(), [0, 1, 2]);
  assert.deepEqual(fetchJson.calls.map((c) => c.priority), [1, 0, 0]);
  assert.equal(statuses.at(-1).pending, 3);
  assert.equal(statuses.at(-1).loading, true);
  d.setPlayhead(T0 + 6000, 1);
  d.setPlayhead(T0 + 59000, 1);
  assert.equal(fetchJson.calls.length, 3, 'no duplicate requests within the same chunk');
  assert.equal(d.isReady(T0 + 5000), false);

  // select a driver: their current car_data chunk first at priority 2, then the buffer
  d.setSelectedDriver(1);
  const car = fetchJson.calls.filter((c) => c.endpoint === 'car_data');
  assert.equal(car[0].priority, 2);
  assert.equal(car[0].params.driver_number, 1);
  assert.equal(car[0].params['date>='], iso(T0));
  assert.deepEqual(car.map((c) => (ms(c.params['date>=']) - T0) / CHUNK_MS), [0, 1, 2]);

  for (const c of fetchJson.calls) c.resolve();
  await flush();
  assert.equal(d.isReady(T0 + 5000), true);
  assert.equal(d.isReady(T0 + 125000), true);
  assert.equal(d.isReady(T0 + 185000), false);
  assert.equal(statuses.at(-1).pending, 0);
  assert.equal(statuses.at(-1).loading, false);

  // speed 5 -> next 6 chunks
  d.setPlayhead(T0 + 5000, 5);
  assert.deepEqual(locK(), [0, 1, 2, 3, 4, 5, 6]);
  for (const c of fetchJson.calls) if (c.resolve) c.resolve();
  await flush();

  // jump to chunk 5: chunks ending > 2 min behind (0, 1, 2 ends at 180 s < 305-120) are evicted
  d.setPlayhead(T0 + 305000, 1);
  assert.equal(d.isReady(T0 + 5000), false);
  assert.equal(d.isReady(T0 + 125000), false);
  assert.equal(d.isReady(T0 + 185000), true); // chunk 3 ends at 240 s, kept
  assert.equal(d.getTelemetryAt(1, T0 + 5000, {}), false); // car_data evicted too
  unsub();
  const n = statuses.length;
  d.setPlayhead(T0 + 590000, 1);
  assert.equal(statuses.length, n, 'unsubscribed');
  d.dispose();
});

test('chunk error is reported and retried after the delay', async () => {
  const { d, fetchJson } = syntheticSession(syntheticRaw(), { deferred: true }, { retryDelayMs: 0 });
  const statuses = [];
  d.onStatus((s) => statuses.push(s));
  d.setPlayhead(T0 + 1000, 1);
  fetchJson.calls[0].reject(new Error('boom'));
  await flush();
  assert.equal(statuses.at(-1).error.message, 'boom');
  assert.equal(d.isReady(T0 + 1000), false);
  d.setPlayhead(T0 + 1000, 1); // same chunk, but retry is due
  const again = fetchJson.calls.filter((c) => c.endpoint === 'location' && c.params['date>='] === iso(T0));
  assert.equal(again.length, 2);
  again[1].resolve();
  await flush();
  assert.equal(d.isReady(T0 + 1000), true);
  assert.equal(statuses.at(-1).error, undefined);
});

test('interpolation across chunk boundaries', async () => {
  const { d } = syntheticSession(syntheticRaw());
  d.setPlayhead(T0 + 30000, 1);
  await flush();
  const out = { x: 0, y: 0, z: 0 };
  // chunk 1 starts at 60 s; its first sample is at 60.1 s. 60.05 s must use 59.85 s (chunk 0) and 60.1 s.
  const t = T0 + 60050;
  assert.equal(d.getCarPositionAt(1, t, out), true);
  assert.ok(Math.abs(out.x - 60.05) < 1e-4, `x=${out.x}`);
  assert.ok(Math.abs(out.y - 120.1) < 1e-3);
  assert.equal(out.z, 5);
  // inside a chunk
  assert.equal(d.getCarPositionAt(1, T0 + 12345, out), true);
  assert.ok(Math.abs(out.x - 12.345) < 1e-4);
  // telemetry across the boundary too; gear from the earlier sample
  d.setSelectedDriver(1);
  await flush();
  const tel = {};
  assert.equal(d.getTelemetryAt(1, t, tel), true);
  assert.ok(Math.abs(tel.speed - 60.05) < 1e-4);
  assert.equal(tel.gear, Math.floor(59.85) % 8 + 1);
  assert.equal(tel.throttle, 50);
});

test('boundary without the previous chunk: short hold, then hidden', async () => {
  const { d } = syntheticSession(syntheticRaw());
  d.setPlayhead(T0 + 200000, 1); // loads chunks 3..5 only
  await flush();
  const out = { x: 0, y: 0, z: 0 };
  assert.equal(d.getCarPositionAt(1, T0 + 180050, out), true); // 50 ms before first sample: held
  assert.ok(Math.abs(out.x - 180.1) < 1e-4);
  assert.equal(d.getCarPositionAt(1, T0 + 120000, out), false); // chunk 2 not loaded
});

test('visibility: (0,0,0) samples, >5 s gaps, unknown driver', async () => {
  const { d } = syntheticSession(syntheticRaw());
  d.setPlayhead(T0 + 1000, 1);
  await flush();
  const out = { x: 0, y: 0, z: 0 };
  assert.equal(d.getCarPositionAt(2, T0 + 30000, out), true);
  assert.equal(d.getCarPositionAt(2, T0 + 90000, out), false); // zeros
  assert.equal(d.getCarPositionAt(2, T0 + 59990, out), false); // brackets a zero sample
  assert.equal(d.getCarPositionAt(3, T0 + 29000, out), true);
  assert.equal(d.getCarPositionAt(3, T0 + 35000, out), false); // 10 s gap
  assert.equal(d.getCarPositionAt(3, T0 + 41000, out), true);
  assert.equal(d.getCarPositionAt(99, T0 + 1000, out), false);
  const cars = [];
  d.getCarsAt(T0 + 90000, cars);
  assert.deepEqual(cars.map((c) => c.visible), [true, false, true]);
});

test('hasDrs: null until car_data, false for 0/1, true once DRS codes appear', async () => {
  const { d } = syntheticSession(syntheticRaw());
  assert.equal(d.hasDrs, null);
  d.setSelectedDriver(1);
  d.setPlayhead(T0 + 1000, 1); // chunks 0-2; drs 12 from 120 s (chunk 2)
  await flush();
  assert.equal(d.hasDrs, true);
  const raw = syntheticRaw();
  for (const r of raw.car_data) r.drs = 1;
  const s2 = syntheticSession(raw).d;
  s2.setSelectedDriver(1);
  s2.setPlayhead(T0 + 1000, 1);
  await flush();
  assert.equal(s2.hasDrs, false);
});

function lap(n, lapNumber, startS, dur, extra = {}) {
  return { driver_number: n, lap_number: lapNumber, date_start: iso(T0 + startS * 1000), lap_duration: dur,
    is_pit_out_lap: false, ...extra };
}

test('reference lap selection and fetch', async () => {
  const raw = syntheticRaw();
  // driver 1: 6 laps, driver 2: 3 laps -> driver 1
  raw.laps = [
    lap(1, 1, 0, 80), // lap 1 excluded
    lap(1, 2, 80, 90),
    lap(1, 3, 170, 85, {}), // followed by pit on lap 4 -> excluded (in-lap)
    lap(1, 4, 255, 95),
    lap(1, 5, 350, 70, { is_pit_out_lap: true }), // excluded
    lap(1, 6, 420, 88), // yellow flag inside -> not preferred
    lap(2, 1, 0, 80), lap(2, 2, 80, 80), lap(2, 3, 160, 80),
  ];
  raw.pit = [{ date: iso(T0 + 340000), driver_number: 1, lap_number: 4 }];
  raw.race_control = [{ date: iso(T0 + 450000), category: 'Flag', flag: 'YELLOW', message: 'YELLOW' },
    { date: iso(T0 + 100000), category: 'Flag', flag: 'BLUE', message: 'BLUE FLAG' }];
  // put two zero points into the reference lap window
  raw.location.push({ date: iso(T0 + 80000), driver_number: 1, x: 0, y: 0, z: 0 });
  const { d, fetchJson } = syntheticSession(raw);
  assert.deepEqual(d.pickReferenceLap(), { driverNumber: 1, lapNumber: 2, start: T0 + 80000, end: T0 + 170000 });

  const ref = await d.getReferenceLap();
  const call = fetchJson.calls.at(-1);
  assert.deepEqual(call.params, { session_key: 1, driver_number: 1, 'date>=': iso(T0 + 80000), 'date<': iso(T0 + 170500) });
  assert.equal(ref.driverNumber, 1);
  assert.equal(ref.lapNumber, 2);
  assert.ok(ref.points.length > 300);
  assert.ok(ref.points.every((p) => !(p.x === 0 && p.y === 0 && p.z === 0)));
  assert.ok(ref.points[1].x > ref.points[0].x, 'sorted by time');
  assert.equal(await d.getReferenceLap(), ref, 'memoised');

  // when every candidate is flagged (safety car in lap 2), fall back to the fastest candidate (lap 6, 88 s)
  raw.race_control.push({ date: iso(T0 + 100000), category: 'SafetyCar', flag: null, message: 'SAFETY CAR DEPLOYED' });
  const d2 = syntheticSession(raw).d;
  assert.equal(d2.pickReferenceLap().lapNumber, 6);
});

test('retired heuristic', async () => {
  const raw = syntheticRaw();
  // 3-lap race of 100 s laps; driver 3 stops after lap 1 (car hidden from 40 s by the location gap only,
  // so cut its location from 100 s on).
  raw.laps = [];
  for (const n of [1, 2]) for (let l = 1; l <= 3; l++) raw.laps.push(lap(n, l, (l - 1) * 100 + n, 99));
  raw.laps.push(lap(3, 1, 3, 99));
  raw.location = raw.location.filter((r) => !(r.driver_number === 3 && ms(r.date) > T0 + 100000));
  const { d } = syntheticSession(raw);
  d.setPlayhead(T0 + 200000, 1);
  await flush();
  const r3 = (t) => d.getLeaderboardAt(t).find((r) => r.driverNumber === 3);
  assert.equal(r3(T0 + 110000).retired, false); // within 30 s of its last lap end
  assert.equal(r3(T0 + 200000).retired, true);
  assert.equal(d.getLeaderboardAt(T0 + 200000).find((r) => r.driverNumber === 2).retired, false);
  assert.equal(d.getLeaderLapAt(T0 + 200000), 2);
  assert.equal(d.getLeaderLapAt(T0 + 250000), 3);
});

test('retired with session_result: DNF only once the car stops; finishers never; DNS always', async () => {
  const raw = syntheticRaw();
  raw.laps = [];
  for (const n of [1, 2]) for (let l = 1; l <= 3; l++) raw.laps.push(lap(n, l, (l - 1) * 100 + n, 99));
  // Driver 3 completes lap 1, starts lap 2 at ~103 s and stops on track (still visible) from 140 s.
  raw.laps.push(lap(3, 1, 3, 99), lap(3, 2, 103, null));
  // Synthetic cars crawl at 1 unit/s; make driver 3 race at 100 units/s, then park it.
  for (const r of raw.location) if (r.driver_number === 3) { r.x *= 100; r.y *= 100; }
  const stop = raw.location.find((r) => r.driver_number === 3 && ms(r.date) >= T0 + 140000);
  for (const r of raw.location) {
    if (r.driver_number === 3 && ms(r.date) > T0 + 140000) { r.x = stop.x; r.y = stop.y; r.z = stop.z; }
  }
  raw.session_result = [
    { position: 1, driver_number: 1, number_of_laps: 3, dnf: false, dns: false, dsq: false },
    { position: 2, driver_number: 2, number_of_laps: 3, dnf: false, dns: false, dsq: false },
    { position: null, driver_number: 3, number_of_laps: 1, dnf: true, dns: false, dsq: false },
  ];
  const { d } = syntheticSession(raw);
  const r = (n, t) => d.getLeaderboardAt(t).find((x) => x.driverNumber === n).retired;
  d.setPlayhead(T0 + 120000, 1);
  await flush();
  assert.equal(r(3, T0 + 50000), false);  // lap 1: racing
  assert.equal(r(3, T0 + 120000), false); // retirement lap begun, still moving
  d.setPlayhead(T0 + 160000, 1);
  await flush();
  assert.equal(r(3, T0 + 160000), true);  // stopped for > 5 s
  assert.equal(r(2, T0 + 160000), false); // finisher
  raw.session_result[1].dns = true;
  const { d: d2 } = syntheticSession(raw);
  assert.equal(d2.getLeaderboardAt(T0 + 1000).find((x) => x.driverNumber === 2).retired, true);
});

test('totalLaps prefers the session_result race distance (red-flag lap numbering)', () => {
  const raw = syntheticRaw();
  raw.laps = [];
  for (let l = 1; l <= 4; l++) raw.laps.push(lap(1, l, (l - 1) * 100, 99));
  raw.session_result = [{ position: 1, driver_number: 1, number_of_laps: 3, dnf: false, dns: false, dsq: false }];
  const { d } = syntheticSession(raw);
  assert.equal(d.totalLaps, 3);
  assert.equal(d.getLeaderLapAt(T0 + 350000), 3);
});
