// XR controllers: laser rays with a hit dot, hover highlighting, trigger select with
// a haptic pulse, and the spec §7 button map (xr-standard gamepad layout):
//   Right A: play/pause      Right B: pit wall / passthrough
//   Left X: previous driver  Left Y: next driver (by position)
//   Right stick ←/→: seek ∓10 s (repeats while held)   Right stick ↑/↓: speed up/down
//   Left stick press: re-centre
// Rays turn red over anything selectable; small hovered panels (driver tiles)
// scale up slightly. Raycasts run only when a controller moves (or on select).
// Later Phase 4 items extend this module: grab, hands.
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

// xr-standard mapping (Quest Touch): buttons and thumbstick axes.
const BTN_STICK = 3;
const BTN_AX = 4;              // A on the right controller, X on the left
const BTN_BY = 5;              // B on the right controller, Y on the left
const AXIS_X = 2;
const AXIS_Y = 3;
const STICK_ON = 0.6;          // deflection that triggers an action
const STICK_OFF = 0.3;         // must return below this to re-arm
const SEEK_REPEAT_DELAY = 0.5; // s before a held seek repeats
const SEEK_REPEAT_EVERY = 0.25;
const SELECT_PULSE = { intensity: 0.35, ms: 25 };

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {(raycaster: THREE.Raycaster) => ({panel, rect, point: THREE.Vector3, distance: number}|null)} o.pickPanels
 * @param {(result: object|null) => void} o.onHover   hover target changed (null = nothing)
 * @param {(result: object, hand: 'left'|'right'|'none') => void} o.onSelect trigger on a selectable target
 * @param {object} [o.actions] button actions (all optional):
 *   togglePlay(), togglePassthrough(), stepDriver(dir: -1|1), seekBy(sec), speedUp(), speedDown(), recenter()
 * @returns {{update: (dt: number) => void, dispose: () => void}}
 */
export function createXrInput({ renderer, scene, pickPanels, onHover, onSelect, actions = {} }) {
  const act = (name, ...args) => { if (typeof actions[name] === 'function') actions[name](...args); };
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
      down: [false, false, false, false, false, false], // previous pressed state per button
      stickX: 0,        // -1 / 0 / 1: which way the stick is latched
      stickY: 0,
      seekHeld: 0,      // seconds the seek direction has been held
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
      if (h.result && h.result.rect) {
        onSelect(h.result, h.handedness);
        pulse(h, SELECT_PULSE.intensity, SELECT_PULSE.ms);
      }
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

  /** Short haptic pulse; supports both the WebXR (hapticActuators) and newer (vibrationActuator) APIs. */
  function pulse(h, intensity, ms) {
    const pad = h.source && h.source.gamepad;
    if (!pad) return;
    try {
      const ha = pad.hapticActuators && pad.hapticActuators[0];
      if (ha && ha.pulse) { ha.pulse(intensity, ms); return; }
      if (pad.vibrationActuator && pad.vibrationActuator.playEffect) {
        pad.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: intensity, weakMagnitude: intensity });
      }
    } catch (_) { /* haptics unavailable */ }
  }

  /** True on the frame a button goes down. */
  function pressed(h, pad, i) {
    const b = pad.buttons[i];
    const down = !!(b && b.pressed);
    const edge = down && !h.down[i];
    h.down[i] = down;
    return edge;
  }

  /** Latching stick direction: returns -1/1 once per push, 0 otherwise. */
  function stickEdge(value, latched) {
    if (latched === 0) return value <= -STICK_ON ? -1 : value >= STICK_ON ? 1 : 0;
    return 0;
  }

  function handleButtons(h, dt) {
    const pad = h.source && h.source.gamepad;
    if (!pad || h.isHand) return;
    const right = h.handedness === 'right';
    if (pressed(h, pad, BTN_AX)) act(right ? 'togglePlay' : 'stepDriver', right ? undefined : -1);
    if (pressed(h, pad, BTN_BY)) act(right ? 'togglePassthrough' : 'stepDriver', right ? undefined : 1);
    if (pressed(h, pad, BTN_STICK) && !right) act('recenter');
    if (!right) return;

    // Right stick: dominant axis only, so a diagonal push does one thing.
    const x = pad.axes[AXIS_X] || 0;
    const y = pad.axes[AXIS_Y] || 0;
    const horizontal = Math.abs(x) >= Math.abs(y);

    const ex = horizontal ? stickEdge(x, h.stickX) : 0;
    if (ex) { h.stickX = ex; h.seekHeld = 0; act('seekBy', 10 * ex); }
    if (h.stickX !== 0) {
      if (Math.abs(x) < STICK_OFF) { h.stickX = 0; h.seekHeld = 0; } else {
        // Held: repeat the seek after a short delay.
        const before = h.seekHeld;
        h.seekHeld += dt;
        if (h.seekHeld >= SEEK_REPEAT_DELAY) {
          const n0 = Math.floor((before - SEEK_REPEAT_DELAY) / SEEK_REPEAT_EVERY);
          const n1 = Math.floor((h.seekHeld - SEEK_REPEAT_DELAY) / SEEK_REPEAT_EVERY);
          if (before < SEEK_REPEAT_DELAY || n1 > n0) act('seekBy', 10 * h.stickX);
        }
      }
    }

    const ey = !horizontal ? stickEdge(y, h.stickY) : 0;
    if (ey) { h.stickY = ey; act(ey < 0 ? 'speedUp' : 'speedDown'); } // stick up = negative y
    if (h.stickY !== 0 && Math.abs(y) < STICK_OFF) h.stickY = 0;
  }

  /** Per frame while presenting. Allocation-free. */
  function update(dt = 0) {
    if (!renderer.xr.isPresenting) return;
    for (const h of hands) {
      if (!h.connected) continue;
      if (h.ray.visible && moved(h)) raycastFrom(h);
      handleButtons(h, dt);
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
