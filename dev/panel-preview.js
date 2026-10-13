// Dev tool: draw panels to visible canvases with a real SessionData and a fake playback.
// window.__previewDone becomes true when every panel has drawn (used by headless screenshots).
import { SessionData } from '../js/session-data.js';
import { SPEEDS } from '../js/playback.js';
import { whenFontsReady } from '../js/panels/panel-base.js';

const MODULES = {
  leaderboard: ['../js/panels/leaderboard.js', 'LeaderboardPanel'],
  telemetry: ['../js/panels/telemetry.js', 'TelemetryPanel'],
  laps: ['../js/panels/laps.js', 'LapsPanel'],
  weather: ['../js/panels/weather.js', 'WeatherPanel'],
  insights: ['../js/panels/insights.js', 'InsightsPanel'],
  analytics: ['../js/panels/analytics-panel.js', 'AnalyticsPanel'],
  ticker: ['../js/panels/ticker.js', 'TickerPanel'],
  picker: ['../js/panels/driver-picker.js', 'DriverPicker'],
  playback: ['../js/panels/playback-bar.js', 'PlaybackBarPanel'],
  wrist: ['../js/panels/wrist-menu.js', 'WristMenu'],
};

const q = new URLSearchParams(location.search);
const names = (q.get('panels') || Object.keys(MODULES).join(',')).split(',');
const sessionKey = Number(q.get('session') || 9472);
const scale = Number(q.get('scale') || 0.5);
const statusEl = document.getElementById('status');
const out = document.getElementById('out');
const log = (m) => { statusEl.textContent = m; console.log('[preview]', m); };

const data = await SessionData.load(sessionKey, { onProgress: (p) => log(`Loading ${p.step}…`) });
const time = q.get('t') ? Date.parse(q.get('t')) : data.raceStartTime + 20 * 60000;
const selected = Number(q.get('driver') || data.getLeaderboardAt(time)[0]?.driverNumber || data.drivers[0].number);
const playback = { time, speed: 1, playing: false, waiting: false, SPEEDS };
const ctx = {
  data, playback, time, selected,
  mode: q.get('passthrough') ? 'passthrough' : 'pitwall',
  canPassthrough: true,
  actions: new Proxy({}, { get: (_, k) => (...a) => console.log('[preview] action', String(k), ...a) }),
};

data.setSelectedDriver(selected);
data.setPlayhead(time, 1);
log('Waiting for chunks…');
for (let i = 0; i < 120 && !data.isReady(time); i++) await new Promise((r) => setTimeout(r, 250));
const tel = {};
for (let i = 0; i < 120 && !data.getTelemetryAt(selected, time, tel); i++) await new Promise((r) => setTimeout(r, 250));
await whenFontsReady();

const panels = [];
for (const name of names) {
  const [path, exp] = MODULES[name] || [];
  if (!path) { log(`unknown panel ${name}`); continue; }
  try {
    const Cls = (await import(path))[exp];
    const obj = new Cls(data);
    if (q.get('tab') && 'tab' in obj) obj.tab = q.get('tab'); // insights: battle | h2h | driver
    if (q.get('kind') && obj.setKind) obj.setKind(q.get('kind')); // analytics chart
    if (q.get('fuel') && 'fuel' in obj) obj.fuel = true;
    const list = [];
    if (typeof obj.addTo === 'function') obj.addTo({ group: { add() {} }, add: (p) => { list.push(p); return p; } });
    else list.push(obj);
    for (const p of list) {
      if (ctx.mode === 'passthrough') p.setPassthrough(true);
      p.mesh.visible = true; // some panels (wrist menu) start hidden in the scene
      const wrap = document.createElement('div');
      wrap.className = 'p';
      wrap.title = `${name} ${p.width}×${p.height} m`;
      p.canvas.style.width = `${p.canvas.width * scale}px`;
      wrap.appendChild(p.canvas);
      out.appendChild(wrap);
      panels.push(p);
    }
  } catch (err) {
    log(`${name}: ${err.stack || err}`);
    console.error(err);
  }
}

// Tick a few times (≥0.1 s apart in panel time) so refresh/draw and any async fetches settle.
for (let i = 0; i < Number(q.get('ticks') || 30); i++) {
  for (const p of panels) p.tick(1, ctx);
  await new Promise((r) => setTimeout(r, 100));
}
log(`t=${new Date(time).toISOString()} driver=${selected} panels=${panels.length}`);
window.__previewDone = true;
