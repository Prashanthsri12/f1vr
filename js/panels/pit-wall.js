// Builds every pit wall panel, places it per LAYOUT and drives the shared PanelContext.
// The panels live in the manager's layout rig (rig-local = LAYOUT space); re-centre moves
// the rig. Each top-level panel and the driver picker group (desktop only, 4b.1) is a
// movable, resizable unit; moved or resized units are saved on the device (layout-store.js)
// and restored on the next start. Enlarged panels get a denser canvas (4b.14).
import { PanelManager } from './panel-base.js';
import { LAYOUT } from './layout.js';
import { LeaderboardPanel } from './leaderboard.js';
import { TelemetryPanel } from './telemetry.js';
import { LapsPanel } from './laps.js';
import { WeatherPanel } from './weather.js';
import { TickerPanel } from './ticker.js';
import { DriverPicker } from './driver-picker.js';
import { PlaybackBarPanel } from './playback-bar.js';
import { WristMenu, placeWristMenu } from './wrist-menu.js';
import { loadLayout, saveLayout, clearLayout } from './layout-store.js';

const MOVED_POS = 1e-3;   // metres: closer than this to the default counts as not moved
const MOVED_ROT = 1e-4;   // 1 - |q·q0|
const MOVED_SCALE = 1e-3;
const DENSITY_DELAY = 300; // ms after the last resize before canvases are re-allocated

/**
 * @param {object} o
 * @param {import('three').Object3D} o.parent scene (panels are fixed in the room, not on the table)
 * @param {import('../session-data.js').SessionData} o.data
 * @param {import('../playback.js').Playback} o.playback
 * @param {object} o.actions PanelContext actions (selectDriver, togglePlay, seekBy, seekToLap, speedUp, speedDown,
 *   setSpeed, togglePassthrough, exit, recenter?, resetLayout?)
 * @param {boolean} [o.canPassthrough] the session can switch to passthrough (wrist menu shows the toggle)
 * @param {boolean} [o.driverTiles] build the driver picker tiles (desktop; XR uses the wrist menu, 4b.1)
 * @returns {{ctx: object, manager: PanelManager, ticker: TickerPanel, update: (dt: number) => void,
 *   setSelected: (n: number) => void, setMode: (m: string) => void, updateWrist: Function,
 *   recenter: (pose: {x: number, z: number, yaw: number}) => void,
 *   movableFor: (panel: object) => (import('three').Object3D|null),
 *   saveLayout: () => void, resetLayout: () => void, dispose: () => void}}
 */
export function createPitWall({ parent, data, playback, actions, canPassthrough = true, driverTiles = true }) {
  const ctx = { data, playback, time: playback.time, selected: null, mode: 'pitwall', canPassthrough, actions };
  const manager = new PanelManager(parent);

  /** name -> { obj, panels, p0, q0 } for every movable unit (defaults captured after placement). */
  const units = new Map();
  const unit = (name, obj, panels) => {
    units.set(name, { obj, panels, p0: obj.position.clone(), q0: obj.quaternion.clone() });
  };

  const place = (panel, spec, opts) => {
    manager.add(panel, spec.position, opts);
    unit(panel.name, panel.mesh, [panel]);
    return panel;
  };
  place(new LeaderboardPanel(data), LAYOUT.leaderboard);
  place(new TelemetryPanel(data), LAYOUT.telemetry);
  place(new LapsPanel(data), LAYOUT.laps);
  place(new WeatherPanel(data), LAYOUT.weather);
  const ticker = place(new TickerPanel(data), LAYOUT.ticker);
  ticker.passThroughEmpty = true; // its transparent lower area must not block the main screen
  place(new PlaybackBarPanel(data), LAYOUT.playbackBar);
  let picker = null;
  let tiles = null;
  if (driverTiles) {
    picker = new DriverPicker(data);
    picker.addTo(manager);
    unit(picker.group.name, picker.group, picker.tiles);
    tiles = new Set(picker.tiles);
  }
  // Wrist menu: registered for raycasts/redraws, but outside the rig (placed in world space
  // every frame by updateWrist()).
  const wrist = manager.add(new WristMenu(data), { x: 0, y: -10, z: 0 }, { parent });

  /** Canvas density follows each unit's scale (re-allocates only when the step changes). */
  function applyDensity() {
    for (const u of units.values()) for (const p of u.panels) p.setDensity(u.obj.scale.x);
  }
  let densityTimer = 0;
  function scheduleDensity() {
    clearTimeout(densityTimer);
    densityTimer = setTimeout(applyDensity, DENSITY_DELAY);
  }

  // Restore the saved layout. Entries for units this session doesn't build (the driver
  // tiles in XR) are kept so a later save doesn't drop them.
  const saved = loadLayout();
  for (const [name, u] of units) {
    const s = saved[name];
    if (!s) continue;
    u.obj.position.fromArray(s.p);
    u.obj.quaternion.fromArray(s.q).normalize();
    u.obj.scale.setScalar(s.s);
  }
  applyDensity();

  function movableFor(panel) {
    if (!panel) return null;
    if (tiles && tiles.has(panel)) return picker.group;
    const u = units.get(panel.name);
    return u && u.obj === panel.mesh ? u.obj : null;
  }

  /** Save every unit that is away from its default placement or size. */
  function save() {
    const items = {};
    for (const [name, s] of Object.entries(saved)) if (!units.has(name)) items[name] = s;
    for (const [name, u] of units) {
      const o = u.obj;
      const moved = o.position.distanceTo(u.p0) > MOVED_POS || 1 - Math.abs(o.quaternion.dot(u.q0)) > MOVED_ROT
        || Math.abs(o.scale.x - 1) > MOVED_SCALE;
      if (moved) items[name] = { p: o.position.toArray(), q: o.quaternion.toArray(), s: o.scale.x };
    }
    if (Object.keys(items).length) saveLayout(items); else clearLayout();
    scheduleDensity();
  }

  return {
    ctx,
    manager,
    ticker,
    /** Per frame: sync the context, then let each panel refresh/redraw at ≤10 Hz. */
    update(dt) {
      ctx.time = playback.time;
      manager.update(dt, ctx);
    },
    setSelected(n) { ctx.selected = n; },
    /** Per frame in XR: show the wrist menu while the left palm faces the head. */
    updateWrist(palmOk, palmPos, palmNormal, headPos) {
      placeWristMenu(wrist, palmOk, palmPos, palmNormal, headPos);
    },
    setMode(m) {
      ctx.mode = m;
      manager.setPassthrough(m === 'passthrough');
    },
    /** Put the layout rig at the user's floor position and facing (custom placements come along). */
    recenter({ x, z, yaw }) {
      manager.group.position.set(x, 0, z);
      manager.group.rotation.set(0, yaw, 0);
    },
    movableFor,
    saveLayout: save,
    /** Every unit back to LAYOUT at scale 1; forget the saved layout (all units, built or not). */
    resetLayout() {
      for (const k of Object.keys(saved)) delete saved[k];
      for (const u of units.values()) {
        u.obj.position.copy(u.p0);
        u.obj.quaternion.copy(u.q0);
        u.obj.scale.setScalar(1);
      }
      clearLayout();
      scheduleDensity();
    },
    dispose() {
      clearTimeout(densityTimer);
      manager.dispose(); // disposes the picker tiles and the wrist menu too, and removes the rig
    },
  };
}
