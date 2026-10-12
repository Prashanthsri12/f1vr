// Binary search and interpolation over sorted, irregular timestamps.
// Pure module: no three.js, no allocation, runs in browsers and Node.

const TWO_PI = Math.PI * 2;

/**
 * First index i with times[i] >= t, or times.length if none.
 * @param {ArrayLike<number>} times sorted ascending (Array or Float64Array)
 * @param {number} t
 * @returns {number}
 */
export function lowerBound(times, t) {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Last index i with times[i] <= t, or -1 if none.
 * @param {ArrayLike<number>} times sorted ascending
 * @param {number} t
 * @returns {number}
 */
export function indexAtOrBefore(times, t) {
  // upper bound (first i with times[i] > t) minus one
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/**
 * Find the two samples bracketing t and the fraction between them.
 * Fills out.i0, out.i1, out.f. When t is outside the range, the indices are
 * clamped to the nearest end (i0 === i1, f = 0); with no samples they are -1.
 * @param {ArrayLike<number>} times sorted ascending
 * @param {number} t
 * @param {{i0:number, i1:number, f:number}} out
 * @returns {boolean} true if t lies inside [times[0], times[last]]
 */
export function bracket(times, t, out) {
  const n = times.length;
  if (n === 0) {
    out.i0 = -1; out.i1 = -1; out.f = 0;
    return false;
  }
  const last = n - 1;
  if (!(t >= times[0] && t <= times[last])) {
    // before the range (or NaN) clamps to the start, after clamps to the end
    const i = t > times[last] ? last : 0;
    out.i0 = i; out.i1 = i; out.f = 0;
    return false;
  }
  const i0 = indexAtOrBefore(times, t);
  if (i0 >= last) {
    out.i0 = last; out.i1 = last; out.f = 0;
    return true;
  }
  const i1 = i0 + 1;
  const t0 = times[i0];
  // i0 is the last index with times <= t, so times[i1] > t >= t0 and dt > 0
  out.i0 = i0; out.i1 = i1; out.f = (t - t0) / (times[i1] - t0);
  return true;
}

/**
 * Linear interpolation.
 * @param {number} a
 * @param {number} b
 * @param {number} f fraction, usually 0..1
 * @returns {number}
 */
export function lerp(a, b, f) {
  return a + (b - a) * f;
}

/**
 * Interpolate between two angles (radians) along the shortest arc.
 * The result is not normalised; it lies between a and a ± π.
 * @param {number} a
 * @param {number} b
 * @param {number} f
 * @returns {number}
 */
export function lerpAngle(a, b, f) {
  let d = (b - a) % TWO_PI;          // (-2π, 2π)
  if (d > Math.PI) d -= TWO_PI;
  else if (d < -Math.PI) d += TWO_PI;
  return a + d * f;
}
