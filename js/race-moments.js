// Race moments for the banners (9.11). Pure (no three.js, no DOM), unit-tested in
// tests/race-moments.test.js.
//
// Precomputed from the data once:
//   start     - lights out (race / sprint)
//   status    - track status changes from race-status.js: SC, VSC, red flag, chequered flag,
//               and "track clear" when SC / VSC / red ends
//   fastest   - the session fastest lap improves (not the first lap time)
//   pit       - a pit stop ends (pit.date is the lane exit), with stop_duration if present
// Detected while playing (5 Hz):
//   overtake  - a clean swap: A moves up one place and the car that held it moves down into
//               A's old place, neither car in or just out of the pit lane, track green or yellow, lap 2+
//   retire    - a driver turns OUT on the leaderboard (race only)
// Shown only when they matter: pit stops and overtakes for the selected driver or the top 3,
// fastest laps for everyone in races and only the selected driver otherwise.
// Like audio-events.js, a seek (or playing backwards / too fast to explain) re-arms silently.
import { trackStatusAt } from './panels/race-status.js';
import { indexAtOrBefore } from './interp.js';

const TICK_MS = 200;
const MAX_RATE = 10.5;          // session ms per real ms
const JUMP_SLACK = 1500;
const PIT_RECENT_MS = 40000;  // a car that left the pits this recently is still shuffling places
const PIT_AHEAD_MS = 35000;   // pit.date is the lane exit: a car entering the lane drops places ~25 s before it
const SWAP_LOOKBACK_MS = 2500;  // compare positions with this long ago (the two cars' records can land apart)
const REPEAT_MS = 15000;        // the same pass is not announced twice within this
const PRIORITY = { red: 9, sc: 8, vsc: 8, chequered: 8, clear: 7, start: 7, retire: 6, pit: 5, overtake: 4, fastest: 3 };

const ms = (d) => (typeof d === 'number' ? d : Date.parse(d));

function fmtLap(sec) {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
}

/**
 * Timeline of precomputed moments, time-sorted.
 * @param {object} data SessionData
 * @returns {Array<{t: number, kind: string, title: string, sub: string, driver?: number, posBefore?: number}>}
 */
export function buildMoments(data) {
  const out = [];
  const acr = (n) => data.driverByNumber.get(n)?.acronym || `#${n}`;
  const race = !!data.hasIntervals;
  if (race && Number.isFinite(data.raceStartTime)) {
    out.push({ t: data.raceStartTime, kind: 'start', title: 'Lights out', sub: 'And away we go' });
  }
  // Track status changes.
  const rc = (data.getRaceControlAt(Infinity, Infinity) || []).slice().reverse(); // oldest first
  let prev = 'GREEN';
  for (const m of rc) {
    const t = ms(m.date);
    const s = trackStatusAt(data, t).status;
    if (s === prev) continue;
    if (s === 'SC') out.push({ t, kind: 'sc', title: 'Safety car', sub: 'Deployed' });
    else if (s === 'VSC') out.push({ t, kind: 'vsc', title: 'Virtual safety car', sub: 'Deployed' });
    else if (s === 'RED') out.push({ t, kind: 'red', title: 'Red flag', sub: 'Session suspended' });
    else if (s === 'CHEQUERED') {
      const winner = data.drivers.find((d) => data.getPositionAt(d.number, t + 60000) === 1);
      out.push({ t, kind: 'chequered', title: 'Chequered flag', sub: race && winner ? `${acr(winner.number)} wins` : 'Session over' });
    } else if (s === 'GREEN' && (prev === 'SC' || prev === 'VSC' || prev === 'RED')) {
      out.push({ t, kind: 'clear', title: 'Track clear', sub: 'Green flag · racing resumes' });
    }
    prev = s;
  }
  // Fastest lap improvements (after the first lap time of the session).
  const laps = [];
  for (const d of data.drivers) {
    for (const l of data.getDriverLaps(d.number)) {
      if (l.date_end != null && Number.isFinite(l.lap_duration) && l.lap_duration > 0) laps.push(l);
    }
  }
  laps.sort((a, b) => a.date_end - b.date_end);
  let best = Infinity;
  for (const l of laps) {
    if (l.lap_duration < best) {
      if (best !== Infinity) {
        out.push({ t: l.date_end, kind: 'fastest', title: 'Fastest lap', sub: `${acr(l.driver_number)} · ${fmtLap(l.lap_duration)}`, driver: l.driver_number });
      }
      best = l.lap_duration;
    }
  }
  // Pit stops (race only).
  if (race) {
    for (const p of data.getPitStops ? data.getPitStops() : []) {
      const exit = ms(p.date);
      const lane = Number.isFinite(p.lane_duration) ? p.lane_duration : p.pit_duration;
      if (!Number.isFinite(exit) || !Number.isFinite(lane)) continue;
      const stop = Number.isFinite(p.stop_duration) ? `${p.stop_duration.toFixed(1)} s stop` : `${lane.toFixed(1)} s in the lane`;
      out.push({
        t: exit, kind: 'pit', title: 'Pit stop', sub: `${acr(p.driver_number)} · ${stop}`,
        driver: p.driver_number, posBefore: data.getPositionAt(p.driver_number, exit - lane * 1000 - 1000),
      });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Should this moment show, given the selected driver? */
export function shouldShow(ev, selected, race) {
  if (ev.kind === 'pit') return ev.driver === selected || (ev.posBefore != null && ev.posBefore <= 3);
  if (ev.kind === 'fastest') return race || ev.driver === selected;
  if (ev.kind === 'overtake') return ev.driver === selected || ev.other === selected || ev.pos <= 3;
  return true;
}

/**
 * @param {object} data SessionData
 * @param {{now?: () => number}} [o]
 * @returns {{update: (time: number, selected: number|null, playing: boolean) => object|null, moments: object[]}}
 */
export function createRaceMoments(data, { now = () => performance.now() } = {}) {
  const moments = buildMoments(data);
  const times = Float64Array.from(moments.map((m) => m.t));
  const race = !!data.hasIntervals;
  const acr = (n) => data.driverByNumber.get(n)?.acronym || `#${n}`;
  const pitExits = new Map(); // driver -> sorted exit times
  for (const p of data.getPitStops ? data.getPitStops() : []) {
    const list = pitExits.get(p.driver_number) || [];
    list.push(ms(p.date));
    pitExits.set(p.driver_number, list);
  }
  for (const l of pitExits.values()) l.sort((a, b) => a - b);
  const pittedRecently = (n, t) => {
    const l = pitExits.get(n);
    if (!l) return false;
    for (const e of l) if (e <= t + PIT_AHEAD_MS && e >= t - PIT_RECENT_MS) return true;
    return false;
  };

  let armed = false, lastTime = 0, lastNow = 0, armedAt = 0;
  const out = new Set();      // drivers already OUT
  const announced = new Map(); // "a>b@p" -> time announced
  let tick = 0;

  function snapshot(t) {
    if (race) {
      out.clear();
      for (const r of data.getLeaderboardAt(t)) if (r.retired) out.add(r.driverNumber);
    }
  }

  function reset(time, wall) {
    armed = true; lastTime = time; lastNow = wall; armedAt = time;
    announced.clear();
    snapshot(time);
  }

  /** Detect overtakes and retirements since the last snapshot; returns the best one or null. */
  function detect(t) {
    let found = null;
    if (race && t > data.raceStartTime + 60000 && data.getLeaderLapAt(t) >= 2) {
      const st = trackStatusAt(data, t).status;
      // Not right after a seek: the look-back would announce a pass from before it.
      if ((st === 'GREEN' || st === 'YELLOW') && t - armedAt >= SWAP_LOOKBACK_MS) {
        const back = t - SWAP_LOOKBACK_MS;
        for (const d of data.drivers) {
          const a = d.number;
          const was = data.getPositionAt(a, back);
          const nowP = data.getPositionAt(a, t);
          if (was == null || nowP == null || was - nowP !== 1) continue;
          const bd = data.drivers.find((x) => x.number !== a && data.getPositionAt(x.number, back) === nowP);
          const b = bd ? bd.number : null;
          if (b == null || data.getPositionAt(b, t) !== was) continue;
          if (pittedRecently(a, t) || pittedRecently(b, t)) continue;
          const key = `${a}>${b}@${nowP}`;
          const seen = announced.get(key);
          if (seen != null && Math.abs(t - seen) < REPEAT_MS) continue;
          announced.set(key, t);
          const ev = { t, kind: 'overtake', title: 'Overtake', sub: `${acr(a)} passes ${acr(b)} for P${nowP}`, driver: a, other: b, pos: nowP };
          if (!found || nowP < found.pos) found = ev;
        }
      }
      if (++tick % 5 === 0) { // retirements at 1 Hz (the leaderboard query allocates)
        for (const r of data.getLeaderboardAt(t)) {
          if (r.retired && !out.has(r.driverNumber)) {
            out.add(r.driverNumber);
            if (t > data.raceStartTime + 30000) found = { t, kind: 'retire', title: 'Out of the race', sub: `${acr(r.driverNumber)} retires`, driver: r.driverNumber };
          }
        }
      }
    }
    return found;
  }

  function update(time, selected, playing) {
    const wall = now();
    if (armed && wall - lastNow < TICK_MS) return null;
    if (!armed || !playing) { reset(time, wall); return null; }
    const dt = time - lastTime;
    const real = Math.max(1, wall - lastNow);
    if (dt < 0 || dt > MAX_RATE * real + JUMP_SLACK) { reset(time, wall); return null; }
    let best = null;
    const from = indexAtOrBefore(times, lastTime) + 1;
    const to = indexAtOrBefore(times, time);
    for (let i = from; i <= to; i++) {
      const ev = moments[i];
      if (!shouldShow(ev, selected, race)) continue;
      if (!best || PRIORITY[ev.kind] >= PRIORITY[best.kind]) best = ev;
    }
    const live = detect(time);
    if (live && shouldShow(live, selected, race) && (!best || PRIORITY[live.kind] > PRIORITY[best.kind])) best = live;
    lastTime = time; lastNow = wall;
    return best;
  }

  return { update, moments };
}
