import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findBattles, intervalTrend, trendOf, lapSummary, lapsLed, stintsSoFar, defaultRival, stepRival, gapBetween,
} from '../js/panels/insights-data.js';

const row = (n, position, interval, gapToLeader, extra = {}) => ({ driverNumber: n, position, interval, gapToLeader, ...extra });

test('battles: under 1 s, not lapped strings, not in the pits; the selected driver first', () => {
  const rows = [
    row(1, 1, null, 0), row(11, 2, 0.6, 0.6), row(55, 3, 3.1, 3.7), row(16, 4, 0.8, 4.5),
    row(4, 5, '+1 LAP', '+1 LAP'), row(44, 6, 0.4, 9.0), row(81, 7, 0.3, 9.3, { retired: true }),
  ];
  const b = findBattles(rows, 16, new Set([44]));
  assert.deepEqual(b.map((x) => [x.ahead, x.behind, x.pos]), [[55, 16, 3], [1, 11, 1]]);
  assert.equal(findBattles(rows, null).length, 3); // capped at 3: P1, P3, P5 (44 behind 4)
});

test('interval trend from lap ends, and its direction', () => {
  const laps = [1, 2, 3, 4].map((k) => ({ lap_number: k, date_end: k * 100 }));
  const iv = { 100: 1.6, 200: 1.3, 300: '+1 LAP', 400: 0.9, 450: 0.8 };
  const data = { getDriverLaps: () => laps, getIntervalAt: (_n, t) => iv[t] ?? null };
  assert.deepEqual(intervalTrend(data, 16, 450), [1.6, 1.3, 0.9, 0.8]);
  assert.deepEqual(intervalTrend(data, 16, 250), [1.6, 1.3]);
  assert.equal(trendOf([1.6, 0.8]), 'closing');
  assert.equal(trendOf([0.5, 0.55]), 'steady');
  assert.equal(trendOf([0.5, 0.9]), 'growing');
  assert.equal(trendOf([0.5]), 'steady');
});

test('lap summary, laps led and stints only count what has happened by t', () => {
  const laps = [
    { lap_number: 1, date_end: 100, lap_duration: 99.0, st_speed: 280, duration_sector_1: 30 },
    { lap_number: 2, date_end: 200, lap_duration: 95.5, st_speed: 301, duration_sector_1: 29, duration_sector_2: 41, duration_sector_3: 25.5 },
    { lap_number: 3, date_end: 300, lap_duration: 94.0, st_speed: 320 },
  ];
  const data = {
    getDriverLaps: () => laps,
    getPositionAt: (_n, t) => (t === 200 ? 1 : 2),
  };
  const s = lapSummary(data, 1, 250);
  assert.equal(s.lapsDone, 2);
  assert.equal(s.best, 95.5);
  assert.equal(s.last, 95.5);
  assert.equal(s.topSpeed, 301);
  assert.deepEqual(s.sectors, [29, 41, 25.5]);
  assert.equal(lapsLed(data, 1, 350), 1);
  assert.deepEqual(stintsSoFar([
    { compound: 'SOFT', lap_start: 1, lap_end: 17 }, { compound: 'HARD', lap_start: 18, lap_end: 38 }, { compound: 'SOFT', lap_start: 39, lap_end: 57 },
  ], 23), [{ compound: 'SOFT', laps: 17, current: false }, { compound: 'HARD', laps: 6, current: true }]);
});

test('rival: the car ahead by default (behind for the leader), stepping skips the selected driver', () => {
  const rows = [row(1, 1), row(11, 2), row(16, 3)];
  assert.equal(defaultRival(rows, 16, null), 11);
  assert.equal(defaultRival(rows, 1, null), 11);
  assert.equal(defaultRival(rows, 16, 1), 1);
  assert.equal(defaultRival(rows, 16, 16), 11); // can't pick yourself
  assert.equal(stepRival(rows, 16, 11, 1), 1);
  assert.equal(stepRival(rows, 16, 1, 1), 11);
  assert.equal(gapBetween(row(1, 1, null, null), row(11, 2, 0.6, 2.5)), 2.5);
  assert.equal(gapBetween(row(11, 2, 0.6, 2.5), row(4, 5, null, '+1 LAP')), null);
});
