// Per-lap speed traces for the telemetry panel: speed vs distance from lap start.
// getTrace() is synchronous: on a miss it starts one background /car_data fetch
// for the lap window (low priority) and returns null until it lands.
// Pure module (no three.js), runs under Node.
import { fetchJson as defaultFetchJson } from '../api.js';

const MAX_LAPS = 6;
const END_PAD_MS = 500;

/**
 * Turn raw /car_data records into a trace. Distance is integrated from speed
 * (km/h) over time with the trapezoid rule, starting at 0 at the first sample.
 * @param {object[]} records raw API records ({date, speed, ...})
 * @param {number} [startMs] samples before this are dropped
 * @returns {{dist: Float32Array, speed: Float32Array, time: Float64Array}}
 */
export function buildTrace(records, startMs = -Infinity) {
  const rows = [];
  for (const r of records || []) {
    const t = typeof r.date === 'number' ? r.date : Date.parse(r.date);
    if (!Number.isFinite(t) || t < startMs || r.speed == null) continue;
    rows.push([t, Number(r.speed)]);
  }
  rows.sort((a, b) => a[0] - b[0]);
  const n = rows.length;
  const time = new Float64Array(n);
  const speed = new Float32Array(n);
  const dist = new Float32Array(n);
  let d = 0;
  for (let i = 0; i < n; i++) {
    time[i] = rows[i][0];
    speed[i] = rows[i][1];
    if (i > 0) d += ((speed[i] + speed[i - 1]) / 2 / 3.6) * ((time[i] - time[i - 1]) / 1000);
    dist[i] = d;
  }
  return { dist, speed, time };
}

export class LapTraceCache {
  /**
   * @param {{fetchJson?: Function, maxLaps?: number}} [o] fetchJson injectable for tests
   */
  constructor({ fetchJson = defaultFetchJson, maxLaps = MAX_LAPS } = {}) {
    this._fetch = fetchJson;
    this._max = maxLaps;
    this._traces = new Map();   // key -> trace (Map insertion order = LRU order)
    this._inFlight = new Map(); // key -> Promise
    this._failed = new Set();   // keys whose fetch errored (not retried)
    this.onLoad = null;         // optional cb(driver, lapNumber) when a trace lands
  }

  /**
   * Trace of a driver's lap, or null while loading / unavailable.
   * @param {object} data SessionData (session.key, getDriverLaps)
   * @param {number} driver
   * @param {number} lapNumber
   * @returns {{dist: Float32Array, speed: Float32Array, time: Float64Array}|null}
   */
  getTrace(data, driver, lapNumber) {
    const key = `${driver}:${lapNumber}`;
    const hit = this._traces.get(key);
    if (hit) {
      // refresh LRU position (cheap: only when not already newest)
      if (this._lastKey !== key) {
        this._traces.delete(key);
        this._traces.set(key, hit);
        this._lastKey = key;
      }
      return hit;
    }
    if (this._inFlight.has(key) || this._failed.has(key)) return null;
    const lap = findLap(data.getDriverLaps(driver), lapNumber);
    if (!lap || lap.date_start == null || lap.date_end == null) return null;
    const start = lap.date_start;
    const end = lap.date_end + END_PAD_MS;
    const p = Promise.resolve()
      .then(() => this._fetch('car_data', {
        session_key: data.session.key,
        driver_number: driver,
        'date>=': new Date(start).toISOString(),
        'date<': new Date(end).toISOString(),
      }, { priority: -1 }))
      .then((records) => {
        this._store(key, buildTrace(records, start));
        if (this.onLoad) this.onLoad(driver, lapNumber);
      })
      .catch((err) => {
        this._failed.add(key);
        console.warn('[lap-trace]', key, err);
      })
      .finally(() => this._inFlight.delete(key));
    this._inFlight.set(key, p);
    return null;
  }

  /** Promise for the in-flight fetch of a lap (tests / tooling), or undefined. */
  pending(driver, lapNumber) {
    return this._inFlight.get(`${driver}:${lapNumber}`);
  }

  get size() { return this._traces.size; }

  _store(key, trace) {
    this._traces.delete(key);
    this._traces.set(key, trace);
    this._lastKey = key;
    while (this._traces.size > this._max) {
      const oldest = this._traces.keys().next().value;
      this._traces.delete(oldest);
    }
  }

  clear() {
    this._traces.clear();
    this._failed.clear();
    this._lastKey = null;
  }
}

function findLap(laps, lapNumber) {
  if (!laps) return null;
  for (let i = 0; i < laps.length; i++) if (laps[i].lap_number === lapNumber) return laps[i];
  return null;
}
