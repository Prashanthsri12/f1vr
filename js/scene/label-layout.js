// Car label declutter (4b.7), pure logic (no three.js) so it can be unit tested.
// Labels are rectangles in the camera's tangent plane (x/-z, y/-z: angular units, the
// same for every distance). Greedy by priority: a label is drawn in full if it is a
// "must" label (selected, top 3, the cars directly ahead/behind the selected one) or if
// it doesn't overlap a full label placed before it; otherwise it collapses to its
// short form (the position number only).

export const MODE_SHORT = 0;
export const MODE_FULL = 1;

/**
 * @param {number} n label count
 * @param {Uint8Array} visible 1 = on screen / tracked
 * @param {Float32Array} cx rect centre x (tangent plane)
 * @param {Float32Array} cy rect centre y
 * @param {Float32Array} hw half width of the FULL label
 * @param {Float32Array} hh half height
 * @param {Uint8Array} must 1 = always full
 * @param {Int16Array} rank sort key, lower first (e.g. race position; unknown = large)
 * @param {Int16Array} order scratch, length >= n
 * @param {Uint8Array} modes out: MODE_FULL / MODE_SHORT per label
 * @returns {Uint8Array} modes
 */
export function declutterLabels(n, visible, cx, cy, hw, hh, must, rank, order, modes) {
  for (let i = 0; i < n; i++) order[i] = i;
  // Insertion sort (n ≈ 20, runs ≤ 4 Hz): must labels first, then by rank.
  for (let a = 1; a < n; a++) {
    const v = order[a];
    const kv = (must[v] ? 0 : 10000) + rank[v];
    let b = a - 1;
    while (b >= 0 && (must[order[b]] ? 0 : 10000) + rank[order[b]] > kv) { order[b + 1] = order[b]; b--; }
    order[b + 1] = v;
  }
  for (let a = 0; a < n; a++) {
    const i = order[a];
    if (!visible[i]) { modes[i] = MODE_FULL; continue; }
    let clash = false;
    if (!must[i]) {
      for (let b = 0; b < a && !clash; b++) {
        const j = order[b];
        if (!visible[j] || modes[j] !== MODE_FULL) continue;
        clash = Math.abs(cx[i] - cx[j]) < hw[i] + hw[j] && Math.abs(cy[i] - cy[j]) < hh[i] + hh[j];
      }
    }
    modes[i] = clash ? MODE_SHORT : MODE_FULL;
  }
  return modes;
}
