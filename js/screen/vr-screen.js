// Screen in VR (8.11, 8.12): the desktop dashboard's tiles on one big flat or curved screen.
// The same panels and main screen are re-parented onto a screen group in the layout rig
// (re-centre carries it), placed by screen-layout.js on a 1920 × 1080 virtual canvas mapped
// to SCREEN_WIDTH metres. The track table leaves the room and is rendered from above into a
// render target shown on the track tile (≤36 Hz). Curved: every tile is a flat facet tangent
// to a cylinder centred on the user's start position.
// The whole screen is one movable unit: grab any tile (grip, or pinch-hold; anywhere on the
// track tile) to carry it, push / pull and resize it with the stick or a two-hand stretch.
import * as THREE from 'three';
import { Panel } from '../panels/panel-base.js';
import { MAIN_SCREEN } from '../panels/layout.js';
import { computeScreenLayout, containRect } from './screen-layout.js';
import { frameTrack, labelAngularSize, VIEWS } from './track-camera.js';

export const SCREEN_WIDTH = 4.0;     // metres (about 82° wide flat, 100° curved, at 2.3 m)
export const SCREEN_DISTANCE = 2.3;  // from the start position (also the curve radius)
export const SCREEN_CENTER_Y = 1.35;
const VPX_W = 1920;                  // virtual canvas the layout is computed for
const VPX_H = 1080;
const M_PER_PX = SCREEN_WIDTH / VPX_W;
const RT_FPS = 36;
const RT_MAX = 1024;
const LABEL_PX = 18;                 // virtual px
const BG = 0x0b0e13;
const OVERLAY_Z = 0.01;              // the ticker's expanded list sits in front of the track
const STORE_KEY = 'f1vr.vrscreen.v1';
const SCREEN_PANELS = ['leaderboard', 'telemetry', 'laps', 'weather', 'insights', 'ticker', 'playbackBar'];

/** The track tile: a Panel (so rays hit it and grabs work) showing the track render target. */
class TrackTile extends Panel {
  constructor(texture) {
    super({ name: 'track-tile', width: 1, height: 1, maxHz: 1, pxPerM: 16 });
    this.grabAnywhere = true;          // a pinch-hold anywhere on it picks the screen up
    this.material.map = texture;
    this.material.transparent = false;
    this.material.needsUpdate = true;
  }
  refresh() { return false; }
  draw() {}
  setPassthrough() {}                  // stays opaque
}

function loadTransform() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (v && Array.isArray(v.p) && v.p.length === 3 && Array.isArray(v.q) && v.q.length === 4 && Number.isFinite(v.s)) return v;
  } catch { /* none */ }
  return null;
}

/**
 * @param {object} o
 * @param {import('../panels/panel-base.js').PanelManager} o.manager the pit wall panels (layout rig = manager.group)
 * @param {{group: THREE.Group}} o.mainScreen createMainScreen result
 * @param {THREE.Group} o.table the track table (moved out of the room while the screen is up)
 * @param {import('../scene/cars.js').Cars} o.cars label and car size follow the track camera
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {'flat'|'curved'} [o.shape]
 * @param {'2d'|'3d'} [o.view]
 * @returns {object} see the return statement
 */
export function createVrScreen({ manager, mainScreen, table, cars, renderer, shape = 'flat', view = '2d' }) {
  const group = new THREE.Group();
  group.name = 'vr-screen';
  manager.group.add(group);
  const home = { p: new THREE.Vector3(0, SCREEN_CENTER_Y, -SCREEN_DISTANCE), q: new THREE.Quaternion(), s: 1 };

  const rt = new THREE.WebGLRenderTarget(RT_MAX, Math.round(RT_MAX * 9 / 16), { samples: 4 });
  const track = manager.add(new TrackTile(rt.texture), { x: 0, y: 0, z: 0 }, { parent: group });
  const camera = new THREE.PerspectiveCamera(VIEWS['2d'].fov, 16 / 9, 0.01, 100);
  const hemi = new THREE.HemisphereLight(0xb8c8e0, 0x14161c, 1.1);
  const sun = new THREE.DirectionalLight(0xdfe8ff, 1.2);
  sun.position.set(1.5, 4, 1);

  const byName = new Map(manager.panels.map((p) => [p.name, p]));
  /** Objects moved onto the screen, with where they came from (restore()). */
  const moved = [];
  let active = false;
  let focus = 'track';
  let curShape = shape === 'curved' ? 'curved' : 'flat';
  let curView = VIEWS[view] ? view : '2d';
  let tableHome = null;
  let acc = 1;                       // render the track on the first frame
  const clear = new THREE.Color();
  let renders = 0;

  /** Place `obj` with its centre at virtual px (cx, cy), `z` metres in front of the surface. */
  function put(obj, cx, cy, z = 0) {
    const s = (cx - VPX_W / 2) * M_PER_PX;
    const y = (VPX_H / 2 - cy) * M_PER_PX;
    if (curShape === 'curved') {
      const R = SCREEN_DISTANCE;
      const a = s / R;
      // The screen centre is at group-local 0; the cylinder axis is R toward the user (+Z).
      obj.position.set(Math.sin(a) * (R - z), y, R - Math.cos(a) * (R - z));
      obj.rotation.set(0, -a, 0);
    } else {
      obj.position.set(s, y, z);
      obj.rotation.set(0, 0, 0);
    }
  }

  /** Fit an object of natural size w × h metres into the tile (contain, or pinned to the top). */
  function fit(obj, tile, w, h, { top = false, z = 0 } = {}) {
    const aspect = h / w;
    const r = top ? { x: tile.x, y: tile.y, w: tile.w, h: tile.w * aspect } : containRect(tile, aspect);
    obj.scale.setScalar((r.w * M_PER_PX) / w);
    put(obj, r.x + r.w / 2, r.y + r.h / 2, z);
  }

  function layout() {
    const L = computeScreenLayout(VPX_W, VPX_H, { focus });
    for (const name of SCREEN_PANELS) {
      const p = byName.get(name);
      if (!p) continue;
      fit(p.mesh, L.tiles[name], p.width, p.height, name === 'ticker' ? { top: true, z: OVERLAY_Z } : {});
    }
    fit(mainScreen.group, L.tiles.main, MAIN_SCREEN.width, MAIN_SCREEN.height);
    const t = L.tiles.track;
    track.mesh.scale.set(t.w * M_PER_PX, t.h * M_PER_PX, 1);
    put(track.mesh, t.x + t.w / 2, t.y + t.h / 2, 0);
    // Render target at the tile's aspect, at most RT_MAX on its long side.
    const k = RT_MAX / Math.max(t.w, t.h);
    const w = Math.max(64, Math.round(t.w * k));
    const h = Math.max(64, Math.round(t.h * k));
    if (rt.width !== w || rt.height !== h) rt.setSize(w, h);
    frameTrack(camera, curView, t.w / t.h);
    cars.labels.setSize(labelAngularSize(LABEL_PX, t.h, camera.fov), 0, 10);
    cars.carScale = VIEWS[curView].carScale;
    acc = 1;
  }

  function applySaved() {
    const v = loadTransform();
    if (v) {
      group.position.fromArray(v.p);
      group.quaternion.fromArray(v.q).normalize();
      group.scale.setScalar(THREE.MathUtils.clamp(v.s, 0.5, 2.5));
    } else {
      group.position.copy(home.p);
      group.quaternion.copy(home.q);
      group.scale.setScalar(home.s);
    }
  }

  function remember(obj) {
    moved.push({ obj, parent: obj.parent, p: obj.position.clone(), q: obj.quaternion.clone(), s: obj.scale.clone() });
    group.add(obj);
  }

  return {
    group,
    camera,
    track,
    isActive: () => active,
    getShape: () => curShape,
    getView: () => curView,
    getFocus: () => focus,
    /** Move the panels, main screen and table onto the screen. */
    apply() {
      if (active) return;
      active = true;
      for (const name of SCREEN_PANELS) { const p = byName.get(name); if (p) remember(p.mesh); }
      remember(mainScreen.group);
      tableHome = { parent: table.parent, p: table.position.clone(), q: table.quaternion.clone(), s: table.scale.clone() };
      table.removeFromParent();
      table.position.set(0, 0, 0);
      table.quaternion.identity();
      table.scale.setScalar(1);
      table.add(hemi, sun);
      track.mesh.visible = true;
      group.visible = true;
      applySaved();
      layout();
    },
    /** Put everything back where it was (Immersive). */
    restore() {
      if (!active) return;
      active = false;
      for (const m of moved) {
        m.parent.add(m.obj);
        m.obj.position.copy(m.p);
        m.obj.quaternion.copy(m.q);
        m.obj.scale.copy(m.s);
      }
      moved.length = 0;
      table.remove(hemi, sun);
      if (tableHome) {
        tableHome.parent.add(table);
        table.position.copy(tableHome.p);
        table.quaternion.copy(tableHome.q);
        table.scale.copy(tableHome.s);
      }
      track.mesh.visible = false;
      group.visible = false;
      cars.labels.setSize();
      cars.carScale = 1;
    },
    setShape(s) { curShape = s === 'curved' ? 'curved' : 'flat'; if (active) layout(); },
    setView(v) { curView = VIEWS[v] ? v : '2d'; if (active) layout(); },
    /** Swap the track and main screen tiles. */
    toggleFocus() { focus = focus === 'track' ? 'main' : 'track'; if (active) layout(); },
    /** The movable unit for a grabbed panel: the whole screen for anything on it. */
    movableFor(panel) {
      if (!active || !panel) return null;
      for (let o = panel.mesh; o; o = o.parent) if (o === group) return group;
      return null;
    },
    /** Save the screen's placement (after a grab or resize). */
    saveTransform() {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ p: group.position.toArray(), q: group.quaternion.toArray(), s: group.scale.x }));
      } catch { /* ignore */ }
    },
    /** Back to the default placement and size. */
    resetTransform() {
      try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
      applySaved();
    },
    /**
     * Per frame while active: render the track tile at ≤RT_FPS (XR off for the pass, state
     * restored after, as three's Reflector does). Allocation-free.
     * @returns {boolean} true if a pass was rendered
     */
    update(dt) {
      if (!active) return false;
      acc += dt;
      if (acc < 1 / RT_FPS) return false;
      acc = acc > 2 / RT_FPS ? 0 : acc - 1 / RT_FPS;
      const r = renderer;
      const prevTarget = r.getRenderTarget();
      const prevXr = r.xr.enabled;
      const prevAlpha = r.getClearAlpha();
      r.getClearColor(clear);
      r.xr.enabled = false;
      r.setRenderTarget(rt);
      r.setClearColor(BG, 1);
      r.clear();
      r.render(table, camera);
      r.setRenderTarget(prevTarget);
      r.xr.enabled = prevXr;
      r.setClearColor(clear, prevAlpha);
      renders++;
      return true;
    },
    stats: () => ({ renders, rt: [rt.width, rt.height] }),
    dispose() {
      table.remove(hemi, sun);
      hemi.dispose();
      sun.dispose();
      rt.dispose();
      group.removeFromParent(); // the panels (and the track tile) are disposed by the PanelManager
    },
  };
}
