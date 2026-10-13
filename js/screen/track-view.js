// Screen mode track tile (8.5): the track table, cars and labels in their own WebGL canvas.
//   2D (default): straight down through a narrow lens, so it reads as a flat map. Drag pans,
//                 the wheel zooms.
//   3D: a tilted view. Drag rotates, right-drag pans, the wheel zooms.
// Double-click resets the view. Labels keep a fixed on-screen height in both views.
// Uses three's own OrbitControls (three/addons, same pinned version: no new library).
import * as THREE from 'three';
import { createTable, loadTrack } from '../scene/track.js';
import { Cars } from '../scene/cars.js';

const VIEWS = {
  '2d': { fov: 10, polar: 0, minPolar: 0, maxPolar: 0, carScale: 1.8 },
  '3d': { fov: 40, polar: 0.85, minPolar: 0, maxPolar: 1.35, carScale: 1.3 },
};
const FIT_RADIUS = 0.78;      // metres: the track (1.4 m) plus a margin, table-local
const LABEL_PX = 16;          // CSS px label height
const BG = 0x0b0e13;

/**
 * @param {object} o
 * @param {import('../session-data.js').SessionData} o.data
 * @param {HTMLElement} o.tile element the canvas fills
 * @param {'2d'|'3d'} [o.view]
 * @returns {Promise<{cars: Cars, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera,
 *   setView: (v: '2d'|'3d') => void, getView: () => string, resetView: () => void,
 *   resize: () => void, update: (time: number) => void, dispose: () => void}>}
 */
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
  scene.add(new THREE.HemisphereLight(0xb8c8e0, 0x14161c, 1.1));
  const dir = new THREE.DirectionalLight(0xdfe8ff, 1.2);
  dir.position.set(1.5, 4, 1);
  scene.add(dir);

  const table = createTable(scene);
  table.position.set(0, 0, 0);
  let transform = null;
  let cars = null;
  try {
    transform = await loadTrack(data, table);
    cars = new Cars(data.drivers, transform, table);
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

  /** Camera distance that fits the track in the tile at this field of view. */
  function fitDistance() {
    const half = THREE.MathUtils.degToRad(camera.fov / 2);
    return FIT_RADIUS / Math.tan(half) / Math.min(1, aspect);
  }

  function updateLabelSize() {
    const h = Math.max(1, tile.clientHeight);
    const angular = (LABEL_PX / h) * 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    cars.labels.setSize(angular, 0, 10);
  }

  function resetView() {
    const v = VIEWS[current];
    const d = fitDistance();
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
      renderer.render(scene, camera);
    },
    dispose() {
      canvas.removeEventListener('dblclick', resetView);
      controls.dispose();
      cars.dispose();
      if (transform && transform.dispose) transform.dispose();
      if (table.userData.dispose) table.userData.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
