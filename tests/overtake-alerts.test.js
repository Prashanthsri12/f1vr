// Overtake warnings (js/overtake-alerts.js, 13.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOvertakeEvents, createOvertakeAlerts, swapsFromPositions, LEAD_MS, LINGER_MS } from '../js/overtake-alerts.js';

const T0 = 1_000_000;
const pos = (t, n, p) => ({ date: T0 + t, driver_number: n, position: p });
// Grid: 1 P1, 2 P2, 3 P3, 4 P4
const grid = [pos(0, 1, 1), pos(0, 2, 2), pos(0, 3, 3), pos(0, 4, 4)];

test('a one-place swap in the position data is a pass', () => {
  const s = swapsFromPositions([...grid, pos(100000, 3, 2), pos(101000, 2, 3)]);
  assert.deepEqual(s.map(({ a, b, pos: p }) => [a, b, p]), [[3, 2, 2]]);
});

test('a car gaining two places passes both; a retiring car is not passed', () => {
  const s = swapsFromPositions([...grid, pos(100000, 4, 2), pos(100500, 2, 3), pos(101000, 3, 4)]);
  assert.deepEqual(s.map(({ a, b }) => [a, b]).sort(), [[4, 2], [4, 3]]);
  // Car 1 retires: drops to P4; the others gain one place each, nobody "passed" it.
  const r = swapsFromPositions([...grid, pos(100000, 1, 4), pos(100100, 2, 1), pos(100200, 3, 2), pos(100300, 4, 3)]);
  assert.equal(r.length, 0);
});

test('API and position swaps merge; pits, SC and the start are dropped; re-passes pair up', () => {
  const positions = [...grid,
    pos(60000, 3, 2), pos(60500, 2, 3),            // 3 passes 2 (also in the API)
    pos(65000, 2, 2), pos(65400, 3, 3),            // 2 takes it back: quick re-pass
    pos(200000, 4, 3), pos(200400, 3, 4),          // 4 passes 3, but 3 is pitting
    pos(300000, 2, 1), pos(300300, 1, 2),          // under the safety car
    pos(5000, 4, 3), pos(5200, 3, 4),              // right after lights out
  ].sort((a, b) => a.date - b.date);
  const ev = buildOvertakeEvents({
    positions,
    overtakes: [{ t: T0 + 59000, overtaking_driver_number: 3, overtaken_driver_number: 2, position: 2 }],
    pits: [{ driver_number: 3, date: T0 + 210000 }],
    raceStart: T0,
    statusAt: (t) => (t > T0 + 290000 && t < T0 + 310000 ? 'SC' : 'GREEN'),
  });
  assert.deepEqual(ev.map((e) => [e.a, e.b, e.kind, e.source]), [[3, 2, 'pass', 'both'], [2, 3, 'repass', 'pos']]);
  assert.equal(ev[0].t, T0 + 59000, 'the API time wins');
  assert.equal(ev[0].pair, ev[1]);
});

test('alerts show from LEAD_MS before to LINGER_MS after, filtered by scope', () => {
  const events = [{ t: 100000, a: 3, b: 2, pos: 2 }, { t: 105000, a: 9, b: 8, pos: 14 }];
  const al = createOvertakeAlerts(events);
  const all = { overtakeAlerts: true, overtakeScope: 'all', overtakeTopN: 10 };
  assert.ok(LEAD_MS >= 10000);
  assert.equal(al.at(100000 - LEAD_MS - 1, all).length, 0);
  assert.equal(al.at(100000 - LEAD_MS, all).length, 1);
  assert.equal(al.at(100000, all).length, 2);
  assert.equal(al.at(100000 + LINGER_MS + 1, all).length, 1);
  assert.equal(al.at(100000, { ...all, overtakeScope: 'top' }).length, 1);
  assert.equal(al.at(100000, { ...all, overtakeAlerts: false }).length, 0);
});
