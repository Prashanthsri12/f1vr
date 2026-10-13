// Strategy tools (9.25) and the driver comparison maths (9.26). Pure, unit-tested in
// tests/analytics.test.js.
import { lapsUpTo, cleanLaps, median } from './lap-table.js';

const UNDERCUT_WINDOW_S = 4;   // pairs running within this before the first of them stops
const MIN_SWING_S = 0.4;
const MAX_SWING_S = 15;        // bigger swings mean a lapped car or a neutralised lap, not a pit battle

/**
 * Pit loss for this race: for every stop finished by upTo (in-lap and out-lap both clean of
 * neutralisations), (in-lap + out-lap) − 2 × the driver's median clean lap. Averaged.
 * @returns {{loss: number|null, stops: number}}
 */
export function pitLoss(table, upTo) {
  const losses = [];
  for (const n of table.drivers) {
    const rows = lapsUpTo(table, n, upTo);
    const med = median(cleanLaps(table, n, upTo).map((r) => r.time));
    if (med == null) continue;
    for (let i = 0; i + 1 < rows.length; i++) {
      const a = rows[i], b = rows[i + 1];
      if (!a.inLap || b.lap !== a.lap + 1 || a.neutral || b.neutral) continue;
      const loss = a.time + b.time - 2 * med;
      if (loss > 5 && loss < 60) losses.push(loss);
    }
  }
  return { loss: losses.length ? losses.reduce((x, y) => x + y, 0) / losses.length : null, stops: losses.length };
}

/**
 * Where the selected driver would rejoin if they pitted now: their gap to the leader plus
 * the pit loss, placed among everyone else's current gap.
 * @param {Array<{driverNumber:number, position:number|null, gapToLeader:any, retired?:boolean}>} rows getLeaderboardAt(t)
 * @returns {{pos:number, was:number, ahead:{n:number, by:number}|null, behind:{n:number, by:number}|null, after:number}|null}
 */
export function rejoin(rows, selected, loss) {
  if (loss == null) return null;
  const gapOf = (r) => (r.position === 1 ? 0 : typeof r.gapToLeader === 'number' ? r.gapToLeader : null);
  const me = rows.find((r) => r.driverNumber === selected);
  if (!me || gapOf(me) == null) return null;
  const after = gapOf(me) + loss;
  const others = rows.filter((r) => r.driverNumber !== selected && !r.retired && gapOf(r) != null)
    .map((r) => ({ n: r.driverNumber, g: gapOf(r) })).sort((a, b) => a.g - b.g);
  const ahead = others.filter((o) => o.g <= after);
  const behind = others.find((o) => o.g > after);
  const a = ahead[ahead.length - 1];
  return {
    pos: ahead.length + 1,
    was: me.position,
    after,
    ahead: a ? { n: a.n, by: after - a.g } : null,
    behind: behind ? { n: behind.n, by: behind.g - after } : null,
  };
}

/**
 * Undercut / overcut attempts finished by upTo: two cars within UNDERCUT_WINDOW_S of each other
 * on the lap before the first of them stops; compare their gap then with the gap on the lap after
 * the second one stops. Neutralised stops are skipped.
 * @returns {Array<{lap:number, first:number, second:number, kind:'undercut'|'cover', swing:number, worked:boolean}>}
 *   swing > 0 means the first car to stop gained
 */
export function undercuts(table, upTo) {
  const lapRow = new Map();
  const stops = []; // {n, lap}
  for (const n of table.drivers) {
    const m = new Map();
    for (const r of lapsUpTo(table, n, upTo)) {
      m.set(r.lap, r);
      if (r.inLap && !r.neutral) stops.push({ n, lap: r.lap });
    }
    lapRow.set(n, m);
  }
  const out = [];
  for (const s1 of stops) {
    for (const s2 of stops) {
      if (s1.n === s2.n || s2.lap <= s1.lap || s2.lap - s1.lap > 6) continue;
      const before = s1.lap - 1, after = s2.lap + 1;
      const a0 = lapRow.get(s1.n).get(before), b0 = lapRow.get(s2.n).get(before);
      const a1 = lapRow.get(s1.n).get(after), b1 = lapRow.get(s2.n).get(after);
      if (!a0 || !b0 || !a1 || !b1) continue;
      const g0 = (b0.end - a0.end) / 1000; // s; + : the first stopper was ahead
      if (Math.abs(g0) > UNDERCUT_WINDOW_S) continue;
      const g1 = (b1.end - a1.end) / 1000;
      const swing = g1 - g0;
      if (Math.abs(swing) < MIN_SWING_S || Math.abs(swing) > MAX_SWING_S) continue;
      const kind = g0 < 0 ? 'undercut' : 'cover';
      out.push({ lap: s1.lap, first: s1.n, second: s2.n, kind, swing, worked: g1 > 0 });
    }
  }
  return out.sort((a, b) => b.lap - a.lap);
}

/**
 * Two speed traces on one distance grid: each trace's distance is scaled to fractions of its
 * own lap (so small integration differences don't drift), then sampled at `points` fractions.
 * delta[i] = time A − time B at that distance (negative: A is ahead).
 * @param {{dist: Float32Array, speed: Float32Array, time: Float64Array}} a
 * @param {{dist: Float32Array, speed: Float32Array, time: Float64Array}} b
 * @returns {{frac: Float32Array, va: Float32Array, vb: Float32Array, delta: Float32Array, lengthM: number}|null}
 */
export function compareTraces(a, b, points = 300) {
  if (!a || !b || a.dist.length < 10 || b.dist.length < 10) return null;
  const la = a.dist[a.dist.length - 1], lb = b.dist[b.dist.length - 1];
  if (!(la > 100) || !(lb > 100)) return null;
  const frac = new Float32Array(points), va = new Float32Array(points), vb = new Float32Array(points), delta = new Float32Array(points);
  let ia = 0, ib = 0;
  for (let i = 0; i < points; i++) {
    const f = i / (points - 1);
    frac[i] = f;
    while (ia < a.dist.length - 2 && a.dist[ia + 1] / la < f) ia++;
    while (ib < b.dist.length - 2 && b.dist[ib + 1] / lb < f) ib++;
    const sa = sampleAt(a, la, ia, f), sb = sampleAt(b, lb, ib, f);
    va[i] = sa.v; vb[i] = sb.v;
    delta[i] = (sa.t - a.time[0] - (sb.t - b.time[0])) / 1000;
  }
  return { frac, va, vb, delta, lengthM: (la + lb) / 2 };
}

function sampleAt(tr, len, i, f) {
  const d0 = tr.dist[i] / len, d1 = tr.dist[i + 1] / len;
  const u = d1 > d0 ? Math.min(1, Math.max(0, (f - d0) / (d1 - d0))) : 0;
  return { v: tr.speed[i] + (tr.speed[i + 1] - tr.speed[i]) * u, t: tr.time[i] + (tr.time[i + 1] - tr.time[i]) * u };
}

/** Lap row of driver n to compare: the fastest so far ('best') or the last completed ('last'). */
export function pickLap(table, n, upTo, which = 'best') {
  const rows = lapsUpTo(table, n, upTo).filter((r) => r.lap > 1);
  if (!rows.length) return null;
  if (which === 'last') return rows[rows.length - 1];
  return rows.reduce((m, r) => (r.time < m.time ? r : m), rows[0]);
}
