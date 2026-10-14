// Desktop settings drawer (13.3): one place for every setting, opened from the top bar's ⚙
// button. Each row writes through settings.js (saved per device) and re-reads on any change,
// so the toolbar buttons (Radio, Engine, track colours) and the drawer always agree.
// VR has the same settings on the wrist menu's Settings page.
import { getSettings, setSetting, onSettingsChange } from '../settings.js';
import { radioMode, RADIO_LABEL } from '../radio-mode.js';
import { colourMode } from '../scene/track-style.js';

function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

const RADIO_SET = {
  off: { radio: false, radioAll: false },
  driver: { radio: true, radioAll: false },
  all: { radio: true, radioAll: true },
};

/**
 * Rows: [section, label, hint, kind, read(s), write(v), options?].
 * kind 'toggle' (boolean), 'choice' ([value, label][]), 'stepper' ([min, max]).
 */
const ROWS = [
  ['Sound', 'Team radio', 'Off, the selected driver only, or every driver (R)', 'choice',
    (s) => radioMode(s), (v) => { for (const [k, x] of Object.entries(RADIO_SET[v])) setSetting(k, x); },
    Object.entries(RADIO_LABEL)],
  ['Sound', 'Sound effects', 'Clicks, race control and overtake sounds', 'toggle', (s) => s.sfx, (v) => setSetting('sfx', v)],
  ['Sound', 'Engine hum', 'Follows the selected driver\'s RPM (E)', 'toggle', (s) => s.engine, (v) => setSetting('engine', v)],
  ['Track', 'Track colours', 'Sector colours of the selected driver\'s last lap, or plain (C)', 'choice',
    (s) => colourMode(s), (v) => setSetting('trackColours', v),
    [['sectors', 'Sectors'], ['minis', 'Mini-sectors'], ['plain', 'Plain']]],
  ['Track', 'Mini-sectors', 'Show mini-sectors on the track and in Laps & tyres', 'toggle', (s) => s.minis, (v) => setSetting('minis', v)],
  ['Track', 'Weather effects', 'Animated weather beside the 2D track and in the 3D view', 'toggle', (s) => s.weatherFx, (v) => setSetting('weatherFx', v)],
  ['Alerts', 'Race banners', 'Lights out, safety car, flags, fastest laps, pit stops', 'toggle', (s) => s.banners, (v) => setSetting('banners', v)],
  ['Alerts', 'Overtake warnings', 'A heads-up about 10 s before cars swap places (looks ahead in the replay)', 'toggle',
    (s) => s.overtakeAlerts, (v) => setSetting('overtakeAlerts', v)],
  ['Alerts', 'Warn for', 'Every fight, or only fights for the top N places', 'choice',
    (s) => s.overtakeScope, (v) => setSetting('overtakeScope', v), [['all', 'All drivers'], ['top', 'Top N']]],
  ['Alerts', 'Top N', 'Positions that count as the top', 'stepper', (s) => s.overtakeTopN, (v) => setSetting('overtakeTopN', v), [3, 20]],
  ['Spoilers', 'Full session', 'Charts and the race timeline show the whole session, not just up to the playhead', 'toggle',
    (s) => s.fullSession, (v) => setSetting('fullSession', v)],
];

/**
 * @param {{parent: HTMLElement, button: HTMLElement}} o parent: where the drawer goes (.f1-dash);
 *   button: the ⚙ toggle
 * @returns {{open: () => void, close: () => void, toggle: () => void, isOpen: () => boolean, dispose: () => void}}
 */
export function createSettingsDrawer({ parent, button }) {
  const box = el('aside', 'f1-set', parent);
  box.hidden = true;
  box.setAttribute('aria-label', 'Settings');
  const head = el('div', 'f1-set__head', box);
  el('h2', 'f1-set__title', head, 'Settings');
  const close = el('button', 'f1-dash__btn f1-dash__btn--icon', head, '✕');
  close.type = 'button';
  close.title = 'Close (Esc)';
  close.addEventListener('click', () => hide());
  const body = el('div', 'f1-set__body', box);

  const renders = [];
  let section = '';
  for (const [sec, label, hint, kind, read, write, opts] of ROWS) {
    if (sec !== section) { section = sec; el('h3', 'f1-set__sec', body, sec); }
    const row = el('div', 'f1-set__row', body);
    const text = el('div', 'f1-set__text', row);
    el('div', 'f1-set__label', text, label);
    el('div', 'f1-set__hint', text, hint);
    const ctl = el('div', 'f1-set__ctl', row);
    if (kind === 'toggle') {
      const b = el('button', 'f1-dash__btn f1-set__toggle', ctl);
      b.type = 'button';
      b.setAttribute('role', 'switch');
      b.addEventListener('click', () => write(!read(getSettings())));
      renders.push((s) => {
        const on = !!read(s);
        b.textContent = on ? 'On' : 'Off';
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-checked', String(on));
      });
    } else if (kind === 'choice') {
      const btns = opts.map(([v, l]) => {
        const b = el('button', 'f1-dash__btn', ctl, l);
        b.type = 'button';
        b.addEventListener('click', () => write(v));
        return [v, b];
      });
      renders.push((s) => {
        const cur = read(s);
        for (const [v, b] of btns) b.classList.toggle('is-active', v === cur);
        if (label === 'Track colours') btns.find(([v]) => v === 'minis')[1].disabled = !s.minis;
        if (label === 'Warn for') row.classList.toggle('is-off', !s.overtakeAlerts);
      });
    } else {
      const [lo, hi] = opts;
      const minus = el('button', 'f1-dash__btn f1-dash__btn--icon', ctl, '−');
      const val = el('span', 'f1-set__val', ctl);
      const plus = el('button', 'f1-dash__btn f1-dash__btn--icon', ctl, '+');
      minus.type = plus.type = 'button';
      minus.addEventListener('click', () => write(Math.max(lo, read(getSettings()) - 1)));
      plus.addEventListener('click', () => write(Math.min(hi, read(getSettings()) + 1)));
      renders.push((s) => {
        const v = read(s);
        val.textContent = `P1–P${v}`;
        minus.disabled = v <= lo;
        plus.disabled = v >= hi;
        row.classList.toggle('is-off', !s.overtakeAlerts || s.overtakeScope !== 'top');
      });
    }
  }
  const render = () => { const s = getSettings(); for (const r of renders) r(s); };
  render();
  const off = onSettingsChange(render);

  function show() { box.hidden = false; button.classList.add('is-active'); render(); close.focus(); }
  function hide() { box.hidden = true; button.classList.remove('is-active'); }
  const onKey = (e) => { if (e.key === 'Escape' && !box.hidden) { e.stopImmediatePropagation(); hide(); } };
  window.addEventListener('keydown', onKey, true);
  button.addEventListener('click', () => (box.hidden ? show() : hide()));

  return {
    open: show,
    close: hide,
    toggle: () => (box.hidden ? show() : hide()),
    isOpen: () => !box.hidden,
    dispose() { off(); window.removeEventListener('keydown', onKey, true); box.remove(); },
  };
}
