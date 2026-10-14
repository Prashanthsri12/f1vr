// 2D weather widget (13.9): a small animated card at the bottom left of the desktop track tile,
// shown with the 2D track view (the 3D view has real weather effects, 13.10). It draws the
// weather model: a sky by time of day, the sun or moon, clouds by the cloud estimate drifting
// with the wind, rain streaks by the rain level (est.) slanted by the wind, and a line of text
// (rain label, wind, local time). Animated at up to 30 fps from the dashboard's frame loop while
// weather effects are on; otherwise drawn once per minute. No allocation per frame.
import { newWeather, weatherAt, rainLabel, skyLabel, localTime, compass } from '../weather-model.js';
import { getSettings } from '../settings.js';

const CW = 200, CH = 112;   // CSS px
const DROPS = 70;
const CLOUDS = 5;
const FRAME_S = 1 / 30;

/**
 * @param {{data: object, tile: HTMLElement}} o
 * @returns {{update: (dt: number, time: number, show: boolean) => void, model: object, dispose: () => void}}
 */
export function createWeatherWidget({ data, tile }) {
  const box = document.createElement('div');
  box.className = 'f1-wxw';
  const canvas = document.createElement('canvas');
  const label = document.createElement('div');
  label.className = 'f1-wxw__label';
  box.append(canvas, label);
  tile.appendChild(box);
  const g = canvas.getContext('2d');
  const w = newWeather();
  // Pre-allocated particles (x, y in 0..1 of the card).
  const drops = new Float32Array(DROPS * 2);
  for (let i = 0; i < DROPS; i++) { drops[i * 2] = Math.random(); drops[i * 2 + 1] = Math.random(); }
  const clouds = new Float32Array(CLOUDS * 3); // x, y, size
  for (let i = 0; i < CLOUDS; i++) { clouds[i * 3] = i / CLOUDS + Math.random() * 0.1; clouds[i * 3 + 1] = 0.12 + Math.random() * 0.25; clouds[i * 3 + 2] = 0.7 + Math.random() * 0.5; }
  let dpr = 0;
  let acc = FRAME_S;
  let minute = -1;
  let labelText = '';
  let shown = null;
  // Colours for the current minute's weather (built in style(), not per frame).
  let sky = null, top = '', cloudFill = '';

  function size() {
    const d = window.devicePixelRatio || 1;
    if (d === dpr) return;
    dpr = d;
    canvas.width = Math.round(CW * d);
    canvas.height = Math.round(CH * d);
    canvas.style.width = `${CW}px`;
    canvas.style.height = `${CH}px`;
  }

  function cloud(x, y, s, alpha) {
    g.globalAlpha = alpha;
    g.beginPath();
    g.arc(x - 14 * s, y + 2 * s, 10 * s, 0, Math.PI * 2);
    g.arc(x, y - 4 * s, 14 * s, 0, Math.PI * 2);
    g.arc(x + 15 * s, y + 2 * s, 10 * s, 0, Math.PI * 2);
    g.rect(x - 24 * s, y + 2 * s, 48 * s, 10 * s);
    g.fill();
  }

  /** Sky gradient and cloud colour for the current weather (once a minute). */
  function style() {
    const day = w.daylight;
    const grey = w.cloud * 0.6;
    top = `rgb(${Math.round(8 + 50 * day + 60 * grey * day)},${Math.round(12 + 90 * day + 40 * grey * day)},${Math.round(30 + 150 * day - 40 * grey * day)})`;
    const bot = `rgb(${Math.round(16 + 120 * day)},${Math.round(20 + 120 * day)},${Math.round(40 + 120 * day)})`;
    sky = g.createLinearGradient(0, 0, 0, CH);
    sky.addColorStop(0, top);
    sky.addColorStop(1, bot);
    const shade = Math.round(w.rainfall ? 120 : 200 - 80 * grey);
    cloudFill = `rgb(${shade},${shade + 6},${shade + 16})`;
  }

  function draw(dt) {
    const W = CW, H = CH;
    const day = w.daylight;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Sky: night navy to day blue, greyed by cloud.
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    // Sun or moon, by the rough sun height (left in the morning, right in the evening).
    const az = Math.min(1, Math.max(0, (w.sunAzimuth - 90) / 180));
    if (day > 0.15) {
      const sx = 20 + az * (W - 40);
      const sy = H * 0.85 - Math.max(0, w.sunElevation) / 62 * H * 0.6;
      g.globalAlpha = Math.max(0.15, 1 - w.cloud * 0.8);
      g.fillStyle = '#ffd25a';
      g.beginPath(); g.arc(sx, sy, 10, 0, Math.PI * 2); g.fill();
      g.globalAlpha *= 0.3;
      g.beginPath(); g.arc(sx, sy, 18, 0, Math.PI * 2); g.fill();
    } else {
      g.globalAlpha = Math.max(0.2, 1 - w.cloud * 0.7);
      g.fillStyle = '#e6ecf5';
      g.beginPath(); g.arc(W - 36, 24, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = top;
      g.beginPath(); g.arc(W - 31, 21, 8, 0, Math.PI * 2); g.fill();
    }
    // Clouds drift with the wind (east / west part of where it blows to).
    const toRad = ((w.windDir + 180) % 360) * Math.PI / 180;
    const drift = Math.sin(toRad) * (0.004 + w.windSpeed * 0.006);
    const n = Math.round(w.cloud * CLOUDS);
    g.fillStyle = cloudFill;
    for (let i = 0; i < CLOUDS; i++) {
      let x = clouds[i * 3] + drift * dt;
      if (x > 1.2) x -= 1.4; else if (x < -0.2) x += 1.4;
      clouds[i * 3] = x;
      if (i < n) cloud(x * W, clouds[i * 3 + 1] * H, clouds[i * 3 + 2], 0.85);
    }
    // Rain streaks, count and speed by the level, slanted by the wind.
    if (w.rainfall) {
      const count = Math.round(DROPS * (0.3 + 0.7 * w.rainLevel));
      const slant = Math.sin(toRad) * Math.min(1, w.windSpeed / 6) * 0.35;
      g.globalAlpha = 0.75;
      g.strokeStyle = '#8fd0ff';
      g.lineWidth = 1.3;
      g.beginPath();
      for (let i = 0; i < count; i++) {
        let y = drops[i * 2 + 1] + dt * (1.4 + w.rainLevel);
        let x = drops[i * 2] + dt * slant;
        if (y > 1) { y -= 1; x = Math.random(); }
        if (x > 1) x -= 1; else if (x < 0) x += 1;
        drops[i * 2] = x; drops[i * 2 + 1] = y;
        g.moveTo(x * W, y * H);
        g.lineTo(x * W + slant * 12, y * H + 8);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    // Wind arrow, bottom right (points where it blows to, north up).
    g.save();
    g.translate(W - 16, H - 16);
    g.rotate(toRad);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 3); g.lineTo(1.6, 1); g.lineTo(1.6, 8); g.lineTo(-1.6, 8); g.lineTo(-1.6, 1); g.lineTo(-6, 3); g.closePath(); g.fill();
    g.restore();
  }

  size();
  return {
    model: w,
    update(dt, time, show) {
      const on = show && w !== null;
      if (shown !== on) { shown = on; box.hidden = !on; }
      if (!on) return;
      const m = Math.floor(time / 60000);
      if (m !== minute) {
        minute = m;
        weatherAt(data, time, w);
        box.hidden = !w.ok;
        const t = w.ok ? `${rainLabel(w)} · ${skyLabel(w)} est. · ${w.windSpeed.toFixed(1)} m/s ${compass(w.windDir)} · ${localTime(w)}` : '';
        if (t !== labelText) {
          labelText = t;
          label.textContent = t;
          box.title = w.ok ? `Weather at the track (sky and rain level are estimates)\nAir ${w.airTemp?.toFixed(1)} °C · track ${w.trackTemp?.toFixed(1)} °C · humidity ${w.humidity?.toFixed(0)}% · ${w.pressure?.toFixed(0)} hPa` : '';
        }
        size();
        style();
        draw(0);
      }
      if (!w.ok || !getSettings().weatherFx) return;
      acc += dt;
      if (acc < FRAME_S) return;
      draw(Math.min(acc, 0.1));
      acc = 0;
    },
    dispose() { box.remove(); },
  };
}
