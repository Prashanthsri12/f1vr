// Analytics charts, part 1 (9.23 race story, lap times for 9.24 / 9.30): gap to leader, lap
// chart, strategy and lap times. Each chart is { title, draw(g, c), options?, sig? } where c has
// { panel, data, table, upTo, sel, rival, rows, area }. Drawn by analytics-panel.js.
import { THEME, TYRE_COLOURS, dfont, rgba, roundRect, fmtLap } from './panel-base.js';
import { frame, grid, line, dots, band, lapColumns, hoverLap, crosshair, tooltip, emptyNote, niceStep, ticks } from './chart-kit.js';
import { gapSeries, positionSeries, stintBars, lapTimes, paceSummary } from '../analytics/race-pace.js';

const PAD = { l: 58, r: 54, t: 10, b: 34 };
const LETTER = { SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W', UNKNOWN: '?' };

export const teamOf = (data, n) => data.driverByNumber.get(n)?.teamColour || THEME.muted;
export const acrOf = (data, n) => data.driverByNumber.get(n)?.acronym || `#${n}`;

/** Selected driver bold, rival strong, everyone else faint. */
export function emphasis(n, sel, rival) {
  if (n === sel) return { w: 3.2, a: 1, top: 2 };
  if (n === rival) return { w: 2.4, a: 0.95, top: 1 };
  return { w: 1.3, a: 0.26, top: 0 };
}

/** Plot rect inside the chart area. */
export function plotRect(area, pad = PAD) {
  return { x: area.x + pad.l, y: area.y + pad.t, w: area.w - pad.l - pad.r, h: area.h - pad.t - pad.b };
}

/** SC / VSC / red periods as lap ranges (leader laps), clipped to upTo. */
export function neutralLapBands(data, table, upTo) {
  const out = [];
  for (const b of table.bands) {
    if (b.from > upTo) break;
    const a = data.getLeaderLapAt(b.from), z = data.getLeaderLapAt(Math.min(b.to, upTo));
    if (a) out.push({ a: a - 0.5, b: z + 0.5, kind: b.kind });
  }
  return out;
}

const BAND_COLOUR = { sc: THEME.orange, vsc: THEME.yellow, red: THEME.red };
const BAND_LABEL = { sc: 'SC', vsc: 'VSC', red: 'RED' };

function lapAxisMax(data) { return Math.max(2, data.totalLaps || 2); }

/** Lines for every driver, faint ones first, labels at the ends of the emphasised ones. */
function drawSeries(g, f, data, series, sel, rival) {
  const order = [...series.keys()].sort((a, b) => emphasis(a, sel, rival).top - emphasis(b, sel, rival).top);
  for (const n of order) {
    const pts = series.get(n);
    if (!pts.length) continue;
    const e = emphasis(n, sel, rival);
    line(g, f, pts, teamOf(data, n), e.w, e.a);
    if (e.top) {
      const p = pts[pts.length - 1];
      dots(g, f, [p], teamOf(data, n), 4.5);
      g.font = dfont(15, 700);
      g.fillStyle = teamOf(data, n);
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(acrOf(data, n), f.sx(p.lap) + 8, f.sy(p.v));
    }
  }
}

function lapTooltip(g, c, f, lap, rowsFor) {
  if (lap == null) return;
  crosshair(g, f, lap);
  const rows = rowsFor(lap);
  if (rows.length) tooltip(g, f.sx(lap), f.y + 8, `LAP ${lap}`, rows, c.area.x, c.area.y, c.area.w, c.area.h);
}

const gap = {
  title: 'Gap to leader',
  draw(g, c) {
    const { data, table, upTo, sel, rival, panel } = c;
    const series = gapSeries(table, upTo);
    let max = 5, last = 1;
    for (const pts of series.values()) for (const p of pts) { if (p.v < 200) max = Math.max(max, p.v); last = Math.max(last, p.lap); }
    if (last <= 1) return emptyNote(g, c.area.x, c.area.y, c.area.w, c.area.h, 'The gap chart starts after lap 1');
    max = Math.min(max, 150);
    const step = niceStep(max, 5);
    const f = frame(...Object.values(plotRect(c.area)), 1, lapAxisMax(data), 0, Math.ceil(max / step) * step, { invertY: true });
    for (const b of neutralLapBands(data, table, upTo)) band(g, f, b.a, b.b, BAND_COLOUR[b.kind], 0.14, BAND_LABEL[b.kind]);
    grid(g, f, { xt: ticks(0, f.x1, niceStep(f.x1, 6)).filter((v) => v >= 1), yt: ticks(0, f.y1, step), yFmt: (v) => `+${v}` });
    for (const pts of series.values()) for (let i = pts.length - 1; i >= 0; i--) if (pts[i].v > f.y1) pts.splice(i, 1);
    drawSeries(g, f, data, series, sel, rival);
    lapColumns(panel, f, 1, last);
    lapTooltip(g, c, f, hoverLap(panel), (lap) => [...series].map(([n, pts]) => [n, pts.find((p) => p.lap === lap)])
      .filter(([, p]) => p).sort((a, b) => a[1].v - b[1].v).slice(0, 6)
      .map(([n, p]) => [teamOf(data, n), acrOf(data, n), p.v === 0 ? 'Leader' : `+${p.v.toFixed(1)} s`]));
  },
};

const positions = {
  title: 'Lap chart',
  draw(g, c) {
    const { data, table, upTo, sel, rival, panel } = c;
    const series = positionSeries(table, upTo);
    let last = 0;
    for (const pts of series.values()) for (const p of pts) last = Math.max(last, p.lap);
    if (!last) return emptyNote(g, c.area.x, c.area.y, c.area.w, c.area.h, 'Positions appear once the first lap is done');
    const nDrivers = Math.max(2, data.drivers.length);
    const f = frame(...Object.values(plotRect(c.area)), 1, lapAxisMax(data), 0.5, nDrivers + 0.5, { invertY: true });
    for (const b of neutralLapBands(data, table, upTo)) band(g, f, b.a, b.b, BAND_COLOUR[b.kind], 0.14, BAND_LABEL[b.kind]);
    grid(g, f, { xt: ticks(0, f.x1, niceStep(f.x1, 6)).filter((v) => v >= 1), yt: [1, 5, 10, 15, 20].filter((v) => v <= nDrivers), yFmt: (v) => `P${v}` });
    drawSeries(g, f, data, series, sel, rival);
    lapColumns(panel, f, 1, last);
    lapTooltip(g, c, f, hoverLap(panel), (lap) => [...series].map(([n, pts]) => [n, pts.find((p) => p.lap === lap)])
      .filter(([, p]) => p).sort((a, b) => a[1].v - b[1].v).slice(0, 6)
      .map(([n, p]) => [teamOf(data, n), acrOf(data, n), `P${p.v}`]));
  },
};

const strategy = {
  title: 'Strategy',
  draw(g, c) {
    const { data, table, upTo, sel, rival, rows } = c;
    const bars = stintBars(table, upTo);
    const order = rows.map((r) => r.driverNumber).filter((n) => bars.has(n));
    if (!order.length) return emptyNote(g, c.area.x, c.area.y, c.area.w, c.area.h, 'No stints yet');
    const r = plotRect(c.area, { l: 58, r: 14, t: 6, b: 30 });
    const f = frame(r.x, r.y, r.w, r.h, 0.5, lapAxisMax(data) + 0.5, 0, order.length);
    const rh = r.h / order.length;
    grid(g, f, { xt: ticks(0, f.x1, niceStep(f.x1, 6)).filter((v) => v >= 1) });
    order.forEach((n, i) => {
      const y = r.y + i * rh;
      const em = n === sel || n === rival;
      g.font = dfont(Math.min(16, rh * 0.75), 700);
      g.fillStyle = em ? THEME.text : THEME.muted;
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      g.fillText(acrOf(data, n), r.x - 8, y + rh / 2);
      for (const b of bars.get(n)) {
        const x0 = f.sx(b.from - 0.5) + 1, x1 = f.sx(b.to + 0.5) - 1;
        const col = TYRE_COLOURS[b.compound] || TYRE_COLOURS.UNKNOWN;
        g.globalAlpha = em ? 1 : 0.78;
        g.fillStyle = col;
        roundRect(g, x0, y + 2, Math.max(2, x1 - x0), Math.max(3, rh - 4), Math.min(5, rh / 3));
        g.fill();
        g.globalAlpha = 1;
        if (x1 - x0 > 30 && rh >= 12) {
          g.fillStyle = b.compound === 'SOFT' || b.compound === 'WET' ? '#ffffff' : '#111418';
          g.font = dfont(Math.min(14, rh * 0.7), 700);
          g.textAlign = 'left';
          g.fillText(`${LETTER[b.compound] || '?'}${b.to - b.from + 1}`, x0 + 6, y + rh / 2 + 1);
        }
      }
      if (em) {
        g.strokeStyle = rgba(teamOf(data, n), 0.9);
        g.lineWidth = 2;
        roundRect(g, r.x - 2, y + 1, r.w + 4, rh - 2, 5);
        g.stroke();
      }
    });
  },
};

const laptimes = {
  title: 'Lap times',
  draw(g, c) {
    const { data, table, upTo, sel, rival, panel } = c;
    const who = [rival, sel].filter((n) => n != null);
    const all = who.map((n) => [n, lapTimes(table, n, upTo)]);
    const cleanTimes = all.flatMap(([, l]) => l.filter((p) => p.clean).map((p) => p.v));
    if (cleanTimes.length < 2) return emptyNote(g, c.area.x, c.area.y, c.area.w, c.area.h, 'Not enough clean laps yet');
    const lo = Math.min(...cleanTimes), hi = Math.max(...cleanTimes);
    const y0 = Math.floor(lo - 0.5), y1 = Math.ceil(Math.min(hi + 0.8, lo + 6));
    const last = Math.max(...all.flatMap(([, l]) => l.map((p) => p.lap)), 2);
    const f = frame(...Object.values(plotRect(c.area)), 1, data.hasIntervals ? lapAxisMax(data) : last, y0, y1);
    for (const b of data.hasIntervals ? neutralLapBands(data, table, upTo) : []) band(g, f, b.a, b.b, BAND_COLOUR[b.kind], 0.12, BAND_LABEL[b.kind]);
    grid(g, f, { xt: ticks(0, f.x1, niceStep(f.x1, 6)).filter((v) => v >= 1), yt: ticks(y0, y1, niceStep(y1 - y0, 5)), yFmt: (v) => fmtLap(v).replace(/\.\d+$/, '') });
    const pace = paceSummary(table, upTo);
    for (const [n, laps] of all) {
      const e = emphasis(n, sel, rival);
      const col = teamOf(data, n);
      // stint pace: the median clean lap of each stint, as a dashed line over the stint
      for (const s of pace.get(n)?.stints || []) {
        const inStint = laps.filter((p) => p.clean && table.byDriver.get(n).find((r) => r.lap === p.lap)?.stint === s.stint);
        if (inStint.length < 2) continue;
        g.setLineDash([6, 5]);
        line(g, f, [{ x: inStint[0].lap, y: s.median }, { x: inStint[inStint.length - 1].lap, y: s.median }], col, 1.5, 0.8);
        g.setLineDash([]);
      }
      for (const p of laps) {
        if (p.v < y0 || p.v > y1) continue;
        g.globalAlpha = p.clean ? e.a : e.a * 0.35;
        g.fillStyle = TYRE_COLOURS[p.compound] || TYRE_COLOURS.UNKNOWN;
        g.beginPath();
        g.arc(f.sx(p.lap), f.sy(p.v), n === sel ? 5 : 4, 0, Math.PI * 2);
        g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = col;
        g.lineWidth = n === sel ? 2 : 1.2;
        g.stroke();
      }
    }
    lapColumns(panel, f, 1, last);
    lapTooltip(g, c, f, hoverLap(panel), (lap) => all.map(([n, l]) => [n, l.find((p) => p.lap === lap)]).filter(([, p]) => p)
      .map(([n, p]) => [teamOf(data, n), acrOf(data, n), `${fmtLap(p.v)}${p.clean ? '' : ' *'}`]));
    g.font = dfont(14, 600);
    g.fillStyle = THEME.muted;
    g.textAlign = 'right';
    g.textBaseline = 'top';
    g.fillText('dot = lap (tyre colour) · dashed = stint pace · faint / * = not a clean lap', f.x + f.w, f.y + 4);
  },
};

export const CHARTS_A = { gap, positions, strategy, laptimes };
