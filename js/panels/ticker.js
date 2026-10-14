// Race control ticker (spec §5): the latest race control message on a flag-coloured
// strip above the main screen. Long messages scroll (marquee). A tap expands the
// last 5 messages downward over the transparent lower part of the mesh.
import { Panel, THEME, font, dfont, roundRect, PX_PER_M } from './panel-base.js';
import { LAYOUT } from './layout.js';

const L = LAYOUT.ticker;
const STRIP_PX = Math.round(L.stripHeight * PX_PER_M);   // 154
const META_W = 270;            // lap + time block on the left of the strip
const PAD = 28;
const MSG_FONT = 58;
const SCROLL_PX_PER_S = 160;
const SCROLL_PAUSE_S = 1.5;    // hold the start of a long message before scrolling
const SCROLL_GAP = 160;        // gap between repeats of a scrolling message
const FLASH_MS = 1000;
const NEW_MSG_WINDOW_MS = 5000; // only chime for messages this fresh
const JUMP_MS = 15000;          // playhead moved more than this between refreshes = seek
const ROWS = 5;
const HINT_W = 170;            // "▼ LAST 5" hint at the right end of the strip

const DARK_TEXT = '#111318';
const LIGHT_TEXT = '#ffffff';

/**
 * Visual style for a race control message.
 * @returns {{kind: string, bg: string, fg: string}} kind: solid|double|chequered|blackwhite|neutral
 */
export function flagStyle(msg) {
  if (!msg) return { kind: 'neutral', bg: '#1b2130', fg: THEME.muted };
  const flag = (msg.flag || '').toUpperCase();
  if (msg.category === 'SafetyCar') return { kind: 'solid', bg: '#ff8a00', fg: DARK_TEXT };
  switch (flag) {
    case 'GREEN':
    case 'CLEAR': return { kind: 'solid', bg: '#14823c', fg: LIGHT_TEXT };
    case 'YELLOW': return { kind: 'solid', bg: '#ffd21f', fg: DARK_TEXT };
    case 'DOUBLE YELLOW': return { kind: 'double', bg: '#ffd21f', fg: DARK_TEXT };
    case 'RED': return { kind: 'solid', bg: '#d01d16', fg: LIGHT_TEXT };
    case 'BLUE': return { kind: 'solid', bg: '#1f5fd8', fg: LIGHT_TEXT };
    case 'CHEQUERED': return { kind: 'chequered', bg: '#000000', fg: LIGHT_TEXT };
    case 'BLACK AND WHITE': return { kind: 'blackwhite', bg: '#000000', fg: LIGHT_TEXT };
    default: return { kind: 'neutral', bg: '#15161d', fg: THEME.text };
  }
}

/** Fill a rect with the flag's background (pattern included). */
function fillFlag(g, style, x, y, w, h, sq, passthrough) {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  if (style.kind === 'neutral') {
    g.fillStyle = passthrough ? `rgba(${THEME.bgRgb},0.85)` : style.bg;
    g.fillRect(x, y, w, h);
  } else if (style.kind === 'chequered') {
    g.fillStyle = '#f2f2f2';
    g.fillRect(x, y, w, h);
    g.fillStyle = '#000';
    for (let row = 0; row * sq < h; row++) {
      for (let col = row % 2; col * sq < w; col += 2) g.fillRect(x + col * sq, y + row * sq, sq, sq);
    }
  } else if (style.kind === 'blackwhite') {
    g.fillStyle = '#000';
    g.fillRect(x, y, w, h);
    g.fillStyle = '#f2f2f2';          // diagonal half
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.min(w, h * 1.6), y);
    g.lineTo(x, y + h);
    g.closePath();
    g.fill();
  } else {
    g.fillStyle = style.bg;
    g.fillRect(x, y, w, h);
    if (style.kind === 'double') {    // two dark stripes along the top and bottom
      const s = Math.max(4, Math.round(h * 0.07));
      g.fillStyle = 'rgba(17,19,24,0.85)';
      g.fillRect(x, y + s, w, s);
      g.fillRect(x, y + h - 2 * s, w, s);
    }
  }
  g.restore();
}

function hhmmss(ms) {
  const d = new Date(ms);
  const p = (n) => (n < 10 ? '0' : '') + n;
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class TickerPanel extends Panel {
  /** @param {import('../session-data.js').SessionData} data */
  constructor(data) {
    super({ name: 'ticker', width: L.width, height: L.height });
    this.data = data;
    this.expanded = false;
    this._msgs = [];           // newest first, as drawn
    this._newest = null;       // newest message object drawn
    this._lastT = NaN;
    this._flashStart = -Infinity;
    this._scrollStart = 0;     // performance.now() when the current message appeared
    this._overflow = false;    // set in draw(): the message is wider than the strip
    this._textW = 0;
    this._listeners = new Set();
  }

  /**
   * Register a callback fired when playback reaches a new message (not on seek/load).
   * @param {(msg: object) => void} cb
   * @returns {() => void} unsubscribe
   */
  onNewMessage(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }

  /** Show or hide the last-5 list. */
  setExpanded(on) {
    on = !!on;
    if (on !== this.expanded) { this.expanded = on; this.invalidate(); }
  }

  refresh(ctx) {
    const t = ctx.time;
    let changed = false;
    if (t !== this._lastT) {
      const msgs = this.data.getRaceControlAt(t, ROWS);
      const newest = msgs[0] || null;
      if (newest !== this._newest) {
        const prev = this._newest;
        const advanced = Number.isFinite(this._lastT) && t >= this._lastT && t - this._lastT < JUMP_MS
          && newest && (!prev || newest.date >= prev.date) && t - newest.date <= NEW_MSG_WINDOW_MS;
        this._newest = newest;
        this._scrollStart = now();
        changed = true;
        if (advanced) {
          this._flashStart = now();
          for (const cb of this._listeners) {
            try { cb(newest); } catch (e) { console.error('ticker onNewMessage listener failed', e); }
          }
        }
      }
      this._msgs = msgs;
      this._lastT = t;
    }
    if (changed) return true;
    if (now() - this._flashStart < FLASH_MS + 100) return true;   // flash fade (≤10 Hz)
    return this._overflow;                                          // marquee only while overflowing
  }

  onHit(hit) {
    if (hit.id === 'ticker') this.setExpanded(!this.expanded);
  }

  draw(g, w, h) {
    g.clearRect(0, 0, w, h);
    const msg = this._newest;
    const style = flagStyle(msg);
    const hovered = this.hover === 'ticker';

    // --- strip ---
    g.save();
    roundRect(g, 0, 0, w, STRIP_PX, 18);
    g.clip();
    fillFlag(g, style, 0, 0, w, STRIP_PX, style.kind === 'chequered' ? 22 : STRIP_PX / 2, this.passthrough);
    let fg = style.fg;
    if (style.kind === 'chequered' || style.kind === 'blackwhite') {
      // dark band behind the text so the pattern stays visible around it
      g.fillStyle = '#0b0b0b';
      const bx = style.kind === 'blackwhite' ? STRIP_PX * 1.1 : 22;
      roundRect(g, bx, 22, w - bx - 22, STRIP_PX - 44, 8);
      g.fill();
      fg = LIGHT_TEXT;
    }
    const metaX = style.kind === 'blackwhite' ? STRIP_PX * 1.1 + PAD : PAD + (style.kind === 'chequered' ? 24 : 0);

    if (msg) {
      // meta: lap and time
      g.fillStyle = fg;
      g.textBaseline = 'alphabetic';
      g.textAlign = 'left';
      g.font = dfont(40, 700);
      g.fillText(msg.lap_number != null ? `LAP ${msg.lap_number}` : 'LAP –', metaX, 66);
      g.globalAlpha = 0.8;
      g.font = font(32, 600);
      g.fillText(hhmmss(msg.date), metaX, 112);
      g.globalAlpha = 1;
      // separator
      g.fillStyle = fg;
      g.globalAlpha = 0.35;
      g.fillRect(metaX + META_W - 30, 30, 3, STRIP_PX - 60);
      g.globalAlpha = 1;

      // message (marquee if it overflows)
      const mx = metaX + META_W;
      const mw = w - mx - PAD - HINT_W - (style.kind === 'chequered' ? 24 : 0);
      const text = msg.message || '';
      g.font = font(MSG_FONT, 700);
      this._textW = g.measureText(text).width;
      this._overflow = this._textW > mw;
      let off = 0;
      if (this._overflow) {
        const s = (now() - this._scrollStart) / 1000 - SCROLL_PAUSE_S;
        const loop = this._textW + SCROLL_GAP;
        off = s > 0 ? (s * SCROLL_PX_PER_S) % loop : 0;
      }
      g.save();
      g.beginPath();
      g.rect(mx, 0, mw, STRIP_PX);
      g.clip();
      g.fillStyle = fg;
      g.textBaseline = 'middle';
      g.fillText(text, mx - off, STRIP_PX / 2 + 3);
      if (this._overflow) g.fillText(text, mx - off + this._textW + SCROLL_GAP, STRIP_PX / 2 + 3);
      g.restore();
    } else {
      this._overflow = false;
      g.fillStyle = THEME.muted;
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      g.font = font(44, 600);
      g.fillText('RACE CONTROL — no messages yet', metaX, STRIP_PX / 2 + 2);
    }

    // expand/collapse hint on the right
    g.textBaseline = 'middle';
    g.textAlign = 'right';
    g.font = font(30, 700);
    g.fillStyle = fg;
    g.globalAlpha = hovered ? 0.95 : 0.55;
    if (msg) g.fillText(this.expanded ? '▲ LESS' : '▼ LAST 5', w - PAD - (style.kind === 'chequered' ? 24 : 0), STRIP_PX / 2 + 2);
    g.globalAlpha = 1;

    // flash: brighten, fading over FLASH_MS
    const age = now() - this._flashStart;
    if (age < FLASH_MS) {
      g.fillStyle = `rgba(255,255,255,${(0.55 * (1 - age / FLASH_MS)).toFixed(3)})`;
      g.fillRect(0, 0, w, STRIP_PX);
    }
    if (hovered) {
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = 6;
      roundRect(g, 3, 3, w - 6, STRIP_PX - 6, 16);
      g.stroke();
    }
    g.restore();
    this.addHit('ticker', 0, 0, w, STRIP_PX);

    if (this.expanded) this._drawList(g, w, h, hovered);
  }

  /** @private The last 5 messages stacked under the strip. */
  _drawList(g, w, h, hovered) {
    const top = STRIP_PX + 8;
    const listH = h - top;
    g.fillStyle = this.passthrough ? `rgba(${THEME.bgRgb},0.85)` : THEME.bg;
    roundRect(g, 0, top, w, listH, 18);
    g.fill();
    if (hovered) {
      g.strokeStyle = THEME.line;
      g.lineWidth = 4;
      roundRect(g, 2, top + 2, w - 4, listH - 4, 16);
      g.stroke();
    }
    const rowH = (listH - 12) / ROWS;
    const msgs = this._msgs;
    if (!msgs.length) {
      g.fillStyle = THEME.muted;
      g.font = font(36, 600);
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText('No race control messages yet', PAD, top + rowH / 2 + 6);
    }
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const y = top + 6 + i * rowH;
      if (i % 2 === 1) {
        g.fillStyle = THEME.surface;
        g.fillRect(8, y, w - 16, rowH);
      }
      const chip = rowH - 30;
      const st = flagStyle(m);
      fillFlag(g, st.kind === 'neutral' ? { kind: 'solid', bg: '#3a4357' } : st,
        PAD, y + 15, chip * 1.4, chip, chip / 3, false);
      g.textBaseline = 'middle';
      g.textAlign = 'left';
      const cy = y + rowH / 2 + 2;
      g.fillStyle = THEME.muted;
      g.font = font(32, 600);
      const mx = PAD + chip * 1.4 + 24;
      g.fillText(m.lap_number != null ? `L${m.lap_number}` : '–', mx, cy);
      g.fillText(hhmmss(m.date), mx + 90, cy);
      g.fillStyle = i === 0 ? THEME.text : '#c4cad6';
      g.font = font(38, i === 0 ? 700 : 600);
      const tx = mx + 260;
      g.save();
      g.beginPath();
      g.rect(tx, y, w - tx - PAD, rowH);
      g.clip();
      g.fillText(m.message || '', tx, cy);
      g.restore();
    }
    this.addHit('ticker', 0, top, w, listH);
  }
}
