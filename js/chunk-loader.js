// Time-chunked storage for the large OpenF1 streams (location, car_data).
// One ChunkStore holds the chunks of one stream: location for all drivers, or
// car_data for one driver. Chunk k covers [origin + k*CHUNK_MS, +CHUNK_MS).
// Pure module: no three.js, runs under Node.

import { retimeSeries } from './retime.js';
import { bracket } from './interp.js';

export const CHUNK_MS = 60000;
/** Chunks that end more than this far behind the playhead are evicted. */
export const BEHIND_MS = 120000;
/** Chunks starting more than this many chunks ahead are evicted (after a seek back). */
export const FAR_AHEAD_CHUNKS = 10;
/** With no neighbouring chunk loaded, hold the first/last sample for up to this long. */
export const EDGE_HOLD_MS = 1000;

export const LOCATION_FIELDS = [
  ['x', 'x', Float32Array], ['y', 'y', Float32Array], ['z', 'z', Float32Array],
];
export const CAR_DATA_FIELDS = [
  ['speed', 'speed', Float32Array], ['rpm', 'rpm', Float32Array], ['gear', 'n_gear', Uint8Array],
  ['throttle', 'throttle', Float32Array], ['brake', 'brake', Uint8Array], ['drs', 'drs', Uint8Array],
];

/**
 * Group raw samples by driver into typed-array series sorted by time:
 * Map<driverNumber, { times: Float64Array, [field]: TypedArray }>.
 * Samples without a valid date are dropped; missing numbers become 0.
 * @param {object[]} raw
 * @param {Array<[string, string, Function]>} fields [outName, apiName, ArrayType]
 */
export function parseSeries(raw, fields) {
  const groups = new Map();
  for (const r of raw || []) {
    const n = r.driver_number;
    const t = typeof r.date === 'number' ? r.date : Date.parse(r.date);
    if (n == null || Number.isNaN(t)) continue;
    let g = groups.get(n);
    if (!g) groups.set(n, (g = []));
    g.push({ t, r });
  }
  const out = new Map();
  for (const [n, g] of groups) {
    let sorted = true;
    for (let i = 1; i < g.length; i++) if (g[i].t < g[i - 1].t) { sorted = false; break; }
    if (!sorted) g.sort((a, b) => a.t - b.t);
    const s = { times: new Float64Array(g.length) };
    for (const [name, , Type] of fields) s[name] = new Type(g.length);
    for (let i = 0; i < g.length; i++) {
      s.times[i] = g[i].t;
      for (const [name, api] of fields) {
        const v = Number(g[i].r[api]);
        s[name][i] = Number.isFinite(v) ? v : 0;
      }
    }
    if (s.x && s.y && s.z) retimeSeries(s.times, s.x, s.y, s.z); // location: de-jitter timestamps
    out.set(n, s);
  }
  return out;
}

/**
 * Chunks of one stream with request de-duplication, eviction and
 * cross-chunk bracketing.
 */
export class ChunkStore {
  /**
   * @param {object} o
   * @param {number} o.origin ms; chunk 0 starts here
   * @param {number} o.maxIndex last valid chunk index
   * @param {(k: number, start: number, end: number, priority: number) => Promise<object[]>} o.fetchChunk
   * @param {Array<[string, string, Function]>} o.fields
   * @param {(ev: {type: 'start'|'done'|'error', k: number, error?: Error, series?: Map}) => void} [o.onEvent]
   */
  constructor({ origin, maxIndex, fetchChunk, fields, onEvent }) {
    this.origin = origin;
    this.maxIndex = maxIndex;
    this.fetchChunk = fetchChunk;
    this.fields = fields;
    this.onEvent = onEvent || (() => {});
    /** @type {Map<number, {state: 'loading'|'loaded', series: Map|null}>} */
    this.chunks = new Map();
    this.inFlight = 0;
    this.disposed = false;
    this._br = { i0: 0, i1: 0, f: 0 };
  }

  /** Chunk index for time t (may be out of range). */
  indexOf(t) {
    return Math.floor((t - this.origin) / CHUNK_MS);
  }

  /** True if chunk k is loaded. */
  isLoaded(k) {
    const c = this.chunks.get(k);
    return !!c && c.state === 'loaded';
  }

  /**
   * Request chunk k unless it is loaded, loading, or out of range.
   * @returns {boolean} true if a request was started
   */
  request(k, priority = 0) {
    if (this.disposed || k < 0 || k > this.maxIndex || this.chunks.has(k)) return false;
    const entry = { state: 'loading', series: null };
    this.chunks.set(k, entry);
    this.inFlight++;
    const start = this.origin + k * CHUNK_MS;
    this.onEvent({ type: 'start', k });
    let p;
    try {
      p = Promise.resolve(this.fetchChunk(k, start, start + CHUNK_MS, priority)); // enqueue synchronously
    } catch (err) {
      p = Promise.reject(err);
    }
    p.then((raw) => {
        this.inFlight--;
        if (this.disposed || this.chunks.get(k) !== entry) return;
        entry.series = parseSeries(raw, this.fields);
        entry.state = 'loaded';
        this.onEvent({ type: 'done', k, series: entry.series });
      }, (error) => {
        this.inFlight--;
        if (this.disposed) return;
        if (this.chunks.get(k) === entry) this.chunks.delete(k); // allow a retry later
        this.onEvent({ type: 'error', k, error });
      });
    return true;
  }

  /**
   * Drop chunks that end more than BEHIND_MS before t, or start more than
   * FAR_AHEAD_CHUNKS chunks after t's chunk. In-flight chunks are dropped too
   * (their result is discarded on arrival).
   */
  evict(t) {
    const k0 = this.indexOf(t);
    for (const k of this.chunks.keys()) {
      const end = this.origin + (k + 1) * CHUNK_MS;
      if (end < t - BEHIND_MS || k > k0 + FAR_AHEAD_CHUNKS) this.chunks.delete(k);
    }
  }

  _series(k, n) {
    const c = this.chunks.get(k);
    if (!c || c.state !== 'loaded') return null;
    const s = c.series.get(n);
    return s && s.times.length ? s : null;
  }

  /**
   * Find the two samples of driver n bracketing t, across chunk boundaries.
   * Fills out {a, ai, b, bi, f} (a/b are series objects). Returns false if
   * t's chunk is not loaded or there is nothing to bracket.
   * @param {number} n driver number
   * @param {number} t ms
   * @param {{a: object, ai: number, b: object, bi: number, f: number}} out
   */
  sample(n, t, out) {
    const k = this.indexOf(t);
    const c = this.chunks.get(k);
    if (!c || c.state !== 'loaded') return false;
    const s = c.series.get(n);
    if (!s || s.times.length === 0) return false;
    const times = s.times;
    const last = times.length - 1;
    if (bracket(times, t, this._br)) {
      out.a = s; out.ai = this._br.i0; out.b = s; out.bi = this._br.i1; out.f = this._br.f;
      return true;
    }
    if (t < times[0]) {
      const p = this._series(k - 1, n);
      if (p) {
        const pi = p.times.length - 1;
        out.a = p; out.ai = pi; out.b = s; out.bi = 0;
        out.f = (t - p.times[pi]) / (times[0] - p.times[pi]);
        return true;
      }
      if (times[0] - t > EDGE_HOLD_MS) return false;
      out.a = s; out.ai = 0; out.b = s; out.bi = 0; out.f = 0;
      return true;
    }
    // t after the last sample of this chunk
    const nx = this._series(k + 1, n);
    if (nx) {
      out.a = s; out.ai = last; out.b = nx; out.bi = 0;
      out.f = (t - times[last]) / (nx.times[0] - times[last]);
      return true;
    }
    if (t - times[last] > EDGE_HOLD_MS) return false;
    out.a = s; out.ai = last; out.b = s; out.bi = last; out.f = 0;
    return true;
  }

  /** Drop everything; pending results are discarded. */
  dispose() {
    this.disposed = true;
    this.chunks.clear();
  }
}
