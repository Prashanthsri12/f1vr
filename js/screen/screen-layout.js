// Screen mode layout (8.2, 8.4): where each tile of the dashboard goes, for any window shape.
// Pure (no DOM, no three.js): the desktop dashboard and, later, Screen in VR both use it.
//
// The panels are canvases with fixed designs (sizes from LAYOUT, 1024 px per metre), so a tile
// is sized to its panel's aspect wherever possible and the panel is drawn at one shared scale
// `s` (CSS px per logical canvas px). s never drops below MIN_SCALE, so text stays readable;
// when the window is too small for that, the content grows taller than the window and the
// dashboard scrolls.
//
// Landscape (width / height >= LANDSCAPE_MIN), with the Insights tile under telemetry and
// the main screen and weather sharing the last row (9.18, agreed with the user):
//   ┌──────────┬──────────── ticker strip ───────────┬───────────┐
//   │ LEADER-  │                                     │ TELEMETRY │
//   │ BOARD    │            TRACK (big)              │           │
//   │          │                                     ├───────────┤
//   ├──────────┤                                     │ INSIGHTS  │
//   │ LAPS     │                                     ├──────┬────┤
//   │          ├──────────── playback bar ───────────┤ MAIN │ WX │
//   └──────────┴─────────────────────────────────────┴──────┴────┘
// Portrait: ticker, track, playback bar, then leaderboard | telemetry, laps | main,
// insights | weather.
// Stack (narrow windows): one column, scrolling.
// focus 'main' swaps the track and main tiles (8.7 "Video focus").
// view 'analytics' (9.28, the approved mockup): six chart tiles in a 2 × 3 grid with the ticker
// above and the playback bar below, and a side column with a small track and the leaderboard:
//   ┌──── ticker ─────────────┬─ TRACK ─┐
//   │ CHART1     │ CHART2     │         │
//   │ CHART3     │ CHART4     ├─────────┤
//   │ CHART5     │ CHART6     │ LEADER- │
//   ├──── playback bar ───────┤ BOARD   │
//   └─────────────────────────┴─────────┘
import { LAYOUT } from '../panels/layout.js';

export const MIN_SCALE = 0.42;     // smallest panel scale (24 px canvas text -> 10 CSS px)
export const MAX_SCALE = 1;
export const LANDSCAPE_MIN = 1.15; // width / height at or above which the landscape layout is used
export const TILE_NAMES = ['ticker', 'track', 'leaderboard', 'telemetry', 'laps', 'weather', 'main', 'playbackBar', 'insights'];
/** Chart tiles of the analytics view (9.28). */
export const CHART_TILES = ['chart1', 'chart2', 'chart3', 'chart4', 'chart5', 'chart6'];
/** Tiles the analytics view shows. */
export const ANALYTICS_TILES = ['ticker', 'track', 'leaderboard', 'playbackBar', ...CHART_TILES];
const CHART_RATIO = LAYOUT.insights.height / LAYOUT.insights.width; // chart panels are 0.9 × 0.42 m too

const PX = 1024;
const COL_LW = LAYOUT.leaderboard.width * PX;                       // 921.6 logical px
const LB_RATIO = LAYOUT.leaderboard.height / LAYOUT.leaderboard.width; // 4:3 tall
const TEL_RATIO = LAYOUT.telemetry.height / LAYOUT.telemetry.width;
const LAPS_RATIO = LAYOUT.laps.height / LAYOUT.laps.width;
const WEATHER_RATIO = LAYOUT.weather.height / LAYOUT.weather.width;
const WEATHER_REL = LAYOUT.weather.width / LAYOUT.leaderboard.width; // weather is narrower than a column
const INS_RATIO = LAYOUT.insights.height / LAYOUT.insights.width;
// Landscape bottom-right row: main (16:9) and weather (4:3) side by side, same height.
const ROW_SPLIT = (16 / 9) / (16 / 9 + LAYOUT.weather.width / LAYOUT.weather.height);
const ROW_RATIO = 1 / (16 / 9 + LAYOUT.weather.width / LAYOUT.weather.height); // row height / row width
const TICKER_RATIO = LAYOUT.ticker.stripHeight / LAYOUT.ticker.width;
const BAR_RATIO = LAYOUT.playbackBar.height / LAYOUT.playbackBar.width;
const MAIN_RATIO = 9 / 16;
const MIN_MIDDLE = 360;            // px: narrowest track column in landscape
const MIN_TRACK = 0.28;            // portrait: the track keeps at least this share of the height

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** Content height: the viewport unless the tiles need more (sub-pixel overshoot from rounding is ignored). */
const contentHeight = (Hc, H) => (Hc - H < 1 ? H : Math.ceil(Hc));
const rect = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(y), w: Math.max(0, Math.round(w)), h: Math.max(0, Math.round(h)) });

/**
 * The largest rect of `aspect` (height / width) centred inside `r`.
 * @param {{x:number,y:number,w:number,h:number}} r
 * @param {number} aspect height / width
 */
export function containRect(r, aspect) {
  let w = r.w;
  let h = w * aspect;
  if (h > r.h) { h = r.h; w = h / aspect; }
  return { x: r.x + (r.w - w) / 2, y: r.y + (r.h - h) / 2, w, h };
}

/**
 * @param {number} width viewport width (CSS px)
 * @param {number} height viewport height (CSS px)
 * @param {{focus?: 'track'|'main', gap?: number, view?: 'dashboard'|'analytics'}} [opts]
 * @returns {{orientation: 'landscape'|'portrait'|'stack', scale: number, width: number, height: number,
 *   tiles: Record<string, {x:number,y:number,w:number,h:number}>}} height is the content height
 *   (more than the viewport when the dashboard has to scroll)
 */
export function computeScreenLayout(width, height, { focus = 'track', gap = 8, view = 'dashboard' } = {}) {
  const W = Math.max(1, width);
  const H = Math.max(1, height);
  if (view === 'analytics') return analyticsView(W, H, gap);
  let out = null;
  if (W / H >= LANDSCAPE_MIN) out = landscape(W, H, gap);
  if (!out) out = portrait(W, H, gap);
  if (!out) out = stack(W, H, gap);
  if (focus === 'main') {
    const t = out.tiles.track;
    out.tiles.track = out.tiles.main;
    out.tiles.main = t;
  }
  return out;
}

function landscape(W, H, g) {
  // Column width: a quarter-ish of the width, limited by the height of the left column
  // (leaderboard + laps) and the right one (telemetry + insights + the main | weather row),
  // and never below the readable minimum.
  const leftFactor = LB_RATIO + LAPS_RATIO;
  const rightFactor = TEL_RATIO + INS_RATIO + ROW_RATIO;
  let c = Math.min(0.27 * W, (H - 3 * g) / leftFactor, (H - 4 * g) / rightFactor);
  c = clamp(c, MIN_SCALE * COL_LW, MAX_SCALE * COL_LW);
  const mw = W - 2 * c - 4 * g;
  if (mw < MIN_MIDDLE) return null;
  const s = c / COL_LW;

  const lbH = c * LB_RATIO;
  const lapsH = c * LAPS_RATIO;
  const telH = c * TEL_RATIO;
  const insH = c * INS_RATIO;
  const rowMin = (c - g) * ROW_RATIO;
  const left = g + lbH + g + lapsH + g;
  const right = g + telH + g + insH + g + rowMin + g;
  const Hc = Math.max(H, left, right);

  const xl = g;
  const xm = g + c + g;
  const xr = W - g - c;
  const tickerH = Math.max(36, mw * TICKER_RATIO);
  const barH = clamp(mw * BAR_RATIO, 56, 0.12 * Hc);
  const trackY = g + tickerH + g;
  const barY = Hc - g - barH;
  const rowY = g + telH + g + insH + g;
  const mainW = (c - g) * ROW_SPLIT;
  return {
    orientation: 'landscape',
    scale: s,
    width: W,
    height: contentHeight(Hc, H),
    tiles: {
      leaderboard: rect(xl, g, c, lbH),
      laps: rect(xl, g + lbH + g, c, lapsH),
      ticker: rect(xm, g, mw, tickerH),
      track: rect(xm, trackY, mw, barY - g - trackY),
      playbackBar: rect(xm, barY, mw, barH),
      telemetry: rect(xr, g, c, telH),
      insights: rect(xr, g + telH + g, c, insH),
      main: rect(xr, rowY, mainW, Hc - g - rowY),
      weather: rect(xr + mainW + g, rowY, c - g - mainW, Hc - g - rowY),
    },
  };
}

function portrait(W, H, g) {
  const half = (W - 3 * g) / 2;
  if (half < MIN_SCALE * COL_LW) return null;
  const fw = W - 2 * g;
  const tickerH = Math.max(36, fw * TICKER_RATIO);
  const barH = clamp(fw * BAR_RATIO, 56, 0.08 * H);
  // Rows below the track: leaderboard | telemetry, laps | main, insights | weather (factors of c).
  const rowsFactor = Math.max(LB_RATIO, TEL_RATIO) + LAPS_RATIO + INS_RATIO;
  const fixed = g + tickerH + g + g + barH + g + g + g;   // gaps around the stacked rows
  let c = Math.min(half, MAX_SCALE * COL_LW, (H * (1 - MIN_TRACK) - fixed) / rowsFactor);
  c = Math.max(c, MIN_SCALE * COL_LW);
  const s = c / COL_LW;
  const rowLb = c * Math.max(LB_RATIO, TEL_RATIO);
  const rowLaps = c * LAPS_RATIO;
  const rowWeather = c * INS_RATIO;
  const trackMin = MIN_TRACK * H;
  const Hc = Math.max(H, fixed + trackMin + rowLb + rowLaps + rowWeather);
  const trackH = Hc - fixed - rowLb - rowLaps - rowWeather;

  const x2 = g + half + g;
  let y = g;
  const tiles = {};
  tiles.ticker = rect(g, y, fw, tickerH); y += tickerH + g;
  tiles.track = rect(g, y, fw, trackH); y += trackH + g;
  tiles.playbackBar = rect(g, y, fw, barH); y += barH + g;
  tiles.leaderboard = rect(g, y, half, rowLb);
  tiles.telemetry = rect(x2, y, half, rowLb); y += rowLb + g;
  tiles.laps = rect(g, y, half, rowLaps);
  tiles.main = rect(x2, y, half, rowLaps); y += rowLaps + g;
  tiles.insights = rect(g, y, half, rowWeather);
  tiles.weather = rect(x2, y, half, rowWeather);
  return { orientation: 'portrait', scale: s, width: W, height: contentHeight(Hc, H), tiles };
}

function stack(W, H, g) {
  const fw = Math.max(1, W - 2 * g);
  const c = Math.min(fw, MAX_SCALE * COL_LW);
  const s = c / COL_LW;
  const heights = {
    ticker: Math.max(36, fw * TICKER_RATIO),
    track: Math.max(240, Math.min(fw, H * 0.6)),
    playbackBar: Math.max(48, fw * BAR_RATIO),
    leaderboard: c * LB_RATIO,
    telemetry: c * TEL_RATIO,
    laps: c * LAPS_RATIO,
    main: fw * MAIN_RATIO,
    weather: c * WEATHER_REL * WEATHER_RATIO,
    insights: c * INS_RATIO,
  };
  const tiles = {};
  let y = g;
  for (const name of ['ticker', 'track', 'playbackBar', 'leaderboard', 'telemetry', 'insights', 'main', 'laps', 'weather']) {
    tiles[name] = rect(g, y, fw, heights[name]);
    y += heights[name] + g;
  }
  return { orientation: 'stack', scale: s, width: W, height: Math.round(Math.max(H, y)), tiles };
}

function analyticsView(W, H, g) {
  if (W / H >= LANDSCAPE_MIN) {
    // Side column: track (4:3) over the leaderboard, as wide as the height allows.
    let c = Math.min(0.26 * W, (H - 3 * g) / (0.75 + LB_RATIO));
    c = clamp(c, MIN_SCALE * COL_LW, MAX_SCALE * COL_LW);
    const mw = W - c - 3 * g;
    if (mw >= 2 * MIN_SCALE * COL_LW + g) {
      const trackH = c * 0.75;
      const lbH = c * LB_RATIO;
      const side = g + trackH + g + lbH + g;
      const tickerH = Math.max(36, mw * TICKER_RATIO);
      const barH = clamp(mw * BAR_RATIO, 56, 0.12 * H);
      const cw = (mw - g) / 2;
      const minCharts = 3 * cw * CHART_RATIO * 0.75 + 2 * g; // charts may letterbox a little
      const Hc = Math.max(H, side, g + tickerH + g + minCharts + g + barH + g);
      const y0 = g + tickerH + g;
      const ch = (Hc - y0 - g - barH - g - 2 * g) / 3;
      const xr = W - g - c;
      const tiles = {
        ticker: rect(g, g, mw, tickerH),
        playbackBar: rect(g, Hc - g - barH, mw, barH),
        track: rect(xr, g, c, trackH),
        leaderboard: rect(xr, g + trackH + g, c, Hc - g - (g + trackH + g)),
      };
      CHART_TILES.forEach((name, i) => {
        tiles[name] = rect(g + (i % 2) * (cw + g), y0 + Math.floor(i / 2) * (ch + g), cw, ch);
      });
      return { orientation: 'landscape', scale: c / COL_LW, width: W, height: contentHeight(Hc, H), tiles };
    }
  }
  // Portrait / narrow: one scrolling column.
  const fw = Math.max(1, W - 2 * g);
  const c = Math.min(fw, MAX_SCALE * COL_LW);
  const heights = {
    ticker: Math.max(36, fw * TICKER_RATIO),
    track: Math.max(200, Math.min(fw * 0.6, H * 0.4)),
    playbackBar: Math.max(48, fw * BAR_RATIO),
  };
  for (const name of CHART_TILES) heights[name] = fw * CHART_RATIO;
  heights.leaderboard = c * LB_RATIO;
  const tiles = {};
  let y = g;
  for (const name of ['ticker', 'track', 'playbackBar', ...CHART_TILES, 'leaderboard']) {
    tiles[name] = rect(g, y, fw, heights[name]);
    y += heights[name] + g;
  }
  return { orientation: W / H >= LANDSCAPE_MIN ? 'landscape' : 'stack', scale: c / COL_LW, width: W, height: Math.round(Math.max(H, y)), tiles };
}
