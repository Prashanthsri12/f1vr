// Leaderboard row motion (spec §6 polish): rows slide to a new place over 0.5 s, and a
// driver that gains / loses a place flashes green / red for 1 s; the new fastest-lap
// holder flashes purple. A seek (snap) jumps straight to the new order with no flashes.
// Pure (no three.js, no DOM); times are real milliseconds (performance.now()).
// Allocation: one state object per driver, created the first time it appears.

export const SLIDE_MS = 500;
export const FLASH_MS = 1000;

/** easeInOutCubic on 0..1 */
function ease(u) {
  return u < 0.5 ? 4 * u * u * u : 1 - ((-2 * u + 2) ** 3) / 2;
}

export class RowAnimator {
  constructor() {
    /** driver -> { index, from, to, start, flash: 'gain'|'loss'|'fastest'|null, flashStart } */
    this.state = new Map();
    this.fastest = null;
  }

  /**
   * Set the display order.
   * @param {number[]|{length: number}} order driver numbers, top row first (array-like)
   * @param {(i: number) => number} rowTop y (px) of display index i
   * @param {number} now ms
   * @param {boolean} snap true after a seek / first fill: no slide, no flash
   */
  setOrder(order, rowTop, now, snap) {
    for (let i = 0; i < order.length; i++) {
      const n = order[i];
      const to = rowTop(i);
      let s = this.state.get(n);
      if (!s) {
        s = { index: i, from: to, to, start: -Infinity, flash: null, flashStart: -Infinity };
        this.state.set(n, s);
        continue;
      }
      if (snap) {
        s.index = i; s.from = to; s.to = to; s.start = -Infinity; s.flash = null;
        continue;
      }
      if (s.to !== to) {
        s.from = this.yAt(n, now);
        s.to = to;
        s.start = now;
      }
      if (i !== s.index) {
        s.flash = i < s.index ? 'gain' : 'loss';
        s.flashStart = now;
        s.index = i;
      }
    }
  }

  /**
   * Mark the session-fastest-lap holder; a change (not on snap) flashes purple.
   * @param {number|null} n
   */
  setFastest(n, now, snap) {
    if (n === this.fastest) return;
    this.fastest = n;
    if (snap || n == null) return;
    const s = this.state.get(n);
    if (s) { s.flash = 'fastest'; s.flashStart = now; }
  }

  /** Current y of a driver's row, or NaN if unknown. */
  yAt(n, now) {
    const s = this.state.get(n);
    if (!s) return NaN;
    const u = (now - s.start) / SLIDE_MS;
    if (u >= 1) return s.to;
    if (u <= 0) return s.from;
    return s.from + (s.to - s.from) * ease(u);
  }

  /** Flash kind and strength (1 → 0 over FLASH_MS) into out; returns false when none. */
  flashAt(n, now, out) {
    const s = this.state.get(n);
    if (!s || !s.flash) return false;
    const u = (now - s.flashStart) / FLASH_MS;
    if (u >= 1 || u < 0) return false;
    out.kind = s.flash;
    out.alpha = 1 - u;
    return true;
  }

  /** True while any row is sliding or flashing (the panel keeps redrawing at ≤10 Hz). */
  active(now) {
    for (const s of this.state.values()) {
      if (now - s.start < SLIDE_MS) return true;
      if (s.flash && now - s.flashStart < FLASH_MS) return true;
    }
    return false;
  }
}
