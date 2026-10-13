import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, visibleTimeline } from '../js/panels/timeline-marks.js';

function fakeData(rc, { pits = [], laps = {} } = {}) {
  const msgs = rc.slice().sort((a, b) => a.date - b.date);
  return {
    drivers: [{ number: 1 }, { number: 16 }],
    hasIntervals: true,
    dataEndTime: 10000,
    getRaceControlAt(t, n = 5) {
      const out = [];
      for (let i = msgs.length - 1; i >= 0 && out.length < n; i--) if (msgs[i].date <= t) out.push(msgs[i]);
      return out;
    },
    getPitStops: () => pits,
    getDriverLaps: (n) => laps[n] || [],
  };
}

test('SC and VSC periods become bands; a VSC turning into an SC splits them', () => {
  const data = fakeData([
    { date: 1000, category: 'SafetyCar', message: 'VIRTUAL SAFETY CAR DEPLOYED' },
    { date: 1500, category: 'SafetyCar', message: 'SAFETY CAR DEPLOYED' },
    { date: 2000, category: 'SafetyCar', message: 'SAFETY CAR IN THIS LAP' },
    { date: 2500, category: 'Flag', flag: 'CLEAR', scope: 'Track', message: 'TRACK CLEAR' },
    { date: 4000, category: 'Flag', flag: 'RED', scope: 'Track', message: 'RED FLAG' },
  ]);
  const tl = buildTimeline(data);
  assert.deepEqual(tl.bands, [
    { from: 1000, to: 1500, kind: 'vsc' }, { from: 1500, to: 2500, kind: 'sc' }, { from: 4000, to: 10000, kind: 'red' },
  ]);
});

test('marks: pit stops and fastest-lap improvements; only what happened by the playhead shows', () => {
  const data = fakeData([], {
    pits: [{ driver_number: 16, date: 3000 }, { driver_number: 1, date: 5000 }],
    laps: { 1: [{ date_end: 1000, lap_duration: 99 }, { date_end: 4000, lap_duration: 97 }], 16: [{ date_end: 1100, lap_duration: 98 }] },
  });
  const tl = buildTimeline(data);
  assert.deepEqual(tl.marks.map((m) => [m.t, m.kind]), [[1100, 'fastest'], [3000, 'pit'], [4000, 'fastest'], [5000, 'pit']]);
  const v = visibleTimeline(tl, 3500, 16);
  assert.deepEqual(v.marks.map((m) => [m.kind, m.mine]), [['fastest', false], ['pit', true]]);
  const vb = visibleTimeline({ bands: [{ from: 1000, to: 5000, kind: 'sc' }], marks: [] }, 2000, 1);
  assert.deepEqual(vb.bands, [{ from: 1000, to: 2000, kind: 'sc' }]);
});
