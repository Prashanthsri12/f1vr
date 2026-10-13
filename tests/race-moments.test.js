import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMoments, shouldShow, createRaceMoments } from '../js/race-moments.js';

const T0 = Date.parse('2024-03-02T15:03:42Z');

/** Minimal SessionData stand-in. positions: { driver: [[t, pos], ...] } */
function fakeData({ rc = [], laps = {}, pits = [], positions = {}, retired = () => new Set(), race = true } = {}) {
  const drivers = Object.keys(positions).length
    ? Object.keys(positions).map((n) => ({ number: +n, acronym: `D${n}` }))
    : [{ number: 1, acronym: 'VER' }, { number: 16, acronym: 'LEC' }];
  const msgs = rc.slice().sort((a, b) => a.date - b.date);
  const posAt = (n, t) => {
    let p = null;
    for (const [at, v] of positions[n] || []) if (at <= t) p = v;
    return p;
  };
  return {
    drivers,
    driverByNumber: new Map(drivers.map((d) => [d.number, d])),
    hasIntervals: race,
    raceStartTime: T0,
    getRaceControlAt(t, n = 5) {
      const out = [];
      for (let i = msgs.length - 1; i >= 0 && out.length < n; i--) if (msgs[i].date <= t) out.push(msgs[i]);
      return out;
    },
    getPositionAt: posAt,
    getDriverLaps: (n) => laps[n] || [],
    getPitStops: () => pits,
    getLeaderLapAt: (t) => (t < T0 ? 0 : 1 + Math.floor((t - T0) / 90000)),
    getLeaderboardAt: (t) => drivers.map((d) => ({ driverNumber: d.number, retired: retired(t).has(d.number) })),
  };
}

test('moments: lights out, SC and track clear, fastest lap improvements, pit stops', () => {
  const data = fakeData({
    rc: [
      { date: T0 + 600e3, category: 'SafetyCar', message: 'SAFETY CAR DEPLOYED' },
      { date: T0 + 700e3, category: 'SafetyCar', message: 'SAFETY CAR IN THIS LAP' },
      { date: T0 + 790e3, category: 'Flag', flag: 'CLEAR', scope: 'Track', message: 'TRACK CLEAR' },
    ],
    laps: {
      1: [{ driver_number: 1, date_end: T0 + 100e3, lap_duration: 99.1 }, { driver_number: 1, date_end: T0 + 200e3, lap_duration: 96.5 }],
      16: [{ driver_number: 16, date_end: T0 + 205e3, lap_duration: 97.0 }],
    },
    pits: [{ driver_number: 16, date: T0 + 900e3, lane_duration: 22.4, stop_duration: 2.4 }],
    positions: { 1: [[T0 - 1, 1]], 16: [[T0 - 1, 2]] },
  });
  const m = buildMoments(data);
  assert.deepEqual(m.map((e) => e.kind), ['start', 'fastest', 'sc', 'clear', 'pit']);
  assert.equal(m[1].sub, 'D1 · 1:36.500');
  assert.equal(m[4].sub, 'D16 · 2.4 s stop');
  assert.equal(m[4].posBefore, 2);
});

test('shouldShow: pit stops and overtakes only for the selected driver or the top 3', () => {
  assert.equal(shouldShow({ kind: 'pit', driver: 4, posBefore: 7 }, 1, true), false);
  assert.equal(shouldShow({ kind: 'pit', driver: 4, posBefore: 7 }, 4, true), true);
  assert.equal(shouldShow({ kind: 'pit', driver: 4, posBefore: 3 }, 1, true), true);
  assert.equal(shouldShow({ kind: 'overtake', driver: 4, other: 5, pos: 9 }, 5, true), true);
  assert.equal(shouldShow({ kind: 'overtake', driver: 4, other: 5, pos: 9 }, 1, true), false);
  assert.equal(shouldShow({ kind: 'fastest', driver: 4 }, 1, false), false);
  assert.equal(shouldShow({ kind: 'sc' }, null, true), true);
});

test('live detector: a clean swap is an overtake; a seek re-arms silently', () => {
  const pass = T0 + 300e3;
  const data = fakeData({
    positions: {
      1: [[T0 - 1, 3], [pass, 2]],      // passes 16 for P2
      16: [[T0 - 1, 2], [pass + 300, 3]], // record lands 0.3 s later
      44: [[T0 - 1, 1]],
    },
  });
  let wall = 0;
  const mo = createRaceMoments(data, { now: () => wall });
  // Arm well before the pass, then play at 1x in 200 ms ticks.
  let t = pass - 4000;
  mo.update(t, 44, true);
  let got = null;
  while (t < pass + 3000) {
    wall += 200; t += 200;
    const ev = mo.update(t, 44, true);
    if (ev && ev.kind === 'overtake') { got = ev; break; }
  }
  assert.ok(got, 'overtake detected');
  assert.equal(got.sub, 'D1 passes D16 for P2');
  // No repeat while the look-back still sees the swap.
  for (let i = 0; i < 10; i++) { wall += 200; t += 200; assert.notEqual(mo.update(t, 44, true)?.kind, 'overtake'); }
  // Seek back before the pass and straight past it: nothing fires on the jump.
  wall += 200;
  assert.equal(mo.update(pass + 1000, 44, true), null);
});

test('live detector: a pit stop shuffle is not an overtake', () => {
  const swap = T0 + 300e3;
  const data = fakeData({
    positions: { 1: [[T0 - 1, 3], [swap, 2]], 16: [[T0 - 1, 2], [swap, 3]], 44: [[T0 - 1, 1]] },
    pits: [{ driver_number: 16, date: swap - 10000, lane_duration: 22 }],
  });
  let wall = 0;
  const mo = createRaceMoments(data, { now: () => wall });
  let t = swap - 4000;
  mo.update(t, 44, true);
  while (t < swap + 3000) {
    wall += 200; t += 200;
    const ev = mo.update(t, 44, true);
    assert.notEqual(ev && ev.kind, 'overtake');
  }
});
