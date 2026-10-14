// Phase 9 additions to the VR / room app, kept out of app.js: rain in the room (9.7),
// track colours (9.8, 9.10), race moment banners (9.11), flag ambience (9.12) and the
// engine hum (9.13), the team radio pop-up (11.2) and the overtake warnings (13.6). update() runs every frame; the data
// work happens at 10 Hz (track colours at ~2.5 Hz). No per-frame allocation.
import { createRain } from './rain.js';
import { TrackStyle, colourMode } from './track-style.js';
import { createBanner3d } from './banner-3d.js';
import { createRadioPop3d } from './radio-pop-3d.js';
import { currentLap } from '../session-index.js';
import { createFlagAmbience } from './flag-ambience.js';
import { createRaceMoments } from '../race-moments.js';
import { createEngineSound } from '../engine-sound.js';
import { trackStatusAt } from '../panels/race-status.js';
import { getSettings } from '../settings.js';
import { createOvertakeAlerts, overtakeEventsFor } from '../overtake-alerts.js';
import { createOvertakeToasts3d } from './overtake-toasts-3d.js';
import { createWeatherFx } from './weather-fx.js';
import { newWeather, weatherAt } from '../weather-model.js';

const TICK_S = 0.1;
const STYLE_S = 0.4;

/**
 * @param {object} o
 * @param {object} o.world createWorld result
 * @param {THREE.Group} o.table createTable result
 */
export function createVrExtras({ world, table }) {
  const rain = createRain();
  world.scene.add(rain.object);
  const banner3d = createBanner3d(world.scene);
  const radioPop = createRadioPop3d(world.scene);
  const flagFx = createFlagAmbience();
  const engine = createEngineSound();
  const rimMat = table.getObjectByName('tableRim')?.material || null;
  const tel = { speed: 0, rpm: 0, gear: 0, throttle: 0, brake: 0, drs: 0 };
  let data = null, style = null, moments = null, alerts = null, toasts = null;
  let tick = TICK_S, styleAcc = STYLE_S;
  let flagColour = null, debugFlag = null, raining = false;
  // 13.10: clouds and rain over the table, and time-of-day light on the Screen in VR track tile.
  const fx = createWeatherFx(table);
  const wx = newWeather();
  let wxAcc = 1;
  const fxCtx = { on: true, lights: null };
  let fxContext = (out) => out;

  return {
    banner3d,
    /**
     * A team radio clip started (audio-events onRadio): show who is talking.
     * @param {{driver_number: number, date: number, recording_url: string}} clip
     * @param {THREE.Camera} camera the viewing camera (XR camera when presenting)
     */
    showRadio(clip, camera) {
      if (!data) return;
      const n = clip.driver_number;
      const d = data.driverByNumber.get(n);
      const pos = data.getPositionAt(n, clip.date);
      const lap = currentLap(data.getDriverLaps(n), clip.date);
      radioPop.show({
        colour: d ? d.teamColour : '#8a8fa0',
        number: String(d ? d.number : n),
        name: d ? d.fullName || d.acronym : `Car ${n}`,
        team: d ? d.teamName || '' : '',
        meta: [pos ? `P${pos}` : '', lap ? `Lap ${lap.lap_number}` : ''].filter(Boolean).join(' · '),
        url: clip.recording_url,
      }, camera);
    },
    /**
     * Where the weather effects show: app.js says whether the table is seen in 3D (Immersive, or
     * the Screen in VR tile in 3D) and passes that tile's lights.
     * @param {(out: {on: boolean, lights: {hemi: object, sun: object}|null}) => object} fn fills `out` (no allocation)
     */
    setFxContext(fn) { fxContext = fn; },
    /** ?debug hook: force a flag colour ('#rrggbb') or null. */
    setDebugFlag(c) { debugFlag = c; },
    /** Once the track and data exist. */
    setSession(sessionData, transform) {
      data = sessionData;
      style = new TrackStyle(data, transform);
      moments = createRaceMoments(data);
      alerts = createOvertakeAlerts(overtakeEventsFor(data));
      toasts = createOvertakeToasts3d(world.scene, data);
    },
    /** 13.2 extra data arrived: rebuild the overtake list with the API records. */
    setExtra(extra) { if (data) alerts = createOvertakeAlerts(overtakeEventsFor(data, extra.overtakes)); },
    /**
     * @param {number} dt seconds
     * @param {object} playback Playback
     * @param {number|null} selected driver number
     * @param {boolean} passthrough
     */
    update(dt, playback, selected, passthrough) {
      if (data) {
        styleAcc += dt;
        if (styleAcc >= STYLE_S) {
          styleAcc = 0;
          style.update(playback.time, selected, colourMode(getSettings()));
        }
        tick += dt;
        if (tick >= TICK_S) {
          tick = 0;
          const running = playback.playing && !playback.waiting;
          const s = getSettings();
          const ev = moments.update(playback.time, selected, running);
          const xr = world.renderer.xr;
          const cam = xr.isPresenting ? xr.getCamera() : world.camera;
          // The overtake toasts replace the overtake banner while they are on.
          if (ev && s.banners && !(ev.kind === 'overtake' && s.overtakeAlerts)) banner3d.show(ev, cam);
          toasts.render(alerts.at(playback.time, s), playback.time, cam);
          const st = trackStatusAt(data, playback.time);
          flagColour = st.status === 'GREEN' ? null : st.colour;
          wxAcc += TICK_S;
          if (wxAcc >= 1) {
            wxAcc = 0;
            weatherAt(data, playback.time, wx);
            const c = fxContext(fxCtx);
            if (c.lights && s.weatherFx) fx.light(c.lights.hemi, c.lights.sun, wx);
          }
          raining = wx.ok && wx.rainfall > 0;
          const telOk = selected != null && running && data.getTelemetryAt(selected, playback.time, tel);
          engine.update(s.engine && running, playback.speed, telOk ? tel : null);
        }
      }
      rain.update(dt, raining, !passthrough);
      fx.update(dt, wx, !!data && getSettings().weatherFx && fxContext(fxCtx).on);
      flagFx.update(dt, passthrough ? null : (debugFlag ?? flagColour), world.getRoomAccent(), rimMat);
      banner3d.update();
      radioPop.update();
    },
    dispose() {
      rain.dispose();
      fx.dispose();
      banner3d.dispose();
      radioPop.dispose();
      engine.dispose();
      if (toasts) toasts.dispose();
    },
  };
}
