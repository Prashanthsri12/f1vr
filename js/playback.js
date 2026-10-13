// Playback: owns the playhead (UTC ms) and advances it by dt * speed.
// Pure module: no three.js, runs under Node.
//
// External clock (8.8): setClock(clock) lets a synced video drive the playhead. While the
// clock is active (attached and speed <= clock.maxRate), update() reads the time from
// clock.now() instead of advancing it, and play / pause / seek / speed act on the clock.
// Faster speeds hand control back: the video pauses and the replay runs on its own; coming
// back to <= maxRate seeks the video to the replay time and resumes it. If data for the
// clock's time isn't loaded, the clock is paused (held) until it is.
// clock: { maxRate, playing, now() -> ms|NaN, play(), pause(), seek(t), setRate(r), shift?(sec) }

/** Available playback speeds (multipliers of real time). */
export const SPEEDS = [0.5, 1, 2, 5, 10];

const PRE_START_MS = 120000;

export class Playback {
  /**
   * @param {object} data SessionData-like: raceStartTime, dataStartTime, dataEndTime,
   *   isReady(t), setPlayhead(t, speed), getLapStartTime(n)
   */
  constructor(data) {
    this.data = data;
    this.speed = 1;
    this.playing = false;
    this.waiting = false;
    this._listeners = new Set();
    this.clock = null;
    this._held = false;      // clock paused by us while its data loads
    const start = Number.isFinite(data.raceStartTime) ? data.raceStartTime - PRE_START_MS : data.dataStartTime;
    this.time = this._clamp(start);
  }

  /** @private */
  _clamp(t) {
    const lo = this.data.dataStartTime;
    const hi = this.data.dataEndTime;
    if (Number.isFinite(lo) && t < lo) t = lo;
    if (Number.isFinite(hi) && t > hi) t = hi;
    return t;
  }

  /** @private */
  _emit(reason) {
    for (const cb of this._listeners) {
      try { cb(this, reason); } catch (e) { console.error('playback onChange listener failed', e); }
    }
  }

  /** @private */
  _setWaiting(w) {
    if (this.waiting !== w) {
      this.waiting = w;
      this._emit('waiting');
    }
  }

  /**
   * Advance the playhead. Call once per frame.
   * @param {number} dtSeconds real seconds since last frame
   */
  update(dtSeconds) {
    if (this.clockActive) {
      this._followClock();
    } else if (this.playing) {
      const next = this._clamp(this.time + dtSeconds * this.speed * 1000);
      if (this.data.isReady(next)) {
        this.time = next;
        this._setWaiting(false);
        if (Number.isFinite(this.data.dataEndTime) && next >= this.data.dataEndTime) {
          this.pause();
        }
      } else {
        this._setWaiting(true);
      }
    }
    this.data.setPlayhead(this.time, this.speed);
  }

  /** @private Clock mode: the playhead is the clock's time; hold the clock while data loads. */
  _followClock() {
    const c = this.clock;
    const t = c.now();
    if (Number.isFinite(t)) {
      const next = this._clamp(t);
      this.time = next; // also where the chunk loader looks
      if (this.data.isReady(next)) {
        if (this._held) { this._held = false; c.play(); }
        this._setWaiting(false);
      } else {
        if (c.playing) { c.pause(); this._held = true; }
        this._setWaiting(this._held);
      }
    }
    const playing = c.playing || this._held;
    if (playing !== this.playing) {
      this.playing = playing;
      if (!playing) this.waiting = false;
      this._emit(playing ? 'play' : 'pause');
    }
  }

  /** True while an attached clock drives the playhead (speed within its range). */
  get clockActive() {
    return !!this.clock && this.speed <= this.clock.maxRate;
  }

  /**
   * Attach (or with null, detach) an external clock. Attaching syncs the clock to the
   * replay: same time, rate and play state. Detaching keeps the replay where it is, playing
   * on its own if it was playing.
   * @param {object|null} clock
   */
  setClock(clock) {
    if (clock === this.clock) return;
    if (this.clock && this._held) this._held = false;
    this.clock = clock;
    if (clock) {
      if (this.clockActive) this._handOver();
      else clock.pause();
    }
    this._emit('clock');
  }

  /** @private The clock takes over from the replay at the current time. */
  _handOver() {
    const c = this.clock;
    this._held = false;
    c.setRate(this.speed);
    c.seek(this.time);
    if (this.playing) c.play(); else c.pause();
  }

  /** Start playback. */
  play() {
    if (this.clockActive) {
      this._held = false;
      this.clock.play();
    }
    if (this.playing) return;
    if (Number.isFinite(this.data.dataEndTime) && this.time >= this.data.dataEndTime) return;
    this.playing = true;
    this._emit('play');
  }

  /** Pause playback (clears waiting). */
  pause() {
    if (this.clockActive) {
      this._held = false;
      this.clock.pause();
    }
    if (!this.playing) return;
    this.playing = false;
    this.waiting = false;
    this._emit('pause');
  }

  /** Toggle play/pause. */
  toggle() {
    if (this.playing) this.pause(); else this.play();
  }

  /**
   * Jump to an absolute time (ms), clamped to the data range.
   * @param {number} t
   */
  seek(t) {
    if (!Number.isFinite(t)) return;
    const c = this._clamp(t);
    if (this.clockActive) this.clock.seek(c);
    if (c === this.time) return;
    this.time = c;
    this.data.setPlayhead(this.time, this.speed);
    this._emit('seek');
  }

  /** @param {number} seconds relative jump (negative = backwards) */
  seekBy(seconds) {
    this.seek(this.time + seconds * 1000);
  }

  /** Jump to the start of lap n (earliest lap start among drivers). */
  seekToLap(n) {
    const t = this.data.getLapStartTime(n);
    if (Number.isFinite(t)) this.seek(t);
  }

  /** Step to the next faster speed. */
  speedUp() {
    this._setSpeedIndex(this._speedIndex() + 1);
  }

  /** Step to the next slower speed. */
  speedDown() {
    this._setSpeedIndex(this._speedIndex() - 1);
  }

  /** Set one of SPEEDS (other values snap to the nearest). */
  setSpeed(s) {
    let best = 0;
    for (let i = 1; i < SPEEDS.length; i++) if (Math.abs(SPEEDS[i] - s) < Math.abs(SPEEDS[best] - s)) best = i;
    this._setSpeedIndex(best);
  }

  /** @private */
  _speedIndex() {
    const i = SPEEDS.indexOf(this.speed);
    return i < 0 ? 1 : i;
  }

  /** @private */
  _setSpeedIndex(i) {
    const s = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i))];
    if (s === this.speed) return;
    const wasActive = this.clockActive;
    this.speed = s;
    if (this.clock) {
      if (this.clockActive) {
        if (wasActive) this.clock.setRate(s); else this._handOver();
      } else if (wasActive) {
        // Too fast for the video: it pauses and the replay runs on its own (data only).
        const playing = this.playing;
        this.clock.pause();
        this._held = false;
        this.playing = playing;
      }
    }
    this._emit('speed');
  }

  /**
   * Subscribe to state changes (play/pause/seek/speed/waiting). Not fired per frame.
   * @param {(pb: Playback, reason: string) => void} cb
   * @returns {() => void} unsubscribe
   */
  onChange(cb) {
    this._listeners.add(cb);
    return () => this._listeners.delete(cb);
  }
}
