// Start page: season / weekend / session picker, desktop preview launcher, cache tools and debug panel.
// SessionData and the 3D app are imported lazily so the picker works even if the scene fails to load.

import { fetchJson } from './api.js';
import { cacheClear } from './cache.js';
import { initDebug } from './start-debug.js';

const FIRST_SEASON = 2023;
const STORAGE_KEY = 'f1vr.lastChoice';

const $ = (id) => document.getElementById(id);
const el = {
  startPage: $('start-page'),
  appContainer: $('app-container'),
  season: $('season-select'),
  weekends: $('weekend-list'),
  sessions: $('session-list'),
  pickError: $('pick-error'),
  btnVr: $('btn-enter-vr'),
  btnPt: $('btn-enter-pt'),
  btnPreview: $('btn-preview'),
  xrStatus: $('xr-status'),
  loadStatus: $('load-status'),
  loadError: $('load-error'),
  btnClear: $('btn-clear-cache'),
  cacheStatus: $('cache-status'),
  debugRoot: $('debug-root'),
};

const state = {
  season: null,
  meetings: [],
  meetingKey: null,
  sessions: [],
  sessionKey: null,
  busy: false,
  app: null,     // { handle, data } while the 3D app is running
  xr: { vr: false, ar: false }, // immersive modes this browser supports
};

let pickToken = 0; // invalidates stale season/meeting responses

// ---------- small helpers ----------

/** @returns {{season?:number, meetingKey?:number, sessionKey?:number}} */
function loadChoice() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function saveChoice() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      season: state.season, meetingKey: state.meetingKey, sessionKey: state.sessionKey,
    }));
  } catch { /* storage unavailable: ignore */ }
}

const nowMs = () => Date.now();
const currentYear = () => new Date().getUTCFullYear();
const isPast = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) && t <= nowMs(); };

function formatDate(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateTime(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function friendlyError(err) {
  const status = err && err.status;
  if (status === 429) return 'OpenF1 is rate-limiting requests. Wait a moment and retry.';
  if (status >= 500) return `OpenF1 returned a server error (${status}). Retry in a moment.`;
  if (status) return `OpenF1 request failed (HTTP ${status}).`;
  if (err instanceof TypeError) return 'Could not reach OpenF1. Check your connection and retry.';
  return `Something went wrong: ${err && err.message ? err.message : err}`;
}

/** Show or hide an inline error box with a retry action. */
function showError(box, err, retry) {
  if (!err) { box.hidden = true; return; }
  console.error(err);
  box.querySelector('.error__text').textContent = friendlyError(err);
  const btn = box.querySelector('.error__retry');
  btn.onclick = () => { box.hidden = true; retry(); };
  box.hidden = false;
}

function setStatus(text, busy = false) {
  el.loadStatus.textContent = text;
  el.loadStatus.classList.toggle('status--busy', busy && !!text);
}

function emptyNote(container, text) {
  container.replaceChildren();
  const p = document.createElement('p');
  p.className = 'choice-list__empty';
  p.textContent = text;
  container.append(p);
}

/** Creates a selectable list item button. */
function makeChoice({ name, meta, flagUrl, flagText, selected, onSelect }) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'choice';
  b.setAttribute('role', 'option');
  b.setAttribute('aria-selected', String(!!selected));
  if (flagUrl || flagText) {
    const fallback = () => {
      const s = document.createElement('span');
      s.className = 'choice__flag-text';
      s.textContent = flagText || '';
      return s;
    };
    if (flagUrl) {
      const img = document.createElement('img');
      img.className = 'choice__flag';
      img.src = flagUrl;
      img.alt = flagText ? `${flagText} flag` : '';
      img.loading = 'lazy';
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
      b.append(img);
    } else {
      b.append(fallback());
    }
  }
  const body = document.createElement('span');
  body.className = 'choice__body';
  const n = document.createElement('span');
  n.className = 'choice__name';
  n.textContent = name;
  const m = document.createElement('span');
  m.className = 'choice__meta';
  m.textContent = meta;
  body.append(n, m);
  b.append(body);
  b.addEventListener('click', onSelect);
  return b;
}

function updateButtons() {
  const off = state.busy || !state.sessionKey;
  el.btnPreview.disabled = off;
  el.btnVr.disabled = off || !(state.xr.vr || state.xr.ar);
  el.btnPt.disabled = off || !state.xr.ar;
  el.btnPt.hidden = !state.xr.ar && state.xr.vr; // VR-only device: no passthrough toggle
}

// ---------- season / weekend / session ----------

function fillSeasons() {
  el.season.replaceChildren();
  for (let y = currentYear(); y >= FIRST_SEASON; y--) {
    const o = document.createElement('option');
    o.value = String(y);
    o.textContent = String(y);
    el.season.append(o);
  }
}

/** Fetch and filter the completed, non-cancelled race weekends for a year (newest first). */
const meetingsMemo = new Map(); // year -> Promise<raw meetings>, per page load

async function fetchMeetings(year) {
  // The current season's list changes as weekends happen, so only cache past seasons in IndexedDB.
  if (!meetingsMemo.has(year)) {
    const p = fetchJson('meetings', { year }, { cache: year < currentYear() });
    p.catch(() => meetingsMemo.delete(year));
    meetingsMemo.set(year, p);
  }
  const raw = await meetingsMemo.get(year);
  return (Array.isArray(raw) ? raw : [])
    .filter((m) => !m.is_cancelled && isPast(m.date_start))
    .filter((m) => !/testing/i.test(`${m.meeting_name || ''} ${m.meeting_official_name || ''}`))
    .sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start));
}

async function selectSeason(year, preferredMeetingKey) {
  const token = ++pickToken;
  state.season = year;
  el.season.value = String(year);
  state.meetings = [];
  state.meetingKey = null;
  state.sessions = [];
  state.sessionKey = null;
  updateButtons();
  showError(el.pickError, null);
  emptyNote(el.weekends, 'Loading race weekends…');
  el.sessions.replaceChildren();
  let meetings;
  try {
    meetings = await fetchMeetings(year);
  } catch (err) {
    if (token !== pickToken) return;
    emptyNote(el.weekends, 'Could not load race weekends.');
    showError(el.pickError, err, () => selectSeason(year, preferredMeetingKey));
    return;
  }
  if (token !== pickToken) return;
  state.meetings = meetings;
  if (!meetings.length) {
    emptyNote(el.weekends, 'No completed race weekends for this season yet.');
    saveChoice();
    return;
  }
  const pick = meetings.find((m) => m.meeting_key === preferredMeetingKey) || meetings[0];
  renderWeekends(pick.meeting_key);
  await selectMeeting(pick.meeting_key, loadChoice().sessionKey);
}

function renderWeekends(selectedKey) {
  el.weekends.replaceChildren(...state.meetings.map((m) => makeChoice({
    name: m.meeting_name || m.country_name || m.circuit_short_name || `Meeting ${m.meeting_key}`,
    meta: [m.circuit_short_name, formatDate(m.date_start)].filter(Boolean).join(' · '),
    flagUrl: m.country_flag,
    flagText: m.country_code || m.country_name || '',
    selected: m.meeting_key === selectedKey,
    onSelect: () => selectMeeting(m.meeting_key),
  })));
}

async function selectMeeting(meetingKey, preferredSessionKey) {
  const token = ++pickToken;
  state.meetingKey = meetingKey;
  state.sessions = [];
  state.sessionKey = null;
  updateButtons();
  renderWeekends(meetingKey);
  showError(el.pickError, null);
  emptyNote(el.sessions, 'Loading sessions…');
  let raw;
  try {
    raw = await fetchJson('sessions', { meeting_key: meetingKey }, { cache: state.season < currentYear() });
  } catch (err) {
    if (token !== pickToken) return;
    emptyNote(el.sessions, 'Could not load sessions.');
    showError(el.pickError, err, () => selectMeeting(meetingKey, preferredSessionKey));
    return;
  }
  if (token !== pickToken) return;
  // Hide sessions that have not finished yet (or are cancelled).
  state.sessions = (Array.isArray(raw) ? raw : [])
    .filter((s) => !s.is_cancelled && isPast(s.date_end || s.date_start))
    .sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start));
  if (!state.sessions.length) {
    emptyNote(el.sessions, 'No completed sessions for this weekend.');
    saveChoice();
    return;
  }
  const byName = (n) => state.sessions.find((s) => s.session_name === n);
  const pick = state.sessions.find((s) => s.session_key === preferredSessionKey)
    || byName('Race') || byName('Sprint')
    || state.sessions[state.sessions.length - 1];
  selectSession(pick.session_key);
}

function selectSession(sessionKey) {
  state.sessionKey = sessionKey;
  el.sessions.replaceChildren(...state.sessions.map((s) => makeChoice({
    name: s.session_name || s.session_type || `Session ${s.session_key}`,
    meta: formatDateTime(s.date_start),
    selected: s.session_key === sessionKey,
    onSelect: () => selectSession(s.session_key),
  })));
  saveChoice();
  updateButtons();
}

// ---------- XR detection ----------

async function detectXr() {
  if (!('xr' in navigator) || !navigator.xr) {
    el.xrStatus.textContent = window.isSecureContext
      ? 'WebXR is not available in this browser. Use the Quest browser, or "Preview on desktop".'
      : 'WebXR needs HTTPS. Open this page over https:// (or localhost), or use "Preview on desktop".';
    return;
  }
  const check = async (mode) => {
    try { return await navigator.xr.isSessionSupported(mode); } catch { return false; }
  };
  const [vr, ar] = await Promise.all([check('immersive-vr'), check('immersive-ar')]);
  state.xr = { vr, ar };
  if (!vr && !ar) {
    el.xrStatus.textContent = 'This device does not support immersive WebXR. Use "Preview on desktop".';
  } else {
    el.xrStatus.textContent = ar
      ? 'Ready: "Enter VR" starts in the pit wall room, "Enter Passthrough" in your real room. Toggle with B.'
      : 'VR only on this device (no passthrough).';
  }
  updateButtons();
}

// ---------- enter XR ----------

/**
 * Enter an immersive session. requestSession must run inside the click's user
 * activation, so it is called before any await; data then loads in the headset.
 * immersive-ar is preferred even for "Enter VR" so pit wall / passthrough can be
 * toggled in one session; VR-only devices fall back to immersive-vr.
 * @param {'pitwall'|'passthrough'} startMode
 */
function startXr(startMode) {
  if (state.busy || !state.sessionKey || !navigator.xr) return;
  const xrMode = state.xr.ar ? 'immersive-ar' : 'immersive-vr';
  const sessionPromise = navigator.xr.requestSession(xrMode, {
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['hand-tracking', 'bounded-floor'],
  });
  state.busy = true;
  updateButtons();
  showError(el.loadError, null);
  runXr(sessionPromise, xrMode, startMode);
}

async function runXr(sessionPromise, xrMode, startMode) {
  const sessionKey = state.sessionKey;
  let xrSession = null;
  let data = null;
  try {
    xrSession = await sessionPromise;
    setStatus('In headset…', true);
    el.appContainer.replaceChildren();
    el.appContainer.hidden = false;
    el.startPage.hidden = true;
    const [{ SessionData }, { startApp }] = await Promise.all([import('./session-data.js'), import('./app.js')]);
    const handle = await startApp({
      xrSession,
      xrMode,
      startMode,
      container: el.appContainer,
      onExit: exitPreview,
      loadData: async (onStep) => {
        data = await SessionData.load(sessionKey, {
          onProgress: ({ step } = {}) => onStep(`Loading ${STEP_LABELS[step] || step}…`),
        });
        return data;
      },
      onStatus: (st) => { if (st && st.error) console.warn('[f1vr] status error', st.error); },
    });
    state.app = { handle, data };
    setStatus('');
  } catch (err) {
    if (xrSession) xrSession.end().catch(() => {});
    el.appContainer.hidden = true;
    el.appContainer.replaceChildren();
    el.startPage.hidden = false;
    try { data && data.dispose(); } catch { /* ignore */ }
    setStatus('');
    showError(el.loadError, err, () => startXr(startMode));
  } finally {
    state.busy = false;
    updateButtons();
  }
}

// ---------- desktop preview ----------

const STEP_LABELS = { race_control: 'race control', team_radio: 'team radio' };

async function startPreview() {
  if (state.busy || !state.sessionKey) return;
  state.busy = true;
  updateButtons();
  showError(el.loadError, null);
  const steps = [];
  setStatus('Loading…', true);
  let data = null;
  let overlay = null;
  try {
    const { SessionData } = await import('./session-data.js');
    data = await SessionData.load(state.sessionKey, {
      onProgress: ({ step, done, total } = {}) => {
        const label = STEP_LABELS[step] || step;
        if (label && !steps.includes(label)) steps.push(label);
        const count = Number.isFinite(done) && Number.isFinite(total) ? ` (${done}/${total})` : '';
        setStatus(`Loading ${steps.slice(-4).join('… ')}…${count}`, true);
      },
    });
    setStatus(`Loading ${[...steps.slice(-3), 'track'].join('… ')}…`, true);
    const { startApp } = await import('./app.js');

    el.appContainer.replaceChildren();
    overlay = document.createElement('div');
    overlay.textContent = 'Loading track…';
    overlay.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#a3a3b2;font:600 20px var(--font);pointer-events:none';
    el.appContainer.append(overlay);
    el.appContainer.hidden = false;
    el.startPage.hidden = true;

    const handle = await startApp({
      data,
      container: el.appContainer,
      onExit: exitPreview,
      // app.js reports setup steps as strings ('Building track…'); tolerate objects too.
      onStatus: (s) => {
        if (typeof s === 'string') { if (overlay && overlay.isConnected) overlay.textContent = s; }
        else if (s && s.error) console.warn('[f1vr] status error', s.error);
      },
    });
    overlay.remove();
    state.app = { handle, data };
    setStatus('');
  } catch (err) {
    if (overlay) overlay.remove();
    el.appContainer.hidden = true;
    el.appContainer.replaceChildren();
    el.startPage.hidden = false;
    try { data && data.dispose(); } catch { /* ignore */ }
    setStatus('');
    showError(el.loadError, err, startPreview);
  } finally {
    state.busy = false;
    updateButtons();
  }
}

/** Tears down the running 3D app and returns to the start page. Safe to call more than once. */
function exitPreview() {
  const app = state.app;
  state.app = null;
  if (app) {
    try { app.handle && app.handle.dispose && app.handle.dispose(); } catch (err) { console.warn(err); }
    try { app.data && app.data.dispose && app.data.dispose(); } catch (err) { console.warn(err); }
  }
  el.appContainer.replaceChildren();
  el.appContainer.hidden = true;
  el.startPage.hidden = false;
  setStatus('');
  el.btnPreview.focus();
}

// ---------- cache ----------

async function clearCache() {
  el.btnClear.disabled = true;
  el.cacheStatus.textContent = 'Clearing…';
  try {
    await cacheClear();
    el.cacheStatus.textContent = `Cache cleared at ${new Date().toLocaleTimeString()}. Data will be downloaded again.`;
  } catch (err) {
    console.error(err);
    el.cacheStatus.textContent = 'Could not clear the cache.';
  } finally {
    el.btnClear.disabled = false;
  }
}

// ---------- boot ----------

async function pickDefaultSeason() {
  const saved = loadChoice();
  const year = currentYear();
  if (saved.season >= FIRST_SEASON && saved.season <= year) return saved.season;
  // Most recent season with at least one completed weekend.
  try {
    const meetings = await fetchMeetings(year);
    if (meetings.length) return year;
  } catch { /* fall through; selectSeason will surface errors */ }
  return Math.max(FIRST_SEASON, year - 1);
}

async function boot() {
  fillSeasons();
  el.season.addEventListener('change', () => selectSeason(Number(el.season.value)));
  el.btnPreview.addEventListener('click', startPreview);
  el.btnVr.addEventListener('click', () => startXr('pitwall'));
  el.btnPt.addEventListener('click', () => startXr('passthrough'));
  el.btnClear.addEventListener('click', clearCache);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.app) exitPreview();
  });
  detectXr();
  initDebug(el.debugRoot, {
    getSessionKey: () => state.sessionKey,
    getSessionLabel: () => {
      const s = state.sessions.find((x) => x.session_key === state.sessionKey);
      const m = state.meetings.find((x) => x.meeting_key === state.meetingKey);
      return s ? `${m ? m.meeting_name : ''} ${s.session_name} (${s.session_key})`.trim() : '';
    },
  });
  emptyNote(el.weekends, 'Loading race weekends…');
  const season = await pickDefaultSeason();
  await selectSeason(season, loadChoice().meetingKey);
}

boot();
