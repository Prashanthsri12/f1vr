import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridPositions, drsTimeline, drsEnabledAt, pitLaneAt } from '../js/panels/leaderboard-flags.js';

test('grid slots are the positions just before the race start', () => {
  const start = Date.parse('2024-03-02T15:03:42.341Z');
  const pos = { 1: [[start - 3600e3, 1], [start + 5000, 1]], 16: [[start - 3600e3, 2], [start + 5000, 3]], 63: [] };
  const data = {
    raceStartTime: start,
    drivers: [{ number: 1 }, { number: 16 }, { number: 63 }],
    getPositionAt: (n, t) => {
      let p = null;
      for (const [at, v] of pos[n]) if (at <= t) p = v;
      return p;
    },
  };
  const grid = gridPositions(data);
  assert.equal(grid.get(1), 1);
  assert.equal(grid.get(16), 2); // not the P3 from after the start
  assert.equal(grid.has(63), false);
  assert.equal(gridPositions({ ...data, raceStartTime: NaN }).size, 0);
});

test('DRS timeline from race control Drs messages (2024 Bahrain wording)', () => {
  const newestFirst = [
    { category: 'Flag', message: 'GREEN LIGHT - PIT EXIT OPEN', date: '2024-03-02T15:06:00+00:00' },
    { category: 'Drs', message: 'DRS ENABLED', date: '2024-03-02T15:05:23+00:00' },
    { category: 'Drs', message: 'DRS DISABLED', date: '2024-03-02T14:57:04+00:00' },
  ];
  const tl = drsTimeline(newestFirst);
  assert.deepEqual(tl.map((m) => m.on), [false, true]);
  assert.equal(drsEnabledAt(tl, Date.parse('2024-03-02T14:50:00Z')), false);
  assert.equal(drsEnabledAt(tl, Date.parse('2024-03-02T15:00:00Z')), false);
  assert.equal(drsEnabledAt(tl, Date.parse('2024-03-02T15:05:23Z')), true);
  assert.equal(drsEnabledAt(tl, Date.parse('2024-03-02T16:00:00Z')), true);
  assert.equal(drsEnabledAt([], Date.now()), false);
});

test('pit lane window ends at pit.date (the lane exit)', () => {
  const exit = Date.parse('2024-03-02T15:20:00Z');
  const stops = [
    { driver_number: 16, date: '2024-03-02T15:20:00+00:00', lane_duration: 22.5 },
    { driver_number: 1, date: exit + 60000, pit_duration: 21 }, // old field name still works
    { driver_number: 44, date: exit, lane_duration: null },     // no duration: never shown
  ];
  const out = new Set([99]);
  pitLaneAt(stops, exit - 10000, out);
  assert.deepEqual([...out], [16]);
  pitLaneAt(stops, exit - 23000, out);
  assert.deepEqual([...out], []);
  pitLaneAt(stops, exit + 1, out);
  assert.deepEqual([...out], []);
  pitLaneAt(stops, exit + 50000, out);
  assert.deepEqual([...out], [1]);
});
