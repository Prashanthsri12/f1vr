# Build: F1 Pit Wall VR (WebXR app for Meta Quest 3)

You are building a WebXR app that runs in the Meta Quest 3 browser. It replays real Formula 1 sessions in a 3D "pit wall" world: a 3D track map with all cars moving, a leaderboard, live telemetry for a selected driver, lap and tyre data, race control messages, weather, team radio, and a video screen. It must also work in a normal desktop browser with mouse controls for testing.

Work in phases (listed at the end). Finish each phase, test it, commit it, and tell me what to check before moving on.

---

## 1. Hard requirements

- **Platform:** Meta Quest 3 browser (Chromium based, WebXR). Must also run in desktop Chrome with mouse and keyboard.
- **Stack:** plain JavaScript ES modules, three.js loaded through an import map from a CDN (pin an exact version, for example `three@0.160.0` from `https://cdn.jsdelivr.net/npm/`). No bundler, no build step, no framework. The repo must run as static files.
- **Hosting:** GitHub Pages (HTTPS is required for WebXR). Include a GitHub Actions workflow or use the "deploy from branch" setting, and write the steps in the README.
- **Performance:** hold 72 fps on Quest 3. Budget: under 150 draw calls, under 300k triangles, no per-frame object allocation in the render loop, 2D panels redrawn at most 10 times per second (not every frame).
- **Comfort:** the user never moves artificially. No camera motion forced on the user in VR. The user stands or sits; everything is placed within arm's reach or comfortable view.
- **No API key** needed for version 1. All data comes from the free historical OpenF1 API.

---

## 2. Data source: OpenF1 API

Base URL: `https://api.openf1.org/v1/`

**Before writing the data layer, open https://openf1.org/docs and confirm the endpoint names, field names, filter syntax and current rate limits.** The field list below is from memory and may be out of date. If anything differs, follow the docs and tell me what changed.

### Endpoints to use

| Endpoint | Used for | Key fields |
|---|---|---|
| `/meetings?year=YYYY` | Race weekend list | meeting_key, meeting_name, country_name, circuit_short_name, date_start |
| `/sessions?meeting_key=X` | Sessions in a weekend | session_key, session_name, session_type, date_start, date_end |
| `/drivers?session_key=X` | Driver list | driver_number, name_acronym, full_name, team_name, team_colour, headshot_url |
| `/location?session_key=X&date>=A&date<B` | Car x, y, z on track (about 3.7 Hz) | date, driver_number, x, y, z |
| `/car_data?session_key=X&driver_number=N&date>=A&date<B` | Telemetry (about 3.7 Hz) | date, speed, rpm, n_gear, throttle, brake, drs |
| `/position?session_key=X` | Running order changes | date, driver_number, position |
| `/intervals?session_key=X` | Gaps (race only) | date, driver_number, gap_to_leader, interval |
| `/laps?session_key=X` | Lap and sector times | driver_number, lap_number, date_start, lap_duration, duration_sector_1/2/3, is_pit_out_lap, i1_speed, i2_speed, st_speed |
| `/stints?session_key=X` | Tyres | driver_number, stint_number, compound, lap_start, lap_end, tyre_age_at_start |
| `/pit?session_key=X` | Pit stops | date, driver_number, lap_number, pit_duration |
| `/race_control?session_key=X` | Flags, safety car, penalties | date, category, flag, message, lap_number, driver_number |
| `/weather?session_key=X` | Weather (about once a minute) | date, air_temperature, track_temperature, humidity, rainfall, wind_speed, wind_direction |
| `/team_radio?session_key=X` | Radio clips | date, driver_number, recording_url (mp3) |

Date filters must be URL encoded, for example `date%3E%3D2024-03-02T15:00:00` for `date>=`.

### Loading strategy

- **Small datasets** (drivers, laps, stints, pit, race_control, weather, team_radio, position, intervals): load all at once when the session is selected.
- **Large datasets** (location, car_data): load in time chunks.
  - `location`: one request per 60-second chunk for all drivers.
  - `car_data`: one request per 60-second chunk for the selected driver only. When the user switches driver, load that driver's chunk for the current time first.
  - Keep a buffer of the current chunk plus the next 2 chunks. Drop chunks older than 2 minutes behind the playhead to save memory.
  - When playback speed is high (5x or 10x), prefetch further ahead.
- **Request queue:** a single queue in `api.js` that limits requests to the free tier limit from the docs (assume 3 requests per second and 30 per minute if unsure). Retry on HTTP 429 and 5xx with exponential backoff. Never fire parallel bursts.
- **Cache:** store every response in IndexedDB keyed by the full URL. Historical data does not change, so the cache never expires. Add a "Clear cache" button in the desktop menu.
- **Loading state:** while a needed chunk is missing, pause playback and show "Loading data…" on the main screen. Never freeze the render loop.

### Data handling notes

- Telemetry and location samples are irregular. For any playhead time, interpolate linearly between the two nearest samples. Use binary search on sorted timestamps.
- `location` sometimes has gaps or (0,0,0) points when a car is in the garage. Treat those as "car not on track" and hide the car.
- Before the race start and after the finish, some cars sit in the pit lane. That is fine; show them where the data says.
- `drs` codes: 0 and 1 mean off, 8 means eligible, 10, 12 and 14 mean open. For 2026 sessions DRS was replaced by new aero rules, so if the field is missing or always 0, hide the DRS indicator for that session instead of showing "OFF".
- `team_colour` comes without `#`. Add it.
- Some 2023 sessions have missing driver headshots. Fall back to a coloured tile with the driver number and acronym.
- Intervals exist only for race and sprint sessions. Hide the gap columns for practice and qualifying, and show best lap time instead.

---

## 3. The world (scene layout)

All positions are in metres, relative to the user's starting floor position, user facing -Z. Use `local-floor` reference space.

| Element | Position | Size | Notes |
|---|---|---|---|
| Track table | center, 1.0 m in front, 0.9 m high | track fits in a 1.4 m circle | 3D track map with cars |
| Main screen | 2.8 m in front, centre at 1.6 m high | 2.4 m wide, 16:9 | Video, onboard view or loading messages |
| Race control ticker | directly above main screen | 2.4 m x 0.15 m | Scrolling messages, flag colour background |
| Leaderboard | left, 1.4 m away, angled 35° toward user | 0.9 m x 1.2 m | |
| Telemetry panel | right, 1.4 m away, angled 35° toward user | 0.9 m x 1.2 m | Selected driver |
| Laps and tyres panel | right, below or beside telemetry | 0.9 m x 0.6 m | |
| Weather panel | small, left of main screen | 0.4 m x 0.3 m | |
| Driver picker | arc of 20 tiles at waist height, 0.6 m in front of the table edge | each tile 0.12 m | Also available on left wrist (see controls) |
| Playback bar | just below the main screen or at table front edge | 1.2 m wide | Play/pause, speed, lap slider, time |

Every panel must face the user (rotate toward the user's start position).

### Pit wall room (VR mode)

- Dark room: floor with a subtle grid, low walls, soft blue-grey light, faint fog.
- One accent colour: F1-style red for the selected state and highlights. Team colours for everything driver related.
- Keep geometry cheap: a box room with a few emissive light strips, no textures larger than 1024x1024.
- Background music: none. Sound effects: optional and quiet (see section 7).

### Passthrough mode

- Same panels and track, but the room geometry and floor are hidden and the background is transparent, so the user sees their real room.
- Panels get a semi-transparent dark background (about 75% opacity) so text stays readable over a bright room.

### VR and passthrough toggle

- Request an `immersive-ar` session when supported (Quest 3 supports it). Inside that one session:
  - **Pit wall mode:** room geometry visible and opaque, so it looks like full VR.
  - **Passthrough mode:** room hidden, transparent background.
  - Toggle with a button on the wrist menu and the `B` button on the right controller. No session restart needed.
- If `immersive-ar` is not supported, fall back to `immersive-vr` and hide the toggle.
- On the desktop page, show two buttons: "Enter VR" and "Enter Passthrough" (which picks the starting mode).

---

## 4. Track and cars

### Building the track outline

1. Pick a reference driver who completed the most laps.
2. Find one clean lap for that driver from `/laps` (not a pit-in or pit-out lap, valid `lap_duration`, ideally under green flag).
3. Load `/location` for that lap's time window (date_start to date_start + lap_duration).
4. Build a closed smooth curve from those points (`CatmullRomCurve3`, closed), then a flat ribbon mesh along it (track width about 1.5% of the track's longest dimension, scaled).
5. Centre the track at the origin and scale it so its longest dimension is 1.4 m. Keep this transform; apply it to every car position. Use x and y from the API as the horizontal plane, and z (elevation) scaled the same way but exaggerated 2x so hills are visible.
6. Draw the start/finish line, a small marker for sector boundaries if they can be derived from lap data (optional), and a darker pit lane line if the location data shows it (optional, phase 7).
7. Cache the built track geometry per circuit in IndexedDB, keyed by circuit name, so it only builds once.

### Cars

- Use one `InstancedMesh` for all 20 cars (a simple low-poly wedge or capsule, about 2.5 cm long at table scale) with per-instance team colour.
- Each car points along its direction of travel (compute from the previous and next interpolated positions).
- Above each car, a small label with the 3-letter acronym and position number. Labels always face the user. Use a single texture atlas for all labels to keep draw calls low.
- **Selected car:** larger, glowing outline or emissive pulse, and a fading trail of its last 5 seconds of positions in team colour.
- Cars not on track (garage or retired) are hidden. Retired drivers are greyed out in the leaderboard with "OUT".

### Table interaction

- Grab the table with either grip button to move it. Grab with both grips to scale (0.5x to 3x) and rotate around the vertical axis.
- Double-press grip to reset the table to its default position.
- On desktop: mouse drag on the table rotates it, scroll wheel scales it.

---

## 5. Panels (content)

Build each panel as a `CanvasTexture` on a plane. Draw with the 2D canvas API. Use a texture resolution of about 1024 px per metre of panel width. Redraw only when the data shown has changed, and never more than 10 times per second.

Font: load one clear sans-serif from Google Fonts (for example "Titillium Web", which is close to F1 style) and wait for `document.fonts.ready` before the first draw. Use tabular numbers for all timing columns.

### Leaderboard (left)

Columns: Position, coloured team bar, acronym, gap to leader, interval to car ahead, tyre compound (coloured circle: Soft red, Medium yellow, Hard white, Intermediate green, Wet blue) with tyre age in laps, number of pit stops.

- Rows animate smoothly when positions change (row slides up or down over 0.5 s).
- Green flash on a row when a driver gains a position, red flash when they lose one.
- Purple marker next to the driver holding the fastest lap.
- Selected driver row highlighted.
- Header: session name, current lap / total laps, and the track status (Green, Yellow, Safety Car, VSC, Red) as a coloured pill.
- Tapping a row selects that driver.

### Telemetry (right)

For the selected driver:
- Driver name, number, team, headshot.
- Large speed number (km/h) and gear number.
- RPM as a horizontal bar with shift-light colours at the top end.
- Throttle bar (green, 0 to 100%) and brake indicator (red; `brake` may be 0/100 only, show it as on or off).
- DRS indicator (hidden for sessions without DRS data, see section 2).
- **Speed trace:** a line chart of speed over distance for the current lap, drawn live as the lap progresses, with the driver's previous lap drawn faintly behind it for comparison.

### Laps and tyres (right, lower)

- Current lap time running, last lap time, personal best, session best (purple when it is the fastest of all).
- Sector 1, 2, 3 of the last lap, coloured purple (overall best), green (personal best) or yellow (slower).
- Speed trap (`st_speed`) of the last lap.
- Tyre stint history as a horizontal strip: each stint a coloured block sized by lap count.

### Weather (small)

Air temperature, track temperature, humidity, wind speed with an arrow for direction, and a rain indicator. Use the latest weather sample at or before the playhead.

### Race control ticker (top)

- Shows the latest race control message at or before the playhead, scrolling if long.
- Background colour from the flag: yellow, double yellow, green, red, blue, chequered pattern, safety car orange.
- When a new message appears, flash the ticker and play a short chime.
- Keep the last 5 messages viewable by tapping the ticker (expands downward).

### Team radio

- When the playhead passes a `team_radio` item for the selected driver, show a "Radio" badge on the telemetry panel and play the mp3 through an `<audio>` element (if radio audio is enabled in the wrist menu).
- A list of all radio clips for the selected driver is available on the main screen's "Radio" tab.

---

## 6. Main screen

The screen has 3 tabs, switched by tapping tab buttons below it:

1. **Onboard** (default): a second three.js camera that follows the selected car on the track model at a low height, looking along its direction of travel, rendered to a `WebGLRenderTarget` (resolution 1024x576, updated at 30 fps, not every frame) and shown on the screen. Add the speed, gear and position as an overlay in the corner (drawn in the scene, not on the render target). This gives a "driver's eye" feel without moving the user.
2. **Video:** plays a video as a `VideoTexture`.
   - Source options (set from the desktop page before entering VR, and stored in localStorage): a direct video URL (mp4 or webm), an HLS stream URL (`.m3u8`, use `hls.js` from a CDN when the browser has no native HLS), or a local video file chosen with a file input.
   - In VR: play/pause, mute, and a sync toggle. When sync is on, the video's start time can be offset so it matches the replay (a number input on the desktop page: "video time at race start, in seconds").
   - Show a clear message when no video source is set: "Add a video source on the start page."
   - Do not ship, link or suggest any copyrighted F1 broadcast streams.
3. **Radio:** list of team radio clips for the selected driver with play buttons.

---

## 7. Controls

### VR controllers (Quest Touch Plus)

| Input | Action |
|---|---|
| Trigger (either hand) | Select the item the controller ray points at (driver tile, leaderboard row, button, slider) |
| Grip | Grab and move the track table (two grips: scale and rotate) |
| Right A | Play / pause |
| Right B | Toggle pit wall / passthrough |
| Left X | Previous driver (by position) |
| Left Y | Next driver (by position) |
| Right thumbstick left/right | Seek back / forward 10 seconds |
| Right thumbstick up/down | Playback speed up / down (0.5x, 1x, 2x, 5x, 10x) |
| Left thumbstick press | Re-centre all panels to the user's current position and facing |
| Left wrist (turn palm up) | Show wrist menu |

- Draw a thin laser ray from each controller with a dot where it hits. The ray turns red when it hovers something selectable. Hovered buttons scale up slightly.
- Short haptic pulse on every select.

### Hand tracking

- Use three.js `XRHandModelFactory` to show hands.
- Pinch (thumb and index together) with a ray from the hand acts as the trigger. Quest generates `select` events for pinch, so the same handlers should work; confirm this.
- Pinch-and-hold on the table edge to grab it.
- Wrist menu appears when the left palm faces the user.

### Wrist menu (left wrist)

Small panel with: Play/pause, speed, driver picker (compact grid of 20), toggle pit wall / passthrough, radio audio on/off, sound effects on/off, re-centre, exit to session picker.

### Desktop

- Mouse: click to select, drag the table to rotate, scroll to scale, right-drag to orbit the camera (OrbitControls).
- Keyboard: Space play/pause, Left/Right seek 10 s, Up/Down speed, `[` and `]` previous/next driver, `P` toggle passthrough look (shows a neutral grey background on desktop).

---

## 8. Playback

- Playhead is a session timestamp (UTC). Real time advances `delta * speed`.
- Speeds: 0.5x, 1x, 2x, 5x, 10x.
- Lap slider: drag to any lap. Seeking jumps the playhead to that lap's start time for the leader (from `/laps`), then loads the needed chunks before resuming.
- Also show elapsed race time and the real session clock.
- Start point for races: 2 minutes before the race start (the first lap 1 `date_start`), so the user sees the grid.
- Sound effects (optional, short, quiet, generated with WebAudio, no audio files): chime on a new race control message, a soft whoosh on an overtake (position change) involving the selected driver, a beep when fastest lap changes.

---

## 9. Start page (2D, before entering VR)

Shown in the browser before the user enters VR. Works on Quest and desktop.

- Title: "F1 Pit Wall VR"
- Season dropdown (2023 to current year).
- Race weekend list for that season (country flag emoji or circuit name, date). Hide weekends that have not happened yet.
- Session list for the chosen weekend (Race default; also Sprint, Qualifying, Practice).
- Video source settings (section 6) inside a collapsed "Video screen" section.
- Buttons: "Enter VR", "Enter Passthrough", "Preview on desktop" (renders the scene in the page without XR).
- Loading progress while the base data loads ("Loading drivers… laps… track…").
- Small footer: "Data from OpenF1 (unofficial, not affiliated with Formula 1)."
- Remember the last chosen session in localStorage.

Design: dark background, red accent, Titillium Web font, large touch targets (minimum 48 px) because Quest browser input is a laser pointer.

---

## 10. File structure

```
/
├── index.html            # start page, import map, entry point
├── css/
│   └── start.css
├── js/
│   ├── main.js           # boot, start page logic, enters XR
│   ├── api.js            # OpenF1 fetch, request queue, rate limit, retries
│   ├── cache.js          # IndexedDB cache
│   ├── session-data.js   # loads and indexes all data for a session, chunk loader
│   ├── interp.js         # binary search and interpolation helpers
│   ├── playback.js       # playhead, speed, seek
│   ├── scene/
│   │   ├── world.js      # renderer, XR session, room, lighting, mode toggle
│   │   ├── track.js      # track outline build, table group, grab/scale
│   │   ├── cars.js       # instanced cars, labels, trail
│   │   ├── onboard.js    # follow camera and render target
│   │   └── screen.js     # main screen, tabs, video texture
│   ├── panels/
│   │   ├── panel-base.js # canvas texture panel, hit testing, redraw throttle
│   │   ├── leaderboard.js
│   │   ├── telemetry.js
│   │   ├── laps.js
│   │   ├── weather.js
│   │   ├── ticker.js
│   │   ├── driver-picker.js
│   │   ├── playback-bar.js
│   │   └── wrist-menu.js
│   ├── input/
│   │   ├── xr-input.js   # controllers, hands, rays, haptics, button mapping
│   │   └── desktop-input.js
│   └── audio.js          # WebAudio sound effects, radio playback
├── .github/workflows/pages.yml (optional, or use branch deploy)
└── README.md
```

Keep each file focused and under about 400 lines. Use small classes or plain modules with clear `init`, `update(time)` and `dispose` functions.

### Panel hit testing

`panel-base.js` should let each panel register clickable rectangles in canvas pixel coordinates. When a ray hits a panel plane, convert the hit UV to canvas pixels and find the rectangle. One shared raycaster for all panels, run only when a controller moves or on select.

---

## 11. Phases

Commit at the end of each phase with a clear message. After each phase, tell me exactly what to test.

**Phase 1: Data layer and start page**
- `api.js`, `cache.js`, `session-data.js`, `interp.js`.
- Start page with season, weekend and session pickers working against the real API.
- A debug view on the desktop page that prints driver list, lap count and one interpolated car position for a given time.
- Test: pick the 2024 Bahrain Grand Prix race and confirm 20 drivers and the correct lap count load, and that a second load is instant (cache).

**Phase 2: Scene, track and cars (desktop preview)**
- Renderer, room, lighting, track outline built from location data, instanced cars moving with playback.
- Playback with keyboard controls.
- Test: cars move smoothly around the correct track shape at 1x and 10x, with no stutter when chunks load.

**Phase 3: Panels**
- Leaderboard, telemetry with speed trace, laps and tyres, weather, ticker, playback bar, driver picker.
- Selecting a driver on desktop updates telemetry, highlights the car and leaderboard row.
- Test: values match what the API returns for the same timestamp.

**Phase 4: WebXR**
- immersive-ar session with immersive-vr fallback, pit wall / passthrough toggle.
- Controllers, rays, haptics, button mapping, hand tracking with pinch, wrist menu, table grab and scale, re-centre.
- Test on desktop with the "Immersive Web Emulator" Chrome extension first, then on the Quest.

**Phase 5: Main screen**
- Onboard follow camera on a render target, video tab with URL, HLS and local file sources and sync offset, radio tab.
- Test: onboard view follows the selected car; a sample public mp4 plays on the screen.

**Phase 6: Polish and performance**
- Leaderboard row animations, flashes, fastest lap marker, flag colours, sound effects, team radio playback.
- Performance pass on Quest: check fps with the Quest browser's performance overlay or a simple in-scene fps counter (toggle in wrist menu). Fix anything under 72 fps.
- Handle errors: API down, session with missing data, no XR support (clear message on the start page).

**Phase 7: Deploy**
- Create the GitHub repo, push, enable GitHub Pages, confirm the HTTPS URL works.
- README with: what it is, how to open it on Quest 3, controls table, how to add a video source, how to run locally (`npx serve` or `python -m http.server`), data source credit, and known limits.

---

## 12. Things to keep in mind

- **Live data is out of scope for version 1.** OpenF1 real-time access is a paid subscription, and even then the location and car data feeds arrive after the session. Structure `session-data.js` so a live source could replace the historical fetches later without changing the scene code (one interface: `getCarsAt(time)`, `getTelemetryAt(driver, time)`, `getLeaderboardAt(time)`, etc.).
- **No copyrighted media.** Do not include F1 logos, team logos, official fonts, or broadcast video. Use team colours and plain text names only. Driver headshots come from the API's `headshot_url`; if they fail to load due to CORS, fall back to the coloured number tile.
- **Quest browser specifics:** WebXR only works over HTTPS (GitHub Pages is fine). Audio only starts after a user gesture, so unlock the AudioContext on the "Enter VR" click. Text on panels must be at least about 24 px tall on a 1024 px-per-metre canvas to stay readable at 1.4 m.
- **Do not guess API behaviour.** If an endpoint returns something unexpected, log a sample to the console, adapt, and tell me.
- **Ask me before** adding any paid service, any new dependency beyond three.js and hls.js, or any change to the scene layout above.
