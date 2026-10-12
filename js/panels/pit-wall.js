// Builds every pit wall panel, places it per LAYOUT and drives the shared PanelContext.
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

/**
 * @param {object} o
 * @param {import('three').Object3D} o.parent scene (panels are fixed in the room, not on the table)
 * @param {import('../session-data.js').SessionData} o.data
 * @param {import('../playback.js').Playback} o.playback
 * @param {object} o.actions PanelContext actions (selectDriver, togglePlay, seekBy, seekToLap, speedUp, speedDown,
 *   setSpeed, togglePassthrough, exit, recenter?)
 * @param {boolean} [o.canPassthrough] the session can switch to passthrough (wrist menu shows the toggle)
 * @returns {{ctx: object, manager: PanelManager, ticker: TickerPanel, update: (dt: number) => void,
 *   setSelected: (n: number) => void, setMode: (m: string) => void, dispose: () => void}}
 */
export function createPitWall({ parent, data, playback, actions, canPassthrough = true }) {
  const ctx = { data, playback, time: playback.time, selected: null, mode: 'pitwall', canPassthrough, actions };
  const manager = new PanelManager(parent);

  const place = (panel, spec, opts) => manager.add(panel, spec.position, opts);
  place(new LeaderboardPanel(data), LAYOUT.leaderboard);
  place(new TelemetryPanel(data), LAYOUT.telemetry);
  place(new LapsPanel(data), LAYOUT.laps);
  place(new WeatherPanel(data), LAYOUT.weather);
  const ticker = place(new TickerPanel(data), LAYOUT.ticker);
  ticker.passThroughEmpty = true; // its transparent lower area must not block the main screen
  place(new PlaybackBarPanel(data), LAYOUT.playbackBar);
  const picker = new DriverPicker(data);
  picker.addTo(manager);
  // Wrist menu: registered for raycasts/redraws; placed every frame by updateWrist().
  const wrist = manager.add(new WristMenu(data), { x: 0, y: -10, z: 0 });

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
    dispose() {
      manager.dispose(); // disposes the picker tiles too
    },
  };
}
