// Desktop mouse + keyboard input.
//  - Right-drag: orbit camera around the table (OrbitControls). Middle-drag: dolly.
//  - Left-click on a panel: select what's under the pointer (hover highlights it).
//  - Shift + left-drag on a panel: move it (wheel while dragging pushes / pulls). Saved on release.
//  - Left-drag on the table: rotate the table around Y.
//  - Wheel over the table: scale the table 0.5x-3x. Wheel elsewhere: dolly the camera.
//  - Keys: Space play/pause, Left/Right seek -/+10 s, Up/Down speed,
//    [ / ] previous/next driver by position, P toggle passthrough look, R reset the panel layout.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const ROTATE_PER_PX = 0.008;  // radians per pixel of horizontal drag
const WHEEL_SCALE_STEP = 0.0012;
const WHEEL_PUSH_STEP = 0.002; // metres per wheel delta unit while dragging a panel
const MOUSE_ID = 'mouse';

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
 * @param {ReturnType<import('./panel-grab.js').createPanelGrab>} [opts.panelGrab] Shift-drag moves panels
 * @param {() => void} [opts.onResetLayout] R key
 * @returns {{update: (dt: number) => void, dispose: () => void}}
 */
export function createDesktopInput({
  renderer, camera, table, playback, getDriverOrder, onSelectDriver, onTogglePassthrough, getSelectedDriver,
  pickPanels, onPanelHover, onPanelSelect, panelGrab, onResetLayout,
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

  // --- Shift-drag a panel ---
  let panelPointer = -1;

  function onPointerDown(e) {
    if (e.button !== 0) return;
    if (e.shiftKey && panelGrab && pickPanels) {
      setRay(e.clientX, e.clientY);
      const r = pickPanels(raycaster);
      if (r && panelGrab.begin(MOUSE_ID, r.panel, r.point, raycaster.ray.origin)) {
        panelPointer = e.pointerId;
        try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
        el.style.cursor = 'move';
        return;
      }
    }
    const p = pickPanel(e.clientX, e.clientY);
    if (p) { pressPanel = p; pressX = e.clientX; pressY = e.clientY; return; }
    if (!table.visible) return;
    if (!pickTable(e.clientX, e.clientY)) return;
    dragging = true;
    dragPointer = e.pointerId;
    lastX = e.clientX;
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    el.style.cursor = 'grabbing';
  }
  function onPointerMove(e) {
    if (panelPointer === e.pointerId) {
      setRay(e.clientX, e.clientY);
      panelGrab.update(MOUSE_ID, raycaster.ray.origin, raycaster.ray.direction, camera.position);
      return;
    }
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
    if (panelPointer === e.pointerId) {
      panelPointer = -1;
      panelGrab.end(MOUSE_ID);
      try { el.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      el.style.cursor = '';
      return;
    }
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
    if (panelPointer >= 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      panelGrab.adjust(MOUSE_ID, -e.deltaY * WHEEL_PUSH_STEP);
      setRay(e.clientX, e.clientY);
      panelGrab.update(MOUSE_ID, raycaster.ray.origin, raycaster.ray.direction, camera.position);
      return;
    }
    if (!table.visible || !pickTable(e.clientX, e.clientY)) return; // let OrbitControls dolly
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
  table.getWorldPosition(tableWorld);
  controls.target.copy(tableWorld);
  controls.update();

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
      case 'KeyR': if (!e.repeat && !e.shiftKey && onResetLayout) onResetLayout(); return;
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
    table.getWorldPosition(tableWorld);
    if (!controls.target.equals(tableWorld)) controls.target.copy(tableWorld);
    controls.update();
  }

  function dispose() {
    if (panelPointer >= 0) panelGrab.end(MOUSE_ID);
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
