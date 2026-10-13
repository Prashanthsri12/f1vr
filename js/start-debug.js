// Debug panel on the start page (Phase 1): inspect a loaded SessionData and sample car positions.

import { getQueue } from './api.js';

const SAMPLE_TIMEOUT_MS = 90000;

function iso(t) {
  return Number.isFinite(t) ? new Date(t).toISOString() : String(t);
}

function h(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  Object.assign(n, props);
  n.append(...children.filter((c) => c != null));
  return n;
}

/**
 * Builds the debug UI inside `root`.
 * @param {HTMLElement} root
 * @param {{ getSessionKey: () => number|null, getSessionLabel: () => string }} opts
 */
export function initDebug(root, { getSessionKey, getSessionLabel }) {
  let data = null;
  let unsubscribe = null;
  let lastStatus = null;
  let busy = false;

  const btnLoad = h('button', { type: 'button', className: 'btn btn--small', textContent: 'Load debug info' });
  const queueLine = h('p', { className: 'hint', textContent: 'Queue: idle' });
  const info = h('div');
  const timeInput = h('input', { type: 'text', id: 'debug-time', placeholder: '2024-03-02T15:13:42.341Z', spellcheck: false });
  timeInput.style.flex = '1 1 260px';
  const btnSample = h('button', { type: 'button', className: 'btn btn--small', textContent: 'Sample position', disabled: true });
  const out = h('pre', { className: 'debug__out', textContent: 'Select a session above, then load debug info.' });

  root.replaceChildren(h('div', { className: 'debug' },
    h('div', { className: 'debug__row' }, btnLoad),
    queueLine,
    info,
    h('div', { className: 'debug__row' },
      h('label', { htmlFor: 'debug-time', className: 'hint', textContent: 'Time (UTC ISO)' }), timeInput, btnSample),
    out,
  ));

  // Request queue / loading status line, refreshed while the panel is open.
  function refreshQueue() {
    let pending = '?';
    try { pending = getQueue().pending; } catch { /* api not ready */ }
    const s = lastStatus;
    const dataPart = s ? ` · chunks: ${s.loading ? 'loading' : 'idle'} (${s.pending} pending)${s.error ? ` · error: ${s.error.message}` : ''}` : '';
    queueLine.textContent = `Queue: ${pending} request(s) pending${dataPart}`;
  }
  setInterval(() => {
    if (root.offsetParent === null) return; // start page hidden (app running): no work
    const details = root.closest('details');
    if (!details || details.open) refreshQueue();
  }, 500);

  function renderInfo() {
    const rows = data.drivers.map((d) => h('tr', {},
      h('td', { textContent: String(d.number) }),
      h('td', { textContent: d.acronym || '' }),
      h('td', {}, (() => { const s = h('span', { className: 'swatch' }); s.style.background = d.teamColour || '#888'; return s; })(), d.teamName || ''),
      h('td', { textContent: d.teamColour || '' }),
    ));
    const table = h('table', { className: 'debug__table' },
      h('thead', {}, h('tr', {}, ...['No.', 'Driver', 'Team', 'Colour'].map((t) => h('th', { textContent: t })))),
      h('tbody', {}, ...rows));
    const s = data.session || {};
    const facts = [
      `Session: ${s.name || ''} ${s.type ? `[${s.type}]` : ''} ${s.circuit || ''} ${s.country || ''} ${s.year || ''} (key ${s.key ?? getSessionKey()})`,
      `Session start/end: ${iso(s.start)} → ${iso(s.end)}`,
      `Drivers: ${data.drivers.length}   Total laps: ${data.totalLaps}`,
      `Race start: ${iso(data.raceStartTime)}`,
      `Data start: ${iso(data.dataStartTime)}   Data end: ${iso(data.dataEndTime)}`,
      `hasIntervals: ${data.hasIntervals}   hasDrs: ${data.hasDrs}`,
    ].join('\n');
    info.replaceChildren(h('pre', { className: 'debug__out', textContent: facts }), h('div', { className: 'debug__table-wrap' }, table));
  }

  btnLoad.addEventListener('click', async () => {
    const key = getSessionKey();
    if (!key || busy) { if (!key) out.textContent = 'No session selected.'; return; }
    busy = true;
    btnLoad.disabled = true;
    btnSample.disabled = true;
    info.replaceChildren();
    out.textContent = `Loading ${getSessionLabel() || key}…`;
    if (unsubscribe) { try { unsubscribe(); } catch { /* ignore */ } unsubscribe = null; }
    if (data) { try { data.dispose(); } catch { /* ignore */ } data = null; }
    lastStatus = null;
    const t0 = performance.now();
    try {
      const { SessionData } = await import('./session-data.js');
      const loaded = await SessionData.load(key, {
        onProgress: ({ step, done, total } = {}) => { out.textContent = `Loading ${step}… (${done}/${total})`; },
      });
      data = loaded;
      unsubscribe = data.onStatus((st) => { lastStatus = st; refreshQueue(); });
      renderInfo();
      timeInput.value = iso(data.raceStartTime + 10 * 60 * 1000);
      btnSample.disabled = false;
      out.textContent = `Loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s. Pick a time and sample positions.`;
      console.log('[f1vr debug] SessionData', data);
    } catch (err) {
      console.error(err);
      out.textContent = `Load failed: ${err && err.message ? err.message : err}${err && err.status ? ` (HTTP ${err.status})` : ''}\nPress "Load debug info" to retry.`;
    } finally {
      busy = false;
      btnLoad.disabled = false;
    }
  });

  btnSample.addEventListener('click', async () => {
    if (!data) return;
    const t = Date.parse(timeInput.value.trim());
    if (!Number.isFinite(t)) { out.textContent = 'Invalid time. Use an ISO timestamp like 2024-03-02T15:13:42Z.'; return; }
    btnSample.disabled = true;
    lastStatus = null; // ignore errors from earlier requests
    out.textContent = `Waiting for location chunk covering ${iso(t)}…`;
    const t0 = performance.now();
    try {
      data.setPlayhead(t, 1);
      await waitReady(data, t, () => lastStatus);
      const cars = [];
      data.getCarsAt(t, cars);
      const lines = cars.map((c) => {
        const d = data.driverByNumber.get(c.number);
        const f = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v)).padStart(9);
        return `${String(c.number).padStart(3)} ${(d && d.acronym || '???').padEnd(4)} x${f(c.x)} y${f(c.y)} z${f(c.z)}  ${c.visible ? 'visible' : 'hidden'}`;
      });
      const visible = cars.filter((c) => c.visible).length;
      out.textContent = `t = ${iso(t)}  (ready after ${((performance.now() - t0) / 1000).toFixed(1)} s, ${visible}/${cars.length} visible)\n\n${lines.join('\n')}`;
    } catch (err) {
      console.error(err);
      out.textContent = `Sample failed: ${err && err.message ? err.message : err}`;
    } finally {
      btnSample.disabled = false;
    }
  });
}

/** Resolves when data.isReady(t), polling every 250 ms; rejects on a status error or timeout. */
function waitReady(data, t, getStatus) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (data.isReady(t)) return resolve();
      const s = getStatus();
      if (s && s.error && !s.loading) return reject(s.error);
      if (Date.now() - start > SAMPLE_TIMEOUT_MS) return reject(new Error('Timed out waiting for the location chunk.'));
      // Keep asking for the chunk in case it was evicted or scheduling is lazy.
      data.setPlayhead(t, 1);
      setTimeout(tick, 250);
    };
    tick();
  });
}
