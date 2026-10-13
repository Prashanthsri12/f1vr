// Telemetry panel (spec §5): selected driver header, live speed / gear / RPM /
// throttle / brake / DRS, and a speed-vs-distance trace of the current lap
// (revealed up to the playhead) over the previous lap.
import { Panel, THEME, font, dfont, rgba, roundRect } from './panel-base.js';
import { LAYOUT } from './layout.js';
import { LapTraceCache } from './lap-trace.js';
import { lowerBound } from '../interp.js';
import { getRadioState, onRadioChange } from '../audio.js';
import { drawLive } from './telemetry-live.js';

const RADIO_WINDOW_MS = 8000;
const SPEED_MAX = 350;

// Layout (canvas px, 922 × 1229)
const PAD = 32;
const HEADER_H = 208;
const LIVE_Y = HEADER_H + 16;
const TRACE_Y = 650;

/** DRS state: 0 off, 1 eligible, 2 open. Codes per CONTRACTS (8 eligible, 10/12/14 open). */
function drsState(code) {
  if (code === 10 || code === 12 || code === 14) return 2;
  if (code === 8) return 1;
  return 0;
}

export class TelemetryPanel extends Panel {
  /** @param {object} data SessionData */
  constructor(data) {
    const { width, height } = LAYOUT.telemetry;
    super({ name: 'telemetry', width, height });
    this.data = data;
    this.traces = new LapTraceCache();
    this.traces.onLoad = () => this.invalidate();
    this._tel = { speed: 0, rpm: 0, gear: 0, throttle: 0, brake: 0, drs: 0 };
    this._telOk = false;
    this._headshots = new Map(); // driver -> { img, ok, failed }
    // last drawn snapshot
    this._s = {
      selected: -1, telOk: false, speed: -1, gear: -1, rpm: -1, throttle: -1, brake: -1, drs: -1, hasDrs: undefined,
      pos: -2, lap: -2, curN: -1, prevN: -1, curLoaded: false, radio: 0, headshot: false,
    };
    this._cur = null;      // current lap object
    this._curTrace = null;
    this._prevTrace = null;
    this._curN = 0;        // samples of current trace revealed
    this._radioUrls = new Map(); // driver -> Set of recording_url (built once per driver)
    this._offRadio = onRadioChange(() => this.invalidate());
  }

  /** True while one of driver n's clips is playing (autoplay or the Radio tab). */
  _radioPlaying(n) {
    const st = getRadioState();
    if (!st.playing || !st.url) return false;
    let urls = this._radioUrls.get(n);
    if (!urls) {
      urls = new Set(this.data.getTeamRadioUpTo(n, Infinity).map((r) => r.recording_url));
      this._radioUrls.set(n, urls);
    }
    return urls.has(st.url);
  }

  dispose() {
    if (this._offRadio) this._offRadio();
    super.dispose();
  }

  _headshot(n) {
    let h = this._headshots.get(n);
    if (h) return h;
    h = { img: null, ok: false, failed: false };
    this._headshots.set(n, h);
    const d = this.data.driverByNumber.get(n);
    if (!d || !d.headshotUrl || typeof Image === 'undefined') { h.failed = true; return h; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { h.ok = true; this.invalidate(); };
    img.onerror = () => { h.failed = true; this.invalidate(); };
    img.src = d.headshotUrl;
    h.img = img;
    return h;
  }

  /** The selected driver's lap with date_start <= t < date_end, or null. */
  _currentLap(n, t) {
    const laps = this.data.getDriverLaps(n);
    for (let i = laps.length - 1; i >= 0; i--) {
      const l = laps[i];
      if (l.date_start == null || l.date_start > t) continue;
      return (l.date_end == null || t < l.date_end) ? l : null;
    }
    return null;
  }

  refresh(ctx) {
    const { data } = this;
    const n = ctx.selected;
    const t = ctx.time;
    const s = this._s;
    const tel = this._tel;
    this._telOk = data.getTelemetryAt(n, t, tel);
    // Chunk loaded but no samples: the session has no car_data here (6.11), not "loading".
    this._telNone = !this._telOk && typeof data.isTelemetryLoaded === 'function' && data.isTelemetryLoaded(n, t);

    const lap = this._currentLap(n, t);
    this._cur = lap;
    this._curTrace = lap ? this.traces.getTrace(data, n, lap.lap_number) : null;
    this._prevTrace = lap && lap.lap_number > 1 ? this.traces.getTrace(data, n, lap.lap_number - 1) : null;
    const ct = this._curTrace;
    this._curN = ct ? lowerBound(ct.time, t + 1e-6) : 0; // samples with time <= t

    // Badge: 2 while the driver's clip plays, 1 for a few seconds after a clip's time, else 0.
    const radios = data.getTeamRadioUpTo(n, t);
    let radio = 0;
    if (radios.length) {
      const last = radios[radios.length - 1];
      const d = typeof last.date === 'number' ? last.date : Date.parse(last.date);
      if (t >= d && t - d <= RADIO_WINDOW_MS) radio = 1;
    }
    if (this._radioPlaying(n)) radio = 2;
    const hs = this._headshot(n);
    const pos = data.getPositionAt(n, t);

    const speed = Math.round(tel.speed);
    const gear = tel.gear | 0;
    const rpm = Math.round(tel.rpm / 100);
    const thr = Math.round(tel.throttle);
    const brk = tel.brake > 0 ? 1 : 0;
    const drs = drsState(tel.drs);
    const lapN = lap ? lap.lap_number : -1;
    const prevN = this._prevTrace ? this._prevTrace.time.length : -1;

    if (s.selected === n && s.telOk === this._telOk && s.telNone === this._telNone && s.speed === speed && s.gear === gear && s.rpm === rpm
      && s.throttle === thr && s.brake === brk && s.drs === drs && s.hasDrs === data.hasDrs && s.pos === pos
      && s.lap === lapN && s.curN === this._curN && s.prevN === prevN && s.curLoaded === !!ct
      && s.radio === radio && s.headshot === hs.ok) return false;

    s.selected = n; s.telOk = this._telOk; s.telNone = this._telNone; s.speed = speed; s.gear = gear; s.rpm = rpm; s.throttle = thr;
    s.brake = brk; s.drs = drs; s.hasDrs = data.hasDrs; s.pos = pos; s.lap = lapN; s.curN = this._curN;
    s.prevN = prevN; s.curLoaded = !!ct; s.radio = radio; s.headshot = hs.ok;
    return true;
  }

  draw(g, w, h, ctx) {
    this.clear(g, w, h);
    const d = this.data.driverByNumber.get(ctx.selected);
    this._drawHeader(g, w, d, ctx);
    if (this._telOk) drawLive(g, w, LIVE_Y, PAD, this._tel, this._s, this.data.hasDrs);
    else {
      g.fillStyle = THEME.muted;
      g.font = font(32, 600);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(this._telNone ? 'No telemetry for this moment' : 'Loading telemetry…', w / 2, (LIVE_Y + TRACE_Y) / 2);
    }
    this._drawTrace(g, w, h, d);
  }

  _drawHeader(g, w, d, ctx) {
    const colour = d ? d.teamColour : THEME.muted;
    // team colour stripe along the left edge of the header
    g.fillStyle = rgba(colour, 0.3);
    roundRect(g, 0, 0, 22, HEADER_H, [18, 0, 0, 0]);
    g.fill();
    g.fillStyle = colour;
    roundRect(g, 0, 0, 12, HEADER_H, [18, 0, 0, 0]);
    g.fill();

    const tile = 160;
    const tx = PAD;
    const ty = 24;
    const hs = this._headshots.get(ctx.selected);
    g.save();
    roundRect(g, tx, ty, tile, tile, 14);
    g.clip();
    const grad = g.createLinearGradient(0, ty, 0, ty + tile);
    grad.addColorStop(0, colour);
    grad.addColorStop(1, THEME.surface);
    g.fillStyle = grad;
    g.fillRect(tx, ty, tile, tile);
    if (hs && hs.ok) {
      const img = hs.img;
      const sz = Math.min(img.naturalWidth, img.naturalHeight) || 1;
      g.drawImage(img, (img.naturalWidth - sz) / 2, 0, sz, sz, tx, ty, tile, tile);
    } else if (d) {
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'alphabetic';
      g.font = font(72, 700);
      g.fillText(String(d.number), tx + tile / 2, ty + 92);
      g.font = font(30, 700);
      g.fillText(d.acronym || '', tx + tile / 2, ty + 138);
    }
    g.restore();

    const x = tx + tile + 28;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = THEME.text;
    g.font = font(40, 700);
    const name = d ? (d.fullName || d.acronym) : `#${ctx.selected}`;
    g.fillText(fitText(g, name, w - x - 190), x, 78);
    g.fillStyle = colour;
    g.font = dfont(34, 700);
    const num = d ? String(d.number) : '';
    g.fillText(num, x, 126);
    const nw = g.measureText(num).width;
    g.fillStyle = THEME.muted;
    g.font = font(28, 600);
    g.fillText(fitText(g, d ? d.teamName || '' : '', w - x - nw - 210), x + nw + 16, 126);

    // lap
    if (this._cur) {
      g.fillStyle = THEME.muted;
      g.font = font(26, 600);
      const total = this.data.totalLaps;
      g.fillText(`LAP ${this._cur.lap_number}${total ? ` / ${total}` : ''}`, x, 172);
    }

    // position
    const pos = this.data.getPositionAt(ctx.selected, ctx.time);
    const bx = w - PAD - 150;
    g.fillStyle = THEME.surface;
    roundRect(g, bx, 28, 150, 104, 12);
    g.fill();
    g.fillStyle = THEME.accent;
    roundRect(g, bx, 28, 8, 104, [12, 0, 0, 12]);
    g.fill();
    g.textAlign = 'center';
    g.fillStyle = THEME.text;
    g.font = dfont(64, 700);
    g.fillText(pos ? `P${pos}` : '–', bx + 79, 104);

    if (this._s.radio) {
      const playing = this._s.radio === 2;
      const rw = playing ? 170 : 120;
      const rx = w - PAD - rw;
      g.fillStyle = THEME.accent;
      roundRect(g, rx, 144, rw, 40, 8);
      g.fill();
      g.fillStyle = '#ffffff';
      g.font = font(26, 700);
      g.textBaseline = 'middle';
      g.fillText(playing ? '◉ RADIO' : 'RADIO', rx + rw / 2, 165);
    }

    g.fillStyle = THEME.line;
    g.fillRect(PAD, HEADER_H, w - 2 * PAD, 2);
  }

  _drawTrace(g, w, h, d) {
    const x0 = PAD + 64;
    const x1 = w - PAD;
    const y0 = TRACE_Y + 56;
    const y1 = h - 72;
    const top = TRACE_Y;
    g.fillStyle = THEME.line;
    g.fillRect(PAD, top - 16, w - 2 * PAD, 2);

    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillStyle = THEME.text;
    g.font = font(28, 700);
    g.fillText('SPEED TRACE', PAD, top + 28);
    const lap = this._cur;
    if (lap) {
      g.textAlign = 'right';
      g.font = font(24, 600);
      const lx = x1;
      g.fillStyle = d ? d.teamColour : THEME.text;
      g.fillText(`LAP ${lap.lap_number}`, lx, top + 28);
      if (lap.lap_number > 1) {
        const lw = g.measureText(`LAP ${lap.lap_number}`).width;
        g.fillStyle = THEME.muted;
        g.fillText(`LAP ${lap.lap_number - 1}  ·  `, lx - lw, top + 28);
      }
    }

    // grid: 0..350 km/h every 50 (labels every 100)
    g.font = font(24, 600);
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (let v = 0; v <= SPEED_MAX; v += 50) {
      const y = y1 - (v / SPEED_MAX) * (y1 - y0);
      g.fillStyle = v === 0 ? THEME.line : 'rgba(138,148,166,0.16)';
      g.fillRect(x0, Math.round(y), x1 - x0, v === 0 ? 2 : 1);
      if (v % 100 === 0) {
        g.fillStyle = THEME.muted;
        g.fillText(String(v), x0 - 12, y);
      }
    }

    const cur = this._curTrace;
    const prev = this._prevTrace;
    if (!lap) { traceMsg(g, (x0 + x1) / 2, (y0 + y1) / 2, 'No lap in progress'); return; }
    if (!cur && !prev) { traceMsg(g, (x0 + x1) / 2, (y0 + y1) / 2, 'Loading lap trace…'); return; }

    let maxD = cur && cur.dist.length ? cur.dist[cur.dist.length - 1] : 0;
    if (prev && prev.dist.length) maxD = Math.max(maxD, prev.dist[prev.dist.length - 1]);
    if (maxD < 1000) maxD = 1000;

    // distance axis (km)
    g.textAlign = 'center';
    g.textBaseline = 'top';
    g.fillStyle = THEME.muted;
    const kmStep = maxD > 4000 ? 1000 : 500;
    for (let m = 0; m <= maxD; m += kmStep) {
      const x = x0 + (m / maxD) * (x1 - x0);
      g.fillStyle = 'rgba(138,148,166,0.10)';
      g.fillRect(Math.round(x), y0, 1, y1 - y0);
      g.fillStyle = THEME.muted;
      g.fillText(`${(m / 1000).toFixed(kmStep < 1000 ? 1 : 0)}`, x, y1 + 10);
    }
    g.textAlign = 'right';
    g.fillText('km', x1, y1 + 40);

    g.lineJoin = 'round';
    g.lineCap = 'round';
    if (prev) {
      g.strokeStyle = 'rgba(232,236,242,0.28)';
      g.lineWidth = 3;
      strokeTrace(g, prev, prev.time.length, x0, x1, y0, y1, maxD);
    }
    const n = this._curN;
    if (!cur) traceMsg(g, (x0 + x1) / 2, y0 + 30, 'Loading lap trace…');
    if (cur && n > 1) {
      const tc = d ? d.teamColour : THEME.accent;
      g.strokeStyle = rgba(tc, 0.22);
      g.lineWidth = 14;
      strokeTrace(g, cur, n, x0, x1, y0, y1, maxD);
      g.strokeStyle = tc;
      g.lineWidth = 5;
      strokeTrace(g, cur, n, x0, x1, y0, y1, maxD);
      // playhead dot
      const px = x0 + (cur.dist[n - 1] / maxD) * (x1 - x0);
      const py = y1 - (Math.min(cur.speed[n - 1], SPEED_MAX) / SPEED_MAX) * (y1 - y0);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(px, py, 8, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function strokeTrace(g, tr, n, x0, x1, y0, y1, maxD) {
  const sx = (x1 - x0) / maxD;
  const sy = (y1 - y0) / SPEED_MAX;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const x = x0 + tr.dist[i] * sx;
    const y = y1 - Math.min(tr.speed[i], SPEED_MAX) * sy;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.stroke();
}

function traceMsg(g, x, y, msg) {
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = THEME.muted;
  g.font = font(28, 600);
  g.fillText(msg, x, y);
}

/** Truncate text with an ellipsis to fit maxW px (uses the current font). */
function fitText(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && g.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
  return `${s}…`;
}
