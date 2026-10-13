// Mouse + keyboard input for the 3D room preview (debug only since Phase 8; the desktop uses
// Screen mode, js/screen/). Moving and resizing panels and room themes are VR-only (8.10).
//  - Right-drag: orbit camera around the table (OrbitControls). Middle-drag: dolly.
//  - Left-click on a panel: select what's under the pointer (hover highlights it).
//  - Left-drag on the table: rotate the table around Y.
//  - Wheel over the table: scale the table 0.5x-3x. Wheel elsewhere: dolly the camera.
//  - Keys: Space play/pause, Left/Right seek -/+10 s, Up/Down speed,
//    [ / ] previous/next driver by position, P toggle passthrough look.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const ROTATE_PER_PX = 0.008;  // radians per pixel of horizontal drag
const WHEEL_SCALE_STEP = 0.0012;

/**
 * @param {object} opts
 * @param {THREE.WebGLRenderer} opts.renderer
 * @param {THREE.Camera} opts.camera
 * @param {THREE.Object3D} opts.table  table group; `table.userData.hitMesh` (tabletop mesh) used for picking
 * @param {import('../playback.js').Playback} opts.playback
 * @param {() => number[]} opts.getDriverOrder driver numbers sorted by race position
 * @param {(n: number) => void} opts.onSelectDriver
 * @param {() => void} opts.onTogglePassthrough
 * @param {() => (number|null)} [opts.getSelectedDriver] optional: current selection (else tracked internally)
 * @param {(raycaster: THREE.Raycaster) => ({rect: object|null}|null)} [opts.pickPanels] raycast panels
 * @param {(result: object|null) => void} [opts.onPanelHover]
 * @param {(result: object) => void} [opts.onPanelSelect]
 * @param {() => boolean} [opts.canUseTable] false while the table isn't in the room (Screen in VR preview)
 * @param {(out: THREE.Vector3) => THREE.Vector3} [opts.getOrbitTarget] what the camera orbits (default: the table)
 * @returns {{update: (dt: number) => void, dispose: () => void}}
 */
export function createDesktopInput({
  renderer, camera, table, playback, getDriverOrder, onSelectDriver, onTogglePassthrough, getSelectedDriver,
  pickPanels, onPanelHover, onPanelSelect, canUseTable = () => true, getOrbitTarget = null,
}) {
  const el = renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hits = [];
  const tableWorld = new THREE.Vector3();
  let selected = null;

  // --- picking ---
  function setRay(clientX, clientY) {
    const rect = el.getBoundingClientRect();
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
  }
  function pickPanel(clientX, clientY) {
    if (!pickPanels) return null;
    setRay(clientX, clientY);
    const r = pickPanels(raycaster);
    return r && r.rect ? r : null;
  }
  function pickTable(clientX, clientY) {
    setRay(clientX, clientY);
    hits.length = 0;
    const target = table.userData && table.userData.hitMesh;
    if (target) raycaster.intersectObject(target, false, hits);
    else raycaster.intersectObjects(table.children, true, hits);
    return hits.length > 0;
  }

  // --- left-drag rotate ---
  let dragging = false;
  let dragPointer = -1;
  let lastX = 0;
  // --- panel click (press + release within a few px) ---
  let pressPanel = null;
  let pressX = 0;
  let pressY = 0;

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const p = pickPanel(e.clientX, e.clientY);
    if (p) { pressPanel = p; pressX = e.clientX; pressY = e.clientY; return; }
    if (!table.visible || !canUseTable()) return;
    if (!pickTable(e.clientX, e.clientY)) return;
    dragging = true;
    dragPointer = e.pointerId;
    lastX = e.clientX;
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    el.style.cursor = 'grabbing';
  }
  function onPointerMove(e) {
    if (!dragging) {
      if (e.buttons === 0 && onPanelHover) {
        const p = pickPanel(e.clientX, e.clientY);
        onPanelHover(p);
        el.style.cursor = p ? 'pointer' : '';
      }
      return;
    }
    if (e.pointerId !== dragPointer) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    table.rotation.y += dx * ROTATE_PER_PX;
  }
  function onPointerUp(e) {
    if (pressPanel && e.button === 0) {
      const moved = Math.abs(e.clientX - pressX) + Math.abs(e.clientY - pressY);
      const p = moved < 8 ? pickPanel(e.clientX, e.clientY) : null;
      if (p && p.panel === pressPanel.panel && onPanelSelect) onPanelSelect(p);
      pressPanel = null;
      return;
    }
    if (!dragging || e.pointerId !== dragPointer) return;
    dragging = false;
    dragPointer = -1;
    try { el.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    el.style.cursor = '';
  }

  // --- wheel scale (registered BEFORE OrbitControls so it can stop its dolly) ---
  function onWheel(e) {
    if (!table.visible || !canUseTable() || !pickTable(e.clientX, e.clientY)) return; // let OrbitControls dolly
    e.preventDefault();
    e.stopImmediatePropagation();
    const s = THREE.MathUtils.clamp(table.scale.x * Math.exp(-e.deltaY * WHEEL_SCALE_STEP), MIN_SCALE, MAX_SCALE);
    table.scale.setScalar(s);
  }

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('wheel', onWheel, { passive: false });

  // --- orbit (right-drag) ---
  const controls = new OrbitControls(camera, el);
  controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.enablePan = false;
  controls.enableZoom = true; // wheel away from the table dollies (over the table it scales the table)
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.minDistance = 0.4;
  controls.maxDistance = 6;
  controls.maxPolarAngle = Math.PI * 0.495; // stay above the floor
  orbitTarget(tableWorld);
  controls.target.copy(tableWorld);
  controls.update();

  function orbitTarget(out) {
    return getOrbitTarget ? getOrbitTarget(out) : table.getWorldPosition(out);
  }

  // --- keyboard ---
  function isTyping(t) {
    if (!t) return false;
    const tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  function stepDriver(dir) {
    const order = getDriverOrder();
    if (!order || order.length === 0) return;
    const cur = getSelectedDriver ? getSelectedDriver() : selected;
    let i = order.indexOf(cur);
    if (i < 0) i = dir > 0 ? -1 : 0;
    const n = order[(i + dir + order.length) % order.length];
    selected = n;
    onSelectDriver(n);
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        if (!e.repeat) playback.toggle();
        return;
      case 'ArrowLeft': e.preventDefault(); playback.seekBy(-10); return;
      case 'ArrowRight': e.preventDefault(); playback.seekBy(10); return;
      case 'ArrowUp': e.preventDefault(); playback.speedUp(); return;
      case 'ArrowDown': e.preventDefault(); playback.speedDown(); return;
      case 'BracketLeft': stepDriver(-1); return;
      case 'BracketRight': stepDriver(1); return;
      case 'KeyP': if (!e.repeat && onTogglePassthrough) onTogglePassthrough(); return;
      default:
    }
    // Layout-independent fallbacks for the bracket keys.
    if (e.key === '[') stepDriver(-1);
    else if (e.key === ']') stepDriver(1);
  }
  window.addEventListener('keydown', onKeyDown);

  /** Per-frame update: keep the orbit target on the table. Allocation-free. */
  function update() {
    if (renderer.xr.isPresenting) return; // never move the camera in XR
    orbitTarget(tableWorld);
    if (!controls.target.equals(tableWorld)) controls.target.copy(tableWorld);
    controls.update();
  }

  function dispose() {
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerUp);
    el.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKeyDown);
    controls.dispose();
    el.style.cursor = '';
  }

  return { update, dispose };
}
