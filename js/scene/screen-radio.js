// Main screen canvas panels:
//  - ScreenContent: covers the screen; shows the Radio tab (the selected driver's team radio
//    clips up to the playhead, newest first, with play / stop buttons) or a message
//    (e.g. "Add a video source on the start page.").
//  - ScreenTabs: Video / Radio buttons under the screen's right edge.
import { Panel, THEME, font, roundRect } from '../panels/panel-base.js';
import { currentLap } from '../session-index.js';
import { playRadio, stopRadio, getRadioState, onRadioChange } from '../audio.js';

const ROWS = 9;                // clips per page
const PX_PER_M = 512;          // the screen is 2.8 m away: half density, text drawn twice as big
const COL = 820;               // px (1.6 m): list column, centred; the screen's outer edges hide
                               // behind the side panels from the start position
const BOTTOM = 80;             // px kept clear at the bottom for the tab strip / paging

function pad2(n) { return n < 10 ? `0${n}` : `${n}`; }

function fmtClock(t) {
  const d = new Date(t);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
}

function fmtElapsed(ms) {
  const neg = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return `${neg ? '-' : '+'}${h > 0 ? `${h}:${pad2(m)}` : m}:${pad2(s)}`;
}

export class ScreenContent extends Panel {
  /**
   * @param {import('../session-data.js').SessionData} data
   * @param {number} width metres
   * @param {number} height metres
   * @param {{rows?: number}} [o] clips per page (default 9; the small desktop tile uses fewer)
   */
  constructor(data, width, height, { rows = ROWS } = {}) {
    super({ name: 'screen-content', width, height, pxPerM: PX_PER_M });
    this.data = data;
    this.rows = rows;
    this.mode = 'radio';       // 'radio' | 'message'
    this.message = '';
    this.page = 0;
    this._sig = '';
    this._clips = [];
    this._radioVersion = 0;
    this._offRadio = onRadioChange(() => { this._radioVersion++; });
  }

  /** @param {'radio'|'message'} mode */
  show(mode, message = '') {
    if (this.mode !== mode || this.message !== message) {
      this.mode = mode;
      this.message = message;
      this.invalidate();
    }
  }

  refresh(ctx) {
    if (!this.mesh.visible) return false;
    let sig;
    if (this.mode === 'message') {
      sig = `m|${this.message}|${this.passthrough}`;
    } else {
      const n = ctx.selected;
      if (n !== this._driver) { this._driver = n; this.page = 0; }
      const clips = n != null ? this.data.getTeamRadioUpTo(n, ctx.time) : [];
      this._clips = clips;
      sig = `r|${n}|${clips.length}|${this.page}|${this._radioVersion}|${this.hover}|${this.passthrough}`;
    }
    if (sig === this._sig) return false;
    this._sig = sig;
    return true;
  }

  draw(g, w, h, ctx) {
    this.clear(g, w, h, 0);
    if (this.mode === 'message') { this._drawMessage(g, w, h); return; }
    this._drawRadio(g, w, h, ctx);
  }

  _drawMessage(g, w, h) {
    g.fillStyle = THEME.text;
    g.font = font(44, 600);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // naive wrap at ~42 characters
    const words = this.message.split(' ');
    const lines = [];
    let line = '';
    for (const wd of words) {
      if ((line + ' ' + wd).trim().length > 42) { lines.push(line.trim()); line = wd; } else line += ' ' + wd;
    }
    if (line.trim()) lines.push(line.trim());
    const lh = 60;
    lines.forEach((l, i) => g.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * lh));
    g.textAlign = 'left';
  }

  _drawRadio(g, w, h, ctx) {
    const n = this._driver;
    const d = n != null ? this.data.driverByNumber.get(n) : null;
    const pad = Math.round((w - COL) / 2);
    const right = pad + COL;
    g.textBaseline = 'middle';
    g.fillStyle = THEME.accent;
    g.fillRect(pad, 34, 8, 44);
    g.fillStyle = THEME.text;
    g.font = font(44, 700);
    g.fillText(`TEAM RADIO  ${d ? d.acronym : ''}`, pad + 22, 57);
    const clips = this._clips;
    g.fillStyle = THEME.muted;
    g.font = font(30, 600);
    g.textAlign = 'right';
    g.fillText(clips.length === 1 ? '1 clip so far' : `${clips.length} clips so far`, right, 57);
    g.textAlign = 'left';

    if (!clips.length) {
      g.fillStyle = THEME.muted;
      g.font = font(36, 600);
      g.textAlign = 'center';
      g.fillText(d ? `No team radio from ${d.acronym} yet in this session.` : 'Select a driver.', w / 2, h / 2);
      g.textAlign = 'left';
      return;
    }

    const rows = this.rows;
    const pages = Math.ceil(clips.length / rows);
    if (this.page >= pages) this.page = pages - 1;
    const st = getRadioState();
    const laps = this.data.getDriverLaps(n);
    const top = 104;
    const rowH = (h - top - BOTTOM - 10) / rows;
    const start = clips.length - 1 - this.page * rows; // newest first
    for (let r = 0; r < rows; r++) {
      const i = start - r;
      if (i < 0) break;
      const c = clips[i];
      const y = top + r * rowH;
      const id = `clip:${i}`;
      const playing = st.playing && st.url === c.recording_url;
      g.fillStyle = this.hover === id ? THEME.surfaceHi : THEME.surface;
      roundRect(g, pad, y + 4, COL, rowH - 8, 10);
      g.fill();
      // play / stop button
      g.fillStyle = playing ? THEME.accent : THEME.surfaceHi;
      roundRect(g, pad + 8, y + 10, 110, rowH - 20, 8);
      g.fill();
      g.fillStyle = THEME.text;
      g.font = font(30, 700);
      g.textAlign = 'center';
      g.fillText(playing ? '■ Stop' : '▶ Play', pad + 63, y + rowH / 2 + 1);
      g.textAlign = 'left';
      const lap = currentLap(laps, c.date);
      g.font = font(32, 700);
      g.fillText(lap ? `Lap ${lap.lap_number}` : 'Pre-race', pad + 150, y + rowH / 2 + 1);
      g.font = font(32, 600);
      g.fillStyle = THEME.muted;
      g.fillText(`${fmtClock(c.date)} UTC`, pad + 360, y + rowH / 2 + 1);
      g.fillText(fmtElapsed(c.date - this.data.raceStartTime), pad + 620, y + rowH / 2 + 1);
      this.addHit(id, pad, y + 4, COL, rowH - 8, c.recording_url);
    }

    // paging: bottom-left of the column (the tab strip is at the bottom-right)
    if (pages > 1) {
      const by = h - BOTTOM + 10;
      const bw = 190;
      const canNewer = this.page > 0;
      const canOlder = this.page < pages - 1;
      this._pageButton(g, 'newer', pad, by, bw, 56, '▲ Newer', canNewer);
      this._pageButton(g, 'older', pad + bw + 12, by, bw, 56, 'Older ▼', canOlder);
      g.fillStyle = THEME.muted;
      g.font = font(28, 600);
      g.fillText(`${this.page + 1} / ${pages}`, pad + 2 * bw + 32, by + 28);
    }
  }

  _pageButton(g, id, x, y, w, h, label, enabled) {
    g.globalAlpha = enabled ? 1 : 0.4;
    g.fillStyle = this.hover === id && enabled ? THEME.surfaceHi : THEME.surface;
    roundRect(g, x, y, w, h, 10);
    g.fill();
    g.fillStyle = THEME.text;
    g.font = font(30, 700);
    g.textAlign = 'center';
    g.fillText(label, x + w / 2, y + h / 2 + 1);
    g.textAlign = 'left';
    g.globalAlpha = 1;
    if (enabled) this.addHit(id, x, y, w, h);
  }

  onHit(hit) {
    if (this.mode !== 'radio') return;
    if (hit.id === 'newer') this.page = Math.max(0, this.page - 1);
    else if (hit.id === 'older') this.page++;
    else if (hit.id.startsWith('clip:')) {
      const st = getRadioState();
      if (st.playing && st.url === hit.payload) stopRadio(); else playRadio(hit.payload);
    }
    this._sig = '';
  }

  dispose() {
    this._offRadio();
    super.dispose();
  }
}

const TABS = [['video', 'Video'], ['radio', 'Radio'], ['analytics', 'Analytics'], ['quali', 'Quali']]; // 9.27: Analytics tab, 13.12: Quali

export class ScreenTabs extends Panel {
  /** @param {(tab: string) => void} onTab */
  constructor(onTab) {
    super({ name: 'screen-tabs', width: 0.8, height: 0.1 });
    this.onTab = onTab;
    this.tab = 'video';
  }

  setTab(tab) {
    if (this.tab !== tab) { this.tab = tab; this.invalidate(); }
  }

  draw(g, w, h) {
    this.clear(g, w, h, 14);
    const gap = 8;
    const bw = (w - (TABS.length + 1) * gap) / TABS.length;
    TABS.forEach(([id, label], i) => {
      const x = gap + i * (bw + gap);
      const y = gap;
      const bh = h - 2 * gap;
      const active = this.tab === id;
      const hid = `tab:${id}`;
      g.fillStyle = active ? THEME.surfaceHi : this.hover === hid ? THEME.surfaceHi : THEME.surface;
      roundRect(g, x, y, bw, bh, 10);
      g.fill();
      if (active) {
        g.fillStyle = THEME.accent;
        g.fillRect(x + 12, y + bh - 8, bw - 24, 6);
      }
      g.fillStyle = active ? THEME.text : THEME.muted;
      g.font = font(32, 700);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, x + bw / 2, y + bh / 2 - 2);
      g.textAlign = 'left';
      this.addHit(hid, x, y, bw, bh, id);
    });
  }

  onHit(hit) {
    if (hit.payload) this.onTab(hit.payload);
  }
}
