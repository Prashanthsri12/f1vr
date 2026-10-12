import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Playback, SPEEDS } from '../js/playback.js';

const START = 1_000_000;
function fakeData(over = {}) {
  return {
    dataStartTime: START,
    raceStartTime: START + 600_000,
    dataEndTime: START + 3_600_000,
    ready: true,
    calls: [],
    isReady(t) { return typeof this.ready === 'function' ? this.ready(t) : this.ready; },
    setPlayhead(t, s) { this.calls.push([t, s]); },
    getLapStartTime(n) { return n === 3 ? START + 900_000 : (n === 99 ? START + 99_000_000 : undefined); },
    ...over,
  };
}

test('SPEEDS', () => {
  assert.deepEqual(SPEEDS, [0.5, 1, 2, 5, 10]);
});

test('initial state: 2 min before race start, paused, speed 1', () => {
  const d = fakeData();
  const p = new Playback(d);
  assert.equal(p.time, d.raceStartTime - 120000);
  assert.equal(p.speed, 1);
  assert.equal(p.playing, false);
  assert.equal(p.waiting, false);
});

test('initial time clamps to dataStartTime', () => {
  const d = fakeData({ raceStartTime: START + 10_000 });
  assert.equal(new Playback(d).time, START);
});

test('update does not advance while paused but still sets playhead', () => {
  const d = fakeData();
  const p = new Playback(d);
  const t0 = p.time;
  p.update(1);
  assert.equal(p.time, t0);
  assert.deepEqual(d.calls.at(-1), [t0, 1]);
});

test('update advances by dt*speed when playing and ready', () => {
  const d = fakeData();
  const p = new Playback(d);
  const t0 = p.time;
  p.play();
  p.update(0.5);
  assert.equal(p.time, t0 + 500);
  p.speedUp(); p.speedUp(); // 5x
  assert.equal(p.speed, 5);
  p.update(1);
  assert.equal(p.time, t0 + 500 + 5000);
  assert.deepEqual(d.calls.at(-1), [p.time, 5]);
});

test('waiting when data not ready, resumes when ready', () => {
  const d = fakeData({ ready: false });
  const p = new Playback(d);
  const reasons = [];
  p.onChange((_, r) => reasons.push(r));
  const t0 = p.time;
  p.play();
  p.update(1);
  assert.equal(p.time, t0);
  assert.equal(p.waiting, true);
  p.update(1);
  assert.equal(p.time, t0);
  d.ready = true;
  p.update(1);
  assert.equal(p.time, t0 + 1000);
  assert.equal(p.waiting, false);
  assert.deepEqual(reasons, ['play', 'waiting', 'waiting']);
  assert.ok(d.calls.length === 3);
});

test('onChange not fired on plain frames; unsubscribe works', () => {
  const d = fakeData();
  const p = new Playback(d);
  let n = 0;
  const off = p.onChange(() => n++);
  p.play();
  for (let i = 0; i < 10; i++) p.update(0.016);
  assert.equal(n, 1);
  p.pause(); p.pause();
  assert.equal(n, 2);
  p.toggle();
  assert.equal(p.playing, true);
  assert.equal(n, 3);
  off();
  p.toggle();
  assert.equal(n, 3);
});

test('seek, seekBy clamp to data range', () => {
  const d = fakeData();
  const p = new Playback(d);
  p.seek(0);
  assert.equal(p.time, START);
  p.seekBy(-10);
  assert.equal(p.time, START);
  p.seekBy(10);
  assert.equal(p.time, START + 10_000);
  p.seek(Number.MAX_SAFE_INTEGER);
  assert.equal(p.time, d.dataEndTime);
});

test('seekToLap uses getLapStartTime; ignores unknown laps', () => {
  const d = fakeData();
  const p = new Playback(d);
  p.seekToLap(3);
  assert.equal(p.time, START + 900_000);
  p.seekToLap(42);
  assert.equal(p.time, START + 900_000);
  p.seekToLap(99);
  assert.equal(p.time, d.dataEndTime);
});

test('speed steps clamp at ends', () => {
  const p = new Playback(fakeData());
  let n = 0;
  p.onChange(() => n++);
  for (let i = 0; i < 10; i++) p.speedUp();
  assert.equal(p.speed, 10);
  for (let i = 0; i < 10; i++) p.speedDown();
  assert.equal(p.speed, 0.5);
  assert.equal(n, 3 + 4);
});

test('playback stops at dataEndTime', () => {
  const d = fakeData();
  const p = new Playback(d);
  p.seek(d.dataEndTime - 500);
  p.play();
  p.update(1);
  assert.equal(p.time, d.dataEndTime);
  assert.equal(p.playing, false);
});

test('pause clears waiting', () => {
  const p = new Playback(fakeData({ ready: false }));
  p.play(); p.update(0.1);
  assert.equal(p.waiting, true);
  p.pause();
  assert.equal(p.waiting, false);
});
