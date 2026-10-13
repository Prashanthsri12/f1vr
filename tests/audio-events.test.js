// audio-events.js: radio autoplay and sound effect triggers (pure logic, injected sink + clock).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAudioEvents } from '../js/audio-events.js';

const T0 = Date.UTC(2024, 2, 2, 15, 10, 0);
const S = 1000;

/** Minimal SessionData stand-in. */
function fakeData({ radio = [], rc = [], laps = {}, positions = {} } = {}) {
  const sortedRc = [...rc].sort((a, b) => a.date - b.date);
  return {
    drivers: [{ number: 1 }, { number: 16 }],
    getRaceControlAt(t, n = 5) {
      const out = [];
      for (let i = sortedRc.length - 1; i >= 0 && out.length < n; i--) if (sortedRc[i].date <= t) out.push(sortedRc[i]);
      return out;
    },
    getTeamRadioUpTo(n, t) { return radio.filter((r) => r.driver_number === n && r.date <= t).sort((a, b) => a.date - b.date); },
    getDriverLaps(n) { return laps[n] || []; },
    getPositionAt(n, t) {
      const p = (positions[n] || []).filter((r) => r.date <= t);
      return p.length ? p[p.length - 1].position : null;
    },
  };
}

/** Drives update() in 100 ms real-time ticks at a playback rate. */
function rig(data, settings = { radio: true, sfx: true }) {
  const log = [];
  let wall = 0;
  const ev = createAudioEvents(data, {
    playRadio: (url) => log.push(`radio:${url}`),
    playSfx: (name) => log.push(name),
    getSettings: () => settings,
    now: () => wall,
  });
  const st = { time: T0, selected: 1, playing: true };
  return {
    log,
    st,
    ev,
    /** Run `seconds` of real time at `rate` (session s per real s). */
    run(seconds, rate = 1) {
      for (let i = 0; i < seconds * 10; i++) {
        wall += 100;
        if (st.playing) st.time += 100 * rate;
        ev.update(st.time, st.selected, st.playing);
      }
    },
    seek(ms) { st.time += ms; },
  };
}

const clip = (n, at, name) => ({ driver_number: n, date: T0 + at, recording_url: `https://x/${name}.mp3` });

test('radio: autoplays the selected driver\'s clip when the playhead passes it at 1x', () => {
  const r = rig(fakeData({ radio: [clip(1, 5 * S, 'a'), clip(16, 6 * S, 'other')] }));
  r.run(10);
  assert.deepEqual(r.log, ['radio:https://x/a.mp3']);
});

test('radio: off setting, high speed and pause all skip autoplay', () => {
  const d = fakeData({ radio: [clip(1, 5 * S, 'a'), clip(1, 60 * S, 'b')] });
  const off = rig(d, { radio: false, sfx: true });
  off.run(10);
  assert.deepEqual(off.log, []);
  const fast = rig(d);
  fast.run(10, 5);  // 50 s of session at 5x crosses clip a
  assert.deepEqual(fast.log, []);
  const paused = rig(d);
  paused.run(1);
  paused.st.playing = false;
  paused.run(2);
  paused.seek(4 * S);          // move past the clip while paused
  paused.run(1);
  paused.st.playing = true;
  paused.run(2);
  assert.deepEqual(paused.log, []);
});

test('radio: a seek past clips does not play them; later clips still autoplay', () => {
  const r = rig(fakeData({ radio: [clip(1, 20 * S, 'a'), clip(1, 25 * S, 'b'), clip(1, 70 * S, 'c')] }));
  r.run(1);
  r.seek(60 * S);
  r.run(15);                   // reaches 76 s
  assert.deepEqual(r.log, ['radio:https://x/c.mp3']);
});

test('radio: changing the selected driver re-arms silently', () => {
  const r = rig(fakeData({ radio: [clip(16, 3 * S, 'lec')] }));
  r.run(5);                    // driver 1 selected: nothing
  r.st.selected = 16;          // 16's clip is 2 s in the past now
  r.run(3);
  assert.deepEqual(r.log, []);
});

test('chime on a new race control message, none for messages skipped by a seek', () => {
  const rc = [{ date: T0 + 3 * S }, { date: T0 + 40 * S }, { date: T0 + 45 * S }, { date: T0 + 80 * S }];
  const r = rig(fakeData({ rc }));
  r.run(5);                    // crosses 3 s
  r.seek(42 * S);              // jumps over 40 s
  r.run(5);                    // crosses 45 s?  time 47 s -> 52 s: no
  r.run(30);                   // 52 s -> 82 s crosses 80 s
  assert.deepEqual(r.log, ['chime', 'chime']);
});

test('beep when the session fastest lap improves, not on the first lap time', () => {
  const lap = (end, dur) => ({ date_end: T0 + end * S, lap_duration: dur });
  const laps = { 1: [lap(2, 95), lap(6, 93)], 16: [lap(4, 96), lap(8, 92.5)] };
  const r = rig(fakeData({ laps }), { radio: true, sfx: true });
  r.run(10);
  assert.deepEqual(r.log, ['beep', 'beep']); // 6 s (93 < 95) and 8 s (92.5 < 93); 4 s (96) is slower
});

test('whoosh when the selected driver changes position; no sounds when sfx is off', () => {
  const positions = { 1: [{ date: T0 - 10 * S, position: 2 }, { date: T0 + 3 * S, position: 1 }], 16: [] };
  const r = rig(fakeData({ positions }));
  r.run(5);
  assert.deepEqual(r.log, ['whoosh']);
  const quiet = rig(fakeData({ positions, rc: [{ date: T0 + 2 * S }] }), { radio: true, sfx: false });
  quiet.run(5);
  assert.deepEqual(quiet.log, []);
});

test('sound effects still fire at 10x, but a jump beyond 10x counts as a seek', () => {
  const rc = [{ date: T0 + 30 * S }, { date: T0 + 300 * S }];
  const r = rig(fakeData({ rc }));
  r.run(4, 10);                // 40 s at 10x crosses 30 s
  assert.deepEqual(r.log, ['chime']);
  r.run(2, 200);               // too fast: treated as seeking
  assert.deepEqual(r.log, ['chime']);
});
