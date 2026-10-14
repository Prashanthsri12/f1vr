// Per-device user settings (localStorage, wrapped: storage may be unavailable).
// Phase 8 modes: the desktop always uses Screen mode (a flat dashboard); in VR, vrMode picks
// Screen (the dashboard on one big flat or curved screen) or Immersive (floating panels).
const KEY = 'f1vr.settings';
const DEFAULTS = {
  radio: true, sfx: true, theme: 'pitwall', fps: false,
  radioAll: false,       // 11.1: autoplay every driver's team radio, not only the selected driver's
  trackView: '2d',       // Screen mode track tile: '2d' top-down | '3d' orbit
  screenShape: 'flat',   // Screen in VR: 'flat' | 'curved'
  vrMode: 'screen',      // VR: 'screen' | 'immersive'
  trackColours: 'sectors', // 9.8: 'sectors' | 'minis' | 'plain' (scene/track-style.js)
  banners: true,         // 9.11: race moment banners
  engine: false,         // 9.13: engine hum pitched by the selected driver's RPM
  fullSession: false,    // 9.29: analytics and the race timeline show the whole session (spoilers)
  screenView: 'dashboard', // 9.28: Screen mode / Screen in VR: 'dashboard' | 'analytics'
  hubTab: 'battle',      // 12.4: desktop hub tile tab
  minis: false,          // 13.4: mini-sectors (track colours, Laps panel) only when switched on
  overtakeAlerts: true,  // 13.6: overtake warnings ~10 s ahead (they look into the future)
  overtakeScope: 'all',  // 13.6: 'all' drivers | 'top' (fights for the top overtakeTopN positions)
  overtakeTopN: 10,      // 13.6: 3–20
  weatherFx: true,       // 13.9/13.10: weather animation (2D widget) and 3D weather
};
/** Allowed values for the string settings that are choices (others only need the right type). */
const CHOICES = {
  trackView: ['2d', '3d'],
  screenShape: ['flat', 'curved'],
  vrMode: ['screen', 'immersive'],
  trackColours: ['sectors', 'minis', 'plain'],
  screenView: ['dashboard', 'analytics', 'qualifying', 'standings'],
  hubTab: ['battle', 'h2h', 'driver', 'radio', 'video', 'analytics', 'quali'],
  overtakeScope: ['all', 'top'],
};
/** Allowed ranges for the number settings. */
const RANGES = { overtakeTopN: [3, 20] };

let cache = null;
const listeners = new Set();

function valid(k, v) {
  if (typeof v !== typeof DEFAULTS[k]) return false;
  if (RANGES[k]) return Number.isInteger(v) && v >= RANGES[k][0] && v <= RANGES[k][1];
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
 * @returns {{radio: boolean, radioAll: boolean, sfx: boolean, theme: string, fps: boolean,
 *   trackView: '2d'|'3d', screenShape: 'flat'|'curved', vrMode: 'screen'|'immersive',
 *   trackColours: 'sectors'|'minis'|'plain', banners: boolean, engine: boolean,
 *   fullSession: boolean, screenView: 'dashboard'|'analytics'|'qualifying'|'standings', hubTab: string,
 *   minis: boolean, overtakeAlerts: boolean, overtakeScope: 'all'|'top', overtakeTopN: number, weatherFx: boolean}}
 *   live settings object (read-only for callers)
 */
export function getSettings() {
  return load();
}

/** Set one setting and persist it. Unknown keys and invalid values are ignored. */
export function setSetting(key, value) {
  const s = load();
  if (!(key in DEFAULTS) || !valid(key, value)) return;
  if (s[key] === value) return;
  s[key] = value;
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
  for (const cb of listeners) { try { cb(key, value); } catch (e) { console.warn('[f1vr] settings listener', e); } }
}

/**
 * 13.3: be told when a setting changes (the settings drawer and the toolbar buttons stay in step).
 * @param {(key: string, value: any) => void} cb
 * @returns {() => void} unsubscribe
 */
export function onSettingsChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
