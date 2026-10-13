// Main screen (spec §6): a 2.4 m 16:9 screen at MAIN_SCREEN in the layout rig (so re-centre
// carries it), with three tabs:
//   Onboard (default): the onboard camera's render target + a speed / gear / position card
//   Video: the start page's video source (or "Add a video source…"), play / mute / sync strip
//   Radio: the selected driver's team radio clips with play buttons
// Placement: everything sits on the screen face, inside its centre band (|x| < 0.8 m): from
// the user's start position the leaderboard and telemetry panels (±17°–53°) hide the screen's
// outer 0.35 m on each side. Screen-local, 2 cm in front of the bottom edge:
//   tab strip 0.54 x 0.10 m at x +0.5 (y -0.615, rig-local y 0.985)
//   onboard card 0.62 x 0.15 m at x -0.5 (Onboard tab) / video controls 0.54 x 0.10 m at x -0.5 (Video tab)
// The playback bar stays just below the screen and the ticker above it.
// Draw calls: screen 1 + tabs 1 + one of overlay / content / controls (+ the onboard pass,
// ~5 calls at 30 fps, into its own render target).
import * as THREE from 'three';
import { MAIN_SCREEN } from '../panels/layout.js';
import { Onboard, OnboardOverlay } from './onboard.js';
import { ScreenVideo, VideoControls, NO_SOURCE } from './screen-video.js';
import { ScreenContent, ScreenTabs } from './screen-radio.js';

const W = MAIN_SCREEN.width;
const H = MAIN_SCREEN.height;
const STRIP_Y = -H / 2 + 0.06;   // tab / control strips, screen-local
const STRIP_X = 0.5;
const STRIP_Z = 0.008;

/**
 * @param {object} o
 * @param {import('../panels/panel-base.js').PanelManager} o.manager panels go in its layout rig
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Object3D} o.table
 * @param {import('./cars.js').Cars} o.cars
 * @param {import('../session-data.js').SessionData} o.data
 * @param {import('../playback.js').Playback} o.playback
 * @returns {{group: THREE.Group, setTab: (t: 'onboard'|'video'|'radio') => void, getTab: () => string,
 *   update: (dt: number) => void, onboard: Onboard, video: ScreenVideo, dispose: () => void}}
 */
export function createMainScreen({ manager, renderer, table, cars, data, playback }) {
  const group = new THREE.Group();
  group.name = 'main-screen';
  const p = MAIN_SCREEN.position;
  group.position.set(p.x, p.y, p.z);
  manager.group.add(group);

  const blank = new THREE.Color(0x05070a);
  const material = new THREE.MeshBasicMaterial({ color: blank, toneMapped: false });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(W, H), material);
  screen.name = 'main-screen-surface';
  group.add(screen);

  const onboard = new Onboard({ renderer, table, cars });
  const video = new ScreenVideo(data, playback);

  // Panels: registered with the manager (shared raycast / redraw), parented to the screen
  // group and kept parallel to it (manager.add turns them toward the user; undo that).
  const add = (panel, x, y, z) => {
    manager.add(panel, { x, y, z }, { parent: group });
    panel.mesh.quaternion.identity();
    return panel;
  };
  const tabs = add(new ScreenTabs((t) => setTab(t)), STRIP_X, STRIP_Y, STRIP_Z);
  const controls = add(new VideoControls(video), -STRIP_X, STRIP_Y, STRIP_Z);
  const content = add(new ScreenContent(data, W, H), 0, 0, 0.004);
  const overlay = add(new OnboardOverlay(data), -STRIP_X, -H / 2 + 0.1, STRIP_Z);

  let tab = '';
  let videoVersion = -1;

  function showMap(map) {
    if (material.map !== map) {
      material.map = map;
      material.color.set(map ? 0xffffff : blank);
      material.needsUpdate = true;
    }
  }

  function setTab(t) {
    if (t === tab) return;
    if (tab === 'video') video.close();
    tab = t;
    tabs.setTab(t);
    overlay.mesh.visible = t === 'onboard';
    controls.mesh.visible = t === 'video';
    content.mesh.visible = t === 'radio';
    if (t === 'onboard') showMap(onboard.texture);
    if (t === 'radio') { showMap(null); content.show('radio'); }
    if (t === 'video') { video.open(); videoVersion = -1; }
    for (const pn of [overlay, controls, content]) pn.invalidate();
  }

  /** Video tab: the texture once there is a picture, otherwise a message over a blank screen. */
  function syncVideoView() {
    if (videoVersion === video.version) return;
    videoVersion = video.version;
    const ready = video.state === 'ready' && video.texture;
    showMap(ready ? video.texture : null);
    const msg = video.state === 'none' ? NO_SOURCE : video.message;
    const showMsg = !ready || (video.state === 'ready' && !!video.message);
    content.mesh.visible = showMsg && !!msg;
    if (content.mesh.visible) content.show('message', msg || NO_SOURCE);
    // a "tap play" hint over a ready video goes once the video runs
    if (ready && video.playing && video.message) { video.message = ''; video.version++; }
  }

  setTab('onboard');

  return {
    group,
    onboard,
    video,
    setTab,
    getTab: () => tab,
    /** Per frame (after the HUD read). Allocation-free. */
    update(dt) {
      onboard.update(dt, tab === 'onboard');
      if (tab === 'video') { video.update(dt); syncVideoView(); }
    },
    dispose() {
      video.dispose();
      onboard.dispose();
      material.dispose();
      screen.geometry.dispose();
      group.removeFromParent(); // the panels are disposed by the PanelManager
    },
  };
}
