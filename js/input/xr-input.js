// XR controllers: laser rays with a hit dot, hover highlighting and trigger select.
// Rays turn red over anything selectable; small hovered panels (driver tiles)
// scale up slightly. Raycasts run only when a controller moves (or on select).
// Later Phase 4 items extend this module: haptics, button mapping, grab, hands.
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';

// Controller models come from the WebXR input-profiles assets (the same CDN three's
// hand models use), pinned instead of three's floating "@1.0" default.
const PROFILES_PATH = 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0.20/dist/profiles';

const RAY_LENGTH = 3;          // metres, when nothing is hit
const RAY_IDLE = 0xdfe6f0;
const RAY_HOVER = 0xe10600;    // accent red over something selectable
const MOVE_EPS = 1e-4;         // matrix element change that counts as "moved"
const HOVER_SCALE = 1.08;
const SMALL_PANEL = 0.2;       // panels narrower than this get the hover scale (tiles)

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {(raycaster: THREE.Raycaster) => ({panel, rect, point: THREE.Vector3, distance: number}|null)} o.pickPanels
 * @param {(result: object|null) => void} o.onHover   hover target changed (null = nothing)
 * @param {(result: object, hand: 'left'|'right'|'none') => void} o.onSelect trigger on a selectable target
 * @param {() => void} [o.onTogglePassthrough] right controller B (xr-standard button 5)
 * @returns {{update: () => void, dispose: () => void}}
 */
export function createXrInput({ renderer, scene, pickPanels, onHover, onSelect, onTogglePassthrough }) {
  const raycaster = new THREE.Raycaster();
  const rayMatrix = new THREE.Matrix4();
  const modelFactory = new XRControllerModelFactory();
  modelFactory.path = PROFILES_PATH;

  const rayGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const dotGeometry = new THREE.SphereGeometry(0.006, 12, 8);

  /** One entry per controller index (0, 1). */
  const hands = [0, 1].map((i) => {
    const controller = renderer.xr.getController(i);
    const rayMaterial = new THREE.LineBasicMaterial({ color: RAY_IDLE, transparent: true, opacity: 0.8 });
    const ray = new THREE.Line(rayGeometry, rayMaterial);
    ray.name = 'xr-ray';
    ray.scale.z = RAY_LENGTH;
    ray.visible = false;
    controller.add(ray);

    const dot = new THREE.Mesh(dotGeometry, new THREE.MeshBasicMaterial({ color: RAY_HOVER, depthTest: false }));
    dot.renderOrder = 999;
    dot.visible = false;
    scene.add(dot);

    const grip = renderer.xr.getControllerGrip(i);
    grip.add(modelFactory.createControllerModel(grip));

    const h = {
      index: i,
      controller,
      grip,
      ray,
      dot,
      handedness: 'none',
      connected: false,
      isHand: false,
      source: null,
      bWasDown: false,
      lastMatrix: new Float32Array(16),
      result: null,
      onConnected: null,
      onDisconnected: null,
      onSelect: null,
    };
    h.onConnected = (e) => {
      const src = e.data;
      h.connected = true;
      h.source = src;
      h.handedness = src.handedness || 'none';
      h.isHand = !!src.hand;          // hand tracking: rays come in item 4.7
      ray.visible = !h.isHand && src.targetRayMode === 'tracked-pointer';
      h.lastMatrix.fill(NaN);         // force a raycast on the next update
    };
    h.onDisconnected = () => {
      h.connected = false;
      h.source = null;
      ray.visible = false;
      dot.visible = false;
      setResult(h, null);
    };
    h.onSelect = () => {
      if (!h.connected) return;
      raycastFrom(h);                 // fresh hit at the moment of the press
      if (h.result && h.result.rect) onSelect(h.result, h.handedness);
    };
    controller.addEventListener('connected', h.onConnected);
    controller.addEventListener('disconnected', h.onDisconnected);
    controller.addEventListener('select', h.onSelect);
    scene.add(controller);
    scene.add(grip);
    return h;
  });

  let hovered = null;       // the result currently reported via onHover
  let scaledMesh = null;    // tile mesh enlarged for hover

  function setResult(h, result) {
    h.result = result;
    const selectable = !!(result && result.rect);
    h.ray.material.color.setHex(selectable ? RAY_HOVER : RAY_IDLE);
    h.ray.scale.z = result ? Math.max(0.01, result.distance) : RAY_LENGTH;
    if (result) {
      h.dot.position.copy(result.point);
      h.dot.visible = h.ray.visible;
    } else {
      h.dot.visible = false;
    }
    refreshHover();
  }

  /** Report one hover target: the first controller pointing at something selectable. */
  function refreshHover() {
    let next = null;
    for (const h of hands) if (h.connected && h.result && h.result.rect) { next = h.result; break; }
    const same = next && hovered && next.panel === hovered.panel && next.rect.id === hovered.rect.id;
    if (same || (!next && !hovered)) { hovered = next; return; }
    hovered = next;
    onHover(next);
    const mesh = next && next.panel.width < SMALL_PANEL ? next.panel.mesh : null;
    if (mesh !== scaledMesh) {
      if (scaledMesh) scaledMesh.scale.setScalar(1);
      if (mesh) mesh.scale.setScalar(HOVER_SCALE);
      scaledMesh = mesh;
    }
  }

  function raycastFrom(h) {
    rayMatrix.identity().extractRotation(h.controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(h.controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rayMatrix);
    setResult(h, pickPanels(raycaster));
  }

  function moved(h) {
    const e = h.controller.matrixWorld.elements;
    const last = h.lastMatrix;
    let changed = false;
    for (let k = 0; k < 16; k++) {
      if (!(Math.abs(e[k] - last[k]) <= MOVE_EPS)) { changed = true; last[k] = e[k]; }
    }
    return changed;
  }

  /** Per frame while presenting. Allocation-free. */
  function update() {
    if (!renderer.xr.isPresenting) return;
    for (const h of hands) {
      if (!h.connected) continue;
      if (h.ray.visible && moved(h)) raycastFrom(h);
      // B on the right controller toggles pit wall / passthrough (edge-triggered).
      const pad = h.source && h.source.gamepad;
      if (pad && h.handedness === 'right' && onTogglePassthrough) {
        const down = !!(pad.buttons[5] && pad.buttons[5].pressed);
        if (down && !h.bWasDown) onTogglePassthrough();
        h.bWasDown = down;
      }
    }
  }

  function dispose() {
    for (const h of hands) {
      h.controller.removeEventListener('connected', h.onConnected);
      h.controller.removeEventListener('disconnected', h.onDisconnected);
      h.controller.removeEventListener('select', h.onSelect);
      h.controller.remove(h.ray);
      h.ray.material.dispose();
      h.dot.material.dispose();
      scene.remove(h.dot, h.controller, h.grip);
      h.grip.clear();
    }
    if (scaledMesh) scaledMesh.scale.setScalar(1);
    rayGeometry.dispose();
    dotGeometry.dispose();
  }

  return { update, dispose };
}
