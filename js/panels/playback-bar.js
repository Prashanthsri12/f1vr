// Playback bar (spec §8): play/pause, speed −/+, lap slider (click to seek to a lap),
// elapsed race time and the real session clock. Sits just below the main screen.
import { Panel, THEME, font, roundRect } from './panel-base.js';
import { LAYOUT } from './layout.js';
import { getApiHealth } from '../api.js';
import { SPEEDS } from '../playback.js';

const L = LAYOUT.playbackBar;
const PAD = 12;

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
    this._shown = { playing: null, waiting: null, speed: null, sec: NaN, down: null };
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
    if (s.playing === pb.playing && s.waiting === pb.waiting && s.speed === pb.speed && s.sec === sec
      && s.down === down) return false;
    s.playing = pb.playing; s.waiting = pb.waiting; s.speed = pb.speed; s.sec = sec; s.down = down;
    return true;
  }

  onHit(hit, ctx, px) {
    const a = ctx.actions;
    if (hit.id === 'play') a.togglePlay();
    else if (hit.id === 'slower') a.speedDown();
    else if (hit.id === 'faster') a.speedUp();
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

  draw(g, w, h, ctx) {
    this.clear(g, w, h);
    const pb = ctx.playback;
    const t = ctx.time;
    const d = this.data;
    const bh = h - 2 * PAD;          // 140 px buttons
    const cy = h / 2;

    // --- play / pause ---
    let x = PAD;
    const playW = 150;
    this._button(g, 'play', x, PAD, playW, bh, true);
    g.fillStyle = pb.playing ? THEME.text : THEME.accent;
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
    g.font = font(48, 700);
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
    g.font = font(48, 700);
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
    g.fillStyle = THEME.accent;
    roundRect(g, trX, trackY - trackH / 2, Math.max(trackH, fx - trX), trackH, trackH / 2);
    g.fill();
    g.beginPath();
    g.arc(fx, trackY, hov ? 22 : 18, 0, Math.PI * 2);
    g.fillStyle = THEME.text;
    g.fill();
    if (hov) {
      g.strokeStyle = THEME.accent;
      g.lineWidth = 4;
      roundRect(g, sx, PAD, sw, bh, 14);
      g.stroke();
    }
    this.addHit('slider', sx, PAD, sw, bh);
  }
}
