// Team radio pop-up on the desktop track tile (11.2): when a clip autoplays (the selected
// driver's, or any driver's with All radio on), a card shows who is talking, their position
// and lap, with a moving waveform while the audio plays. It hides when the clip ends.
// Clicking the card selects that driver. Styles in css/dashboard.css (.f1-radio).
import { onRadioChange, getRadioState } from '../audio.js';
import { currentLap } from '../session-index.js';

const MIN_MS = 2500;   // stay at least this long, even if the clip fails to load
const MAX_MS = 40000;  // safety: hide even if 'ended' never arrives
const BARS = 22;

/**
 * @param {object} o
 * @param {object} o.data SessionData
 * @param {HTMLElement} o.tile the track tile
 * @param {(n: number) => void} o.selectDriver
 * @returns {{show: (clip: {driver_number: number, date: number, recording_url: string}) => void, dispose: () => void}}
 */
export function createRadioPop({ data, tile, selectDriver }) {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'f1-radio';
  card.hidden = true;
  card.setAttribute('aria-live', 'polite');
  card.innerHTML = `
    <span class="f1-radio__head"><span class="f1-radio__live"></span>Team radio<span class="f1-radio__meta"></span></span>
    <span class="f1-radio__who"><span class="f1-stk f1-radio__num"></span><span class="f1-radio__name"></span></span>
    <span class="f1-radio__team"></span>
    <span class="f1-radio__wave">${'<i></i>'.repeat(BARS)}</span>`;
  tile.append(card);
  const $ = (c) => card.querySelector(c);
  const meta = $('.f1-radio__meta'), num = $('.f1-radio__num'), name = $('.f1-radio__name'), team = $('.f1-radio__team');
  $('.f1-radio__wave').querySelectorAll('i').forEach((b, i) => {
    b.style.height = `${25 + Math.abs(Math.sin(i * 1.7)) * 75}%`;
    b.style.animationDelay = `${-((i * 97) % 900)}ms`;
  });

  let url = null;
  let driver = null;
  let shownAt = 0;
  let hideTimer = 0;
  let maxTimer = 0;

  function hide() {
    clearTimeout(hideTimer); clearTimeout(maxTimer);
    url = null;
    card.classList.remove('is-on', 'is-playing');
    hideTimer = setTimeout(() => { if (!url) card.hidden = true; }, 250);
  }

  const unsub = onRadioChange((st) => {
    if (!url) return;
    if (st.url === url) { card.classList.toggle('is-playing', st.playing); return; }
    // This clip ended, failed or was replaced by another: hide (after the minimum time).
    const left = MIN_MS - (performance.now() - shownAt);
    clearTimeout(hideTimer);
    if (left > 0) hideTimer = setTimeout(() => { if (getRadioState().url !== url) hide(); }, left);
    else hide();
  });

  card.addEventListener('click', () => { if (driver != null) selectDriver(driver); });

  function show(clip) {
    const n = clip.driver_number;
    const d = data.driverByNumber.get(n);
    const pos = data.getPositionAt(n, clip.date);
    const lap = currentLap(data.getDriverLaps(n), clip.date);
    driver = n;
    url = clip.recording_url;
    shownAt = performance.now();
    const colour = d ? d.teamColour : '#8a8fa0';
    card.style.setProperty('--tc', colour);
    num.style.setProperty('--tc', colour);
    num.style.setProperty('--tx', isLight(colour) ? '#0a0b10' : '#ffffff');
    num.textContent = d ? String(d.number) : String(n);
    name.textContent = d ? (d.fullName || d.acronym) : `Car ${n}`;
    team.textContent = d ? d.teamName || '' : '';
    meta.textContent = [pos ? `P${pos}` : '', lap ? `Lap ${lap.lap_number}` : ''].filter(Boolean).join(' · ');
    card.title = `Select ${d ? d.acronym : n}`;
    clearTimeout(hideTimer); clearTimeout(maxTimer);
    card.hidden = false;
    card.classList.remove('is-on');
    void card.offsetWidth; // restart the pop-in animation
    card.classList.add('is-on');
    card.classList.toggle('is-playing', getRadioState().url === url && getRadioState().playing);
    maxTimer = setTimeout(hide, MAX_MS);
  }

  return {
    show,
    dispose() { unsub(); clearTimeout(hideTimer); clearTimeout(maxTimer); card.remove(); },
  };
}

function isLight(hex) {
  const n = parseInt(hex.slice(1, 7), 16) || 0;
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150;
}
