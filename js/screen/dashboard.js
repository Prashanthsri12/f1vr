// Screen mode on desktop (Phase 8): a flat, full-window dashboard instead of the 3D room.
// Tiles are placed by screen-layout.js (landscape, portrait or a scrolling stack, re-laid
// out live on resize); panels are shown as page canvases (panel-host.js), the track has its
// own WebGL view (track-view.js) and the main screen has Video / Radio tabs (main-tile.js).
// ⤢ swaps the track and main screen tiles ("Video focus").
import { Playback } from '../playback.js';
import { LeaderboardPanel } from '../panels/leaderboard.js';
import { TelemetryPanel } from '../panels/telemetry.js';
import { LapsPanel } from '../panels/laps.js';
import { WeatherPanel } from '../panels/weather.js';
import { TickerPanel } from '../panels/ticker.js';
import { PlaybackBarPanel } from '../panels/playback-bar.js';
import { InsightsPanel } from '../panels/insights.js';
import { panelStats } from '../panels/panel-base.js';
import { createAudioEvents } from '../audio-events.js';
import { createSyncControl } from '../sync-control.js';
import { stopRadio, sfxStats } from '../audio.js';
import { getSettings, setSetting } from '../settings.js';
import { computeScreenLayout, TILE_NAMES } from './screen-layout.js';
import { PanelHost } from './panel-host.js';
import { createTrackView } from './track-view.js';
import { createMainTile } from './main-tile.js';
import { createDashExtras } from './dash-extras.js';

const KEYS_HELP = 'Space play/pause · ←/→ seek 10 s · ↑/↓ speed · [ ] driver · V 2D/3D · F swap track and screen · Esc exit'
  + '\nC track colours (sectors / mini-sectors / plain) · E engine hum'
  + '\nSync: L lights out · PgUp/PgDn previous/next lap · , / . nudge −1/+1 s · Shift+, / Shift+. nudge −5/+5 s'
  + '\nTrack: drag pans (2D) or rotates (3D), right-drag pans, wheel zooms, double-click resets';

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/**
 * Start Screen mode in `container`.
 * @param {object} o
 * @param {import('../session-data.js').SessionData} o.data
 * @param {HTMLElement} o.container
 * @param {() => void} [o.onExit] called after dispose when the user presses Exit
 * @param {(s: string) => void} [o.onStatus] setup steps ('Building track…')
 * @returns {Promise<{playback: Playback, dispose: () => void}>}
 */
export async function startDashboard({ data, container, onExit, onStatus }) {
  const status = (m) => { if (onStatus) { try { onStatus(m); } catch (_) { /* ignore */ } } };
  const root = el('div', 'f1-dash');
  const content = el('div', 'f1-dash__content', root);
  const tiles = {};
  for (const name of TILE_NAMES) {
    tiles[name] = el('div', `f1-dash__tile f1-dash__tile--${name}`, content);
    tiles[name].dataset.tile = name;
  }

  const playback = new Playback(data);
  const sync = createSyncControl({ data, playback }); // 8.9 lights out, lap steps, nudge
  let selected = null;
  let trackView = null;
  let mainTile = null;
  let audioEvents = null;
  let extras = null;
  let disposed = false;
  let raf = 0;
  const unsubs = [];

  const ctx = {
    data, playback, time: playback.time, selected: null, mode: 'pitwall', canPassthrough: false,
    actions: {
      selectDriver: (n) => selectDriver(n),
      togglePlay: () => playback.toggle(),
      seekBy: (sec) => playback.seekBy(sec),
      seekToLap: (n) => playback.seekToLap(n),
      seekTo: (t) => playback.seek(t),
      speedUp: () => playback.speedUp(),
      speedDown: () => playback.speedDown(),
      setSpeed: (sp) => playback.setSpeed(sp),
      togglePassthrough: () => {},
      goLightsOut: () => sync.lightsOut(),
      stepLap: (dir) => sync.stepLap(dir),
      nudge: (sec) => sync.nudge(sec),
      getSync: () => sync,
      exit: () => exit(),
    },
  };
  const host = new PanelHost(ctx);

  // --- selection (the track view exists once setup has run; panels only call these later) ---
  function selectDriver(n) {
    if (n == null) return;
    selected = n;
    ctx.selected = n;
    data.setSelectedDriver(n);
    if (trackView) trackView.cars.setSelected(n);
  }
  function stepDriver(dir) {
    const lb = data.getLeaderboardAt(playback.time);
    const order = lb && lb.length ? lb.map((r) => r.driverNumber) : data.drivers.map((d) => d.number);
    if (!order.length) return;
    let i = order.indexOf(selected);
    if (i < 0) i = dir > 0 ? -1 : 0;
    selectDriver(order[(i + dir + order.length) % order.length]);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    for (const u of unsubs) { try { u(); } catch (_) { /* ignore */ } }
    if (audioEvents) audioEvents.dispose();
    if (extras) extras.dispose();
    stopRadio();
    if (mainTile) mainTile.dispose();
    if (trackView) trackView.dispose();
    host.dispose();
    root.remove();
  }
  function exit() {
    dispose();
    if (onExit) onExit();
  }

  try {
    container.appendChild(root);
    status('Building panels…');
    host.add(new LeaderboardPanel(data), tiles.leaderboard);
    host.add(new TelemetryPanel(data), tiles.telemetry);
    host.add(new LapsPanel(data), tiles.laps);
    host.add(new WeatherPanel(data), tiles.weather);
    host.add(new InsightsPanel(data), tiles.insights);
    const ticker = host.add(new TickerPanel(data), tiles.ticker, { anchor: 'top' });
    host.add(new PlaybackBarPanel(data), tiles.playbackBar);
    unsubs.push(() => { tiles.ticker.classList.remove('is-open'); });

    status('Building track…');
    trackView = await createTrackView({ data, tile: tiles.track, view: getSettings().trackView });
    mainTile = createMainTile({ tile: tiles.main, data, playback, host, onToggleFocus: () => toggleFocus() });

    // Track tile toolbar: Exit, help, 2D / 3D, swap.
    const tools = el('div', 'f1-dash__tools', tiles.track);
    const exitBtn = el('button', 'f1-dash__btn f1-dash__btn--exit', tools, 'Exit');
    exitBtn.type = 'button';
    exitBtn.addEventListener('click', exit);
    const help = el('span', 'f1-dash__help', tools, '?');
    help.title = KEYS_HELP;
    el('span', 'f1-dash__spacer', tools);
    const perf = el('span', 'f1-dash__perf', tools);
    perf.hidden = !new URLSearchParams(location.search).has('debug');
    const viewBtns = {};
    for (const v of ['2d', '3d']) {
      const b = el('button', 'f1-dash__btn', tools, v.toUpperCase());
      b.type = 'button';
      b.addEventListener('click', () => setView(v));
      viewBtns[v] = b;
    }
    const swapBtn = el('button', 'f1-dash__btn f1-dash__btn--icon', tools, '⤢');
    swapBtn.type = 'button';
    swapBtn.addEventListener('click', () => toggleFocus());

    function setView(v) {
      trackView.setView(v);
      setSetting('trackView', trackView.getView());
      for (const [id, b] of Object.entries(viewBtns)) b.classList.toggle('is-active', id === trackView.getView());
    }
    setView(trackView.getView());
    extras = createDashExtras({ data, playback, root, trackTile: tiles.track, tools, el });

    // --- layout ---
    let focus = 'track';
    function layout() {
      const l = computeScreenLayout(root.clientWidth, root.clientHeight, { focus });
      content.style.height = `${l.height}px`;
      root.dataset.orientation = l.orientation;
      for (const name of TILE_NAMES) {
        const r = l.tiles[name];
        const st = tiles[name].style;
        st.left = `${r.x}px`; st.top = `${r.y}px`; st.width = `${r.w}px`; st.height = `${r.h}px`;
      }
      host.layout(window.devicePixelRatio || 1);
      trackView.resize();
    }
    function toggleFocus() {
      focus = focus === 'track' ? 'main' : 'track';
      mainTile.setFocused(focus === 'main');
      swapBtn.textContent = focus === 'main' ? '⤢' : '⤡';
      swapBtn.title = focus === 'main' ? 'Make the track big again' : 'Make the main screen big';
      layout();
    }
    swapBtn.textContent = '⤡';
    swapBtn.title = 'Make the main screen big';
    mainTile.setFocused(false);
    const ro = new ResizeObserver(() => layout());
    ro.observe(root);
    ro.observe(content); // its width changes when the scrollbar comes or goes
    window.addEventListener('resize', layout); // devicePixelRatio changes (moving between monitors)
    unsubs.push(() => { ro.disconnect(); window.removeEventListener('resize', layout); });
    layout();

    const lb0 = data.getLeaderboardAt(playback.time);
    selectDriver((lb0 && lb0[0] && lb0[0].driverNumber) ?? (data.drivers[0] && data.drivers[0].number));
    audioEvents = createAudioEvents(data); // team radio autoplay + sound effects

    // --- keyboard (Esc is handled by the start page) ---
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      switch (e.code) {
        case 'Space': e.preventDefault(); if (!e.repeat) playback.toggle(); return;
        case 'ArrowLeft': e.preventDefault(); playback.seekBy(-10); return;
        case 'ArrowRight': e.preventDefault(); playback.seekBy(10); return;
        case 'ArrowUp': e.preventDefault(); playback.speedUp(); return;
        case 'ArrowDown': e.preventDefault(); playback.speedDown(); return;
        case 'BracketLeft': stepDriver(-1); return;
        case 'BracketRight': stepDriver(1); return;
        case 'KeyV': if (!e.repeat) setView(trackView.getView() === '2d' ? '3d' : '2d'); return;
        case 'KeyF': if (!e.repeat) toggleFocus(); return;
        case 'KeyL': if (!e.repeat) sync.lightsOut(); return;
        case 'PageUp': e.preventDefault(); sync.stepLap(-1); return;
        case 'PageDown': e.preventDefault(); sync.stepLap(1); return;
        case 'Comma': sync.nudge(e.shiftKey ? -5 : -1); return;
        case 'Period': sync.nudge(e.shiftKey ? 5 : 1); return;
        default: if (!e.repeat) extras.onKey(e.code);
      }
    };
    window.addEventListener('keydown', onKey);
    unsubs.push(() => window.removeEventListener('keydown', onKey));

    // --- frame loop (allocation-free apart from ≤10 Hz panel redraws and the debug line) ---
    let last = -1;
    let tickerOpen = false;
    let fpsFrames = 0;
    let fpsAcc = 0;
    let redrawBase = panelStats.redraws;
    const info = trackView.renderer.info.render;
    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      let dt = last < 0 ? 0 : (now - last) / 1000;
      last = now;
      if (dt > 0.1) dt = 0.1;
      playback.update(dt);
      ctx.time = playback.time;
      host.update(dt);
      trackView.update(playback.time);
      mainTile.update(dt);
      audioEvents.update(playback.time, selected, playback.playing && !playback.waiting);
      extras.update(dt, selected);
      if (ticker.expanded !== tickerOpen) {
        tickerOpen = ticker.expanded;
        tiles.ticker.classList.toggle('is-open', tickerOpen);
      }
      if (!perf.hidden) {
        fpsFrames++;
        fpsAcc += dt;
        if (fpsAcc >= 0.5) {
          const redraws = Math.round((panelStats.redraws - redrawBase) / fpsAcc);
          redrawBase = panelStats.redraws;
          perf.textContent = `${Math.round(fpsFrames / fpsAcc)} fps · ${info.calls} calls · ${Math.round(info.triangles / 1000)}k tris · ${redraws} redraws/s`;
          fpsFrames = 0; fpsAcc = 0;
        }
      }
    };
    raf = requestAnimationFrame(frame);

    // Dev/test hook: ?debug exposes the live objects (used by headless tests).
    if (new URLSearchParams(location.search).has('debug')) {
      window.__f1vr = {
        data, playback, sync, host, trackView, mainTile, sfxStats, extras, layout: () => computeScreenLayout(root.clientWidth, root.clientHeight, { focus }),
        toggleFocus, setView, getFocus: () => focus,
      };
      unsubs.push(() => { if (window.__f1vr && window.__f1vr.playback === playback) delete window.__f1vr; });
    }
  } catch (err) {
    dispose();
    throw err;
  }

  status('Ready');
  return { playback, dispose };
}
