// Per-device settings (js/settings.js): Phase 8 mode defaults and choice validation.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
store.set('f1vr.settings', JSON.stringify({ trackView: 'sideways', vrMode: 'immersive', radio: 'yes' }));
const { getSettings, setSetting } = await import('../js/settings.js');

test('defaults: 2D track, flat screen, Screen mode in VR; bad stored values are ignored', () => {
  const s = getSettings();
  assert.equal(s.trackView, '2d');     // 'sideways' is not a choice
  assert.equal(s.screenShape, 'flat');
  assert.equal(s.vrMode, 'immersive'); // valid stored value kept
  assert.equal(s.radio, true);         // wrong type ignored
});

test('setSetting saves valid choices and ignores invalid ones', () => {
  setSetting('trackView', '3d');
  setSetting('screenShape', 'round');
  setSetting('nope', 1);
  const s = getSettings();
  assert.equal(s.trackView, '3d');
  assert.equal(s.screenShape, 'flat');
  const saved = JSON.parse(store.get('f1vr.settings'));
  assert.equal(saved.trackView, '3d');
  assert.equal(saved.nope, undefined);
});

test('13.3: Phase 13 settings: defaults, ranges and choices', () => {
  const s = getSettings();
  assert.equal(s.minis, false);
  assert.equal(s.overtakeAlerts, true);
  assert.equal(s.overtakeScope, 'all');
  setSetting('overtakeTopN', 25);
  setSetting('overtakeTopN', 4.5);
  assert.equal(s.overtakeTopN, 10);
  setSetting('overtakeTopN', 5);
  assert.equal(s.overtakeTopN, 5);
  setSetting('overtakeScope', 'some');
  assert.equal(s.overtakeScope, 'all');
  setSetting('screenView', 'standings');
  assert.equal(s.screenView, 'standings');
});
