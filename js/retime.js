/**
 * Smooths jittery OpenF1 location timestamps.
 *
 * The x/y positions are reliable but their `date` stamps jitter by ±100–200 ms,
 * so linear interpolation makes cars surge and drag even at constant speed
 * (e.g. 352 → 143 → 290 km/h implied while car_data reads a steady 250).
 * We keep positions and re-time each sample with a local linear fit of time
 * against distance travelled, which preserves real braking/acceleration
 * over longer spans but removes sample-to-sample jitter.
 */

const HALF_WINDOW = 3;     // samples each side (~±1 s at 3.7 Hz)
const MAX_SHIFT_MS = 400;  // never move a sample further than this
const MIN_SPREAD = 20;     // raw units (~2 m); below this the car is ~stationary
const SEGMENT_GAP_MS = 5000;

/**
 * Re-time samples in place. `times` must be sorted ascending.
 * Zero points (0,0,0) and gaps > 5 s split the series into independent segments.
 * @param {Float64Array} times ms
 * @param {ArrayLike<number>} x
 * @param {ArrayLike<number>} y
 * @param {ArrayLike<number>} z
 */
export function retimeSeries(times, x, y, z) {
  const n = times.length;
  if (n < 3) return;
  const dist = new Float64Array(n);
  const out = new Float64Array(times);
  let start = 0;
  for (let i = 0; i <= n; i++) {
    const breakHere = i === n || isZero(x, y, z, i) ||
      (i > start && times[i] - times[i - 1] > SEGMENT_GAP_MS);
    if (!breakHere) continue;
    if (i - start >= 3) retimeSegment(times, x, y, dist, out, start, i);
    start = isZero(x, y, z, i) ? i + 1 : i;
  }
  times.set(out);
}

function isZero(x, y, z, i) {
  return x[i] === 0 && y[i] === 0 && z[i] === 0;
}

function retimeSegment(times, x, y, dist, out, a, b) {
  dist[a] = 0;
  for (let i = a + 1; i < b; i++) {
    dist[i] = dist[i - 1] + Math.hypot(x[i] - x[i - 1], y[i] - y[i - 1]);
  }
  // Endpoints stay fixed so samples never reorder across chunk/segment boundaries.
  for (let i = a + 1; i < b - 1; i++) {
    const lo = Math.max(a, i - HALF_WINDOW);
    const hi = Math.min(b - 1, i + HALF_WINDOW);
    if (dist[hi] - dist[lo] < MIN_SPREAD) continue;
    let sd = 0, st = 0;
    const m = hi - lo + 1;
    for (let j = lo; j <= hi; j++) { sd += dist[j]; st += times[j]; }
    const md = sd / m, mt = st / m;
    let cov = 0, varD = 0;
    for (let j = lo; j <= hi; j++) {
      const dd = dist[j] - md;
      cov += dd * (times[j] - mt);
      varD += dd * dd;
    }
    if (varD <= 0) continue;
    const fit = mt + (cov / varD) * (dist[i] - md);
    const shift = Math.max(-MAX_SHIFT_MS, Math.min(MAX_SHIFT_MS, fit - times[i]));
    out[i] = times[i] + shift;
  }
  // Keep strictly increasing between the fixed endpoints.
  for (let i = a + 1; i < b - 1; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 1;
  for (let i = b - 2; i > a; i--) if (out[i] >= out[i + 1]) out[i] = out[i + 1] - 1;
}
