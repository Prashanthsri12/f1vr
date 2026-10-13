// Canvas chart helpers for the analytics panels (9.22): a frame (scales), grid and axis labels,
// lines, dots, bars, shaded bands, per-lap hit columns (hover = tooltip, click = jump) and a
// tooltip box. Drawing only happens in Panel.draw (≤10 Hz, on change), so small allocations
// here are fine. Colours and fonts come from panel-base THEME.
import { THEME, font, dfont, rgba, roundRect } from './panel-base.js';

/** A "nice" tick step for a range (1, 2, 5 × 10^k). */
export function niceStep(range, target = 5) {
  if (!(range > 0)) return 1;
  const raw = range / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

/** Ticks from lo to hi at `step`, starting at a multiple of step. */
export function ticks(lo, hi, step) {
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/**
 * Plot area and scales.
 * @returns {{x:number, y:number, w:number, h:number, sx:(v:number)=>number, sy:(v:number)=>number,
 *   ix:(px:number)=>number, x0:number, x1:number, y0:number, y1:number}}
 */
export function frame(x, y, w, h, x0, x1, y0, y1, { invertY = false } = {}) {
  const dx = x1 - x0 || 1, dy = y1 - y0 || 1;
  return {
    x, y, w, h, x0, x1, y0, y1,
    sx: (v) => x + ((v - x0) / dx) * w,
    sy: (v) => (invertY ? y + ((v - y0) / dy) * h : y + h - ((v - y0) / dy) * h),
    ix: (px) => x0 + ((px - x) / w) * dx,
  };
}

/** Grid lines with labels: y on the left, x below. */
export function grid(g, f, { xt = [], yt = [], xFmt = String, yFmt = String } = {}) {
  g.font = dfont(16, 600);
  g.textBaseline = 'middle';
  g.textAlign = 'right';
  for (const v of yt) {
    const y = Math.round(f.sy(v)) + 0.5;
    g.fillStyle = 'rgba(140,160,200,0.12)';
    g.fillRect(f.x, y, f.w, 1);
    g.fillStyle = THEME.muted;
    g.fillText(yFmt(v), f.x - 8, y);
  }
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (const v of xt) {
    g.fillStyle = THEME.muted;
    g.fillText(xFmt(v), f.sx(v), f.y + f.h + 6);
  }
}

/** Polyline through pts ({x, y} or {lap, v}). */
export function line(g, f, pts, colour, width = 2, alpha = 1) {
  if (!pts || pts.length < 1) return;
  g.globalAlpha = alpha;
  g.strokeStyle = colour;
  g.lineWidth = width;
  g.lineJoin = 'round';
  g.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const px = f.sx(p.x ?? p.lap), py = f.sy(p.y ?? p.v);
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.stroke();
  g.globalAlpha = 1;
}

/** Filled dots. */
export function dots(g, f, pts, colour, r = 3, alpha = 1) {
  g.globalAlpha = alpha;
  g.fillStyle = colour;
  for (const p of pts) {
    g.beginPath();
    g.arc(f.sx(p.x ?? p.lap), f.sy(p.y ?? p.v), r, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** Vertical band from x a to x b (data units), full plot height. */
export function band(g, f, a, b, colour, alpha = 0.14, label = '') {
  const x0 = f.sx(a), x1 = f.sx(b);
  g.fillStyle = rgba(colour, alpha);
  g.fillRect(x0, f.y, Math.max(2, x1 - x0), f.h);
  if (label) {
    g.fillStyle = colour;
    g.font = dfont(14, 700);
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillText(label, (x0 + x1) / 2, f.y + 2);
  }
}

/** Horizontal bar (for rankings): from x0 to x1 data units at row y (px), height h px. */
export function hbar(g, f, v0, v1, y, h, colour) {
  const a = f.sx(v0), b = f.sx(v1);
  g.fillStyle = colour;
  roundRect(g, Math.min(a, b), y, Math.max(2, Math.abs(b - a)), h, Math.min(6, h / 2));
  g.fill();
}

/** One clickable / hoverable column per integer x (lap) in [from, to]: ids `${prefix}:${lap}`. */
export function lapColumns(panel, f, from, to, prefix = 'lap') {
  const step = f.w / Math.max(1, f.x1 - f.x0);
  for (let lap = Math.max(from, Math.ceil(f.x0)); lap <= to; lap++) {
    panel.addHit(`${prefix}:${lap}`, f.sx(lap) - step / 2, f.y, step, f.h, lap);
  }
}

/** Lap number under the panel's hover id ('lap:12' -> 12), or null. */
export function hoverLap(panel, prefix = 'lap') {
  const h = panel.hover;
  if (!h || !h.startsWith(`${prefix}:`)) return null;
  const n = Number(h.slice(prefix.length + 1));
  return Number.isFinite(n) ? n : null;
}

/** Crosshair at data x. */
export function crosshair(g, f, x) {
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.fillRect(Math.round(f.sx(x)), f.y, 1.5, f.h);
}

/**
 * Tooltip box near (x, y), kept inside [bx, by, bw, bh].
 * @param {Array<[string, string, string]>} rows [colour, label, value]
 */
export function tooltip(g, x, y, title, rows, bx, by, bw, bh) {
  g.font = dfont(17, 700);
  let w = g.measureText(title).width;
  g.font = font(16, 600);
  for (const [, l, v] of rows) w = Math.max(w, g.measureText(`${l}  ${v}`).width + 26);
  w += 24;
  const h = 34 + rows.length * 22;
  let tx = x + 14, ty = y + 10;
  if (tx + w > bx + bw) tx = x - 14 - w;
  if (ty + h > by + bh) ty = by + bh - h;
  if (ty < by) ty = by;
  g.fillStyle = 'rgba(9,12,19,0.94)';
  roundRect(g, tx, ty, w, h, 10);
  g.fill();
  g.strokeStyle = THEME.rim;
  g.lineWidth = 1.5;
  g.stroke();
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.fillStyle = THEME.text;
  g.font = dfont(17, 700);
  g.fillText(title, tx + 12, ty + 17);
  g.font = font(16, 600);
  rows.forEach(([c, l, v], i) => {
    const ry = ty + 40 + i * 22;
    g.fillStyle = c;
    g.fillRect(tx + 12, ry - 5, 10, 10);
    g.fillStyle = THEME.muted;
    g.fillText(l, tx + 28, ry);
    g.fillStyle = THEME.text;
    g.textAlign = 'right';
    g.fillText(v, tx + w - 12, ry);
    g.textAlign = 'left';
  });
}

/** Small text note in the plot area (empty states). */
export function emptyNote(g, x, y, w, h, msg) {
  g.fillStyle = THEME.muted;
  g.font = font(20, 600);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(msg, x + w / 2, y + h / 2);
}
