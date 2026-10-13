// Numbers behind the Insights panel (9.14 battles, 9.16 head-to-head, 9.17 driver card).
// Pure (no three.js, no DOM), unit-tested in tests/insights-data.test.js. Everything is
// "as of t": nothing from later in the session is used.
export const BATTLE_GAP_S = 1.0;
export const MAX_BATTLES = 3;
const TREND_LAPS = 6;
const TREND_EPS = 0.1;      // s: smaller changes over the window count as steady

/**
 * Pairs running within BATTLE_GAP_S of each other, by position, the selected driver's first.
 * @param {Array<{driverNumber:number, position:number|null, interval:any, retired?:boolean}>} rows getLeaderboardAt(t)
 * @param {number|null} selected
 * @param {Set<number>} [inPit] drivers in the pit lane (not a battle)
 * @returns {Array<{ahead:number, behind:number, pos:number, gap:number}>} pos = position fought for (the car ahead's)
 */
export function findBattles(rows, selected, inPit = new Set()) {
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    if (a.position == null || b.position == null || a.retired || b.retired) continue;
    if (inPit.has(a.driverNumber) || inPit.has(b.driverNumber)) continue;
    if (typeof b.interval !== 'number' || !(b.interval > 0) || b.interval >= BATTLE_GAP_S) continue;
    out.push({ ahead: a.driverNumber, behind: b.driverNumber, pos: a.position, gap: b.interval });
  }
  out.sort((x, y) => {
    const sx = x.ahead === selected || x.behind === selected ? 0 : 1;
    const sy = y.ahead === selected || y.behind === selected ? 0 : 1;
    return sx - sy || x.pos - y.pos;
  });
  return out.slice(0, MAX_BATTLES);
}

/**
 * The chaser's interval at each of its last completed lap ends (oldest first), plus now.
 * @param {{getDriverLaps: Function, getIntervalAt: Function}} data
 * @returns {number[]} seconds (string / null samples are skipped)
 */
export function intervalTrend(data, behind, t, laps = TREND_LAPS) {
  const all = data.getDriverLaps(behind) || [];
  const ends = [];
  for (const l of all) if (l.date_end != null && l.date_end <= t) ends.push(l.date_end);
  const out = [];
  for (const e of ends.slice(-laps)) {
    const v = data.getIntervalAt(behind, e);
    if (typeof v === 'number') out.push(v);
  }
  const now = data.getIntervalAt(behind, t);
  if (typeof now === 'number') out.push(now);
  return out;
}

/** 'closing' | 'growing' | 'steady' from a gap series. */
export function trendOf(series) {
  if (series.length < 2) return 'steady';
  const d = series[series.length - 1] - series[0];
  return d < -TREND_EPS ? 'closing' : d > TREND_EPS ? 'growing' : 'steady';
}

/** Completed laps of driver n by t. */
function doneLaps(data, n, t) {
  return (data.getDriverLaps(n) || []).filter((l) => l.date_end != null && l.date_end <= t);
}

/** Last and best lap, last lap sectors and best speed trap of driver n at t. */
export function lapSummary(data, n, t) {
  const laps = doneLaps(data, n, t);
  let best = null, top = null;
  for (const l of laps) {
    if (l.lap_duration > 0 && (best == null || l.lap_duration < best)) best = l.lap_duration;
    if (Number.isFinite(l.st_speed) && (top == null || l.st_speed > top)) top = l.st_speed;
  }
  let last = null;
  for (let i = laps.length - 1; i >= 0; i--) if (laps[i].lap_duration > 0) { last = laps[i]; break; }
  return {
    lapsDone: laps.length,
    last: last ? last.lap_duration : null,
    best,
    sectors: last ? [last.duration_sector_1 ?? null, last.duration_sector_2 ?? null, last.duration_sector_3 ?? null] : [null, null, null],
    topSpeed: top,
  };
}

/** Laps driver n finished in P1 (position at each completed lap's end), race only. */
export function lapsLed(data, n, t) {
  let led = 0;
  for (const l of doneLaps(data, n, t)) if (data.getPositionAt(n, l.date_end) === 1) led++;
  return led;
}

/**
 * Stints so far: [{compound, laps, current}] (laps counted up to the current lap).
 * @param {object[]} stints getDriverStints(n): {compound, lap_start, lap_end, tyre_age_at_start}
 */
export function stintsSoFar(stints, currentLap) {
  const out = [];
  for (const s of stints || []) {
    if (s.lap_start == null || s.lap_start > Math.max(1, currentLap)) continue;
    const end = s.lap_end == null ? currentLap : Math.min(s.lap_end, currentLap);
    out.push({ compound: s.compound || 'UNKNOWN', laps: Math.max(1, end - s.lap_start + 1), current: currentLap >= s.lap_start && (s.lap_end == null || currentLap <= s.lap_end) });
  }
  return out;
}

/**
 * The other driver for head-to-head: `pick` if set and present, else the car ahead
 * (or behind for the leader).
 * @param {Array<{driverNumber:number}>} rows leaderboard order
 */
export function defaultRival(rows, selected, pick) {
  if (pick != null && pick !== selected && rows.some((r) => r.driverNumber === pick)) return pick;
  const i = rows.findIndex((r) => r.driverNumber === selected);
  if (i < 0) return rows[0] ? rows[0].driverNumber : null;
  if (i > 0) return rows[i - 1].driverNumber;
  return rows[1] ? rows[1].driverNumber : null;
}

/** Next rival in leaderboard order (dir ±1), skipping the selected driver. */
export function stepRival(rows, selected, current, dir) {
  const order = rows.map((r) => r.driverNumber).filter((n) => n !== selected);
  if (!order.length) return null;
  const i = order.indexOf(current);
  return order[((i < 0 ? 0 : i + dir) + order.length) % order.length];
}

/**
 * Gap between two cars from gap_to_leader (seconds, b relative to a; + means b is behind),
 * or null when either is a lap string or missing.
 */
export function gapBetween(rowA, rowB) {
  const ga = rowA && rowA.position === 1 ? 0 : rowA && rowA.gapToLeader;
  const gb = rowB && rowB.position === 1 ? 0 : rowB && rowB.gapToLeader;
  if (typeof ga !== 'number' || typeof gb !== 'number') return null;
  return gb - ga;
}
