// Per-device user settings (localStorage, wrapped: storage may be unavailable).
const KEY = 'f1vr.settings';
const DEFAULTS = { radio: true, sfx: true };

let cache = null;

function load() {
  if (cache) return cache;
  cache = { ...DEFAULTS };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const k of Object.keys(DEFAULTS)) if (typeof raw[k] === typeof DEFAULTS[k]) cache[k] = raw[k];
  } catch { /* no storage: defaults */ }
  return cache;
}

/** @returns {{radio: boolean, sfx: boolean}} live settings object (read-only for callers) */
export function getSettings() {
  return load();
}

/** Set one setting and persist it. */
export function setSetting(key, value) {
  const s = load();
  if (!(key in DEFAULTS)) return;
  s[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
