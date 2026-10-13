// Leaderboard row flags (9.4): grid slots, DRS enabled by race control, cars in the pit lane.
// Pure (no three.js, no DOM), unit-tested in tests/leaderboard-flags.test.js.
//
// Verified against OpenF1 on 2024 Bahrain (session 9472):
// - The last /position record before lights out is the starting grid (VER, LEC, RUS, SAI, PER…).
// - race_control category "Drs" carries "DRS DISABLED" (14:57, lap 1) and "DRS ENABLED" (15:05, lap 2).
// - pit.date is the pit lane exit (see scene/pit-lane.js), so the car is in the lane during
//   [date - lane_duration, date].

const ms = (d) => (typeof d === 'number' ? d : Date.parse(d));

/**
 * Grid slot per driver: their position just before the race start.
 * @param {{drivers: Array<{number:number}>, raceStartTime: number, getPositionAt: (n:number, t:number) => number|null}} data
 * @returns {Map<number, number>}
 */
export function gridPositions(data) {
  const grid = new Map();
  if (!Number.isFinite(data.raceStartTime)) return grid;
  for (const d of data.drivers) {
    const p = data.getPositionAt(d.number, data.raceStartTime - 1);
    if (p != null) grid.set(d.number, p);
  }
  return grid;
}

/**
 * DRS on/off switches from race control, oldest first.
 * @param {object[]} messagesNewestFirst getRaceControlAt(Infinity, Infinity)
 * @returns {Array<{t: number, on: boolean}>}
 */
export function drsTimeline(messagesNewestFirst) {
  const out = [];
  for (let i = messagesNewestFirst.length - 1; i >= 0; i--) {
    const m = messagesNewestFirst[i];
    if (m.category !== 'Drs') continue;
    const msg = (m.message || '').toUpperCase();
    if (msg.includes('ENABLED')) out.push({ t: ms(m.date), on: true });
    else if (msg.includes('DISABLED')) out.push({ t: ms(m.date), on: false });
  }
  return out;
}

/** Latest DRS switch at or before t (off before the first message). */
export function drsEnabledAt(timeline, t) {
  let on = false;
  for (const m of timeline) { if (m.t > t) break; on = m.on; }
  return on;
}

/**
 * Fill `out` with the drivers inside the pit lane at t.
 * @param {Array<{driver_number:number, date:number|string, lane_duration?:number, pit_duration?:number}>} stops
 * @param {number} t ms
 * @param {Set<number>} out cleared first
 */
export function pitLaneAt(stops, t, out) {
  out.clear();
  for (const p of stops) {
    const exit = ms(p.date);
    const lane = Number.isFinite(p.lane_duration) ? p.lane_duration : p.pit_duration;
    if (!Number.isFinite(lane) || exit < t) continue;
    if (exit - lane * 1000 <= t) out.add(p.driver_number);
  }
  return out;
}
