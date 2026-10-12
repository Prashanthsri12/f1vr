import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LapStats, newLapStatsOut, lastAtOrBefore, isRaceSession } from '../js/panels/lap-stats.js';
import { indexLaps, indexStints } from '../js/session-index.js';

const S = 1000;
// Lap helper: start (s), sectors (s|null), duration defaults to the sector sum.
function lap(driver, n, start, s1, s2, s3, extra = {}) {
  const dur = extra.lap_duration !== undefined ? extra.lap_duration
    : (s1 != null && s2 != null && s3 != null ? s1 + s2 + s3 : null);
  return {
    driver_number: driver, lap_number: n, date_start: start * S,
    date_end: dur != null ? start * S + dur * 1000 : null,
    lap_duration: dur, duration_sector_1: s1, duration_sector_2: s2, duration_sector_3: s3,
    st_speed: 300 + n, ...extra,
  };
}

function fake({ laps, stints = {}, totalLaps = 10, session = { type: 'Race', name: 'Race' } }) {
  const by = new Map();
  for (const l of laps) {
    if (!by.has(l.driver_number)) by.set(l.driver_number, []);
    by.get(l.driver_number).push(l);
  }
  for (const a of by.values()) a.sort((x, y) => x.lap_number - y.lap_number);
  return {
    drivers: [...by.keys()].map((number) => ({ number })),
    getDriverLaps: (n) => by.get(n) || [],
    getDriverStints: (n) => stints[n] || [],
    totalLaps, session,
  };
}

// Driver 1: lap 1 (no S1, no duration), lap 2 = 90, lap 3 = 89 (pb), lap 4 pit lap (no duration).
// Driver 2: lap 1 none, lap 2 = 88.5 (session best), lap 3 = 91.
const DATA = fake({
  laps: [
    lap(1, 1, 0, null, 40, 30, { lap_duration: null }),
    lap(1, 2, 100, 20, 40, 30),          // ends 190
    lap(1, 3, 190, 19.5, 39.5, 30),      // ends 279
    lap(1, 4, 279, 21, 45, null, { lap_duration: null }),
    lap(1, 5, 380, 20, 40, 30),          // ends 470
    lap(2, 1, 0, null, null, null, { lap_duration: null }),
    lap(2, 2, 101, 19.8, 39.7, 29),      // 88.5, ends 189.5
    lap(2, 3, 189.5, 20, 41, 30),        // 91, ends 280.5
  ],
  stints: {
    1: [
      { stint_number: 1, compound: 'SOFT', lap_start: 1, lap_end: 4, tyre_age_at_start: 3 },
      { stint_number: 2, compound: 'HARD', lap_start: 5, lap_end: 10, tyre_age_at_start: 0 },
    ],
  },
});

test('lastAtOrBefore', () => {
  assert.equal(lastAtOrBefore([1, 2, 3], 0), -1);
  assert.equal(lastAtOrBefore([1, 2, 3], 2), 1);
  assert.equal(lastAtOrBefore([1, 2, 3], 9), 2);
  assert.equal(lastAtOrBefore([], 9), -1);
});

test('before the start: lap 0, nothing known', () => {
  const o = new LapStats(DATA).compute(1, -5 * S);
  assert.equal(o.lapNumber, 0);
  assert.equal(o.running, null);
  assert.equal(o.lastLap, null);
  assert.equal(o.pb, null);
  assert.equal(o.sessionBest, null);
  assert.equal(o.stintCount, 0);
  assert.deepEqual(o.sectors.map((s) => s.cls), [null, null, null]);
});

test('lap 1 without duration completes at the next lap start; null sector stays null', () => {
  const ls = new LapStats(DATA);
  const o = ls.compute(1, 150 * S);
  assert.equal(o.lapNumber, 2);
  assert.equal(o.running, 50);
  assert.equal(o.lastLapNumber, 1);
  assert.equal(o.lastLap, null);
  assert.equal(o.pb, null);
  assert.equal(o.sectors[0].time, null);
  assert.equal(o.sectors[0].cls, null);
  assert.equal(o.sectors[1].time, 40);
  // Only driver 1's lap 1 has an S2 so far (driver 2's lap 1 has none): purple.
  assert.equal(o.sectors[1].cls, 'purple');
});

test('pb, session best and sector colours at t=200 s', () => {
  const ls = new LapStats(DATA);
  const o = ls.compute(1, 200 * S);
  assert.equal(o.lapNumber, 3);
  assert.equal(o.running, 10);
  assert.equal(o.lastLapNumber, 2);
  assert.equal(o.lastLap, 90);
  assert.equal(o.pb, 90);
  assert.equal(o.sessionBest, 88.5);
  assert.equal(o.sessionBestDriver, 2);
  assert.equal(o.pbIsSessionBest, false);
  assert.equal(o.stSpeed, 302);
  // S1 20 vs driver 2's 19.8 -> green (own best); S2 40 vs 39.7 -> green (40 ties lap 1's 40);
  // S3 30 vs 29 -> pb so far is 30 (lap 1) -> green.
  assert.deepEqual(o.sectors.map((s) => s.cls), ['green', 'green', 'green']);
  const o2 = ls.compute(2, 200 * S);
  assert.equal(o2.pbIsSessionBest, true);
  assert.deepEqual(o2.sectors.map((s) => s.cls), ['purple', 'purple', 'purple']);
});

test('purple sector and yellow sector', () => {
  const o = new LapStats(DATA).compute(1, 285 * S);
  assert.equal(o.lastLapNumber, 3);
  assert.equal(o.lastLap, 89);
  assert.equal(o.pb, 89);
  // S1 19.5 < 19.8 purple, S2 39.5 < 39.7 purple, S3 30 > own best 30? equal -> green
  assert.deepEqual(o.sectors.map((s) => s.cls), ['purple', 'purple', 'green']);
  const o2 = new LapStats(DATA).compute(2, 285 * S);
  // Driver 2 lap 3: 20 (pb 19.8) yellow, 41 yellow, 30 (pb 29) yellow.
  assert.deepEqual(o2.sectors.map((s) => s.cls), ['yellow', 'yellow', 'yellow']);
  assert.equal(o2.pb, 88.5);
});

test('pit lap without duration: last lap null, pb kept, sectors from the lap', () => {
  const o = new LapStats(DATA).compute(1, 400 * S);
  assert.equal(o.lapNumber, 5);
  assert.equal(o.lastLapNumber, 4);
  assert.equal(o.lastLap, null);
  assert.equal(o.pb, 89);
  assert.equal(o.sectors[0].cls, 'yellow');
  assert.equal(o.sectors[2].time, null);
  assert.equal(o.sectors[2].cls, null);
});

test('stints are clipped to the current lap and the current stint is marked', () => {
  const ls = new LapStats(DATA);
  let o = ls.compute(1, 200 * S);
  assert.equal(o.stintCount, 1);
  assert.deepEqual({ ...o.stints[0] }, {
    compound: 'SOFT', lapStart: 1, lapEnd: 3, laps: 3, ageStart: 3, ageEnd: 5, current: true,
  });
  assert.equal(o.totalLaps, 10);
  o = ls.compute(1, 400 * S, o);
  assert.equal(o.stintCount, 2);
  assert.equal(o.stints[0].lapEnd, 4);
  assert.equal(o.stints[0].current, false);
  assert.equal(o.stints[1].compound, 'HARD');
  assert.equal(o.stints[1].laps, 1);
  assert.equal(o.stints[1].current, true);
});

test('finished driver: clock stops, lap number stays on the final lap', () => {
  const o = new LapStats(DATA).compute(2, 1000 * S);
  assert.equal(o.running, null);
  assert.equal(o.lapNumber, 3);
  assert.equal(o.lastLapNumber, 3);
});

test('stale lap without duration (garage): clock stops after 300 s', () => {
  const d = fake({ laps: [lap(7, 1, 0, 20, 40, 30), lap(7, 2, 90, 20, 40, null, { lap_duration: null })] });
  const ls = new LapStats(d);
  assert.equal(ls.compute(7, 200 * S).running, 110);
  assert.equal(ls.compute(7, 500 * S).running, null);
});

test('non-race sessions scale the strip by the driver max lap; unknown driver is empty', () => {
  const d = fake({ laps: [lap(5, 1, 0, 20, 40, 30), lap(5, 2, 90, 20, 40, 30)], totalLaps: 25,
    session: { type: 'Qualifying', name: 'Qualifying' } });
  assert.equal(isRaceSession(d), false);
  const ls = new LapStats(d);
  assert.equal(ls.compute(5, 100 * S).totalLaps, 2);
  const o = ls.compute(99, 100 * S);
  assert.equal(o.lapNumber, 0);
  assert.equal(o.sessionBest, 90);
});

test('output object is reused (no new sector objects per call)', () => {
  const ls = new LapStats(DATA);
  const out = newLapStatsOut();
  const s0 = out.sectors[0];
  ls.compute(1, 200 * S, out);
  ls.compute(2, 300 * S, out);
  assert.equal(out.sectors[0], s0);
  assert.equal(out.driver, 2);
});

test('real Bahrain 2024 fixture: sane values, purple holder is the session best', () => {
  const lapsIdx = indexLaps(JSON.parse(readFileSync(new URL('./fixtures/laps.json', import.meta.url))));
  const stints = indexStints(JSON.parse(readFileSync(new URL('./fixtures/stints.json', import.meta.url))));
  const data = {
    drivers: [...lapsIdx.byDriver.keys()].map((number) => ({ number })),
    getDriverLaps: (n) => lapsIdx.byDriver.get(n) || [],
    getDriverStints: (n) => stints.get(n) || [],
    totalLaps: lapsIdx.totalLaps, session: { type: 'Race', name: 'Race' },
  };
  const ls = new LapStats(data);
  const t = lapsIdx.lapStart.get(5) + 30000;
  for (const { number } of data.drivers) {
    const o = ls.compute(number, t);
    assert.ok(o.lapNumber >= 1, `driver ${number} lap`);
    if (o.pb != null) assert.ok(o.pb >= o.sessionBest);
    if (o.pbIsSessionBest) assert.equal(o.sessionBestDriver, number);
    assert.ok(o.running == null || (o.running >= 0 && o.running < 200));
  }
});

test('qualifying pit-out lap whose duration overruns the next lap start does not reorder laps', () => {
  // Shape seen in session 9468: out lap 4 starts 0 s with 310 s duration, lap 5 starts 112 s.
  const d = fake({
    laps: [
      lap(1, 4, 0, null, 50, 40, { lap_duration: 310 }),
      lap(1, 5, 112, 28.8, 38, 23.36),  // 90.16, ends 202.16
      lap(1, 6, 202.16, 40, 50, 30),    // 120 s, ends 322.16
    ],
    session: { type: 'Qualifying', name: 'Qualifying' },
  });
  const ls = new LapStats(d);
  let o = ls.compute(1, 150 * S);
  assert.equal(o.lastLapNumber, 4);   // completed when lap 5 started
  assert.equal(o.lapNumber, 5);
  o = ls.compute(1, 315 * S, o);       // after lap 4's nominal end (310 s)
  assert.equal(o.lastLapNumber, 5);
  assert.equal(o.lastLap, 90.16);
  assert.equal(o.pb, 90.16);
  assert.equal(o.lapNumber, 6);
});
