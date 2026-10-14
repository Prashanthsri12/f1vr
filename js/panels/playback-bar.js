// Playback bar (spec §8): play/pause, speed −/+, lap slider (click to seek to a lap),
// elapsed race time and the real session clock. Sits just below the main screen.
// Second row (8.9, sync with a broadcast): Lights out, ◀ LAP / LAP ▶ and the ±1 s / ±5 s
// nudge with the session's offset (or "VIDEO SYNC" while a synced video leads). It uses
// ctx.actions.goLightsOut / stepLap / nudge / getSync (sync-control.js); without them the
// row is drawn disabled.
// Race timeline (9.15): SC / VSC / red flag bands on the lap slider, the selected driver's
// pit stops (other stops faint) and fastest-lap marks above it, up to the playhead only.
// Clicking a mark jumps there (ctx.actions.seekTo, a few seconds before).
import { Panel, THEME, font, dfont, roundRect, rgba } from './panel-base.js';
import { buildTimeline, visibleTimeline } from './timeline-marks.js';
import { getSettings } from '../settings.js';
import { LAYOUT } from './layout.js';
import { getApiHealth } from '../api.js';
import { SPEEDS } from '../playback.js';

const L = LAYOUT.playbackBar;
const PAD = 12;
const ROW1 = Math.round(L.row1Height * 1024);   // 164 px: transport, slider, clock
const NUDGES = [['n-5', -5, '−5s'], ['n-1', -1, '−1s'], ['n+1', 1, '+1s'], ['n+5', 5, '+5s']];
const BAND_COLOUR = { sc: THEME.orange, vsc: THEME.yellow, red: THEME.red };
const JUMP_LEAD_MS = 3000; // a mark jumps this much before its moment

/** Sync offset label: "+1.5 s", "−2.0 s", "0.0 s". */
export function fmtOffset(ms) {
  const v = Math.round(ms / 100) / 10;
  if (v === 0) return '0.0 s';
  return `${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)} s`;
}

function two(n) { return (n < 10 ? '0' : '') + n; }

/** Elapsed time: "-1:58", "12:04", "1:02:15". */
export function fmtElapsed(ms) {
  const neg = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  if (neg) s = Math.ceil(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const body = h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
  return neg ? `-${body}` : body;
}

/** Session clock: "15:01:42 UTC". */
export function fmtClock(ms) {
  const d = new Date(ms);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())} UTC`;
}

function fmtSpeed(s) { return `${s}x`; }

export class PlaybackBarPanel extends Panel {
  /** @param {import('../session-data.js').SessionData} data */
  constructor(data) {
    super({ name: 'playbackBar', width: L.width, height: L.height });
    this.data = data;
    this._shown = { playing: null, waiting: null, speed: null, sec: NaN, down: null, off: NaN, lead: null, sel: null };
    this._tl = null;     // timeline-marks.js, built on first draw
    this._track = { x: 0, w: 1 };   // slider track in canvas px (set in draw)
  }

  /** Leader lap (0 before the start) plus fraction through it, 0..totalLaps. */
  _progress(t) {
    const d = this.data;
    const lap = d.getLeaderLapAt(t);
    if (!lap) return { lap: 0, value: 0 };
    const start = d.getLapStartTime(lap);
    const next = lap < d.totalLaps ? d.getLapStartTime(lap + 1) : null;
    let f = 0;
    if (start != null && next != null && next > start) f = Math.min(1, Math.max(0, (t - start) / (next - start)));
    else if (lap >= d.totalLaps) f = t >= d.dataEndTime ? 1 : 0.5;
    return { lap, value: lap - 1 + f };
  }

  refresh(ctx) {
    const pb = ctx.playback;
    const s = this._shown;
    const sec = Math.floor(ctx.time / 1000);
    // Elapsed time and clock change every playhead second; the slider moves far slower,
    // so the whole-second check covers it.
    const down = !getApiHealth().ok;   // OpenF1 unreachable / 5xx: say so instead of looking frozen
    const sync = ctx.actions && ctx.actions.getSync ? ctx.actions.getSync() : null;
    const off = sync ? sync.offsetMs : NaN;
    const lead = sync ? sync.videoLeads : null;
    if (s.playing === pb.playing && s.waiting === pb.waiting && s.speed === pb.speed && s.sec === sec
      && s.down === down && (s.off === off || (off !== off && s.off !== s.off)) && s.lead === lead
      && s.sel === ctx.selected && s.full === getSettings().fullSession) return false;
    s.full = getSettings().fullSession;
    s.playing = pb.playing; s.waiting = pb.waiting; s.speed = pb.speed; s.sec = sec; s.down = down;
    s.off = off; s.lead = lead; s.sel = ctx.selected;
    return true;
  }

  onHit(hit, ctx, px) {
    const a = ctx.actions;
    if (hit.id === 'play') a.togglePlay();
    else if (hit.id === 'slower') a.speedDown();
    else if (hit.id === 'faster') a.speedUp();
    else if (hit.id === 'lights') a.goLightsOut();
    else if (hit.id === 'lapPrev') a.stepLap(-1);
    else if (hit.id === 'lapNext') a.stepLap(1);
    else if (hit.id.startsWith('n') && hit.payload) a.nudge(hit.payload);
    else if (hit.id.startsWith('mark') && hit.payload != null) {
      if (a.seekTo) a.seekTo(hit.payload - JUMP_LEAD_MS);
      else a.seekToLap(Math.max(1, this.data.getLeaderLapAt(hit.payload)));
    }
    else if (hit.id === 'slider' && px) {
      const total = Math.max(1, this.data.totalLaps || 1);
      const f = (px.x - this._track.x) / this._track.w;
      const lap = Math.min(total, Math.max(1, 1 + Math.floor(f * total)));
      a.seekToLap(lap);
    }
  }

  _button(g, id, x, y, w, h, enabled) {
    const hov = enabled && this.hover === id;
    g.fillStyle = hov ? THEME.surfaceHi : THEME.surface;
    roundRect(g, x, y, w, h, 14);
    g.fill();
    if (hov) {
      g.strokeStyle = THEME.accent;
      g.lineWidth = 4;
      roundRect(g, x + 2, y + 2, w - 4, h - 4, 12);
      g.stroke();
    }
    if (enabled) this.addHit(id, x, y, w, h);
  }

  /** Text button for the sync row. */
  _textButton(g, id, x, y, w, h, label, enabled, payload) {
    this._button(g, id, x, y, w, h, enabled);
    if (enabled && payload !== undefined) this._hits[this._hits.length - 1].payload = payload;
    g.globalAlpha = enabled ? 1 : 0.4;
    g.fillStyle = THEME.text;
    g.font = font(30, 700);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, x + w / 2, y + h / 2 + 1);
    g.globalAlpha = 1;
  }

  /** Second row: Lights out, lap steps, nudge and the offset (8.9). */
  _drawSyncRow(g, w, h, ctx) {
    const a = ctx.actions || {};
    const sync = a.getSync ? a.getSync() : null;
    const on = !!sync;
    const y = ROW1;
    const bh = h - ROW1 - PAD;
    let x = PAD;
    this._textButton(g, 'lights', x, y, 236, bh, '⚑ LIGHTS OUT', on);
    x += 248;
    this._textButton(g, 'lapPrev', x, y, 136, bh, '◀ LAP', on);
    x += 148;
    this._textButton(g, 'lapNext', x, y, 136, bh, 'LAP ▶', on);
    // Nudge, right-aligned: −5 −1 [offset] +1 +5
    const nw = 92;
    const vw = 190;
    let nx = w - PAD - (4 * nw + vw + 4 * 8);
    g.fillStyle = THEME.muted;
    g.font = font(24, 700);
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText('SYNC', nx - 14, y + bh / 2);
    for (let i = 0; i < NUDGES.length; i++) {
      const [id, sec, label] = NUDGES[i];
      if (i === 2) {
        const lead = on && sync.videoLeads;
        g.fillStyle = THEME.surface;
        roundRect(g, nx, y, vw, bh, 14);
        g.fill();
        g.fillStyle = lead ? THEME.accent : on && sync.offsetMs ? THEME.yellow : THEME.text;
        g.font = font(lead ? 26 : 32, 700);
        g.textAlign = 'center';
        g.fillText(!on ? '–' : lead ? 'VIDEO SYNC' : fmtOffset(sync.offsetMs), nx + vw / 2, y + bh / 2 + 1);
        nx += vw + 8;
      }
      this._textButton(g, id, nx, y, nw, bh, label, on, sec);
      nx += nw + 8;
    }
    g.textAlign = 'left';
  }

  draw(g, w, h, ctx) {
    this.clear(g, w, h);
    const pb = ctx.playback;
    const t = ctx.time;
    const d = this.data;
    const bh = ROW1 - 2 * PAD;       // 140 px buttons
    const cy = ROW1 / 2;

    // --- play / pause ---
    let x = PAD;
    const playW = 150;
    // Race-red play button with a white rim and a soft red halo (10.7).
    g.fillStyle = rgba(THEME.accent, this.hover === 'play' ? 0.4 : 0.25);
    roundRect(g, x - 5, PAD - 5, playW + 10, bh + 10, 19);
    g.fill();
    g.fillStyle = THEME.accent;
    roundRect(g, x, PAD, playW, bh, 14);
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 4;
    roundRect(g, x + 2, PAD + 2, playW - 4, bh - 4, 12);
    g.stroke();
    this.addHit('play', x, PAD, playW, bh);
    g.fillStyle = '#ffffff';
    if (pb.playing) {
      g.fillRect(x + playW / 2 - 24, cy - 32, 16, 64);
      g.fillRect(x + playW / 2 + 8, cy - 32, 16, 64);
    } else {
      g.beginPath();
      g.moveTo(x + playW / 2 - 20, cy - 36);
      g.lineTo(x + playW / 2 + 30, cy);
      g.lineTo(x + playW / 2 - 20, cy + 36);
      g.closePath();
      g.fill();
    }
    x += playW + 16;

    // --- speed −  1x  + ---
    const si = SPEEDS.indexOf(pb.speed);
    const canDown = si !== 0;
    const canUp = si === -1 || si < SPEEDS.length - 1;
    const sbW = 100;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    this._button(g, 'slower', x, PAD, sbW, bh, canDown);
    g.fillStyle = canDown ? THEME.text : THEME.line;
    g.fillRect(x + sbW / 2 - 22, cy - 4, 44, 8);
    x += sbW;
    g.fillStyle = THEME.text;
    g.font = dfont(52, 700);
    g.fillText(fmtSpeed(pb.speed), x + 64, cy - 8);
    g.fillStyle = THEME.muted;
    g.font = font(24, 600);
    g.fillText('SPEED', x + 64, cy + 38);
    x += 128;
    this._button(g, 'faster', x, PAD, sbW, bh, canUp);
    g.fillStyle = canUp ? THEME.text : THEME.line;
    g.fillRect(x + sbW / 2 - 22, cy - 4, 44, 8);
    g.fillRect(x + sbW / 2 - 4, cy - 22, 8, 44);
    x += sbW + 28;

    // --- time block on the right ---
    const timeW = 250;
    const tx = w - PAD - timeW;
    g.textAlign = 'right';
    g.fillStyle = THEME.text;
    g.font = dfont(52, 700);
    g.fillText(fmtElapsed(t - d.raceStartTime), w - PAD - 8, cy - 18);
    g.fillStyle = THEME.muted;
    g.font = font(28, 600);
    g.fillText(fmtClock(t), w - PAD - 8, cy + 34);

    // --- lap slider ---
    const sx = x;
    const sw = tx - 24 - sx;
    const total = Math.max(1, d.totalLaps || 1);
    const p = this._progress(t);
    const hov = this.hover === 'slider';
    g.textAlign = 'left';
    g.font = font(36, 700);
    g.fillStyle = THEME.text;
    const lapText = p.lap ? `LAP ${p.lap}/${total}` : `GRID · ${total} LAPS`;
    const lapW = g.measureText(lapText).width;
    g.font = font(30, 700);
    const note = this._shown.down ? 'Data unavailable · retrying' : pb.waiting ? 'Loading data…' : '';
    const loadW = note ? g.measureText(note).width : 0;
    if (!note || lapW + loadW + 24 <= sw - 8) {
      g.font = font(36, 700);
      g.fillText(lapText, sx + 4, PAD + 30);
    }
    if (note) {
      g.textAlign = 'right';
      g.fillStyle = this._shown.down ? THEME.red : THEME.yellow;
      g.font = font(30, 700);
      g.fillText(note, sx + sw - 4, PAD + 30);
    }
    const trackY = 104;
    const trackH = 18;
    const trX = sx + 14;
    const trW = sw - 28;
    this._track.x = trX;
    this._track.w = trW;
    g.fillStyle = hov ? THEME.surfaceHi : THEME.surface;
    roundRect(g, trX, trackY - trackH / 2, trW, trackH, trackH / 2);
    g.fill();
    // lap ticks every 10 laps
    g.fillStyle = THEME.line;
    for (let lap = 10; lap < total; lap += 10) {
      g.fillRect(trX + (lap / total) * trW - 2, trackY + trackH / 2 + 4, 4, 14);
    }
    const fx = trX + Math.min(1, p.value / total) * trW;
    const doneW = Math.max(trackH, fx - trX);
    g.fillStyle = rgba(THEME.accent, 0.3);
    roundRect(g, trX - 5, trackY - trackH / 2 - 5, doneW + 10, trackH + 10, trackH / 2 + 5);
    g.fill();
    g.fillStyle = THEME.accent;
    roundRect(g, trX, trackY - trackH / 2, doneW, trackH, trackH / 2);
    g.fill();
    const markHits = this._drawTimeline(g, t, ctx.selected, trX, trW, trackY, trackH, total);
    g.beginPath();
    g.arc(fx, trackY, hov ? 30 : 26, 0, Math.PI * 2);
    g.fillStyle = rgba(THEME.accent, 0.35);
    g.fill();
    g.beginPath();
    g.arc(fx, trackY, hov ? 22 : 18, 0, Math.PI * 2);
    g.fillStyle = '#ffffff';
    g.fill();
    if (hov) {
      g.strokeStyle = THEME.accent;
      g.lineWidth = 4;
      roundRect(g, sx, PAD, sw, bh, 14);
      g.stroke();
    }
    this.addHit('slider', sx, PAD, sw, bh);
    for (const m of markHits) this.addHit(m.id, m.x - 14, m.y, 28, m.h, m.t); // after the slider: marks win
    this._drawSyncRow(g, w, h, ctx);
  }

  /** x on the slider track for session time t. */
  _xAt(t, trX, trW, total) {
    return trX + Math.min(1, Math.max(0, this._progress(t).value / total)) * trW;
  }

  /** Bands on the track, marks above it (9.15). Returns the clickable marks. */
  _drawTimeline(g, t, selected, trX, trW, trackY, trackH, total) {
    if (!this._tl) this._tl = buildTimeline(this.data);
    const v = visibleTimeline(this._tl, getSettings().fullSession ? Infinity : t, selected); // 9.29
    const hits = [];
    for (const b of v.bands) {
      const x0 = this._xAt(b.from, trX, trW, total);
      const x1 = Math.max(x0 + 6, this._xAt(b.to, trX, trW, total));
      g.fillStyle = rgba(BAND_COLOUR[b.kind], 0.9);
      roundRect(g, x0, trackY - trackH / 2 - 3, x1 - x0, trackH + 6, 4);
      g.fill();
      hits.push({ id: `mark:${b.kind}`, x: (x0 + x1) / 2, y: trackY - 20, h: 40, t: b.from });
    }
    const top = trackY - trackH / 2 - 6;
    for (const m of v.marks) {
      const x = this._xAt(m.t, trX, trW, total);
      if (m.kind === 'fastest') {
        g.fillStyle = THEME.purple;
        g.beginPath();
        g.moveTo(x, top - 22); g.lineTo(x + 7, top - 14); g.lineTo(x, top - 6); g.lineTo(x - 7, top - 14);
        g.closePath();
        g.fill();
        hits.push({ id: 'mark:fl', x, y: top - 26, h: 24, t: m.t });
      } else if (m.mine) {
        // The selected driver's stop: a tall blue pin (no label: it would collide with the lap text).
        g.fillStyle = THEME.blue;
        g.fillRect(x - 3, top - 24, 6, 24);
        g.beginPath();
        g.arc(x, top - 28, 8, 0, Math.PI * 2);
        g.fill();
        hits.push({ id: 'mark:pit', x, y: top - 40, h: 40, t: m.t });
      } else {
        g.fillStyle = rgba(THEME.blue, 0.35);
        g.fillRect(x - 1, top - 10, 2, 10);
      }
    }
    return hits;
  }
}
