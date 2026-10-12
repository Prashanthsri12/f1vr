// Normalisation and indexing of the small OpenF1 datasets (sessions, drivers,
// laps, stints, pit, race_control, weather, team_radio, position, intervals).
// Pure module: no three.js, runs under Node.
//
// Normalised records keep the OpenF1 field names, with two changes:
// every date field (`date`, `date_start`, `date_end`) becomes ms since the
// epoch (or null), and numeric fields are coerced to numbers (or null).
// Interval gaps stay strings when the API sends strings such as "+1 LAP".

/**
 * Parse an API date string to ms since the epoch; null if missing/invalid.
 * @param {string|number|null|undefined} v
 * @returns {number|null}
 */
export function toMs(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/**
 * Coerce to a finite number, or null.
 * @param {any} v
 * @returns {number|null}
 */
export function num(v) {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * An interval/gap value: a number, null, or a non-numeric string kept as is
 * (e.g. "+1 LAP").
 * @param {any} v
 * @returns {number|string|null}
 */
export function gapValue(v) {
  if (typeof v === 'string') {
    const n = num(v.trim());
    return n === null ? v : n;
  }
  return num(v);
}

const DATE_KEYS = ['date', 'date_start', 'date_end'];

/** Copy a record with date fields converted to ms and the given fields made numeric. */
function normRecord(r, numericKeys) {
  const out = { ...r };
  for (const k of DATE_KEYS) if (k in out) out[k] = toMs(out[k]);
  for (const k of numericKeys) if (k in out) out[k] = num(out[k]);
  return out;
}

/** Sort records by `date` (ms) ascending, records with null dates removed. */
function sortByDate(records) {
  return records.filter((r) => r.date != null).sort((a, b) => a.date - b.date);
}

/** Group an array of records by driver_number into a Map of arrays. */
function groupByDriver(records) {
  const map = new Map();
  for (const r of records) {
    const n = r.driver_number;
    if (n == null) continue;
    let arr = map.get(n);
    if (!arr) map.set(n, (arr = []));
    arr.push(r);
  }
  return map;
}

/**
 * Build a { times: Float64Array, items } series from date-sorted records.
 * @param {object[]} sorted records already sorted by `date` ms
 */
function series(sorted) {
  const times = new Float64Array(sorted.length);
  for (let i = 0; i < sorted.length; i++) times[i] = sorted[i].date;
  return { times, items: sorted };
}

/**
 * Normalise the /sessions record.
 * @param {object|undefined} raw
 * @param {number} sessionKey
 */
export function normaliseSession(raw, sessionKey) {
  const r = raw || {};
  return {
    key: num(r.session_key) ?? sessionKey,
    meetingKey: num(r.meeting_key),
    name: r.session_name ?? null,
    type: r.session_type ?? null,
    circuit: r.circuit_short_name ?? null,
    country: r.country_name ?? null,
    year: num(r.year) ?? (toMs(r.date_start) != null ? new Date(toMs(r.date_start)).getUTCFullYear() : null),
    start: toMs(r.date_start),
    end: toMs(r.date_end),
  };
}

/**
 * Normalise /drivers into the contract shape, de-duplicated and sorted by number.
 * @param {object[]} raw
 */
export function normaliseDrivers(raw) {
  const byNum = new Map();
  for (const r of raw || []) {
    const number = num(r.driver_number);
    if (number == null || byNum.has(number)) continue;
    const colour = typeof r.team_colour === 'string' && r.team_colour
      ? '#' + r.team_colour.replace(/^#/, '').toLowerCase()
      : '#888888';
    byNum.set(number, {
      number,
      acronym: r.name_acronym ?? String(number),
      fullName: r.full_name ?? r.broadcast_name ?? String(number),
      teamName: r.team_name ?? '',
      teamColour: colour,
      headshotUrl: r.headshot_url || null,
    });
  }
  return [...byNum.values()].sort((a, b) => a.number - b.number);
}

const LAP_NUMERIC = ['driver_number', 'lap_number', 'lap_duration', 'duration_sector_1',
  'duration_sector_2', 'duration_sector_3', 'i1_speed', 'i2_speed', 'st_speed'];

/**
 * Index /laps. Each lap gets `date_start` (ms|null) and `date_end`
 * (date_start + lap_duration, ms|null).
 * @param {object[]} raw
 */
export function indexLaps(raw) {
  const laps = (raw || []).map((r) => {
    const l = normRecord(r, LAP_NUMERIC);
    l.is_pit_out_lap = !!l.is_pit_out_lap;
    l.date_end = l.date_start != null && l.lap_duration != null
      ? l.date_start + l.lap_duration * 1000 : null;
    return l;
  }).filter((l) => l.driver_number != null && l.lap_number != null);

  const byDriver = groupByDriver(laps);
  for (const arr of byDriver.values()) arr.sort((a, b) => a.lap_number - b.lap_number);

  let totalLaps = 0;
  let lastLapEnd = null;
  const lapStart = new Map(); // lap_number -> earliest date_start
  for (const l of laps) {
    if (l.lap_number > totalLaps) totalLaps = l.lap_number;
    if (l.date_start != null) {
      const prev = lapStart.get(l.lap_number);
      if (prev === undefined || l.date_start < prev) lapStart.set(l.lap_number, l.date_start);
    }
    const end = l.date_end ?? l.date_start;
    if (end != null && (lastLapEnd === null || end > lastLapEnd)) lastLapEnd = end;
  }

  // Leader finish: earliest end of the final lap (used by the retired heuristic).
  let finishTime = null;
  for (const l of laps) {
    if (l.lap_number === totalLaps && l.date_end != null
      && (finishTime === null || l.date_end < finishTime)) finishTime = l.date_end;
  }
  return { byDriver, totalLaps, lapStart, lastLapEnd, finishTime };
}

/**
 * Index /stints per driver, sorted by lap_start.
 * @param {object[]} raw
 */
export function indexStints(raw) {
  const stints = (raw || []).map((r) => normRecord(r,
    ['driver_number', 'stint_number', 'lap_start', 'lap_end', 'tyre_age_at_start']));
  const byDriver = groupByDriver(stints);
  for (const arr of byDriver.values()) {
    arr.sort((a, b) => (a.lap_start ?? 0) - (b.lap_start ?? 0) || (a.stint_number ?? 0) - (b.stint_number ?? 0));
  }
  return byDriver;
}

/**
 * Generic date-indexed dataset: { all: series, byDriver: Map<n, series> }.
 * @param {object[]} raw
 * @param {string[]} numericKeys
 * @param {(r: object) => void} [fix] extra per-record normalisation
 */
export function indexTimed(raw, numericKeys, fix) {
  const recs = (raw || []).map((r) => {
    const o = normRecord(r, numericKeys);
    if (fix) fix(o);
    return o;
  });
  const sorted = sortByDate(recs);
  const byDriver = new Map();
  for (const [n, arr] of groupByDriver(sorted)) byDriver.set(n, series(arr));
  return { all: series(sorted), byDriver };
}

/** /position: per driver series of { date, position }. */
export function indexPosition(raw) {
  return indexTimed(raw, ['driver_number', 'position', 'meeting_key', 'session_key']);
}

/** /intervals: per driver series; gap_to_leader / interval may be strings. */
export function indexIntervals(raw) {
  return indexTimed(raw, ['driver_number', 'meeting_key', 'session_key'], (o) => {
    o.gap_to_leader = gapValue(o.gap_to_leader);
    o.interval = gapValue(o.interval);
  });
}

/** /pit: per driver series. */
export function indexPit(raw) {
  return indexTimed(raw, ['driver_number', 'lap_number', 'lane_duration', 'stop_duration', 'pit_duration']);
}

/** /race_control: global series (driver_number may be null). */
export function indexRaceControl(raw) {
  return indexTimed(raw, ['driver_number', 'lap_number', 'sector']);
}

/** /weather: global series. */
export function indexWeather(raw) {
  return indexTimed(raw, ['air_temperature', 'track_temperature', 'humidity', 'pressure',
    'rainfall', 'wind_speed', 'wind_direction']);
}

/** /team_radio: per driver series. */
export function indexTeamRadio(raw) {
  return indexTimed(raw, ['driver_number']);
}

/**
 * The latest lap of a driver whose date_start <= t (null if none).
 * Laps with a null date_start count as started once a later lap has started,
 * or when the previous lap has ended.
 * @param {object[]|undefined} laps sorted by lap_number
 * @param {number} t
 */
export function currentLap(laps, t) {
  if (!laps) return null;
  for (let i = laps.length - 1; i >= 0; i--) {
    const l = laps[i];
    if (l.date_start != null) {
      if (l.date_start <= t) return l;
    } else if (i > 0 && laps[i - 1].date_end != null && laps[i - 1].date_end <= t) {
      return l;
    }
  }
  return null;
}

/**
 * Best and last completed lap durations (seconds) at t.
 * @param {object[]|undefined} laps
 * @param {number} t
 * @returns {{best: number|null, last: number|null}}
 */
export function completedLapTimes(laps, t) {
  let best = null;
  let last = null;
  let lastEnd = -Infinity;
  if (laps) {
    for (const l of laps) {
      if (l.date_end == null || l.date_end > t) continue;
      if (best === null || l.lap_duration < best) best = l.lap_duration;
      if (l.date_end > lastEnd) { lastEnd = l.date_end; last = l.lap_duration; }
    }
  }
  return { best, last };
}

/**
 * Compound and tyre age for a driver on lap `lap`.
 * tyreAge = tyre_age_at_start + (lap - lap_start).
 * @param {object[]|undefined} stints sorted by lap_start
 * @param {number} lap current lap (>= 1)
 * @returns {{compound: string|null, tyreAge: number|null}}
 */
export function tyreOnLap(stints, lap) {
  if (!stints || stints.length === 0) return { compound: null, tyreAge: null };
  let s = null;
  for (const st of stints) {
    if (st.lap_start != null && st.lap_start <= lap) s = st; // latest stint started by this lap
  }
  if (!s) s = stints[0];
  const start = s.lap_start ?? lap;
  const age = (s.tyre_age_at_start ?? 0) + Math.max(0, lap - start);
  return { compound: s.compound ?? null, tyreAge: age };
}

/**
 * Item of a { times, items } series at or before t, or null.
 * @param {{times: Float64Array, items: object[]}|undefined} s
 * @param {number} t
 * @param {(times: ArrayLike<number>, t: number) => number} indexAtOrBefore
 */
export function itemAt(s, t, indexAtOrBefore) {
  if (!s) return null;
  const i = indexAtOrBefore(s.times, t);
  return i >= 0 ? s.items[i] : null;
}

const OK_FLAGS = new Set(['GREEN', 'CLEAR', 'BLUE']);

/** True if no race-control message in [start, end] has a flag other than GREEN/CLEAR/BLUE or is a SafetyCar message. */
function isGreenWindow(rc, start, end) {
  const { times, items } = rc;
  let i = 0;
  while (i < times.length && times[i] < start) i++;
  for (; i < times.length && times[i] <= end; i++) {
    const r = items[i];
    if (r.flag && !OK_FLAGS.has(r.flag)) return false;
    if (r.category === 'SafetyCar') return false;
  }
  return true;
}

/**
 * Choose the lap for the track outline: the driver with the most laps, then
 * their fastest lap that has a duration, is not lap 1, not a pit-out lap, and
 * is not a pit in-lap (lap_number or lap_number+1 in that driver's pit list;
 * OpenF1 pit.lap_number is the in-lap). Laps without non-green flags or
 * safety car messages in their window are preferred.
 * @param {Map<number, object[]>} lapsByDriver from indexLaps
 * @param {Map<number, {items: object[]}>} pitByDriver from indexPit
 * @param {{times: Float64Array, items: object[]}} rc race control series
 * @returns {{driverNumber: number, lapNumber: number, start: number, end: number}|null}
 */
export function pickReferenceLap(lapsByDriver, pitByDriver, rc) {
  let driver = null;
  let most = -1;
  for (const [n, laps] of lapsByDriver) {
    if (laps.length > most) { most = laps.length; driver = n; }
  }
  if (driver == null) return null;
  const pitLaps = new Set();
  const pit = pitByDriver.get(driver);
  if (pit) for (const p of pit.items) if (p.lap_number != null) pitLaps.add(p.lap_number);
  const valid = lapsByDriver.get(driver).filter((l) => l.lap_duration > 0 && l.date_start != null);
  const cand = valid.filter((l) => !l.is_pit_out_lap && l.lap_number > 1
    && !pitLaps.has(l.lap_number) && !pitLaps.has(l.lap_number + 1));
  const clean = cand.filter((l) => isGreenWindow(rc, l.date_start, l.date_end));
  const pool = clean.length ? clean : cand.length ? cand : valid;
  if (!pool.length) return null;
  let best = pool[0];
  for (const l of pool) if (l.lap_duration < best.lap_duration) best = l;
  return { driverNumber: driver, lapNumber: best.lap_number, start: best.date_start, end: best.date_end };
}

/**
 * Raw /location records -> time-sorted {x, y, z} points with (0,0,0) removed.
 * @param {object[]} raw
 */
export function lapPoints(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((r) => ({ t: toMs(r.date), x: Number(r.x), y: Number(r.y), z: Number(r.z) }))
    .filter((p) => p.t != null && Number.isFinite(p.x) && !(p.x === 0 && p.y === 0 && p.z === 0))
    .sort((a, b) => a.t - b.t)
    .map(({ x, y, z }) => ({ x, y, z }));
}
