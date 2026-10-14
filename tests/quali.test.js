// Qualifying engine (js/analytics/quali.js, 13.11).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuali, qualiAt, fmtQ } from '../js/analytics/quali.js';

const T = Date.parse('2024-03-01T16:00:00Z');
const at = (min) => new Date(T + min * 60000).toISOString();
const flag = (min, phase, flag, message) => ({ date: at(min), category: 'Flag', flag, qualifying_phase: phase, message });
const rc = [
  flag(0, 1, 'GREEN', 'GREEN LIGHT - PIT EXIT OPEN'), flag(18, 1, 'CHEQUERED', 'CHEQUERED FLAG'),
  flag(25, 2, 'GREEN', 'GREEN LIGHT - PIT EXIT OPEN'), flag(40, 2, 'CHEQUERED', 'CHEQUERED FLAG'),
  flag(48, 3, 'GREEN', 'GREEN LIGHT - PIT EXIT OPEN'), flag(60, 3, 'CHEQUERED', 'CHEQUERED FLAG'),
  { date: at(6), category: 'Other', qualifying_phase: null, message: 'CAR 12 (AAA) TIME 1:29.000 DELETED - TRACK LIMITS AT TURN 4 LAP 3 19:06:00' },
];
// 12 cars: Q1 keeps 10 + ceil(2/2) = 11, Q2 keeps 10.
const lap = (n, lapNo, min, time) => ({ driver_number: n, lap_number: lapNo, date_start: at(min), lap_duration: time, is_pit_out_lap: false });
const laps = [];
for (let n = 1; n <= 12; n++) {
  laps.push(lap(n, 2, 2, 90 + n * 0.1));          // Q1: car 1 fastest … car 12 slowest
  laps.push(lap(n, 5, 30, 89.5 + (13 - n) * 0.1)); // Q2: car 12 fastest … car 1 slowest
  laps.push(lap(n, 8, 52, 89 + n * 0.05));         // Q3
}
laps.push(lap(12, 3, 4, 89.0));                   // car 12's Q1 lap, deleted at minute 6

test('phases, deletions and the drop zone, spoiler-free', () => {
  const m = buildQuali({ name: 'Qualifying', laps, raceControl: rc });
  assert.deepEqual(m.phases.map((p) => p.name), ['Q1', 'Q2', 'Q3']);
  assert.deepEqual(m.keep, [11, 10, 10]);
  let s = qualiAt(m, T + 5.6 * 60000); // car 12's 1:29.000 (minute 4 + 89 s) counts until minute 6
  assert.equal(s.phase, 1);
  assert.equal(s.phases[0].rows[0].driver, 12);
  // Minute 7: deleted; car 12 is back to its 1:31.2 and in the drop zone.
  s = qualiAt(m, T + 7 * 60000);
  const r12 = s.phases[0].rows.find((r) => r.driver === 12);
  assert.equal(r12.best, 91.2);
  assert.equal(r12.status, 'drop');
  assert.equal(s.phases[1].rows.length, 0, 'Q2 not started');
  // After Q1: 11 through, car 12 out; Q2 has 11 cars.
  s = qualiAt(m, T + 26 * 60000);
  assert.equal(s.phases[0].rows.filter((r) => r.status === 'out').map((r) => r.driver).join(), '12');
  assert.equal(s.phases[1].rows.length, 11);
});

test('the final order: Q3, then Q2 and Q1 knockouts; official results win', () => {
  const m = buildQuali({ name: 'Sprint Qualifying', laps, raceControl: rc });
  assert.equal(m.phases[0].name, 'SQ1');
  let s = qualiAt(m, Infinity);
  assert.equal(s.phase, 4);
  assert.deepEqual(s.final.slice(0, 3).map((f) => f.driver), [2, 3, 4]); // car 1 out in Q2 (slowest), Q3 by car number
  assert.equal(s.final[10].driver, 1);
  assert.equal(s.final[11].driver, 12);
  assert.equal(s.final[11].out, 1);
  const results = [{ driver_number: 5, position: 1, duration: [90.5, 89.9, 88.0] }];
  s = qualiAt(buildQuali({ laps, raceControl: rc, results }), Infinity);
  assert.equal(s.final[0].driver, 5);
  assert.equal(s.final[0].q[2], 88.0);
  assert.equal(fmtQ(89.179), '1:29.179');
});
