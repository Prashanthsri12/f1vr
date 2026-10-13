// Per-device user settings (localStorage, wrapped: storage may be unavailable).
// Phase 8 modes: the desktop always uses Screen mode (a flat dashboard); in VR, vrMode picks
// Screen (the dashboard on one big flat or curved screen) or Immersive (floating panels).
const KEY = 'f1vr.settings';
const DEFAULTS = {
  radio: true, sfx: true, theme: 'pitwall', fps: false,
  trackView: '2d',       // Screen mode track tile: '2d' top-down | '3d' orbit
  screenShape: 'flat',   // Screen in VR: 'flat' | 'curved'
  vrMode: 'screen',      // VR: 'screen' | 'immersive'
};
/** Allowed values for the string settings that are choices (others only need the right type). */
const CHOICES = {
  trackView: ['2d', '3d'],
  screenShape: ['flat', 'curved'],
  vrMode: ['screen', 'immersive'],
};

let cache = null;

function valid(k, v) {
  if (typeof v !== typeof DEFAULTS[k]) return false;
  return !CHOICES[k] || CHOICES[k].includes(v);
}

function load() {
  if (cache) return cache;
  cache = { ...DEFAULTS };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    for (const k of Object.keys(DEFAULTS)) if (valid(k, raw[k])) cache[k] = raw[k];
  } catch { /* no storage: defaults */ }
  return cache;
}

/**
 * @returns {{radio: boolean, sfx: boolean, theme: string, fps: boolean,
 *   trackView: '2d'|'3d', screenShape: 'flat'|'curved', vrMode: 'screen'|'immersive'}}
 *   live settings object (read-only for callers)
 */
export function getSettings() {
  return load();
}

/** Set one setting and persist it. Unknown keys and invalid values are ignored. */
export function setSetting(key, value) {
  const s = load();
  if (!(key in DEFAULTS) || !valid(key, value)) return;
  s[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}
