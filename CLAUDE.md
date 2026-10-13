# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

F1 Pit Wall VR is a WebXR app for the Meta Quest 3 browser that also runs in desktop Chrome. It replays historical F1 sessions from the free OpenF1 API (`https://api.openf1.org/v1/`) in a 3D pit wall: a track table with moving cars, plus leaderboard, telemetry, laps/tyres, weather, a race control ticker, team radio, and a main screen.

- **Full spec:** `plan/F1_VR_PROMPT.md`. This is the source of truth for layout, data rules, controls and phases.
- **Progress:** `plan/BUILD_TRACKER.md`. **Update an item's status there as soon as it is created or finished**, keep the summary table counts in sync, and add a change-log entry when a phase completes. Record OpenF1 API differences from the spec in its "Open questions" section. Use `node plan/tracker.mjs <todo|wip|done|blocked|skip> <id...> [--note "..."]` to change statuses; it recomputes the summary table.
- **Module interfaces:** `plan/CONTRACTS.md` defines the signatures, the time and coordinate conventions, and the verified OpenF1 quirks. Change it first when an interface changes.

## Hard constraints (from the spec)

- Plain JavaScript ES modules, with three.js (and later hls.js) loaded through an import map from jsDelivr at an **exact pinned version**. No bundler, build step, framework or npm runtime dependencies. The repo is served as static files.
- Quest 3 performance budget: 72 fps, under 150 draw calls, under 300k triangles, **no per-frame allocation in the render loop**, canvas panels redrawn at most 10 Hz and only when their data changes.
- Comfort: never move the user's camera in XR.
- Ask the user before adding any dependency beyond three.js and hls.js, any paid service, or any change to the scene layout.
- No copyrighted media: no F1 or team logos, official fonts or broadcast streams.
- Do not guess OpenF1 behaviour. Check against https://openf1.org/docs, log samples, and report differences.
- Commit at the end of each phase and tell the user exactly what to test.

## Architecture (target, per spec §10)

- `js/api.js` holds the single rate-limited request queue (serial, backoff on 429/5xx) and reads from the cache first. `js/cache.js` is an IndexedDB store keyed by full URL that never expires, because historical data doesn't change.
- `js/session-data.js` loads the small datasets in full and streams `location` (all drivers) and `car_data` (selected driver only) in 60 s chunks around the playhead. It exposes a source-agnostic query interface (`getCarsAt(time)`, `getTelemetryAt(driver, time)`, `getLeaderboardAt(time)`, …) so a live source can replace it later without changes to scene code.
- `js/interp.js` handles binary search and linear interpolation over irregular, sorted timestamps.
- `js/playback.js` owns the playhead, a UTC session timestamp advanced by `delta * speed`. It pauses while a needed chunk is missing.
- `js/scene/` contains the world/XR session (one `immersive-ar` session toggles between the pit wall room and passthrough), the track (built from one clean lap of `location` data, normalised to 1.4 m, with the transform reused for every car), instanced cars and car labels, and the main screen (Video / Radio tabs).
- `js/panels/` holds `CanvasTexture` panels built on `panel-base.js`. Panels register clickable rects in canvas pixels, and one shared raycaster converts hit UVs to pixels.
- `js/input/` contains the XR controllers and hands (`xr-input.js`, button map in `xr-buttons.js`), table grab (`table-grab.js`), panel carrying (`panel-grab.js`) and mouse/keyboard input for the room preview (`desktop-input.js`). Panels live in a layout rig (`PanelManager.group`) that re-centre moves. Moved panels are saved per device by `js/panels/layout-store.js`.
- `js/screen/` is Screen mode (Phase 8): the desktop's flat dashboard. `screen-layout.js` (pure) places the tiles for landscape, portrait or narrow windows; `panel-host.js` shows the same panel canvases in the page; `track-view.js` draws the track in 2D or 3D in its own canvas; `main-tile.js` has the Video / Radio tabs. `vr-screen.js` is Screen in VR (the default VR view): the same panels re-parented onto one flat or curved screen in the layout rig, with the track rendered into a texture on its tile. The 3D room on desktop is only behind `?debug` ("Room preview").
- Phase 9 (style pass): panel theme and helpers in `panel-base.js` (`dfont`, `rgba`, `glowStroke`); the Insights panel (`js/panels/insights*.js`); the race timeline (`js/panels/timeline-marks.js`); race moment detection (`js/race-moments.js`, pure) shown by `js/screen/banner-dom.js` and `js/scene/banner-3d.js`; track colours (`js/scene/track-style.js`, meshes in `track-mesh.js`); car trails and halo (`car-fx.js`); rain and flag ambience. The extras are wired by `js/screen/dash-extras.js` (desktop) and `js/scene/vr-extras.js` (VR) to keep `dashboard.js` and `app.js` small. Analytics: pure maths in `js/analytics/` (lap table, race pace, strategy), charts in `js/panels/analytics-*.js` on `chart-kit.js`, shown as a main screen tab or the `screenView: 'analytics'` layout.
- Modules expose `init` / `update(time)` / `dispose`. Keep files under about 400 lines.

## Commands

```sh
npx serve .                  # serve locally (python isn't on PATH on this machine; `uv run python -m http.server` also works)
node --test                  # run unit tests in tests/ (pure logic only: interp, queue, indexing)
node --test tests/interp.test.js   # run a single test file
THREE_DIR=<three@0.160.0 package dir> node --import ./tests/support/three-register.mjs --test   # also run tests of three-importing modules (skipped otherwise)
```

Panel dev preview: `/dev/panel-preview?panels=leaderboard,telemetry&t=2024-03-02T15:40:00Z&driver=1&passthrough=1` draws panels against real cached data. With `?debug`, the desktop dashboard (and the room preview HUD) shows fps, draw calls, triangles and panel redraws per second.

WebXR needs HTTPS on the Quest. On desktop, use the Immersive Web Emulator Chrome extension; "Open on desktop" opens Screen mode, and with `?debug` "Room preview (debug)" shows the VR room. Deployment: every push to `master` deploys to https://prashanthsri12.github.io/f1vr/ through `.github/workflows/pages.yml`. Only `index.html`, `css/` and `js/` are published. **The repo is public**, so commit with the GitHub no-reply email (already set in this repo's git config).
