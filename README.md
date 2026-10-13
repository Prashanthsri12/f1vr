# F1 Pit Wall VR

Replay real Formula 1 sessions on a pit wall in VR. A WebXR app for the **Meta Quest 3** browser, which also runs in desktop Chrome.

**Live:** https://prashanthsri12.github.io/f1vr/

- A 3D track table with all 20 cars moving, built from real position data
- A leaderboard with gaps, intervals, tyres, pit stops and the track status
- Telemetry for a selected driver: speed, gear, RPM, throttle, brake, DRS, and a live speed trace
- Laps and tyres (sector colours, personal and session bests, stints), weather, and a race control ticker
- **Pit wall** mode (a virtual room) or **passthrough** mode (your real room), switchable in the same session
- Controllers or hand tracking: point and pinch, and grab the table to move, scale and rotate it

The data comes from the free historical [OpenF1](https://openf1.org) API (2023 onwards). No account or API key is needed.

## Open it on Quest 3

1. Open the **Live** link above in the Quest browser.
2. Pick a season, race weekend and session. The Race session is selected by default.
3. Tap **Enter VR** (pit wall room) or **Enter Passthrough** (your room).

The first load of a session downloads its data, which takes a few seconds. After that it is cached in the browser and loads instantly.

## Controls

### Quest Touch controllers

| Input | Action |
|---|---|
| Trigger | Select what the ray points at (leaderboard row, button, slider, screen tab) |
| Grip | Grab the table and move it. Use both grips to scale (0.5–3×) and rotate it |
| Grip, double press | Reset the table |
| Grip on a panel | Pick the panel up; it follows the ray and keeps facing you. Right stick ↑ / ↓ pushes it away / pulls it closer, ← / → makes it smaller / larger. Grip it with your other hand too and stretch to resize. The layout is saved on the headset |
| A (right) | Play / pause |
| B (right) | Toggle pit wall / passthrough |
| X / Y (left) | Previous / next driver (by position) |
| Right stick ← / → | Seek −10 s / +10 s (hold to repeat) |
| Right stick ↑ / ↓ | Playback speed up / down (0.5×, 1×, 2×, 5×, 10×) |
| Left stick press | Re-centre the panels and table to where you stand and face |
| Left palm toward you | Wrist menu (play, speed, driver grid, passthrough, radio, sounds, room theme, fps counter, re-centre, reset layout, exit) |

### Hand tracking

Put the controllers down and your hands appear. **Pinch** to select. **Pinch and hold** the outer edge of the table to grab it, and use two hands to scale and rotate it. **Pinch and hold** a panel's top edge (its title bar) to pick the panel up; pinch-hold it with the other hand too and stretch to resize it.

### Desktop ("Open on desktop")

The desktop shows a flat dashboard that fills the window: the track in the middle, the leaderboard and laps on the left, telemetry, the main screen and weather on the right, race control on top and the playback bar below. It rearranges itself for vertical monitors and narrow windows (scrolling when the window is too small for readable text).

| Input | Action |
|---|---|
| Click | Select a leaderboard row, button or tab |
| 2D / 3D (or V) | Track view: flat top-down map (default) or tilted 3D. Remembered |
| Drag on the track | Pan (2D) or rotate (3D); right-drag pans |
| Wheel on the track | Zoom |
| Double-click the track | Reset the view |
| ⤢ (or F) | Swap the track and the main screen, e.g. to watch your video big |
| Space | Play / pause |
| ← / → | Seek 10 s |
| ↑ / ↓ | Playback speed |
| `[` / `]` | Previous / next driver |
| Esc or Exit | Back to the start page |

## Main screen, video and sound

The main screen (the big screen ahead of you in VR, a tile on the desktop) has two tabs:

- **Video:** your own video source. Open **Video screen** on the start page to set a direct mp4/webm URL, an HLS `.m3u8` URL, or a local file, plus the video time at the race start if you want it synced to the replay. The app never ships or links broadcast streams.
- **Radio:** the selected driver's team radio clips, with play buttons.

Team radio for the selected driver also plays automatically as the replay passes each clip (up to 2.5× speed), and quiet sound effects mark race control messages, the selected driver's overtakes and new fastest laps. Turn either off in the wrist menu. There is no commentary: OpenF1 has none, and broadcast commentary is copyrighted.

## Run locally

The app is static files: no build step and no dependencies to install. Serve the folder:

```sh
npx serve -l 5173 .
# then open http://localhost:5173
```

WebXR needs HTTPS or `localhost`. To test on a Quest against a local server, use USB with `adb reverse tcp:5173 tcp:5173` and open `http://localhost:5173` on the headset.

Tests (Node 24, no dependencies):

```sh
node --test
```

## Deployment

Every push to `master` deploys to GitHub Pages through `.github/workflows/pages.yml`. Only `index.html`, `css/` and `js/` are published. The one-time setup is Settings → Pages → Source: **GitHub Actions**.

## Known limits

- Historical sessions only (2023 onwards). Live timing needs a paid OpenF1 subscription.
- The free OpenF1 tier allows about 30 requests a minute. Playing at 10× or jumping around a lot can briefly show "Loading data…".
- Team radio coverage drops sharply from 2026.
- In VR, pick drivers from the wrist menu, the leaderboard or X / Y; on the desktop, click a leaderboard row or press [ / ].
- Some 2023 sessions lack driver headshots. A coloured number tile is shown instead.

## Credits

Data from [OpenF1](https://openf1.org). Car model by [Kenney](https://kenney.nl/assets/racing-kit) (CC0, Racing Kit `raceCarWhite`). This project is unofficial and not affiliated with Formula 1, the FIA or any team. It includes no F1 logos, team logos, official fonts or broadcast media. Rendering uses [three.js](https://threejs.org).
