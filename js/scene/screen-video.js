// Video tab of the main screen (spec §6, tab 2): a VideoTexture from the source set on the
// start page (mp4 / webm URL, HLS via native support or hls.js, or a local file), with
// play/pause, mute and sync. Sync keeps video time = offset + (playhead - race start),
// follows the playback speed and pauses with the replay.
// Plus VideoControls: the play / mute / sync strip under the screen's right edge.
import * as THREE from 'three';
import { Panel, THEME, font, roundRect } from '../panels/panel-base.js';
import { loadVideoSettings, saveVideoSettings } from '../video-settings.js';

const SYNC_EVERY = 0.25;       // s between sync checks
const DRIFT = 0.5;             // s of drift (x speed) before a sync seek
const MIN_RATE = 0.25;
const MAX_RATE = 16;

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
    this._acc = 0;
    this._resync = false;      // seek to the replay time at the next sync check
    this._open = false;
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
    this._resync = s.sync;
    this._acc = SYNC_EVERY;
    if (!this.source || this.source.url !== s.url || this.source.kind !== s.kind) this._load(s);
    else if (this.state === 'ready' && !this.sync) this._play();
    this.version++;
  }

  /** The tab was closed: pause (the texture stops updating). */
  close() {
    this._open = false;
    if (this.video) this.video.pause();
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

  toggleSync() {
    this.sync = !this.sync;
    saveVideoSettings({ sync: this.sync });
    if (this.video) this.video.playbackRate = 1;
    this._resync = this.sync;   // jump straight to the replay time
    this._acc = SYNC_EVERY;
    this.version++;
  }

  /** Per frame while the Video tab is open. Allocation-free. */
  update(dt) {
    if (!this._open || !this.sync || this.state !== 'ready') return;
    this._acc += dt;
    if (this._acc < SYNC_EVERY) return;
    this._acc = 0;
    const v = this.video;
    const pb = this.playback;
    const target = this.offsetSec + (pb.time - this.data.raceStartTime) / 1000;
    const dur = Number.isFinite(v.duration) ? v.duration : Infinity;
    const run = pb.playing && !pb.waiting && target >= 0 && target < dur;
    const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, pb.speed));
    if (v.playbackRate !== rate) v.playbackRate = rate;
    const clamped = Math.max(0, Math.min(target, dur));
    const drift = Math.abs(v.currentTime - clamped);
    // An ended video must seek back too, or play() would restart it from 0.
    if (!v.seeking && (this._resync || drift > DRIFT * Math.max(1, pb.speed) || (v.ended && run))) v.currentTime = clamped;
    this._resync = false;
    if (run && v.paused) this._play();
    else if (!run && !v.paused) v.pause();
  }

  dispose() {
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

/** Play / mute / sync buttons under the screen's right edge (shown on the Video tab). */
export class VideoControls extends Panel {
  /** @param {ScreenVideo} video */
  constructor(video) {
    super({ name: 'video-controls', width: 0.54, height: 0.1 });
    this.video = video;
    this._sig = '';
  }

  refresh() {
    if (!this.mesh.visible) return false;
    const v = this.video;
    const sig = `${v.version}|${v.playing}|${v.muted}|${v.sync}|${v.hasVideo}|${v.playback.playing}`;
    if (sig === this._sig) return false;
    this._sig = sig;
    return true;
  }

  draw(g, w, h) {
    this.clear(g, w, h, 14);
    const v = this.video;
    const gap = 8;
    const bw = (w - 4 * gap) / 3;
    const items = [
      ['vplay', v.sync ? (this._pbPlaying() ? '❚❚ Replay' : '▶ Replay') : v.playing ? '❚❚ Pause' : '▶ Play', !v.hasVideo],
      ['vmute', v.muted ? 'Unmute' : 'Mute', !v.hasVideo],
      ['vsync', v.sync ? 'Sync ON' : 'Sync OFF', false],
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
      g.font = font(30, 700);
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
    this._sig = '';
  }
}
