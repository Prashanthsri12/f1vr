// Weather panel (spec §5): air and track temperature (big), humidity, wind speed with a
// direction arrow, and a rain chip. Uses the latest sample at or before the playhead.
import { Panel, THEME, font, dfont, rgba, roundRect } from './panel-base.js';
import { LAYOUT } from './layout.js';

const PAD = 22;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function fmtNum(v, digits) {
  return v == null || !Number.isFinite(v) ? '–' : v.toFixed(digits);
}

export class WeatherPanel extends Panel {
  constructor(data) {
    super({ name: 'weather', width: LAYOUT.weather.width, height: LAYOUT.weather.height, maxHz: 2 });
    this.data = data;
    this.sample = undefined;
  }

  refresh(ctx) {
    // getWeatherAt returns the stored record object, so identity tells us if it changed.
    const s = this.data.getWeatherAt(ctx.time);
    if (s === this.sample) return false;
    this.sample = s;
    return true;
  }

  draw(g, w, h) {
    this.clear(g, w, h);
    const s = this.sample;
    g.textBaseline = 'alphabetic';

    // Header: accent bar, title, rain chip.
    g.fillStyle = THEME.accent;
    g.fillRect(0, 16, 7, 36);
    g.textAlign = 'left';
    g.fillStyle = THEME.muted;
    g.font = font(24, 700);
    g.fillText('WEATHER', PAD, 44);
    const rain = !!(s && s.rainfall > 0);
    const chipW = rain ? 96 : 84;
    const cx = w - PAD - chipW;
    g.fillStyle = rain ? THEME.blue : THEME.surface;
    roundRect(g, cx, 14, chipW, 40, 20);
    g.fill();
    g.textAlign = 'center';
    g.fillStyle = rain ? '#ffffff' : THEME.muted;
    g.font = font(24, 700);
    g.fillText(s ? (rain ? 'RAIN' : 'DRY') : '–', cx + chipW / 2, 43);
    if (s) drawIcon(g, cx - 40, 34, rain);

    // No weather records at all (6.11), or none yet before the first sample.
    if (!s) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = THEME.muted;
      g.font = font(28, 600);
      const none = this.data.empty && this.data.empty.has('weather');
      g.fillText(none ? 'No weather data' : 'Waiting for weather…', w / 2, (68 + h) / 2);
      return;
    }

    // Temperatures: two big columns.
    const colW = (w - 2 * PAD - 14) / 2;
    const temps = [['AIR', s?.air_temperature], ['TRACK', s?.track_temperature]];
    for (let i = 0; i < 2; i++) {
      const x = PAD + i * (colW + 14);
      g.fillStyle = THEME.surface;
      roundRect(g, x, 68, colW, 120, 10);
      g.fill();
      g.textAlign = 'left';
      g.fillStyle = THEME.muted;
      g.font = font(24, 600);
      g.fillText(temps[i][0], x + 14, 98);
      g.textAlign = 'right';
      g.font = font(26, 600);
      g.fillStyle = THEME.muted;
      g.fillText('°C', x + colW - 12, 168);
      const unitW = g.measureText('°C').width + 4;
      g.fillStyle = temps[i][1] == null ? THEME.muted : THEME.text;
      g.font = dfont(54, 700);
      g.fillText(fmtNum(temps[i][1], 1), x + colW - 12 - unitW, 170);
    }

    // Bottom row: humidity (left), wind arrow + speed (right).
    const y = 268;
    g.textAlign = 'left';
    g.fillStyle = THEME.muted;
    g.font = font(24, 600);
    g.fillText('HUM', PAD, y);
    const humW = g.measureText('HUM').width + 10;
    g.font = dfont(30, 700);
    g.fillStyle = THEME.text;
    g.fillText(`${fmtNum(s?.humidity, 0)}%`, PAD + humW, y + 1);

    const dir = s?.wind_direction;
    const ax = w / 2 + 34;
    const ay = y - 10;
    g.strokeStyle = THEME.line;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(ax, ay, 24, 0, Math.PI * 2);
    g.stroke();
    if (dir != null && Number.isFinite(dir)) {
      // wind_direction is meteorological: degrees clockwise from north that the wind
      // blows FROM. The arrow shows where it blows TO (dir + 180°), north up.
      g.save();
      g.translate(ax, ay);
      g.rotate(((dir + 180) % 360) * Math.PI / 180);
      g.fillStyle = THEME.text;
      g.beginPath();
      g.moveTo(0, -21);
      g.lineTo(11, 3);
      g.lineTo(3.5, 1);
      g.lineTo(3.5, 18);
      g.lineTo(-3.5, 18);
      g.lineTo(-3.5, 1);
      g.lineTo(-11, 3);
      g.closePath();
      g.fill();
      g.restore();
    }
    g.textAlign = 'right';
    g.fillStyle = THEME.text;
    g.font = dfont(30, 700);
    const speedTxt = fmtNum(s?.wind_speed, 1);
    g.fillText(speedTxt, w - PAD - 46, y + 1);
    g.fillStyle = THEME.muted;
    g.font = font(24, 600);
    g.fillText('m/s', w - PAD, y);
    if (dir != null && Number.isFinite(dir)) {
      g.textAlign = 'right';
      g.fillText(`FROM ${COMPASS[Math.round(dir / 45) % 8]}`, w - PAD, y - 40);
    }
  }
}

/**
 * Small drawn icon centred at (x, y): a glowing sun when dry, a cloud with rain when
 * rainfall is set. OpenF1 weather has no cloud cover, so "dry" never shows clouds.
 */
function drawIcon(g, x, y, rain) {
  if (!rain) {
    g.fillStyle = 'rgba(255,190,40,0.25)';
    g.beginPath();
    g.arc(x, y, 19, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffc93a';
    g.beginPath();
    g.arc(x, y, 11, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#ffc93a';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      g.moveTo(x + Math.cos(a) * 15, y + Math.sin(a) * 15);
      g.lineTo(x + Math.cos(a) * 20, y + Math.sin(a) * 20);
    }
    g.stroke();
    g.lineCap = 'butt';
    return;
  }
  g.strokeStyle = rgba(THEME.blue, 1);
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    g.moveTo(x - 9 + i * 9, y + 6);
    g.lineTo(x - 13 + i * 9, y + 16);
  }
  g.stroke();
  g.lineCap = 'butt';
  g.fillStyle = '#cfd8e6';
  g.beginPath();
  g.arc(x - 8, y - 2, 8, 0, Math.PI * 2);
  g.arc(x + 2, y - 7, 10, 0, Math.PI * 2);
  g.arc(x + 11, y - 1, 7, 0, Math.PI * 2);
  g.fill();
  roundRect(g, x - 16, y - 3, 34, 9, 4);
  g.fill();
}
