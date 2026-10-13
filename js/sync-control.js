// Manual sync with a broadcast in another window (8.9): "Go to lights out", lap steps and a
// ± nudge. Pure module (no DOM beyond localStorage, no three.js): the playback bar calls it
// in VR and on the desktop through ctx.actions.
//
// The nudge is a per-session offset (ms, saved on this device): it corrects the data's race
// start (lap 1) against the lights-out moment the user sees. Without a leading video a
// nudge also moves the replay by that much right away, and "Go to lights out" goes to
// race start + offset. While a synced video drives the timing (8.8) the nudge shifts the
// video's sync point instead (clock.shift), so the picture stays and the replay moves.

export const SYNC_KEY = 'f1vr.sync.v1';
export const MAX_OFFSET_MS = 10 * 60 * 1000;
const LAP_BACK_MS = 3000; // "previous lap" within 3 s of a lap's start goes to the lap before

function readAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(SYNC_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}

/** @returns {number} the saved offset (ms) for a session, 0 when none */
export function loadSyncOffset(sessionKey) {
  if (sessionKey == null) return 0;
  const v = readAll()[sessionKey];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, v)) : 0;
}

/** Save (or with 0, forget) a session's offset (ms). */
export function saveSyncOffset(sessionKey, ms) {
  if (sessionKey == null) return;
  const all = readAll();
  if (!ms) delete all[sessionKey]; else all[sessionKey] = Math.round(ms);
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(all)); } catch { /* no storage */ }
}

/**
 * Lap to jump to for a lap step from time t.
 * @param {number} lap the leader's current lap (0 before the start)
 * @param {number} lapStart start time of that lap (NaN/null if unknown)
 * @param {number} t playhead
 * @param {-1|1} dir
 * @param {number} totalLaps
 * @returns {number} lap number (1..totalLaps)
 */
export function lapStepTarget(lap, lapStart, t, dir, totalLaps) {
  const total = Math.max(1, totalLaps || 1);
  if (dir > 0) return Math.min(total, Math.max(1, lap + 1));
  if (lap < 1) return 1;
  const intoLap = Number.isFinite(lapStart) ? t - lapStart : 0;
  return intoLap > LAP_BACK_MS ? lap : Math.max(1, lap - 1);
}

/**
 * @param {object} o
 * @param {{session?: {key?: number}, raceStartTime: number, totalLaps: number,
 *   getLeaderLapAt: (t: number) => number, getLapStartTime: (n: number) => number}} o.data
 * @param {import('./playback.js').Playback} o.playback
 * @returns {{offsetMs: number, readonly videoLeads: boolean, lightsOut: () => void,
 *   stepLap: (dir: -1|1) => void, nudge: (sec: number) => void}}
 */
export function createSyncControl({ data, playback }) {
  const key = data.session ? data.session.key : null;
  const ctl = {
    offsetMs: loadSyncOffset(key),
    /** A synced video drives the timing (the nudge moves its sync point instead). */
    get videoLeads() {
      return playback.clockActive && !!playback.clock.shift;
    },
    /** Lights out: the data's race start, corrected by this session's offset. */
    lightsOut() {
      playback.seek(data.raceStartTime + (ctl.videoLeads ? 0 : ctl.offsetMs));
    },
    /** Previous / next lap (the leader's laps). */
    stepLap(dir) {
      const t = playback.time;
      const lap = data.getLeaderLapAt(t) || 0;
      const start = lap > 0 ? data.getLapStartTime(lap) : NaN;
      playback.seekToLap(lapStepTarget(lap, start, t, dir, data.totalLaps));
    },
    /** Move the replay sec seconds later (negative = earlier) relative to what you watch. */
    nudge(sec) {
      if (!Number.isFinite(sec) || !sec) return;
      if (ctl.videoLeads) { playback.clock.shift(sec); return; }
      ctl.offsetMs = Math.max(-MAX_OFFSET_MS, Math.min(MAX_OFFSET_MS, ctl.offsetMs + sec * 1000));
      saveSyncOffset(key, ctl.offsetMs);
      playback.seekBy(sec);
    },
  };
  return ctl;
}
