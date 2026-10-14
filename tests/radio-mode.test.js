// radio-mode.js: Off / Driver / All from the radio and radioAll settings (11.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { radioMode, cycleRadioMode } from '../js/radio-mode.js';

test('radio mode cycles Off → Driver → All → Off and maps to the two settings', () => {
  const s = { radio: false, radioAll: false };
  const set = (k, v) => { s[k] = v; };
  assert.equal(radioMode(s), 'off');
  assert.equal(cycleRadioMode(s, set), 'driver');
  assert.deepEqual(s, { radio: true, radioAll: false });
  assert.equal(cycleRadioMode(s, set), 'all');
  assert.deepEqual(s, { radio: true, radioAll: true });
  assert.equal(cycleRadioMode(s, set), 'off');
  assert.deepEqual(s, { radio: false, radioAll: false });
  assert.equal(radioMode({ radio: false, radioAll: true }), 'off'); // radio off wins
});
