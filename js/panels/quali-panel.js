// Qualifying panel (13.12, 13.13): the weekend's qualifying (Q1 / Q2 / Q3 and the result) from
// js/analytics/quali.js. Shown as the Quali tab in every session of the weekend (desktop hub,
// VR main screen) and as the tables of Qualifying mode.
// - Replaying that qualifying session itself: it follows the playhead (spoiler-free), opens on
//   the running phase and shades the drop zone. Any other session: the final result.
// - Header: SPRINT / MAIN switch on sprint weekends, phase tabs, LIVE or FINAL.
// - Rows in two columns: position, team colour, driver, best time, gap, status (OUT, DROP,
//   on a flying lap). RESULT adds Q1 / Q2 / Q3 times and the starting grid (with penalties).
// Click a row to select that driver. Redraws only when what it shows changes (≤10 Hz).
import { Panel, THEME, font, dfont, roundRect, rgba, panelTitle } from './panel-base.js';
import { buildQuali, qualiAt, fmtQ } from '../analytics/quali.js';

const HEAD = 58;

export class QualiPanel extends Panel {
  /**
   * @param {object} data SessionData
   * @param {{extra: object, name?: string, width?: number, height?: number, pxPerM?: number, tab?: string, fixedTab?: boolean}} o
   *   extra: createExtraData() result; tab: 'auto' | 'q1' | 'q2' | 'q3' | 'result'; fixedTab hides the tab row
   */
  constructor(data, { extra, name = 'quali', width = 1.7, height = 0.85, pxPerM = 512, tab = 'auto', fixedTab = false } = {}) {
    super({ name, width, height, pxPerM, maxHz: 4 });
    this.data = data;
    this.extra = extra;
    this.tab = tab;
    this.fixedTab = fixedTab;
    this.which = 0;            // index into extra.qualis
    this._models = new Map();  // quali key -> model
    this._sig = '';
    this._state = null;
    this._q = null;
  }

  _model(q) {
    let m = this._models.get(q.key);
    if (!m) { m = buildQuali(q); this._models.set(q.key, m); }
    return m;
  }

  refresh(ctx) {
    const x = this.extra;
    const qs = x ? x.qualis : [];
    const q = qs[Math.min(this.which, qs.length - 1)] || null;
    const live = q && q.key === this.data.session.key;
    const t = live ? ctx.time : Infinity;
    const sig = `${x ? x.version : -1}|${x ? x.status.quali : ''}|${this.which}|${this.tab}|${live ? Math.floor(t / 1000) : 'f'}|${ctx.selected}|${this.hover}`;
    if (sig === this._sig) return false;
    this._sig = sig;
    this._q = q;
    this._live = !!live;
    this._state = q ? qualiAt(this._model(q), t) : null;
    return true;
  }

  _tab() {
    if (this.tab !== 'auto') return this.tab;
    const s = this._state;
    if (!s || s.phase === 4 || s.phase === 0) return s && s.phase === 0 ? 'q1' : 'result';
    return `q${s.phase}`;
  }

  draw(g, w, h, ctx) {
    this.clear(g, w, h);
    const x = this.extra;
    const s = this._state;
    const q = this._q;
    const title = q && /sprint/i.test(q.name) ? 'Sprint quali' : 'Qualifying';
    panelTitle(g, 22, 36, title, 28);
    const titleEnd = 22 + 30 + g.measureText(title.toUpperCase()).width + 18;
    if (!s) {
      g.fillStyle = THEME.muted;
      g.font = font(26, 600);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const st = x ? x.status.quali : 'none';
      g.fillText(st === 'loading' ? 'Loading this weekend\'s qualifying…' : st === 'error' ? 'Qualifying data unavailable' : 'No qualifying this weekend', w / 2, h / 2);
      g.textAlign = 'left';
      return;
    }
    // Header: main / sprint switch, phase tabs, LIVE / FINAL.
    let hx = titleEnd;
    if (x.qualis.length > 1) {
      const other = x.qualis[(this.which + 1) % x.qualis.length];
      hx = this._chip(g, 'which', hx, 14, /sprint/i.test(other.name) ? 'Sprint ▸' : 'Main ▸', false) + 16;
    }
    const tab = this._tab();
    if (!this.fixedTab) {
      for (const p of s.phases) hx = this._chip(g, `tab:q${p.n}`, hx, 14, p.name, tab === `q${p.n}`, !p.started) + 8;
      hx = this._chip(g, 'tab:result', hx, 14, 'Result', tab === 'result', s.phase !== 4) + 8;
    }
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.font = dfont(24, 900);
    const tag = s.phase === 4 ? 'FINAL' : s.phase === 0 ? 'NOT STARTED' : `${s.phases[Math.min(s.phase, 3) - 1].name} ${s.live && !s.phases[s.phase - 1].done ? 'LIVE' : 'DONE'}`;
    g.fillStyle = s.live ? THEME.accent : THEME.muted;
    g.fillText(tag, w - 22, 34);
    g.textAlign = 'left';

    if (tab === 'result') this._drawResult(g, w, h, ctx, s, q);
    else this._drawPhase(g, w, h, ctx, s.phases[+tab[1] - 1]);
  }

  _chip(g, id, x, y, label, on, disabled = false) {
    g.font = font(20, 700);
    const cw = g.measureText(label).width + 24;
    const hover = this.hover === id && !disabled;
    g.fillStyle = on ? '#ffffff' : hover ? THEME.surfaceHi : THEME.surface;
    roundRect(g, x, y, cw, 36, 18);
    g.fill();
    g.fillStyle = on ? '#0a0b10' : disabled ? THEME.line : THEME.text;
    g.textBaseline = 'middle';
    g.fillText(label, x + 12, y + 19);
    if (!disabled) this.addHit(id, x, y, cw, 36);
    return x + cw;
  }

  _cols(w, h, n) {
    const cols = n > 12 && w > 700 ? 2 : 1;
    const per = Math.ceil(n / cols);
    const rh = Math.max(20, Math.min(46, (h - HEAD - 16) / Math.max(per, 1)));
    return { cols, per, rh, cw: (w - 24 - (cols - 1) * 18) / cols };
  }

  _driver(n) {
    return this.data.driverByNumber.get(n) || { acronym: `#${n}`, teamColour: '#8a8fa0' };
  }

  _row(g, x, y, cw, rh, r, ctx, cells) {
    const d = this._driver(r.driver);
    const sel = ctx.selected === r.driver;
    const id = `drv:${r.driver}`;
    g.fillStyle = r.status === 'drop' ? rgba(THEME.red, 0.18) : r.status === 'out' ? 'rgba(255,255,255,0.025)' : sel ? THEME.surfaceHi : THEME.surface;
    roundRect(g, x, y, cw, rh - 4, 6);
    g.fill();
    if (sel || this.hover === id) {
      g.strokeStyle = sel ? THEME.select : THEME.text;
      g.lineWidth = 2;
      roundRect(g, x + 1, y + 1, cw - 2, rh - 6, 6);
      g.stroke();
    }
    const mid = y + (rh - 4) / 2;
    const px = Math.min(24, rh * 0.62);
    g.globalAlpha = r.status === 'out' ? 0.5 : 1;
    g.textBaseline = 'middle';
    g.fillStyle = THEME.muted;
    g.font = dfont(px, 900);
    g.textAlign = 'right';
    g.fillText(String(r.pos), x + 38, mid + 1);
    g.fillStyle = d.teamColour;
    g.fillRect(x + 46, y + 5, 5, rh - 14);
    g.textAlign = 'left';
    g.fillStyle = THEME.text;
    g.fillText(d.acronym, x + 58, mid + 1);
    for (const [cx, text, colour, align, size] of cells) {
      g.textAlign = align || 'right';
      g.fillStyle = colour || THEME.text;
      g.font = size === 'small' ? font(Math.min(18, px * 0.8), 700) : dfont(px * 0.92, 700);
      g.fillText(text, x + cx, mid + 1);
    }
    g.globalAlpha = 1;
    g.textAlign = 'left';
    this.addHit(id, x, y, cw, rh - 4, r.driver);
  }

  _drawPhase(g, w, h, ctx, ph) {
    if (!ph || !ph.rows.length) {
      g.fillStyle = THEME.muted;
      g.font = font(24, 600);
      g.textAlign = 'center';
      g.fillText(ph ? `${ph.name} has not started yet` : '', w / 2, (HEAD + h) / 2);
      g.textAlign = 'left';
      return;
    }
    const { per, rh, cw } = this._cols(w, h, ph.rows.length);
    ph.rows.forEach((r, i) => {
      const col = Math.floor(i / per);
      const x = 12 + col * (cw + 18);
      const y = HEAD + 8 + (i % per) * rh;
      if (ph.n < 3 && i === ph.keep && ph.started) {
        // The cut line: below it is the drop zone (or out, once the phase is over).
        g.fillStyle = THEME.accent;
        g.fillRect(x, y - 3, cw, 2);
      }
      const status = r.status === 'out' ? ['OUT', THEME.muted] : r.status === 'drop' ? ['DROP', THEME.red] : r.onLap ? ['● LAP', THEME.select] : r.status === 'through' ? ['✓', THEME.green] : ['', THEME.muted];
      this._row(g, x, y, cw, rh, r, ctx, [
        [cw * 0.62, fmtQ(r.best), r.pos === 1 && r.best != null ? THEME.purple : THEME.text],
        [cw * 0.84, r.pos === 1 || r.gap == null ? '' : `+${r.gap.toFixed(3)}`, THEME.muted, 'right', 'small'],
        [cw - 10, status[0], status[1], 'right', 'small'],
      ]);
    });
  }

  _drawResult(g, w, h, ctx, s, q) {
    if (!s.final.length) {
      g.fillStyle = THEME.muted;
      g.font = font(24, 600);
      g.textAlign = 'center';
      g.fillText('The result shows after Q3', w / 2, (HEAD + h) / 2);
      g.textAlign = 'left';
      return;
    }
    const grid = new Map((q.grid || []).map((r) => [r.driver_number, r.position]));
    const { per, rh, cw } = this._cols(w, h, s.final.length);
    s.final.forEach((f, i) => {
      const col = Math.floor(i / per);
      const x = 12 + col * (cw + 18);
      const y = HEAD + 8 + (i % per) * rh;
      const best = f.q[f.out - 1];
      const g0 = grid.get(f.driver);
      this._row(g, x, y, cw, rh, { driver: f.driver, pos: f.pos, status: '' }, ctx, [
        [cw * 0.55, fmtQ(best), f.pos === 1 ? THEME.purple : THEME.text],
        [cw * 0.74, f.out < 3 ? `OUT Q${f.out}` : 'Q3', f.out < 3 ? THEME.muted : THEME.green, 'right', 'small'],
        [cw - 10, g0 == null ? '' : g0 === f.pos ? `GRID ${g0}` : `GRID ${g0} ${g0 > f.pos ? '▼' : '▲'}`, g0 != null && g0 !== f.pos ? THEME.yellow : THEME.muted, 'right', 'small'],
      ]);
    });
  }

  onHit(hit, ctx) {
    if (hit.id === 'which') { this.which = (this.which + 1) % Math.max(1, this.extra.qualis.length); this.tab = this.fixedTab ? this.tab : 'auto'; }
    else if (hit.id.startsWith('tab:')) this.tab = hit.id.slice(4);
    else if (hit.id.startsWith('drv:') && ctx.actions && ctx.actions.selectDriver) ctx.actions.selectDriver(hit.payload);
    this._sig = '';
  }
}
