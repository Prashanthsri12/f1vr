// Scene bootstrap: wires world, table, track, cars, playback, desktop input and the HTML HUD.
import { createWorld } from './scene/world.js';
import { createTable, loadTrack } from './scene/track.js';
import { Cars } from './scene/cars.js';
import { Playback } from './playback.js';
import { createDesktopInput } from './input/desktop-input.js';
import { createPitWall } from './panels/pit-wall.js';
import { panelStats } from './panels/panel-base.js';

const HUD_INTERVAL = 0.1; // seconds (10 Hz)
const STYLE_ID = 'f1vr-hud-style';

const CSS = `
.f1vr-overlay{position:absolute;inset:0;pointer-events:none;font-family:'Titillium Web',system-ui,sans-serif;color:#e8ecf2;z-index:10}
.f1vr-hud{position:absolute;top:12px;left:12px;min-width:220px;padding:10px 14px;background:rgba(10,12,16,.72);border-left:3px solid #e10600;border-radius:4px;font-size:14px;line-height:1.45;white-space:pre;font-variant-numeric:tabular-nums}
.f1vr-hud .t{font-weight:700;font-size:15px;letter-spacing:.02em}
.f1vr-hud .drv{font-weight:700}
.f1vr-hud .perf{opacity:.6;font-size:12px}
.f1vr-loading{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);padding:12px 22px;background:rgba(10,12,16,.8);border:1px solid rgba(225,6,0,.6);border-radius:4px;font-size:18px;display:none}
.f1vr-help{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);padding:5px 12px;background:rgba(10,12,16,.6);border-radius:4px;font-size:12px;opacity:.85;white-space:nowrap}
.f1vr-exit{position:absolute;top:12px;right:12px;pointer-events:auto;font:inherit;font-weight:700;font-size:14px;color:#fff;background:rgba(10,12,16,.75);border:1px solid #e10600;border-radius:4px;padding:6px 14px;cursor:pointer}
.f1vr-exit:hover{background:#e10600}
@media (max-width:600px){.f1vr-help{display:none}}
`;

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function fmtUtc(t) {
  const d = new Date(t);
  return pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds());
}

function fmtElapsed(ms) {
  const neg = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return (neg ? '-' : '+') + (h > 0 ? h + ':' + pad2(m) : '' + m) + ':' + pad2(s);
}

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/**
 * Start the 3D app inside `container`.
 * @param {object} opts
 * @param {import('./session-data.js').SessionData} opts.data loaded session
 * @param {HTMLElement} opts.container
 * @param {() => void} [opts.onExit] called after dispose when the user presses Exit
 * @param {(s: string|object) => void} [opts.onStatus] setup step strings ('Building track…'),
 *   then forwarded data.onStatus objects ({loading, pending, error?})
 * @returns {Promise<{playback: Playback, world: object, dispose: () => void}>}
 */
export async function startApp({ data, container, onExit, onStatus }) {
  const status = (m) => { if (onStatus) { try { onStatus(m); } catch (_) { /* ignore */ } } };
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

  const world = createWorld(container);
  const table = createTable(world.scene);

  // Cleanup state, filled as we go so a failure mid-setup still disposes.
  let cars = null;
  let input = null;
  let pitWall = null;
  const unsubs = [];
  let overlay = null;
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const u of unsubs) { try { u(); } catch (_) { /* ignore */ } }
    if (input) input.dispose();
    if (pitWall) pitWall.dispose();
    if (cars) cars.dispose();
    world.dispose();
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  let playback;
  let hudDirty = true;
  try {
    status('Building track…');
    const transform = await loadTrack(data, table);
    status('Placing cars…');
    cars = new Cars(data.drivers, transform, table);
    playback = new Playback(data);
    status('Building panels…');
    pitWall = createPitWall({
      parent: world.scene,
      data,
      playback,
      actions: {
        selectDriver: (n) => selectDriver(n),
        togglePlay: () => playback.toggle(),
        seekBy: (sec) => playback.seekBy(sec),
        seekToLap: (n) => playback.seekToLap(n),
        speedUp: () => playback.speedUp(),
        speedDown: () => playback.speedDown(),
        setSpeed: (sp) => playback.setSpeed(sp),
      },
    });
  } catch (err) {
    dispose();
    throw err;
  }

  // --- selection ---
  let selected = null;
  function selectDriver(n) {
    if (n == null) return;
    selected = n;
    data.setSelectedDriver(n);
    cars.setSelected(n);
    pitWall.setSelected(n);
    hudDirty = true;
  }
  function getDriverOrder() {
    const lb = data.getLeaderboardAt(playback.time);
    if (lb && lb.length) return lb.map((r) => r.driverNumber);
    return data.drivers.map((d) => d.number);
  }
  const lb0 = data.getLeaderboardAt(playback.time);
  selectDriver((lb0 && lb0[0] && lb0[0].driverNumber) ?? (data.drivers[0] && data.drivers[0].number));

  // --- passthrough look ---
  let mode = 'pitwall';
  function togglePassthrough() {
    mode = mode === 'pitwall' ? 'passthrough' : 'pitwall';
    world.setMode(mode);
    pitWall.setMode(mode);
    hudDirty = true;
  }

  input = createDesktopInput({
    renderer: world.renderer,
    camera: world.camera,
    table,
    playback,
    getDriverOrder,
    onSelectDriver: selectDriver,
    onTogglePassthrough: togglePassthrough,
    getSelectedDriver: () => selected,
    pickPanels: (raycaster) => pitWall.manager.raycast(raycaster),
    onPanelHover: (r) => pitWall.manager.setHover(r),
    onPanelSelect: (r) => pitWall.manager.select(r, pitWall.ctx),
  });
  // Desktop only: step back from the user's standing spot so the whole pit wall is in view
  // (in XR the headset pose drives the camera; the user never moves).
  world.camera.position.set(0, 1.75, 1.0);

  // --- overlay ---
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  overlay = el('div', 'f1vr-overlay', container);
  const hud = el('div', 'f1vr-hud', overlay);
  const hudTitle = el('div', 't', hud, data.session ? data.session.name || '' : '');
  const hudClock = el('div', '', hud);
  const hudLap = el('div', '', hud);
  const hudPlay = el('div', '', hud);
  const hudDrv = el('div', 'drv', hud);
  const hudErr = el('div', '', hud);
  hudErr.style.color = '#ff6b62';
  const hudPerf = el('div', 'perf', hud);
  const loading = el('div', 'f1vr-loading', overlay, 'Loading data…');
  el('div', 'f1vr-help', overlay,
    'Click panels · Space play/pause · ←/→ seek 10 s · ↑/↓ speed · [ ] driver · P passthrough · drag table rotate · wheel on table scale · right-drag orbit');
  const exitBtn = el('button', 'f1vr-exit', overlay, 'Exit');
  exitBtn.type = 'button';
  exitBtn.addEventListener('click', () => {
    dispose();
    if (onExit) onExit();
  });
  if (data.session) {
    const s = data.session;
    hudTitle.textContent = [s.year, s.country || s.circuit, s.name].filter(Boolean).join(' · ');
  }

  let lastError = '';
  if (typeof data.onStatus === 'function') {
    const off = data.onStatus((st) => {
      lastError = st && st.error ? 'Data error: ' + (st.error.message || st.error) : '';
      hudDirty = true;
      if (onStatus) { try { onStatus(st); } catch (_) { /* ignore */ } }
    });
    if (typeof off === 'function') unsubs.push(off);
  }
  unsubs.push(playback.onChange(() => { hudDirty = true; }));

  // HUD cache: only touch the DOM when text changes.
  const prev = { clock: '', lap: '', play: '', drv: '', err: '', perf: '', color: '', loading: false };
  function setText(node, key, text) {
    if (prev[key] !== text) { prev[key] = text; node.textContent = text; }
  }

  let hudAcc = HUD_INTERVAL;
  let fpsFrames = 0;
  let fpsAcc = 0;
  let fps = 0;
  let redrawRate = 0;
  let redrawBase = 0;
  const info = world.renderer.info.render;

  function updateHud() {
    const t = playback.time;
    setText(hudClock, 'clock', fmtUtc(t) + ' UTC   ' + fmtElapsed(t - data.raceStartTime));
    const lap = data.getLeaderLapAt(t) || 0;
    setText(hudLap, 'lap', lap > 0 ? 'Lap ' + lap + ' / ' + data.totalLaps : 'Lap – / ' + data.totalLaps);
    const state = playback.waiting ? 'Buffering' : playback.playing ? 'Playing' : 'Paused';
    setText(hudPlay, 'play', playback.speed + 'x   ' + state + (mode === 'passthrough' ? '   [passthrough]' : ''));
    const d = selected != null ? data.driverByNumber.get(selected) : null;
    if (d) {
      const pos = data.getPositionAt(selected, t);
      setText(hudDrv, 'drv', (pos ? 'P' + pos + ' ' : '') + d.acronym + ' ' + d.number + '  ' + (d.teamName || ''));
      if (prev.color !== d.teamColour) { prev.color = d.teamColour; hudDrv.style.color = d.teamColour || '#fff'; }
    } else {
      setText(hudDrv, 'drv', '');
    }
    setText(hudErr, 'err', lastError);
    setText(hudPerf, 'perf', fps + ' fps   ' + info.calls + ' calls   ' + Math.round(info.triangles / 1000) + 'k tris   ' + redrawRate + ' redraws/s');
    if (prev.loading !== playback.waiting) {
      prev.loading = playback.waiting;
      loading.style.display = playback.waiting ? 'block' : 'none';
    }
  }

  // --- frame loop (allocation-free apart from the 10 Hz HUD strings) ---
  unsubs.push(world.onFrame((dt) => {
    playback.update(dt);
    cars.update(data, playback.time, world.camera);
    pitWall.update(dt);
    input.update(dt);

    fpsFrames++;
    fpsAcc += dt;
    if (fpsAcc >= 0.5) {
      fps = Math.round(fpsFrames / fpsAcc);
      redrawRate = Math.round((panelStats.redraws - redrawBase) / fpsAcc);
      redrawBase = panelStats.redraws;
      fpsFrames = 0; fpsAcc = 0;
    }

    hudAcc += dt;
    if (hudAcc >= HUD_INTERVAL || (hudDirty && hudAcc >= 0.02)) {
      hudAcc = 0;
      hudDirty = false;
      updateHud();
    }
  }));

  status('Ready');
  return { playback, world, dispose };
}
