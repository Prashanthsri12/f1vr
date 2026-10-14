import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentCounts, buildMiniHolders, holderAt, sampleMap, hexRgb, TrackStyle } from '../js/scene/track-style.js';

const lap = (n, lapNumber, start, segs, durs = [30, 40, 25]) => ({
  driver_number: n, lap_number: lapNumber, date_start: start, lap_duration: durs[0] + durs[1] + durs[2],
  duration_sector_1: durs[0], duration_sector_2: durs[1], duration_sector_3: durs[2],
  segments_sector_1: segs[0], segments_sector_2: segs[1], segments_sector_3: segs[2],
});

function fakeData(laps) {
  const drivers = [{ number: 1, teamColour: '#3671c6' }, { number: 16, teamColour: '#e8002d' }];
  return {
    drivers,
    driverByNumber: new Map(drivers.map((d) => [d.number, d])),
    hasIntervals: true,
    getDriverLaps: (n) => laps.filter((l) => l.driver_number === n),
  };
}

test('segment counts: the most common shape wins, missing data gives null', () => {
  const Y = 2048, G = 2049, P = 2051;
  const data = fakeData([
    lap(1, 2, 0, [[Y, G], [Y, Y, Y], [G]]),
    lap(16, 2, 0, [[Y, Y], [Y, Y, Y], [Y]]),
    lap(16, 3, 0, [[Y], [P], [Y]]),
  ]);
  assert.deepEqual(segmentCounts(data), [2, 3, 1]);
  assert.equal(segmentCounts(fakeData([{ driver_number: 1, lap_number: 1 }])), null);
});

test('mini-sector holders: the last purple at or before t', () => {
  const Y = 2048, P = 2051;
  const data = fakeData([
    lap(1, 2, 0, [[P, Y], [Y, Y, Y], [Y]]),        // VER purple in mini 0 at 15 s
    lap(16, 3, 100000, [[P, Y], [Y, P, Y], [Y]]), // LEC purple in mini 0 at 115 s, mini 3 at ~156.7 s
  ]);
  const h = buildMiniHolders(data, [2, 3, 1]);
  assert.equal(h.length, 6);
  assert.equal(holderAt(h[0], 10000), null);
  assert.equal(holderAt(h[0], 15000), 1);
  assert.equal(holderAt(h[0], 120000), 16);
  assert.equal(holderAt(h[3], 150000), null);
  assert.equal(holderAt(h[3], 160000), 16);
});

test('sample map: sectors walk forward from S1 and wrap around the outline', () => {
  const { sector, mini } = sampleMap(10, [8, 1, 5], [1, 2, 1]);
  // S1 = 8, 9, 0 ; S2 = 1..4 ; S3 = 5..7
  assert.deepEqual([...sector], [0, 1, 1, 1, 1, 2, 2, 2, 0, 0]);
  assert.deepEqual([...mini], [0, 1, 1, 2, 2, 3, 3, 3, 0, 0]);
});

test('TrackStyle: plain without sector bounds, recolours only on change', () => {
  let calls = 0;
  const data = fakeData([]);
  const plain = new TrackStyle(data, { outline: new Array(30).fill(0), sectors: null, setSampleColours: () => { calls++; } });
  assert.equal(plain.effectiveMode('sectors'), 'plain');
  plain.update(0, 1, 'sectors');
  plain.update(0, 1, 'sectors');
  assert.equal(calls, 1);
  const s = new TrackStyle(data, { outline: new Array(30).fill(0), sectors: [0, 3, 6], setSampleColours: () => { calls++; } });
  assert.equal(s.effectiveMode('minis'), 'sectors'); // no segment data
  assert.deepEqual(hexRgb('#ff0000'), [1, 0, 0]);
});

test('13.4: mini-sectors only when switched on', async () => {
  const { colourMode, nextColourMode } = await import('../js/scene/track-style.js');
  assert.equal(colourMode({ trackColours: 'minis', minis: false }), 'sectors');
  assert.equal(colourMode({ trackColours: 'minis', minis: true }), 'minis');
  assert.equal(nextColourMode({ trackColours: 'sectors', minis: false }), 'plain');
  assert.equal(nextColourMode({ trackColours: 'plain', minis: false }), 'sectors');
  assert.equal(nextColourMode({ trackColours: 'sectors', minis: true }), 'minis');
});
