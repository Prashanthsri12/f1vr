// Desktop layout (js/screen/dash-layout.js, 12.2): tiles inside the content, no overlaps,
// side columns aligned, one scale for every panel column.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDashLayout, DASH_TILES, ANALYTICS_TILES } from '../js/screen/dash-layout.js';

const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function check(l, names, w) {
  for (const n of names) {
    const r = l.tiles[n];
    assert.ok(r && r.w > 0 && r.h > 0, `${w}: ${n} missing`);
    assert.ok(r.x >= 0 && r.x + r.w <= l.width + 1 && r.y + r.h <= l.height + 1, `${w}: ${n} outside`);
  }
  const all = ['topbar', ...names];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) assert.ok(!overlap(l.tiles[all[i]], l.tiles[all[j]]), `${w}: ${all[i]} overlaps ${all[j]}`);
  }
}

test('dashboard layout: every size, no overlaps, readable scale', () => {
  for (const [w, h] of [[1920, 1080], [2048, 968], [1366, 768], [2560, 1440], [1080, 1800], [1440, 2560], [520, 900]]) {
    for (const top of [52, 96]) {
      const l = computeDashLayout(w, h, { top });
      check(l, DASH_TILES, `${w}x${h}/${top}`);
      assert.ok(l.scale >= 0.42 - 1e-9, `${w}x${h}: scale ${l.scale}`);
    }
  }
  assert.equal(computeDashLayout(1920, 1080).orientation, 'landscape');
  assert.equal(computeDashLayout(1080, 1800).orientation, 'portrait');
  assert.equal(computeDashLayout(520, 900).orientation, 'stack');
});

test('dashboard layout: side columns share one width and the playback bar spans the track column', () => {
  const t = computeDashLayout(1920, 1080).tiles;
  assert.equal(t.leaderboard.w, t.telemetry.w);
  assert.equal(t.laps.w, t.hub.w);
  assert.equal(t.playbackBar.x, t.track.x);
  assert.equal(t.playbackBar.w, t.track.w);
  const p = computeDashLayout(1080, 1800).tiles;
  assert.equal(p.leaderboard.w, p.telemetry.w);
  assert.equal(p.playbackBar.w, p.track.w);
  const f = computeDashLayout(1920, 1080, { focus: 'main' }).tiles;
  assert.deepEqual(f.hub, t.track);
});

test('analytics layout: charts, track, leaderboard and bar without overlaps', () => {
  for (const [w, h] of [[1920, 1080], [2048, 968], [1366, 768], [1080, 1800]]) {
    check(computeDashLayout(w, h, { view: 'analytics' }), ANALYTICS_TILES, `analytics ${w}x${h}`);
  }
});

test('8.14: short landscape windows (Quest browser): track and playback bar stay inside the window', () => {
  for (const [w, h] of [[1280, 720], [1366, 768], [1280, 600]]) {
    const l = computeDashLayout(w, h);
    assert.equal(l.orientation, 'landscape');
    const b = l.tiles.playbackBar;
    assert.ok(b.y + b.h <= h - 10 + 1, `${w}x${h}: playback bar ends at ${b.y + b.h}`);
    assert.ok(l.tiles.track.h >= 200, `${w}x${h}: track ${l.tiles.track.h}`);
  }
  // Tall enough windows keep the bottoms aligned.
  const t = computeDashLayout(1920, 1080).tiles;
  assert.equal(t.playbackBar.y + t.playbackBar.h, t.laps.y + t.laps.h);
});
