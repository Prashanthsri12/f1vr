// Race timeline markers for the playback bar (9.15). Pure, unit-tested in
// tests/timeline-marks.test.js.
//   bands: SC / VSC / red flag periods, from the track status after each race control message
//   marks: pit stops (the selected driver's, plus every stop drawn faint), fastest-lap
//          improvements, retirements are not included (they need the live leaderboard)
// Spoiler-free: only what has happened by the playhead is returned (`upTo`); 9.29's
// "Show full session" switch can pass Infinity.
import { trackStatusAt } from './race-status.js';

const ms = (d) => (typeof d === 'number' ? d : Date.parse(d));
const BAND_KINDS = { SC: 'sc', VSC: 'vsc', RED: 'red' };

/**
 * All bands and marks of the session (computed once per session).
 * @returns {{bands: Array<{from:number, to:number, kind:'sc'|'vsc'|'red'}>,
 *   marks: Array<{t:number, kind:'pit'|'fastest', driver:number}>}}
 */
export function buildTimeline(data) {
  const bands = [];
  const rc = (data.getRaceControlAt(Infinity, Infinity) || []).slice().reverse(); // oldest first
  let open = null;
  for (const m of rc) {
    const t = ms(m.date);
    const kind = BAND_KINDS[trackStatusAt(data, t).status] || null;
    if (open && open.kind !== kind) { open.to = t; bands.push(open); open = null; }
    if (kind && !open) open = { from: t, to: Infinity, kind };
  }
  if (open) { open.to = Number.isFinite(data.dataEndTime) ? data.dataEndTime : open.from; bands.push(open); }

  const marks = [];
  if (data.hasIntervals) {
    for (const p of data.getPitStops ? data.getPitStops() : []) {
      const t = ms(p.date);
      if (Number.isFinite(t)) marks.push({ t, kind: 'pit', driver: p.driver_number });
    }
  }
  const laps = [];
  for (const d of data.drivers) {
    for (const l of data.getDriverLaps(d.number)) if (l.date_end != null && l.lap_duration > 0) laps.push(l);
  }
  laps.sort((a, b) => a.date_end - b.date_end);
  let best = Infinity;
  for (const l of laps) {
    if (l.lap_duration < best) {
      if (best !== Infinity) marks.push({ t: l.date_end, kind: 'fastest', driver: l.driver_number });
      best = l.lap_duration;
    }
  }
  marks.sort((a, b) => a.t - b.t);
  return { bands, marks };
}

/**
 * What the bar shows at the playhead: bands clipped to `upTo`, marks up to `upTo`
 * (pit marks flagged `mine` for the selected driver).
 */
export function visibleTimeline(tl, upTo, selected) {
  const bands = [];
  for (const b of tl.bands) {
    if (b.from > upTo) break;
    bands.push({ from: b.from, to: Math.min(b.to, upTo), kind: b.kind });
  }
  const marks = [];
  for (const m of tl.marks) {
    if (m.t > upTo) break;
    marks.push({ ...m, mine: m.driver === selected });
  }
  return { bands, marks };
}
