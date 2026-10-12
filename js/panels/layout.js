// Panel placement (spec §3). Metres, relative to the user's start floor position,
// user facing -Z. Every panel is rotated to face the start position (PanelManager.add).
// Sizes are the spec's; positions are derived from the spec's distances and angles.

const DEG = Math.PI / 180;

/** Point at `dist` metres from the user, `azimuthDeg` right of straight ahead (-Z), at height y. */
function polar(dist, azimuthDeg, y) {
  return { x: dist * Math.sin(azimuthDeg * DEG), y, z: -dist * Math.cos(azimuthDeg * DEG) };
}

export const MAIN_SCREEN = { width: 2.4, height: 2.4 * 9 / 16, position: { x: 0, y: 1.6, z: -2.8 } };
const SCREEN_TOP = MAIN_SCREEN.position.y + MAIN_SCREEN.height / 2;
const SCREEN_BOTTOM = MAIN_SCREEN.position.y - MAIN_SCREEN.height / 2;

export const LAYOUT = {
  // Left, 1.4 m away, 35° toward the user.
  leaderboard: { width: 0.9, height: 1.2, position: polar(1.4, -35, 1.4) },
  // Right, mirrored.
  telemetry: { width: 0.9, height: 1.2, position: polar(1.4, 35, 1.4) },
  // Right, beside telemetry (a panel 0.9 m wide spans ~37° at 1.4 m).
  laps: { width: 0.9, height: 0.6, position: polar(1.4, 72, 1.4) },
  // Small, left of the main screen.
  weather: { width: 0.4, height: 0.3, position: { x: -1.55, y: 1.75, z: -2.7 } },
  // Directly above the main screen. The mesh is 0.65 m tall so it can expand
  // downward over the screen; collapsed, only the top 0.15 m strip is drawn.
  ticker: {
    width: 2.4, height: 0.65, stripHeight: 0.15,
    position: { x: 0, y: SCREEN_TOP + 0.03 + 0.15 - 0.65 / 2, z: -2.79 },
  },
  // Just below the main screen.
  playbackBar: { width: 1.2, height: 0.16, position: { x: 0, y: SCREEN_BOTTOM - 0.13, z: -2.75 } },
  // 20 tiles (0.12 m) at waist height near the table's near edge, tilted back 35°
  // like a console, centred on the user. One arc can't fit 20 tiles (2.7 m of arc vs
  // 1.3 m at this radius), so DriverPicker uses two rows of 10 (P1–P10 behind/above).
  driverPicker: { tile: 0.12, gap: 0.015, radius: 0.62, y: 1.0, tiltDeg: 35, spanDeg: 120 },
};
