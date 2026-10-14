// Desktop top bar (12.3): Exit and help, the session stickers, a slim race control line
// (flag colour + lap + message; click it for the last 5 messages), a compact weather readout
// and a slot on the right for the toggles (dash-extras.js adds Radio / Engine, the dashboard
// Analytics and swap). Replaces the ticker and weather tiles on the desktop; VR keeps its
// panels. update() is cheap: it re-renders only when the newest message or weather sample
// changes, checked at 4 Hz.
import { flagStyle } from '../panels/ticker.js';
import { isNightSession } from '../session-index.js';
import { newWeather, weatherAt, rainLabel, skyLabel, localTime, compass } from '../weather-model.js';

const TICK_MS = 250;
const ROWS = 5;

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function hhmmss(ms) {
  const d = new Date(ms);
  const p = (n) => (n < 10 ? '0' : '') + n;
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

const num = (v, d) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d));

/**
 * @param {object} o
 * @param {object} o.data SessionData
 * @param {HTMLElement} o.parent the topbar tile
 * @param {() => void} o.onExit
 * @param {string} o.help keyboard help (tooltip)
 * @returns {{right: HTMLElement, perf: HTMLElement, update: (time: number) => void, dispose: () => void}}
 */
export function createTopBar({ data, parent, onExit, help }) {
  const bar = el('div', 'f1-top', parent);
  const left = el('div', 'f1-top__left', bar);
  const exit = el('button', 'f1-dash__btn f1-dash__btn--exit', left, 'Exit');
  exit.type = 'button';
  exit.addEventListener('click', onExit);
  const helpEl = el('span', 'f1-dash__help', left, '?');
  helpEl.title = help;
  helpEl.tabIndex = 0;
  const stickers = el('div', 'f1-top__stickers', left);
  const s = data.session || {};
  const tags = [
    [[s.country, s.year].filter(Boolean).join(' ') || s.circuit, '#ffffff', '#0a0b10', -2],
    [s.name, '#e10600', '#ffffff', 2],
  ];
  if (isNightSession(s)) tags.push([data.hasIntervals ? 'Night race' : 'Night', '#ffd23f', '#0a0b10', -2]);
  for (const [text, bg, fg, rot] of tags) {
    if (!text) continue;
    const t = el('span', 'f1-stk', stickers, text);
    t.style.cssText = `--tc:${bg};--tx:${fg};--rot:${rot}deg`;
  }

  // Race control: one line; the button toggles the last-5 list under it.
  const rc = el('button', 'f1-rc', bar);
  rc.type = 'button';
  rc.title = 'Race control: click for the last 5 messages';
  const rcFlag = el('span', 'f1-rc__flag', rc);
  const rcMeta = el('span', 'f1-rc__meta', rc);
  const rcMsg = el('span', 'f1-rc__msg', rc);
  el('span', 'f1-rc__more', rc, '▾');
  const list = el('div', 'f1-rc__list', bar);
  list.hidden = true;
  rc.addEventListener('click', () => {
    list.hidden = !list.hidden;
    rc.classList.toggle('is-open', !list.hidden);
    shownMsg = undefined; // re-render the list now
  });

  // Weather: air / track temperature, wind, rain.
  const wx = el('div', 'f1-wx', bar);
  wx.title = 'Weather at this moment';
  const wxAir = el('span', 'f1-wx__v', wx);
  const wxTrack = el('span', 'f1-wx__v', wx);
  const wxWind = el('span', 'f1-wx__v f1-wx__wind', wx);
  const wxRain = el('span', 'f1-wx__rain', wx);

  const right = el('div', 'f1-top__right', bar);
  const perf = el('span', 'f1-dash__perf', right);
  perf.hidden = !new URLSearchParams(location.search).has('debug');

  let acc = TICK_MS;
  let last = 0;
  let shownMsg;      // newest message drawn (undefined: force)
  let shownWx;       // weather sample drawn

  function renderRc(msgs) {
    const m = msgs[0] || null;
    const st = flagStyle(m);
    rc.style.setProperty('--flag', st.kind === 'neutral' ? '#2a2c35' : st.bg);
    rc.dataset.kind = st.kind;
    rcFlag.textContent = !m ? 'RACE CONTROL' : m.flag ? m.flag.toUpperCase() : m.category === 'SafetyCar' ? 'SAFETY CAR' : m.category === 'Drs' ? 'DRS' : 'INFO';
    rcMeta.textContent = m ? `${m.lap_number != null ? `LAP ${m.lap_number} · ` : ''}${hhmmss(m.date)}` : '';
    rcMsg.textContent = m ? m.message || '' : 'No messages yet';
    if (!list.hidden) {
      list.replaceChildren();
      if (!msgs.length) el('div', 'f1-rc__row', list, 'No messages yet');
      for (const x of msgs) {
        const row = el('div', 'f1-rc__row', list);
        const sw = el('span', 'f1-rc__dot', row);
        const xs = flagStyle(x);
        sw.style.background = xs.kind === 'neutral' ? '#8a8fa0' : xs.bg;
        el('span', 'f1-rc__meta', row, `${x.lap_number != null ? `L${x.lap_number} · ` : ''}${hhmmss(x.date)}`);
        el('span', 'f1-rc__text', row, x.message || '');
      }
    }
  }

  // 13.8: every weather field, through the weather model (rain level and sky are estimates).
  const model = newWeather();
  function renderWx(sample, time) {
    wx.hidden = !sample;
    if (!sample) return;
    const w = weatherAt(data, time, model);
    wxAir.textContent = `AIR ${num(w.airTemp, 1)}°`;
    wxTrack.textContent = `TRACK ${num(w.trackTemp, 1)}°`;
    wxWind.textContent = `WIND ${num(w.windSpeed, 1)} m/s ${compass(w.windDir)}`;
    const rain = w.rainfall > 0;
    wxRain.textContent = rainLabel(w).toUpperCase();
    wxRain.classList.toggle('is-rain', rain || w.trackWet);
    wx.title = [
      `Local time ${localTime(w)} · ${skyLabel(w)} (est.)`,
      `Air ${num(w.airTemp, 1)} °C · track ${num(w.trackTemp, 1)} °C`,
      `Humidity ${num(w.humidity, 0)}% · pressure ${num(w.pressure, 1)} hPa`,
      `Wind ${num(w.windSpeed, 1)} m/s from ${compass(w.windDir)} (${Math.round(w.windDir)}°)`,
      `${rainLabel(w)}${rain ? ' (level est. from the tyres in use)' : ''}`,
    ].join(String.fromCharCode(10));
  }

  return {
    right,
    perf,
    /** @param {number} time playhead (UTC ms) */
    update(time) {
      const now = performance.now();
      acc += now - last;
      last = now;
      if (acc < TICK_MS) return;
      acc = 0;
      const msgs = data.getRaceControlAt(time, ROWS);
      if (msgs[0] !== shownMsg) { shownMsg = msgs[0]; renderRc(msgs); }
      const w = data.getWeatherAt(time);
      if (w !== shownWx) { shownWx = w; renderWx(w, time); }
    },
    dispose() { bar.remove(); },
  };
}
