// Pit lane outline (spec §4, optional) from one real pit stop's location samples. Pure: no three.js.
//
// OpenF1 /pit has `date`, `lane_duration` (s) and `lap_number`; the docs don't say which moment
// `date` marks. On 2024 Bahrain (9472, LEC lap 11) it is the pit lane *exit*: the car slows to
// the 80 km/h limit ~25 s before it, stops ~14 s before it. So instead of trusting `date`, we
// take location samples over [date - lane - 2 s, date + lane + 2 s] and keep the longest run
// slower than PIT_KMH (the speed-limited lane, stop included), which must last at least 60% of
// lane_duration. Anything else (SC queue, red flag, odd data) is rejected: no line is drawn.

export const PIT_KMH = 100;
const SPEED_WINDOW_MS = 1000;   // speed from positions ~1 s apart (location timestamps jitter)
const UNITS_PER_M = 10;         // OpenF1 location units are ~decimetres
const MIN_LANE_S = 12;
const MAX_LANE_S = 45;

/**
 * Pick a representative stop: lane_duration within a sane range, closest to the median.
 * @param {Array<{driver_number: number, date: number|string, lane_duration?: number, pit_duration?: number}>} stops
 * @returns {{driver: number, date: number, lane: number}|null}
 */
export function pickPitStop(stops) {
  const ok = [];
  for (const p of stops || []) {
    const lane = Number.isFinite(p.lane_duration) ? p.lane_duration : p.pit_duration;
    const date = typeof p.date === 'number' ? p.date : Date.parse(p.date);
    if (Number.isFinite(lane) && lane >= MIN_LANE_S && lane <= MAX_LANE_S && Number.isFinite(date)
      && typeof p.driver_number === 'number') ok.push({ driver: p.driver_number, date, lane });
  }
  if (!ok.length) return null;
  const sorted = ok.map((p) => p.lane).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  ok.sort((a, b) => Math.abs(a.lane - median) - Math.abs(b.lane - median) || a.date - b.date);
  return ok[0];
}

/** Location query window (ms) for a stop picked by pickPitStop. */
export function pitWindow(stop) {
  const pad = (stop.lane + 2) * 1000;
  return { start: stop.date - pad, end: stop.date + pad };
}

/**
 * Longest slow run in the samples.
 * @param {Array<{date: number|string, x: number, y: number, z: number}>} samples one driver, any order
 * @param {number} laneSec lane_duration of that stop
 * @returns {Array<{x: number, y: number, z: number}>|null} raw-coordinate points along the lane
 */
export function extractPitLane(samples, laneSec) {
  const pts = [];
  for (const r of samples || []) {
    const t = typeof r.date === 'number' ? r.date : Date.parse(r.date);
    if (!Number.isFinite(t) || (r.x === 0 && r.y === 0 && r.z === 0)) continue;
    pts.push({ t, x: r.x, y: r.y, z: r.z });
  }
  pts.sort((a, b) => a.t - b.t);
  if (pts.length < 10) return null;
  // Speed per sample (km/h) over ~1 s.
  const kmh = new Float64Array(pts.length);
  let j = 0;
  for (let i = 0; i < pts.length; i++) {
    if (j < i) j = i;
    while (j < pts.length - 1 && pts[j].t - pts[i].t < SPEED_WINDOW_MS) j++;
    const k = j > i ? j : Math.max(0, i - 1);
    const a = pts[Math.min(i, k)];
    const b = pts[Math.max(i, k)];
    const dt = (b.t - a.t) / 1000;
    kmh[i] = dt > 0 ? (Math.hypot(b.x - a.x, b.y - a.y) / UNITS_PER_M / dt) * 3.6 : 0;
  }
  let best = null;
  let runStart = -1;
  for (let i = 0; i <= pts.length; i++) {
    const slow = i < pts.length && kmh[i] < PIT_KMH;
    if (slow && runStart < 0) runStart = i;
    if (!slow && runStart >= 0) {
      const dur = (pts[i - 1].t - pts[runStart].t) / 1000;
      if (!best || dur > best.dur) best = { a: runStart, b: i - 1, dur };
      runStart = -1;
    }
  }
  if (!best || best.dur < 0.6 * laneSec) return null;
  // Touching the window edge means the run may be cut off (or the car was crawling throughout).
  if (best.a === 0 || best.b === pts.length - 1) return null;
  const out = [];
  let last = null;
  for (let i = best.a; i <= best.b; i++) {
    const p = pts[i];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 5) continue; // drop the stationary stop
    out.push({ x: p.x, y: p.y, z: p.z });
    last = p;
  }
  return out.length >= 4 ? out : null;
}
