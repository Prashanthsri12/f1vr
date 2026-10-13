// Lap table for the analytics (9.21): one row per completed lap of every driver, with the
// tyre, position and gap at the lap's end and a "clean" flag. Pure (no three.js, no DOM),
// unit-tested in tests/analytics.test.js.
//
// A lap is clean when it is not lap 1, not an in-lap or out-lap (OpenF1 pit.lap_number is
// the in-lap, the next lap is the out-lap; is_pit_out_lap also counts), does not overlap a
// safety car / VSC / red flag period, and is within 107% of the median of the driver's other
// laps on that stint (laps up to the cut-off only, so nothing from later leaks in).
import { buildTimeline } from '../panels/timeline-marks.js';

export const CLEAN_FACTOR = 1.07;

/**
 * @param {object} data SessionData
 * @returns {{drivers: number[], byDriver: Map<number, object[]>, bands: object[], race: boolean}}
 *   rows: {driver, lap, start, end, time, s: [s1, s2, s3], i1, i2, st, compound, age, stint,
 *   pos, gap, inLap, outLap, neutral}; `clean` is decided per cut-off by cleanLaps().
 */
export function buildLapTable(data) {
  const race = !!data.hasIntervals;
  const { bands } = buildTimeline(data);
  const pitLaps = new Map();
  for (const p of data.getPitStops ? data.getPitStops() : []) {
    if (p.lap_number == null) continue;
    if (!pitLaps.has(p.driver_number)) pitLaps.set(p.driver_number, new Set());
    pitLaps.get(p.driver_number).add(p.lap_number);
  }
  const byDriver = new Map();
  for (const d of data.drivers) {
    const n = d.number;
    const stints = data.getDriverStints ? data.getDriverStints(n) : [];
    const pits = pitLaps.get(n) || new Set();
    const rows = [];
    for (const l of data.getDriverLaps(n)) {
      if (!(l.lap_duration > 0) || l.date_start == null || l.date_end == null) continue;
      // Same rule as session-index.js tyreOnLap: the latest stint started by this lap.
      let st = null;
      for (const s of stints) if (s.lap_start != null && s.lap_start <= l.lap_number) st = s;
      const neutral = bands.some((b) => b.from < l.date_end && b.to > l.date_start);
      rows.push({
        driver: n,
        lap: l.lap_number,
        start: l.date_start,
        end: l.date_end,
        time: l.lap_duration,
        s: [l.duration_sector_1 ?? null, l.duration_sector_2 ?? null, l.duration_sector_3 ?? null],
        i1: l.i1_speed ?? null, i2: l.i2_speed ?? null, st: l.st_speed ?? null,
        compound: st ? st.compound || 'UNKNOWN' : 'UNKNOWN',
        age: st ? (st.tyre_age_at_start || 0) + (l.lap_number - st.lap_start) : null,
        stint: st ? st.stint_number ?? stints.indexOf(st) + 1 : 0,
        pos: data.getPositionAt(n, l.date_end),
        gap: race && data.getGapToLeaderAt ? data.getGapToLeaderAt(n, l.date_end) : null,
        inLap: pits.has(l.lap_number),
        outLap: !!l.is_pit_out_lap || pits.has(l.lap_number - 1),
        neutral,
      });
    }
    rows.sort((a, b) => a.lap - b.lap);
    byDriver.set(n, rows);
  }
  return { drivers: data.drivers.map((d) => d.number), byDriver, bands, race };
}

/** Rows of driver n finished by upTo. */
export function lapsUpTo(table, n, upTo) {
  const rows = table.byDriver.get(n) || [];
  let k = rows.length;
  while (k > 0 && rows[k - 1].end > upTo) k--;
  return k === rows.length ? rows : rows.slice(0, k);
}

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export { median };

/**
 * Clean laps of driver n up to upTo (see the file header).
 * @returns {object[]} lap rows
 */
export function cleanLaps(table, n, upTo) {
  const rows = lapsUpTo(table, n, upTo).filter((r) => r.lap > 1 && !r.inLap && !r.outLap && !r.neutral);
  const byStint = new Map();
  for (const r of rows) {
    if (!byStint.has(r.stint)) byStint.set(r.stint, []);
    byStint.get(r.stint).push(r.time);
  }
  const med = new Map([...byStint].map(([k, v]) => [k, median(v)]));
  return rows.filter((r) => r.time <= med.get(r.stint) * CLEAN_FACTOR);
}

/** Total completed laps of all drivers by upTo (cheap change signature for charts). */
export function lapsDone(table, upTo) {
  let c = 0;
  for (const rows of table.byDriver.values()) {
    let k = rows.length;
    while (k > 0 && rows[k - 1].end > upTo) k--;
    c += k;
  }
  return c;
}
