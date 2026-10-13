// Race story and pace analytics (9.23, 9.24, 9.30). Pure, unit-tested in tests/analytics.test.js.
// Every function takes a cut-off time `upTo` (the playhead, or Infinity for "Show full session").
import { lapsUpTo, cleanLaps, median } from './lap-table.js';

/** Estimated lap-time gain from fuel burn, s per lap (a common rule of thumb, not OpenF1 data). */
export const FUEL_S_PER_LAP = 0.06;

/** Per driver: [{lap, gap}] gap to the leader at each lap end (numbers only). */
export function gapSeries(table, upTo) {
  const out = new Map();
  for (const n of table.drivers) {
    out.set(n, lapsUpTo(table, n, upTo).filter((r) => typeof r.gap === 'number' || r.pos === 1)
      .map((r) => ({ lap: r.lap, v: r.pos === 1 && typeof r.gap !== 'number' ? 0 : r.gap })));
  }
  return out;
}

/** Per driver: [{lap, pos}] position at each lap end. */
export function positionSeries(table, upTo) {
  const out = new Map();
  for (const n of table.drivers) {
    out.set(n, lapsUpTo(table, n, upTo).filter((r) => r.pos != null).map((r) => ({ lap: r.lap, v: r.pos })));
  }
  return out;
}

/**
 * Stints so far per driver from the lap rows: [{compound, from, to}] (lap numbers).
 * Built from the laps actually driven, so a stint shows only up to the cut-off.
 */
export function stintBars(table, upTo) {
  const out = new Map();
  for (const n of table.drivers) {
    const bars = [];
    for (const r of lapsUpTo(table, n, upTo)) {
      const last = bars[bars.length - 1];
      if (last && last.stint === r.stint && last.compound === r.compound) last.to = r.lap;
      else bars.push({ stint: r.stint, compound: r.compound, from: r.lap, to: r.lap });
    }
    out.set(n, bars);
  }
  return out;
}

/** Least-squares line y = a + b x, or null for fewer than 3 points. */
export function fitLine(pts) {
  const n = pts.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-9) return null;
  const b = (n * sxy - sx * sy) / den;
  return { a: (sy - b * sx) / n, b };
}

/**
 * Tyre degradation per compound: clean laps as (tyre age, lap time − the driver's median clean
 * lap), and a straight-line fit. With `fuel`, the estimated fuel effect is added back
 * (+FUEL_S_PER_LAP per lap after the driver's median lap number), which removes the fuel-burn
 * gain that otherwise hides part of the tyre wear.
 * @returns {Map<string, {points: Array<{x:number, y:number, driver:number}>, slope: number|null, a: number|null}>}
 */
export function degradation(table, upTo, { fuel = false } = {}) {
  const out = new Map();
  for (const n of table.drivers) {
    const clean = cleanLaps(table, n, upTo);
    if (clean.length < 3) continue;
    const med = median(clean.map((r) => r.time));
    const midLap = median(clean.map((r) => r.lap));
    for (const r of clean) {
      if (r.age == null) continue;
      const y = r.time - med + (fuel ? FUEL_S_PER_LAP * (r.lap - midLap) : 0);
      if (Math.abs(y) > 4) continue;
      if (!out.has(r.compound)) out.set(r.compound, { points: [], slope: null, a: null });
      out.get(r.compound).points.push({ x: r.age, y, driver: n });
    }
  }
  for (const v of out.values()) {
    const f = fitLine(v.points.map((p) => [p.x, p.y]));
    if (f && v.points.length >= 8) { v.slope = f.b; v.a = f.a; }
  }
  return out;
}

/**
 * Per driver: consistency (standard deviation of clean laps), best lap, theoretical best
 * (sum of the best sector times) and the stint medians ("stint pace").
 * @returns {Map<number, {sigma: number|null, clean: number, best: number|null, theory: number|null,
 *   stints: Array<{stint:number, compound:string, median:number, laps:number}>}>}
 */
export function paceSummary(table, upTo) {
  const out = new Map();
  for (const n of table.drivers) {
    const laps = lapsUpTo(table, n, upTo);
    const clean = cleanLaps(table, n, upTo);
    let best = null;
    const bs = [null, null, null];
    for (const r of laps) {
      if (best == null || r.time < best) best = r.time;
      for (let k = 0; k < 3; k++) if (r.s[k] > 0 && (bs[k] == null || r.s[k] < bs[k])) bs[k] = r.s[k];
    }
    let sigma = null;
    if (clean.length >= 3) {
      const m = clean.reduce((a, r) => a + r.time, 0) / clean.length;
      sigma = Math.sqrt(clean.reduce((a, r) => a + (r.time - m) ** 2, 0) / (clean.length - 1));
    }
    const groups = new Map();
    for (const r of clean) {
      if (!groups.has(r.stint)) groups.set(r.stint, { stint: r.stint, compound: r.compound, times: [] });
      groups.get(r.stint).times.push(r.time);
    }
    out.set(n, {
      sigma, clean: clean.length, best,
      theory: bs.every((x) => x != null) ? bs[0] + bs[1] + bs[2] : null,
      stints: [...groups.values()].map((g) => ({ stint: g.stint, compound: g.compound, median: median(g.times), laps: g.times.length })),
    });
  }
  return out;
}

/**
 * Long runs (practice, 9.30): each driver's stint with the most clean laps (at least `min`),
 * ranked by its median lap.
 * @returns {Array<{driver:number, compound:string, median:number, laps:number}>}
 */
export function longRuns(table, upTo, min = 5) {
  const out = [];
  for (const [n, p] of paceSummary(table, upTo)) {
    let pick = null;
    for (const s of p.stints) if (s.laps >= min && (!pick || s.laps > pick.laps)) pick = s;
    if (pick) out.push({ driver: n, compound: pick.compound, median: pick.median, laps: pick.laps });
  }
  return out.sort((a, b) => a.median - b.median);
}

/** Per driver: [{lap, v: lap time, clean, compound}] for the lap-times chart. */
export function lapTimes(table, n, upTo) {
  const clean = new Set(cleanLaps(table, n, upTo).map((r) => r.lap));
  return lapsUpTo(table, n, upTo).map((r) => ({ lap: r.lap, v: r.time, clean: clean.has(r.lap), compound: r.compound, end: r.end }));
}
