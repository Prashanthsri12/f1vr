// Drawing helpers and the per-driver summary for the Insights panel (insights.js).
import { THEME, font, dfont, roundRect, glowStroke } from './panel-base.js';
import { lapSummary } from './insights-data.js';

export const LETTER = { SOFT: 'S', MEDIUM: 'M', HARD: 'H', INTERMEDIATE: 'I', WET: 'W' };
const TOP = 82;

/** Values for one side of head-to-head / the driver card. */
export function side(d, n, row, t) {
  const s = lapSummary(d, n, t);
  return {
    pos: row ? row.position : null,
    last: s.last == null ? null : Math.round(s.last * 1000) / 1000,
    best: s.best == null ? null : Math.round(s.best * 1000) / 1000,
    sectors: s.sectors,
    tyre: row && row.compound ? `${LETTER[row.compound] || '?'}${row.tyreAge != null ? ` ${row.tyreAge}` : ''}` : '–',
    stops: row ? row.pitStops || 0 : 0,
    top: s.topSpeed == null ? null : Math.round(s.topSpeed),
    lapsDone: s.lapsDone,
  };
}

export function note(g, w, h, msg) {
  g.fillStyle = THEME.muted;
  g.font = font(24, 600);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(msg, w / 2, (TOP + h) / 2);
}

export function chip(g, x, cy, label, bg, fg) {
  g.font = dfont(16, 700);
  const w = g.measureText(label).width + 16;
  g.fillStyle = bg;
  roundRect(g, x, cy - 12, w, 24, 6);
  g.fill();
  g.fillStyle = fg;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.fillText(label, x + 8, cy + 1);
}

/** Gap sparkline (inverted: a closing gap goes down), endpoint dot. */
export function spark(g, series, x, y, w, h, colour) {
  if (!series || series.length < 2) return;
  let lo = Infinity, hi = -Infinity;
  for (const v of series) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi - lo < 0.2) { const m = (hi + lo) / 2; lo = m - 0.1; hi = m + 0.1; }
  g.beginPath();
  series.forEach((v, i) => {
    const px = x + (i / (series.length - 1)) * w;
    const py = y + h - ((v - lo) / (hi - lo)) * h;
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  });
  g.lineJoin = 'round';
  glowStroke(g, colour, 2.5, 3);
  const last = series[series.length - 1];
  g.fillStyle = colour;
  g.beginPath();
  g.arc(x + w, y + h - ((last - lo) / (hi - lo)) * h, 4, 0, Math.PI * 2);
  g.fill();
}
