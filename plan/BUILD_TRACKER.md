# F1 Pit Wall VR: Build Tracker

Spec: [`F1_VR_PROMPT.md`](F1_VR_PROMPT.md). Section references (§) point to that file.

**Status key:** ⬜ Not started · 🟡 In progress · ✅ Done · ⛔ Blocked · ⏭️ Skipped/deferred

Update the item's status as soon as it is created or finished. Add a dated entry to the change log at the bottom when a phase is completed or a decision changes.

## Summary

| Phase | Name | Status | Items done |
|---|---|---|---|
| 0 | Project setup | ✅ | 5 / 5 |
| 1 | Data layer and start page | ✅ | 14 / 14 |
| 2 | Scene, track and cars (desktop preview) | ✅ | 13 / 13 |
| 3 | Panels | ✅ | 14 / 14 |
| 4 | WebXR | 🟡 | 6 / 14 |
| 5 | Main screen | ⬜ | 0 / 8 |
| 6 | Polish and performance | ⬜ | 0 / 12 |
| 7 | Deploy | ⬜ | 0 / 7 |

---

## Phase 0: Project setup

| ID | Item | Files | Status | Notes |
|---|---|---|---|---|
| 0.1 | Remove the uv/Python scaffold | `main.py`, `pyproject.toml`, `.python-version` | ✅ | Static JS only, per §1 |
| 0.2 | Create the build tracker | `plan/BUILD_TRACKER.md` | ✅ | |
| 0.3 | Update CLAUDE.md for the JS/WebXR project | `CLAUDE.md` | ✅ | |
| 0.4 | Update `.gitignore` for a static site (`node_modules/`, OS files) | `.gitignore` | ✅ | |
| 0.5 | Folder skeleton (`css/`, `js/scene`, `js/panels`, `js/input`, `tests/`) | — | ✅ | css/, js/, js/scene, js/input, tests/ |

## Phase 1: Data layer and start page

| ID | Item | Files | Status | Notes |
|---|---|---|---|---|
| 1.1 | Check the OpenF1 docs: endpoints, fields, filter syntax, rate limits. Record any differences from §2 | `plan/BUILD_TRACKER.md` (notes) | ✅ | Done. See Open questions + `plan/CONTRACTS.md` |
| 1.2 | IndexedDB cache keyed by full URL, no expiry, `clear()` | `js/cache.js` | ✅ | IDB with in-memory fallback |
| 1.3 | Request queue: rate limit, one request at a time, backoff on 429 and 5xx, cache-first | `js/api.js` | ✅ | Serial queue, 3/s and 30/min, backoff; 404 becomes [] |
| 1.4 | Binary search and linear interpolation helpers | `js/interp.js` | ✅ | |
| 1.5 | Session loader: small datasets loaded all at once, then indexed and sorted | `js/session-data.js` | ✅ | |
| 1.6 | Chunk loader: 60 s chunks for `location` (all drivers) and `car_data` (selected driver), with a buffer, eviction and prefetch at high speed | `js/session-data.js` | ✅ | |
| 1.7 | Live-ready interface: `getCarsAt`, `getTelemetryAt`, `getLeaderboardAt`, … | `js/session-data.js` | ✅ | §12 |
| 1.8 | Data fixes: `#` on team colour, (0,0,0) means hidden, DRS detection, intervals only for race/sprint | `js/session-data.js` | ✅ | §2 notes |
| 1.9 | Start page HTML with the import map (three.js pinned) | `index.html` | ✅ | |
| 1.10 | Start page styling: dark, red accent, Titillium Web, 48 px touch targets | `css/start.css` | ✅ | §9 |
| 1.11 | Season, weekend and session pickers using the real API; remember the last session in localStorage | `js/main.js` | ✅ | Hide future weekends |
| 1.12 | Loading progress, footer credit, "Clear cache" button | `index.html`, `js/main.js` | ✅ | |
| 1.13 | Debug view: driver list, lap count, one interpolated car position | `js/main.js` | ✅ | |
| 1.14 | Node tests for interp, the queue and indexing; manual test with the 2024 Bahrain race (20 drivers, correct lap count, instant second load) | `tests/*.test.js` | ✅ | 74 node tests pass; Bahrain 2024: 20 drivers, 57 laps; cached reload 0.43 s |

## Phase 2: Scene, track and cars (desktop preview)

| ID | Item | Files | Status | Notes |
|---|---|---|---|---|
| 2.1 | Renderer, camera, `local-floor` space setup, render loop | `js/scene/world.js` | ✅ | world.js; room 11 draw calls |
| 2.2 | Pit wall room: grid floor, low walls, light strips, fog, lighting | `js/scene/world.js` | ✅ | world.js; room 11 draw calls |
| 2.3 | Reference driver and clean-lap selection | `js/scene/track.js` | ✅ | Lives in session-data.js getReferenceLap (pending that agent) |
| 2.4 | Track outline: closed CatmullRom curve, ribbon mesh, centred and scaled to 1.4 m, z exaggerated 2x | `js/scene/track.js` | ✅ | |
| 2.5 | Start/finish line (sector markers optional) | `js/scene/track.js` | ✅ | |
| 2.6 | Cache track geometry per circuit in IndexedDB | `js/scene/track.js`, `js/cache.js` | ✅ | |
| 2.7 | Table group at 1.0 m in front, 0.9 m high | `js/scene/track.js` | ✅ | |
| 2.8 | Instanced cars with team colours, heading from interpolated motion, hidden when off track | `js/scene/cars.js` | ✅ | |
| 2.9 | Label atlas (acronym and position) facing the user | `js/scene/cars.js` | ✅ | Single texture |
| 2.10 | Selected car: larger, emissive pulse, 5 s fading trail | `js/scene/cars.js` | ✅ | |
| 2.11 | Playback: playhead, speeds, seek, start 2 min before lap 1, pause while loading | `js/playback.js` | ✅ | 12 node tests pass |
| 2.12 | Desktop input: keyboard shortcuts, OrbitControls, drag to rotate the table, scroll to scale | `js/input/desktop-input.js` | ✅ | Written; browser test pending |
| 2.13 | Manual test: smooth at 1x and 10x, no stutter when chunks load | — | ✅ | Headless Chrome: 1x and 10x smooth, no waits; 19 draw calls, 2k tris |

## Phase 3: Panels

| ID | Item | Files | Status | Notes |
|---|---|---|---|---|
| 3.1 | Panel base: CanvasTexture, 1024 px/m, redraw limited to 10 Hz, rect hit testing, shared raycaster, wait for fonts | `js/panels/panel-base.js` | ✅ | panel-base.js + layout.js + dev/panel-preview |
| 3.2 | Leaderboard (columns, header, track status pill, tap to select) | `js/panels/leaderboard.js` | ✅ | race-status.js checked against real SC/VSC/red-flag data |
| 3.3 | Practice/qualifying variant showing best lap instead of gaps | `js/panels/leaderboard.js` | ✅ | race-status.js checked against real SC/VSC/red-flag data |
| 3.4 | Telemetry: name, headshot or fallback tile, speed, gear, RPM, throttle, brake, DRS | `js/panels/telemetry.js` | ✅ | Headshot with tile fallback; trace cached per lap |
| 3.5 | Speed trace over distance, with the previous lap drawn faintly | `js/panels/telemetry.js` | ✅ | Headshot with tile fallback; trace cached per lap |
| 3.6 | Laps and tyres: running, last, personal best and session best times; coloured sectors; speed trap; stint strip | `js/panels/laps.js` | ✅ | |
| 3.7 | Weather panel with wind arrow and rain indicator | `js/panels/weather.js` | ✅ | |
| 3.8 | Race control ticker: flag background, scrolling, expands to show the last 5 | `js/panels/ticker.js` | ✅ | |
| 3.9 | Driver picker: arc of 20 tiles at waist height | `js/panels/driver-picker.js` | ✅ | |
| 3.10 | Playback bar: play/pause, speed, lap slider, elapsed time and session clock | `js/panels/playback-bar.js` | ✅ | |
| 3.11 | Place all panels per the §3 layout, facing the user | `js/scene/world.js` | ✅ | pit-wall.js + layout.js; picker is 2 rows of 10 (one arc can't fit) |
| 3.12 | Selection wiring: picking a driver updates telemetry, the car highlight and the leaderboard row | `js/main.js` | ✅ | Click tile or row selects; car, row, telemetry and laps follow |
| 3.13 | Panel transparency for passthrough (75%) | `js/panels/panel-base.js` | ✅ | |
| 3.14 | Manual test: values match the API at the same timestamp | — | ✅ | VER 15:23:42: 220 km/h, gear 6, 10075 rpm, exact match with raw car_data |

## Phase 4: WebXR

| ID | Item | Files | Status | Notes |
|---|---|---|---|---|
| 4.1 | `immersive-ar` session with `immersive-vr` fallback; "Enter VR" and "Enter Passthrough" buttons | `js/scene/world.js`, `js/main.js` | ✅ | immersive-ar preferred, immersive-vr fallback; data loads in-headset with a 3D loading card; session end returns to the start page |
| 4.2 | Pit wall / passthrough toggle without restarting the session | `js/scene/world.js` | ✅ | Same session; B toggles; Passthrough button hidden on VR-only devices |
| 4.3 | Controllers with laser rays, hit dot, red hover, hover scale | `js/input/xr-input.js` | ✅ | Pinned input-profiles@1.0.20 controller models; raycast only on move |
| 4.4 | Trigger to select, plus a haptic pulse | `js/input/xr-input.js` | ✅ | Trigger selects; 25 ms haptic pulse (verified in emulator) |
| 4.5 | Button mapping: A, B, X, Y, thumbsticks, left stick press | `js/input/xr-input.js` | ✅ | A, B, X, Y and right stick verified; seek repeats while held; left stick press calls recenter (action is 4.10) |
| 4.6 | Grab the table with one grip, scale (0.5x–3x) and rotate with two, double-press to reset | `js/input/xr-input.js`, `js/scene/track.js` | ⬜ | |
| 4.7 | Hand tracking: hand models, pinch as select (confirm Quest sends `select`) | `js/input/xr-input.js` | ⬜ | |
| 4.8 | Pinch and hold on the table edge to grab it | `js/input/xr-input.js` | ⬜ | |
| 4.9 | Wrist menu: shown when the palm is up or faces the user, with all §7 items | `js/panels/wrist-menu.js` | ⬜ | |
| 4.10 | Re-centre panels to the user's position and facing | `js/scene/world.js` | ⬜ | |
| 4.11 | Unlock AudioContext on the Enter click | `js/audio.js`, `js/main.js` | ⬜ | |
| 4.12 | Clear message when XR is unsupported | `js/main.js` | ✅ | Start page message for no WebXR, no HTTPS, or unsupported device (verified) |
| 4.13 | Test with the Immersive Web Emulator | — | ⬜ | |
| 4.14 | Test on Quest 3 (needs HTTPS, so a tunnel or an early Pages deploy) | — | ⬜ | User test |

## Phase 5: Main screen

| ID | Item | Files | Status | Notes |
|---|---|---|---|---|
| 5.1 | Screen mesh (2.4 m, 16:9, at 2.8 m) and tab buttons | `js/scene/screen.js` | ⬜ | |
| 5.2 | Onboard follow camera rendered to a 1024x576 target at 30 fps | `js/scene/onboard.js` | ⬜ | |
| 5.3 | Onboard overlay: speed, gear, position (drawn in the scene) | `js/scene/screen.js` | ⬜ | |
| 5.4 | Video tab: VideoTexture from an mp4/webm URL or a local file | `js/scene/screen.js` | ⬜ | |
| 5.5 | HLS through hls.js from a CDN when there is no native HLS | `js/scene/screen.js`, `index.html` | ⬜ | Pinned version |
| 5.6 | Video settings on the start page (collapsed section, localStorage, sync offset) and VR controls for play, mute and sync | `index.html`, `js/main.js` | ⬜ | Show the "Add a video source…" message when none is set |
| 5.7 | Radio tab: clip list for the selected driver with play buttons | `js/scene/screen.js` | ⬜ | |
| 5.8 | Manual test: onboard follows the car; a public sample mp4 plays | — | ⬜ | |

## Phase 6: Polish and performance

| ID | Item | Files | Status | Notes |
|---|---|---|---|---|
| 6.1 | Leaderboard rows slide over 0.5 s | `js/panels/leaderboard.js` | ⬜ | |
| 6.2 | Green/red flash on gaining/losing a place; purple fastest-lap marker | `js/panels/leaderboard.js` | ⬜ | |
| 6.3 | Retired drivers greyed out with "OUT" | `js/panels/leaderboard.js` | ⬜ | |
| 6.4 | Ticker flag colours, chequered pattern, flash on a new message | `js/panels/ticker.js` | ⬜ | |
| 6.5 | WebAudio effects: chime, overtake whoosh, fastest-lap beep | `js/audio.js` | ⬜ | Quiet; on/off toggle |
| 6.6 | Team radio: badge and autoplay for the selected driver | `js/audio.js`, `js/panels/telemetry.js` | ⬜ | |
| 6.7 | In-scene fps counter (toggled from the wrist menu) | `js/scene/world.js` | ⬜ | |
| 6.8 | Performance check: under 150 draw calls, under 300k triangles, no per-frame allocation | — | ⬜ | |
| 6.9 | Quest check: hold 72 fps | — | ⬜ | User test |
| 6.10 | Error handling: API down | `js/api.js`, `js/main.js` | ⬜ | |
| 6.11 | Error handling: sessions with missing data | `js/session-data.js` | ⬜ | |
| 6.12 | Pit lane line (optional, §4) | `js/scene/track.js` | ⬜ | Optional |

## Phase 7: Deploy

| ID | Item | Files | Status | Notes |
|---|---|---|---|---|
| 7.1 | GitHub Actions Pages workflow | `.github/workflows/pages.yml` | ⬜ | |
| 7.2 | Create the GitHub repo and push | — | ⬜ | Confirm with the user before pushing |
| 7.3 | Enable Pages and confirm the HTTPS URL works | — | ⬜ | |
| 7.4 | README: what it is, how to open it on Quest 3, controls table | `README.md` | ⬜ | |
| 7.5 | README: video source setup, running locally, data credit, known limits | `README.md` | ⬜ | |
| 7.6 | Final CLAUDE.md update | `CLAUDE.md` | ⬜ | |
| 7.7 | Final end-to-end test on Quest 3 | — | ⬜ | User test |

---

## Open questions and API differences

_(Record anything that differs from the spec, especially from OpenF1 docs verification in 1.1.)_

**OpenF1 check (2026-10-12), compared with spec §2:**
- Rate limit confirmed: 3 req/s and 30 req/min on the free tier.
- `pit.pit_duration` is **deprecated** (removed at the end of 2026). Use `lane_duration` and `stop_duration` instead.
- `intervals.gap_to_leader` and `interval` can be strings like `"+1 LAP"`. The spec assumed numbers.
- `intervals` is large (4.2 MB, about 30k records for the 2024 Bahrain race), not "small". It is still loaded in one request and cached.
- `race_control` has extra fields: `scope`, `sector`, `qualifying_phase`. Flags include `CLEAR` and `BLACK AND WHITE`.
- `drs` codes 2, 3 and 9 are undocumented ("?"). They are treated as off.
- Team radio coverage drops sharply from 2026 (per the docs).
- Extra endpoints exist that the spec doesn't use: `overtakes`, `session_result`, `starting_grid`, and championship standings (beta). These could help Phase 6 (overtake whoosh, retired/OUT).
- `location` timestamps jitter by ±100–200 ms (positions are fine). They are smoothed in `js/retime.js`.
- **Qualifying out-laps:** `lap_duration` includes garage time, so start + duration can land after the next lap starts. `lap-stats.js` ends a lap no later than the next lap's start.
- **Qualifying stints** overlap by one lap (`lap_end` 4, next `lap_start` 4).
- **SC/VSC/red flag end** with a `Flag CLEAR` scoped to Track ("TRACK CLEAR"), not with a SafetyCar message. A RED and a DOUBLE YELLOW can appear after the chequered flag (`race-status.js` handles this).
- **TODO (data layer):** `getLeaderboardAt().retired` misses cars that stop on track while still visible (2023 Australia: LEC, ALB). `leaderboard.js` has a local `_isOut` workaround; move it into session-data. Could use the `session_result` endpoint (dnf).
- **TODO (data layer):** `totalLaps` = max `lap_number` is 59 for 2023 Australia (a 58-lap race, red-flag restarts). Prefer `session_result.number_of_laps` for the winner.
- **Open layout question:** the driver picker tiles (waist height at 0.62 m) hover over the near part of the track table. Waiting on the user's decision.
- Location data begins about an hour before the session `date_start`. The race starts at the min lap-1 `date_start` (15:03:42Z for 2024 Bahrain).

**Structure addition:** `js/app.js` is a scene bootstrap, so `main.js` stays focused on the start page. Reference-lap selection (2.3) lives in `session-data.js`. Module interfaces are in `plan/CONTRACTS.md`. `plan/tracker.mjs` updates this file.

## Change log

- **2026-10-12**: Tracker created. Decisions: remove the Python scaffold; tracker kept in the repo; deploy with GitHub Actions; unit tests with `node --test` (no npm dependencies).
- **2026-10-12**: Phases 1 and 2 done (5 parallel agents plus integration). `hasDrs` is now set up front from race_control `Drs` messages. Pit rule: `pit.lap_number` is the in-lap, so reference-lap selection excludes both lap N and N+1. Verified in headless Chrome against the 2024 Bahrain GP.
- **2026-10-12**: Fixed cars surging and dragging at 1x, reported by the user on straights. The cause was OpenF1 location timestamp jitter. Added `js/retime.js`, which cut the average speed jump between samples from 62 to 14 km/h across all cars.
- **2026-10-12**: Phase 3 done (panel base by the orchestrator plus 4 parallel panel agents). Desktop click selection verified with real mouse events. Telemetry matches raw car_data exactly. 46 draw calls, about 12 panel redraws per second.
- **2026-10-12**: 4.1–4.3 built and verified under an emulated Quest 3 (IWER 2.5.0, injected by the test driver, not shipped). Passthrough start, trigger select, B toggle and session end all work. Fixed: XR input must be created before setSession or three.js never sends 'connected'. In XR each eye is a separate pass, so about 98 draw calls; revisit in Phase 6.
- **2026-10-12**: 4.4–4.5 done. Full Touch controller map verified in the emulated Quest 3.
