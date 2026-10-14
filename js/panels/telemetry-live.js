// Live readout block of the telemetry panel (9.5): shift lights, an arc speed gauge with the
// speed and RPM inside, a big gear digit, vertical throttle / brake bars and a DRS light.
// Draws into the panel's canvas between y0 and y0 + LIVE_H (canvas px, panel 922 px wide).
// Only called from TelemetryPanel.draw (≤10 Hz, on change); gradients are cached per context.
// 10.5: green → yellow → red speed arc, a glowing cyan gear, segmented throttle / brake bars.
import { THEME, font, dfont, rgba, glowStroke, roundRect } from './panel-base.js';

export const LIVE_H = 410;

const SPEED_MAX = 350;
// Shift lights: 15 LEDs (5 green, 5 red, 5 blue) over the top of the rev range.
const LED_N = 15;
const LED_FROM = 9500;
const LED_TO = 12200;
const LED_COLOURS = [THEME.green, THEME.red, THEME.blue];

// Gauge: a 270° arc open at the bottom.
const ARC_START = Math.PI * 0.75;
const ARC_SWEEP = Math.PI * 1.5;

const _grads = new WeakMap(); // ctx -> { key, grad }

function gaugeGradient(g, cx, cy, r) {
  const key = `${cx},${cy},${r}`;
  let c = _grads.get(g);
  if (!c || c.key !== key) {
    const grad = g.createLinearGradient(cx - r, 0, cx + r, 0);
    grad.addColorStop(0, THEME.green);
    grad.addColorStop(0.55, THEME.yellow);
    grad.addColorStop(1, THEME.accent);
    c = { key, grad };
    _grads.set(g, c);
  }
  return c.grad;
}

/**
 * @param {CanvasRenderingContext2D} g
 * @param {number} w panel width (px)
 * @param {number} y0 top of the block
 * @param {number} pad side padding
 * @param {{speed:number, rpm:number, gear:number, throttle:number, brake:number}} tel
 * @param {{speed:number, gear:number, throttle:number, brake:number, drs:number}} s rounded snapshot
 * @param {boolean|null} hasDrs session has DRS
 */
export function drawLive(g, w, y0, pad, tel, s, hasDrs) {
  // Shift lights across the top.
  const lit = Math.round(Math.max(0, Math.min(1, (tel.rpm - LED_FROM) / (LED_TO - LED_FROM))) * LED_N);
  const gap = 8;
  const ledW = (w - 2 * pad - gap * (LED_N - 1)) / LED_N;
  for (let i = 0; i < LED_N; i++) {
    const x = pad + i * (ledW + gap);
    const on = i < lit;
    const col = LED_COLOURS[Math.floor(i / 5)];
    if (on) {
      g.fillStyle = rgba(col, 0.3);
      roundRect(g, x - 3, y0 + 9, ledW + 6, 26, 7);
      g.fill();
    }
    g.fillStyle = on ? col : THEME.surface;
    roundRect(g, x, y0 + 12, ledW, 20, 5);
    g.fill();
  }

  // Arc gauge (speed).
  const cx = pad + 196;
  const cy = y0 + 236;
  const r = 158;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(cx, cy, r, ARC_START, ARC_START + ARC_SWEEP);
  g.strokeStyle = THEME.surface;
  g.lineWidth = 26;
  g.stroke();
  const f = Math.max(0, Math.min(1, tel.speed / SPEED_MAX));
  if (f > 0.002) {
    g.beginPath();
    g.arc(cx, cy, r, ARC_START, ARC_START + ARC_SWEEP * f);
    g.strokeStyle = rgba(THEME.orange, 0.2);
    g.lineWidth = 50;
    g.stroke();
    g.strokeStyle = gaugeGradient(g, cx, cy, r);
    g.lineWidth = 26;
    g.stroke();
  }
  g.lineCap = 'butt';
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = THEME.text;
  g.font = dfont(124, 700);
  g.fillText(String(s.speed), cx, cy + 22);
  g.fillStyle = THEME.muted;
  g.font = font(26, 700);
  g.fillText('KM/H', cx, cy + 62);
  g.font = dfont(28, 600);
  g.fillText(`${Math.round(tel.rpm).toLocaleString('en-US')} rpm`, cx, cy + 104);

  // Gear.
  const gx = pad + 500;
  g.fillStyle = THEME.muted;
  g.font = font(24, 700);
  g.fillText('GEAR', gx, y0 + 96);
  // Neon glow without shadowBlur: a wide faint stroke under the fill.
  const gearTxt = tel.gear > 0 ? String(s.gear) : 'N';
  g.font = dfont(190, 700);
  g.strokeStyle = rgba(THEME.select, 0.22);
  g.lineWidth = 18;
  g.lineJoin = 'round';
  g.strokeText(gearTxt, gx, y0 + 270);
  g.fillStyle = THEME.select;
  g.fillText(gearTxt, gx, y0 + 270);

  // DRS light under the gear.
  if (hasDrs === true) {
    const dw = 170;
    const dx = gx - dw / 2;
    const dy = y0 + 312;
    const state = s.drs; // 0 off, 1 eligible, 2 open
    roundRect(g, dx, dy, dw, 60, 12);
    if (state === 2) {
      g.fillStyle = THEME.green;
      g.fill();
      roundRect(g, dx - 2, dy - 2, dw + 4, 64, 14);
      glowStroke(g, THEME.green, 2);
    } else {
      g.fillStyle = THEME.surface;
      g.fill();
      if (state === 1) { g.strokeStyle = THEME.green; g.lineWidth = 3; g.stroke(); }
    }
    g.fillStyle = state === 2 ? '#04140a' : state === 1 ? THEME.green : THEME.muted;
    g.font = dfont(30, 700);
    g.textBaseline = 'middle';
    g.fillText('DRS', gx, dy + 31);
    g.textBaseline = 'alphabetic';
  }

  // Throttle and brake: vertical bars on the right.
  const barW = 64;
  const barTop = y0 + 70;
  const barH = 268;
  bar(g, w - pad - 2 * barW - 28, barTop, barW, barH, tel.throttle / 100, THEME.green, 'THR', `${s.throttle}%`);
  bar(g, w - pad - barW, barTop, barW, barH, s.brake ? 1 : 0, THEME.red, 'BRK', s.brake ? 'ON' : '–');
}

const SEGS = 20;

/** Vertical bar of SEGS ticks lit from the bottom; lit ticks get a soft halo. */
function bar(g, x, y, w, h, frac, colour, label, value) {
  const gap = 4;
  const sh = (h - gap * (SEGS - 1)) / SEGS;
  const lit = Math.round(Math.max(0, Math.min(1, frac)) * SEGS);
  if (lit > 0) {
    const top = y + h - lit * (sh + gap) + gap;
    g.fillStyle = rgba(colour, 0.22);
    roundRect(g, x - 5, top - 5, w + 10, y + h - top + 10, 8);
    g.fill();
  }
  for (let i = 0; i < SEGS; i++) {
    const sy = y + h - (i + 1) * sh - i * gap;
    g.fillStyle = i < lit ? colour : THEME.surface;
    roundRect(g, x, sy, w, sh, 3);
    g.fill();
  }
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = THEME.muted;
  g.font = font(22, 700);
  g.fillText(label, x + w / 2, y + h + 32);
  g.fillStyle = THEME.text;
  g.font = dfont(24, 700);
  g.fillText(value, x + w / 2, y - 14);
}
