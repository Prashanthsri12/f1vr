// XR controllers: laser rays with a hit dot, hover highlighting, trigger select with
// a haptic pulse, and the spec §7 button map (xr-standard gamepad layout):
//   Right A: play/pause      Right B: pit wall / passthrough
//   Left X: previous driver  Left Y: next driver (by position)
//   Right stick ←/→: seek ∓10 s (repeats while held)   Right stick ↑/↓: speed up/down
//   Left stick press: re-centre
//   Grip: grab the table (one hand moves it, two hands scale + rotate); double grip resets
//   Grip on a panel: carry it (panel-grab.js); right stick ↑/↓ then pushes / pulls it
// Hand tracking: hand meshes, a ray from each hand, pinch = select (Quest emits the
// standard select events for pinches), pinch-and-hold on the table edge grabs it,
// pinch-and-hold on a panel's title bar (top 6 cm) carries the panel.
// Rays turn red over anything selectable; small hovered panels (driver tiles)
// scale up slightly. Raycasts run only when a controller moves (or on select).
import * as THREE from 'three';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { createTableGrab } from './table-grab.js';
import { createButtonHandler } from './xr-buttons.js';

// Controller models come from the WebXR input-profiles assets (the same CDN three's
// hand models use), pinned instead of three's floating "@1.0" default.
const PROFILES_PATH = 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0.20/dist/profiles';

const RAY_LENGTH = 3;          // metres, when nothing is hit
const RAY_IDLE = 0xdfe6f0;
const RAY_HOVER = 0xe10600;    // accent red over something selectable
const MOVE_EPS = 1e-4;         // matrix element change that counts as "moved"
const HOVER_SCALE = 1.08;
const SMALL_PANEL = 0.2;       // panels narrower than this get the hover scale (tiles)

const SELECT_PULSE = { intensity: 0.35, ms: 25 };
const GRAB_PULSE = { intensity: 0.5, ms: 40 };
const DOUBLE_GRIP_MS = 400;    // two grip presses within this reset the table
const EDGE_MIN = 0.6;          // table-local radius (tabletop r = 0.8) where a pinch grabs the edge
const TITLE_BAND = 0.06;       // metres at the top of a panel where a held pinch picks it up
const PINCH_HOLD = 0.35;       // s a title-bar pinch must be held to become a panel grab

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {THREE.Object3D} o.table track table group (grabbed; userData.hitMesh is the tabletop)
 * @param {(raycaster: THREE.Raycaster) => ({panel, rect, point: THREE.Vector3, distance: number}|null)} o.pickPanels
 * @param {(result: object|null) => void} o.onHover   hover target changed (null = nothing)
 * @param {(result: object, hand: 'left'|'right'|'none') => void} o.onSelect trigger on a selectable target
 * @param {ReturnType<import('./panel-grab.js').createPanelGrab>} [o.panelGrab] carries panels (4.15)
 * @param {object} [o.actions] button actions (all optional):
 *   togglePlay(), togglePassthrough(), stepDriver(dir: -1|1), seekBy(sec), speedUp(), speedDown(), recenter()
 * @returns {{update: (dt: number) => void, getLeftPalm: (pos: THREE.Vector3, normal: THREE.Vector3) => boolean,
 *   dispose: () => void}}
 */
export function createXrInput({ renderer, scene, table, pickPanels, onHover, onSelect, panelGrab = null, actions = {} }) {
  const act = (name, ...args) => { if (typeof actions[name] === 'function') actions[name](...args); };
  const raycaster = new THREE.Raycaster();
  const rayMatrix = new THREE.Matrix4();
  const modelFactory = new XRControllerModelFactory();
  modelFactory.path = PROFILES_PATH;
  const handFactory = new XRHandModelFactory();
  handFactory.setPath(`${PROFILES_PATH}/generic-hand/`);
  const grab = createTableGrab(table);
  const tableHits = [];
  const local = new THREE.Vector3();
  const headPos = new THREE.Vector3();

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
    const hand = renderer.xr.getHand(i);
    hand.add(handFactory.createHandModel(hand, 'mesh'));

    const h = {
      index: i,
      id: `xr${i}`,
      controller,
      grip,
      hand,
      lastSqueeze: -Infinity,
      pinchGrab: false,   // this hand's current pinch is holding the table or a panel
      pendingPanel: null, // title-bar pinch waiting for PINCH_HOLD
      pendingPoint: new THREE.Vector3(),
      pendingT: 0,
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
      h.isHand = !!src.hand;
      grip.visible = !h.isHand;       // controller model only for controllers
      ray.visible = src.targetRayMode === 'tracked-pointer'; // controllers and hands
      h.lastMatrix.fill(NaN);         // force a raycast on the next update
    };
    h.onDisconnected = () => {
      grab.end(h.id);
      if (panelGrab) panelGrab.end(h.id);
      h.pinchGrab = false;
      h.pendingPanel = null;
      h.connected = false;
      h.source = null;
      ray.visible = false;
      dot.visible = false;
      setResult(h, null);
    };
    h.onSelect = () => {
      if (!h.connected || h.pinchGrab) return;
      raycastFrom(h);                 // fresh hit at the moment of the press
      if (h.result && h.result.rect) {
        onSelect(h.result, h.handedness);
        pulse(h, SELECT_PULSE.intensity, SELECT_PULSE.ms);
      }
    };
    controller.addEventListener('connected', h.onConnected);
    controller.addEventListener('disconnected', h.onDisconnected);
    controller.addEventListener('select', h.onSelect);
    // Grip: grab the table; a quick double press resets it.
    h.onSqueezeStart = () => {
      if (panelGrab && h.connected) {
        raycastFrom(h);
        if (h.result && panelGrab.begin(h.id, h.result.panel, h.result.point, raycaster.ray.origin)) {
          pulse(h, GRAB_PULSE.intensity, GRAB_PULSE.ms);
          return;
        }
      }
      const now = performance.now();
      if (now - h.lastSqueeze < DOUBLE_GRIP_MS) {
        grab.end(h.id);
        grab.reset();
        h.lastSqueeze = -Infinity;
        pulse(h, GRAB_PULSE.intensity, GRAB_PULSE.ms);
        return;
      }
      h.lastSqueeze = now;
      grab.begin(h.id, controller);
      pulse(h, GRAB_PULSE.intensity, GRAB_PULSE.ms);
    };
    h.onSqueezeEnd = () => {
      if (panelGrab) panelGrab.end(h.id);
      grab.end(h.id);
    };
    // Hands: pinch-and-hold on the table edge grabs it (unless a panel is in front).
    h.onSelectStart = () => {
      if (!h.connected || !h.isHand) return;
      raycastFrom(h);
      if (h.result && inTitleBand(h.result)) {         // maybe a panel pick-up: wait for the hold
        h.pendingPanel = h.result.panel;
        h.pendingPoint.copy(h.result.point);
        h.pendingT = 0;
        return;
      }
      if (h.result && h.result.rect) return;           // panel target: normal select
      const d = tableEdgeDistance();
      if (d < 0 || (h.result && h.result.distance < d)) return;
      h.pinchGrab = true;
      grab.begin(h.id, controller);
    };
    h.onSelectEnd = () => {
      h.pendingPanel = null;
      if (!h.pinchGrab) return;
      grab.end(h.id);
      if (panelGrab) panelGrab.end(h.id);
      // 'select' fires after 'selectend'; skip it for this pinch.
      setTimeout(() => { h.pinchGrab = false; }, 0);
    };
    controller.addEventListener('squeezestart', h.onSqueezeStart);
    controller.addEventListener('squeezeend', h.onSqueezeEnd);
    controller.addEventListener('selectstart', h.onSelectStart);
    controller.addEventListener('selectend', h.onSelectEnd);
    scene.add(controller);
    scene.add(grip);
    scene.add(hand);
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
    setRay(h);
    setResult(h, pickPanels(raycaster));
  }

  /** A hit in the top TITLE_BAND of a movable panel. */
  function inTitleBand(result) {
    const p = result.panel;
    if (!panelGrab || !p || !p.canvas) return false;
    return result.px.y < TITLE_BAND * (p.canvas.height / p.height);
  }

  function setRay(h) {
    rayMatrix.identity().extractRotation(h.controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(h.controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rayMatrix);
  }

  /** Distance along the current ray to the tabletop's outer band, or -1. Uses the last raycaster pose. */
  function tableEdgeDistance() {
    const top = table.userData && table.userData.hitMesh;
    if (!top || !table.visible) return -1;
    tableHits.length = 0;
    raycaster.intersectObject(top, false, tableHits);
    if (!tableHits.length) return -1;
    local.copy(tableHits[0].point);
    table.worldToLocal(local);
    return Math.hypot(local.x, local.z) >= EDGE_MIN ? tableHits[0].distance : -1;
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

  const handleButtons = createButtonHandler(act, panelGrab, hands);

  const _q = new THREE.Quaternion();
  const _v = new THREE.Vector3();
  /**
   * Left palm centre and its outward normal (world). Controllers: grip space, palm = +X
   * (WebXR: the back of the left hand points -X). Hands: wrist joint, palm = -Y and the
   * palm centre lies along -Z (WebXR Hand Input). Returns false when not tracked.
   */
  function getLeftPalm(pos, normal) {
    for (const h of hands) {
      if (!h.connected || h.handedness !== 'left') continue;
      if (h.isHand) {
        const wrist = h.hand.joints && h.hand.joints.wrist;
        if (!wrist || !wrist.visible) return false;
        wrist.getWorldPosition(pos);
        wrist.getWorldQuaternion(_q);
        normal.set(0, -1, 0).applyQuaternion(_q);
        pos.addScaledVector(_v.set(0, 0, -1).applyQuaternion(_q), 0.05);
        return true;
      }
      if (!h.grip.visible) return false;
      h.grip.getWorldPosition(pos);
      h.grip.getWorldQuaternion(_q);
      normal.set(1, 0, 0).applyQuaternion(_q);
      return true;
    }
    return false;
  }

  /** Per frame while presenting. Allocation-free. */
  function update(dt = 0) {
    if (!renderer.xr.isPresenting) return;
    let head = false;
    for (const h of hands) {
      if (!h.connected) continue;
      if (h.ray.visible && moved(h)) raycastFrom(h);
      handleButtons(h, dt);
      if (!panelGrab) continue;
      if (h.pendingPanel) {
        h.pendingT += dt;
        if (h.pendingT >= PINCH_HOLD) {
          setRay(h);
          if (panelGrab.begin(h.id, h.pendingPanel, h.pendingPoint, raycaster.ray.origin)) h.pinchGrab = true;
          h.pendingPanel = null;
        }
      }
      if (panelGrab.has(h.id)) {
        if (!head) { headPos.setFromMatrixPosition(renderer.xr.getCamera().matrixWorld); head = true; }
        setRay(h);
        panelGrab.update(h.id, raycaster.ray.origin, raycaster.ray.direction, headPos);
      }
    }
    grab.update();
  }

  function dispose() {
    for (const h of hands) {
      h.controller.removeEventListener('connected', h.onConnected);
      h.controller.removeEventListener('disconnected', h.onDisconnected);
      h.controller.removeEventListener('select', h.onSelect);
      h.controller.removeEventListener('squeezestart', h.onSqueezeStart);
      h.controller.removeEventListener('squeezeend', h.onSqueezeEnd);
      h.controller.removeEventListener('selectstart', h.onSelectStart);
      h.controller.removeEventListener('selectend', h.onSelectEnd);
      h.controller.remove(h.ray);
      h.ray.material.dispose();
      h.dot.material.dispose();
      scene.remove(h.dot, h.controller, h.grip, h.hand);
      h.grip.clear();
      h.hand.clear();
    }
    if (scaledMesh) scaledMesh.scale.setScalar(1);
    rayGeometry.dispose();
    dotGeometry.dispose();
  }

  return { update, getLeftPalm, dispose };
}
