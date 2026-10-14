// Phase 9 additions to the VR / room app, kept out of app.js: rain in the room (9.7),
// track colours (9.8, 9.10), race moment banners (9.11), flag ambience (9.12) and the
// engine hum (9.13) and the team radio pop-up (11.2). update() runs every frame; the data
// work happens at 10 Hz (track colours at ~2.5 Hz). No per-frame allocation.
import { createRain } from './rain.js';
import { TrackStyle } from './track-style.js';
import { createBanner3d } from './banner-3d.js';
import { createRadioPop3d } from './radio-pop-3d.js';
import { currentLap } from '../session-index.js';
import { createFlagAmbience } from './flag-ambience.js';
import { createRaceMoments } from '../race-moments.js';
import { createEngineSound } from '../engine-sound.js';
import { trackStatusAt } from '../panels/race-status.js';
import { getSettings } from '../settings.js';

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
  let data = null, style = null, moments = null;
  let tick = TICK_S, styleAcc = STYLE_S;
  let flagColour = null, debugFlag = null, raining = false;

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
    /** ?debug hook: force a flag colour ('#rrggbb') or null. */
    setDebugFlag(c) { debugFlag = c; },
    /** Once the track and data exist. */
    setSession(sessionData, transform) {
      data = sessionData;
      style = new TrackStyle(data, transform);
      moments = createRaceMoments(data);
    },
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
          style.update(playback.time, selected, getSettings().trackColours);
        }
        tick += dt;
        if (tick >= TICK_S) {
          tick = 0;
          const running = playback.playing && !playback.waiting;
          const s = getSettings();
          const ev = moments.update(playback.time, selected, running);
          const xr = world.renderer.xr;
          if (ev && s.banners) banner3d.show(ev, xr.isPresenting ? xr.getCamera() : world.camera);
          const st = trackStatusAt(data, playback.time);
          flagColour = st.status === 'GREEN' ? null : st.colour;
          const wx = data.getWeatherAt(playback.time);
          raining = !!(wx && wx.rainfall > 0);
          const telOk = selected != null && running && data.getTelemetryAt(selected, playback.time, tel);
          engine.update(s.engine && running, playback.speed, telOk ? tel : null);
        }
      }
      rain.update(dt, raining, !passthrough);
      flagFx.update(dt, passthrough ? null : (debugFlag ?? flagColour), world.getRoomAccent(), rimMat);
      banner3d.update();
      radioPop.update();
    },
    dispose() {
      rain.dispose();
      banner3d.dispose();
      radioPop.dispose();
      engine.dispose();
    },
  };
}
