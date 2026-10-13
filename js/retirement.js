// Retired ("OUT") detection for the leaderboard (race / sprint only). Pure: no three.js.
//
// With OpenF1 /session_result (checked 2026-10-13 on 9472 and 7787): one row per driver
// `{ position (null for some DNFs), driver_number, number_of_laps, points, dnf, dns, dsq,
//   duration, gap_to_leader, meeting_key, session_key }`. `number_of_laps` is the laps the
// driver completed, so a DNF stopped during lap number_of_laps + 1. The result says *who*
// retired; the replay still has to find *when*: from the start of that lap, the car is OUT
// once it is hidden, has stopped (moved < STOP_UNITS in STOP_WINDOW_MS, from 10 s into the lap), the lap has taken
// more than 2× the driver's typical lap, or the leader has finished. DNS: OUT all race.
// DSQ is not shown live (the car raced).
//
// Without a result (not published yet, older or missing data) the earlier heuristics apply:
// hidden after the final recorded lap, or 2+ laps behind the leader with a stale lap.

export const STOP_WINDOW_MS = 5000;
export const STOP_UNITS = 30;      // location units are ~decimetres: 3 m in 5 s ≈ stopped
// The stop test starts this long into the retirement lap: a lap-1 DNF sat still on the grid
// (and a pit-out lap starts slowly), which must not count as 'stopped'.
export const STOP_GRACE_MS = 10000;
const STALE_LAP_MS = 240000;       // fallback: current lap began over 4 min ago
const DEFAULT_LAP_MS = 120000;

/**
 * Index /session_result rows by driver number.
 * @param {object[]} raw
 * @returns {Map<number, {dnf: boolean, dns: boolean, dsq: boolean, laps: number|null, position: number|null}>}
 */
export function indexResults(raw) {
  const m = new Map();
  for (const r of raw || []) {
    if (!r || typeof r.driver_number !== 'number') continue;
    m.set(r.driver_number, {
      dnf: r.dnf === true,
      dns: r.dns === true,
      dsq: r.dsq === true,
      laps: Number.isFinite(r.number_of_laps) ? r.number_of_laps : null,
      position: Number.isFinite(r.position) ? r.position : null,
    });
  }
  return m;
}

/**
 * Race distance from the result: the winner's completed laps (OpenF1 lap_number can exceed
 * it after red-flag restarts, e.g. 59 for the 58-lap 2023 Australian GP). Null if unknown.
 * @param {Map} results from indexResults
 */
export function raceLapsFromResults(results) {
  let best = null;
  for (const r of results.values()) {
    if (r.position === 1 && r.laps) return r.laps;
    if (r.laps && !r.dnf && !r.dns && (best === null || r.laps > best)) best = r.laps;
  }
  return best;
}

/** Median completed lap duration in ms (fallback DEFAULT_LAP_MS). */
export function typicalLapMs(laps) {
  const d = [];
  for (const l of laps || []) if (Number.isFinite(l.lap_duration) && l.lap_duration > 0) d.push(l.lap_duration * 1000);
  if (!d.length) return DEFAULT_LAP_MS;
  d.sort((a, b) => a - b);
  return d[d.length >> 1];
}

/**
 * When a DNF's retirement lap began (ms), or null if unknown.
 * @param {object[]} laps the driver's laps sorted by lap_number (ms dates)
 * @param {number} completed number_of_laps from the result
 * @param {number} raceStart
 */
export function retireLapStart(laps, completed, raceStart) {
  if (!completed) return raceStart;
  let prev = null;
  for (const l of laps || []) {
    if (l.lap_number === completed + 1 && l.date_start != null) return l.date_start;
    if (l.lap_number === completed) prev = l;
  }
  if (prev) {
    if (prev.date_end != null) return prev.date_end;
    if (prev.date_start != null && Number.isFinite(prev.lap_duration)) return prev.date_start + prev.lap_duration * 1000;
  }
  return null;
}

/**
 * Is a driver OUT at t?
 * @param {object} o
 * @param {number} o.t
 * @param {object[]} o.laps the driver's laps (sorted)
 * @param {object|undefined} o.result indexResults entry (undefined: no result for this driver)
 * @param {boolean} o.hasResults the session has a result at all
 * @param {number} o.raceStart
 * @param {number|null} o.finishTime when the leader finished, or null
 * @param {number} o.totalLaps
 * @param {number} o.leaderLap
 * @param {number} o.lapNumber the driver's current lap at t (0 = none)
 * @param {number|null} o.lapStart that lap's date_start
 * @param {() => boolean} o.visible car location visible at t
 * @param {() => number} o.movedUnits distance moved over the last STOP_WINDOW_MS (NaN if unknown)
 * @param {number} [o.retireStart] cached retireLapStart (avoids a scan per call)
 * @param {number} [o.lapMs] cached typicalLapMs
 */
export function isRetiredAt(o) {
  const { t, laps } = o;
  if (o.hasResults) {
    const r = o.result;
    if (!r) return false;
    if (r.dns) return true;
    if (!r.dnf) return false;
    const t0 = o.retireStart !== undefined ? o.retireStart : retireLapStart(laps, r.laps, o.raceStart);
    if (t0 == null || t < t0) return false;
    if (o.finishTime != null && t >= o.finishTime) return true;
    if (!o.visible()) return true;
    const moved = o.movedUnits();
    if (t - t0 >= STOP_GRACE_MS && Number.isFinite(moved) && moved < STOP_UNITS) return true;
    const lapMs = o.lapMs !== undefined ? o.lapMs : typicalLapMs(laps);
    return t - t0 > 2 * lapMs;
  }

  // --- fallback heuristics (no session_result) ---
  const fl = laps && laps.length ? laps[laps.length - 1] : null;
  const finished = o.finishTime != null && t >= o.finishTime;
  // Hidden after the final recorded lap, which ended before the race was over.
  if (fl) {
    const end = fl.date_end ?? fl.date_start;
    if (end != null && t > end + 30000 && (o.finishTime == null || end < o.finishTime)
      && fl.lap_number < o.totalLaps && !o.visible()) return true;
  }
  if (finished) return false;
  // Stopped on track while still visible (e.g. 2023 Australia LEC, ALB): 2+ laps behind
  // the leader and the current lap began over 4 minutes ago.
  if (o.leaderLap - o.lapNumber < 2) return false;
  // No usable current lap (e.g. a lap-1 crash with no lap start time).
  if (!o.lapNumber) return o.leaderLap >= 3 && (!fl || fl.lap_number <= 1);
  return o.lapStart != null && t - o.lapStart > STALE_LAP_MS;
}
