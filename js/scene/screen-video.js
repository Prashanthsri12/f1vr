// Video tab of the main screen (spec §6, tab 2): a VideoTexture from the source set on the
// start page (mp4 / webm URL, HLS via native support or hls.js, or a local file), with
// play/pause, mute and sync.
// Sync (8.8): the video drives the timing. With Sync on, the tab open and the video ready,
// this.clock is attached to Playback (setClock), so playhead = race start + (video time -
// offsetSec): pausing, seeking or scrubbing the video moves the whole replay, with no drift.
// Above 2x the replay runs on its own and the video waits (playback.js). Closing the tab
// detaches the clock and the replay carries on from the same time.
// "Set sync here" makes the current video frame match the current replay time.
// Plus VideoControls: the play / mute / sync strip under the screen's right edge.
import * as THREE from 'three';
import { Panel, THEME, font, roundRect } from '../panels/panel-base.js';
import { loadVideoSettings, saveVideoSettings } from '../video-settings.js';

/** Fastest replay speed the video follows (it plays at that rate); faster runs data-only. */
export const CLOCK_MAX_RATE = 2;

/** Video time (s) for a replay time, and back. offsetSec = video time at the race start. */
export function videoTimeFor(t, raceStartTime, offsetSec) {
  return offsetSec + (t - raceStartTime) / 1000;
}
export function replayTimeFor(videoSec, raceStartTime, offsetSec) {
  return raceStartTime + (videoSec - offsetSec) * 1000;
}

export const NO_SOURCE = 'Add a video source on the start page.';

export class ScreenVideo {
  /**
   * @param {import('../session-data.js').SessionData} data
   * @param {import('../playback.js').Playback} playback
   */
  constructor(data, playback) {
    this.data = data;
    this.playback = playback;
    this.video = null;
    this.texture = null;
    this.hls = null;
    this.source = null;        // loaded settings snapshot
    this.state = 'idle';       // idle | none | loading | ready | error
    this.message = '';
    this.sync = false;
    this.offsetSec = 0;
    this.version = 0;          // bumps when anything the UI shows changes
    this._open = false;
    const self = this;
    /** Playback clock (8.8); created once, no per-frame allocation. */
    this.clock = {
      maxRate: CLOCK_MAX_RATE,
      get playing() { const v = self.video; return !!(v && !v.paused && !v.ended); },
      now() {
        const v = self.video;
        return v ? replayTimeFor(v.currentTime, self.data.raceStartTime, self.offsetSec) : NaN;
      },
      play() { self._play(); },
      pause() { if (self.video) self.video.pause(); },
      seek(t) {
        const v = self.video;
        if (!v) return;
        const dur = Number.isFinite(v.duration) ? v.duration : Infinity;
        v.currentTime = Math.max(0, Math.min(dur, videoTimeFor(t, self.data.raceStartTime, self.offsetSec)));
      },
      setRate(r) { if (self.video) self.video.playbackRate = r; },
      shift(sec) { self.shiftSync(sec); },
    };
    this._onEvent = () => { this.version++; };
    this._onReady = () => { if (this.state === 'loading') this._setState('ready', ''); };
    this._onError = () => this._setState('error', 'The video could not be played. Check the URL, and that its server allows cross-origin (CORS) playback.');
  }

  _setState(state, message) {
    this.state = state;
    this.message = message;
    this.version++;
  }

  /** The Video tab was opened: (re)load the source if it changed, then play when not synced. */
  open() {
    this._open = true;
    const s = loadVideoSettings();
    this.sync = s.sync;
    this.offsetSec = s.offsetSec;
    if (!this.source || this.source.url !== s.url || this.source.kind !== s.kind) this._load(s);
    else if (this.state === 'ready' && !this.sync) this._play();
    this.version++;
  }

  /** The tab was closed: the replay carries on by itself; the video pauses. */
  close() {
    this._open = false;
    this._detach();
    if (this.video) this.video.pause();
  }

  /** @private */
  _detach() {
    if (this.playback.clock === this.clock) this.playback.setClock(null);
  }

  async _load(s) {
    this._teardownSource();
    this.source = s;
    if (s.kind === 'none') { this._setState('none', NO_SOURCE); return; }
    this._setState('loading', 'Loading video…');
    const v = this._ensureVideo();
    v.crossOrigin = s.kind === 'file' ? null : 'anonymous';
    try {
      if (s.kind === 'hls' && !v.canPlayType('application/vnd.apple.mpegurl')) {
        const { default: Hls } = await import('hls.js');
        if (this.source !== s) return; // replaced while loading
        if (!Hls.isSupported()) { this._setState('error', 'HLS streams are not supported in this browser.'); return; }
        this.hls = new Hls();
        this.hls.on(Hls.Events.ERROR, (_e, d) => { if (d && d.fatal) this._onError(); });
        this.hls.loadSource(s.url);
        this.hls.attachMedia(v);
      } else {
        v.src = s.url;
        v.load();
      }
    } catch (err) {
      console.warn('[f1vr] video load failed', err);
      this._onError();
      return;
    }
    if (this._open && !this.sync) this._play();
  }

  _ensureVideo() {
    if (this.video) return this.video;
    const v = document.createElement('video');
    v.playsInline = true;
    v.preload = 'auto';
    v.setAttribute('playsinline', '');
    for (const ev of ['playing', 'pause', 'volumechange', 'ended']) v.addEventListener(ev, this._onEvent);
    v.addEventListener('loadeddata', this._onReady);
    v.addEventListener('error', this._onError);
    this.video = v;
    this.texture = new THREE.VideoTexture(v);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    return v;
  }

  _teardownSource() {
    if (this.hls) { try { this.hls.destroy(); } catch (_) { /* ignore */ } this.hls = null; }
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
  }

  /** Play; if the browser blocks sound without a gesture, retry muted. */
  _play() {
    const v = this.video;
    if (!v || this.state === 'error' || this.state === 'none') return;
    const p = v.play();
    if (p && p.catch) {
      p.catch((err) => {
        if (err && err.name === 'NotAllowedError' && !v.muted) {
          v.muted = true;
          v.play().catch(() => this._setState(this.state, 'Tap play to start the video.'));
        }
      });
    }
  }

  get playing() { return !!(this.video && !this.video.paused && !this.video.ended); }
  get muted() { return !!(this.video && this.video.muted); }
  get hasVideo() { return this.state === 'ready' || this.state === 'loading'; }

  togglePlay() {
    if (!this.video || !this.hasVideo) return;
    if (this.sync) { this.playback.toggle(); return; } // synced: the replay drives the video
    if (this.video.paused) this._play(); else this.video.pause();
  }

  toggleMute() {
    if (!this.video) return;
    this.video.muted = !this.video.muted;
  }

  /** Sync on: the video jumps to the replay time and then drives it. Off: both run freely. */
  toggleSync() {
    this.sync = !this.sync;
    saveVideoSettings({ sync: this.sync });
    if (!this.sync) {
      this._detach();
      if (this.video) this.video.playbackRate = 1;
    }
    this.version++;
  }

  /**
   * "Set sync here": the frame showing now matches the replay time now (sets offsetSec),
   * then Sync turns on. Line both up first (e.g. both paused at lights out).
   */
  setSyncHere() {
    const v = this.video;
    if (!v || this.state !== 'ready') return;
    this.offsetSec = v.currentTime - (this.playback.time - this.data.raceStartTime) / 1000;
    this.sync = true;
    saveVideoSettings({ offsetSec: this.offsetSec, sync: true });
    this.version++;
  }

  /** Nudge (8.9) while the video leads: the replay moves sec seconds later against the picture. */
  shiftSync(sec) {
    this.offsetSec -= sec;
    saveVideoSettings({ offsetSec: this.offsetSec });
    this.version++;
  }

  /** True while this video drives the replay's timing. */
  get leading() {
    return this.playback.clock === this.clock && this.playback.clockActive;
  }

  /** Per frame while the Video tab is open: attach / detach the clock. Allocation-free. */
  update() {
    const want = this._open && this.sync && this.state === 'ready';
    if (want && this.playback.clock !== this.clock) this.playback.setClock(this.clock);
    else if (!want) this._detach();
  }

  dispose() {
    this._detach();
    this._teardownSource();
    if (this.video) {
      for (const ev of ['playing', 'pause', 'volumechange', 'ended']) this.video.removeEventListener(ev, this._onEvent);
      this.video.removeEventListener('loadeddata', this._onReady);
      this.video.removeEventListener('error', this._onError);
    }
    if (this.texture) this.texture.dispose();
    this.video = null;
  }
}

/** Play / mute / sync / sync-here buttons under the screen's left half (shown on the Video tab). */
export class VideoControls extends Panel {
  /** @param {ScreenVideo} video */
  constructor(video) {
    super({ name: 'video-controls', width: 0.62, height: 0.1 });
    this.video = video;
    this._sig = '';
  }

  refresh() {
    if (!this.mesh.visible) return false;
    const v = this.video;
    const sig = `${v.version}|${v.playing}|${v.muted}|${v.sync}|${v.hasVideo}|${v.playback.playing}|${v.leading}`;
    if (sig === this._sig) return false;
    this._sig = sig;
    return true;
  }

  draw(g, w, h) {
    this.clear(g, w, h, 14);
    const v = this.video;
    const gap = 8;
    const bw = (w - 5 * gap) / 4;
    const items = [
      ['vplay', v.sync ? (this._pbPlaying() ? '❚❚ Replay' : '▶ Replay') : v.playing ? '❚❚ Pause' : '▶ Play', !v.hasVideo],
      ['vmute', v.muted ? 'Unmute' : 'Mute', !v.hasVideo],
      ['vsync', v.sync ? 'Sync ON' : 'Sync OFF', false],
      ['vhere', 'Sync here', v.state !== 'ready'],
    ];
    items.forEach(([id, label, disabled], i) => {
      const x = gap + i * (bw + gap);
      const y = gap;
      const bh = h - 2 * gap;
      const on = id === 'vsync' && v.sync;
      g.fillStyle = on ? THEME.accent : this.hover === id && !disabled ? THEME.surfaceHi : THEME.surface;
      roundRect(g, x, y, bw, bh, 10);
      g.fill();
      g.globalAlpha = disabled ? 0.45 : 1;
      g.fillStyle = THEME.text;
      g.font = font(27, 700);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label, x + bw / 2, y + bh / 2 + 1);
      g.textAlign = 'left';
      g.globalAlpha = 1;
      if (!disabled) this.addHit(id, x, y, bw, bh);
    });
  }

  _pbPlaying() { return this.video.playback.playing; }

  onHit(hit) {
    const v = this.video;
    if (hit.id === 'vplay') v.togglePlay();
    else if (hit.id === 'vmute') v.toggleMute();
    else if (hit.id === 'vsync') v.toggleSync();
    else if (hit.id === 'vhere') v.setSyncHere();
    this._sig = '';
  }
}
