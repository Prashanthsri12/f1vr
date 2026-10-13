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
| 4 | WebXR | 🟡 | 18 / 19 |
| 4b | VR feedback (user test 2026-10-13) | 🟡 | 16 / 17 |
| 5 | Main screen | ✅ | 8 / 8 |
| 6 | Polish and performance | 🟡 | 9 / 10 |
| 7 | Deploy | 🟡 | 3 / 7 |

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
| 4.6 | Grab the table with one grip, scale (0.5x–3x) and rotate with two, double-press to reset | `js/input/xr-input.js`, `js/scene/track.js` | ✅ | table-grab.js; 2-hand scale and rotate about the hands' midpoint, height kept; verified in emulator plus 5 unit tests |
| 4.7 | Hand tracking: hand models, pinch as select (confirm Quest sends `select`) | `js/input/xr-input.js` | ✅ | Hand meshes (pinned assets) and hand rays; pinch fires select (confirmed in emulator, recheck on device) |
| 4.8 | Pinch and hold on the table edge to grab it | `js/input/xr-input.js` | ✅ | Pinch-hold on the outer band (r ≥ 0.6) of the tabletop; panels in front take priority |
| 4.9 | Wrist menu: shown when the palm is up or faces the user, with all §7 items | `js/panels/wrist-menu.js` | ✅ | Palm toward head shows it (controller grip +X, hand wrist -Y); all §7 items; re-centre greyed until 4.10; verified in emulator |
| 4.10 | Re-centre panels to the user's position and facing | `js/scene/world.js` | ✅ | Left stick / wrist menu: rig + table to head floor pose and yaw (eye midpoint); verified in emulator + unit tests |
| 4.11 | Unlock AudioContext on the Enter click | `js/audio.js`, `js/main.js` | ✅ | js/audio.js unlockAudio() in the Enter and Preview clicks; context 'running' verified |
| 4.12 | Clear message when XR is unsupported | `js/main.js` | ✅ | Start page message for no WebXR, no HTTPS, or unsupported device (verified) |
| 4.13 | Test with the Immersive Web Emulator | — | ✅ | IWER 2.5.0 emulated Quest 3: 37/37 checks for 4.10-4.19 (grip carry, stick push, re-centre, pinch-hold, wrist reset) |
| 4.14 | Test on Quest 3 (needs HTTPS, so a tunnel or an early Pages deploy) | — | ⬜ | User test |
| 4.15 | **Move panels in VR (added by the user):** grip while pointing at a panel (or pinch and hold its title bar) to pick it up. It follows the ray at a fixed distance and keeps facing the user. The driver tiles move as one group | `js/input/panel-grab.js`, `js/input/xr-input.js` | ✅ | panel-grab.js; grip on panel or 0.35 s pinch on its top 6 cm; tiles move as one group; verified in emulator |
| 4.16 | While holding a panel, right stick ↑/↓ pushes it away or pulls it closer (clamped about 0.5–4 m) | `js/input/panel-grab.js` | ✅ | 1.5 m/s at full deflection, 0.5-4 m from the controller; seek/speed suppressed while held |
| 4.17 | Save the custom panel layout on the device (localStorage, try/catch) and restore it on start | `js/panels/layout-store.js`, `js/panels/pit-wall.js` | ✅ | layout-store.js (f1vr.layout.v1, rig-local, only moved units); restore verified after reload |
| 4.18 | "Reset layout" in the wrist menu; re-centre (4.10) carries the custom layout with the user | `js/panels/wrist-menu.js`, `js/panels/pit-wall.js` | ✅ | Wrist 'Reset layout' (menu now 0.30 m tall); custom layout rides the re-centred rig |
| 4.19 | Desktop: Shift-drag a panel to move it (same save and restore) | `js/input/desktop-input.js` | ✅ | Shift-drag faces the camera, wheel pushes/pulls, R resets; verified with real mouse events |

## Phase 4b: VR feedback

From the user's first test on the Quest 3 (2026-10-13). Decisions made with the user: remove the driver tiles in VR but keep them on desktop; build the easiest room themes; use a CC0 car model; resize panels now and decide on a text-size setting later. Team radio and sound effects are moved here from Phase 6 (they were 6.6 and 6.5).

| ID | Item | Files | Status | Notes |
|---|---|---|---|---|
| 4b.1 | **Driver tiles:** don't build the picker arc in XR sessions. Keep it in the desktop preview. In VR, drivers are picked from the wrist menu grid, leaderboard rows and X/Y | `js/panels/pit-wall.js`, `js/app.js` | ✅ | XR builds no picker (driverTiles: !xrSession); desktop keeps 20 movable tiles; XR draw calls 98 -> 58 |
| 4b.2 | **Desktop:** every panel, including the tile group, can be moved. Make it easy to discover: a "move" cursor while Shift is held over a panel | `js/input/desktop-input.js` | ✅ | 'move' cursor while Shift is over a movable panel; tile group Shift-drag re-verified |
| 4b.3 | **Enclosed room:** walls up to a ceiling, plus the ceiling, so nothing transparent is left in pit wall mode | `js/scene/world.js` | ✅ | Enclosed: walls+ceiling or sky dome; ~270 head rays all hit room; no gaps in emulated immersive-ar screenshots |
| 4b.4 | **Room themes** (procedural, no image assets, about 15 draw calls or fewer each): "Pit wall" (the current room, enclosed), "Studio" (dark, LED edge strips), "Night" (gradient sky dome over a low wall). Easiest first | `js/scene/rooms.js` (new), `js/scene/world.js` | ✅ | rooms.js: pitwall 6, studio 4, night 7 draw calls (old room 11); procedural |
| 4b.5 | **Theme switch:** a room button in the wrist menu cycles the themes; the choice is saved in `settings.js`. Desktop: a key (`T`) | `js/panels/wrist-menu.js`, `js/settings.js`, `js/input/desktop-input.js` | ✅ | Wrist 'Room' button and desktop T cycle themes; saved in settings.theme; verified desktop + emulator |
| 4b.6 | **Readable car labels:** keep a constant apparent size (about 2 cm at 1 m from the head), whatever the table scale | `js/scene/labels.js` | ✅ | 2.5 cm per metre of view distance (clamped 4-50 mm), independent of table scale, 1 draw call; verified 0.5x/1x/3x |
| 4b.7 | **Label declutter:** when labels would overlap, show full names for the selected driver, the top 3 and cars near the selected one; the rest show the position number only | `js/scene/labels.js`, `js/scene/cars.js` | ✅ | label-layout.js: 4 Hz greedy declutter; selected, top 3 and neighbours stay full, the rest show position only |
| 4b.8 | **Find a CC0 car model:** a generic open-wheel / F1-style car with no livery or logos, glTF/GLB, about 3k triangles or fewer, few materials. Record the source URL, author and licence here. **Ask the user to approve the specific asset before adding it** | — (notes here) | ✅ | Approved by the user 2026-10-13: Kenney Racing Kit raceCarWhite.glb (CC0, https://kenney.nl/assets/racing-kit, author Kenney). In js/assets/cars/; 1,430 tris, materials grey (body, team tint) / carTire / glass; nose at +Z (MODEL_YAW 0); 47 calls, 32k tris on desktop. README credit added |
| 4b.9 | **Load the car model:** GLTFLoader from three/addons (same pinned 0.160.0, no new library), one InstancedMesh per material, team colour on the body material, fall back to the wedge if loading fails | `js/scene/car-model.js` (new), `js/scene/cars.js`, `assets/` | ✅ | car-model.js: GLTFLoader, one InstancedMesh per material, body tinted per team, wedge fallback; MODEL_URL = js/assets/cars/raceCarWhite.glb (4b.8) |
| 4b.10 | **Resize a held panel:** right stick ←/→ makes it smaller / larger (0.5×–2.5×). Text grows with the panel | `js/input/panel-grab.js`, `js/input/xr-buttons.js` | ✅ | Right stick left/right on a held panel: 1.5x/s, 0.5x-2.5x, about the grab point |
| 4b.11 | **Two-hand stretch:** a second grip (or pinch-hold) on the held panel scales it by the distance between the hands, like the table | `js/input/panel-grab.js`, `js/input/xr-input.js` | ✅ | Second grip / pinch-hold on the held panel stretches it by distance ratio; controllers and hands (emulator) |
| 4b.12 | **Desktop resize:** Shift + wheel over a panel (not dragging) scales it | `js/input/desktop-input.js` | ✅ | Shift+wheel over a panel scales it (deltaY or deltaX); table scale untouched |
| 4b.13 | **Save the panel scale** with the layout (`s` beside `p`/`q`); Reset layout restores scale 1 | `js/panels/layout-store.js`, `js/panels/pit-wall.js` | ✅ | Layout entries {p,q,s}; s restored after reload; R / Reset layout set 1; XR keeps the desktop picker entry |
| 4b.14 | **Sharp text when enlarged:** redraw the panel canvas at a higher density when its scale goes above 1 (capped, e.g. 2048 px/m) | `js/panels/panel-base.js` | ✅ | Backing canvas up to 2x (2048 px/m), logical px for draw/hits; check Quest texture memory in 6.8 |
| 4b.15 | **Team radio** (was 6.6): a "Radio" badge on telemetry and autoplay of the selected driver's clips when the playhead passes them, if radio is on in the wrist menu | `js/audio.js`, `js/panels/telemetry.js` | ✅ | Plain <audio> (mp3s send no CORS headers), primed in the Enter click; autoplay at 2.5x or slower for clips under 3 s old; badge; verified under strict autoplay |
| 4b.16 | **Sound effects** (was 6.5): WebAudio chime on a new race control message, a soft whoosh on an overtake involving the selected driver, a beep when the fastest lap changes. Quiet, following the wrist menu toggle | `js/audio.js` | ✅ | Generated chime/whoosh/beep, no files; seeks re-arm silently; follows the Sounds toggle; verified on 9472 |
| 4b.17 | **Test on Quest 3:** room, themes, labels at 0.5× table scale, car model, resize, radio and sounds | — | ⬜ | User test, together with the still-open 4.14 |

## Phase 5: Main screen

| ID | Item | Files | Status | Notes |
|---|---|---|---|---|
| 5.1 | Screen mesh (2.4 m, 16:9, at 2.8 m) and tab buttons | `js/scene/screen.js` | ✅ | Screen in the layout rig; tabs, card and controls on the screen face within x ±0.5 (side panels cover its outer edges) |
| 5.2 | Onboard follow camera rendered to a 1024x576 target at 30 fps | `js/scene/onboard.js` | ✅ | Onboard camera on the selected car, 1024x576 target at 30 Hz, table subtree only, 5 draw calls; XR-safe in emulator |
| 5.3 | Onboard overlay: speed, gear, position (drawn in the scene) | `js/scene/screen.js` | ✅ | P / acronym / speed / gear card lower-left, ≤10 Hz, only on change |
| 5.4 | Video tab: VideoTexture from an mp4/webm URL or a local file | `js/scene/screen.js` | ✅ | VideoTexture from an mp4/webm URL or local file; 'Add a video source…' message when none |
| 5.5 | HLS through hls.js from a CDN when there is no native HLS | `js/scene/screen.js`, `index.html` | ✅ | hls.js 1.7.3 (2026-09-11) pinned in the import map, lazy-loaded only without native HLS |
| 5.6 | Video settings on the start page (collapsed section, localStorage, sync offset) and VR controls for play, mute and sync | `index.html`, `js/main.js` | ✅ | Collapsed 'Video screen' section (URL, file, offset, sync), f1vr.video; in-VR play/mute/sync follows replay time, speed and pause |
| 5.7 | Radio tab: clip list for the selected driver with play buttons | `js/scene/screen.js` | ✅ | Radio tab: selected driver's clips up to the playhead, newest first, play/stop, paging |
| 5.8 | Manual test: onboard follows the car; a public sample mp4 plays | — | ✅ | Headless Chrome + IWER with a page-generated webm and a real radio mp3; re-check sync with a real mp4/HLS |

## Phase 6: Polish and performance

| ID | Item | Files | Status | Notes |
|---|---|---|---|---|
| 6.1 | Leaderboard rows slide over 0.5 s | `js/panels/leaderboard.js` | ✅ | row-anim.js: rows slide over 0.5 s (eased); redraws ≤10 Hz only while moving |
| 6.2 | Green/red flash on gaining/losing a place; purple fastest-lap marker | `js/panels/leaderboard.js` | ✅ | 1 s green/red flash on a gained/lost place, purple for a new fastest-lap holder; seeks snap with no flashes |
| 6.3 | Retired drivers greyed out with "OUT" | `js/panels/leaderboard.js` | ✅ | retirement.js + session_result (dnf/dns): OUT from the moment the car stops; leaderboard _isOut removed; totalLaps from the winner's number_of_laps (2023 AUS 58) |
| 6.4 | Ticker flag colours, chequered pattern, flash on a new message | `js/panels/ticker.js` | ✅ | Flag colours, chequered, flash on a new message (from 3.8) re-verified: chequered, SC, red, yellow |
| 6.7 | In-scene fps counter (toggled from the wrist menu) | `js/scene/world.js` | ✅ | fps-meter.js under the playback bar, 2 Hz redraw, wrist FPS toggle; verified in emulator |
| 6.8 | Performance check: under 150 draw calls, under 300k triangles, no per-frame allocation | — | ✅ | Desktop 43-47 calls / 2.5-4.4k tris; XR 74-82 calls / 23-27k tris (all themes x tabs). Heap sampling while playing: only ≤10 Hz redraws/HUD allocate; fixed a 2 Hz start-debug timer running behind the app |
| 6.9 | Quest check: hold 72 fps | — | ⬜ | User test |
| 6.10 | Error handling: API down | `js/api.js`, `js/main.js` | ✅ | api.js getApiHealth/onApiHealth; start page 'Retrying… (attempt n)' + Retry; in-app 'Data unavailable · retrying'; verified with blocked API |
| 6.11 | Error handling: sessions with missing data | `js/session-data.js` | ✅ | Optional datasets load as empty (data.unavailable/empty); 'No car position data' note on the table; telemetry/weather 'No data' states |
| 6.12 | Pit lane line (optional, §4) | `js/scene/track.js` | ✅ | pit-lane.js traced from a typical stop (slowest stretch under 100 km/h), cached per circuit, 1 draw call; only checked on Bahrain 2024 |

## Phase 7: Deploy

| ID | Item | Files | Status | Notes |
|---|---|---|---|---|
| 7.1 | GitHub Actions Pages workflow | `.github/workflows/pages.yml` | ✅ | Actions workflow publishes only index.html, css and js |
| 7.2 | Create the GitHub repo and push | — | ✅ | Repo public at github.com/Prashanthsri12/f1vr; history re-stamped with the noreply email |
| 7.3 | Enable Pages and confirm the HTTPS URL works | — | ✅ | https://prashanthsri12.github.io/f1vr/ verified end to end (cold load 11 s) |
| 7.4 | README: what it is, how to open it on Quest 3, controls table | `README.md` | 🟡 | README written; finalise after Phases 5–6 |
| 7.5 | README: video source setup, running locally, data credit, known limits | `README.md` | 🟡 | README written; finalise after Phases 5–6 |
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
- **Done (6.3):** retirements come from `session_result` (`dnf`, `dns`, `dsq`) plus the time the car stopped (`js/retirement.js`). Rows: `{position, driver_number, number_of_laps, points, dnf, dns, dsq, duration, gap_to_leader, …}`. `points` is undocumented. DNF rows have null `position` (sometimes), `duration` and `gap_to_leader`.
- **Done (6.3):** `totalLaps` uses the winner's `session_result.number_of_laps` (58 for 2023 Australia, where max `lap_number` was 59).
- **`pit.date`** has no documented meaning. On 2024 Bahrain (LEC, lap 11) it is the pit lane exit: the car was stationary 15–13 s before it, and `lane_duration` was 24 s.
- **Team radio:** records are `{meeting_key, session_key, driver_number, date, recording_url}`. The mp3s on livetiming.formula1.com send no CORS headers, so they play through a plain `<audio>` element, not the AudioContext.
- **Layout question (resolved 2026-10-13):** the driver picker tiles hovered over the near part of the track table. The user decided to remove them in VR and keep them on desktop (4b.1).
- **No commentary:** OpenF1 has no commentary audio, and broadcast commentary is copyrighted (ruled out by the spec). The only sound sources are team radio clips, WebAudio effects and the user's own video source (Phase 5).
- **Passthrough above the walls in pit wall mode:** the session is always `immersive-ar`, so three.js clears with alpha 0 and `scene.background` never draws. Only real geometry hides passthrough (4b.3).
- Location data begins about an hour before the session `date_start`. The race starts at the min lap-1 `date_start` (15:03:42Z for 2024 Bahrain).

**Structure addition:** `js/app.js` is a scene bootstrap, so `main.js` stays focused on the start page. Reference-lap selection (2.3) lives in `session-data.js`. Module interfaces are in `plan/CONTRACTS.md`. `plan/tracker.mjs` updates this file.

## Change log

- **2026-10-12**: Tracker created. Decisions: remove the Python scaffold; tracker kept in the repo; deploy with GitHub Actions; unit tests with `node --test` (no npm dependencies).
- **2026-10-12**: Phases 1 and 2 done (5 parallel agents plus integration). `hasDrs` is now set up front from race_control `Drs` messages. Pit rule: `pit.lap_number` is the in-lap, so reference-lap selection excludes both lap N and N+1. Verified in headless Chrome against the 2024 Bahrain GP.
- **2026-10-12**: Fixed cars surging and dragging at 1x, reported by the user on straights. The cause was OpenF1 location timestamp jitter. Added `js/retime.js`, which cut the average speed jump between samples from 62 to 14 km/h across all cars.
- **2026-10-12**: Phase 3 done (panel base by the orchestrator plus 4 parallel panel agents). Desktop click selection verified with real mouse events. Telemetry matches raw car_data exactly. 46 draw calls, about 12 panel redraws per second.
- **2026-10-12**: 4.1–4.3 built and verified under an emulated Quest 3 (IWER 2.5.0, injected by the test driver, not shipped). Passthrough start, trigger select, B toggle and session end all work. Fixed: XR input must be created before setSession or three.js never sends 'connected'. In XR each eye is a separate pass, so about 98 draw calls; revisit in Phase 6.
- **2026-10-12**: 4.4–4.5 done. Full Touch controller map verified in the emulated Quest 3.
- **2026-10-12**: 4.6–4.8 done and verified in the emulated Quest 3: grip move, 2-hand scale and twist, double-grip reset, hand pinch select, pinch-hold edge grab. Fixed: 2-hand scaling no longer changes table height.
- **2026-10-12**: Deployed early (7.1–7.3) so the app can be tested on a Quest over HTTPS. Repo made public, Pages built by Actions (checkout v7, pages v5/v6). Only index.html, css and js are published.
- **2026-10-12**: Added 4.15–4.19 (move panels in VR, push/pull, saved layout, reset layout, desktop Shift-drag) at the user's request. This adds to spec §3's fixed layout; the defaults stay as specified.
- **2026-10-12**: 4.9 wrist menu done and verified in the emulated Quest 3: palm-up shows it (controller and hand), turning away hides it, buttons work, Exit returns to the start page. Radio and sound toggles are saved in `js/settings.js` for Phase 6.
- **2026-10-13**: 4.10, 4.11, 4.13 and 4.15–4.19 done. The panels now sit in a layout rig (`PanelManager.group`) that re-centre moves along with the table. The wrist menu stays outside the rig. Each panel and the driver picker group can be picked up (`js/input/panel-grab.js`), and moved units are saved rig-local in `f1vr.layout.v1`. The button map moved to `js/input/xr-buttons.js` to keep `xr-input.js` under 400 lines. Fixed: three's XR ArrayCamera sits behind the eyes (union frustum), so re-centre uses the midpoint of the two eye cameras. 37/37 IWER emulator checks and 130/130 unit tests pass. Only 4.14 (the Quest 3 test, done by the user) is left.
- **2026-10-13**: Added Phase 4b (17 items) from the user's first Quest 3 test: remove driver tiles in VR (keep them on desktop), enclose the room plus easy themes, readable car labels, a CC0 car model (the user approves the asset first), panel resize, team radio and sound effects. 6.5 and 6.6 moved here as 4b.16 and 4b.15, so Phase 6 now has 10 items.
- **2026-10-13**: Phase 4b (except 4b.8, waiting on car model approval, and the 4b.17 user test), Phase 5 and Phase 6 (except the 6.9 user test) built by 6 parallel agents in git worktrees, then merged.
  - The `app.js`/`main.js`/`audio.js` merge conflicts were small; each side's additions were kept.
  - Merged build: 180/180 unit tests and the 32-check desktop + emulated Quest 3 regression run pass.
  - 6.8: at most 82 draw calls and 27k triangles in XR across all themes and tabs.
  - Still open: `session-data.js` (522 lines) and `main.js` (539) are over the ~400-line guideline.
- **2026-10-13**: 4b.8 done: the user approved Kenney's Racing Kit `raceCarWhite.glb` (CC0), added as `js/assets/cars/raceCarWhite.glb` with a README credit. Body tinted per team, nose at +Z. Perf with the model: at most 86 draw calls and 86k triangles in XR (cars drawn per eye and in the onboard view), 49 calls and 34k on desktop. 180/180 unit tests pass. Pushed for the user's Quest test (4.14, 4b.17, 6.9).
