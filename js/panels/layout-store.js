// Custom panel layout saved on this device (localStorage; storage may be unavailable).
// Transforms are rig-local (see CONTRACTS.md "Layout rig"), so re-centring carries them.
const KEY = 'f1vr.layout.v1';

function finite(a, n) {
  return Array.isArray(a) && a.length === n && a.every((v) => typeof v === 'number' && Number.isFinite(v));
}

const MIN_S = 0.5;
const MAX_S = 2.5;

/**
 * @returns {Object<string, {p: number[], q: number[], s: number}>} saved transforms by unit name
 *   ({} if none). `s` is the uniform scale (4b.13): 1 when missing (older saves), clamped to 0.5–2.5.
 */
export function loadLayout() {
  const out = {};
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    const items = raw && typeof raw.items === 'object' ? raw.items : {};
    for (const [name, it] of Object.entries(items)) {
      if (!it || !finite(it.p, 3) || !finite(it.q, 4)) continue;
      const s = typeof it.s === 'number' && Number.isFinite(it.s) && it.s > 0 ? Math.min(MAX_S, Math.max(MIN_S, it.s)) : 1;
      out[name] = { p: it.p, q: it.q, s };
    }
  } catch { /* no storage or bad JSON: defaults */ }
  return out;
}

/** @param {Object<string, {p: number[], q: number[], s?: number}>} items */
export function saveLayout(items) {
  try { localStorage.setItem(KEY, JSON.stringify({ items })); } catch { /* ignore */ }
}

export function clearLayout() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
