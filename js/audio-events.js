// Playback-driven audio (4b.15, 4b.16): autoplays the selected driver's team radio when
// the playhead passes a clip (11.1: or every driver's, with the radioAll setting), and plays
// short effects:
//   chime  - a new race control message
//   whoosh - the selected driver's position changes (an overtake involving them)
//   beep   - the session's fastest lap improves (not the first lap time of the session)
// Events fire only while playing forward at a normal rate. A seek (any jump of the
// playhead) re-arms the state silently, so there is never a burst after seeking.
// update() is cheap per frame: it does real work at TICK_HZ and allocates only when
// the selected driver or the radio mode changes.
// All radio (11.1): clips crossed while another clip still plays wait in a short queue, so
// a conversation is not cut off; a queued clip is dropped once the playhead is more than
// QUEUE_MAX_AGE past it. onRadio(clip) fires for every clip that starts (for the pop-up).
import { playRadio as defaultPlayRadio, playSfx as defaultPlaySfx, getRadioState } from './audio.js';
import { getSettings as defaultGetSettings } from './settings.js';
import { indexAtOrBefore } from './interp.js';

const TICK_MS = 100;           // real ms between checks (10 Hz)
const POSITION_EVERY = 2;      // check positions every 2nd tick (5 Hz)
const RADIO_MAX_RATE = 2.5;    // session ms per real ms: autoplay radio at ≤2x only (slack for frame jitter)
const RADIO_MAX_AGE = 3000;    // ms: don't start a clip that began longer ago than this
const SFX_MAX_RATE = 10.5;     // effects up to 10x
const JUMP_SLACK = 1500;       // ms of session time beyond rate × real time that counts as a seek
const QUEUE_MAX_AGE = 20000;   // ms of session time a queued clip may wait (all radio)
const QUEUE_MAX = 4;

/** Number of entries in sorted `times` that are <= t. */
function countUpTo(times, t) {
  return indexAtOrBefore(times, t) + 1;
}

/**
 * @param {import('./session-data.js').SessionData} data
 * @param {object} [o] injectable sink and clock (tests)
 * @param {(url: string) => void} [o.playRadio]
 * @param {(name: 'chime'|'whoosh'|'beep') => void} [o.playSfx]
 * @param {() => {radio: boolean, radioAll?: boolean, sfx: boolean}} [o.getSettings]
 * @param {() => number} [o.now] real-time clock in ms
 * @param {() => boolean} [o.isRadioBusy] a clip is loaded or playing
 * @param {(clip: object) => void} [o.onRadio] a clip started (driver_number, date, recording_url)
 * @returns {{update: (time: number, selected: number|null, playing: boolean) => void, dispose: () => void}}
 */
export function createAudioEvents(data, {
  playRadio = defaultPlayRadio,
  playSfx = defaultPlaySfx,
  getSettings = defaultGetSettings,
  now = () => performance.now(),
  isRadioBusy = () => getRadioState().url != null,
  onRadio = () => {},
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

  // Clips that can autoplay: the selected driver's, or every driver's (rebuilt on change).
  let radioKey;           // driver number, null, or 'all'
  let clips = [];
  let clipTimes = new Float64Array(0);
  let allClips = null;    // every driver's clips by time, built once
  const queue = [];       // all radio: clips waiting for the current one to finish

  let armed = false;      // false until the first tick after a reset
  let lastTime = 0;
  let lastNow = 0;
  let lastPos = null;
  let tick = 0;

  function selectRadio(key) {
    radioKey = key;
    if (key === 'all') {
      if (!allClips) {
        allClips = [];
        for (const d of data.drivers) allClips.push(...data.getTeamRadioUpTo(d.number, Infinity));
        allClips.sort((a, b) => a.date - b.date);
      }
      clips = allClips;
    } else {
      clips = key == null ? [] : data.getTeamRadioUpTo(key, Infinity);
    }
    clipTimes = new Float64Array(clips.length);
    for (let i = 0; i < clips.length; i++) clipTimes[i] = clips[i].date;
  }

  function start(clip) {
    playRadio(clip.recording_url);
    onRadio(clip);
  }

  function reset(time, wall, selected) {
    armed = true;
    queue.length = 0;
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
    const s = getSettings();
    const key = s.radioAll ? 'all' : selected;
    if (key !== radioKey) {
      selectRadio(key);
      reset(time, wall, selected);
      return;
    }
    if (!armed || !playing) { reset(time, wall, selected); return; }

    const dt = time - lastTime;
    const real = Math.max(1, wall - lastNow);
    const rate = dt / real;
    // Backwards, or further than the fastest speed can explain: a seek. Re-arm silently.
    if (dt < 0 || dt > SFX_MAX_RATE * real + JUMP_SLACK) { reset(time, wall, selected); return; }

    if (dt > 0) {
      if (s.radio && rate <= RADIO_MAX_RATE) {
        const before = countUpTo(clipTimes, lastTime);
        const after = countUpTo(clipTimes, time);
        if (key === 'all') {
          // Every clip crossed joins the queue; the next one starts when the radio is free.
          for (let i = before; i < after; i++) {
            const c = clips[i];
            if (c.recording_url && time - c.date <= RADIO_MAX_AGE && queue.length < QUEUE_MAX) queue.push(c);
          }
          while (queue.length && time - queue[0].date > QUEUE_MAX_AGE) queue.shift();
          if (queue.length && !isRadioBusy()) start(queue.shift());
        } else if (after > before) {
          // Selected driver: the newest clip crossed since the last tick.
          const clip = clips[after - 1];
          if (time - clip.date <= RADIO_MAX_AGE && clip.recording_url) start(clip);
        }
      } else queue.length = 0;
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
    dispose() { clips = []; allClips = null; queue.length = 0; },
  };
}
