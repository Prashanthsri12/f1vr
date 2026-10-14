// Screen mode on desktop (Phase 8): a flat, full-window dashboard instead of the 3D room.
// 12.2: tiles are placed by dash-layout.js (landscape, portrait or a scrolling stack, re-laid
// out live on resize) under a top bar (top-bar.js: Exit, stickers, race control, weather,
// toggles); panels are shown as page canvases (panel-host.js), the track has its own WebGL
// view (track-view.js) and the hub tile has the Insights and main screen tabs (main-tile.js).
// ⤢ swaps the track and the hub ("Video focus").
import { Playback } from '../playback.js';
import { LeaderboardPanel } from '../panels/leaderboard.js';
import { TelemetryPanel } from '../panels/telemetry.js';
import { LapsPanel } from '../panels/laps.js';
import { PlaybackBarPanel } from '../panels/playback-bar.js';
import { panelStats } from '../panels/panel-base.js';
import { createAudioEvents } from '../audio-events.js';
import { createSyncControl } from '../sync-control.js';
import { stopRadio, sfxStats } from '../audio.js';
import { getSettings, setSetting } from '../settings.js';
import { computeDashLayout, DASH_TILES, CHART_TILES } from './dash-layout.js';
import { createTopBar } from './top-bar.js';
import { AnalyticsPanel } from '../panels/analytics-panel.js';
import { PanelHost } from './panel-host.js';
import { createTrackView } from './track-view.js';
import { createMainTile } from './main-tile.js';
import { createDashExtras } from './dash-extras.js';

const KEYS_HELP = 'Space play/pause · ←/→ seek 10 s · ↑/↓ speed · [ ] driver · V 2D/3D · F swap track and screen · Esc exit'
  + '\nC track colours (sectors / mini-sectors / plain) · E engine hum · R team radio (off / driver / all) · A analytics view'
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
  const ALL_TILES = ['topbar', ...DASH_TILES, ...CHART_TILES];
  const GAP = 10;
  for (const name of ALL_TILES) {
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
  let topBar = null;
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
    if (topBar) topBar.dispose();
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
    // Analytics view (9.28): six charts, each starting on its own kind (9.30: by session type).
    const slots = data.hasIntervals ? ['gap', 'positions', 'strategy', 'deg', 'compare', 'tools'] : ['laptimes', 'pace', 'longrun', 'deg', 'compare', 'strategy'];
    CHART_TILES.forEach((name, i) => host.add(new AnalyticsPanel(data, { name, width: 0.9, height: 0.42, kind: slots[i] }), tiles[name]));
    host.add(new PlaybackBarPanel(data), tiles.playbackBar, { anchor: 'stretch' });

    status('Building track…');
    trackView = await createTrackView({ data, tile: tiles.track, view: getSettings().trackView });
    mainTile = createMainTile({ tile: tiles.hub, data, playback, host, onToggleFocus: () => toggleFocus() });

    // Top bar (12.3) and the track's own overlay buttons: track colours, 2D / 3D.
    topBar = createTopBar({ data, parent: tiles.topbar, onExit: exit, help: KEYS_HELP });
    const perf = topBar.perf;
    const tools = el('div', 'f1-dash__tools', tiles.track);
    el('span', 'f1-dash__spacer', tools);
    const viewBtns = {};
    for (const v of ['2d', '3d']) {
      const b = el('button', 'f1-dash__btn', tools, v.toUpperCase());
      b.type = 'button';
      b.addEventListener('click', () => setView(v));
      viewBtns[v] = b;
    }

    function setView(v) {
      trackView.setView(v);
      setSetting('trackView', trackView.getView());
      for (const [id, b] of Object.entries(viewBtns)) b.classList.toggle('is-active', id === trackView.getView());
    }
    setView(trackView.getView());
    extras = createDashExtras({ data, playback, root, trackTile: tiles.track, trackTools: tools, right: topBar.right, el, selectDriver });
    const viewBtn = el('button', 'f1-dash__btn', topBar.right, 'Analytics');
    viewBtn.type = 'button';
    viewBtn.title = 'Analytics view: six charts with a small track and the leaderboard (A)';
    viewBtn.addEventListener('click', () => toggleView());
    const swapBtn = el('button', 'f1-dash__btn f1-dash__btn--icon', topBar.right, '⤢');
    swapBtn.type = 'button';
    swapBtn.addEventListener('click', () => toggleFocus());

    // --- layout ---
    let focus = 'track';
    let screenView = getSettings().screenView;
    function currentLayout() {
      // The top bar wraps on narrow windows: measure it at its width first.
      const tb = tiles.topbar.style;
      tb.left = `${GAP}px`; tb.top = `${GAP}px`; tb.width = `${Math.max(1, root.clientWidth - 2 * GAP)}px`; tb.height = 'auto';
      const top = Math.ceil(tiles.topbar.offsetHeight) || 52;
      return computeDashLayout(root.clientWidth, root.clientHeight, { top, gap: GAP, focus, view: screenView });
    }
    function layout() {
      const l = currentLayout();
      content.style.height = `${l.height}px`;
      root.dataset.orientation = l.orientation;
      root.dataset.view = screenView;
      for (const name of ALL_TILES) {
        const r = l.tiles[name];
        tiles[name].hidden = !r;
        if (!r) continue;
        const st = tiles[name].style;
        st.left = `${r.x}px`; st.top = `${r.y}px`; st.width = `${r.w}px`; st.height = `${r.h}px`;
      }
      host.layout(window.devicePixelRatio || 1);
      // Hidden panels skip their refresh work (AnalyticsPanel checks mesh.visible).
      for (const e of host.entries) e.panel.mesh.visible = e.tile.offsetParent !== null;
      trackView.resize();
      viewBtn.classList.toggle('is-on', screenView === 'analytics');
      swapBtn.hidden = screenView === 'analytics';
    }
    function toggleView() {
      screenView = screenView === 'analytics' ? 'dashboard' : 'analytics';
      setSetting('screenView', screenView);
      layout();
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
    // The top bar's height changes when it wraps or its text changes (race control, weather).
    let topH = 0;
    const roTop = new ResizeObserver(() => { const h = tiles.topbar.firstChild ? tiles.topbar.firstChild.offsetHeight : 0; if (h !== topH) { topH = h; layout(); } });
    roTop.observe(tiles.topbar.firstChild);
    unsubs.push(() => roTop.disconnect());
    window.addEventListener('resize', layout); // devicePixelRatio changes (moving between monitors)
    unsubs.push(() => { ro.disconnect(); window.removeEventListener('resize', layout); });
    layout();

    const lb0 = data.getLeaderboardAt(playback.time);
    selectDriver((lb0 && lb0[0] && lb0[0].driverNumber) ?? (data.drivers[0] && data.drivers[0].number));
    // Team radio autoplay (+ the pop-up, 11.2) and sound effects.
    audioEvents = createAudioEvents(data, { onRadio: (clip) => extras.showRadio(clip) });

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
        case 'KeyF': if (!e.repeat && screenView !== 'analytics') toggleFocus(); return;
        case 'KeyA': if (!e.repeat) toggleView(); return;
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
      topBar.update(playback.time);
      audioEvents.update(playback.time, selected, playback.playing && !playback.waiting);
      extras.update(dt, selected);
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
        data, playback, sync, host, trackView, mainTile, sfxStats, extras, topBar, layout: () => currentLayout(),
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
