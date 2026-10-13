// Analytics charts, part 2: tyre degradation (9.24), pace / consistency / theoretical best
// (9.24, 9.30), long runs (9.30), strategy tools (9.25) and the driver comparison (9.26).
import { THEME, TYRE_COLOURS, font, dfont, roundRect, fmtLap } from './panel-base.js';
import { frame, grid, line, dots, hbar, emptyNote, niceStep, ticks } from './chart-kit.js';
import { degradation, paceSummary, longRuns, FUEL_S_PER_LAP } from '../analytics/race-pace.js';
import { pitLoss, rejoin, undercuts, compareTraces, pickLap } from '../analytics/strategy.js';
import { plotRect, teamOf, acrOf } from './analytics-charts.js';

const COMPOUND_NAME = { SOFT: 'Soft', MEDIUM: 'Medium', HARD: 'Hard', INTERMEDIATE: 'Inter', WET: 'Wet', UNKNOWN: '?' };
const sgn = (v, d = 2) => (v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`);

function text(g, s, x, y, { size = 16, weight = 600, colour = THEME.text, align = 'left', display = false } = {}) {
  g.font = display ? dfont(size, weight) : font(size, weight);
  g.fillStyle = colour;
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillText(s, x, y);
}

const deg = {
  title: 'Tyre degradation',
  options(panel, g, x) { return panel._chip(g, 'fuel', x, panel.fuel ? 'FUEL-CORRECTED' : 'RAW', panel.fuel); },
  draw(g, c) {
    const { data, table, upTo, sel, panel } = c;
    const by = degradation(table, upTo, { fuel: panel.fuel });
    if (!by.size) return emptyNote(g, c.area.x, c.area.y, c.area.w, c.area.h, 'Not enough clean laps yet');
    let xMax = 10;
    for (const v of by.values()) for (const p of v.points) xMax = Math.max(xMax, p.x);
    const r = plotRect(c.area, { l: 58, r: 70, t: 10, b: 58 });
    const f = frame(r.x, r.y, r.w, r.h, 0, xMax + 1, -1, 2);
    grid(g, f, { xt: ticks(0, xMax, niceStep(xMax, 6)), yt: [-1, -0.5, 0, 0.5, 1, 1.5, 2], yFmt: (v) => sgn(v, 1) });
    text(g, 'tyre age (laps) →', r.x + r.w, r.y + r.h + 24, { size: 14, colour: THEME.muted, align: 'right' });
    const notes = [];
    for (const [cmp, v] of by) {
      const col = TYRE_COLOURS[cmp] || TYRE_COLOURS.UNKNOWN;
      dots(g, f, v.points.filter((p) => p.driver !== sel), col, 2.2, 0.28);
      dots(g, f, v.points.filter((p) => p.driver === sel), col, 4.5, 1);
      if (v.slope != null) {
        const xs = v.points.map((p) => p.x);
        const a = Math.min(...xs), b = Math.max(...xs);
        line(g, f, [{ x: a, y: v.a + v.slope * a }, { x: b, y: v.a + v.slope * b }], col, 3, 1);
        text(g, `${sgn(v.slope)}`, f.sx(b) + 6, f.sy(v.a + v.slope * b), { size: 15, weight: 700, colour: col, display: true });
        notes.push([col, `${COMPOUND_NAME[cmp] || cmp} ${sgn(v.slope)} s/lap`]);
      }
    }
    let nx = r.x;
    for (const [col, s] of notes) { text(g, s, nx, c.area.y + c.area.h - 16, { size: 15, weight: 700, colour: col }); g.font = font(15, 700); nx += g.measureText(s).width + 22; }
    text(g, panel.fuel ? `Fuel burn removed (estimate ${FUEL_S_PER_LAP} s/lap)` : 'Raw: fuel burn hides part of the tyre wear',
      c.area.x + c.area.w - 14, c.area.y + c.area.h - 16, { size: 14, colour: THEME.muted, align: 'right' });
    text(g, `Lap time vs the driver's typical clean lap · big dots: ${acrOf(data, sel)}`, r.x + 4, r.y + 12, { size: 14, colour: THEME.muted });
  },
};

const pace = {
  title: 'Pace and consistency',
  draw(g, c) {
    const { data, table, upTo, sel, rival, rows } = c;
    const p = paceSummary(table, upTo);
    const list = [...p].filter(([, v]) => v.best != null).sort((a, b) => a[1].best - b[1].best);
    if (!list.length) return emptyNote(g, c.area.x, c.area.y, c.area.w, c.area.h, 'No lap times yet');
    const top = list[0][1].best;
    const x = c.area.x + 18, w = c.area.w - 36;
    const cols = [0, 0.11, 0.33, 0.55, 0.74, 0.88].map((k) => x + k * w);
    const y0 = c.area.y + 16;
    ['DRIVER', 'BEST LAP', 'THEORETICAL', 'CONSISTENCY σ', 'CLEAN LAPS', 'LAST STINT PACE'].forEach((h, i) =>
      text(g, h, cols[i], y0, { size: 13, weight: 700, colour: THEME.muted }));
    const rh = Math.max(22, Math.min(30, (c.area.h - 40) / Math.min(list.length, 20)));
    const maxRows = Math.floor((c.area.h - 40) / rh);
    const shown = list.slice(0, maxRows);
    if (!shown.some(([n]) => n === sel)) { const me = list.find(([n]) => n === sel); if (me) shown[shown.length - 1] = me; }
    void rows;
    shown.forEach(([n, v], i) => {
      const y = y0 + 24 + i * rh;
      const em = n === sel || n === rival;
      if (em) { g.fillStyle = THEME.surfaceHi; roundRect(g, x - 8, y - rh / 2 + 1, w + 16, rh - 2, 6); g.fill(); }
      g.fillStyle = teamOf(data, n);
      g.fillRect(cols[0], y - 8, 5, 16);
      text(g, acrOf(data, n), cols[0] + 12, y, { size: 17, weight: 700, display: true });
      text(g, `${fmtLap(v.best)}  ${v.best === top ? '' : `+${(v.best - top).toFixed(3)}`}`, cols[1], y, { size: 16, weight: 700, display: true, colour: v.best === top ? THEME.purple : THEME.text });
      text(g, v.theory == null ? '–' : `${fmtLap(v.theory)}  ${sgn(v.theory - v.best, 3)}`, cols[2], y, { size: 16, weight: 600, display: true, colour: THEME.muted });
      text(g, v.sigma == null ? '–' : `${v.sigma.toFixed(3)} s`, cols[3], y, { size: 16, weight: 700, display: true });
      text(g, String(v.clean), cols[4], y, { size: 16, weight: 600, display: true, colour: THEME.muted });
      let sx = cols[5];
      for (const s of v.stints.slice(-1)) {
        const lbl = fmtLap(s.median);
        g.font = dfont(14, 700);
        const sw = g.measureText(lbl).width + 14;
        if (sx + sw > x + w) break;
        g.fillStyle = TYRE_COLOURS[s.compound] || TYRE_COLOURS.UNKNOWN;
        roundRect(g, sx, y - 10, sw, 20, 5);
        g.fill();
        text(g, lbl, sx + 7, y + 1, { size: 14, weight: 700, display: true, colour: s.compound === 'SOFT' || s.compound === 'WET' ? '#ffffff' : '#111418' });
        sx += sw + 4;
      }
    });
  },
};

const longrun = {
  title: 'Long-run pace',
  draw(g, c) {
    const { data, table, upTo, sel, rival } = c;
    const list = longRuns(table, upTo, 5);
    if (!list.length) return emptyNote(g, c.area.x, c.area.y, c.area.w, c.area.h, 'No runs of 5+ clean laps yet');
    const best = list[0].median;
    const worst = Math.min(list[list.length - 1].median, best + 3);
    const r = plotRect(c.area, { l: 120, r: 120, t: 18, b: 12 });
    const f = frame(r.x, r.y, r.w, r.h, 0, Math.max(0.5, worst - best), 0, 1);
    const rh = Math.min(28, r.h / list.length);
    list.slice(0, Math.floor(r.h / rh)).forEach((v, i) => {
      const y = r.y + i * rh;
      const em = v.driver === sel || v.driver === rival;
      text(g, acrOf(data, v.driver), r.x - 70, y + rh / 2, { size: 16, weight: 700, display: true, colour: em ? THEME.text : THEME.muted });
      g.fillStyle = TYRE_COLOURS[v.compound] || TYRE_COLOURS.UNKNOWN;
      g.beginPath(); g.arc(r.x - 20, y + rh / 2, 7, 0, Math.PI * 2); g.fill();
      hbar(g, f, 0, Math.max(0.02, v.median - best), y + 4, rh - 8, em ? teamOf(data, v.driver) : 'rgba(140,160,200,0.45)');
      text(g, `${fmtLap(v.median)} · ${v.laps} laps`, r.x + r.w + 8, y + rh / 2, { size: 14, weight: 600, display: true });
    });
    text(g, 'Each driver\'s longest run of clean laps (5+), median lap; bar = gap to the quickest run (fuel loads unknown)', r.x - 100, c.area.y + 8, { size: 13, colour: THEME.muted });
  },
};

const tools = {
  title: 'Strategy tools',
  draw(g, c) {
    const { data, table, upTo, sel, rows } = c;
    const pl = pitLoss(table, upTo);
    const rj = rejoin(rows, sel, pl.loss);
    const x = c.area.x + 18, w = c.area.w - 36, y = c.area.y + 10;
    const kw = (w - 20) / 3, kh = 96;
    const kpi = (i, label, value, sub) => {
      const kx = x + i * (kw + 10);
      g.fillStyle = THEME.surface;
      roundRect(g, kx, y, kw, kh, 10);
      g.fill();
      text(g, label, kx + 14, y + 20, { size: 13, weight: 700, colour: THEME.muted });
      text(g, value, kx + 14, y + 52, { size: 30, weight: 700, display: true });
      text(g, sub, kx + 14, y + 80, { size: 14, colour: THEME.muted });
    };
    kpi(0, 'PIT LOSS', pl.loss == null ? '–' : `${pl.loss.toFixed(1)} s`, pl.stops ? `from ${pl.stops} stops so far` : 'no clean stops yet');
    kpi(1, `IF ${acrOf(data, sel)} PITS NOW`, rj ? `P${rj.pos}` : '–', rj ? `was P${rj.was}` : 'needs a pit loss and a gap');
    kpi(2, 'REJOINS BETWEEN', rj ? `${rj.ahead ? acrOf(data, rj.ahead.n) : '—'} · ${rj.behind ? acrOf(data, rj.behind.n) : '—'}` : '–',
      rj ? `${rj.ahead ? `${rj.ahead.by.toFixed(1)} s behind` : 'in the lead'}${rj.behind ? `, ${rj.behind.by.toFixed(1)} s ahead` : ''}` : '');
    text(g, 'UNDERCUT / OVERCUT', x, y + kh + 26, { size: 13, weight: 700, colour: THEME.muted });
    const list = undercuts(table, upTo);
    const lh = 30;
    const maxRows = Math.floor((c.area.y + c.area.h - (y + kh + 44)) / lh);
    if (!list.length) text(g, 'No pit battles yet', x, y + kh + 58, { size: 16, colour: THEME.muted });
    list.slice(0, Math.max(0, maxRows)).forEach((u, i) => {
      const ly = y + kh + 56 + i * lh;
      g.fillStyle = i % 2 ? 'transparent' : THEME.surface;
      roundRect(g, x - 6, ly - lh / 2 + 2, w + 12, lh - 4, 6);
      g.fill();
      text(g, `L${u.lap}`, x, ly, { size: 14, weight: 700, display: true, colour: THEME.muted });
      text(g, `${acrOf(data, u.first)} ${u.kind === 'undercut' ? 'undercuts' : 'covers'} ${acrOf(data, u.second)}`, x + 60, ly, { size: 16, weight: 600 });
      const res = u.worked ? (u.kind === 'undercut' ? 'now ahead' : 'stayed ahead') : (u.kind === 'undercut' ? 'still behind' : 'lost the place');
      text(g, `${u.swing >= 0 ? 'gained' : 'lost'} ${Math.abs(u.swing).toFixed(1)} s · ${res}`, x + w, ly, { size: 15, weight: 700, align: 'right', colour: u.worked ? THEME.green : THEME.red });
    });
  },
};

const compare = {
  title: 'Driver comparison',
  options(panel, g, x, c) {
    x = panel._chip(g, 'which', x, panel.which === 'best' ? 'FASTEST LAPS' : 'LAST LAPS', false);
    x = panel._chip(g, 'rival', x, `vs ${acrOf(panel.data, c.rival)} ▶`, false, 1);
    return x;
  },
  sig(panel, table, upTo, sel, rival) {
    const a = pickLap(table, sel, upTo, panel.which), b = pickLap(table, rival, upTo, panel.which);
    const ta = a && panel.traces.getTrace(panel.data, sel, a.lap), tb = b && panel.traces.getTrace(panel.data, rival, b.lap);
    return `${a?.lap}|${b?.lap}|${!!ta}|${!!tb}`;
  },
  draw(g, c) {
    const { data, table, upTo, sel, rival, panel } = c;
    const la = pickLap(table, sel, upTo, panel.which), lb = pickLap(table, rival, upTo, panel.which);
    if (!la || !lb) return emptyNote(g, c.area.x, c.area.y, c.area.w, c.area.h, 'Both drivers need a completed lap');
    const ta = panel.traces.getTrace(data, sel, la.lap), tb = panel.traces.getTrace(data, rival, lb.lap);
    const cmp = compareTraces(ta, tb);
    const ca = teamOf(data, sel), cb = teamOf(data, rival);
    const same = ca === cb;
    const r = plotRect(c.area, { l: 58, r: 70, t: 26, b: 92 });
    text(g, `${acrOf(data, sel)} lap ${la.lap} ${fmtLap(la.time)}`, r.x, c.area.y + 10, { size: 15, weight: 700, colour: ca, display: true });
    text(g, `${acrOf(data, rival)} lap ${lb.lap} ${fmtLap(lb.time)}${same ? ' (dashed)' : ''}`, r.x + r.w, c.area.y + 10, { size: 15, weight: 700, colour: cb, display: true, align: 'right' });
    if (!cmp) return emptyNote(g, r.x, r.y, r.w, r.h, ta && tb ? 'No usable car data for these laps' : 'Loading car data…');
    const f = frame(r.x, r.y, r.w, r.h, 0, 1, 50, 350);
    const km = cmp.lengthM / 1000;
    grid(g, f, { xt: [0, 0.25, 0.5, 0.75, 1], xFmt: (v) => (v * km).toFixed(1), yt: [100, 200, 300] });
    const pts = (arr) => Array.from(arr, (v, i) => ({ x: cmp.frac[i], y: v }));
    if (same) g.setLineDash([7, 5]);
    line(g, f, pts(cmp.vb), cb, 2, 0.95);
    g.setLineDash([]);
    line(g, f, pts(cmp.va), ca, 2.4, 1);
    // Time delta strip (A − B; below zero = A ahead) and the sector / speed trap summary.
    const dy = r.y + r.h + 24, dh = 34;
    const lim = Math.max(0.2, ...Array.from(cmp.delta, (v) => Math.abs(v)));
    const fd = frame(r.x, dy, r.w, dh, 0, 1, -lim, lim, { invertY: true });
    g.fillStyle = 'rgba(140,160,200,0.25)';
    g.fillRect(r.x, fd.sy(0), r.w, 1);
    line(g, fd, Array.from(cmp.delta, (v, i) => ({ x: cmp.frac[i], y: v })), '#ffffff', 1.8, 1);
    const end = cmp.delta[cmp.delta.length - 1];
    text(g, `${sgn(end, 2)} s`, r.x + r.w + 6, fd.sy(end), { size: 14, weight: 700, display: true });
    text(g, `${acrOf(data, sel)} ahead`, r.x + 4, dy + 6, { size: 12, weight: 700, colour: ca });
    text(g, `${acrOf(data, rival)} ahead`, r.x + 4, dy + dh - 4, { size: 12, weight: 700, colour: cb });
    text(g, 'GAP', r.x - 10, dy + dh / 2, { size: 13, weight: 700, colour: THEME.muted, align: 'right' });
    const sd = la.s.map((v, k) => (v == null || lb.s[k] == null ? null : v - lb.s[k]));
    let sx = r.x;
    const sy = c.area.y + c.area.h - 14;
    for (let k = 0; k < 3; k++) {
      const s = `S${k + 1} ${sgn(sd[k], 3)}`;
      text(g, s, sx, sy, { size: 15, weight: 700, display: true, colour: sd[k] == null ? THEME.muted : sd[k] < 0 ? THEME.green : THEME.red });
      g.font = dfont(15, 700);
      sx += g.measureText(s).width + 18;
    }
    text(g, `Speed traps  I1 ${la.i1 ?? '–'} / ${lb.i1 ?? '–'} · I2 ${la.i2 ?? '–'} / ${lb.i2 ?? '–'} · ST ${la.st ?? '–'} / ${lb.st ?? '–'} km/h`,
      r.x + r.w, sy, { size: 14, weight: 600, colour: THEME.muted, align: 'right' });
  },
};

export const CHARTS_B = { deg, pace, longrun, tools, compare };
