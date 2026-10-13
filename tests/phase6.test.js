// Phase 6 pure logic: row animation (6.1/6.2), retirement (6.3), pit lane extraction (6.12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RowAnimator, SLIDE_MS, FLASH_MS } from '../js/panels/row-anim.js';
import {
  indexResults, raceLapsFromResults, retireLapStart, typicalLapMs, isRetiredAt, STOP_UNITS,
} from '../js/retirement.js';
import { pickPitStop, pitWindow, extractPitLane } from '../js/scene/pit-lane.js';

const fx = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
const top = (i) => 100 + i * 50;

// ------------------------------------------------------------------ row animation

test('rows: first fill snaps; a swap slides over SLIDE_MS with eased motion', () => {
  const a = new RowAnimator();
  a.setOrder([1, 2, 3], top, 0, true);
  assert.equal(a.yAt(1, 0), 100);
  assert.equal(a.active(0), false);
  a.setOrder([2, 1, 3], top, 1000, false);
  assert.equal(a.yAt(2, 1000), 150);               // starts where it was
  const mid = a.yAt(2, 1000 + SLIDE_MS / 2);
  assert.ok(mid < 150 && mid > 100, `mid ${mid}`);
  assert.equal(a.yAt(2, 1000 + SLIDE_MS), 100);
  assert.equal(a.yAt(1, 1000 + SLIDE_MS), 150);
  assert.equal(a.active(1000 + SLIDE_MS / 2), true);
});

test('rows: gain / loss flashes fade over FLASH_MS; unknown driver is NaN', () => {
  const a = new RowAnimator();
  const f = { kind: null, alpha: 0 };
  a.setOrder([1, 2], top, 0, true);
  a.setOrder([2, 1], top, 100, false);
  assert.equal(a.flashAt(2, 100, f), true);
  assert.equal(f.kind, 'gain');
  assert.equal(f.alpha, 1);
  assert.equal(a.flashAt(1, 100 + FLASH_MS / 2, f), true);
  assert.equal(f.kind, 'loss');
  assert.ok(Math.abs(f.alpha - 0.5) < 1e-9);
  assert.equal(a.flashAt(1, 100 + FLASH_MS, f), false);
  assert.equal(a.active(100 + FLASH_MS + 1), false);
  assert.ok(Number.isNaN(a.yAt(99, 0)));
});

test('rows: a seek (snap) jumps to the new order with no flash or slide', () => {
  const a = new RowAnimator();
  const f = { kind: null, alpha: 0 };
  a.setOrder([1, 2, 3], top, 0, true);
  a.setOrder([3, 2, 1], top, 50, true);
  assert.equal(a.yAt(3, 50), 100);
  assert.equal(a.flashAt(3, 50, f), false);
  assert.equal(a.active(50), false);
  // A later real change compares against the snapped order, not the old one.
  a.setOrder([2, 3, 1], top, 5000, false);
  assert.equal(a.flashAt(2, 5000, f), true);
  assert.equal(f.kind, 'gain');
});

test('rows: a mid-slide change continues from the current position', () => {
  const a = new RowAnimator();
  a.setOrder([1, 2], top, 0, true);
  a.setOrder([2, 1], top, 0, false);
  const y = a.yAt(2, SLIDE_MS / 2);
  a.setOrder([1, 2], top, SLIDE_MS / 2, false);
  assert.equal(a.yAt(2, SLIDE_MS / 2), y);
  assert.equal(a.yAt(2, SLIDE_MS * 1.5), 150);
});

test('rows: fastest-lap holder change flashes purple (not on snap)', () => {
  const a = new RowAnimator();
  const f = { kind: null, alpha: 0 };
  a.setOrder([1, 2], top, 0, true);
  a.setFastest(1, 0, true);
  assert.equal(a.flashAt(1, 0, f), false);
  a.setFastest(2, 10, false);
  assert.equal(a.flashAt(2, 10, f), true);
  assert.equal(f.kind, 'fastest');
  a.setFastest(2, 20, false);                   // unchanged: nothing new
  assert.equal(a.flashAt(1, 20, f), false);
});

// ------------------------------------------------------------------ retirement

const lapsOf = (n, starts, dur = 90) => starts.map((s, i) => ({
  driver_number: n, lap_number: i + 1, date_start: s * 1000, date_end: s * 1000 + dur * 1000, lap_duration: dur,
}));

test('indexResults / raceLapsFromResults on the real 2024 Bahrain result', () => {
  const r = indexResults(fx('session_result'));
  assert.equal(r.size, 4);
  assert.deepEqual(r.get(1), { dnf: false, dns: false, dsq: false, laps: 57, position: 1 });
  assert.equal(raceLapsFromResults(r), 57);
  // 2023 Australia shape: winner 58 laps, DNFs with position null.
  const aus = indexResults([
    { position: 1, driver_number: 1, number_of_laps: 58, dnf: false, dns: false, dsq: false },
    { position: null, driver_number: 16, number_of_laps: 0, dnf: true, dns: false, dsq: false },
    { driver_number: 'x' }, null,
  ]);
  assert.equal(aus.size, 2);
  assert.equal(raceLapsFromResults(aus), 58);
  assert.equal(aus.get(16).position, null);
  assert.equal(raceLapsFromResults(new Map()), null);
});

test('retireLapStart and typicalLapMs', () => {
  const laps = lapsOf(3, [0, 100, 200]);
  assert.equal(retireLapStart(laps, 2, 0), 200000);   // lap 3 start
  assert.equal(retireLapStart(laps, 3, 0), 290000);   // no lap 4: end of lap 3
  assert.equal(retireLapStart(laps, 0, 5000), 5000);  // lap-1 retirement: race start
  assert.equal(retireLapStart([], 4, 0), null);
  assert.equal(typicalLapMs(laps), 90000);
  assert.equal(typicalLapMs([]), 120000);
});

test('isRetiredAt with a result: DNF only once stopped / hidden / overdue / finished', () => {
  const laps = lapsOf(3, [0, 100]);
  const base = {
    laps, hasResults: true, raceStart: 0, finishTime: 1000000, totalLaps: 10, leaderLap: 5,
    lapNumber: 2, lapStart: 100000, result: { dnf: true, dns: false, dsq: false, laps: 1 },
    visible: () => true, movedUnits: () => 500,
  };
  assert.equal(isRetiredAt({ ...base, t: 50000 }), false);                 // before the retirement lap
  assert.equal(isRetiredAt({ ...base, t: 120000 }), false);                // racing on it
  assert.equal(isRetiredAt({ ...base, t: 120000, movedUnits: () => STOP_UNITS - 1 }), true);
  assert.equal(isRetiredAt({ ...base, t: 120000, movedUnits: () => NaN }), false); // unknown motion
  // Still for the first seconds of the lap (grid / pit exit) does not count as stopped.
  assert.equal(isRetiredAt({ ...base, t: 105000, movedUnits: () => 0 }), false);
  assert.equal(isRetiredAt({ ...base, t: 120000, visible: () => false }), true);
  assert.equal(isRetiredAt({ ...base, t: 100000 + 2 * 90000 + 1 }), true);   // lap overdue
  assert.equal(isRetiredAt({ ...base, t: 1000000 }), true);                // after the finish
  // Finishers never; DNS always; driver missing from the result never.
  assert.equal(isRetiredAt({ ...base, t: 120000, result: { dnf: false, dns: false }, visible: () => false }), false);
  assert.equal(isRetiredAt({ ...base, t: 0, result: { dnf: false, dns: true } }), true);
  assert.equal(isRetiredAt({ ...base, t: 120000, result: undefined, visible: () => false }), false);
});

test('isRetiredAt without a result: the earlier heuristics', () => {
  const laps = lapsOf(3, [0, 100]);
  const base = {
    laps, hasResults: false, raceStart: 0, finishTime: null, totalLaps: 10, leaderLap: 2,
    lapNumber: 2, lapStart: 100000, visible: () => true, movedUnits: () => NaN,
  };
  assert.equal(isRetiredAt({ ...base, t: 200000 }), false);
  assert.equal(isRetiredAt({ ...base, t: 230000, visible: () => false }), true);  // hidden 30 s after its last lap
  // Visible but stalled: 2+ laps down and the lap began > 4 min ago.
  assert.equal(isRetiredAt({ ...base, t: 100000 + 241000, leaderLap: 4 }), true);
  assert.equal(isRetiredAt({ ...base, t: 100000 + 200000, leaderLap: 4 }), false);
  // After the leader finished, a visible car is not marked by the stale-lap rule.
  assert.equal(isRetiredAt({ ...base, t: 400000, leaderLap: 4, finishTime: 390000 }), false);
  // Lap-1 crash with no lap: out once the leader is 3 laps in.
  assert.equal(isRetiredAt({ ...base, laps: [], lapNumber: 0, lapStart: null, t: 300000, leaderLap: 3 }), true);
  assert.equal(isRetiredAt({ ...base, laps: [], lapNumber: 0, lapStart: null, t: 300000, leaderLap: 2 }), false);
});

// ------------------------------------------------------------------ pit lane

test('pickPitStop prefers a typical lane time; rejects junk', () => {
  const stops = [
    { driver_number: 2, date: '2024-03-02T15:21:55.789Z', lane_duration: 35.7 },
    { driver_number: 16, date: '2024-03-02T15:22:06.457Z', lane_duration: 24 },
    { driver_number: 11, date: '2024-03-02T15:23:41.972Z', lane_duration: 24.5 },
    { driver_number: 1, date: '2024-03-02T15:30:00Z', lane_duration: 900 },      // red flag / garage
    { driver_number: 4, date: 'bad', lane_duration: 24 },
    { driver_number: 5, date: '2024-03-02T15:31:00Z', pit_duration: 24.2 },     // deprecated field still read
  ];
  const p = pickPitStop(stops);
  assert.equal(p.lane, 24.5);                                   // median of 24, 24.2, 24.5, 35.7
  assert.equal(pickPitStop([]), null);
  assert.equal(pickPitStop([{ driver_number: 1, date: 0, lane_duration: 3 }]), null);
  const w = pitWindow({ date: 100000, lane: 24 });
  assert.deepEqual(w, { start: 74000, end: 126000 });
});

test('extractPitLane: real LEC stop (2024 Bahrain lap 11) gives the speed-limited lane', () => {
  const samples = fx('pit_location');
  const lane = extractPitLane(samples, 24);
  assert.ok(lane, 'lane found');
  assert.ok(lane.length >= 20, `points ${lane.length}`);
  // The lane runs along the main straight: x stays within a narrow band while y spans ~4 km… in units.
  const xs = lane.map((p) => p.x);
  const ys = lane.map((p) => p.y);
  assert.ok(Math.max(...xs) - Math.min(...xs) < 600, 'narrow in x');
  assert.ok(Math.max(...ys) - Math.min(...ys) > 3000, 'long in y');
  // The stationary pit box collapses: no two consecutive points closer than 5 units.
  for (let i = 1; i < lane.length; i++) assert.ok(Math.hypot(lane[i].x - lane[i - 1].x, lane[i].y - lane[i - 1].y) >= 5);
});

test('extractPitLane rejects runs that are too short or touch the window edge', () => {
  const samples = fx('pit_location');
  assert.equal(extractPitLane(samples, 60), null);           // needs ≥ 36 s slow
  const t0 = Date.parse('2024-03-02T15:22:06.457Z');
  const cut = samples.filter((r) => Date.parse(r.date) > t0 - 20000);  // window starts mid-lane
  assert.equal(extractPitLane(cut, 24), null);
  assert.equal(extractPitLane([], 24), null);
});
