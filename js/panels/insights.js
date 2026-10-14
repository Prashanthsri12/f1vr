// Insights panel (9.14, 9.16, 9.17): three tabs in one tile under telemetry (layout agreed
// with the user, 9.18).
//   BATTLES      pairs within 1 s (race / sprint): gap, closing / growing over the last laps,
//                a gap sparkline; the selected driver's battle first
//   HEAD-TO-HEAD the selected driver against a rival (the car ahead by default, ◀ ▶ to change):
//                position, gap, last / best lap, last-lap sectors, tyre, stops, top speed
//   DRIVER       headshot (or number tile), team, status, position vs grid, laps led,
//                best lap and its rank, stops, top speed, stints so far
// 0.9 × 0.42 m → 922 × 430 px. Redraws at most 2 Hz, only when the shown values change.
// All numbers come from insights-data.js and are as of the playhead.
import { Panel, THEME, TYRE_COLOURS, font, dfont, glowStroke, roundRect, fmtLap, sticker, stickerSize } from './panel-base.js';
import { LAYOUT } from './layout.js';
import { trackStatusAt } from './race-status.js';
import { gridPositions, drsTimeline, drsEnabledAt, pitLaneAt } from './leaderboard-flags.js';
import {
  findBattles, intervalTrend, trendOf, lapSummary, lapsLed, stintsSoFar, defaultRival, stepRival, gapBetween,
} from './insights-data.js';
import { side, note, chip, spark, LETTER } from './insights-draw.js';

const PAD = 20;
const TOP = 82;            // content starts here
const TABS = [['battle', 'BATTLES'], ['h2h', 'HEAD-TO-HEAD'], ['driver', 'DRIVER']];
const TREND = {
  closing: { label: 'CLOSING', arrow: '▼', colour: THEME.green },
  growing: { label: 'PULLING AWAY', arrow: '▲', colour: THEME.red },
  steady: { label: 'STEADY', arrow: '•', colour: THEME.muted },
};

const sgn = (v, d = 3) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`);

export class InsightsPanel extends Panel {
  /** @param {object} data SessionData */
  constructor(data) {
    const L = LAYOUT.insights;
    super({ name: 'insights', width: L.width, height: L.height, maxHz: 2 });
    this.data = data;
    this.tab = 'battle';
    this.rivalPick = null;
    this._view = null;
    this._sig = '';
    this._grid = null;
    this._drs = null;
    this._inPit = new Set();
    this._shots = new Map();
  }

  // ---------------------------------------------------------------- data
  refresh(ctx) {
    const d = this.data, t = ctx.time, sel = ctx.selected;
    const race = !!d.hasIntervals;
    const rows = d.getLeaderboardAt(t);
    const v = { tab: this.tab, sel, race };
    if (this.tab === 'battle') {
      if (race) {
        pitLaneAt(d.getPitStops ? d.getPitStops() : [], t, this._inPit);
        if (!this._drs) this._drs = drsTimeline(d.getRaceControlAt(Infinity, Infinity) || []);
        const st = trackStatusAt(d, t).status;
        v.drs = (st === 'GREEN' || st === 'YELLOW') && drsEnabledAt(this._drs, t);
        v.battles = findBattles(rows, sel, this._inPit).map((b) => {
          const series = intervalTrend(d, b.behind, t);
          return { ...b, gap: Math.round(b.gap * 100) / 100, trend: trendOf(series), series: series.map((x) => Math.round(x * 100) / 100) };
        });
      }
    } else if (this.tab === 'h2h') {
      const rival = defaultRival(rows, sel, this.rivalPick);
      v.rival = rival;
      const ra = rows.find((r) => r.driverNumber === sel), rb = rows.find((r) => r.driverNumber === rival);
      const ga = gapBetween(ra, rb);
      v.a = side(d, sel, ra, t);
      v.b = rival == null ? null : side(d, rival, rb, t);
      v.gap = ga == null ? null : Math.round(ga * 10) / 10;
    } else {
      const r = rows.find((x) => x.driverNumber === sel);
      if (race && !this._grid) this._grid = gridPositions(d);
      pitLaneAt(d.getPitStops ? d.getPitStops() : [], t, this._inPit);
      const s = side(d, sel, r, t);
      const bests = [];
      for (const dr of d.drivers) { const b = lapSummary(d, dr.number, t).best; if (b != null) bests.push(b); }
      bests.sort((x, y) => x - y);
      v.me = {
        ...s,
        grid: race && this._grid ? this._grid.get(sel) ?? null : null,
        led: race ? lapsLed(d, sel, t) : null,
        rank: s.best == null ? null : bests.indexOf(s.best) + 1,
        out: !!(r && r.retired),
        pit: this._inPit.has(sel),
        stints: stintsSoFar(d.getDriverStints(sel), Math.max(1, (r && r.lapNumber) || 1)),
        shot: this._headshot(sel).ok,
      };
    }
    const sig = JSON.stringify(v);
    if (sig === this._sig) return false;
    this._sig = sig;
    this._view = v;
    return true;
  }

  onHit(hit, ctx) {
    if (hit.id.startsWith('tab:')) { this.tab = hit.payload; this._sig = ''; return; }
    if (hit.id.startsWith('rival:')) {
      const rows = this.data.getLeaderboardAt(ctx.time);
      const cur = defaultRival(rows, ctx.selected, this.rivalPick);
      this.rivalPick = stepRival(rows, ctx.selected, cur, hit.payload);
      this._sig = '';
      return;
    }
    if (hit.id.startsWith('drv:') && hit.payload != null) ctx.actions.selectDriver(hit.payload);
  }

  _headshot(n) {
    let h = this._shots.get(n);
    if (h) return h;
    h = { img: null, ok: false };
    this._shots.set(n, h);
    const dr = this.data.driverByNumber.get(n);
    if (!dr || !dr.headshotUrl || typeof Image === 'undefined') return h;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { h.ok = true; this._sig = ''; this.invalidate(); };
    img.src = dr.headshotUrl;
    h.img = img;
    return h;
  }

  // ---------------------------------------------------------------- drawing
  draw(g, w, h) {
    this.clear(g, w, h);
    const v = this._view;
    if (!v) return;
    this._tabs(g, w);
    if (v.tab === 'battle') this._battles(g, w, h, v);
    else if (v.tab === 'h2h') this._h2h(g, w, h, v);
    else this._driver(g, w, h, v);
  }

  _tabs(g, w) {
    let x = PAD;
    g.textBaseline = 'middle';
    for (const [id, label] of TABS) {
      g.font = dfont(22, 700);
      const tw = g.measureText(label).width + 36;
      const on = this.tab === id;
      const hov = this.hover === `tab:${id}`;
      g.fillStyle = on ? THEME.accent : hov ? THEME.surfaceHi : THEME.surface;
      roundRect(g, x, 18, tw, 46, 23);
      g.fill();
      g.fillStyle = on ? '#ffffff' : THEME.muted;
      g.textAlign = 'center';
      g.fillText(label, x + tw / 2, 42);
      this.addHit(`tab:${id}`, x, 18, tw, 46, id);
      x += tw + 10;
    }
    g.textAlign = 'right';
    g.fillStyle = THEME.muted;
    g.font = font(20, 700);
    g.fillText('INSIGHTS', w - PAD, 42);
  }

  /** Driver acronym as a team-colour sticker (10.6), tilted outwards; clicking selects. */
  _driverTag(g, n, x, y, align, size = 34) {
    const dr = this.data.driverByNumber.get(n);
    const col = dr ? dr.teamColour : THEME.muted;
    const txt = dr ? dr.acronym : `#${n}`;
    const px = Math.round(size * 0.72);
    const { w: sw, h: sh } = stickerSize(g, txt, px);
    const x0 = align === 'right' ? x - sw : x;
    sticker(g, x0, y - sh / 2, txt, { bg: col, px, rot: align === 'right' ? 3 : -3 });
    this.addHit(`drv:${n}`, x0 - 4, y - sh / 2 - 4, sw + 8, sh + 8, n);
  }

  _battles(g, w, h, v) {
    if (!v.race) return note(g, w, h, 'Battles are shown in races and sprints');
    if (!v.battles.length) return note(g, w, h, 'No cars within 1 s of each other right now');
    const rh = 106;
    v.battles.forEach((b, i) => {
      const y = TOP + i * (rh + 8);
      const mine = b.ahead === v.sel || b.behind === v.sel;
      g.fillStyle = THEME.surface;
      roundRect(g, PAD, y, w - 2 * PAD, rh, 12);
      g.fill();
      if (mine) {
        const dr = this.data.driverByNumber.get(v.sel);
        roundRect(g, PAD + 1.5, y + 1.5, w - 2 * PAD - 3, rh - 3, 12);
        glowStroke(g, THEME.select, 3);
      }
      const cy = y + 36;
      g.fillStyle = THEME.muted;
      g.font = dfont(24, 700);
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(`P${b.pos}`, PAD + 18, cy);
      this._driverTag(g, b.ahead, PAD + 86, cy, 'left');
      this._driverTag(g, b.behind, w - PAD - 18, cy, 'right');
      const tr = TREND[b.trend];
      const gx = w / 2 - 40;
      g.textAlign = 'center';
      g.fillStyle = THEME.yellow;
      g.font = dfont(42, 700);
      g.fillText(`${b.gap.toFixed(2)} s`, gx, cy);
      g.font = font(18, 700);
      g.fillStyle = tr.colour;
      g.textAlign = 'left';
      g.fillText(`${tr.arrow} ${tr.label}`, gx + 84, cy + 1);
      if (v.drs) chip(g, gx - 150, cy, 'DRS', THEME.green, '#04140a');
      // Gap over the chaser's last laps (lower = closer), one line across the row.
      spark(g, b.series, PAD + 86, y + 64, w - 2 * PAD - 120, 30, tr.colour);
    });
  }

  _h2h(g, w, h, v) {
    if (!v.b) return note(g, w, h, 'No rival to compare with');
    const cx = w / 2;
    const yh = TOP + 26;
    this._driverTag(g, v.sel, PAD + 10, yh, 'left', 32);
    this._driverTag(g, v.rival, w - PAD - 80, yh, 'right', 32);
    for (const [id, dir, x] of [['rival:-1', -1, w - PAD - 74], ['rival:1', 1, w - PAD - 36]]) {
      const hov = this.hover === id;
      g.fillStyle = hov ? THEME.surfaceHi : THEME.surface;
      roundRect(g, x, yh - 18, 32, 36, 8);
      g.fill();
      g.fillStyle = THEME.text;
      g.font = font(18, 700);
      g.textAlign = 'center';
      g.fillText(dir < 0 ? '◀' : '▶', x + 16, yh + 1);
      this.addHit(id, x, yh - 18, 32, 36, dir);
    }
    g.fillStyle = THEME.muted;
    g.font = font(18, 700);
    g.textAlign = 'center';
    g.fillText('VS', cx, yh);
    const a = v.a, b = v.b;
    const lower = (x, y) => (x == null || y == null ? 0 : x < y ? -1 : x > y ? 1 : 0); // -1: a better
    const rows = [
      ['POSITION', a.pos ? `P${a.pos}` : '–', b.pos ? `P${b.pos}` : '–', lower(a.pos, b.pos)],
      ['GAP', '', v.gap == null ? '–' : `${v.gap >= 0 ? '+' : '−'}${Math.abs(v.gap).toFixed(1)} s`, v.gap == null ? 0 : v.gap > 0 ? -1 : 1],
      ['LAST LAP', fmtLap(a.last), fmtLap(b.last), lower(a.last, b.last)],
      ['BEST LAP', fmtLap(a.best), fmtLap(b.best), lower(a.best, b.best)],
      ['SECTORS Δ (LAST LAP)', '', '', 0],
      ['TYRE', a.tyre, b.tyre, 0],
      ['STOPS · TOP SPEED', `${a.stops} · ${a.top ?? '–'}`, `${b.stops} · ${b.top ?? '–'}`, 0],
    ];
    const rh = 40;
    rows.forEach(([label, va, vb, better], i) => {
      const y = TOP + 64 + i * rh;
      if (i % 2 === 0) { g.fillStyle = THEME.surface; roundRect(g, PAD, y - rh / 2 + 2, w - 2 * PAD, rh - 4, 8); g.fill(); }
      g.fillStyle = THEME.muted;
      g.font = font(17, 700);
      g.textAlign = 'center';
      g.fillText(label, cx, y);
      g.font = dfont(24, 700);
      g.textAlign = 'left';
      g.fillStyle = better < 0 ? THEME.green : THEME.text;
      g.fillText(va, PAD + 16, y + 1);
      g.textAlign = 'right';
      g.fillStyle = better > 0 ? THEME.green : THEME.text;
      g.fillText(vb, w - PAD - 16, y + 1);
    });
    // Sector deltas of the last laps (left: the selected driver's time minus the rival's;
    // green = the selected driver was quicker there), mirrored on the right for the rival.
    const ds = a.sectors.map((x, k) => (x == null || b.sectors[k] == null ? null : x - b.sectors[k]));
    const y = TOP + 64 + 4 * rh;
    g.font = dfont(20, 700);
    for (let k = 0; k < 3; k++) {
      const dd = ds[k];
      const rk = ds[2 - k]; // the right side is drawn from S3 inwards
      const good = dd == null ? THEME.muted : dd < 0 ? THEME.green : dd > 0 ? THEME.red : THEME.muted;
      const bad = rk == null ? THEME.muted : rk > 0 ? THEME.green : rk < 0 ? THEME.red : THEME.muted;
      g.textAlign = 'left';
      g.fillStyle = good;
      g.fillText(`S${k + 1} ${sgn(dd, 2)}`, PAD + 16 + k * 98, y + 1);
      g.textAlign = 'right';
      g.fillStyle = bad;
      g.fillText(`S${3 - k} ${sgn(ds[2 - k] == null ? null : -ds[2 - k], 2)}`, w - PAD - 16 - k * 98, y + 1);
    }
  }

  _driver(g, w, h, v) {
    const m = v.me;
    const dr = this.data.driverByNumber.get(v.sel);
    if (!dr) return note(g, w, h, 'No driver selected');
    const col = dr.teamColour;
    const tile = 132, tx = PAD, ty = TOP;
    g.save();
    roundRect(g, tx, ty, tile, tile, 14);
    g.clip();
    g.fillStyle = col;
    g.fillRect(tx, ty, tile, tile);
    const hs = this._shots.get(v.sel);
    if (hs && hs.ok) {
      const img = hs.img;
      const sz = Math.min(img.naturalWidth, img.naturalHeight) || 1;
      g.drawImage(img, (img.naturalWidth - sz) / 2, 0, sz, sz, tx, ty, tile, tile);
    } else {
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = dfont(64, 700);
      g.fillText(String(dr.number), tx + tile / 2, ty + tile / 2);
    }
    g.restore();
    const x = tx + tile + 22;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = THEME.text;
    g.font = dfont(34, 700);
    g.fillText((dr.fullName || dr.acronym).toUpperCase(), x, ty + 32);
    sticker(g, x, ty + 44, dr.teamName || String(dr.number), { bg: col, px: 18, rot: -2 });
    const status = m.out ? ['OUT', THEME.muted, '#ffffff'] : m.pit ? ['IN THE PITS', THEME.blue, '#ffffff'] : ['RUNNING', THEME.green, '#04140a'];
    chip(g, x, ty + 92, status[0], status[1], status[2]);
    // Stats grid (3 × 2) to the right of the photo.
    const delta = m.grid != null && m.pos != null ? m.grid - m.pos : null;
    const stats = [
      ['POSITION', m.pos ? `P${m.pos}` : '–', delta == null ? '' : delta > 0 ? `▲${delta} from P${m.grid}` : delta < 0 ? `▼${-delta} from P${m.grid}` : `= grid P${m.grid}`],
      ['BEST LAP', fmtLap(m.best), m.rank ? `#${m.rank} of the field` : ''],
      ['LAPS LED', m.led == null ? '–' : String(m.led), ''],
      ['STOPS', String(m.stops), m.tyre !== '–' ? `on ${m.tyre}` : ''],
      ['TOP SPEED', m.top == null ? '–' : `${m.top}`, m.top == null ? '' : 'km/h'],
      ['LAPS DONE', String(m.lapsDone), ''],
    ];
    const gx = PAD, gy = ty + tile + 14, gw = (w - 2 * PAD - 2 * 10) / 3, gh = 74;
    stats.forEach(([label, val, sub], i) => {
      const cx = gx + (i % 3) * (gw + 10), cy = gy + Math.floor(i / 3) * (gh + 8);
      if (cy + gh > h - 4) return;
      g.fillStyle = THEME.surface;
      roundRect(g, cx, cy, gw, gh, 10);
      g.fill();
      g.fillStyle = THEME.muted;
      g.font = font(16, 700);
      g.textAlign = 'left';
      g.fillText(label, cx + 12, cy + 22);
      g.fillStyle = THEME.text;
      g.font = dfont(28, 700);
      g.fillText(val, cx + 12, cy + 56);
      if (sub) {
        g.font = font(16, 600);
        g.fillStyle = sub.startsWith('▲') ? THEME.green : sub.startsWith('▼') ? THEME.red : THEME.muted;
        g.textAlign = 'right';
        g.fillText(sub, cx + gw - 12, cy + 56);
      }
    });
    // Stints so far, compact, beside the status chip.
    let sx = x + 230;
    g.textBaseline = 'middle';
    g.font = font(16, 700);
    g.fillStyle = THEME.muted;
    g.textAlign = 'left';
    g.fillText('STINTS', x + 160, ty + 92);
    for (const s of m.stints) {
      const c = TYRE_COLOURS[s.compound] || TYRE_COLOURS.UNKNOWN;
      const lbl = `${LETTER[s.compound] || '?'} ${s.laps}`;
      g.font = dfont(18, 700);
      const sw = g.measureText(lbl).width + 18;
      if (sx + sw > w - PAD) break;
      g.fillStyle = c;
      roundRect(g, sx, ty + 78, sw, 28, 6);
      g.fill();
      if (s.current) { roundRect(g, sx, ty + 78, sw, 28, 6); glowStroke(g, '#ffffff', 2, 2); }
      g.fillStyle = s.compound === 'SOFT' || s.compound === 'WET' ? '#ffffff' : '#111418';
      g.fillText(lbl, sx + 9, ty + 93);
      sx += sw + 6;
    }
  }
}
