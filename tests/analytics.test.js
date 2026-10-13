import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLapTable, cleanLaps, lapsUpTo, lapsDone } from '../js/analytics/lap-table.js';
import { gapSeries, positionSeries, stintBars, degradation, paceSummary, longRuns, fitLine, FUEL_S_PER_LAP } from '../js/analytics/race-pace.js';
import { pitLoss, rejoin, undercuts, compareTraces, pickLap } from '../js/analytics/strategy.js';

const T0 = 1_000_000;
const LAP = 90_000;

/**
 * Two-car race: car 1 is 0.3 s/lap quicker. Tyre wear 0.05 s/lap of age, fuel gain 0.06 s/lap.
 * Car 2 pits on lap 5 (in-lap 5, out-lap 6, +22 s total), car 1 on lap 7. SC over lap 9.
 */
function race() {
  const laps = { 1: [], 2: [] };
  const end = { 1: T0, 2: T0 + 500 };
  const pitLap = { 1: 7, 2: 5 };
  for (let lap = 1; lap <= 12; lap++) {
    for (const n of [1, 2]) {
      const age = lap <= pitLap[n] ? lap - 1 : lap - pitLap[n] - 1;
      let t = 90 + (n === 2 ? 0.3 : 0) + 0.05 * age - FUEL_S_PER_LAP * lap;
      if (lap === 1) t += 4;
      if (lap === pitLap[n]) t += 10;
      if (lap === pitLap[n] + 1) t += 12;
      if (lap === 9) t += 25;
      const start = end[n];
      end[n] = start + t * 1000;
      laps[n].push({ lap_number: lap, date_start: start, date_end: end[n], lap_duration: t,
        duration_sector_1: t * 0.3, duration_sector_2: t * 0.4, duration_sector_3: t * 0.3, st_speed: 300 + n, is_pit_out_lap: false });
    }
  }
  const stints = {
    1: [{ compound: 'MEDIUM', lap_start: 1, lap_end: 7, tyre_age_at_start: 0, stint_number: 1 }, { compound: 'HARD', lap_start: 8, lap_end: 12, tyre_age_at_start: 0, stint_number: 2 }],
    2: [{ compound: 'MEDIUM', lap_start: 1, lap_end: 5, tyre_age_at_start: 0, stint_number: 1 }, { compound: 'HARD', lap_start: 6, lap_end: 12, tyre_age_at_start: 0, stint_number: 2 }],
  };
  const sc = laps[1][8];
  const rc = [
    { date: sc.date_start + 1000, category: 'SafetyCar', message: 'SAFETY CAR DEPLOYED' },
    { date: sc.date_end - 1000, category: 'Flag', flag: 'CLEAR', scope: 'Track', message: 'TRACK CLEAR' },
  ];
  const posAt = (n, t) => {
    // whoever has completed more distance (laps, then earlier finish) leads
    const done = (m) => laps[m].filter((l) => l.date_end <= t);
    const a = done(1), b = done(2);
    if (a.length !== b.length) return (a.length > b.length) === (n === 1) ? 1 : 2;
    const ea = a.length ? a[a.length - 1].date_end : 0, eb = b.length ? b[b.length - 1].date_end : 0;
    return (ea <= eb) === (n === 1) ? 1 : 2;
  };
  return {
    drivers: [{ number: 1 }, { number: 2 }],
    hasIntervals: true,
    dataEndTime: Math.max(end[1], end[2]),
    getDriverLaps: (n) => laps[n],
    getDriverStints: (n) => stints[n],
    getPitStops: () => [{ driver_number: 2, lap_number: 5, date: laps[2][5].date_start }, { driver_number: 1, lap_number: 7, date: laps[1][7].date_start }],
    getRaceControlAt(t, k = 5) {
      const out = [];
      for (let i = rc.length - 1; i >= 0 && out.length < k; i--) if (rc[i].date <= t) out.push(rc[i]);
      return out;
    },
    getPositionAt: posAt,
    getGapToLeaderAt: (n, t) => (posAt(n, t) === 1 ? 0 : 1.5),
  };
}

test('lap table: tyre age, in / out laps, neutralised laps and the clean-lap filter', () => {
  const data = race();
  const table = buildLapTable(data);
  const r2 = table.byDriver.get(2);
  assert.equal(r2[0].age, 0);
  assert.equal(r2[4].inLap, true);
  assert.equal(r2[5].outLap, true);
  assert.equal(r2[5].compound, 'HARD');
  assert.equal(r2[5].age, 0);
  assert.equal(r2[8].neutral, true);
  const clean = cleanLaps(table, 2, Infinity).map((r) => r.lap);
  // Car 2 runs ~25 s behind after its stop, so its laps 8 and 9 overlap the safety car.
  assert.equal(r2[7].neutral, true);
  assert.deepEqual(clean, [2, 3, 4, 7, 10, 11, 12]);
  assert.equal(lapsUpTo(table, 2, r2[3].end).length, 4);
  assert.equal(lapsDone(table, r2[3].end), 4 + table.byDriver.get(1).filter((r) => r.end <= r2[3].end).length);
});

test('degradation: raw slope hides wear behind fuel burn; fuel-corrected recovers it', () => {
  const table = buildLapTable(race());
  const raw = degradation(table, Infinity);
  const fixed = degradation(table, Infinity, { fuel: true });
  const pts = [...raw.values()].reduce((a, v) => a + v.points.length, 0);
  assert.ok(pts >= 12);
  // Pooled over both compounds: wear 0.05 - fuel 0.06 ≈ -0.01 raw, ≈ +0.05 corrected.
  const all = (m) => fitLine([...m.values()].flatMap((v) => v.points.map((p) => [p.x, p.y])));
  assert.ok(Math.abs(all(raw).b - -0.01) < 0.06, `raw ${all(raw).b}`);
  assert.ok(Math.abs(all(fixed).b - 0.05) < 0.06, `corrected ${all(fixed).b}`);
});

test('race story series and stint bars stop at the cut-off', () => {
  const data = race();
  const table = buildLapTable(data);
  const cut = table.byDriver.get(1)[5].end; // car 1 finished lap 6
  const g = gapSeries(table, cut);
  assert.equal(g.get(1).length, 6);
  assert.ok(g.get(1).every((p) => p.v === 0 || p.v === 1.5));
  assert.equal(positionSeries(table, cut).get(2).length, table.byDriver.get(2).filter((r) => r.end <= cut).length);
  assert.deepEqual(stintBars(table, Infinity).get(2).map((b) => [b.compound, b.from, b.to]), [['MEDIUM', 1, 5], ['HARD', 6, 12]]);
});

test('pace summary: theoretical best, consistency, long runs', () => {
  const table = buildLapTable(race());
  const p = paceSummary(table, Infinity).get(1);
  assert.ok(p.theory <= p.best + 1e-9);
  assert.ok(p.sigma > 0 && p.sigma < 0.5);
  const lr = longRuns(table, Infinity, 3);
  assert.equal(lr.length, 2);
  assert.ok(lr[0].median <= lr[1].median); // ranked by the median lap of each driver's longest run
});

test('pit loss, rejoin projection and undercut detection', () => {
  const data = race();
  const table = buildLapTable(data);
  const pl = pitLoss(table, Infinity);
  assert.equal(pl.stops, 2);
  assert.ok(Math.abs(pl.loss - 22) < 1.5, `loss ${pl.loss}`);
  const rows = [
    { driverNumber: 1, position: 1, gapToLeader: 0 },
    { driverNumber: 44, position: 2, gapToLeader: 8 },
    { driverNumber: 2, position: 3, gapToLeader: 12 },
    { driverNumber: 16, position: 4, gapToLeader: 30 },
  ];
  const r = rejoin(rows, 1, 22);
  assert.equal(r.pos, 3);
  assert.equal(r.ahead.n, 2);
  assert.ok(Math.abs(r.ahead.by - 10) < 1e-9);
  assert.equal(r.behind.n, 16);
  assert.equal(rejoin(rows, 1, null), null);
  const u = undercuts(table, Infinity);
  assert.equal(u.length, 1);
  assert.equal(u[0].first, 2);
  assert.equal(u[0].kind, 'undercut');
});

test('compareTraces puts two laps on one distance grid with a time delta', () => {
  const mk = (v) => {
    const n = 200, dist = new Float32Array(n), speed = new Float32Array(n), time = new Float64Array(n);
    for (let i = 0; i < n; i++) { time[i] = i * 100; speed[i] = v; dist[i] = (v / 3.6) * (i * 0.1); }
    return { dist, speed, time };
  };
  const c = compareTraces(mk(200), mk(180));
  assert.equal(c.frac.length, 300);
  assert.ok(Math.abs(c.va[150] - 200) < 1e-3 && Math.abs(c.vb[150] - 180) < 1e-3);
  assert.ok(Math.abs(c.delta[299]) < 1e-6); // same sample count: each lap's distance normalised
  assert.equal(compareTraces(null, mk(1)), null);
  const table = buildLapTable(race());
  assert.equal(pickLap(table, 1, Infinity, 'last').lap, 12);
  assert.ok(pickLap(table, 1, Infinity, 'best').lap > 1);
});
