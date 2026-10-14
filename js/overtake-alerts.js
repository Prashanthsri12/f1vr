// Overtake warnings (13.5). Pure (no DOM, no three.js); unit-tested in tests/overtake-alerts.test.js.
//
// buildOvertakeEvents() merges two sources into one time-sorted list of on-track passes:
//   - OpenF1 `overtakes` records (attacker, defender, the position gained, date)
//   - swaps in the position data: A gains places while B, inside the places A gained, loses
//     exactly one (a retiring car drops many places and is not a pass), within SWAP_MS
// It drops what isn't racing: the first seconds after lights out, swaps under SC / VSC / red,
// and cars in or just out of the pit lane (pit.date is the lane exit; a car entering the lane
// drops places ~25 s before it). A pass answered by the same car within REPASS_MS is a
// quick pass-and-re-pass: the second one is kind 'repass' and both point at each other.
//
// createOvertakeAlerts() answers "which warnings show now": each pass from LEAD_MS before it
// (so at least 10 s ahead: the replay knows what happens next) to LINGER_MS after, filtered
// to all drivers or fights for the top N places. Allocation-free per call (reuses one array).
import { trackStatusAt } from './panels/race-status.js';

export const LEAD_MS = 12000;      // first shown this long before the swap (≥ 10 s, as asked)
export const LINGER_MS = 4000;     // then stays this long, marked done, and fades
const SWAP_MS = 3000;              // the two cars' position records can land this far apart
const MERGE_MS = 6000;             // an API overtake and a position swap of the same pair = one pass
const REPASS_MS = 15000;           // B takes the place back within this: a quick re-pass
const START_SKIP_MS = 20000;       // lights-out launch: everyone swaps at once
const PIT_RECENT_MS = 40000;
const PIT_AHEAD_MS = 35000;

/**
 * Position changes per driver from time-sorted position records.
 * @returns {{t: number, n: number, from: number, to: number}[]}
 */
function positionChanges(records) {
  const last = new Map();
  const out = [];
  for (const r of records) {
    const p = r.position;
    if (p == null || !Number.isFinite(r.date)) continue;
    const prev = last.get(r.driver_number);
    if (prev != null && prev !== p) out.push({ t: r.date, n: r.driver_number, from: prev, to: p });
    last.set(r.driver_number, p);
  }
  return out;
}

/** Swaps from position changes: A gained (p → q < p), B lost one place inside [q, p). */
export function swapsFromPositions(records) {
  const ch = positionChanges(records);
  const losses = ch.filter((c) => c.to === c.from + 1);
  const out = [];
  let j0 = 0;
  for (const g of ch) {
    if (g.to >= g.from) continue;
    while (j0 < losses.length && losses[j0].t < g.t - SWAP_MS) j0++;
    for (let j = j0; j < losses.length && losses[j].t <= g.t + SWAP_MS; j++) {
      const l = losses[j];
      if (l.n === g.n || l.from < g.to || l.from >= g.from) continue;
      out.push({ t: Math.min(g.t, l.t), a: g.n, b: l.n, pos: l.from, source: 'pos' });
    }
  }
  return out;
}

/**
 * @param {object} o
 * @param {object[]} o.positions SessionData.getPositionRecords()
 * @param {object[]} [o.overtakes] extra-data overtakes ({t, overtaking_driver_number, overtaken_driver_number, position})
 * @param {object[]} [o.pits] SessionData.getPitStops() ({driver_number, date})
 * @param {number} [o.raceStart]
 * @param {(t: number) => string} [o.statusAt] track status ('GREEN', 'YELLOW', 'SC', 'VSC', 'RED', 'CHEQUERED')
 * @returns {{t: number, a: number, b: number, pos: number, kind: 'pass'|'repass', source: string, pair?: object}[]}
 */
export function buildOvertakeEvents({ positions, overtakes = [], pits = [], raceStart = -Infinity, statusAt = () => 'GREEN' }) {
  const pitExits = new Map();
  for (const p of pits) {
    const t = typeof p.date === 'number' ? p.date : Date.parse(p.date);
    if (!pitExits.has(p.driver_number)) pitExits.set(p.driver_number, []);
    pitExits.get(p.driver_number).push(t);
  }
  const pitting = (n, t) => (pitExits.get(n) || []).some((e) => e <= t + PIT_AHEAD_MS && e >= t - PIT_RECENT_MS);

  const all = [
    ...overtakes.map((o) => ({ t: o.t, a: o.overtaking_driver_number, b: o.overtaken_driver_number, pos: o.position, source: 'api' })),
    ...swapsFromPositions(positions),
  ].filter((e) => Number.isFinite(e.t) && e.a != null && e.b != null && Number.isFinite(e.pos))
    .sort((x, y) => x.t - y.t);

  // Merge the same pass seen by both sources (keep the API time and position).
  const merged = [];
  for (const e of all) {
    const twin = merged.find((m) => m.a === e.a && m.b === e.b && Math.abs(m.t - e.t) <= MERGE_MS && m.source !== e.source && m.source !== 'both');
    if (twin) {
      if (e.source === 'api') { twin.t = e.t; twin.pos = e.pos; }
      twin.source = 'both';
    } else merged.push({ ...e });
  }

  const racing = merged.filter((e) => {
    if (e.t < raceStart + START_SKIP_MS) return false;
    const st = statusAt(e.t);
    if (st !== 'GREEN' && st !== 'YELLOW') return false;
    return !pitting(e.a, e.t) && !pitting(e.b, e.t);
  });

  // Quick pass and re-pass.
  for (let i = 0; i < racing.length; i++) {
    const e = racing[i];
    e.kind = e.kind || 'pass';
    for (let k = i + 1; k < racing.length && racing[k].t - e.t <= REPASS_MS; k++) {
      const r = racing[k];
      if (r.a === e.b && r.b === e.a && !r.pair && !e.pair) {
        r.kind = 'repass';
        r.pair = e;
        e.pair = r;
        break;
      }
    }
  }
  return racing;
}

/**
 * @param {ReturnType<typeof buildOvertakeEvents>} events
 * @returns {{at: (time: number, s: {overtakeAlerts: boolean, overtakeScope: string, overtakeTopN: number}) => object[], events: object[]}}
 *   at() returns the warnings to show (oldest first), reusing one array
 */
export function createOvertakeAlerts(events) {
  const times = events.map((e) => e.t);
  const shown = [];
  let lo = 0;
  return {
    events,
    at(time, s) {
      shown.length = 0;
      if (!s.overtakeAlerts || !events.length) return shown;
      // First event that could still be lingering, by binary search.
      let a = 0, b = times.length;
      while (a < b) { const m = (a + b) >> 1; if (times[m] < time - LINGER_MS) a = m + 1; else b = m; }
      lo = a;
      for (let i = lo; i < events.length && times[i] <= time + LEAD_MS; i++) {
        const e = events[i];
        if (s.overtakeScope === 'top' && e.pos > s.overtakeTopN) continue;
        shown.push(e);
      }
      return shown;
    },
  };
}

/**
 * Convenience: build the events for a session from SessionData and the extra data.
 * @param {object} data SessionData
 * @param {object[]} [overtakes] extra-data overtakes
 */
export function overtakeEventsFor(data, overtakes = []) {
  if (!data.hasIntervals) return [];
  return buildOvertakeEvents({
    positions: data.getPositionRecords(),
    overtakes,
    pits: data.getPitStops(),
    raceStart: data.raceStartTime,
    statusAt: (t) => trackStatusAt(data, t).status,
  });
}
