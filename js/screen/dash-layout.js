// Desktop dashboard layout (12.2): where each tile goes, for any window shape. Pure (no DOM).
// Screen in VR keeps screen-layout.js; this is the desktop's own, cleaner grid:
//   - a top bar (DOM: Exit, stickers, race control line, weather, toggles) of measured height;
//   - every tile is a card in an aligned grid with even gaps;
//   - the panels in the side columns share one scale s (CSS px per logical canvas px), so text
//     is the same size everywhere; the playback bar is drawn at s too and stretches to the
//     width of its column (PanelHost 'stretch');
//   - the hub (Insights + main screen tabs, 12.4) takes what is left under telemetry.
// Landscape:
//   ┌──────────────────────────── top bar ────────────────────────────┐
//   │ LEADERBOARD │                                     │ TELEMETRY   │
//   │             │               TRACK                 │             │
//   ├─────────────┤                                     ├─────────────┤
//   │ LAPS        ├──────────── playback bar ───────────┤ HUB         │
//   └─────────────┴─────────────────────────────────────┴─────────────┘
// Portrait: top bar, track, playback bar, then leaderboard | telemetry, laps | hub.
// Stack (narrow): one scrolling column. focus 'main' swaps the track and the hub.
// view 'analytics': six charts (2 × 3) with the playback bar under them and a side column
// with a small track over the leaderboard.
import { LAYOUT } from '../panels/layout.js';

export const MIN_SCALE = 0.42;    // smallest panel scale (24 px canvas text -> 10 CSS px)
export const LANDSCAPE_MIN = 1.15;
export const HUB_TABS_H = 44;     // CSS px: the hub's tab row
export const DASH_TILES = ['track', 'playbackBar', 'leaderboard', 'laps', 'telemetry', 'hub'];
export const CHART_TILES = ['chart1', 'chart2', 'chart3', 'chart4', 'chart5', 'chart6'];
export const ANALYTICS_TILES = ['track', 'playbackBar', 'leaderboard', ...CHART_TILES];

const PX = 1024;
const COL_LW = LAYOUT.leaderboard.width * PX;                        // 922 logical px
const LB = LAYOUT.leaderboard.height / LAYOUT.leaderboard.width;     // 4:3 tall
const TEL = LAYOUT.telemetry.height / LAYOUT.telemetry.width;
const LAPS = LAYOUT.laps.height / LAYOUT.laps.width;
const HUB = LAYOUT.insights.height / LAYOUT.insights.width;          // hub content (insights / charts)
const BAR_LH = LAYOUT.playbackBar.height * PX;                       // 246 logical px
const CHART = LAYOUT.insights.height / LAYOUT.insights.width;
const MIN_MIDDLE = 420;
const MIN_TRACK = 0.3;            // portrait: the track keeps at least this share of the height

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rect = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), w: Math.max(0, Math.round(w)), h: Math.max(0, Math.round(h)) });

/**
 * @param {number} width viewport width (CSS px)
 * @param {number} height viewport height (CSS px)
 * @param {{top?: number, gap?: number, focus?: 'track'|'main', view?: 'dashboard'|'analytics'}} [o]
 *   top: the top bar's height (it wraps on narrow windows)
 * @returns {{orientation: 'landscape'|'portrait'|'stack', scale: number, width: number, height: number,
 *   tiles: Record<string, {x:number,y:number,w:number,h:number}>}} height is the content height
 */
export function computeDashLayout(width, height, { top = 52, gap = 10, focus = 'track', view = 'dashboard' } = {}) {
  const W = Math.max(1, width);
  const H = Math.max(1, height);
  const g = gap;
  const y0 = g + top + g;
  let out;
  if (view === 'analytics') out = analytics(W, H, g, y0);
  else out = (W / H >= LANDSCAPE_MIN && landscape(W, H, g, y0)) || portrait(W, H, g, y0) || stack(W, H, g, y0);
  out.tiles.topbar = rect(g, g, W - 2 * g, top);
  if (focus === 'main' && view !== 'analytics') {
    const t = out.tiles.track;
    out.tiles.track = out.tiles.hub;
    out.tiles.hub = t;
  }
  return out;
}

function landscape(W, H, g, y0) {
  const avail = H - y0 - g;
  // Column width: limited by the window width and by both side columns fitting the height.
  let c = Math.min(0.27 * W, (avail - g) / (LB + LAPS), (avail - g - HUB_TABS_H) / (TEL + HUB));
  c = clamp(c, MIN_SCALE * COL_LW, COL_LW);
  const mw = W - 2 * c - 4 * g;
  if (mw < MIN_MIDDLE) return null;
  const s = c / COL_LW;
  const lbH = c * LB, telH = c * TEL;
  const Hc = Math.max(H, y0 + lbH + g + c * LAPS + g, y0 + telH + g + c * HUB + HUB_TABS_H + g);
  const bottom = Hc - g;
  // 8.14: when the side columns scroll (short windows such as a Quest browser window), the track
  // and playback bar still end at the window's bottom, so the controls are on screen.
  const midBottom = Math.max(Math.min(bottom, H - g), y0 + MIN_MIDDLE * 0.5 + BAR_LH * s + g);
  const barH = BAR_LH * s;
  const xl = g, xm = g + c + g, xr = W - g - c;
  return {
    orientation: 'landscape', scale: s, width: W, height: Math.ceil(Hc),
    tiles: {
      leaderboard: rect(xl, y0, c, lbH),
      laps: rect(xl, y0 + lbH + g, c, bottom - (y0 + lbH + g)),
      track: rect(xm, y0, mw, midBottom - barH - g - y0),
      playbackBar: rect(xm, midBottom - barH, mw, barH),
      telemetry: rect(xr, y0, c, telH),
      hub: rect(xr, y0 + telH + g, c, bottom - (y0 + telH + g)),
    },
  };
}

function portrait(W, H, g, y0) {
  const half = (W - 3 * g) / 2;
  if (half < MIN_SCALE * COL_LW) return null;
  const c = Math.min(half, COL_LW);
  const s = c / COL_LW;
  const fw = W - 2 * g;
  const barH = BAR_LH * s;
  const rowA = c * Math.max(LB, TEL);
  const rowB = Math.max(c * LAPS, c * HUB + HUB_TABS_H);
  const below = g + barH + g + rowA + g + rowB + g;
  const trackH = Math.max(MIN_TRACK * H, H - y0 - below);
  const Hc = y0 + trackH + below;
  const tiles = {};
  let y = y0;
  tiles.track = rect(g, y, fw, trackH); y += trackH + g;
  tiles.playbackBar = rect(g, y, fw, barH); y += barH + g;
  const x2 = W - g - half;
  tiles.leaderboard = rect(g, y, half, rowA);
  tiles.telemetry = rect(x2, y, half, rowA); y += rowA + g;
  tiles.laps = rect(g, y, half, rowB);
  tiles.hub = rect(x2, y, half, rowB);
  return { orientation: 'portrait', scale: s, width: W, height: Math.ceil(Math.max(H, Hc)), tiles };
}

function stack(W, H, g, y0) {
  const fw = Math.max(1, W - 2 * g);
  const c = Math.min(fw, COL_LW);
  const s = c / COL_LW;
  const heights = {
    track: Math.max(260, Math.min(fw, H * 0.55)),
    playbackBar: BAR_LH * s,
    leaderboard: c * LB,
    telemetry: c * TEL,
    hub: c * HUB + HUB_TABS_H,
    laps: c * LAPS,
  };
  const tiles = {};
  let y = y0;
  for (const name of ['track', 'playbackBar', 'leaderboard', 'telemetry', 'hub', 'laps']) {
    tiles[name] = rect(g, y, fw, heights[name]);
    y += heights[name] + g;
  }
  return { orientation: 'stack', scale: s, width: W, height: Math.ceil(Math.max(H, y)), tiles };
}

function analytics(W, H, g, y0) {
  if (W / H >= LANDSCAPE_MIN) {
    const avail = H - y0 - g;
    let c = Math.min(0.26 * W, (avail - g) / (0.75 + LB));
    c = clamp(c, MIN_SCALE * COL_LW, COL_LW);
    const mw = W - c - 3 * g;
    const cw = (mw - g) / 2;
    if (cw >= MIN_SCALE * COL_LW) {
      const barS = Math.min(c / COL_LW, cw / COL_LW);
      const barH = BAR_LH * barS;
      const minCharts = 3 * cw * CHART * 0.75 + 2 * g; // charts may letterbox a little
      const Hc = Math.max(H, y0 + minCharts + g + barH + g, y0 + c * 0.75 + g + c * LB * 0.6 + g);
      const ch = (Hc - g - barH - g - y0 - 2 * g) / 3;
      const xr = W - g - c;
      const tiles = {
        playbackBar: rect(g, Hc - g - barH, mw, barH),
        track: rect(xr, y0, c, c * 0.75),
        leaderboard: rect(xr, y0 + c * 0.75 + g, c, Hc - g - (y0 + c * 0.75 + g)),
      };
      CHART_TILES.forEach((name, i) => {
        tiles[name] = rect(g + (i % 2) * (cw + g), y0 + Math.floor(i / 2) * (ch + g), cw, ch);
      });
      return { orientation: 'landscape', scale: cw / COL_LW, width: W, height: Math.ceil(Hc), tiles };
    }
  }
  // Portrait / narrow: one scrolling column.
  const fw = Math.max(1, W - 2 * g);
  const c = Math.min(fw, COL_LW);
  const s = c / COL_LW;
  const heights = { track: Math.max(220, Math.min(fw * 0.6, H * 0.4)), playbackBar: BAR_LH * s };
  for (const name of CHART_TILES) heights[name] = fw * CHART;
  heights.leaderboard = c * LB;
  const tiles = {};
  let y = y0;
  for (const name of ['track', 'playbackBar', ...CHART_TILES, 'leaderboard']) {
    tiles[name] = rect(g, y, fw, heights[name]);
    y += heights[name] + g;
  }
  return { orientation: W / H >= LANDSCAPE_MIN ? 'landscape' : 'stack', scale: s, width: W, height: Math.ceil(Math.max(H, y)), tiles };
}
