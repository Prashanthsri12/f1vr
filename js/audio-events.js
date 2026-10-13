// Playback-driven audio (4b.15, 4b.16): autoplays the selected driver's team radio when
// the playhead passes a clip, and plays short effects:
//   chime  - a new race control message
//   whoosh - the selected driver's position changes (an overtake involving them)
//   beep   - the session's fastest lap improves (not the first lap time of the session)
// Events fire only while playing forward at a normal rate. A seek (any jump of the
// playhead) re-arms the state silently, so there is never a burst after seeking.
// update() is cheap per frame: it does real work at TICK_HZ and allocates only when
// the selected driver changes.
import { playRadio as defaultPlayRadio, playSfx as defaultPlaySfx } from './audio.js';
import { getSettings as defaultGetSettings } from './settings.js';
import { indexAtOrBefore } from './interp.js';

const TICK_MS = 100;           // real ms between checks (10 Hz)
const POSITION_EVERY = 2;      // check positions every 2nd tick (5 Hz)
const RADIO_MAX_RATE = 2.5;    // session ms per real ms: autoplay radio at ≤2x only
const RADIO_MAX_AGE = 3000;    // ms: don't start a clip that began longer ago than this
const SFX_MAX_RATE = 10.5;     // effects up to 10x
const JUMP_SLACK = 1500;       // ms of session time beyond rate × real time that counts as a seek

/** Number of entries in sorted `times` that are <= t. */
function countUpTo(times, t) {
  return indexAtOrBefore(times, t) + 1;
}

/**
 * @param {import('./session-data.js').SessionData} data
 * @param {object} [o] injectable sink and clock (tests)
 * @param {(url: string) => void} [o.playRadio]
 * @param {(name: 'chime'|'whoosh'|'beep') => void} [o.playSfx]
 * @param {() => {radio: boolean, sfx: boolean}} [o.getSettings]
 * @param {() => number} [o.now] real-time clock in ms
 * @returns {{update: (time: number, selected: number|null, playing: boolean) => void, dispose: () => void}}
 */
export function createAudioEvents(data, {
  playRadio = defaultPlayRadio,
  playSfx = defaultPlaySfx,
  getSettings = defaultGetSettings,
  now = () => performance.now(),
} = {}) {
  // Race control message times, ascending.
  const rc = data.getRaceControlAt(Infinity, Infinity);
  const rcTimes = new Float64Array(rc.length);
  for (let i = 0; i < rc.length; i++) rcTimes[i] = rc[rc.length - 1 - i].date;

  // Moments the session fastest lap improved (lap end times, ascending), skipping the first lap time.
  const laps = [];
  for (const d of data.drivers) {
    for (const l of data.getDriverLaps(d.number)) {
      if (l.date_end != null && Number.isFinite(l.lap_duration) && l.lap_duration > 0) laps.push(l);
    }
  }
  laps.sort((a, b) => a.date_end - b.date_end);
  const fastest = [];
  let best = Infinity;
  for (const l of laps) {
    if (l.lap_duration < best) {
      if (best !== Infinity) fastest.push(l.date_end);
      best = l.lap_duration;
    }
  }
  const fastestTimes = Float64Array.from(fastest);

  // Selected driver's clips (rebuilt when the selection changes).
  let radioDriver = null;
  let clips = [];
  let clipTimes = new Float64Array(0);

  let armed = false;      // false until the first tick after a reset
  let lastTime = 0;
  let lastNow = 0;
  let lastPos = null;
  let tick = 0;

  function selectRadio(n) {
    radioDriver = n;
    clips = n == null ? [] : data.getTeamRadioUpTo(n, Infinity);
    clipTimes = new Float64Array(clips.length);
    for (let i = 0; i < clips.length; i++) clipTimes[i] = clips[i].date;
  }

  function reset(time, wall, selected) {
    armed = true;
    lastTime = time;
    lastNow = wall;
    lastPos = selected == null ? null : data.getPositionAt(selected, time);
  }

  /**
   * @param {number} time playhead (UTC ms)
   * @param {number|null} selected driver number
   * @param {boolean} playing playback is running (not paused)
   */
  function update(time, selected, playing) {
    const wall = now();
    if (armed && wall - lastNow < TICK_MS) return;
    if (selected !== radioDriver) {
      selectRadio(selected);
      reset(time, wall, selected);
      return;
    }
    if (!armed || !playing) { reset(time, wall, selected); return; }

    const dt = time - lastTime;
    const real = Math.max(1, wall - lastNow);
    const rate = dt / real;
    // Backwards, or further than the fastest speed can explain: a seek. Re-arm silently.
    if (dt < 0 || dt > SFX_MAX_RATE * real + JUMP_SLACK) { reset(time, wall, selected); return; }

    const s = getSettings();
    if (dt > 0) {
      // Team radio: the newest clip crossed since the last tick.
      if (s.radio && rate <= RADIO_MAX_RATE) {
        const before = countUpTo(clipTimes, lastTime);
        const after = countUpTo(clipTimes, time);
        if (after > before) {
          const clip = clips[after - 1];
          if (time - clip.date <= RADIO_MAX_AGE && clip.recording_url) playRadio(clip.recording_url);
        }
      }
      if (s.sfx) {
        if (countUpTo(rcTimes, time) > countUpTo(rcTimes, lastTime)) playSfx('chime');
        if (countUpTo(fastestTimes, time) > countUpTo(fastestTimes, lastTime)) playSfx('beep');
      }
    }
    if (++tick % POSITION_EVERY === 0 && selected != null) {
      const pos = data.getPositionAt(selected, time);
      if (s.sfx && pos != null && lastPos != null && pos !== lastPos) playSfx('whoosh');
      if (pos != null) lastPos = pos;
    }
    lastTime = time;
    lastNow = wall;
  }

  return {
    update,
    dispose() { clips = []; },
  };
}
