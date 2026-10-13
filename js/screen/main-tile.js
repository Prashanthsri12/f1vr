// Screen mode main screen tile (8.6, 8.7): Video and Radio tabs.
//   Video: the start page's video source in a native <video> element (sharper and smoother
//          than a texture), with Play / Mute / Sync buttons. Same ScreenVideo logic as VR.
//   Radio: the selected driver's team radio list (the ScreenContent canvas).
// The ⤢ button swaps this tile with the track ("Video focus"): the dashboard decides where
// the tile goes; this module only reports the click.
import { ScreenVideo, NO_SOURCE } from '../scene/screen-video.js';
import { ScreenContent } from '../scene/screen-radio.js';
import { loadVideoSettings } from '../video-settings.js';

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

function button(parent, text, onClick, cls = '') {
  const b = el('button', `f1-dash__btn ${cls}`.trim(), parent, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/**
 * @param {object} o
 * @param {HTMLElement} o.tile
 * @param {import('../session-data.js').SessionData} o.data
 * @param {import('../playback.js').Playback} o.playback
 * @param {import('./panel-host.js').PanelHost} o.host
 * @param {() => void} o.onToggleFocus
 * @returns {{setTab: (t: 'video'|'radio') => void, getTab: () => string, setFocused: (on: boolean) => void,
 *   video: ScreenVideo, update: (dt: number) => void, dispose: () => void}}
 */
export function createMainTile({ tile, data, playback, host, onToggleFocus }) {
  const video = new ScreenVideo(data, playback);

  const bar = el('div', 'f1-dash__tabs', tile);
  const tabBtns = {
    video: button(bar, 'Video', () => setTab('video')),
    radio: button(bar, 'Radio', () => setTab('radio')),
  };
  el('span', 'f1-dash__spacer', bar);
  const focusBtn = button(bar, '⤢', () => onToggleFocus(), 'f1-dash__btn--icon');

  const body = el('div', 'f1-dash__body', tile);
  const videoBox = el('div', 'f1-dash__video', body);
  const msg = el('div', 'f1-dash__msg', videoBox);
  const controls = el('div', 'f1-dash__vctl', body);
  const playBtn = button(controls, '▶ Play', () => { video.togglePlay(); changed(); });
  const muteBtn = button(controls, 'Mute', () => { video.toggleMute(); changed(); });
  const syncBtn = button(controls, 'Sync OFF', () => { video.toggleSync(); changed(); });

  const radioBox = el('div', 'f1-dash__radio', body);
  // A smaller canvas than the VR screen (1.7 x 0.85 m at 512 px/m) with 5 clips per page, so the
  // list stays readable in the small tile.
  const radio = host.add(new ScreenContent(data, 1.7, 0.85, { rows: 5 }), radioBox);
  radio.show('radio');

  let tab = '';
  let shown = -1;
  const changed = () => { shown = -1; };

  function setTab(t) {
    if (t === tab) return;
    if (tab === 'video') video.close();
    tab = t;
    for (const [id, b] of Object.entries(tabBtns)) b.classList.toggle('is-active', id === t);
    const isVideo = t === 'video';
    videoBox.hidden = !isVideo;
    controls.hidden = !isVideo;
    radioBox.hidden = isVideo;
    if (isVideo) { video.open(); changed(); }
    else radio.invalidate();
  }

  /** Mirror the video state into the DOM when it changes (cheap version check per frame). */
  function syncDom() {
    const v = video;
    if (v.video && v.video.parentNode !== videoBox) {
      v.video.className = 'f1-dash__videoel';
      videoBox.prepend(v.video);
    }
    const ready = v.state === 'ready';
    if (v.video) v.video.hidden = !ready;
    const text = v.state === 'none' ? NO_SOURCE : (v.state === 'ready' && v.playing ? '' : v.message);
    msg.textContent = text || '';
    msg.hidden = !text;
    playBtn.textContent = v.sync ? (playback.playing ? '❚❚ Replay' : '▶ Replay') : v.playing ? '❚❚ Pause' : '▶ Play';
    playBtn.disabled = !v.hasVideo;
    muteBtn.textContent = v.muted ? 'Unmute' : 'Mute';
    muteBtn.disabled = !v.hasVideo;
    syncBtn.textContent = v.sync ? 'Sync ON' : 'Sync OFF';
    syncBtn.classList.toggle('is-on', v.sync);
  }

  setTab(loadVideoSettings().kind === 'none' ? 'radio' : 'video');

  let lastPlaying = null;
  return {
    video,
    setTab,
    getTab: () => tab,
    /** The tile is the big one (focus) or the small one: the ⤢ button says what it does. */
    setFocused(on) {
      focusBtn.textContent = on ? '⤡' : '⤢';
      focusBtn.title = on ? 'Make the track big again' : 'Make this screen big';
    },
    update(dt) {
      if (tab !== 'video') return;
      video.update(dt);
      const key = video.version * 2 + (playback.playing ? 1 : 0);
      if (key !== shown || lastPlaying !== video.playing) {
        shown = key;
        lastPlaying = video.playing;
        syncDom();
      }
    },
    dispose() {
      video.dispose(); // the radio canvas is disposed by the PanelHost
      tile.replaceChildren();
    },
  };
}
