// Leaderboard panel (spec §5): positions, gaps, tyres, pit stops, track status.
// 0.9 × 1.2 m → 922 × 1229 px. Race/sprint shows gap + interval; practice and
// qualifying (no intervals) show best lap + gap to the session best instead.
// Rows slide to their new place over 0.5 s; a gained / lost place flashes green / red and
// a new fastest lap purple (row-anim.js). Redraws stay ≤10 Hz and stop when nothing moves.
// 9.4 restyle: team-colour row gradients and rims, places gained / lost since the grid
// (race only), and PIT / DRS chips (rules in leaderboard-flags.js). The DRS chip means the
// interval is under 1 s while race control has DRS enabled and the track is green or yellow:
// DRS range from timing, not the car's own DRS flag (car_data is loaded for one driver only).
// 10.4: car-number badges in team colour, a neon cyan outline on the selected driver, red-slash title.
import { Panel, THEME, TYRE_COLOURS, font, dfont, rgba, glowStroke, roundRect, fmtLap, fmtGap, panelTitle, isLight } from './panel-base.js';
import { LAYOUT } from './layout.js';
import { trackStatusAt } from './race-status.js';
import { RowAnimator } from './row-anim.js';
import { gridPositions, drsTimeline, drsEnabledAt, pitLaneAt } from './leaderboard-flags.js';

const PAD = 16;
const HEADER_H = 112;
const COLHEAD_Y = 122;     // column titles band
const COLHEAD_H = 34;
const ROWS_TOP = 162;
const ROW_H = 53;
const ROW_GAP = 3;

// Column anchors (canvas px). R = right-aligned, C = centre, L = left.
const X = {
  posR: 64, badge: 76, badgeW: 48, acr: 136, fl: 212, chip: 250,
  gapR: 462, intR: 618,            // race
  bestR: 470, bestGapR: 618,       // practice / qualifying
  tyreC: 664, ageL: 690, pitR: 790, chgR: 898,
};

const TYRE_LETTER = { SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W' };
const JUMP_MS = 15000;     // playhead moved more than this between refreshes (or back) = seek
const FLASH_RGB = { gain: '46,230,122', loss: '255,59,59', fastest: '184,77,255' };
const DRS_RANGE_S = 1.0;

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
    this._grid = null;          // driver -> grid slot (race only), built once
    this._inPit = new Set();    // drivers in the pit lane now
    this._drsOn = false;        // DRS enabled by race control and the track allows it
    this._drsMsgs = null;       // [{t, on}] from race control "Drs" messages, oldest first
    this._rowGrad = new Map();  // team colour -> cached row gradient
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
    const race = data.hasIntervals;
    pitLaneAt(data.getPitStops ? data.getPitStops() : [], t, this._inPit);
    if (race && !this._drsMsgs) this._drsMsgs = drsTimeline(data.getRaceControlAt(Infinity, Infinity) || []);
    this._drsOn = race && (status.status === 'GREEN' || status.status === 'YELLOW') && drsEnabledAt(this._drsMsgs, t);
    if (race && !this._grid) this._grid = gridPositions(data);
    // Compact signature at display precision: redraw only if something visible changed.
    let sig = `${status.label}|${lap}|${ctx.selected}|${fastest}|${this._drsOn ? 1 : 0}|`;
    for (const r of rows) {
      sig += `${r.driverNumber},${r.position},${this.out.has(r.driverNumber) ? 1 : 0},${r.compound},${r.tyreAge},${r.pitStops},`;
      sig += `${this._inPit.has(r.driverNumber) ? 1 : 0},`;
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
    const title = [s.country || s.circuit || '', s.year || ''].join(' ').trim() || 'Session';
    panelTitle(g, PAD + 4, 44, title, 40);
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillStyle = THEME.muted;
    g.font = font(28, 700);
    g.fillText((s.name || '').toUpperCase(), PAD + 40, 96);

    // Status pill, top right.
    const st = this.status;
    const right = w - PAD;
    if (st) {
      g.font = dfont(24, 700);
      const pw = Math.max(120, g.measureText(st.label).width + 40);
      const px = right - pw;
      g.fillStyle = rgba(st.colour, 0.25);
      roundRect(g, px - 4, 18, pw + 8, 48, 24);
      g.fill();
      g.fillStyle = st.colour;
      roundRect(g, px, 22, pw, 40, 20);
      g.fill();
      g.fillStyle = st.status === 'RED' ? '#ffffff' : st.status === 'GREEN' ? '#04140a' : THEME.bg;
      g.textAlign = 'center';
      g.fillText(st.label, px + pw / 2, 51);
    }

    // Lap counter (races only).
    g.textAlign = 'right';
    const total = this.data.totalLaps || 0;
    if (this.data.hasIntervals) {
      const lapTxt = `${this.leaderLap}/${total}`;
      g.fillStyle = THEME.text;
      g.font = dfont(32, 700);
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
    g.font = font(22, 700);
    g.fillStyle = THEME.muted;
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    g.fillText('POS', X.posR, y);
    g.textAlign = 'center';
    g.fillText('NO', X.badge + X.badgeW / 2, y);
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
    g.fillText('TYRE', X.tyreC + 16, y);
    g.textAlign = 'right';
    g.fillText('PIT', X.pitR, y);
    if (this.data.hasIntervals) g.fillText('+/−', X.chgR, y);
  }

  /** Row fill: team colour fading into the surface (cached per colour; rows draw translated). */
  _rowFill(g, w, colour, strong) {
    const key = strong ? `${colour}+` : colour;
    let gr = this._rowGrad.get(key);
    if (!gr) {
      gr = g.createLinearGradient(PAD, 0, PAD + (w - PAD * 2) * 0.6, 0);
      gr.addColorStop(0, rgba(colour, strong ? 0.42 : 0.26));
      gr.addColorStop(1, strong ? THEME.surfaceHi : THEME.surface);
      this._rowGrad.set(key, gr);
    }
    return gr;
  }

  _drawRow(g, w, r, y, nowMs) {
    const n = r.driverNumber;
    const id = `row:${n}`;
    const d = this.data.driverByNumber.get(n);
    const team = d ? d.teamColour : THEME.muted;
    const selected = n === this.selected;
    const hover = this.hover === id;
    const rh = ROW_H - ROW_GAP;
    const cy = y + rh / 2;

    // Background: team-colour gradient (drawn translated so one cached gradient fits every row).
    g.save();
    g.translate(0, y);
    g.fillStyle = this._rowFill(g, w, team, selected || hover);
    roundRect(g, PAD, 0, w - PAD * 2, rh, 8);
    g.fill();
    g.restore();
    if (selected) {
      roundRect(g, PAD + 1.5, y + 1.5, w - PAD * 2 - 3, rh - 3, 8);
      glowStroke(g, THEME.select, 3);
    } else if (hover) {
      g.strokeStyle = THEME.rim;
      g.lineWidth = 2;
      roundRect(g, PAD + 1, y + 1, w - PAD * 2 - 2, rh - 2, 8);
      g.stroke();
    }
    this.addHit(id, PAD, y, w - PAD * 2, rh, n);
    // Gain / loss / fastest-lap flash: a fading tint over the row.
    const fl = this._flash;
    if (this.anim.flashAt(n, nowMs, fl)) {
      g.fillStyle = `rgba(${FLASH_RGB[fl.kind]},${(0.45 * fl.alpha).toFixed(3)})`;
      roundRect(g, PAD, y, w - PAD * 2, rh, 8);
      g.fill();
    }

    const out = this.out.has(n);
    g.globalAlpha = out ? 0.45 : 1;
    g.textBaseline = 'middle';

    // Position.
    g.textAlign = 'right';
    g.fillStyle = THEME.text;
    g.font = dfont(30, 700);
    g.fillText(r.position != null ? String(r.position) : '–', X.posR, cy + 1);

    // Car-number badge in team colour (with a soft glow) + acronym.
    g.fillStyle = rgba(team, 0.3);
    roundRect(g, X.badge - 3, y + 4, X.badgeW + 6, rh - 8, 9);
    g.fill();
    g.fillStyle = team;
    roundRect(g, X.badge, y + 7, X.badgeW, rh - 14, 7);
    g.fill();
    g.fillStyle = isLight(team) ? '#0a0b10' : '#ffffff';
    g.textAlign = 'center';
    g.font = dfont(24, 700);
    g.fillText(String(n), X.badge + X.badgeW / 2, cy + 1);
    g.textAlign = 'left';
    g.fillStyle = THEME.text;
    g.font = dfont(30, 700);
    g.fillText(d ? d.acronym : String(n), X.acr, cy + 1);

    // Fastest lap marker (purple stopwatch), then a PIT or DRS chip.
    if (n === this.fastest) this._drawFastest(g, X.fl, cy);
    if (!out) {
      if (this._inPit.has(n)) chip(g, X.chip, cy, 'PIT', THEME.blue, '#ffffff');
      else if (this._drsOn && r.position > 1 && typeof r.interval === 'number' && r.interval > 0 && r.interval < DRS_RANGE_S) {
        chip(g, X.chip, cy, 'DRS', THEME.green, '#04140a');
      }
    }

    // Timing columns.
    g.textAlign = 'right';
    if (out) {
      g.fillStyle = THEME.muted;
      g.font = dfont(26, 700);
      g.fillText('OUT', this.data.hasIntervals ? X.gapR : X.bestR, cy + 1);
    } else if (this.data.hasIntervals) {
      g.font = dfont(27, 600);
      g.fillStyle = THEME.text;
      g.fillText(r.position === 1 ? 'LEADER' : fmtGap(r.gapToLeader), X.gapR, cy + 1);
      g.fillStyle = THEME.muted;
      g.fillText(r.position === 1 ? '' : fmtGap(r.interval), X.intR, cy + 1);
    } else {
      g.font = dfont(27, 600);
      g.fillStyle = n === this.fastest ? THEME.purple : THEME.text;
      g.fillText(r.bestLap != null ? fmtLap(r.bestLap) : '–', X.bestR, cy + 1);
      g.fillStyle = THEME.muted;
      g.fillText(fmtSessionBestGap(r.bestLap, this.sessionBest), X.bestGapR, cy + 1);
    }

    // Tyre ring (glowing) with letter + age.
    if (r.compound) {
      const col = TYRE_COLOURS[r.compound] || TYRE_COLOURS.UNKNOWN;
      g.fillStyle = THEME.bg;
      g.beginPath();
      g.arc(X.tyreC, cy, 19, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(X.tyreC, cy, 17, 0, Math.PI * 2);
      glowStroke(g, col, 4.5, 2.2);
      g.fillStyle = col;
      g.font = dfont(22, 700);
      g.textAlign = 'center';
      g.fillText(TYRE_LETTER[r.compound] || '?', X.tyreC, cy + 1);
      if (r.tyreAge != null) {
        g.textAlign = 'left';
        g.fillStyle = THEME.muted;
        g.font = dfont(24, 600);
        g.fillText(String(r.tyreAge), X.ageL, cy + 1);
      }
    }

    // Pit stops.
    g.textAlign = 'right';
    g.fillStyle = r.pitStops ? THEME.text : THEME.muted;
    g.font = dfont(26, 600);
    g.fillText(String(r.pitStops || 0), X.pitR - 4, cy + 1);

    // Places gained / lost since the grid (race only).
    const grid = this._grid ? this._grid.get(n) : undefined;
    if (this.data.hasIntervals && grid != null && r.position != null && !out) {
      const dPos = grid - r.position;
      g.font = dfont(24, 700);
      g.fillStyle = dPos > 0 ? THEME.green : dPos < 0 ? THEME.red : THEME.muted;
      g.fillText(dPos > 0 ? `▲${dPos}` : dPos < 0 ? `▼${-dPos}` : '–', X.chgR, cy + 1);
    }

    g.globalAlpha = 1;
  }

  _drawFastest(g, x, cy) {
    g.fillStyle = rgba(THEME.purple, 0.3);
    roundRect(g, x - 4, cy - 19, 38, 38, 10);
    g.fill();
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

/** Small status chip (PIT / DRS) left-aligned at x, centred on cy. Leaves textAlign right. */
function chip(g, x, cy, label, bg, fg) {
  g.font = dfont(18, 700);
  const w = g.measureText(label).width + 16;
  g.fillStyle = rgba(bg, 0.3);
  roundRect(g, x - 3, cy - 16, w + 6, 32, 8);
  g.fill();
  g.fillStyle = bg;
  roundRect(g, x, cy - 13, w, 26, 6);
  g.fill();
  g.fillStyle = fg;
  g.textAlign = 'left';
  g.fillText(label, x + 8, cy + 1);
  g.textAlign = 'right';
}
