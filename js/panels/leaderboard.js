// Leaderboard panel (spec §5): positions, gaps, tyres, pit stops, track status.
// 0.9 × 1.2 m → 922 × 1229 px. Race/sprint shows gap + interval; practice and
// qualifying (no intervals) show best lap + gap to the session best instead.
// Rows slide to their new place over 0.5 s; a gained / lost place flashes green / red and
// a new fastest lap purple (row-anim.js). Redraws stay ≤10 Hz and stop when nothing moves.
import { Panel, THEME, TYRE_COLOURS, font, roundRect, fmtLap, fmtGap } from './panel-base.js';
import { LAYOUT } from './layout.js';
import { trackStatusAt } from './race-status.js';
import { RowAnimator } from './row-anim.js';

const PAD = 16;
const HEADER_H = 112;
const COLHEAD_Y = 122;     // column titles band
const COLHEAD_H = 34;
const ROWS_TOP = 162;
const ROW_H = 53;
const ROW_GAP = 3;

// Column anchors (canvas px). R = right-aligned, C = centre, L = left.
const X = {
  posR: 66, bar: 78, acr: 96, fl: 192,
  gapR: 448, intR: 626,            // race
  bestR: 470, bestGapR: 626,       // practice / qualifying
  tyreC: 678, ageL: 706, pitR: 898,
};

const TYRE_LETTER = { SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W' };
const JUMP_MS = 15000;     // playhead moved more than this between refreshes (or back) = seek
const FLASH_RGB = { gain: '42,211,106', loss: '255,59,48', fastest: '177,56,221' };

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function fmtSessionBestGap(best, sessionBest) {
  if (best == null || sessionBest == null) return '';
  const d = best - sessionBest;
  return d <= 0.0005 ? '' : `+${d.toFixed(3)}`;
}

export class LeaderboardPanel extends Panel {
  /** @param {object} data SessionData */
  constructor(data) {
    const L = LAYOUT.leaderboard;
    super({ name: 'leaderboard', width: L.width, height: L.height });
    this.data = data;
    this.rows = [];             // last fetched leaderboard rows (sorted by position)
    this.status = null;         // trackStatusAt result
    this.leaderLap = 0;
    this.selected = null;
    this.fastest = null;        // driver number holding the fastest lap
    this.sessionBest = null;    // seconds
    this._sig = '';
    this.out = new Set();       // driver numbers shown as OUT (data.getLeaderboardAt().retired)
    this.anim = new RowAnimator();
    this._order = [];           // driver numbers in display order (reused)
    this._lastT = NaN;
    this._now = 0;
    this._flash = { kind: null, alpha: 0 };
  }

  /** Row top (canvas px) for a display index. */
  static rowTop(index) { return ROWS_TOP + index * ROW_H; }

  refresh(ctx) {
    const data = this.data;
    const t = ctx.time;
    const rows = data.getLeaderboardAt(t);
    const status = trackStatusAt(data, t);
    const lap = data.getLeaderLapAt(t);
    let fastest = null;
    let best = Infinity;
    this.out.clear();
    for (const r of rows) {
      if (r.retired) this.out.add(r.driverNumber);
      if (r.bestLap != null && r.bestLap < best) { best = r.bestLap; fastest = r.driverNumber; }
    }
    // Compact signature at display precision: redraw only if something visible changed.
    const race = data.hasIntervals;
    let sig = `${status.label}|${lap}|${ctx.selected}|${fastest}|`;
    for (const r of rows) {
      sig += `${r.driverNumber},${r.position},${this.out.has(r.driverNumber) ? 1 : 0},${r.compound},${r.tyreAge},${r.pitStops},`;
      sig += race ? `${fmtGap(r.gapToLeader)},${fmtGap(r.interval)};` : `${r.bestLap == null ? '' : r.bestLap.toFixed(3)};`;
    }
    this.rows = rows;
    this.status = status;
    this.leaderLap = lap;
    this.selected = ctx.selected;
    this.fastest = fastest;
    this.sessionBest = fastest == null ? null : best;
    // Row motion: a seek (or the first fill) snaps, normal playback slides and flashes.
    const nowMs = now();
    const snap = !Number.isFinite(this._lastT) || t < this._lastT || t - this._lastT > JUMP_MS;
    this._lastT = t;
    this._now = nowMs;
    const order = this._order;
    order.length = rows.length;
    for (let i = 0; i < rows.length; i++) order[i] = rows[i].driverNumber;
    this.anim.setOrder(order, LeaderboardPanel.rowTop, nowMs, snap);
    this.anim.setFastest(fastest, nowMs, snap);
    if (sig !== this._sig) { this._sig = sig; return true; }
    return this.anim.active(nowMs);
  }

  draw(g, w, h) {
    this.clear(g, w, h);
    this._drawHeader(g, w);
    this._drawColumnTitles(g, w);
    const rows = this.rows;
    const nowMs = this._now;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      let y = this.anim.yAt(r.driverNumber, nowMs);
      if (!Number.isFinite(y)) y = LeaderboardPanel.rowTop(i);
      if (y + ROW_H > h) continue;
      this._drawRow(g, w, r, y, nowMs);
    }
  }

  onHit(hit, ctx) {
    if (hit.id.startsWith('row:') && hit.payload != null) ctx.actions.selectDriver(hit.payload);
  }

  // --- drawing ---

  _drawHeader(g, w) {
    const s = this.data.session || {};
    // Red accent strip, top left (F1 TV style).
    g.fillStyle = THEME.accent;
    g.fillRect(PAD, 22, 8, 70);

    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillStyle = THEME.text;
    g.font = font(40, 700);
    const title = [s.country || s.circuit || '', s.year || ''].join(' ').trim().toUpperCase() || 'SESSION';
    g.fillText(title, PAD + 22, 58);
    g.fillStyle = THEME.muted;
    g.font = font(28, 600);
    g.fillText((s.name || '').toUpperCase(), PAD + 22, 94);

    // Status pill, top right.
    const st = this.status;
    let right = w - PAD;
    if (st) {
      g.font = font(26, 700);
      const pw = Math.max(120, g.measureText(st.label).width + 36);
      const px = right - pw;
      g.fillStyle = st.colour;
      roundRect(g, px, 22, pw, 40, 20);
      g.fill();
      g.fillStyle = st.status === 'RED' ? '#ffffff' : st.status === 'GREEN' ? '#06210f' : '#0d1016';
      g.textAlign = 'center';
      g.fillText(st.label, px + pw / 2, 51);
    }

    // Lap counter (races only).
    g.textAlign = 'right';
    const total = this.data.totalLaps || 0;
    if (this.data.hasIntervals) {
      const lapTxt = `${this.leaderLap}/${total}`;
      g.fillStyle = THEME.text;
      g.font = font(32, 700);
      g.fillText(lapTxt, right, 98);
      const lw = g.measureText(lapTxt).width;
      g.fillStyle = THEME.muted;
      g.font = font(26, 600);
      g.fillText('LAP ', right - lw - 4, 98);
    }

    g.fillStyle = THEME.line;
    g.fillRect(PAD, HEADER_H, w - PAD * 2, 2);
  }

  _drawColumnTitles(g) {
    const y = COLHEAD_Y + COLHEAD_H / 2;
    g.font = font(24, 600);
    g.fillStyle = THEME.muted;
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    g.fillText('POS', X.posR, y);
    g.textAlign = 'left';
    g.fillText('DRIVER', X.acr, y);
    g.textAlign = 'right';
    if (this.data.hasIntervals) {
      g.fillText('GAP', X.gapR, y);
      g.fillText('INT', X.intR, y);
    } else {
      g.fillText('BEST', X.bestR, y);
      g.fillText('GAP', X.bestGapR, y);
    }
    g.textAlign = 'center';
    g.fillText('TYRE', X.tyreC + 18, y);
    g.textAlign = 'right';
    g.fillText('PIT', X.pitR, y);
  }

  _drawRow(g, w, r, y, nowMs) {
    const n = r.driverNumber;
    const id = `row:${n}`;
    const d = this.data.driverByNumber.get(n);
    const selected = n === this.selected;
    const hover = this.hover === id;
    const rh = ROW_H - ROW_GAP;
    const cy = y + rh / 2;

    // Background.
    g.fillStyle = selected || hover ? THEME.surfaceHi : THEME.surface;
    roundRect(g, PAD, y, w - PAD * 2, rh, 6);
    g.fill();
    if (selected) {
      g.fillStyle = THEME.accent;
      roundRect(g, PAD, y, 6, rh, 3);
      g.fill();
    } else if (hover) {
      g.strokeStyle = THEME.line;
      g.lineWidth = 2;
      roundRect(g, PAD + 1, y + 1, w - PAD * 2 - 2, rh - 2, 6);
      g.stroke();
    }
    this.addHit(id, PAD, y, w - PAD * 2, rh, n);
    // Gain / loss / fastest-lap flash: a fading tint over the row.
    const fl = this._flash;
    if (this.anim.flashAt(n, nowMs, fl)) {
      g.fillStyle = `rgba(${FLASH_RGB[fl.kind]},${(0.45 * fl.alpha).toFixed(3)})`;
      roundRect(g, PAD, y, w - PAD * 2, rh, 6);
      g.fill();
    }

    const out = this.out.has(n);
    g.globalAlpha = out ? 0.45 : 1;
    g.textBaseline = 'middle';

    // Position.
    g.textAlign = 'right';
    g.fillStyle = THEME.text;
    g.font = font(30, 700);
    g.fillText(r.position != null ? String(r.position) : '–', X.posR, cy + 1);

    // Team bar + acronym.
    g.fillStyle = d ? d.teamColour : THEME.muted;
    g.fillRect(X.bar, y + 9, 7, rh - 18);
    g.textAlign = 'left';
    g.fillStyle = THEME.text;
    g.font = font(30, 700);
    g.fillText(d ? d.acronym : String(n), X.acr, cy + 1);

    // Fastest lap marker (purple stopwatch).
    if (n === this.fastest) this._drawFastest(g, X.fl, cy);

    // Timing columns.
    g.textAlign = 'right';
    if (out) {
      g.fillStyle = THEME.muted;
      g.font = font(28, 700);
      g.fillText('OUT', this.data.hasIntervals ? X.gapR : X.bestR, cy + 1);
    } else if (this.data.hasIntervals) {
      g.font = font(28, 600);
      g.fillStyle = THEME.text;
      g.fillText(r.position === 1 ? 'LEADER' : fmtGap(r.gapToLeader), X.gapR, cy + 1);
      g.fillStyle = THEME.muted;
      g.fillText(r.position === 1 ? '' : fmtGap(r.interval), X.intR, cy + 1);
    } else {
      g.font = font(28, 600);
      g.fillStyle = n === this.fastest ? THEME.purple : THEME.text;
      g.fillText(r.bestLap != null ? fmtLap(r.bestLap) : '–', X.bestR, cy + 1);
      g.fillStyle = THEME.muted;
      g.fillText(fmtSessionBestGap(r.bestLap, this.sessionBest), X.bestGapR, cy + 1);
    }

    // Tyre ring with letter + age.
    if (r.compound) {
      const col = TYRE_COLOURS[r.compound] || TYRE_COLOURS.UNKNOWN;
      g.strokeStyle = col;
      g.lineWidth = 4;
      g.beginPath();
      g.arc(X.tyreC, cy, 17, 0, Math.PI * 2);
      g.stroke();
      g.fillStyle = col;
      g.font = font(24, 700);
      g.textAlign = 'center';
      g.fillText(TYRE_LETTER[r.compound] || '?', X.tyreC, cy + 1);
      if (r.tyreAge != null) {
        g.textAlign = 'left';
        g.fillStyle = THEME.muted;
        g.font = font(26, 600);
        g.fillText(String(r.tyreAge), X.ageL, cy + 1);
      }
    }

    // Pit stops.
    g.textAlign = 'right';
    g.fillStyle = r.pitStops ? THEME.text : THEME.muted;
    g.font = font(28, 600);
    g.fillText(String(r.pitStops || 0), X.pitR - 4, cy + 1);

    g.globalAlpha = 1;
  }

  _drawFastest(g, x, cy) {
    g.fillStyle = THEME.purple;
    roundRect(g, x, cy - 15, 30, 30, 7);
    g.fill();
    // Stopwatch glyph.
    g.strokeStyle = '#ffffff';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(x + 15, cy + 2, 8, 0, Math.PI * 2);
    g.moveTo(x + 15, cy + 2);
    g.lineTo(x + 15, cy - 3);
    g.moveTo(x + 12, cy - 10);
    g.lineTo(x + 18, cy - 10);
    g.stroke();
  }
}
