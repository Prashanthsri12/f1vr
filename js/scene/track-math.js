// Pure track normalisation math (no three.js) so it can be unit-tested under Node.
//
// Mapping (CONTRACTS.md, track.js):
//   API x -> scene x
//   API y -> scene -z   (keeps the map un-mirrored when viewed from above)
//   API z -> scene y    (x2 exaggeration, offset so the lowest point sits just above the table top)
// The longest horizontal dimension is scaled to TARGET_SIZE metres, centred at the table origin.

export const TARGET_SIZE = 1.4;
export const Z_EXAGGERATION = 2;
export const BASE_HEIGHT = 0.004; // metres above the table top for the lowest track point
export const TRACK_WIDTH_FRACTION = 0.015;

/**
 * Axis-aligned bounds of raw points.
 * @param {{x:number,y:number,z:number}[]} points
 * @returns {{minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number}}
 */
export function computeBounds(points) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function dist2(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * Removes (0,0,0) samples and points closer than `minDist` (raw units) to the previously kept point.
 * If `minDist` is omitted it is 0.1% of the longest horizontal extent.
 * @param {{x:number,y:number,z:number}[]} points
 * @param {number} [minDist]
 * @returns {{x:number,y:number,z:number}[]}
 */
export function dedupePoints(points, minDist) {
  const valid = points.filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) &&
    Number.isFinite(p.z) && !(p.x === 0 && p.y === 0 && p.z === 0));
  if (valid.length === 0) return [];
  if (minDist === undefined) {
    const b = computeBounds(valid);
    minDist = 0.001 * Math.max(b.maxX - b.minX, b.maxY - b.minY);
  }
  const min2 = minDist * minDist;
  const out = [valid[0]];
  for (let i = 1; i < valid.length; i++) {
    if (dist2(valid[i], out[out.length - 1]) > min2) out.push(valid[i]);
  }
  return out;
}

/**
 * Drops tail points that overlap the start of the lap (the reference lap window runs 0.5 s past
 * the line), so the closed curve doesn't kink at the start/finish.
 * @param {{x:number,y:number,z:number}[]} points  deduped, in driving order
 * @returns {{x:number,y:number,z:number}[]} a new array
 */
export function trimClosure(points) {
  const pts = points.slice();
  if (pts.length < 5) return pts;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.sqrt(dist2(pts[i], pts[i - 1]));
  const spacing = total / (pts.length - 1);
  const first = pts[0], second = pts[1];
  const dx = second.x - first.x, dy = second.y - first.y;
  while (pts.length > 4) {
    const p = pts[pts.length - 1];
    const d = Math.sqrt(dist2(p, first));
    const ahead = (p.x - first.x) * dx + (p.y - first.y) * dy > 0;
    if (d < 0.5 * spacing || (d < 3 * spacing && ahead)) pts.pop();
    else break;
  }
  return pts;
}

/**
 * Transform parameters that normalise raw points into table-local metres.
 * @param {{x:number,y:number,z:number}[]} points
 * @param {{targetSize?:number, zExaggeration?:number, baseHeight?:number}} [opts]
 * @returns {{scale:number, center:{x:number,y:number,z:number}, zExaggeration:number, yOffset:number, extent:number}}
 *   center.x/center.y = horizontal bbox centre, center.z = lowest elevation.
 */
export function computeTransformParams(points, opts = {}) {
  const targetSize = opts.targetSize ?? TARGET_SIZE;
  const zExaggeration = opts.zExaggeration ?? Z_EXAGGERATION;
  const yOffset = opts.baseHeight ?? BASE_HEIGHT;
  const b = computeBounds(points);
  const extent = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  if (!(extent > 0)) throw new Error('track-math: degenerate track bounds');
  return {
    scale: targetSize / extent,
    center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, z: b.minZ },
    zExaggeration,
    yOffset,
    extent,
  };
}

/**
 * Builds an allocation-free mapping function raw (x,y,z) -> scene (x,y,z) written into `out`.
 * @param {{scale:number, center:{x:number,y:number,z:number}, zExaggeration:number, yOffset:number}} params
 * @returns {(x:number, y:number, z:number, out:{x:number,y:number,z:number}) => any} returns `out`
 */
export function makeToScene(params) {
  const s = params.scale;
  const cx = params.center.x, cy = params.center.y, cz = params.center.z;
  const sy = s * params.zExaggeration;
  const yo = params.yOffset;
  return function toScene(x, y, z, out) {
    out.x = (x - cx) * s;
    out.y = (z - cz) * sy + yo;
    out.z = -(y - cy) * s;
    return out;
  };
}

/** Track ribbon width in scene metres (1.5% of the longest dimension after scaling). */
export function trackWidth(targetSize = TARGET_SIZE) {
  return targetSize * TRACK_WIDTH_FRACTION;
}

/**
 * Index of the sample (flat xyz array) nearest to (x,z) in the horizontal plane.
 * @param {ArrayLike<number>} flat  [x0,y0,z0,x1,...]
 */
export function nearestSampleIndex(flat, x, z) {
  let best = 0, bestD = Infinity;
  for (let i = 0, n = flat.length / 3; i < n; i++) {
    const dx = flat[i * 3] - x, dz = flat[i * 3 + 2] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

/**
 * Heading (rotation about +Y, radians) that turns local +Z toward the travel direction (dx, dz).
 * Returns NaN when the movement is shorter than `minLen`.
 */
export function headingFromDelta(dx, dz, minLen = 1e-5) {
  if (dx * dx + dz * dz < minLen * minLen) return NaN;
  return Math.atan2(dx, dz);
}
