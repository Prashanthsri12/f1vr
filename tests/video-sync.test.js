// Video drives the timing (8.8: Playback external clock, video/replay time mapping) and the
// manual sync controls (8.9: per-session offset store, lights out, lap steps, nudge).
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { Playback } = await import('../js/playback.js');
const { loadSyncOffset, saveSyncOffset, lapStepTarget, createSyncControl, SYNC_KEY } = await import('../js/sync-control.js');
const { fmtOffset } = await import('../js/panels/playback-bar.js').catch(() => ({ fmtOffset: null }));

const START = 1_000_000;
const RACE = START + 600_000;
function fakeData(over = {}) {
  return {
    session: { key: 9472 },
    dataStartTime: START,
    raceStartTime: RACE,
    dataEndTime: START + 3_600_000,
    totalLaps: 57,
    ready: true,
    isReady(t) { return typeof this.ready === 'function' ? this.ready(t) : this.ready; },
    setPlayhead() {},
    getLapStartTime(n) { return RACE + (n - 1) * 90_000; },
    getLeaderLapAt(t) { return t < RACE ? 0 : Math.min(57, 1 + Math.floor((t - RACE) / 90_000)); },
    ...over,
  };
}

/** A fake video clock: offsetSec = video time at the race start. */
function fakeClock(offsetSec = 30) {
  const c = {
    maxRate: 2, offsetSec, currentTime: 0, rate: 1, paused: true, log: [],
    get playing() { return !this.paused; },
    now() { return RACE + (this.currentTime - this.offsetSec) * 1000; },
    play() { this.paused = false; this.log.push('play'); },
    pause() { this.paused = true; this.log.push('pause'); },
    seek(t) { this.currentTime = this.offsetSec + (t - RACE) / 1000; this.log.push('seek'); },
    setRate(r) { this.rate = r; },
    shift(sec) { this.offsetSec -= sec; },
  };
  return c;
}

test('attaching a clock hands over: same time, rate and play state', () => {
  const p = new Playback(fakeData());
  p.seek(RACE + 10_000);
  p.play();
  const c = fakeClock();
  p.setClock(c);
  assert.equal(p.clockActive, true);
  assert.equal(c.currentTime, 40);       // 30 s offset + 10 s into the race
  assert.equal(c.paused, false);
  assert.equal(c.rate, 1);
});

test('the video drives the playhead: scrub, pause and play follow it', () => {
  const p = new Playback(fakeData());
  const c = fakeClock();
  p.setClock(c);
  c.currentTime = 90; c.paused = false;  // user scrubs and plays the video
  p.update(0.016);
  assert.equal(p.time, RACE + 60_000);
  assert.equal(p.playing, true);
  c.paused = true;                       // user pauses the video
  p.update(0.016);
  assert.equal(p.playing, false);
  c.currentTime = 20;                    // before the race start: replay before lights out
  p.update(0.016);
  assert.equal(p.time, RACE - 10_000);
});

test('replay controls act on the video while it leads', () => {
  const p = new Playback(fakeData());
  const c = fakeClock();
  p.setClock(c);
  p.play();
  assert.equal(c.paused, false);
  p.seek(RACE + 120_000);
  assert.equal(c.currentTime, 150);
  p.setSpeed(2);
  assert.equal(c.rate, 2);
  p.pause();
  assert.equal(c.paused, true);
  assert.equal(p.playing, false);
});

test('faster than 2x: the video pauses and the replay runs on its own; back to 1x resumes the video at the replay time', () => {
  const p = new Playback(fakeData());
  const c = fakeClock();
  p.setClock(c);
  p.seek(RACE);
  p.play();
  p.setSpeed(5);
  assert.equal(p.clockActive, false);
  assert.equal(c.paused, true);
  assert.equal(p.playing, true);
  p.update(2);                           // 2 s at 5x = 10 s of replay
  assert.equal(p.time, RACE + 10_000);
  p.setSpeed(1);
  assert.equal(p.clockActive, true);
  assert.equal(c.currentTime, 40);
  assert.equal(c.paused, false);
});

test('data not loaded: the video is held, then resumed when it is', () => {
  const d = fakeData();
  let loaded = false;
  d.ready = () => loaded;
  const p = new Playback(d);
  const c = fakeClock();
  p.setClock(c);
  c.paused = false; c.currentTime = 60;
  p.update(0.016);
  assert.equal(c.paused, true);
  assert.equal(p.waiting, true);
  assert.equal(p.playing, true);          // held, not paused by the user
  assert.equal(p.time, RACE + 30_000);    // the loader is asked for the video's time
  loaded = true;
  p.update(0.016);
  assert.equal(c.paused, false);
  assert.equal(p.waiting, false);
});

test('detaching keeps the replay where it is and playing', () => {
  const p = new Playback(fakeData());
  const c = fakeClock();
  p.setClock(c);
  c.paused = false; c.currentTime = 60;
  p.update(0.016);
  p.setClock(null);
  assert.equal(p.clockActive, false);
  assert.equal(p.playing, true);
  p.update(1);
  assert.equal(p.time, RACE + 31_000);
});

test('per-session offset store', () => {
  store.clear();
  assert.equal(loadSyncOffset(1), 0);
  saveSyncOffset(1, 2500);
  saveSyncOffset(2, -1000);
  assert.equal(loadSyncOffset(1), 2500);
  assert.equal(loadSyncOffset(2), -1000);
  saveSyncOffset(1, 0);
  assert.deepEqual(JSON.parse(store.get(SYNC_KEY)), { 2: -1000 });
  store.set(SYNC_KEY, 'not json');
  assert.equal(loadSyncOffset(2), 0);
});

test('lap step targets', () => {
  assert.equal(lapStepTarget(0, NaN, RACE - 5000, 1, 57), 1);
  assert.equal(lapStepTarget(10, RACE, RACE + 20_000, -1, 57), 10);  // well into the lap: its start
  assert.equal(lapStepTarget(10, RACE, RACE + 1000, -1, 57), 9);     // just started: the lap before
  assert.equal(lapStepTarget(57, RACE, RACE + 1000, 1, 57), 57);
  assert.equal(lapStepTarget(1, RACE, RACE + 500, -1, 57), 1);
});

test('nudge without a video moves the replay and is saved per session; lights out uses it', () => {
  store.clear();
  const d = fakeData();
  const p = new Playback(d);
  const s = createSyncControl({ data: d, playback: p });
  s.lightsOut();
  assert.equal(p.time, RACE);
  s.nudge(1); s.nudge(1); s.nudge(-5);
  assert.equal(s.offsetMs, -3000);
  assert.equal(p.time, RACE - 3000);
  assert.equal(loadSyncOffset(9472), -3000);
  p.seek(RACE + 500_000);
  s.lightsOut();
  assert.equal(p.time, RACE - 3000);
  // a new control for the same session picks the saved offset up
  assert.equal(createSyncControl({ data: d, playback: p }).offsetMs, -3000);
});

test('nudge while a video leads shifts the video sync point, not the session offset', () => {
  store.clear();
  const d = fakeData();
  const p = new Playback(d);
  const s = createSyncControl({ data: d, playback: p });
  const c = fakeClock(30);
  p.setClock(c);
  c.currentTime = 60;
  p.update(0.016);
  assert.equal(s.videoLeads, true);
  s.nudge(2);
  assert.equal(c.offsetSec, 28);
  assert.equal(s.offsetMs, 0);
  p.update(0.016);
  assert.equal(p.time, RACE + 32_000);    // the replay moved 2 s later against the picture
  s.lightsOut();                          // video leads: lights out = the data's race start
  assert.equal(p.time, RACE);
  assert.equal(c.currentTime, 28);
});

test('offset label', { skip: fmtOffset ? false : 'playback-bar.js needs three' }, () => {
  assert.equal(fmtOffset(0), '0.0 s');
  assert.equal(fmtOffset(1500), '+1.5 s');
  assert.equal(fmtOffset(-2000), '−2.0 s');
});
