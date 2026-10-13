// Track colours (9.8, 9.10): the neon edges and glow of the track ribbon, per outline sample.
//   sectors - the selected driver's last completed lap: each sector purple (session best),
//             green (personal best) or yellow, from LapStats
//   minis   - each mini-sector in the team colour of the driver who last set a purple there
//   plain   - one neutral colour
// OpenF1 laps.segments_sector_1..3 codes (docs, checked 2026-10-13): 0 not available,
// 2048 yellow, 2049 green, 2051 purple, 2064 pit lane (2050, 2052, 2068 unexplained).
// The docs warn the codes may not match TV and may be missing in races (2024 Bahrain has
// them). Mini-sector boundaries are not published, so each sector is split evenly by
// distance: an approximation. Without sector boundaries (no sector times on the reference
// lap) the track stays plain. Pure: no three.js, unit-tested in tests/track-style.test.js.
import { LapStats, newLapStatsOut } from '../panels/lap-stats.js';

export const TRACK_COLOUR_MODES = ['sectors', 'minis', 'plain'];
export const SEG_PURPLE = 2051;

const HEX = { purple: '#b84dff', green: '#2ee67a', yellow: '#ffd21f', plain: '#5c6b8c' };

/** '#rrggbb' -> [r, g, b] in 0..1 */
export function hexRgb(hex) {
  const n = parseInt(String(hex || HEX.plain).slice(1, 7), 16);
  return Number.isFinite(n) ? [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255] : hexRgb(HEX.plain);
}

/** The most common [s1, s2, s3] segment counts over all laps, or null without segment data. */
export function segmentCounts(data) {
  const votes = new Map();
  for (const d of data.drivers) {
    for (const l of data.getDriverLaps(d.number)) {
      const a = l.segments_sector_1, b = l.segments_sector_2, c = l.segments_sector_3;
      if (!Array.isArray(a) || !Array.isArray(b) || !Array.isArray(c) || !a.length || !b.length || !c.length) continue;
      const key = `${a.length},${b.length},${c.length}`;
      votes.set(key, (votes.get(key) || 0) + 1);
    }
  }
  let best = null, most = 0;
  for (const [k, v] of votes) if (v > most) { most = v; best = k; }
  return best ? best.split(',').map(Number) : null;
}

/**
 * Purple mini-sector events per mini-sector (global index over S1..S3), time-sorted.
 * A segment's time is placed evenly inside its sector (sector start + (j + 1) / m × duration).
 * @returns {Array<{times: number[], drivers: number[]}>}
 */
export function buildMiniHolders(data, counts) {
  const total = counts[0] + counts[1] + counts[2];
  const ev = Array.from({ length: total }, () => []);
  for (const d of data.drivers) {
    for (const l of data.getDriverLaps(d.number)) {
      if (l.date_start == null) continue;
      let start = l.date_start;
      let base = 0;
      for (let k = 0; k < 3; k++) {
        const seg = l[`segments_sector_${k + 1}`];
        const dur = l[`duration_sector_${k + 1}`];
        if (!Array.isArray(seg) || seg.length !== counts[k] || !(dur > 0)) break;
        for (let j = 0; j < seg.length; j++) {
          if (seg[j] === SEG_PURPLE) ev[base + j].push([start + ((j + 1) / seg.length) * dur * 1000, d.number]);
        }
        start += dur * 1000;
        base += counts[k];
      }
    }
  }
  return ev.map((list) => {
    list.sort((a, b) => a[0] - b[0]);
    return { times: list.map((e) => e[0]), drivers: list.map((e) => e[1]) };
  });
}

/** Driver holding a mini-sector at t (the last purple at or before t), or null. */
export function holderAt(h, t) {
  let lo = 0, hi = h.times.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (h.times[mid] <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans < 0 ? null : h.drivers[ans];
}

/**
 * Per sample: its sector (0..2) and global mini-sector index, walking forward from S1's start.
 * @param {number} n samples
 * @param {number[]} bounds [S1 start, S2 start, S3 start] sample indices
 * @param {number[]|null} counts mini-sectors per sector
 */
export function sampleMap(n, bounds, counts) {
  const sector = new Uint8Array(n);
  const mini = new Int16Array(n).fill(-1);
  const o = [0, (bounds[1] - bounds[0] + n) % n, (bounds[2] - bounds[0] + n) % n, n];
  for (let i = 0; i < n; i++) {
    const d = (i - bounds[0] + n) % n;
    const k = d < o[1] ? 0 : d < o[2] ? 1 : 2;
    sector[i] = k;
    if (counts) {
      const span = Math.max(1, o[k + 1] - o[k]);
      const j = Math.min(counts[k] - 1, Math.floor(((d - o[k]) / span) * counts[k]));
      mini[i] = (k > 0 ? counts[0] : 0) + (k > 1 ? counts[1] : 0) + j;
    }
  }
  return { sector, mini };
}

export class TrackStyle {
  /**
   * @param {object} data SessionData
   * @param {{outline: number[], sectors: number[]|null, setSampleColours?: (rgb: Float32Array) => void}} track loadTrack result
   */
  constructor(data, track) {
    this.data = data;
    this.track = track;
    this.n = track.outline ? track.outline.length / 3 : 0;
    this.rgb = new Float32Array(this.n * 3);
    this.ok = !!(track.sectors && track.setSampleColours && this.n);
    this.counts = this.ok ? segmentCounts(data) : null;
    this.map = this.ok ? sampleMap(this.n, track.sectors, this.counts) : null;
    this.holders = null; // built on first use of 'minis'
    this.stats = new LapStats(data);
    this.out = newLapStatsOut();
    this._sig = '';
    this._team = new Map(data.drivers.map((d) => [d.number, hexRgb(d.teamColour)]));
    this._cls = { purple: hexRgb(HEX.purple), green: hexRgb(HEX.green), yellow: hexRgb(HEX.yellow) };
    this._plain = hexRgb(HEX.plain);
    this._minis = [];
  }

  /** The mode actually drawn (minis needs segment data, everything needs sector bounds). */
  effectiveMode(mode) {
    if (!this.ok) return 'plain';
    if (mode === 'minis' && !this.counts) return 'sectors';
    return TRACK_COLOUR_MODES.includes(mode) ? mode : 'sectors';
  }

  /** Recolour if anything visible changed. Call at a few Hz. */
  update(t, selected, mode) {
    if (!this.track.setSampleColours) return;
    const m = this.effectiveMode(mode);
    let sig = m;
    const cls = [null, null, null];
    if (m === 'sectors') {
      const o = this.stats.compute(selected, t, this.out);
      for (let k = 0; k < 3; k++) cls[k] = o.sectors[k].cls;
      sig += `|${cls.join(',')}`;
    } else if (m === 'minis') {
      if (!this.holders) this.holders = buildMiniHolders(this.data, this.counts);
      const mins = this._minis;
      mins.length = this.holders.length;
      for (let j = 0; j < this.holders.length; j++) mins[j] = holderAt(this.holders[j], t);
      sig += `|${mins.join(',')}`;
    }
    if (sig === this._sig) return;
    this._sig = sig;
    const rgb = this.rgb;
    for (let i = 0; i < this.n; i++) {
      let c = this._plain;
      if (m === 'sectors') c = this._cls[cls[this.map.sector[i]]] || this._plain;
      else if (m === 'minis') {
        const h = this._minis[this.map.mini[i]];
        c = (h != null && this._team.get(h)) || this._plain;
      }
      rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
    }
    this.track.setSampleColours(rgb);
  }
}
