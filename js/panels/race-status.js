// Track status (green / yellow / SC / VSC / red / chequered) derived from race_control.
//
// Real OpenF1 semantics (checked against 2023 Australia, session 7787, and 2024 Bahrain, 9472):
// - SafetyCar category: "SAFETY CAR DEPLOYED", "SAFETY CAR IN THIS LAP",
//   "VIRTUAL SAFETY CAR DEPLOYED", "VIRTUAL SAFETY CAR ENDING". Neither ends with a
//   SafetyCar message: the end is a Flag CLEAR with scope Track ("TRACK CLEAR").
// - Flag scope Track: GREEN ("GREEN LIGHT - PIT EXIT OPEN"), CLEAR ("TRACK CLEAR"),
//   RED ("RED FLAG"), CHEQUERED ("CHEQUERED FLAG"). A RED can follow the chequered flag
//   after the race; it is ignored until the next GREEN / SESSION STARTED.
// - Flag scope Sector: YELLOW / DOUBLE YELLOW "IN TRACK SECTOR n" until CLEAR in that sector.
// No three.js import: pure, unit-tested under node.

// Same values as THEME in panel-base.js (not imported: panel-base pulls in three).
const COLOURS = {
  GREEN: '#2ee67a', YELLOW: '#ffd21f', SC: '#ff8a1f', VSC: '#ff8a1f',
  RED: '#ff3b3b', CHEQUERED: '#f2f2f2',
};

function result(status, label) {
  return Object.freeze({ status, label, colour: COLOURS[status] });
}
const R = {
  GREEN: result('GREEN', 'GREEN'),
  YELLOW: result('YELLOW', 'YELLOW'),
  DYELLOW: result('YELLOW', 'DOUBLE YELLOW'),
  SC: result('SC', 'SAFETY CAR'),
  SC_END: result('SC', 'SC ENDING'),
  VSC: result('VSC', 'VSC'),
  VSC_END: result('VSC', 'VSC ENDING'),
  RED: result('RED', 'RED FLAG'),
  CHEQUERED: result('CHEQUERED', 'CHEQUERED'),
};
export const TRACK_STATUS = R;

/** Mutable replay state. */
function initialState() {
  return { chequered: false, red: false, sc: null, yellows: new Map() };
}

/** Apply one race control message to the replay state. */
function apply(s, m) {
  const cat = m.category;
  const flag = m.flag;
  const msg = (m.message || '').toUpperCase();
  if (cat === 'SessionStatus') {
    if (msg.includes('STARTED') || msg.includes('RESUMED')) { s.chequered = false; s.red = false; }
    return;
  }
  if (cat === 'SafetyCar') {
    if (s.chequered) return;
    const virtual = msg.includes('VIRTUAL') || /\bVSC\b/.test(msg);
    if (msg.includes('DEPLOYED')) s.sc = virtual ? 'VSC' : 'SC';
    else if (msg.includes('ENDING') || msg.includes('IN THIS LAP')) s.sc = virtual ? 'VSC_END' : (s.sc === 'VSC' ? 'VSC_END' : 'SC_END');
    return;
  }
  if (cat !== 'Flag' || !flag) return;
  const scope = m.scope;
  if (scope === 'Track' || (scope == null && m.sector == null && m.driver_number == null)) {
    if (flag === 'GREEN') { s.chequered = false; s.red = false; s.sc = null; s.yellows.clear(); }
    else if (flag === 'CLEAR') { s.red = false; s.sc = null; s.yellows.clear(); }
    else if (flag === 'RED') { if (!s.chequered) s.red = true; }
    else if (flag === 'CHEQUERED') { s.chequered = true; s.red = false; s.sc = null; s.yellows.clear(); }
    else if (flag === 'YELLOW' || flag === 'DOUBLE YELLOW') s.yellows.set('track', flag);
  } else if (scope === 'Sector') {
    const key = m.sector ?? 'unknown';
    if (flag === 'CLEAR' || flag === 'GREEN') s.yellows.delete(key);
    else if (flag === 'YELLOW' || flag === 'DOUBLE YELLOW') s.yellows.set(key, flag);
  }
}

/** Status for the current replay state (priority: chequered > red > SC > VSC > yellow > green). */
function evaluate(s) {
  if (s.chequered) return R.CHEQUERED;
  if (s.red) return R.RED;
  if (s.sc) return R[s.sc];
  if (s.yellows.size) {
    for (const f of s.yellows.values()) if (f === 'DOUBLE YELLOW') return R.DYELLOW;
    return R.YELLOW;
  }
  return R.GREEN;
}

/**
 * Replay every message once and remember the status after each one.
 * @returns {Map<object, object>} message object -> status result
 */
function buildTimeline(data) {
  const all = data.getRaceControlAt(Infinity, Infinity) || []; // newest first
  const map = new Map();
  const s = initialState();
  for (let i = all.length - 1; i >= 0; i--) {
    apply(s, all[i]);
    map.set(all[i], evaluate(s));
  }
  return map;
}

const _cache = new WeakMap(); // data -> { map, lastMsg, last }

/**
 * Track status at time t.
 * Cost per call: one getRaceControlAt(t, 1) plus a Map lookup; the full replay runs once
 * per data object (and again only if a message appears that wasn't seen, e.g. a live source).
 * @param {object} data SessionData (uses getRaceControlAt)
 * @param {number} t ms
 * @returns {{status: 'GREEN'|'YELLOW'|'SC'|'VSC'|'RED'|'CHEQUERED', label: string, colour: string}}
 */
export function trackStatusAt(data, t) {
  const newest = data.getRaceControlAt(t, 1)[0];
  if (!newest) return R.GREEN;
  let c = _cache.get(data);
  if (c && c.lastMsg === newest) return c.last;
  if (!c) { c = { map: buildTimeline(data), lastMsg: null, last: R.GREEN }; _cache.set(data, c); }
  let res = c.map.get(newest);
  if (!res) { c.map = buildTimeline(data); res = c.map.get(newest) || R.GREEN; }
  c.lastMsg = newest;
  c.last = res;
  return res;
}
