// Screen mode layout (js/screen/screen-layout.js): every tile inside the content, no overlaps,
// readable panel scale, landscape / portrait / stack by window shape, and the focus swap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeScreenLayout, containRect, TILE_NAMES, MIN_SCALE } from '../js/screen/screen-layout.js';

const SIZES = {
  '1080p': [1920, 1080],
  ultrawide: [2560, 1080],
  '1440p': [2560, 1440],
  '4k': [3840, 2160],
  '4:3': [1600, 1200],
  laptop: [1366, 768],
  'portrait 9:16': [1080, 1920],
  'portrait 3:4': [1200, 1600],
  narrow: [520, 900],
  tiny: [320, 480],
};

function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

for (const [name, [w, h]] of Object.entries(SIZES)) {
  test(`${name} (${w}x${h}): tiles fit, don't overlap, text stays readable`, () => {
    const l = computeScreenLayout(w, h);
    assert.ok(l.height >= h, 'content is at least the window height');
    assert.ok(l.scale >= MIN_SCALE - 1e-9 || l.orientation === 'stack', `scale ${l.scale}`);
    for (const n of TILE_NAMES) {
      const r = l.tiles[n];
      assert.ok(r, `tile ${n}`);
      assert.ok(r.w > 0 && r.h > 0, `${n} has a size`);
      assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= l.height, `${n} inside: ${JSON.stringify(r)}`);
    }
    for (let i = 0; i < TILE_NAMES.length; i++) {
      for (let j = i + 1; j < TILE_NAMES.length; j++) {
        const a = TILE_NAMES[i], b = TILE_NAMES[j];
        assert.ok(!overlaps(l.tiles[a], l.tiles[b]), `${a} overlaps ${b}`);
      }
    }
  });
}

test('common landscape monitors fit without scrolling and use the landscape layout', () => {
  for (const [w, h] of [[1920, 1080], [2560, 1080], [2560, 1440], [3840, 2160], [1600, 1200]]) {
    const l = computeScreenLayout(w, h);
    assert.equal(l.orientation, 'landscape', `${w}x${h}`);
    assert.equal(l.height, h, `${w}x${h} scrolls`);
  }
});

test('vertical monitors use the portrait layout; narrow windows stack', () => {
  assert.equal(computeScreenLayout(1080, 1920).orientation, 'portrait');
  assert.equal(computeScreenLayout(1440, 2560).orientation, 'portrait');
  assert.equal(computeScreenLayout(1080, 1920).height, 1920);
  assert.equal(computeScreenLayout(520, 900).orientation, 'stack');
});

test('the track is the biggest tile; focus "main" swaps it with the main screen', () => {
  for (const [w, h] of [[1920, 1080], [1080, 1920]]) {
    const a = computeScreenLayout(w, h);
    const area = (r) => r.w * r.h;
    for (const n of TILE_NAMES) if (n !== 'track') assert.ok(area(a.tiles.track) >= area(a.tiles[n]), `${w}x${h}: ${n} bigger than track`);
    const b = computeScreenLayout(w, h, { focus: 'main' });
    assert.deepEqual(b.tiles.main, a.tiles.track);
    assert.deepEqual(b.tiles.track, a.tiles.main);
  }
});

test('containRect keeps the aspect and centres', () => {
  const r = containRect({ x: 10, y: 20, w: 400, h: 100 }, 0.5);
  assert.equal(r.h, 100);
  assert.equal(r.w, 200);
  assert.equal(r.x, 110);
  assert.equal(r.y, 20);
  const t = containRect({ x: 0, y: 0, w: 100, h: 400 }, 1);
  assert.deepEqual(t, { x: 0, y: 150, w: 100, h: 100 });
});

test('9.18: insights sits under telemetry; the main screen and weather share the last row', () => {
  const l = computeScreenLayout(1920, 1080);
  const { telemetry: tel, insights: ins, main, weather: wx } = l.tiles;
  assert.equal(ins.x, tel.x);
  assert.equal(ins.w, tel.w);
  assert.ok(ins.y > tel.y + tel.h - 1);
  assert.equal(main.y, wx.y);
  assert.ok(main.y > ins.y + ins.h - 1);
  assert.ok(main.x < wx.x && main.w > wx.w);
  assert.ok(wx.x + wx.w <= tel.x + tel.w + 1);
  const p = computeScreenLayout(1080, 1920).tiles;
  assert.equal(p.insights.y, p.weather.y);
});
