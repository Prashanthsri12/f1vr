// Pure lap/sector/stint statistics for the laps panel (no three.js, no DOM).
//
// Built once per session from a data-like object:
//   { drivers: [{ number }], getDriverLaps(n), getDriverStints(n), totalLaps, session }
// Laps are those of SessionData.getDriverLaps: lap_number, date_start/date_end (ms),
// lap_duration, duration_sector_1..3 (s, any may be null), st_speed.
//
// A lap is "completed" at its end time: date_end, or (when lap_duration is null, e.g.
// pit laps) the next lap's date_start. Sector times become known with the lap.
// Precomputed indexes (sorted end times + running minima) make compute() O(log n)
// and allocation-free (it fills a reused output object).

const STALE_LAP_S = 300;
const SECTOR_KEYS = ['duration_sector_1', 'duration_sector_2', 'duration_sector_3'];

/** Largest index i with arr[i] <= t, or -1. arr sorted ascending. */
export function lastAtOrBefore(arr, t) {
  let lo = 0;
  let hi = arr.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

const pos = (v) => (v != null && Number.isFinite(v) && v > 0 ? v : null);
const minN = (a, b) => (b == null ? a : a == null || b < a ? b : a);

/**
 * Running minima over completion events sorted by end time.
 * @param {{end:number, lap:number|null, s:(number|null)[], driver:number}[]} ev sorted by end
 */
function buildPrefix(ev) {
  const n = ev.length;
  const ends = new Float64Array(n);
  const bestLap = new Array(n);
  const bestLapDriver = new Array(n);
  const bestS = [new Array(n), new Array(n), new Array(n)];
  let bl = null;
  let bld = null;
  const bs = [null, null, null];
  for (let i = 0; i < n; i++) {
    const e = ev[i];
    ends[i] = e.end;
    if (e.lap != null && (bl == null || e.lap < bl)) { bl = e.lap; bld = e.driver; }
    bestLap[i] = bl;
    bestLapDriver[i] = bld;
    for (let k = 0; k < 3; k++) { bs[k] = minN(bs[k], e.s[k]); bestS[k][i] = bs[k]; }
  }
  return { ends, bestLap, bestLapDriver, bestS };
}

export function newLapStatsOut() {
  return {
    driver: null,
    lapNumber: 0,          // current lap (0 before the driver's first lap starts)
    running: null,         // s since the current lap started; null when not on a lap
    lastLapNumber: null,   // last completed lap
    lastLap: null,         // its duration (s|null: pit laps may have none)
    pb: null,              // personal best lap so far (s)
    sessionBest: null,     // best lap of all drivers so far (s)
    sessionBestDriver: null,
    pbIsSessionBest: false,
    sectors: [{ time: null, cls: null }, { time: null, cls: null }, { time: null, cls: null }],
    sessionBestSectors: [null, null, null],
    stSpeed: null,         // speed trap of the last completed lap (km/h)
    stints: [],            // [{ compound, lapStart, lapEnd, laps, ageStart, ageEnd, current }]
    stintCount: 0,         // valid entries in stints (array is reused)
    totalLaps: 0,          // strip scale: race distance, or the driver's max lap
  };
}

export class LapStats {
  /** @param {object} data data-like (see file header) */
  constructor(data) {
    this.data = data;
    this._drivers = new Map(); // number -> per-driver index
    this._global = null;
    this._isRace = isRaceSession(data);
  }

  _build() {
    const all = [];
    for (const d of this.data.drivers || []) {
      const n = d.number;
      const laps = this.data.getDriverLaps(n) || [];
      const ev = [];
      const starts = [];
      const startLaps = [];
      let maxLap = 0;
      for (let i = 0; i < laps.length; i++) {
        const l = laps[i];
        if (l.lap_number > maxLap) maxLap = l.lap_number;
        if (l.date_start != null) { starts.push(l.date_start); startLaps.push(l); }
        // A lap ends no later than the next one starts: lap 1 / pit laps often lack a
        // duration, and pit-out laps in practice/qualifying carry durations that run past
        // the next lap's start (garage time), which would reorder completions.
        let end = l.date_end;
        const nx = laps[i + 1];
        const nextStart = nx && nx.lap_number === l.lap_number + 1 ? nx.date_start : null;
        if (nextStart != null && (end == null || nextStart < end)) end = nextStart;
        if (end == null) continue;
        ev.push({
          end, driver: n, l,
          lap: pos(l.lap_duration),
          s: SECTOR_KEYS.map((k) => pos(l[k])),
        });
      }
      ev.sort((a, b) => a.end - b.end);
      // date_start order normally equals lap order; sort defensively.
      const order = starts.map((s, i) => i).sort((a, b) => starts[a] - starts[b]);
      const idx = {
        ev,
        prefix: buildPrefix(ev),
        starts: Float64Array.from(order.map((i) => starts[i])),
        startLaps: order.map((i) => startLaps[i]),
        maxLap,
      };
      this._drivers.set(n, idx);
      for (const e of ev) all.push(e);
    }
    all.sort((a, b) => a.end - b.end);
    this._global = buildPrefix(all);
  }

  _driver(n) {
    if (!this._global) this._build();
    let idx = this._drivers.get(n);
    if (!idx) {
      idx = { ev: [], prefix: buildPrefix([]), starts: new Float64Array(0), startLaps: [], maxLap: 0 };
      this._drivers.set(n, idx);
    }
    return idx;
  }

  /**
   * Stats for driver n at time t (ms).
   * @param {number} n
   * @param {number} t
   * @param {object} [out] from newLapStatsOut(), reused
   */
  compute(n, t, out = newLapStatsOut()) {
    const d = this._driver(n);
    const G = this._global;
    out.driver = n;

    // Session bests (all drivers) at t.
    const gi = lastAtOrBefore(G.ends, t);
    out.sessionBest = gi >= 0 ? G.bestLap[gi] : null;
    out.sessionBestDriver = gi >= 0 ? G.bestLapDriver[gi] : null;
    for (let k = 0; k < 3; k++) out.sessionBestSectors[k] = gi >= 0 ? G.bestS[k][gi] : null;

    // Current lap.
    const si = lastAtOrBefore(d.starts, t);
    const cur = si >= 0 ? d.startLaps[si] : null;
    out.lapNumber = cur ? cur.lap_number : 0;
    out.running = null;
    if (cur) {
      const ended = cur.date_end != null && cur.date_end <= t;
      if (!ended) out.running = (t - cur.date_start) / 1000;
      // A lap without a duration that never ends (in-lap, then the garage in practice):
      // stop the clock rather than count garage time.
      if (out.running != null && cur.date_end == null && out.running > STALE_LAP_S) out.running = null;
    }

    // Last completed lap and personal bests.
    const di = lastAtOrBefore(d.prefix.ends, t);
    const last = di >= 0 ? d.ev[di] : null;
    out.lastLapNumber = last ? last.l.lap_number : null;
    out.lastLap = last ? last.lap : null;
    out.stSpeed = last ? pos(last.l.st_speed) : null;
    out.pb = di >= 0 ? d.prefix.bestLap[di] : null;
    out.pbIsSessionBest = out.pb != null && out.sessionBest != null && out.pb <= out.sessionBest;
    // If the running clock has stopped (no current lap), the "current lap" is the last one.
    if (cur && out.running == null && last && last.l.lap_number > out.lapNumber) out.lapNumber = last.l.lap_number;

    for (let k = 0; k < 3; k++) {
      const sec = out.sectors[k];
      const v = last ? last.s[k] : null;
      sec.time = v;
      if (v == null) { sec.cls = null; continue; }
      const sb = out.sessionBestSectors[k];
      const pbS = d.prefix.bestS[k][di];
      sec.cls = sb != null && v <= sb ? 'purple' : pbS != null && v <= pbS ? 'green' : 'yellow';
    }

    this._stints(n, out, d);
    return out;
  }

  _stints(n, out, d) {
    const stints = this.data.getDriverStints ? (this.data.getDriverStints(n) || []) : [];
    const curLap = out.lapNumber;
    let c = 0;
    for (const s of stints) {
      if (s.lap_start == null || curLap < 1 || s.lap_start > curLap) continue;
      const end = Math.min(s.lap_end ?? curLap, curLap);
      if (end < s.lap_start) continue;
      let e = out.stints[c];
      if (!e) { e = {}; out.stints[c] = e; }
      e.compound = s.compound || 'UNKNOWN';
      e.lapStart = s.lap_start;
      e.lapEnd = end;
      e.laps = end - s.lap_start + 1;
      e.ageStart = s.tyre_age_at_start ?? 0;
      e.ageEnd = e.ageStart + e.laps - 1;
      e.current = false;
      c++;
    }
    if (c > 0 && out.stints[c - 1].lapEnd === curLap) out.stints[c - 1].current = true;
    out.stintCount = c;
    out.totalLaps = Math.max(this._isRace ? (this.data.totalLaps || 0) : d.maxLap, curLap, 1);
  }
}

/** Race or sprint (strip spans the race distance); otherwise the driver's own max lap. */
export function isRaceSession(data) {
  const s = data.session || {};
  if (s.type != null) return /race/i.test(s.type);
  if (s.name != null) return /^(race|sprint)$/i.test(s.name);
  return !!data.hasIntervals;
}
