// World: renderer, scene, camera, the room (themes in rooms.js) and the frame loop.
import * as THREE from 'three';
import { buildRoom } from './rooms.js';
import { getSettings } from '../settings.js';

const BG_PASSTHROUGH = 0x808080;

/**
 * Create renderer, scene, camera and the room (theme from settings) inside `container`.
 * @param {HTMLElement} container
 * @returns {{renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera,
 *   roomGroup: THREE.Group, setMode: (mode: 'pitwall'|'passthrough') => void,
 *   setTheme: (name: string) => string, getTheme: () => string,
 *   onFrame: (cb: (dt: number, timeMs: number) => void) => () => void, dispose: () => void}}
 */
export function createWorld(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true;
  renderer.domElement.style.display = 'block';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const bgColor = new THREE.Color();
  scene.background = bgColor;
  const fog = new THREE.Fog(0x000000, 6, 16);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
  camera.position.set(0, 1.6, 0);
  camera.lookAt(0, 1.6, -1);

  // Lights: soft blue-grey hemisphere + one directional key light (no shadows).
  const hemi = new THREE.HemisphereLight(0xb8c8e0, 0x14161c, 1.1);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xdfe8ff, 1.2);
  dir.position.set(1.5, 4, 1);
  scene.add(dir);

  let room = buildRoom(getSettings().theme);
  scene.add(room.group);

  let mode = 'pitwall';

  /**
   * Swap the room theme (rooms.js THEMES); keeps the pit wall / passthrough mode.
   * @param {string} name
   * @returns {string} the theme now shown (unknown names fall back to 'pitwall')
   */
  function setTheme(name) {
    if (name === room.theme) return room.theme;
    scene.remove(room.group);
    room.dispose();
    room = buildRoom(name);
    scene.add(room.group);
    applyMode();
    return room.theme;
  }

  /**
   * Switch between the pit wall room and the passthrough look.
   * @param {'pitwall'|'passthrough'} m
   */
  function setMode(m) {
    mode = m === 'passthrough' ? 'passthrough' : 'pitwall';
    applyMode();
  }

  function applyMode() {
    const pass = mode === 'passthrough';
    room.group.visible = !pass;
    if (pass) {
      // In an immersive-ar session the background must be transparent so the
      // camera feed shows through; on desktop use a neutral grey instead.
      if (renderer.xr.isPresenting) {
        scene.background = null;
      } else {
        bgColor.setHex(BG_PASSTHROUGH);
        scene.background = bgColor;
      }
      scene.fog = null;
    } else {
      // The room is enclosed, so in immersive-ar (alpha-blend clear) nothing transparent shows.
      bgColor.setHex(room.background);
      scene.background = bgColor;
      fog.color.setHex(room.fog.color);
      fog.near = room.fog.near;
      fog.far = room.fog.far;
      scene.fog = fog;
    }
  }
  // Re-apply when XR presentation starts/ends (background null vs grey).
  renderer.xr.addEventListener('sessionstart', applyMode);
  renderer.xr.addEventListener('sessionend', applyMode);

  // --- resize ---
  function resize() {
    if (renderer.xr.isPresenting) return;
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
  }
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(resize);
    ro.observe(container);
  }
  window.addEventListener('resize', resize);
  resize();

  // --- frame loop ---
  // Copy-on-write callback list so iteration never allocates.
  let callbacks = [];
  let lastTime = -1;
  function loop(timeMs) {
    let dt = lastTime < 0 ? 0 : (timeMs - lastTime) / 1000;
    lastTime = timeMs;
    if (dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    const list = callbacks;
    for (let i = 0; i < list.length; i++) list[i](dt, timeMs);
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(loop);

  /**
   * Register a per-frame callback.
   * @param {(dt: number, timeMs: number) => void} cb
   * @returns {() => void} unsubscribe
   */
  function onFrame(cb) {
    callbacks = callbacks.concat([cb]);
    return () => { callbacks = callbacks.filter((c) => c !== cb); };
  }

  function dispose() {
    renderer.setAnimationLoop(null);
    callbacks = [];
    window.removeEventListener('resize', resize);
    if (ro) ro.disconnect();
    renderer.xr.removeEventListener('sessionstart', applyMode);
    renderer.xr.removeEventListener('sessionend', applyMode);
    scene.remove(room.group);
    room.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  return {
    renderer, scene, camera, get roomGroup() { return room.group; }, setMode, setTheme,
    getTheme: () => room.theme, onFrame, dispose,
  };
}

/**
 * Re-centre pose (spec §7, left stick press): the head's floor position and yaw.
 * Pitch and roll are ignored; looking straight up or down falls back to the head's up axis.
 * @param {THREE.Object3D} head the XR camera (renderer.xr.getCamera(); its eye cameras give the position)
 * @param {{x: number, z: number, yaw: number}} out
 * @returns {{x: number, z: number, yaw: number}} out
 */
export function getRecenterPose(head, out) {
  const e = head.matrixWorld.elements;
  let fx = -e[8];
  let fz = -e[10];
  if (Math.hypot(fx, fz) < 0.1) {
    // Looking down, the head's up axis points the way the user faces; looking up, away from it.
    const s = e[9] >= 0 ? 1 : -1;
    fx = e[4] * s;
    fz = e[6] * s;
  }
  // three's XR ArrayCamera sits behind the eyes (union frustum); use the eyes' midpoint.
  const eyes = head.cameras;
  if (eyes && eyes.length === 2) {
    const a = eyes[0].matrixWorld.elements;
    const b = eyes[1].matrixWorld.elements;
    out.x = (a[12] + b[12]) / 2;
    out.z = (a[14] + b[14]) / 2;
  } else {
    out.x = e[12];
    out.z = e[14];
  }
  // rotation.y = θ turns -Z into (-sin θ, 0, -cos θ).
  out.yaw = Math.atan2(-fx, -fz);
  return out;
}
