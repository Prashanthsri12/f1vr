// Leaderboard panel (spec §5): positions, gaps, tyres, pit stops, track status.
// 0.9 × 1.2 m → 922 × 1229 px. Race/sprint shows gap + interval; practice and
// qualifying (no intervals) show best lap + gap to the session best instead.
import { Panel, THEME, TYRE_COLOURS, font, roundRect, fmtLap, fmtGap } from './panel-base.js';
import { LAYOUT } from './layout.js';
import { trackStatusAt } from './race-status.js';

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
    this.out = new Set();       // driver numbers shown as OUT
    // Row y per driver, from the display order. Phase 6 can animate these toward the targets.
    this.rowTargetY = new Map();
    this.rowY = new Map();
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
      if (this._isOut(r, t, lap, status)) this.out.add(r.driverNumber);
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
    for (let i = 0; i < rows.length; i++) {
      const n = rows[i].driverNumber;
      const y = LeaderboardPanel.rowTop(i);
      this.rowTargetY.set(n, y);
      this.rowY.set(n, y); // no animation yet (Phase 6)
    }
    if (sig === this._sig) return false;
    this._sig = sig;
    return true;
  }

  /**
   * Retired? data.retired misses cars that stopped on track (their location stays visible,
   * e.g. LEC lap 1 and ALB lap 7 at 2023 Australia), so also treat a race car as out when it
   * is 2+ laps behind the leader's lap count and its current lap began over 4 minutes ago.
   * Lapped-but-running cars start a lap every ~1.5 min; a red flag stops everyone together.
   */
  _isOut(r, t, leaderLap, status) {
    if (r.retired) return true;
    if (!this.data.hasIntervals || status.status === 'CHEQUERED') return false;
    if (leaderLap - r.lapNumber < 2 || typeof this.data.getDriverLaps !== 'function') return false;
    const laps = this.data.getDriverLaps(r.driverNumber);
    const cur = laps.length ? laps[laps.length - 1] : null;
    // No usable current lap (e.g. lap-1 crash with no lap start time): out once the leader is 3+ laps in.
    if (!r.lapNumber) return leaderLap >= 3 && (!cur || cur.lap_number <= 1);
    const start = cur && cur.lap_number === r.lapNumber ? cur.date_start : null;
    return start != null && t - start > 240000;
  }

  draw(g, w, h) {
    this.clear(g, w, h);
    this._drawHeader(g, w);
    this._drawColumnTitles(g, w);
    const rows = this.rows;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const y = this.rowY.get(r.driverNumber) ?? LeaderboardPanel.rowTop(i);
      if (y + ROW_H > h) break;
      this._drawRow(g, w, r, y);
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

  _drawRow(g, w, r, y) {
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
