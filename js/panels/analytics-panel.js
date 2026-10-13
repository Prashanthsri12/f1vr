// Analytics panel (9.23–9.30): one chart at a time, picked with ◀ ▶ in the header.
// Used three ways with different sizes: the main screen's Analytics tab (VR and desktop) and
// the six tiles of Analytics mode (each starting on its own chart).
// Header controls: the chart picker, chart options (fuel correction, fastest / last lap,
// rival ◀ ▶) and FULL SESSION (setting fullSession: spoiler-free by default, 9.29).
// Hovering a lap column shows a tooltip; clicking it jumps the replay to that lap.
// Charts live in analytics-charts.js (race story, lap times) and analytics-charts2.js (pace,
// tyres, strategy tools, comparison). Redraws only when the signature changes (≤10 Hz).
import { Panel, THEME, font, dfont, roundRect } from './panel-base.js';
import { getSettings, setSetting } from '../settings.js';
import { buildLapTable, lapsDone } from '../analytics/lap-table.js';
import { defaultRival, stepRival } from './insights-data.js';
import { LapTraceCache } from './lap-trace.js';
import { CHARTS_A } from './analytics-charts.js';
import { CHARTS_B } from './analytics-charts2.js';

const CHARTS = { ...CHARTS_A, ...CHARTS_B };
/** Charts per session type (9.30): race story only for races and sprints. */
export const RACE_KINDS = ['gap', 'positions', 'strategy', 'laptimes', 'deg', 'pace', 'tools', 'compare'];
export const OTHER_KINDS = ['laptimes', 'pace', 'longrun', 'deg', 'compare', 'strategy'];
const HEADER_H = 58;
const _tables = new WeakMap();
const _rows = new WeakMap(); // data -> { t, rows }: one leaderboard query per playhead time for all charts

function rowsAt(data, t) {
  let c = _rows.get(data);
  if (!c || c.t !== t) { c = { t, rows: data.getLeaderboardAt(t) }; _rows.set(data, c); }
  return c.rows;
}

/** One lap table per session, shared by every analytics panel. */
export function lapTableFor(data) {
  let t = _tables.get(data);
  if (!t) { t = buildLapTable(data); _tables.set(data, t); }
  return t;
}

export class AnalyticsPanel extends Panel {
  /**
   * @param {object} data SessionData
   * @param {{name?: string, width?: number, height?: number, pxPerM?: number, kind?: string}} [o]
   */
  constructor(data, { name = 'analytics', width = 0.9, height = 0.5, pxPerM, kind } = {}) {
    super({ name, width, height, maxHz: 10, ...(pxPerM ? { pxPerM } : {}) });
    this.data = data;
    this.kinds = data.hasIntervals ? RACE_KINDS : OTHER_KINDS;
    this.kind = this.kinds.includes(kind) ? kind : this.kinds[0];
    this.fuel = false;
    this.which = 'best';
    this.rivalPick = null;
    this.traces = new LapTraceCache({ maxLaps: 4 });
    this.traces.onLoad = () => { this._sig = ''; };
    this._sig = '';
    this._ctx = null;
  }

  setKind(kind) {
    if (this.kinds.includes(kind) && kind !== this.kind) { this.kind = kind; this._sig = ''; }
  }

  refresh(ctx) {
    if (!this.mesh.visible) return false;
    const full = getSettings().fullSession;
    const upTo = full ? Infinity : ctx.time;
    const table = lapTableFor(this.data);
    const rows = rowsAt(this.data, ctx.time);
    const rival = defaultRival(rows, ctx.selected, this.rivalPick);
    const chart = CHARTS[this.kind];
    const extra = chart.sig ? chart.sig(this, table, upTo, ctx.selected, rival) : '';
    const sig = `${this.kind}|${ctx.selected}|${rival}|${full}|${this.fuel}|${this.which}|${lapsDone(table, upTo)}|${this.hover}|${extra}`;
    this._ctx = { table, upTo, sel: ctx.selected, rival, rows, full, time: ctx.time };
    if (sig === this._sig) return false;
    this._sig = sig;
    return true;
  }

  onHit(hit, ctx) {
    const id = hit.id;
    if (id === 'pick') { const i = this.kinds.indexOf(this.kind); this.setKind(this.kinds[(i + hit.payload + this.kinds.length) % this.kinds.length]); return; }
    if (id === 'full') { setSetting('fullSession', !getSettings().fullSession); this._sig = ''; return; }
    if (id === 'fuel') { this.fuel = !this.fuel; this._sig = ''; return; }
    if (id === 'which') { this.which = this.which === 'best' ? 'last' : 'best'; this._sig = ''; return; }
    if (id === 'rival') {
      const rows = this.data.getLeaderboardAt(ctx.time);
      this.rivalPick = stepRival(rows, ctx.selected, defaultRival(rows, ctx.selected, this.rivalPick), hit.payload);
      this._sig = '';
      return;
    }
    if (id.startsWith('lap:') && hit.payload != null && ctx.actions.seekToLap) ctx.actions.seekToLap(hit.payload);
    if (id.startsWith('drv:') && hit.payload != null) ctx.actions.selectDriver(hit.payload);
  }

  draw(g, w, h) {
    this.clear(g, w, h);
    const c = this._ctx;
    if (!c) return;
    const chart = CHARTS[this.kind];
    this._header(g, w, chart, c);
    chart.draw(g, { panel: this, data: this.data, ...c, area: { x: 0, y: HEADER_H, w, h: h - HEADER_H } });
  }

  _chip(g, id, x, label, on, payload) {
    g.font = dfont(16, 700);
    const w = g.measureText(label).width + 22;
    const hov = this.hover === id;
    g.fillStyle = on ? THEME.accent : hov ? THEME.surfaceHi : THEME.surface;
    roundRect(g, x - w, 14, w, 32, 16);
    g.fill();
    g.fillStyle = on ? '#ffffff' : THEME.muted;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, x - w / 2, 31);
    this.addHit(id, x - w, 14, w, 32, payload);
    return x - w - 8;
  }

  _header(g, w, chart, c) {
    // Picker: ◀ TITLE ▶
    const bw = 34;
    for (const [dir, x] of [[-1, 14], [1, 14 + bw + 6]]) {
      const id = 'pick';
      g.fillStyle = THEME.surface;
      roundRect(g, x, 14, bw, 32, 8);
      g.fill();
      g.fillStyle = THEME.text;
      g.font = font(16, 700);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(dir < 0 ? '◀' : '▶', x + bw / 2, 31);
      this._hits.push({ id, x, y: 14, w: bw, h: 32, payload: dir });
    }
    g.textAlign = 'left';
    g.fillStyle = THEME.text;
    g.font = dfont(22, 700);
    g.fillText(chart.title.toUpperCase(), 14 + 2 * bw + 20, 31);
    // Right-hand chips (drawn right to left).
    let x = w - 14;
    x = this._chip(g, 'full', x, c.full ? 'FULL SESSION' : 'UP TO NOW', c.full);
    if (chart.options) x = chart.options(this, g, x, c);
    void x;
  }
}
