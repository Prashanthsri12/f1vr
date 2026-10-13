// Video source settings (js/video-settings.js): storage round trip and source kinds.
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { loadVideoSettings, saveVideoSettings, isHlsUrl } = await import('../js/video-settings.js');

test('no source by default', () => {
  store.clear();
  assert.deepEqual(loadVideoSettings(), { kind: 'none', url: '', name: '', offsetSec: 0, sync: false });
});

test('mp4 URL, offset and sync round trip', () => {
  store.clear();
  saveVideoSettings({ url: 'https://example.org/clip.mp4', offsetSec: 12.5, sync: true });
  const s = loadVideoSettings();
  assert.equal(s.kind, 'url');
  assert.equal(s.url, 'https://example.org/clip.mp4');
  assert.equal(s.offsetSec, 12.5);
  assert.equal(s.sync, true);
});

test('m3u8 URLs are HLS, with or without a query string', () => {
  assert.equal(isHlsUrl('https://x.org/live/index.m3u8'), true);
  assert.equal(isHlsUrl('https://x.org/live/index.M3U8?token=1'), true);
  assert.equal(isHlsUrl('https://x.org/a.mp4'), false);
  store.clear();
  saveVideoSettings({ url: 'https://x.org/s.m3u8' });
  assert.equal(loadVideoSettings().kind, 'hls');
});

test('a partial save keeps the other fields', () => {
  store.clear();
  saveVideoSettings({ url: 'https://x.org/a.webm', offsetSec: 3 });
  saveVideoSettings({ sync: true });
  const s = loadVideoSettings();
  assert.equal(s.url, 'https://x.org/a.webm');
  assert.equal(s.offsetSec, 3);
  assert.equal(s.sync, true);
});

test('bad stored JSON and wrong types fall back to defaults', () => {
  store.clear();
  store.set('f1vr.video', '{not json');
  assert.equal(loadVideoSettings().kind, 'none');
  store.set('f1vr.video', JSON.stringify({ url: 5, offsetSec: 'x', sync: 'yes' }));
  assert.deepEqual(loadVideoSettings(), { kind: 'none', url: '', name: '', offsetSec: 0, sync: false });
});
