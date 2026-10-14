// Scene bootstrap: wires world, table, track, cars, playback, desktop input and the HTML HUD.
import * as THREE from 'three';
import { createWorld, getRecenterPose } from './scene/world.js';
import { createTable, loadTrack, applyRecenter } from './scene/track.js';
import { Cars } from './scene/cars.js';
import { Playback } from './playback.js';
import { createDesktopInput } from './input/desktop-input.js';
import { createPitWall } from './panels/pit-wall.js';
import { createXrInput } from './input/xr-input.js';
import { createPanelGrab } from './input/panel-grab.js';
import { showXrLoading } from './scene/xr-loading.js';
import { panelStats } from './panels/panel-base.js';
import { THEMES } from './scene/rooms.js';
import { FpsMeter } from './scene/fps-meter.js';
import { getSettings, setSetting } from './settings.js';
import { createAudioEvents } from './audio-events.js';
import { stopRadio, sfxStats } from './audio.js';
import { createMainScreen } from './scene/screen.js';
import { createVrScreen } from './screen/vr-screen.js';
import { createExtraData } from './extra-data.js';
import { createSyncControl } from './sync-control.js';
import { createVrExtras } from './scene/vr-extras.js';

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
.f1vr-exit:hover{background:#ff2d3d}
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
 * @param {import('./session-data.js').SessionData} [opts.data] loaded session (desktop preview)
 * @param {(onStep: (s: string) => void) => Promise<import('./session-data.js').SessionData>} [opts.loadData]
 *   loads the session after an XR session has started (used instead of data)
 * @param {XRSession} [opts.xrSession] immersive session requested by the start page (in the click gesture)
 * @param {'immersive-ar'|'immersive-vr'} [opts.xrMode] the session's mode; passthrough needs immersive-ar
 * @param {'pitwall'|'passthrough'} [opts.startMode]
 * @param {boolean} [opts.screenMode] Screen in VR (8.11): the dashboard on one big screen instead of
 *   floating panels (the room preview shows it with ?vrscreen)
 * @param {HTMLElement} opts.container
 * @param {() => void} [opts.onExit] called after dispose when the user presses Exit
 * @param {(s: string|object) => void} [opts.onStatus] setup step strings ('Building track…'),
 *   then forwarded data.onStatus objects ({loading, pending, error?})
 * @returns {Promise<{playback: Playback, world: object, dispose: () => void}>}
 */
export async function startApp({
  data, loadData, xrSession, xrMode, startMode = 'pitwall', screenMode = false, container, onExit, onStatus,
}) {
  let xrLoading = null;
  const status = (m) => {
    if (xrLoading && typeof m === 'string') xrLoading.setText(m);
    if (onStatus) { try { onStatus(m); } catch (_) { /* ignore */ } }
  };
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';

  const world = createWorld(container);
  const table = createTable(world.scene);

  // Cleanup state, filled as we go so a failure mid-setup still disposes.
  let cars = null;
  let input = null;
  let pitWall = null;
  let screen = null;
  let vrScreen = null;
  let xrInput = null;
  let fpsMeter = null;
  let audioEvents = null;
  let extra = null;
  const unsubs = [];
  // Phase 9: rain, track colours, race banners, flag ambience, engine hum (scene/vr-extras.js).
  const extras = createVrExtras({ world, table });
  unsubs.push(() => extras.dispose());
  let overlay = null;
  let disposed = false;

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const u of unsubs) { try { u(); } catch (_) { /* ignore */ } }
    if (xrSession) {
      xrSession.removeEventListener('end', onSessionEnd);
      xrSession.end().catch(() => { /* already ended */ });
    }
    if (xrLoading) xrLoading.dispose();
    if (xrInput) xrInput.dispose();
    if (input) input.dispose();
    if (fpsMeter) fpsMeter.dispose();
    if (audioEvents) audioEvents.dispose();
    if (extra) extra.dispose();
    stopRadio();
    if (vrScreen) vrScreen.dispose();
    if (screen) screen.dispose();
    if (pitWall) pitWall.dispose();
    if (cars) cars.dispose();
    world.dispose();
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  // Headset closed the session (Quest menu / Exit): back to the start page.
  function onSessionEnd() {
    dispose();
    if (onExit) onExit();
  }

  let playback;
  let hudDirty = true;
  let togglePassthrough = () => {};
  const canPassthrough = !xrSession || xrMode === 'immersive-ar';
  const screenUp = () => !!(vrScreen && vrScreen.isActive());
  // Moving panels (VR grip / pinch-hold); saved on release. Screen in VR moves the whole screen.
  const panelGrab = createPanelGrab({
    getMovable: (panel) => (screenUp() ? vrScreen.movableFor(panel) : pitWall ? pitWall.movableFor(panel) : null),
    onRelease: () => {
      if (screenUp()) vrScreen.saveTransform();
      else if (pitWall) pitWall.saveLayout();
    },
  });
  // Re-centre (XR only): the panel rig (with the screen) and the table follow the user's floor
  // position and facing. While the screen is up the table is on its tile, so it stays put.
  const recenterPose = { x: 0, z: 0, yaw: 0 };
  function recenter() {
    if (!pitWall || !world.renderer.xr.isPresenting) return;
    getRecenterPose(world.renderer.xr.getCamera(), recenterPose);
    pitWall.recenter(recenterPose);
    if (!screenUp()) applyRecenter(table, recenterPose);
  }
  try {
    // XR controllers must exist before the session starts: three.js only sends
    // 'connected' to controllers created by then. Targets appear once panels exist.
    xrInput = createXrInput({
      renderer: world.renderer,
      scene: world.scene,
      table,
      pickPanels: (raycaster) => (pitWall ? pitWall.manager.raycast(raycaster) : null),
      onHover: (r) => { if (pitWall) pitWall.manager.setHover(r); },
      onSelect: (r) => { if (pitWall) pitWall.manager.select(r, pitWall.ctx); },
      panelGrab,
      canGrabTable: () => !screenUp(),
      actions: {
        togglePlay: () => playback && playback.toggle(),
        togglePassthrough: () => togglePassthrough(),
        stepDriver: (dir) => stepDriver(dir),
        seekBy: (sec) => playback && playback.seekBy(sec),
        speedUp: () => playback && playback.speedUp(),
        speedDown: () => playback && playback.speedDown(),
        recenter,
      },
    });
    if (xrSession) {
      world.renderer.xr.setReferenceSpaceType('local-floor');
      await world.renderer.xr.setSession(xrSession);
      xrSession.addEventListener('end', onSessionEnd);
      xrLoading = showXrLoading(world.scene);
      const offLoading = world.onFrame((dt) => { if (xrLoading) xrLoading.update(dt); });
      unsubs.push(offLoading);
    }
    if (!data) {
      if (!loadData) throw new Error('startApp needs data or loadData');
      data = await loadData((step) => status(step));
    }
    status('Building track…');
    const transform = await loadTrack(data, table);
    status('Placing cars…');
    cars = new Cars(data.drivers, transform, table);
    extras.setSession(data, transform);
    // 13.2: overtakes, the weekend's qualifying and the season's standings, in the background.
    extra = createExtraData(data);
    extra.onChange((x) => extras.setExtra(x));
    extras.setFxContext((out) => {
      const up = screenUp();
      out.on = !up || vrScreen.getView() === '3d';
      out.lights = up ? vrScreen.lights : null;
      return out;
    });
    playback = new Playback(data);
    const sync = createSyncControl({ data, playback }); // 8.9: playback bar sync row
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
        seekTo: (t) => playback.seek(t),
        speedUp: () => playback.speedUp(),
        speedDown: () => playback.speedDown(),
        setSpeed: (sp) => playback.setSpeed(sp),
        togglePassthrough: () => togglePassthrough(),
        exit: () => { dispose(); if (onExit) onExit(); },
        recenter: xrSession ? recenter : undefined,
        resetLayout: () => (screenUp() ? vrScreen.resetTransform() : pitWall.resetLayout()),
        cycleTheme: () => cycleTheme(),
        goLightsOut: () => sync.lightsOut(),
        stepLap: (dir) => sync.stepLap(dir),
        nudge: (sec) => sync.nudge(sec),
        getSync: () => sync,
        toggleVrMode: () => toggleVrMode(),
        toggleScreenShape: () => toggleScreenShape(),
        getVrMode: () => (screenUp() ? 'screen' : 'immersive'),
      },
      canPassthrough,
    });
    // Main screen (Phase 5): video / radio tabs, in the panel rig.
    screen = createMainScreen({ manager: pitWall.manager, data, playback, extra });
    if (screenMode) ensureVrScreen().apply();
  } catch (err) {
    dispose();
    throw err;
  }
  // Team radio autoplay (+ the pop-up, 11.2) and sound effects.
  audioEvents = createAudioEvents(data, {
    onRadio: (clip) => extras.showRadio(clip, world.renderer.xr.isPresenting ? world.renderer.xr.getCamera() : world.camera),
  });

  // --- Screen in VR ⇄ Immersive and flat / curved (8.13, wrist menu), both saved ---
  function ensureVrScreen() {
    if (!vrScreen) {
      const s = getSettings();
      vrScreen = createVrScreen({ data,
        manager: pitWall.manager, mainScreen: screen, table, cars, renderer: world.renderer,
        shape: s.screenShape, view: s.trackView,
      });
    }
    return vrScreen;
  }
  function toggleVrMode() {
    const toScreen = !screenUp();
    if (toScreen) ensureVrScreen().apply(); else vrScreen.restore();
    setSetting('vrMode', toScreen ? 'screen' : 'immersive');
    hudDirty = true;
  }
  function toggleScreenShape() {
    const next = getSettings().screenShape === 'curved' ? 'flat' : 'curved';
    setSetting('screenShape', next);
    if (vrScreen) vrScreen.setShape(next);
  }

  // --- room theme (4b.5) and in-scene fps counter (6.7) ---
  function cycleTheme() {
    const next = THEMES[(THEMES.indexOf(world.getTheme()) + 1) % THEMES.length];
    setSetting('theme', world.setTheme(next));
  }
  fpsMeter = new FpsMeter(world.renderer);
  {
    const bar = pitWall.manager.panels.find((p) => p.name === 'playbackBar');
    if (bar) fpsMeter.attachBelow(bar.mesh, bar.height); else world.scene.add(fpsMeter.mesh);
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
  /** Previous (-1) / next (+1) driver by current race position. */
  function stepDriver(dir) {
    if (!playback) return;
    const order = getDriverOrder();
    if (!order.length) return;
    let i = order.indexOf(selected);
    if (i < 0) i = dir > 0 ? -1 : 0;
    selectDriver(order[(i + dir + order.length) % order.length]);
  }
  function getDriverOrder() {
    const lb = data.getLeaderboardAt(playback.time);
    if (lb && lb.length) return lb.map((r) => r.driverNumber);
    return data.drivers.map((d) => d.number);
  }
  const lb0 = data.getLeaderboardAt(playback.time);
  selectDriver((lb0 && lb0[0] && lb0[0].driverNumber) ?? (data.drivers[0] && data.drivers[0].number));

  // --- pit wall / passthrough (one session, no restart; needs immersive-ar in XR) ---
  let mode = canPassthrough && startMode === 'passthrough' ? 'passthrough' : 'pitwall';
  function applyMode() {
    world.setMode(mode);
    pitWall.setMode(mode);
    hudDirty = true;
  }
  togglePassthrough = () => {
    if (!canPassthrough) return;
    mode = mode === 'pitwall' ? 'passthrough' : 'pitwall';
    applyMode();
  };
  applyMode();

  if (xrLoading) { xrLoading.dispose(); xrLoading = null; }

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
    canUseTable: () => !screenUp(),
    getOrbitTarget: screenUp() ? (out) => vrScreen.group.getWorldPosition(out) : null,
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
    'Room preview (debug) · Click panels · Space play/pause · ←/→ seek 10 s · ↑/↓ speed · [ ] driver · P passthrough · drag table rotate · wheel on table scale · right-drag orbit');
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
      // Chunk errors are retried every few seconds (session-data); playback just waits.
      lastError = st && st.error ? 'Data unavailable, retrying (' + (st.error.status ? 'HTTP ' + st.error.status : 'no connection') + ')' : '';
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

  const palmPos = new THREE.Vector3();
  const palmNormal = new THREE.Vector3();
  const head = new THREE.Vector3();

  // --- frame loop (allocation-free apart from the 10 Hz HUD strings) ---
  unsubs.push(world.onFrame((dt) => {
    playback.update(dt);
    cars.update(data, playback.time, screenUp() ? vrScreen.camera : world.camera);
    pitWall.update(dt);
    fpsMeter.update(dt);
    audioEvents.update(playback.time, selected, playback.playing && !playback.waiting);
    input.update(dt);
    xrInput.update(dt);
    if (world.renderer.xr.isPresenting) {
      head.setFromMatrixPosition(world.renderer.xr.getCamera().matrixWorld);
      pitWall.updateWrist(xrInput.getLeftPalm(palmPos, palmNormal), palmPos, palmNormal, head);
    } else {
      pitWall.updateWrist(false, palmPos, palmNormal, head);
    }

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
    extras.update(dt, playback, selected, mode === 'passthrough');
    screen.update(dt);
    if (vrScreen) vrScreen.update(dt);
  }));

  // Dev/test hook: ?debug exposes the live objects (used by headless XR tests).
  if (new URLSearchParams(location.search).has('debug')) {
    window.__f1vr = {
      world, table, data, playback, pitWall, panelGrab, recenter, sfxStats, screen, get vrScreen() { return vrScreen; }, getExtra: () => extra, getMode: () => mode,
      banner3d: extras.banner3d, setDebugFlag: extras.setDebugFlag, showRadio: (clip) => extras.showRadio(clip, world.camera),
    };
    unsubs.push(() => { if (window.__f1vr && window.__f1vr.table === table) delete window.__f1vr; });
  }

  status('Ready');
  return { playback, world, dispose };
}
