// Desktop hub tile (12.4; was the main screen tile, 8.6, 8.7): Insights and the main screen
// in one tile, with six tabs:
//   Battles / H2H / Driver: the Insights panel (9.14–9.17) without its own tab row.
//   Radio:  the selected driver's team radio list (the ScreenContent canvas).
//   Video:  the start page's video source in a native <video> element (sharper and smoother
//           than a texture), with Play / Mute / Sync / Sync here buttons. Same ScreenVideo logic
//           as VR: with Sync on, the video drives the replay's timing (8.8).
//   Charts: one analytics chart at a time (9.27).
//   Quali:  the weekend's qualifying, Q1 / Q2 / Q3 and the result (13.12).
// The last tab is remembered (settings.hubTab). The ⤢ button swaps this tile with the track:
// the dashboard decides where the tile goes; this module only reports the click.
import { ScreenVideo, NO_SOURCE } from '../scene/screen-video.js';
import { ScreenContent } from '../scene/screen-radio.js';
import { loadVideoSettings } from '../video-settings.js';
import { AnalyticsPanel } from '../panels/analytics-panel.js';
import { InsightsPanel } from '../panels/insights.js';
import { QualiPanel } from '../panels/quali-panel.js';
import { getSettings, setSetting } from '../settings.js';

const TABS = [['battle', 'Battles'], ['h2h', 'H2H'], ['driver', 'Driver'], ['radio', 'Radio'], ['video', 'Video'], ['analytics', 'Charts'], ['quali', 'Quali']];
const INSIGHT_TABS = new Set(['battle', 'h2h', 'driver']);

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
 * @param {object} [o.extra] createExtraData() result (the Quali tab)
 * @returns {{setTab: (t: string) => void, getTab: () => string, setFocused: (on: boolean) => void,
 *   video: ScreenVideo, update: (dt: number) => void, dispose: () => void}}
 */
export function createMainTile({ tile, data, playback, host, onToggleFocus, extra = null }) {
  const video = new ScreenVideo(data, playback);

  const bar = el('div', 'f1-hub__tabs', tile);
  bar.setAttribute('role', 'tablist');
  const tabBtns = {};
  for (const [id, label] of TABS) {
    const b = button(bar, label, () => setTab(id), 'f1-hub__tab');
    b.setAttribute('role', 'tab');
    tabBtns[id] = b;
  }
  el('span', 'f1-dash__spacer', bar);
  const focusBtn = button(bar, '⤢', () => onToggleFocus(), 'f1-dash__btn--icon f1-hub__focus');

  const body = el('div', 'f1-dash__body', tile);
  const insightsBox = el('div', 'f1-dash__radio', body);
  const insights = host.add(new InsightsPanel(data, { tabs: false }), insightsBox);
  const videoBox = el('div', 'f1-dash__video', body);
  const msg = el('div', 'f1-dash__msg', videoBox);
  const controls = el('div', 'f1-dash__vctl', body);
  const playBtn = button(controls, '▶ Play', () => { video.togglePlay(); changed(); });
  const muteBtn = button(controls, 'Mute', () => { video.toggleMute(); changed(); });
  const syncBtn = button(controls, 'Sync OFF', () => { video.toggleSync(); changed(); });
  const hereBtn = button(controls, 'Sync here', () => { video.setSyncHere(); changed(); });
  hereBtn.title = 'Line up the video and the replay (e.g. both at lights out), then press: the video then drives the replay';

  const radioBox = el('div', 'f1-dash__radio', body);
  // A smaller canvas than the VR screen (1.7 x 0.85 m at 512 px/m) with 5 clips per page.
  const radio = host.add(new ScreenContent(data, 1.7, 0.85, { rows: 5 }), radioBox);
  radio.show('radio');
  // Charts tab (9.27): one chart at a time, the same panel as the VR screen's tab.
  const analyticsBox = el('div', 'f1-dash__radio', body);
  const analytics = host.add(new AnalyticsPanel(data, { name: 'analytics-tab', width: 1.7, height: 0.85, pxPerM: 512 }), analyticsBox);
  analytics.mesh.visible = false; // skips its refresh while the tab is closed
  const qualiBox = el('div', 'f1-dash__radio', body);
  const quali = host.add(new QualiPanel(data, { extra, name: 'quali-tab', width: 1.7, height: 0.85, pxPerM: 512 }), qualiBox);

  let tab = '';
  let shown = -1;
  const changed = () => { shown = -1; };

  function setTab(t) {
    if (!tabBtns[t]) t = 'battle';
    if (t === tab) return;
    if (tab === 'video') video.close();
    tab = t;
    setSetting('hubTab', t);
    for (const [id, b] of Object.entries(tabBtns)) {
      b.classList.toggle('is-active', id === t);
      b.setAttribute('aria-selected', String(id === t));
    }
    const isVideo = t === 'video';
    const isInsight = INSIGHT_TABS.has(t);
    videoBox.hidden = !isVideo;
    controls.hidden = !isVideo;
    insightsBox.hidden = !isInsight;
    insights.mesh.visible = isInsight;
    radioBox.hidden = t !== 'radio';
    analyticsBox.hidden = t !== 'analytics';
    analytics.mesh.visible = t === 'analytics';
    qualiBox.hidden = t !== 'quali';
    // A box that was hidden measured 0 × 0: re-fit the canvases now that it shows.
    if (typeof window !== 'undefined') host.layout(window.devicePixelRatio || 1);
    if (isVideo) { video.open(); changed(); }
    else if (isInsight) insights.setTab(t);
    else if (t === 'radio') radio.invalidate();
    else if (t === 'quali') quali.invalidate();
    else analytics.invalidate();
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
    syncBtn.textContent = v.leading ? 'Sync ON · video leads' : v.sync ? 'Sync ON' : 'Sync OFF';
    hereBtn.disabled = !ready;
    syncBtn.classList.toggle('is-on', v.sync);
  }

  const saved = getSettings().hubTab;
  setTab(saved === 'video' && loadVideoSettings().kind === 'none' ? 'battle' : saved);

  let lastPlaying = null;
  return {
    video,
    setTab,
    getTab: () => tab,
    /** The tile is the big one (focus) or the small one: the ⤢ button says what it does. */
    setFocused(on) {
      focusBtn.textContent = on ? '⤡' : '⤢';
      focusBtn.title = on ? 'Make the track big again (F)' : 'Make this tile big (F)';
    },
    update(dt) {
      if (tab !== 'video') return;
      video.update(dt);
      const key = video.version * 4 + (playback.playing ? 1 : 0) + (video.leading ? 2 : 0);
      if (key !== shown || lastPlaying !== video.playing) {
        shown = key;
        lastPlaying = video.playing;
        syncDom();
      }
    },
    dispose() {
      video.dispose(); // the panel canvases are disposed by the PanelHost
      tile.replaceChildren();
    },
  };
}
