// Historical session data source: loads the small OpenF1 datasets in full,
// streams location (all drivers) and car_data (selected driver) in 60 s chunks
// around the playhead, and answers time queries. See plan/CONTRACTS.md.
// Pure module: no three.js, runs under Node.

import { indexAtOrBefore, lerp } from './interp.js';
import { ChunkStore, CHUNK_MS, LOCATION_FIELDS, CAR_DATA_FIELDS } from './chunk-loader.js';
import {
  normaliseSession, normaliseDrivers, indexLaps, indexStints, indexPosition,
  indexIntervals, indexPit, indexRaceControl, indexWeather, indexTeamRadio,
  currentLap, completedLapTimes, tyreOnLap, itemAt, pickReferenceLap, lapPoints,
} from './session-index.js';

export const SESSION_TYPES_WITH_INTERVALS = ['Race', 'Sprint'];

/** Bracketing samples further apart than this hide the car. */
const MAX_GAP_MS = 5000;
const SMALL = ['drivers', 'laps', 'stints', 'pit', 'race_control', 'weather', 'team_radio', 'position'];

const iso = (ms) => new Date(ms).toISOString();

export class SessionData {
  /**
   * Load a session's small datasets and return a ready SessionData.
   * @param {number} sessionKey
   * @param {object} [opts]
   * @param {(p: {step: string, done: number, total: number}) => void} [opts.onProgress]
   * @param {(endpoint: string, params?: object, opts?: {priority?: number}) => Promise<any[]>} [opts.fetchJson]
   *   defaults to api.js fetchJson (injectable for tests / a future live source)
   * @param {number} [opts.retryDelayMs=5000] wait before re-requesting a failed chunk
   * @returns {Promise<SessionData>}
   */
  static async load(sessionKey, { onProgress, fetchJson, retryDelayMs = 5000 } = {}) {
    const fj = fetchJson || (await import('./api.js')).fetchJson;
    const progress = onProgress || (() => {});
    const sessions = await fj('sessions', { session_key: sessionKey });
    const session = normaliseSession(Array.isArray(sessions) ? sessions[0] : undefined, sessionKey);
    const raceLike = SESSION_TYPES_WITH_INTERVALS.includes(session.name)
      || SESSION_TYPES_WITH_INTERVALS.includes(session.type);
    const steps = raceLike ? [...SMALL, 'intervals'] : SMALL;
    const total = steps.length + 1;
    let done = 1;
    progress({ step: 'sessions', done, total });
    const results = await Promise.all(steps.map((step) =>
      fj(step, { session_key: sessionKey }).then((r) => {
        progress({ step, done: ++done, total });
        return Array.isArray(r) ? r : [];
      })));
    const raw = {};
    steps.forEach((s, i) => { raw[s] = results[i]; });
    return new SessionData(session, raw, { fetchJson: fj, raceLike, retryDelayMs });
  }

  /**
   * Build from already-fetched raw API arrays (used by load()).
   * @param {object} session normalised session
   * @param {Record<string, object[]>} raw raw arrays keyed by endpoint
   * @param {{fetchJson: Function, raceLike: boolean, retryDelayMs?: number}} opts
   */
  constructor(session, raw, { fetchJson, raceLike, retryDelayMs = 5000 }) {
    this._fetch = fetchJson;
    this._retryDelay = retryDelayMs;
    this.session = session;
    this.drivers = normaliseDrivers(raw.drivers);
    this.driverByNumber = new Map(this.drivers.map((d) => [d.number, d]));

    this._laps = indexLaps(raw.laps);
    this._stints = indexStints(raw.stints);
    this._pit = indexPit(raw.pit);
    this._rc = indexRaceControl(raw.race_control);
    this._weather = indexWeather(raw.weather);
    this._radio = indexTeamRadio(raw.team_radio);
    this._position = indexPosition(raw.position);
    this._intervals = indexIntervals(raw.intervals || []);
    this.hasIntervals = !!raceLike && this._intervals.all.items.length > 0;
    this._raceLike = !!raceLike;

    this.totalLaps = this._laps.totalLaps;
    const lap1 = this._laps.lapStart.get(1);
    this.raceStartTime = lap1 ?? session.start ?? 0;
    const posTimes = this._position.all.times;
    this.dataStartTime = posTimes.length ? posTimes[0] : (session.start ?? this.raceStartTime);
    this.dataEndTime = Math.max(session.end ?? -Infinity, this._laps.lastLapEnd ?? -Infinity,
      this.dataStartTime);
    // DRS support: race control "Drs" messages (e.g. "DRS ENABLED") prove it up front.
    // Otherwise null until car_data shows a code 8/10/12/14. A selected leader may never
    // show one, so sample-based detection alone can't be trusted.
    this.hasDrs = this._rc.all.items.some((m) => m.category === 'Drs') ? true : null;

    // Chunk grid origin: dataStartTime floored to a whole second (clean, stable URLs).
    this._origin = Math.floor(this.dataStartTime / 1000) * 1000;
    this._maxChunk = Math.floor((this.dataEndTime - this._origin) / CHUNK_MS);
    this._loc = this._makeStore('location', null);
    /** @type {Map<number, ChunkStore>} car_data stores per driver */
    this._car = new Map();
    this._selected = null;
    this._t = null;
    this._speed = 1;
    this._lastK = null; this._lastAhead = -1; this._lastSel = null;
    this._retryAt = 0;
    this._statusCbs = new Set();
    this._lastError = undefined;
    this._s = { a: null, ai: 0, b: null, bi: 0, f: 0 };
    this._tmp = { x: 0, y: 0, z: 0 };
    this._refLap = null;
    this._disposed = false;
  }

  _makeStore(endpoint, driverNumber) {
    const fields = endpoint === 'location' ? LOCATION_FIELDS : CAR_DATA_FIELDS;
    return new ChunkStore({
      origin: this._origin,
      maxIndex: this._maxChunk,
      fields,
      fetchChunk: (k, start, end, priority) => {
        const params = { session_key: this.session.key };
        if (driverNumber != null) params.driver_number = driverNumber;
        params['date>='] = iso(start);
        params['date<'] = iso(end);
        return this._fetch(endpoint, params, { priority });
      },
      onEvent: (ev) => this._onChunkEvent(endpoint, ev),
    });
  }

  _onChunkEvent(endpoint, ev) {
    if (this._disposed) return;
    if (ev.type === 'error') {
      this._lastError = ev.error;
      this._retryAt = Date.now() + this._retryDelay;
    } else if (ev.type === 'done') {
      this._lastError = undefined;
      if (endpoint === 'car_data' && this.hasDrs !== true) this._checkDrs(ev.series);
    }
    this._emitStatus();
  }

  _checkDrs(series) {
    for (const s of series.values()) {
      if (s.times.length && this.hasDrs === null) this.hasDrs = false;
      const d = s.drs;
      for (let i = 0; i < d.length; i++) {
        const v = d[i];
        if (v === 8 || v === 10 || v === 12 || v === 14) { this.hasDrs = true; return; }
      }
    }
  }

  _pending() {
    let n = this._loc.inFlight;
    for (const s of this._car.values()) n += s.inFlight;
    return n;
  }

  _emitStatus() {
    const pending = this._pending();
    const st = { loading: pending > 0, pending };
    if (this._lastError) st.error = this._lastError;
    for (const cb of this._statusCbs) cb(st);
  }

  _carStore(n) {
    let s = this._car.get(n);
    if (!s) this._car.set(n, (s = this._makeStore('car_data', n)));
    return s;
  }

  _clamp(t) {
    return t < this.dataStartTime ? this.dataStartTime : t > this.dataEndTime ? this.dataEndTime : t;
  }

  // --- chunk loading -------------------------------------------------------

  /**
   * Schedule location chunks (all drivers) and selected-driver car_data
   * chunks: the current chunk plus the next 2 (6 when speed >= 5). Evicts
   * chunks ending more than 2 min behind. Cheap when nothing changed, so it
   * can be called every frame.
   * @param {number} t playhead ms
   * @param {number} [speed=1]
   */
  setPlayhead(t, speed = 1) {
    if (this._disposed) return;
    this._t = t;
    this._speed = speed;
    const tc = this._clamp(t);
    const k0 = this._loc.indexOf(tc);
    const ahead = speed >= 5 ? 6 : 2;
    const retry = this._retryAt !== 0 && Date.now() >= this._retryAt;
    if (k0 === this._lastK && ahead === this._lastAhead && this._selected === this._lastSel && !retry) return;
    this._lastK = k0; this._lastAhead = ahead; this._lastSel = this._selected;
    if (retry) this._retryAt = 0;

    this._loc.evict(tc);
    for (const s of this._car.values()) s.evict(tc);
    const car = this._selected != null ? this._carStore(this._selected) : null;
    let started = false;
    for (let i = 0; i <= ahead; i++) {
      const p = i === 0 ? 1 : 0;
      started = this._loc.request(k0 + i, p) || started;
      if (car) started = car.request(k0 + i, p) || started;
    }
    if (started) this._emitStatus();
  }

  /**
   * Select the driver whose car_data is streamed; their chunk for the current
   * playhead is requested at high priority.
   * @param {number|null} number
   */
  setSelectedDriver(number) {
    if (this._disposed) return;
    this._selected = number;
    if (number == null || this._t == null) return;
    const tc = this._clamp(this._t);
    const store = this._carStore(number);
    if (store.request(store.indexOf(tc), 2)) this._emitStatus();
    this.setPlayhead(this._t, this._speed);
  }

  /**
   * True if the location chunk covering t is loaded (always true outside the data range).
   * @param {number} t
   */
  isReady(t) {
    if (t > this.dataEndTime) return true;
    const k = this._loc.indexOf(this._clamp(t));
    if (k < 0 || k > this._maxChunk) return true;
    return this._loc.isLoaded(k);
  }

  /**
   * Subscribe to loading status changes.
   * @param {(s: {loading: boolean, pending: number, error?: Error}) => void} cb
   * @returns {() => void} unsubscribe
   */
  onStatus(cb) {
    this._statusCbs.add(cb);
    return () => this._statusCbs.delete(cb);
  }

  // --- queries -------------------------------------------------------------

  /**
   * Interpolated raw position of a car. Hidden (false) when its chunk is not
   * loaded, there are no samples, the bracketing samples are > 5 s apart, or
   * either is (0,0,0).
   * @param {number} driverNumber
   * @param {number} t
   * @param {{x: number, y: number, z: number}} out
   * @returns {boolean} visible
   */
  getCarPositionAt(driverNumber, t, out) {
    const s = this._s;
    if (!this._loc.sample(driverNumber, t, s)) return false;
    const a = s.a; const b = s.b; const ai = s.ai; const bi = s.bi;
    if (b.times[bi] - a.times[ai] > MAX_GAP_MS) return false;
    const ax = a.x[ai]; const ay = a.y[ai]; const az = a.z[ai];
    const bx = b.x[bi]; const by = b.y[bi]; const bz = b.z[bi];
    if ((ax === 0 && ay === 0 && az === 0) || (bx === 0 && by === 0 && bz === 0)) return false;
    out.x = lerp(ax, bx, s.f);
    out.y = lerp(ay, by, s.f);
    out.z = lerp(az, bz, s.f);
    return true;
  }

  /**
   * Positions of all drivers, in `drivers` order. Entries are created once
   * and reused on later calls.
   * @param {number} t
   * @param {Array<{number: number, x: number, y: number, z: number, visible: boolean}>} outArray
   */
  getCarsAt(t, outArray) {
    const ds = this.drivers;
    for (let i = 0; i < ds.length; i++) {
      let e = outArray[i];
      if (!e) outArray[i] = e = { number: 0, x: 0, y: 0, z: 0, visible: false };
      e.number = ds[i].number;
      e.visible = this.getCarPositionAt(e.number, t, e);
    }
    return outArray;
  }

  /**
   * Telemetry of a driver at t (speed/rpm/throttle interpolated; gear, brake
   * and drs from the nearest earlier sample).
   * @param {number} driverNumber
   * @param {number} t
   * @param {{speed: number, rpm: number, gear: number, throttle: number, brake: number, drs: number}} out
   * @returns {boolean} false if that driver's car_data for t is not loaded
   */
  getTelemetryAt(driverNumber, t, out) {
    const store = this._car.get(driverNumber);
    const s = this._s;
    if (!store || !store.sample(driverNumber, t, s)) return false;
    const a = s.a; const b = s.b; const ai = s.ai; const bi = s.bi; const f = s.f;
    out.speed = lerp(a.speed[ai], b.speed[bi], f);
    out.rpm = lerp(a.rpm[ai], b.rpm[bi], f);
    out.throttle = lerp(a.throttle[ai], b.throttle[bi], f);
    out.gear = a.gear[ai];
    out.brake = a.brake[ai];
    out.drs = a.drs[ai];
    return true;
  }

  /**
   * Race position of a driver at t (latest /position record at or before t).
   * @returns {number|null}
   */
  getPositionAt(driverNumber, t) {
    const r = itemAt(this._position.byDriver.get(driverNumber), t, indexAtOrBefore);
    return r ? r.position : null;
  }

  /**
   * Leaderboard at t, sorted by position (drivers without a position last, by number).
   * gapToLeader/interval are numbers (s), strings like "+1 LAP", or null
   * (always null outside race/sprint). bestLap/lastLap are seconds.
   * retired (race/sprint only, heuristic): the car is not visible at t, the
   * driver's final recorded lap ended > 30 s ago, and it ended before the
   * leader finished the race (so lapped finishers are not marked).
   * @param {number} t
   */
  getLeaderboardAt(t) {
    const rows = [];
    const finish = this._laps.finishTime;
    for (const d of this.drivers) {
      const n = d.number;
      const laps = this._laps.byDriver.get(n);
      const cur = currentLap(laps, t);
      const lapNumber = cur ? cur.lap_number : 0;
      const iv = this.hasIntervals ? itemAt(this._intervals.byDriver.get(n), t, indexAtOrBefore) : null;
      const tyre = tyreOnLap(this._stints.get(n), Math.max(1, lapNumber));
      const pit = this._pit.byDriver.get(n);
      const { best, last } = completedLapTimes(laps, t);
      let retired = false;
      if (this._raceLike && laps && laps.length) {
        const fl = laps[laps.length - 1];
        const end = fl.date_end ?? fl.date_start;
        retired = end != null && t > end + 30000 && (finish == null || end < finish)
          && fl.lap_number < this.totalLaps && !this.getCarPositionAt(n, t, this._tmp);
      }
      rows.push({
        driverNumber: n,
        position: this.getPositionAt(n, t),
        gapToLeader: iv ? iv.gap_to_leader : null,
        interval: iv ? iv.interval : null,
        compound: tyre.compound,
        tyreAge: tyre.tyreAge,
        pitStops: pit ? indexAtOrBefore(pit.times, t) + 1 : 0,
        lapNumber,
        bestLap: best,
        lastLap: last,
        retired,
      });
    }
    rows.sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9) || a.driverNumber - b.driverNumber);
    return rows;
  }

  /**
   * Current lap of the leader (the highest lap started by any driver),
   * clamped to 1..totalLaps; 0 before the race start.
   * @param {number} t
   */
  getLeaderLapAt(t) {
    if (t < this.raceStartTime) return 0;
    let max = 0;
    for (const laps of this._laps.byDriver.values()) {
      const l = currentLap(laps, t);
      if (l && l.lap_number > max) max = l.lap_number;
    }
    return Math.min(Math.max(max, 1), Math.max(this.totalLaps, 1));
  }

  /**
   * Earliest date_start (ms) of a lap among all drivers, or null.
   * @param {number} lapNumber
   */
  getLapStartTime(lapNumber) {
    return this._laps.lapStart.get(lapNumber) ?? null;
  }

  /** Latest weather record at or before t (API field names, date in ms), or null. */
  getWeatherAt(t) {
    return itemAt(this._weather.all, t, indexAtOrBefore);
  }

  /** Last n race control messages at or before t, newest first. */
  getRaceControlAt(t, n = 5) {
    const { times, items } = this._rc.all;
    const out = [];
    for (let i = indexAtOrBefore(times, t); i >= 0 && out.length < n; i--) out.push(items[i]);
    return out;
  }

  /** Team radio records of a driver at or before t, oldest first. */
  getTeamRadioUpTo(driverNumber, t) {
    const s = this._radio.byDriver.get(driverNumber);
    if (!s) return [];
    return s.items.slice(0, indexAtOrBefore(s.times, t) + 1);
  }

  /** Extra (not in the contract): a driver's laps sorted by lap_number (date fields in ms). */
  getDriverLaps(driverNumber) {
    return this._laps.byDriver.get(driverNumber) || [];
  }

  /** Extra (not in the contract): a driver's stints sorted by lap_start. */
  getDriverStints(driverNumber) {
    return this._stints.get(driverNumber) || [];
  }

  /** The lap chosen for the track outline (no fetch), or null. See getReferenceLap. */
  pickReferenceLap() {
    return pickReferenceLap(this._laps.byDriver, this._pit.byDriver, this._rc.all);
  }

  /**
   * Location points of one clean lap for building the track outline.
   * @returns {Promise<{driverNumber: number, lapNumber: number, start: number, end: number, points: Array<{x: number, y: number, z: number}>}|null>}
   */
  async getReferenceLap() {
    if (!this._refLap) {
      this._refLap = (async () => {
        const ref = this.pickReferenceLap();
        if (!ref) return null;
        const raw = await this._fetch('location', {
          session_key: this.session.key,
          driver_number: ref.driverNumber,
          'date>=': iso(ref.start),
          'date<': iso(ref.end + 500),
        }, { priority: 2 });
        return { ...ref, points: lapPoints(raw) };
      })();
      this._refLap.catch(() => { this._refLap = null; }); // allow a retry after an error
    }
    return this._refLap;
  }

  /** Stop loading and release all data. */
  dispose() {
    this._disposed = true;
    this._loc.dispose();
    for (const s of this._car.values()) s.dispose();
    this._car.clear();
    this._statusCbs.clear();
  }
}
