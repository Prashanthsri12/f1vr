# User checks (Phases 1–9, everything built so far)

What to check by hand, on the desktop and on the Quest 3. Tick each box as you go and note anything that fails or feels wrong at the end of its section.

**Before you start**
- The checks run against the live site, https://prashanthsri12.github.io/f1vr/. The newest work (Phase 9c and 9d) has to be pushed first.
- After a push, hard-refresh: Ctrl+Shift+R on desktop, reload on the Quest.
- A good test session: **2024 Bahrain, Race**. It has a full field, team radio and pit stops.
- A second session for the edge cases: **2023 Australia, Race**, with red flags and retirements (it should show 58 laps).

**Removed or replaced on purpose. Don't look for these:**
- The onboard camera tab: removed at your request (Phase 8).
- The desktop 3D room, with Shift-drag panels, Shift+wheel resize, the `R` and `T` keys and the driver tiles: replaced by the desktop dashboard (8.10). The room is only reachable with `?debug` → "Room preview (debug)".
- The driver tiles in VR (4b.1).

**Not built yet:**
- The wrist menu switch between Screen and Immersive, and Flat / Curved (8.13). For now:
  - Screen or Immersive: choose on the start page before entering VR.
  - Curved: there is no way to choose it in the app yet.
- The Quest 2D-page check (8.14) and the final docs (8.16).

---

## Phase 1 — Data and start page (desktop or Quest)

- [ ] The start page loads with a dark theme, a red accent, the Chakra Petch title font and Titillium text.
- [ ] Season → race weekend → session pickers fill in from the live API, and the Race session is preselected.
- [ ] Reload the page: the last session you picked is remembered.
- [ ] The first load shows progress steps. Opening the same session again is near-instant (cached).
- [ ] **Clear cache** works and says so. The next load downloads again.
- [ ] The footer has the OpenF1 data credit.
- [ ] With the network off or OpenF1 down, the page shows "Retrying… (attempt n)" and a Retry button, not a frozen page (6.10).

## Phase 2 — Track and cars

Desktop dashboard track tile, or the VR table / track tile.

- [ ] The track outline looks like the real circuit, with a start/finish line and the pit lane line (6.12).
- [ ] All 20 cars move smoothly at 1× and at 10×, with no stutter when new data loads.
- [ ] Cars are the Kenney race car model in team colours, pointing the way they drive, including through corners.
- [ ] Cars that are off track or not yet out are hidden.
- [ ] The selected car is bigger, pulses and leaves a short fading trail (Phase 9 adds a ring under it and short trails for every car).
- [ ] Car labels (e.g. "VER 1") are readable. When crowded, less important cars show only their position number (4b.7).
- [ ] Playback starts about 2 minutes before lap 1. While data is loading it pauses ("Loading data…") instead of jumping.

## Phase 3 — Panels

- [ ] **Leaderboard:** positions, gaps, intervals, tyre and pit count, and the track status pill. Clicking a row selects that driver.
- [ ] **Practice or qualifying session:** the leaderboard shows best laps instead of gaps.
- [ ] **Telemetry:**
  - driver name with a headshot (or a coloured number tile);
  - speed, gear, RPM, throttle, brake and DRS;
  - a speed trace with the previous lap drawn faintly.
- [ ] **Laps and tyres:**
  - current, last, personal best and session best times;
  - coloured sectors and the speed trap;
  - the stint strip.
- [ ] **Weather:** air and track temperature, humidity, a wind arrow, and rain when it's raining.
- [ ] **Race control:** flag colours, and a click expands the last 5 messages. A new message flashes.
- [ ] **Playback bar:** play/pause, speed −/+, the lap slider (click to jump), elapsed time and the UTC clock.
- [ ] Selecting a driver updates the telemetry, the laps panel, the car highlight and the leaderboard row together.
- [ ] Spot-check one value (e.g. a lap time) against the OpenF1 data.

## Phase 4 / 4b — WebXR on the Quest 3

Choose **Floating panels around a 3D table** under "In VR, show" on the start page for this section.

- [ ] **Enter VR** opens the pit wall room. **Enter Passthrough** opens your real room with the panels at 75% opacity.
- [ ] B toggles pit wall ⇄ passthrough without restarting.
- [ ] Controller rays turn red over anything clickable. Trigger selects, with a haptic pulse.
- [ ] Buttons:
  - A play/pause;
  - X / Y previous/next driver;
  - right stick ←/→ seek, ↑/↓ speed;
  - left stick press re-centres.
- [ ] **Table:** one grip moves it; two grips scale (0.5–3×) and rotate it; a double grip resets it.
- [ ] **Hands:**
  - pinch selects;
  - pinch-hold on the table edge grabs it.
- [ ] **Wrist menu (left palm toward you):** every item works:
  - play, speed, driver grid;
  - passthrough;
  - radio and sound toggles;
  - room theme, fps;
  - re-centre, reset layout, exit.
- [ ] **Re-centre:** the panels and table come in front of you wherever you stand and face.
- [ ] **Moving panels:**
  - grip a panel, or pinch-hold its title bar, to carry it;
  - the stick pushes it away or pulls it closer;
  - the layout is saved after exit and re-entry;
  - Reset layout puts everything back.
- [ ] **Resizing panels:**
  - hold a panel and push the right stick ←/→;
  - or grab it with both hands and stretch.

  Text stays sharp when enlarged.
- [ ] **Room:** fully enclosed, with no passthrough showing above the walls. Try all 3 themes (Pit wall, Studio, Night) and note your favourite.
- [ ] Car names are still readable with the table shrunk to about half size.
- [ ] No driver tiles in VR.
- [ ] A browser without WebXR shows a clear message instead of a broken button.

## Sound (4b.15, 4b.16)

- [ ] At 1× or 2×, the selected driver's team radio plays by itself as the replay passes a clip, with a "Radio" badge on the telemetry panel.
- [ ] Quiet sound effects:
  - a chime on a new race control message;
  - a whoosh when the selected driver gains or loses a place;
  - a beep on a new fastest lap.
- [ ] Radio and sounds can each be turned off in the wrist menu.
- [ ] On the Quest it's actually audible. This was the original complaint.

## Phase 5 — Main screen (Video and Radio tabs)

- [ ] It opens on **Radio** when no video source is set, and on **Video** when one is.
- [ ] **Radio tab:** the selected driver's clips with play/stop buttons, and paging when there are many.
- [ ] **Video tab with no source:** "Add a video source on the start page."
- [ ] **Video source:** on the start page, open **Video screen**, then set a direct mp4/webm URL, an HLS `.m3u8` URL, or a local file. It plays, and Play and Mute work.

## Phase 6 — Polish

- [ ] **Leaderboard motion:**
  - rows slide when places change;
  - green or red flashes for a gain or loss;
  - a purple marker for the fastest lap.
- [ ] A retired driver shows "OUT" from when the car stops (2023 Australia).
- [ ] The race control strip shows the right flag colour, and the chequered flag at the end.
- [ ] The fps counter (wrist menu) shows in VR.
- [ ] **6.9:** VR holds about 72 fps during playback, including at 10× and in the Night theme.
- [ ] A session with missing data shows "No data" or "No car position data" notes instead of breaking.

## Phase 7 — Deploy

- [ ] The live site loads over HTTPS on the desktop and in the Quest browser.
- [ ] The README reads correctly (what it is, how to open it on Quest, controls, credits including the Kenney car model).

## Phase 8 — Screen mode

### Desktop dashboard ("Open on desktop")

- [ ] It opens a flat dashboard, not a 3D room:
  - leaderboard and laps on the left;
  - the track in the middle;
  - telemetry and Insights on the right, with the main screen and weather side by side below them (Phase 9);
  - race control on top and the playback bar below.
- [ ] Text is sharp and readable at your monitor's normal zoom.
- [ ] **Monitor sizes:**
  - **Horizontal monitor** (1080p, 1440p, ultrawide or 4K): no scrolling.
  - **Vertical monitor**, or a tall narrow window: it switches to the stacked portrait layout.
  - **Small laptop or narrow window:** it scrolls rather than shrinking text too far.
  - Resizing the window rearranges everything live.
- [ ] **Track tile:**
  - starts in **2D** (top-down map); drag pans, the wheel zooms, a double-click resets;
  - **3D** button (or `V`): a tilted view, drag rotates, right-drag pans;
  - the choice is remembered on reload.
- [ ] Cars on the 2D map are big enough to see, and the labels are readable.
- [ ] **Race control strip:** click to expand over the track, click again to collapse.
- [ ] **Swap:** **⤢** (or `F`) swaps the track and the main screen; again swaps back.
- [ ] **Keys:**
  - Space play/pause;
  - ←/→ seek 10 s;
  - ↑/↓ speed;
  - `[` `]` previous/next driver;
  - **Esc** or **Exit** returns to the start page.
- [ ] Clicking a leaderboard row selects the driver; the car highlight and the telemetry follow.

### Video sync (8.8)

Use your own video file or URL, set on the start page.

- [ ] In the Video tab, find lights out in the video and press **Sync here**. The replay lines up.
- [ ] With **Sync ON · video leads**, the replay follows the video:
  - pausing or scrubbing the video moves the cars and panels with it;
  - the replay's play/pause, seek and speed buttons control the video.
- [ ] Speed above 2× pauses the video and the replay runs on its own. Back at 2× or slower, the video picks up at the right moment.
- [ ] Switching to the Radio tab lets the replay carry on by itself.

### F1TV side by side (8.9)

- [ ] The playback bar's second row has Lights out, ◀ Lap / Lap ▶, and −5 −1 [offset] +1 +5.
- [ ] **⚑ Lights out** (or `L`) jumps to the race start.
- [ ] ◀ Lap / Lap ▶ (or PgUp / PgDn) step through laps.
- [ ] **Nudge:**
  - ±1 s with `,` / `.`;
  - ±5 s with Shift+`,` / Shift+`.`;
  - the offset shows in the bar and is still there when you reopen the same session.
- [ ] **Real test:** play an F1TV replay in another window, press Lights out and start both together, then nudge until they match. They should stay in step over a few laps at 1×.

### Screen in VR (8.11, 8.12) — Quest

On the start page, set **In VR, show → One big screen** (the default).

- [ ] Enter VR: the whole dashboard is on one big screen about 2.3 m in front of you. The track is drawn from above on its tile, with no table in the room.
- [ ] Text is readable from where you sit or stand. Note whether the screen feels too big, too small, too close or too far.
- [ ] Trigger or pinch on leaderboard rows, playback bar buttons and the Radio/Video tabs works.
- [ ] **Move the whole screen:**
  - grip anywhere on it, or pinch-hold on the track tile, and it follows your hand;
  - right stick ↑/↓ pushes it away or pulls it closer;
  - ←/→ makes it smaller or larger;
  - two-hand stretch also resizes it.
- [ ] The screen placement is remembered after exit and re-entry. Wrist menu → **Reset layout** puts it back.
- [ ] Left stick press (re-centre) brings the screen in front of you.
- [ ] Gripping away from the screen does nothing; there is no hidden table to grab.
- [ ] It works in all 3 room themes and in passthrough (**Enter Passthrough**).
- [ ] The track view follows the 2D/3D choice made on the desktop.
- [ ] fps stays around 72 with the fps counter on.
- [ ] **Immersive still works:** on the start page set **In VR, show → Floating panels**, enter VR, and the Phase 4/4b checks still pass.

## Phase 9 — Style pass and analytics

Use **2024 Bahrain, Race** unless a box says otherwise. For rain and safety cars use **2023 Netherlands, Race** (rain from about 13:04 UTC, a safety car and a VSC) or **2024 Canada, Race** (rain and two safety cars). For practice / qualifying use **2024 Bahrain, Practice 2** or **Qualifying**.

### 9a — New look (desktop, then Quest)

- [ ] **Start page:** darker background with a soft glow, glassy cards, the title in the new sporty font (Chakra Petch), a red glow on the main button.
- [ ] **Every panel:** darker, with a faint top sheen and a thin edge. Big numbers (lap times, speed, gaps, positions) are in the new font. Nothing is cut off or overlapping.
- [ ] **Leaderboard:**
  - each row fades from the team colour, the team strip glows, and the selected driver's row has a glowing outline;
  - the **+/−** column shows places gained (green ▲) or lost (red ▼) since the grid. Check a few against the real result (e.g. LEC started P2);
  - a blue **PIT** chip while a car is in the pit lane;
  - a green **DRS** chip on cars less than 1 s behind the car ahead once DRS is enabled (not on lap 1, not behind the safety car);
  - the fastest-lap holder has the purple stopwatch.
- [ ] **Telemetry:** 15 shift lights (green, red, blue) that light up with the revs; a round speed gauge with the RPM inside; a big gear number; tall throttle (green) and brake (red) bars; the DRS light. They move smoothly at 1×.
- [ ] **Laps and tyres:** sector cards tinted purple / green / yellow with the time in that colour; a row of small **mini-sector** blocks under them once a lap is done; the current tyre ring glows.
- [ ] **Weather:** a sun icon when dry, a cloud with rain when it rains.
- [ ] **Rain in the VR room** (Netherlands or Canada, once it starts raining): faint streaks fall in the room, none right in front of your face, and they fade away in passthrough. Note if it's distracting.

### 9b — Track, cars, race moments, sound

- [ ] **Neon track:** the track edges glow. The **Sectors / Mini / Plain** button (or `C`, or wrist menu → **Track:**) cycles:
  - **Sectors:** the selected driver's last lap, each sector purple, green or yellow (it changes as they finish laps);
  - **Mini:** short segments in the team colour of whoever last went purple there (positions are approximate);
  - **Plain:** one colour.

  The choice is remembered.
- [ ] **Trails:** every car leaves a short fading trail. The selected car keeps its longer trail and has a **pulsing ring** under it (a thin ring, not a big blob). Check in 2D, 3D and in VR.
- [ ] **Banners** (play from before lights out at 1×):
  - **LIGHTS OUT** at the start;
  - **FASTEST LAP** with the driver and time;
  - **PIT STOP** for the selected driver and the top 3 only (not every stop);
  - **OVERTAKE** "X passes Y for Pn" for the selected driver or the top 3, and **not** when a car is only pitting;
  - **CHEQUERED FLAG · VER wins** at the end;
  - Netherlands / Canada: **SAFETY CAR**, **VIRTUAL SAFETY CAR**, **TRACK CLEAR** (and **RED FLAG** if there is one).

  On desktop the banner slides across the track tile. In VR it fades in ahead of you and does **not** follow your head.
- [ ] Seeking or jumping around never fires a burst of banners.
- [ ] **Flag lighting:** during a yellow, safety car or red flag, the dashboard edge (desktop) and, in VR, the room's light strips and the table rim slowly turn yellow / orange / red, then back to red when the track is clear. No flashing.
- [ ] **Sounds:** a soft click on buttons and panel taps. The **Engine** button (or `E`, or wrist menu → **Engine**) turns on a quiet hum that follows the selected driver's revs. It goes quiet when paused or above 2×. Off by default.
- [ ] **Wrist menu (VR):** the new rows (Track / Engine and Analytics / Full session) all work and the menu still fits.

### 9c — Insights and race timeline

- [ ] **Layout (desktop, landscape):** Insights sits under telemetry, and the main screen and weather share the bottom row. Nothing overlaps at 1080p, 1440p, ultrawide and 4K. Portrait: Insights and weather share a row. Narrow window: Insights comes after telemetry.
- [ ] **Battles tab:** pairs less than 1 s apart, the selected driver's battle first, each with the gap, **CLOSING / STEADY / PULLING AWAY**, a gap line over the last laps and a DRS chip. Clicking a name selects that driver. Outside races it says battles are for races.
- [ ] **Head-to-head tab:** the selected driver vs the car ahead; ◀ ▶ picks another rival. Position, gap, last and best lap, sector differences (green where each was quicker), tyre, stops and top speed. Spot-check a lap time.
- [ ] **Driver tab:** photo (or number tile), team, RUNNING / IN THE PITS / OUT, position with ▲▼ vs the grid, best lap and its rank, laps led, stops, top speed, laps done and the stints so far.
- [ ] **Race timeline** on the playback bar's slider: blue pins for the selected driver's pit stops (other stops faint), purple diamonds for new fastest laps, and orange / yellow / red bands for SC / VSC / red flag periods (Netherlands / Canada). Only what has happened so far shows. Clicking a mark jumps the replay to just before it.
- [ ] **Screen in VR:** the Insights tile is on the big screen and readable, and its tabs work with the ray or a pinch.
- [ ] **Floating panels (Immersive):** an Insights panel on your left, mirroring the laps panel on the right. It can be moved and resized like the others.
- [ ] The video tile is now half as wide in landscape: ⤢ / `F` still swaps it into the big tile.

### 9d — Analytics

- [ ] **Analytics tab** (main screen, desktop and VR): Video / Radio / **Analytics**. ◀ ▶ in the chart header cycles the charts. In VR the chart sits in the screen's middle, not hidden behind the side panels.
- [ ] **Analytics mode** (desktop: **Analytics** button or `A`; VR big screen: wrist menu → **Analytics**): six charts with a small track and the leaderboard on the right, the ticker above and the playback bar below. At 1080p it fits without scrolling. Press again to go back. It's remembered on reload.
- [ ] **Spoilers:** by default (**UP TO NOW**) the charts only show what has happened, and grow as the replay plays. **FULL SESSION** (chart header or wrist menu) shows the whole race, including the timeline marks. Remembered.
- [ ] **Hover** (mouse, or the VR ray) over a lap shows a tooltip with the values; **click** jumps the replay to that lap.
- [ ] **Charts in a race** — each looks sensible:
  - **Gap to leader** (SC periods shaded), **Lap chart** (positions per lap), **Strategy** (every driver's stints in tyre colours);
  - **Lap times** (selected vs rival, tyre-coloured dots, dashed stint pace, faint = not a clean lap);
  - **Tyre degradation** with the **RAW / FUEL-CORRECTED** switch: the corrected slopes are steeper (Bahrain raw: about +0.08 s/lap on softs, +0.07 on hards);
  - **Pace and consistency** (best, theoretical best, σ, clean laps, last stint pace);
  - **Strategy tools** (pit loss around 24–25 s at Bahrain, where the selected driver would rejoin if they pitted now, and an undercut / overcut list with sensible numbers);
  - **Driver comparison** (both speed traces on one lap, the gap strip, sector differences, speed traps; **vs** changes the rival, **FASTEST / LAST LAPS** switches the lap). It says "Loading car data…" briefly the first time.
- [ ] **Practice / qualifying:** the race-only charts are replaced by Lap times, Pace and consistency, **Long-run pace** (FP2: each driver's longest run, ranked), Tyre degradation, Driver comparison and Strategy.
- [ ] **Performance:** with Analytics mode on, playing at 1× and at 10×, the desktop stays smooth, and in VR the fps stays around 72 (turn the fps counter on).

---

## Phase 10 — Neon F1 look

Open the 2024 Bahrain race on desktop ("Open on desktop"), then in the headset (Screen in VR).

- [ ] A red-and-white kerb stripe runs along the top of the start page and the dashboard.
- [ ] Panels are matte dark (no glass), titles have a red slash, and big numbers are heavy italic.
- [ ] Leaderboard rows show a car-number badge in the team colour; your selected driver has a cyan outline.
- [ ] Telemetry shows a car-number sticker, a speed arc going green → yellow → red, a glowing cyan gear and segmented throttle / brake bars.
- [ ] Laps, Insights (battles, head-to-head, driver card) and Weather use team stickers; Weather shows "Night race" for Bahrain (no sun icon).
- [ ] The track tile shows Sakhir / Race / Night race stickers bottom left, and car labels are team-colour tags with a white rim.
- [ ] The play button is red with a white rim; the lap slider fills red with a white playhead.
- [ ] Race banners (overtakes, flags, pit stops) pop in as a slanted tag near the top of the track and fade out; in VR the same look appears ahead of you.
- [ ] Analytics mode (A) and the Quest still run smoothly (debug HUD: about 17 draw calls on desktop).
- [ ] It feels sporty and fun, but not too dramatic. Note anything that is too much or too little.

## Notes

Write what failed or felt wrong here, with the section and box, and I'll turn it into the next fixes.

-
