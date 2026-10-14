// Phase 9b additions to the desktop dashboard, kept out of dashboard.js:
//   - track colour button (Sectors / Mini / Plain, key C) for track-style.js
//   - engine hum toggle (key E) and UI click sounds on the toolbar buttons
//   - race moment banners over the track tile (race-moments.js + banner-dom.js)
//   - flag ambience: the dashboard edge glows in the track status colour when not green
//   - team radio: Off / Driver / All button (key R) and the radio pop-up (11.1, 11.2)
// update() runs every frame but does its work at 10 Hz (no per-frame allocation).
import { getSettings, setSetting } from '../settings.js';
import { uiClick } from '../audio.js';
import { createEngineSound } from '../engine-sound.js';
import { createRaceMoments } from '../race-moments.js';
import { trackStatusAt } from '../panels/race-status.js';
import { TRACK_COLOUR_MODES } from '../scene/track-style.js';
import { createBannerDom } from './banner-dom.js';
import { createRadioPop } from './radio-pop.js';
import { radioMode, cycleRadioMode, RADIO_LABEL } from '../radio-mode.js';

const TICK_MS = 100;
const COLOUR_LABEL = { sectors: 'Sectors', minis: 'Mini', plain: 'Plain' };
const COLOUR_TITLE = {
  sectors: 'Track colours: the selected driver\'s last lap, sector by sector (purple / green / yellow)',
  minis: 'Track colours: each mini-sector in the team colour of the driver who last went purple there (approximate positions)',
  plain: 'Track colours: plain',
};

/**
 * @param {object} o
 * @param {object} o.data SessionData
 * @param {object} o.playback Playback
 * @param {HTMLElement} o.root .f1-dash
 * @param {HTMLElement} o.trackTile
 * @param {HTMLElement} o.trackTools the track tile's overlay buttons (track colours go first)
 * @param {HTMLElement} o.right the top bar's right slot (12.3: Radio and Engine go here)
 * @param {(tag: string, cls: string, parent: HTMLElement, text?: string) => HTMLElement} o.el
 * @param {(n: number) => void} o.selectDriver
 */
export function createDashExtras({ data, playback, root, trackTile, trackTools, right, el, selectDriver }) {
  const engine = createEngineSound();
  const moments = createRaceMoments(data);
  const banner = createBannerDom(trackTile);
  const radioPop = createRadioPop({ data, tile: trackTile, selectDriver });
  const tel = { speed: 0, rpm: 0, gear: 0, throttle: 0, brake: 0, drs: 0 };
  let acc = TICK_MS;
  let flag = '';

  const colourBtn = el('button', 'f1-dash__btn');
  colourBtn.type = 'button';
  trackTools.prepend(colourBtn);
  const radioBtn = el('button', 'f1-dash__btn', right);
  radioBtn.type = 'button';
  radioBtn.title = 'Team radio: off, the selected driver only, or every driver (R)';
  const engineBtn = el('button', 'f1-dash__btn', right, 'Engine');
  engineBtn.type = 'button';
  engineBtn.title = 'Engine hum from the selected driver\'s RPM (E)';

  function showColour() {
    const m = getSettings().trackColours;
    colourBtn.textContent = COLOUR_LABEL[m] || 'Sectors';
    colourBtn.title = `${COLOUR_TITLE[m] || ''} (C)`;
  }
  function cycleColour() {
    const m = getSettings().trackColours;
    const next = TRACK_COLOUR_MODES[(TRACK_COLOUR_MODES.indexOf(m) + 1) % TRACK_COLOUR_MODES.length];
    setSetting('trackColours', next);
    showColour();
  }
  function showEngine() { engineBtn.classList.toggle('is-on', getSettings().engine); }
  function toggleEngine() { setSetting('engine', !getSettings().engine); showEngine(); }
  function showRadio() {
    const m = radioMode(getSettings());
    radioBtn.textContent = `Radio: ${RADIO_LABEL[m]}`;
    radioBtn.classList.toggle('is-on', m === 'all');
  }
  function cycleRadio() { cycleRadioMode(getSettings(), setSetting); showRadio(); }
  colourBtn.addEventListener('click', cycleColour);
  engineBtn.addEventListener('click', toggleEngine);
  radioBtn.addEventListener('click', cycleRadio);
  showColour();
  showEngine();
  showRadio();

  // A soft tick on every toolbar / tab button press (the sfx setting mutes it).
  const onClick = (e) => { if (e.target.closest && e.target.closest('.f1-dash__btn')) uiClick(); };
  root.addEventListener('click', onClick);

  return {
    /** @returns {boolean} true if the key was handled */
    onKey(code) {
      if (code === 'KeyC') { cycleColour(); return true; }
      if (code === 'KeyE') { toggleEngine(); return true; }
      if (code === 'KeyR') { cycleRadio(); return true; }
      return false;
    },
    update(dt, selected) {
      acc += dt * 1000;
      if (acc < TICK_MS) return;
      acc = 0;
      const t = playback.time;
      const running = playback.playing && !playback.waiting;
      const s = getSettings();
      const ev = moments.update(t, selected, running);
      if (ev && s.banners) banner.show(ev);
      const st = trackStatusAt(data, t);
      const f = st.status === 'GREEN' ? '' : st.colour;
      if (f !== flag) {
        flag = f;
        root.classList.toggle('has-flag', !!f);
        if (f) root.style.setProperty('--flag', f);
      }
      const telOk = selected != null && running && data.getTelemetryAt(selected, t, tel);
      engine.update(s.engine && running, playback.speed, telOk ? tel : null);
    },
    /** Dev / tests (?debug): show a banner now. */
    showBanner: (ev) => banner.show(ev),
    /** A team radio clip started (audio-events onRadio). */
    showRadio: (clip) => radioPop.show(clip),
    moments,
    dispose() {
      root.removeEventListener('click', onClick);
      engine.dispose();
      banner.dispose();
      radioPop.dispose();
    },
  };
}
