# Module contracts (Phases 1–2)

These are the shared interfaces between modules. Every module must implement its contract exactly so that modules written in parallel fit together. If a contract has to change, change it here first.

## Global conventions

- **Time:** every timestamp inside the app is a **number of ms since the epoch (UTC)**, from `Date.parse(apiDateString)`. ISO strings exist only at the API boundary.
- **Positions:** OpenF1 `x`, `y`, `z` are raw circuit units (roughly decimetres; Bahrain spans about ±10000). `x`/`y` are the horizontal plane and `z` is elevation. Only `track.js` converts raw coordinates to scene metres.
- **three.js:** import map in `index.html`:
  ```json
  { "imports": {
      "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
      "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/" } }
  ```
  Import with `import * as THREE from 'three'` and `import { OrbitControls } from 'three/addons/controls/OrbitControls.js'`.
- **Pure modules** (`api.js`, `cache.js`, `interp.js`, `session-data.js`, `playback.js`) must **not import three** and must run under Node 24 (`node --test`). Browser globals (`indexedDB`, `window`) must be feature-detected.
- **Render loop:** no allocation per frame. Reuse objects and vectors, and pass an `out` parameter where a contract has one.
- **Module style:** ES modules, named exports, JSDoc on public functions, files under about 400 lines.

## Verified OpenF1 facts (checked 2026-10-12 against the docs and live responses)

- Rate limit for the free tier: **3 req/s and 30 req/min**. The per-minute limit is the one that binds.
- Date filter encoding: `date%3E%3D2024-03-02T15:10:00` for `>=` and `date%3C...` for `<`. A fully encoded value (`%3A` colons, or the `toISOString()` form) is also accepted.
- An empty result is **HTTP 404** with body `{"detail":"No results found."}`. `fetchJson` maps it to `[]`.
- Session 9472 = 2024 Bahrain GP Race (meeting 1229). 20 drivers, 57 laps, race start (min lap-1 `date_start`) is `2024-03-02T15:03:42.341Z`. Session `date_start` is 15:00Z, but data begins around 14:03Z.
- Response sizes and record counts for 9472:

  | Endpoint | Size | Records | Notes |
  |---|---|---|---|
  | `intervals` | 4.2 MB | 30k | |
  | `laps` | 560 KB | | |
  | `position` | 80 KB | | |
  | `location`, 60 s, all drivers | 560 KB | about 4400 | about 1–3 s per request |
  | `car_data`, 60 s, one driver | 39 KB | about 230 | |

- **`location` timestamps jitter by ±100–200 ms** even though the positions are accurate. Interpolating them raw makes cars surge and drag on straights (implied speed 143↔352 km/h at a steady 250). `js/retime.js` re-times each car's samples with a local fit of time against distance (±3 samples, shift capped at 400 ms, endpoints fixed). `parseSeries` applies it to every location series.
- `intervals.gap_to_leader` / `interval` can be a number, `null`, or a **string** such as `"+1 LAP"` or `"+2 LAPS"`.
- `pit`: use `lane_duration` and `stop_duration`. `pit_duration` is deprecated (removed after 2026).
- `race_control.flag` values include `GREEN`, `YELLOW`, `DOUBLE YELLOW`, `RED`, `BLUE`, `CLEAR`, `CHEQUERED`, `BLACK AND WHITE`. Categories are `Flag`, `SafetyCar`, `Drs`, `CarEvent`, `SessionStatus` and `Other`. Extra fields: `scope`, `sector`, `qualifying_phase`.
- `drs` codes: 0/1 off, 8 eligible, 10/12/14 open, 2/3/9 unknown (treat as off).
- `team_colour` has no `#`. Meetings carry `country_flag` (an image URL), `is_cancelled` and `year`.
- Laps carry `segments_sector_*` arrays (unused for now).
- Team radio coverage drops sharply from 2026.

---

## `js/cache.js`

```js
export async function cacheGet(key, store = 'responses')   // -> value | undefined
export async function cachePut(key, value, store = 'responses') // -> void
export async function cacheClear()                          // clears all stores
```
- The IndexedDB database is `f1vr`, version 1, with object stores `responses` (API JSON keyed by full URL) and `tracks` (built track data keyed by circuit).
- When IndexedDB is unavailable (Node, private mode, an error), fall back silently to an in-memory `Map` per store. It never throws.

## `js/api.js`

```js
export const BASE_URL = 'https://api.openf1.org/v1';
export function buildUrl(endpoint, params)      // params: { session_key: 9472, 'date>=': iso, 'date<': iso }
export class RequestQueue {
  constructor({ perSecond = 3, perMinute = 30, fetchFn = fetch, now = Date.now, sleep, maxRetries = 5 })
  enqueue(url, { priority = 0 } = {})          // -> Promise<any>; higher priority runs first; FIFO within a priority
  get pending()                                  // number queued + in flight
}
export class ApiError extends Error { status; url }
export async function fetchJson(endpoint, params = {}, { priority = 0, cache = true } = {}) // -> parsed JSON (array)
export function getQueue()                       // the shared default RequestQueue
```
- `buildUrl`: a key ending in `>=`, `<=`, `>` or `<` is emitted as `field%3E%3Dvalue` and so on. Other keys are emitted as `key=encodeURIComponent(value)`. Keep a stable key order (as inserted).
- The queue runs **one request at a time** and enforces both windows with a sliding window of start timestamps.
- On HTTP 429 or 5xx it retries with exponential backoff (1 s, 2 s, 4 s … plus jitter, and `Retry-After` if present). Other non-2xx responses, or exhausted retries, throw `ApiError`.
- `fetchJson` checks `cacheGet(url)` first. On a miss it enqueues the request, then `cachePut`s it. A 404 or "no results" response (the API may return a `{detail: ...}` object) resolves to `[]`, and `[]` is cached too.
- Errors surface as rejected promises. Never swallow them silently.

## `js/interp.js`

```js
export function lowerBound(times, t)            // first i with times[i] >= t (times.length if none)
export function indexAtOrBefore(times, t)       // last i with times[i] <= t, or -1
export function bracket(times, t, out)          // fills out {i0, i1, f}; returns true if t is inside [times[0], times[last]]
export function lerp(a, b, f)
export function lerpAngle(a, b, f)              // shortest path, radians
```
- `times` can be an `Array` or `Float64Array`, sorted ascending. Every function is O(log n) and allocation-free.

## `js/session-data.js`

```js
export const SESSION_TYPES_WITH_INTERVALS = ['Race', 'Sprint'];   // match on session_name / session_type
export class SessionData {
  static async load(sessionKey, { onProgress } = {})  // onProgress({ step: 'drivers'|'laps'|..., done, total })
  // --- static facts ---
  session          // { key, meetingKey, name, type, circuit, country, year, start, end }   (ms)
  drivers          // [{ number, acronym, fullName, teamName, teamColour: '#rrggbb', headshotUrl }]
  driverByNumber   // Map<number, driver>
  totalLaps        // max lap_number across laps
  raceStartTime    // ms: min lap-1 date_start (or session.start if none)
  dataStartTime    // ms: earliest location/position sample known (use first position date)
  dataEndTime      // ms: session end or last lap end, whichever is later
  hasIntervals     // boolean
  hasDrs           // boolean | null: true up front if race_control has 'Drs'-category messages; else null until car_data is seen, then false if all samples are 0/1/missing
  // --- chunk loading ---
  setPlayhead(t, speed)          // schedules the location chunks + selected-driver car_data chunks; evicts old ones
  setSelectedDriver(number)      // loads that driver's car_data chunk for the current playhead at high priority
  isReady(t)                     // true if the location chunk covering t is loaded
  onStatus(cb)                   // cb({ loading: boolean, pending: number, error?: Error }); returns an unsubscribe fn
  // --- queries (allocation-free when out is given) ---
  getCarPositionAt(driverNumber, t, out)  // fills out {x,y,z}; returns true if the car is visible at t
  getCarsAt(t, outArray)                  // outArray[i] = {number, x, y, z, visible} for drivers[i]; reuses entries
  getTelemetryAt(driverNumber, t, out)    // fills {speed,rpm,gear,throttle,brake,drs}; returns false if not loaded
  getPositionAt(driverNumber, t)          // race position number or null
  getLeaderboardAt(t)                     // [{driverNumber, position, gapToLeader, interval, compound, tyreAge, pitStops, lapNumber, bestLap, lastLap, retired}] sorted by position
  getLeaderLapAt(t)                       // current lap number of the leader (1..totalLaps), 0 before the start
  getLapStartTime(lapNumber)              // ms: earliest date_start for that lap among all drivers
  getWeatherAt(t)                         // latest weather record at or before t (normalised, date in ms) or null
  getRaceControlAt(t, n = 5)              // last n messages at or before t, newest first
  getTeamRadioUpTo(driverNumber, t)       // radio records for driver at or before t
  async getReferenceLap()                 // -> { driverNumber, lapNumber, start, end, points: [{x,y,z}] } (raw coords, zero points removed)
  dispose()
}
```
- **Load all at once:** `drivers`, `laps`, `stints`, `pit`, `race_control`, `weather`, `team_radio`, `position`, plus `intervals` only for race/sprint sessions. Session metadata comes from `/sessions?session_key=X`.
- **Location chunks:** chunk `k` covers `[dataStartTime + k*60s, +60s)`. Each chunk is one request for all drivers. Keep the current chunk plus the next 2 (next 6 when `speed >= 5`), and evict chunks that end more than 2 minutes behind the playhead.
- **car_data chunks:** same chunk grid, selected driver only, same buffer rule.
- **Storage:** per chunk, per driver: `times` Float64Array plus `x`/`y`/`z` Float32Array (car_data: `speed`, `rpm`, `gear`, `throttle`, `brake`, `drs`). Interpolation across a chunk boundary must work: if `t` is before the first sample of its chunk, use the last sample of the previous chunk.
- **Visibility:** a car is hidden when the bracketing samples include (0,0,0), when the gap between them is over 5 s, or when there are no samples.
- **`getTelemetryAt`:** speed, rpm and throttle are interpolated; gear, brake and drs use the nearest earlier sample.
- **Reference lap:** the driver with the most laps, then that driver's fastest valid lap that is not lap 1, not a pit-out lap, and where neither `lap_number` nor `lap_number+1` is in that driver's pit list (`pit.lap_number` is the in-lap). Prefer laps with no race-control flag other than GREEN/CLEAR/BLUE, and no SafetyCar message, in their window. Fetch `/location` for that driver only (`driver_number=N`, `date>=start`, `date<start+lap_duration+0.5s`).
- No three.js imports. A live source can replace the internals later without changing these signatures.

## `js/playback.js`

```js
export const SPEEDS = [0.5, 1, 2, 5, 10];
export class Playback {
  constructor(data)               // data: SessionData; initial time = raceStartTime - 120000 (clamped to dataStartTime), speed 1, paused
  time; speed; playing; waiting   // waiting = playing but blocked on data
  update(dtSeconds)               // advances time by dt*speed*1000 when playing && data.isReady(next); always calls data.setPlayhead(time, speed)
  play(); pause(); toggle();
  seek(t); seekBy(seconds); seekToLap(n);   // clamp to [dataStartTime, dataEndTime]
  speedUp(); speedDown();          // step through SPEEDS
  onChange(cb)                     // fired on play/pause/seek/speed/waiting change (not every frame); returns an unsubscribe fn
}
```

## Scene modules (browser only, import three)

### `js/scene/world.js`
```js
export function createWorld(container) -> {
  renderer, scene, camera,         // camera: Perspective, at (0, 1.6, 0) looking toward -Z (desktop)
  roomGroup,                       // pit wall room geometry (hidden in passthrough)
  setMode(mode),                   // 'pitwall' | 'passthrough'  (desktop passthrough: neutral grey background, room hidden)
  onFrame(cb),                     // cb(dtSeconds, timeMs) each frame; returns an unsubscribe fn
  dispose()
}
```
- `renderer.xr.enabled = true` (XR comes in Phase 4) and `renderer.setAnimationLoop`. The renderer handles resize.
- Room: dark floor with a subtle grid, low walls, a few emissive light strips, blue-grey lighting, faint fog. Keep it cheap: no textures over 1024 px.

### `js/scene/track.js`
```js
export function createTable(parent) -> THREE.Group   // positioned at (0, 0.9, -1.0); includes a dark disc/tabletop (~1.6 m dia)
export async function loadTrack(data, table) -> TrackTransform
// TrackTransform: { scale, center:{x,y,z}, toScene(x, y, z, outVector3) }  // raw API coords -> table-local metres
```
- Builds the outline from `data.getReferenceLap()`: a closed `CatmullRomCurve3`, a flat ribbon about 1.5% of the longest dimension wide, and a start/finish line where the reference lap starts.
- Normalise so the longest horizontal dimension is 1.4 m, centred at the table origin. Mapping: API `x` → scene `x`, API `y` → scene `-z` (keeps the map un-mirrored when viewed from above), API `z` → scene `y` (×2 exaggeration, offset so the lowest point sits just above the table top).
- Caches the computed outline points and transform in `cache.js` store `tracks`, keyed by `circuit + year`.

### `js/scene/cars.js`
```js
export class Cars {
  constructor(drivers, transform, table)   // InstancedMesh of 20 low-poly wedges (~2.5 cm), per-instance team colour; label atlas
  update(data, t, camera)                  // positions, heading from positions at t-250ms and t+250ms, labels "VER 1" facing camera, hide invisible
  setSelected(driverNumber)                // bigger + emissive pulse + 5 s fading trail in team colour
  dispose()
}
```
- Labels: one canvas atlas texture plus one InstancedMesh (or Points) of billboard quads, so labels cost 1–2 draw calls in total. Redraw the atlas only when positions change.

### `js/input/desktop-input.js`
```js
export function createDesktopInput({ renderer, camera, table, playback, getDriverOrder, onSelectDriver, onTogglePassthrough }) -> { update(dt), dispose() }
```
- OrbitControls on **right-drag only** (left-drag is table rotation), with the target at the table.
- Left-drag on the table rotates it around Y. Wheel over the table scales it 0.5×–3×.
- Keys: Space play/pause, ←/→ seek ∓10 s, ↑/↓ speed, `[`/`]` previous/next driver by position, `P` toggle passthrough look.

### `js/app.js` (scene bootstrap, called by `main.js`)
```js
export async function startApp({ data, container, onExit, onStatus }) -> { playback, world, dispose() }
```
Wires world, table, track, cars, playback and desktop input. Shows "Loading data…" in an HTML overlay while `playback.waiting` (the main screen arrives in Phase 5) and a small HUD with session time, lap, speed and the selected driver. Selects the race leader by default.

---

# Phase 3: Panels

## Base (`js/panels/panel-base.js`, already written; read it)

- `class Panel({ name, width, height, maxHz })` is a canvas-texture plane at 1024 px/m. Subclasses implement:
  - `refresh(ctx) -> boolean`: cheap, called at most `maxHz` times a second. Compare the values you show with what you last drew, and return true to request a redraw. Keep your own "last drawn" snapshot and don't allocate much here.
  - `draw(g, w, h, ctx)`: start with `this.clear(g, w, h)`, which handles passthrough's 75% background. Register click targets with `this.addHit(id, x, y, w, h, payload)` while drawing. Use `this.hover === id` for hover styling.
  - `onHit(hit, ctx, px)`: called when the user selects a registered rect. `px` is the canvas-pixel hit point, which sliders need.
- Use the helpers from the base: `THEME` colours, `TYRE_COLOURS`, `font(px, weight)`, `roundRect`, `fmtLap(sec)` and `fmtGap(v)` (numbers or strings like "+1 LAP").
- **Text:** at least 24 px tall on the canvas (spec §12), and 28–36 px for primary values. Use tabular numbers for timing columns: `g.fontVariantNumeric` isn't reliable, so right-align numeric columns, or use `ctx.font` with Titillium Web, whose digits are already close to tabular. Fonts are guaranteed ready before the first `draw`.
- Drawing must stay cheap: no `getImageData`, and redraw only when `refresh` says so. Animations (Phase 6) will redraw at most 10 Hz.
- `PanelManager.add(panel, position, { tiltDeg })` places a panel facing the user. The positions are in `js/panels/layout.js` (`LAYOUT`), which is already written.

## PanelContext (`ctx`)

`app.js` builds one shared object and mutates it every frame:
```js
ctx = {
  data,            // SessionData (see the SessionData contract above + extras: getDriverLaps(n), getDriverStints(n))
  playback,        // Playback (time, speed, playing, waiting, SPEEDS)
  time,            // = playback.time (ms)
  selected,        // selected driver number
  mode,            // 'pitwall' | 'passthrough'
  actions: {
    selectDriver(n), togglePlay(), seekBy(sec), seekToLap(n), speedUp(), speedDown(), setSpeed(s),
    togglePassthrough(), exit(), recenter(), resetLayout(),  // wrist menu; recenter is only set in XR
  },
  canPassthrough,  // the session can switch to passthrough
}
```
Panels never mutate `data` or `playback` directly. They go through `ctx.actions`.

## Useful SessionData shapes (actual implementation)

- `getLeaderboardAt(t)` returns rows sorted by position: `{ driverNumber, position, gapToLeader (number|string|null), interval, compound ('SOFT'|'MEDIUM'|'HARD'|'INTERMEDIATE'|'WET'|null), tyreAge, pitStops, lapNumber, bestLap (s), lastLap (s), retired }`. It allocates, so call it from `refresh` (≤10 Hz), never per frame.
- `getDriverLaps(n)` returns laps sorted by `lap_number` with `{ lap_number, date_start (ms), date_end (ms), lap_duration (s), duration_sector_1..3, i1_speed, i2_speed, st_speed, is_pit_out_lap }`. A lap is completed at t when `date_end <= t`.
- `getDriverStints(n)` returns `{ stint_number, compound, lap_start, lap_end, tyre_age_at_start }`.
- `getWeatherAt(t)` returns `{ date, air_temperature, track_temperature, humidity, pressure, rainfall, wind_speed, wind_direction }` or null.
- `getRaceControlAt(t, n)` returns the newest messages first: `{ date, category, flag, message, lap_number, driver_number, scope, sector }`.
- `getTeamRadioUpTo(n, t)` returns records oldest first.
- `getTelemetryAt(n, t, out)` fills `{ speed, rpm, gear, throttle, brake, drs }` and returns false while not loaded. Only the selected driver's car_data is loaded. `data.hasDrs` is true, false, or null (unknown); hide DRS unless it is true.
- `data.session` is `{ name, type, circuit, country, year, … }`, `data.hasIntervals` is false for practice and qualifying, and `data.totalLaps` is the lap count.

## Panel modules (named exports)

| File | Export | Notes |
|---|---|---|
| `js/panels/leaderboard.js` | `class LeaderboardPanel extends Panel` (constructor `(data)`) | Uses `LAYOUT.leaderboard`. Tapping a row calls `selectDriver`. |
| `js/panels/race-status.js` | `trackStatusAt(data, t) -> { status: 'GREEN'|'YELLOW'|'SC'|'VSC'|'RED'|'CHEQUERED', label, colour }` | Derived from race_control. Shared with the ticker. |
| `js/panels/telemetry.js` | `class TelemetryPanel extends Panel` (`(data)`) | |
| `js/panels/lap-trace.js` | `class LapTraceCache` with `getTrace(data, driver, lapNumber) -> { dist: Float32Array, speed: Float32Array, time: Float64Array } \| null` (sync; starts an async fetch on a miss) | Fetches `/car_data` for the lap window through `fetchJson(..., { priority: -1 })` and keeps the last 6 laps in memory. |
| `js/panels/laps.js` | `class LapsPanel extends Panel` (`(data)`) | |
| `js/panels/weather.js` | `class WeatherPanel extends Panel` (`(data)`) | |
| `js/panels/ticker.js` | `class TickerPanel extends Panel` (`(data)`) | Its mesh is 2.4×0.65 m, and only the top 0.15 m strip is drawn when collapsed (transparent below). A tap toggles the expanded view of the last 5 messages. Expose `onNewMessage(cb)` for the chime (Phase 6). |
| `js/panels/driver-picker.js` | `class DriverPicker` (`(data)`) with `addTo(manager)`, `dispose()` | 20 small tiles, each its own `Panel` (0.12 m), in the `LAYOUT.driverPicker` arc. |
| `js/panels/playback-bar.js` | `class PlaybackBarPanel extends Panel` (`(data)`) | Play/pause, speed −/+, a lap slider (click to seek to that lap), elapsed race time and the session clock. |

# Phase 4: WebXR additions

## Layout rig and re-centre (4.10)

`PanelManager.group` is the **layout rig**. Every pit wall panel and the driver picker group are children of it, and `LAYOUT` positions are rig-local. The rig starts at the identity, so rig-local means "the user's start floor position, facing -Z". Re-centre puts the rig at the head's floor position (x, z) and yaw, and moves the table to its default placement in the same frame. It also updates `table.userData.defaultTransform` (the original stays in `table.userData.baseTransform`), so a double grip resets the table in front of the user. The camera never moves. The wrist menu is **not** in the rig: it is a direct child of the scene, placed in world space every frame.

- `js/scene/world.js`: `getRecenterPose(head: THREE.Object3D, out) -> out = { x, z, yaw }`, from the head's world matrix (yaw only).
- `pitWall.recenter({ x, z, yaw })` places the rig; `applyRecenter(table, pose)` in `track.js` places the table.

## Movable panels (4.15–4.19)

- Movable units: each top-level panel mesh (`leaderboard`, `telemetry`, `laps`, `weather`, `ticker`, `playback-bar`) and the `driver-picker` group (all 20 tiles move as one). The wrist menu is not movable.
- `pitWall.movableFor(panel) -> THREE.Object3D | null`, `pitWall.saveLayout()`, `pitWall.resetLayout()`.
- `js/input/panel-grab.js`: `createPanelGrab({ getMovable(panel), onRelease() })` returns `{ begin(id, panel, point, origin) -> boolean, update(id, origin, dir, facePos), adjust(id, metres), end(id), has(id), isGrabbing() }`. While held, the grab point stays on the ray at a fixed distance (clamped to 0.5–4 m) and the unit turns about the vertical axis so its +Z faces `facePos`. `update` is allocation-free.
- `js/panels/layout-store.js`: `loadLayout() -> { [name]: { p: [x,y,z], q: [x,y,z,w] } }`, `saveLayout(items)`, `clearLayout()`. localStorage key `f1vr.layout.v1`, rig-local transforms, every access in try/catch. Only moved units are stored; the rest use `LAYOUT`.
- XR: grip while the ray is on a panel picks it up (instead of the table). A hand pinch held 0.35 s on a panel's top 6 cm (its title bar) picks it up. While a panel is held, right stick up/down pushes it away / pulls it closer, and seek and speed are suppressed.
- Desktop: Shift + left-drag on a panel moves it, facing the camera; the wheel while dragging pushes/pulls. `R` resets the layout.

## `js/audio.js` (4.11)

`unlockAudio()` must be called synchronously inside the Enter / Preview click. It creates (or resumes) the shared `AudioContext` and plays one silent buffer. `getAudioContext()` returns that context or null. Phase 6 sound effects and radio use it.

# Phases 4b, 5 and 6: shared contracts (set before the parallel build)

- **Settings** (`js/settings.js`): `radio` (bool, radio autoplay), `sfx` (bool), `theme` ('pitwall' | 'studio' | 'night'), `fps` (bool, in-scene fps counter). Read with `getSettings()` (a cached object, cheap enough to read per frame); write with `setSetting()`.
- **Wrist menu** already has "Room: <name>" (calls `ctx.actions.cycleTheme()`, greyed when missing) and "FPS ON/OFF" (writes the `fps` setting directly).
- **Room themes** (`js/scene/rooms.js`): `THEMES = ['pitwall', 'studio', 'night']`, `buildRoom(theme) -> { group, dispose() }`. `world.setTheme(name)` swaps the room and keeps the pit wall / passthrough mode. Every theme is fully enclosed, so in `immersive-ar` nothing transparent shows in pit wall mode.
- **Audio** (`js/audio.js`):
  - `playRadio(url)` plays one clip through a shared `<audio>` element (manual play ignores the `radio` setting) and stops any current clip;
  - `stopRadio()`;
  - `getRadioState() -> { url, playing }`;
  - `onRadioChange(cb) -> unsubscribe`;
  - `playSfx('chime' | 'whoosh' | 'beep')` is a quiet WebAudio effect, a no-op when `sfx` is off or audio is locked.
- **Audio events** (`js/audio-events.js`): `createAudioEvents(data) -> { update(time, selected, playing), dispose() }`. It autoplays the selected driver's radio when the playhead passes a clip (if `radio` is on and playback is playing, not while seeking), plus the chime, whoosh and beep. Call it at ≤10 Hz or make it cheap per frame.
- **Main screen** (`js/scene/screen.js`, `js/scene/onboard.js`): created by `app.js` in the layout rig, at `MAIN_SCREEN` from `layout.js`. Clickable parts are `Panel`s added through `pitWall.manager.add(panel, pos, { parent })`, so the shared raycaster and selection work.
- **Video source settings** (`js/video-settings.js`): `loadVideoSettings() -> { kind: 'none' | 'url' | 'hls' | 'file', url, offsetSec, sync }`, plus the start page section. A local file is kept as an object URL in memory only (it can't be stored).
