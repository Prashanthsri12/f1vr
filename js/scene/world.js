// World: renderer, scene, camera, pit wall room and the frame loop.
import * as THREE from 'three';

const ROOM_SIZE = 8;          // metres, square room centred on the user
const WALL_HEIGHT = 1.2;
const WALL_THICK = 0.08;
const BG_PITWALL = 0x07090d;
const BG_PASSTHROUGH = 0x808080;
const ACCENT_RED = 0xe10600;
const STRIP_BLUE = 0x8fb3d9;

/**
 * Create renderer, scene, camera and the pit wall room inside `container`.
 * @param {HTMLElement} container
 * @returns {{renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera,
 *   roomGroup: THREE.Group, setMode: (mode: 'pitwall'|'passthrough') => void,
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
  const bgColor = new THREE.Color(BG_PITWALL);
  scene.background = bgColor;
  const fog = new THREE.Fog(BG_PITWALL, 6, 16);
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

  const room = buildRoom();
  scene.add(room.group);

  let mode = 'pitwall';

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
      bgColor.setHex(BG_PITWALL);
      scene.background = bgColor;
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
    room.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  return { renderer, scene, camera, roomGroup: room.group, setMode, onFrame, dispose };
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

/**
 * Pit wall room: floor, grid, four low walls, emissive strips. ~11 draw calls.
 * All geometry is static (matrixAutoUpdate off).
 */
function buildRoom() {
  const group = new THREE.Group();
  group.name = 'pitwall-room';
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  const half = ROOM_SIZE / 2;

  // Floor
  const floorMat = track(new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.9, metalness: 0.0 }));
  const floorGeo = track(new THREE.PlaneGeometry(ROOM_SIZE, ROOM_SIZE));
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  add(floor);

  // Subtle grid (one LineSegments draw call)
  const grid = new THREE.GridHelper(ROOM_SIZE, 16, 0x2a3442, 0x1a2029);
  grid.position.y = 0.002;
  grid.material.transparent = true;
  grid.material.opacity = 0.6;
  track(grid.geometry); track(grid.material);
  add(grid);

  // Low walls (4 boxes, shared geometry/material)
  const wallMat = track(new THREE.MeshStandardMaterial({ color: 0x161a21, roughness: 0.8, metalness: 0.1 }));
  const wallGeo = track(new THREE.BoxGeometry(ROOM_SIZE, WALL_HEIGHT, WALL_THICK));
  for (let i = 0; i < 4; i++) {
    const w = new THREE.Mesh(wallGeo, wallMat);
    const a = (i * Math.PI) / 2;
    w.rotation.y = a;
    w.position.set(-Math.sin(a) * half, WALL_HEIGHT / 2, -Math.cos(a) * half);
    add(w);
  }

  // Emissive strips along the wall tops: cool blue-grey on three walls,
  // F1 red accent sparingly on the front wall only.
  const blueMat = track(new THREE.MeshBasicMaterial({ color: STRIP_BLUE, fog: true }));
  const redMat = track(new THREE.MeshBasicMaterial({ color: ACCENT_RED, fog: true }));
  const stripGeo = track(new THREE.BoxGeometry(ROOM_SIZE - 0.2, 0.025, 0.03));
  for (let i = 0; i < 4; i++) {
    const s = new THREE.Mesh(stripGeo, i === 0 ? redMat : blueMat);
    const a = (i * Math.PI) / 2;
    const r = half - WALL_THICK;
    s.rotation.y = a;
    s.position.set(-Math.sin(a) * r, WALL_HEIGHT - 0.05, -Math.cos(a) * r);
    add(s);
  }
  // Low floor-level blue strip at the front wall for depth.
  const low = new THREE.Mesh(stripGeo, blueMat);
  low.position.set(0, 0.06, -(half - WALL_THICK));
  add(low);

  function add(o) {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
    group.add(o);
  }

  return {
    group,
    dispose() { for (const d of disposables) d.dispose(); },
  };
}
