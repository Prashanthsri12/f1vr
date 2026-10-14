// Screen mode track tile (8.5): the track table, cars and labels in their own WebGL canvas.
//   2D (default): straight down through a narrow lens, so it reads as a flat map. Drag pans,
//                 the wheel zooms.
//   3D: a tilted view. Drag rotates, right-drag pans, the wheel zooms.
// Double-click resets the view. Labels keep a fixed on-screen height in both views.
// 12.5: the VR table's disc and red rim are hidden here: the tile card is the background.
// Uses three's own OrbitControls (three/addons, same pinned version: no new library).
import * as THREE from 'three';
import { createTable, loadTrack } from '../scene/track.js';
import { Cars } from '../scene/cars.js';
import { TrackStyle, colourMode } from '../scene/track-style.js';
import { getSettings } from '../settings.js';
import { VIEWS, fitDistance, labelAngularSize } from './track-camera.js';
import { createWeatherFx } from '../scene/weather-fx.js';
import { newWeather, weatherAt } from '../weather-model.js';

const LABEL_PX = 16;          // CSS px label height
const BG = 0x0f1016; // the tile card colour (THEME.bg)

/**
 * @param {object} o
 * @param {import('../session-data.js').SessionData} o.data
 * @param {HTMLElement} o.tile element the canvas fills
 * @param {'2d'|'3d'} [o.view]
 * @returns {Promise<{cars: Cars, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera,
 *   setView: (v: '2d'|'3d') => void, getView: () => string, resetView: () => void,
 *   resize: () => void, update: (time: number) => void, dispose: () => void}>}
 */
const STYLE_MS = 400; // track colours (track-style.js) refresh at ~2.5 Hz

export async function createTrackView({ data, tile, view = '2d' }) {
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(BG, 1);
  const canvas = renderer.domElement;
  canvas.className = 'f1-dash__gl';
  tile.prepend(canvas);

  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xb8c8e0, 0x14161c, 1.1);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xdfe8ff, 1.2);
  dir.position.set(1.5, 4, 1);
  scene.add(dir);
  const dirColour = dir.color.clone();

  const table = createTable(scene);
  table.position.set(0, 0, 0);
  for (const name of ['tabletop', 'tableRim']) {
    const m = table.getObjectByName(name);
    if (m) m.visible = false;
  }
  let transform = null;
  let cars = null;
  let style = null;
  try {
    transform = await loadTrack(data, table);
    cars = new Cars(data.drivers, transform, table);
    style = new TrackStyle(data, transform);
  } catch (err) {
    renderer.dispose();
    canvas.remove();
    throw err;
  }

  const camera = new THREE.PerspectiveCamera(VIEWS['2d'].fov, 1, 0.01, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.15;
  controls.screenSpacePanning = true;
  controls.zoomSpeed = 1.2;

  let current = '';
  let aspect = 1;

  function updateLabelSize() {
    const h = Math.max(1, tile.clientHeight);
    cars.labels.setSize(labelAngularSize(LABEL_PX, h, camera.fov), 0, 10);
  }

  function resetView() {
    const v = VIEWS[current];
    const d = fitDistance(camera.fov, aspect);
    controls.target.set(0, 0, 0);
    // polar 0 = straight down; OrbitControls keeps "up" on screen = -Z (away from the user).
    const p = Math.max(1e-4, v.polar);
    camera.position.set(0, d * Math.cos(p), d * Math.sin(p));
    controls.minDistance = d * 0.12;
    controls.maxDistance = d * 2.5;
    controls.update();
  }

  function setView(v) {
    const next = VIEWS[v] ? v : '2d';
    if (next === current) return;
    current = next;
    const cfg = VIEWS[current];
    camera.fov = cfg.fov;
    camera.near = 0.01;
    camera.far = 100;
    camera.updateProjectionMatrix();
    controls.minPolarAngle = cfg.minPolar;
    controls.maxPolarAngle = cfg.maxPolar;
    controls.enableRotate = current === '3d';
    cars.carScale = cfg.carScale; // the cars are tiny at map scale: draw them bigger
    controls.mouseButtons = current === '3d'
      ? { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
      : { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    resetView();
    updateLabelSize();
  }

  function resize() {
    const w = Math.max(1, tile.clientWidth);
    const h = Math.max(1, tile.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    aspect = w / h;
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    updateLabelSize();
  }

  let styleAt = -Infinity;
  // 13.10: weather over the table in the 3D view (time-of-day light, clouds, rain).
  const fx = createWeatherFx(table);
  const wx = newWeather();
  const bg = new THREE.Color(BG);
  const clear = new THREE.Color();
  let wxAt = -Infinity;
  let lastFrame = performance.now();
  let lit = false;
  canvas.addEventListener('dblclick', resetView);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  resize();
  setView(view);

  return {
    cars,
    renderer,
    camera,
    setView,
    getView: () => current,
    resetView,
    resize,
    /** Per frame: cars at the playhead, then draw. Allocation-free. */
    update(time) {
      controls.update();
      cars.update(data, time, camera);
      const now = performance.now();
      if (now - styleAt > STYLE_MS) {
        styleAt = now;
        const sel = cars.drivers[cars.selectedIndex];
        style.update(time, sel ? sel.number : null, colourMode(getSettings()));
      }
      const dt = (now - lastFrame) / 1000;
      lastFrame = now;
      const fxOn = current === '3d' && getSettings().weatherFx;
      if (fxOn && now - wxAt > 1000) {
        wxAt = now;
        weatherAt(data, time, wx);
        fx.light(hemi, dir, wx);
        renderer.setClearColor(fx.clearColour(clear, wx, bg), 1);
        lit = true;
      } else if (!fxOn && lit) {
        lit = false; wxAt = -Infinity;
        hemi.intensity = 1.1; dir.intensity = 1.2; dir.color.copy(dirColour); dir.position.set(1.5, 4, 1);
        renderer.setClearColor(BG, 1);
      }
      fx.update(dt, wx, fxOn);
      renderer.render(scene, camera);
    },
    dispose() {
      canvas.removeEventListener('dblclick', resetView);
      controls.dispose();
      fx.dispose();
      cars.dispose();
      if (transform && transform.dispose) transform.dispose();
      if (table.userData.dispose) table.userData.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
