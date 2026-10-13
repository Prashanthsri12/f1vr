// Canvas-texture panels: shared drawing theme, throttled redraw, rect hit testing.
//
// A panel is a plane mesh textured with a 2D canvas (1024 px per metre).
// Subclasses implement:
//   refresh(ctx) -> boolean   cheap: compare the data shown with what was last drawn,
//                             return true if a redraw is needed (called ≤ maxHz)
//   draw(g, w, h, ctx)        draw everything with the 2D canvas API; register
//                             clickable rects with this.addHit(...) while drawing
//   onHit(hit, ctx, px)       optional: a registered rect was selected; px = {x, y} canvas px of the hit
//                             (sliders use px.x relative to hit.x / hit.w)
// PanelManager owns placement, the ≤10 Hz refresh/redraw cycle, passthrough
// opacity and a single raycast for all panels.
//
// Canvas pixels are *logical*: lw × lh = size × pxPerM. When a panel is enlarged (4b.14)
// setDensity(scale) grows the backing canvas and draws through a k× transform, so draw(),
// hit rects and uvToPx keep working in the same logical pixels.
import * as THREE from 'three';

export const PX_PER_M = 1024;
export const MAX_HZ = 10;
export const MAX_PX_PER_M = 2048; // backing density cap for enlarged panels (texture memory)

export const THEME = {
  font: "'Titillium Web', system-ui, sans-serif",
  bg: '#0d1016',           // opaque panel background (pit wall mode)
  bgRgb: '13,16,22',       // used with alpha in passthrough mode
  surface: '#161b24',      // rows, cells
  surfaceHi: '#202735',    // hover / highlighted row
  line: '#2a3240',
  text: '#e8ecf2',
  muted: '#8a94a6',
  accent: '#e10600',       // F1-style red: selected state, highlights
  purple: '#b138dd',       // overall best
  green: '#2ad36a',        // personal best / gain
  yellow: '#f5c400',       // slower / yellow flag
  red: '#ff3b30',          // loss / brake
  orange: '#ff8a00',       // safety car
  blue: '#2f7bff',
};

export const TYRE_COLOURS = {
  SOFT: '#ff3b30', MEDIUM: '#f5c400', HARD: '#f2f2f2',
  INTERMEDIATE: '#2ad36a', WET: '#2f7bff', UNKNOWN: '#8a94a6',
};

/** CSS font string, e.g. font(28, 700) or font(28, 600, true) for tabular numbers. */
export function font(px, weight = 600) {
  return `${weight} ${px}px ${THEME.font}`;
}

/** Rounded rectangle path helper. */
export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/** Format seconds as m:ss.mmm (lap times) or ss.mmm under a minute. */
export function fmtLap(sec) {
  if (sec == null || !Number.isFinite(sec)) return '–';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, '0')}` : s.toFixed(3);
}

/** Format a gap/interval: numbers as +1.234, strings ("+1 LAP") as-is. */
export function fmtGap(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  return v === 0 ? '' : `+${v.toFixed(3)}`;
}

let fontsReady = false;
const fontsPromise = (typeof document !== 'undefined' && document.fonts)
  ? Promise.all([
    document.fonts.load(font(32, 400)), document.fonts.load(font(32, 600)), document.fonts.load(font(32, 700)),
  ]).catch(() => {}).then(() => document.fonts.ready).then(() => { fontsReady = true; })
  : Promise.resolve().then(() => { fontsReady = true; });
export const whenFontsReady = () => fontsPromise;

/** Global redraw counter (shown in the desktop HUD to watch the ≤10 Hz budget). */
export const panelStats = { redraws: 0 };

export class Panel {
  /**
   * @param {object} o
   * @param {string} o.name
   * @param {number} o.width metres
   * @param {number} o.height metres
   * @param {number} [o.maxHz] redraw cap (default 10)
   * @param {number} [o.pxPerM] canvas density (default 1024; near panels like the wrist menu use more)
   */
  constructor({ name, width, height, maxHz = MAX_HZ, pxPerM = PX_PER_M }) {
    this.name = name;
    this.width = width;
    this.height = height;
    this.maxHz = Math.min(maxHz, MAX_HZ);
    this.pxPerM = pxPerM;
    this.lw = Math.round(width * pxPerM);   // logical canvas px (draw / hit-test space)
    this.lh = Math.round(height * pxPerM);
    this.density = 1;                       // backing px per logical px
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.lw;
    this.canvas.height = this.lh;
    this.g = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.material);
    this.mesh.name = `panel:${name}`;
    this.mesh.userData.panel = this;
    this.passthrough = false;
    this.hover = null;          // id of the hovered hit rect, for hover styling
    this.passThroughEmpty = false; // true: rays pass through areas with no hit rect (e.g. collapsed ticker)
    this._hits = [];
    this._dirty = true;
    this._since = Infinity;
  }

  /** Force a redraw at the next opportunity. */
  invalidate() { this._dirty = true; }

  /** Background fill respecting passthrough opacity (75%). Call first in draw(). */
  clear(g, w, h, radius = 18) {
    g.clearRect(0, 0, w, h);
    g.fillStyle = this.passthrough ? `rgba(${THEME.bgRgb},0.75)` : THEME.bg;
    roundRect(g, 0, 0, w, h, radius);
    g.fill();
  }

  /** Register a clickable rect (canvas px) during draw(). */
  addHit(id, x, y, w, h, payload) {
    this._hits.push({ id, x, y, w, h, payload });
  }

  /** @returns {{id, payload, x, y}|null} for canvas px coordinates */
  hitTestPx(px, py) {
    for (let i = this._hits.length - 1; i >= 0; i--) {
      const r = this._hits[i];
      if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return r;
    }
    return null;
  }

  /** UV (from a raycast) to logical canvas px. */
  uvToPx(uv, out) {
    out.x = uv.x * this.lw;
    out.y = (1 - uv.y) * this.lh;
    return out;
  }

  /**
   * Backing-canvas density for a panel shown at `scale` × its size (4b.14):
   * k = clamp(scale, 1, MAX_PX_PER_M / pxPerM) in 0.25 steps, so small changes don't reallocate.
   * Re-allocates the canvas and GPU texture only when k changes; the next tick redraws.
   * @returns {boolean} true if the density changed
   */
  setDensity(scale) {
    const cap = Math.max(1, MAX_PX_PER_M / this.pxPerM);
    const k = Math.min(cap, Math.max(1, Math.ceil(scale * 4 - 1e-6) / 4));
    if (k === this.density) return false;
    this.density = k;
    this.canvas.width = Math.round(this.lw * k);
    this.canvas.height = Math.round(this.lh * k);
    this.texture.dispose(); // new size: three re-creates the GPU texture on the next upload
    this._dirty = true;
    this._since = Infinity;
    return true;
  }

  setPassthrough(on) {
    if (this.passthrough !== on) { this.passthrough = on; this._dirty = true; }
  }

  setHover(id) {
    if (this.hover !== id) { this.hover = id; this._dirty = true; }
  }

  // --- subclass hooks ---
  refresh(_ctx) { return false; }
  draw(g, w, h, _ctx) { this.clear(g, w, h); }
  onHit(_hit, _ctx, _px) {}

  /** Called every frame by PanelManager; redraws at most maxHz and only when needed. */
  tick(dt, ctx) {
    this._since += dt;
    if (this._since < 1 / this.maxHz) return;
    if (!fontsReady) return;
    if (this.refresh(ctx)) this._dirty = true;
    if (!this._dirty) return;
    this._since = 0;
    this._dirty = false;
    this._hits.length = 0;
    panelStats.redraws++;
    const k = this.density;
    this.g.setTransform(k, 0, 0, k, 0, 0);
    this.draw(this.g, this.lw, this.lh, ctx);
    this.texture.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
  }
}

const _target = new THREE.Vector3();
const _px = { x: 0, y: 0 };

export class PanelManager {
  /** @param {THREE.Object3D} parent where the layout rig (this.group, holding the panel meshes) is added */
  constructor(parent) {
    this.group = new THREE.Group();
    this.group.name = 'panels';
    parent.add(this.group);
    this.panels = [];
    this._meshes = [];
    this._hits = [];
  }

  /**
   * Add a panel and place it facing the user's start position (origin, at the panel's height).
   * @param {Panel} panel
   * @param {{x:number,y:number,z:number}} position metres
   * @param {{tiltDeg?: number, parent?: THREE.Object3D}} [opts] tiltDeg tips the top edge away (positive)
   *   e.g. for waist-height panels; parent defaults to the layout rig (this.group)
   */
  add(panel, position, { tiltDeg = 0, parent = this.group } = {}) {
    panel.mesh.position.set(position.x, position.y, position.z);
    _target.set(0, position.y, 0);
    panel.mesh.lookAt(_target); // no parent yet: position and target are rig-local
    if (tiltDeg) panel.mesh.rotateX(-THREE.MathUtils.degToRad(tiltDeg));
    parent.add(panel.mesh);
    this.panels.push(panel);
    this._meshes.push(panel.mesh);
    return panel;
  }

  /** Per frame. ctx is the shared PanelContext (see CONTRACTS.md). */
  update(dt, ctx) {
    for (let i = 0; i < this.panels.length; i++) this.panels[i].tick(dt, ctx);
  }

  setPassthrough(on) {
    for (const p of this.panels) p.setPassthrough(on);
  }

  /**
   * Raycast all panels. Returns the hit rect under the ray (or null) and the
   * world point, without allocating per call except the reused hits array.
   * @param {THREE.Raycaster} raycaster
   * @returns {{panel: Panel, rect: object|null, px: {x:number,y:number}, distance: number, point: THREE.Vector3}|null}
   */
  raycast(raycaster) {
    this._hits.length = 0;
    raycaster.intersectObjects(this._meshes, false, this._hits);
    for (const h of this._hits) {
      const panel = h.object.userData.panel;
      if (!panel || !h.object.visible || !h.uv) continue;
      panel.uvToPx(h.uv, _px);
      const rect = panel.hitTestPx(_px.x, _px.y);
      if (!rect && panel.passThroughEmpty) continue;
      return { panel, rect, px: { x: _px.x, y: _px.y }, distance: h.distance, point: h.point };
    }
    return null;
  }

  /** Update hover highlight from a raycast result (or null). */
  setHover(result) {
    for (const p of this.panels) {
      p.setHover(result && result.panel === p && result.rect ? result.rect.id : null);
    }
  }

  /** Select whatever a raycast result points at. Returns true if a rect was hit. */
  select(result, ctx) {
    if (!result || !result.rect) return false;
    result.panel.onHit(result.rect, ctx, result.px);
    result.panel.invalidate();
    return true;
  }

  dispose() {
    for (const p of this.panels) p.dispose();
    this.panels.length = 0;
    this._meshes.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
