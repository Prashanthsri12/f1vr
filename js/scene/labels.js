// Car labels ("VER 1"): one canvas atlas texture + one InstancedMesh of camera-facing quads
// (custom billboard ShaderMaterial) => 1 draw call for all labels.
// Size (4b.6): a constant apparent size, ANGULAR_SIZE metres tall per metre of view
// distance (2.5 cm at 1 m), clamped, independent of the table scale. Each label sits just
// above its anchor in view space.
// Declutter (4b.7, ≤4 Hz): overlapping labels collapse to a short cell with only the
// position number; the selected driver, the top 3 and the cars directly ahead of and
// behind the selected one always stay full (label-layout.js).

import * as THREE from 'three';
import { declutterLabels, MODE_FULL } from './label-layout.js';

const COLS = 5;
const CELL_W = 256;
const CELL_H = 80;
const SHORT = CELL_H;          // short cells are CELL_H × CELL_H squares
const FONT_FAMILY = '"Titillium Web", "Segoe UI", Arial, sans-serif';
export const ANGULAR_SIZE = 0.025; // label height per metre of distance (≈1.4°: ~35 px on a Quest 3)
const MIN_HEIGHT = 0.004;      // metres
const MAX_HEIGHT = 0.05;
const GAP = 0.15;              // gap between anchor and label bottom, in label heights
const REDRAW_INTERVAL_MS = 250; // <= 4 Hz
const NO_RANK = 999;

const vertexShader = /* glsl */`
attribute vec4 cellRect;
uniform vec2 texSize;
uniform float angularSize;
uniform vec2 heightRange;
uniform float gap;
varying vec2 vUv;
void main() {
  vUv = cellRect.xy + uv * cellRect.zw;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float k = length(instanceMatrix[0].xyz);           // 0 hides; >1 for the selected car
  float h = clamp(angularSize * -mv.z, heightRange.x, heightRange.y) * k;
  float aspect = (cellRect.z * texSize.x) / (cellRect.w * texSize.y);
  mv.x += position.x * h * aspect;
  mv.y += (position.y + 0.5 + gap) * h;
  gl_Position = projectionMatrix * mv;
}`;

const fragmentShader = /* glsl */`
uniform sampler2D map;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb, 1.0);
  #include <colorspace_fragment>
}`;

export class CarLabels {
  /**
   * @param {{number:number, acronym:string, teamColour:string}[]} drivers
   * @param {THREE.Object3D} parent  table content group
   */
  constructor(drivers, parent) {
    this.drivers = drivers;
    const n = Math.max(1, drivers.length);
    this.n = n;
    this.rows = Math.ceil(n / COLS);
    this.shortCols = Math.floor((COLS * CELL_W) / SHORT);
    this.shortRows = Math.ceil(n / this.shortCols);
    this.canvas = document.createElement('canvas');
    this.canvas.width = COLS * CELL_W;
    this.canvas.height = (this.rows + this.shortRows) * CELL_H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.flipY = false; // canvas row 0 = v 0

    // Per-label UV rects (u0, v0, du, dv) for the full and short cells.
    const W = this.canvas.width, H = this.canvas.height;
    this._fullRect = new Float32Array(n * 4);
    this._shortRect = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      this._fullRect.set([((i % COLS) * CELL_W) / W, (Math.floor(i / COLS) * CELL_H) / H, CELL_W / W, CELL_H / H], i * 4);
      const sx = (i % this.shortCols) * SHORT, sy = (this.rows + Math.floor(i / this.shortCols)) * CELL_H;
      this._shortRect.set([sx / W, sy / H, SHORT / W, SHORT / H], i * 4);
    }

    const geo = new THREE.PlaneGeometry(1, 1);
    // PlaneGeometry uv v=1 at top; flip so top of quad samples top of cell (flipY = false)
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.cellAttr = new THREE.InstancedBufferAttribute(this._fullRect.slice(), 4);
    this.cellAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('cellRect', this.cellAttr);
    this.geometry = geo;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.texture },
        texSize: { value: new THREE.Vector2(W, H) },
        angularSize: { value: ANGULAR_SIZE },
        heightRange: { value: new THREE.Vector2(MIN_HEIGHT, MAX_HEIGHT) },
        gap: { value: GAP },
      },
      vertexShader,
      fragmentShader,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.material, n);
    this.mesh.name = 'carLabels';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, zero);
    parent.add(this.mesh);

    this._shownPos = new Int16Array(n).fill(-2); // -2 = never drawn, -1 = no position
    // Anchors (table-content coords) and visibility, kept for the 4 Hz declutter.
    this._anchor = new Float32Array(n * 3);
    this._scale = new Float32Array(n);
    this._visible = new Uint8Array(n);
    // Declutter scratch
    this._modes = new Uint8Array(n).fill(MODE_FULL);
    this._shownModes = new Uint8Array(n).fill(MODE_FULL);
    this._cx = new Float32Array(n);
    this._cy = new Float32Array(n);
    this._hw = new Float32Array(n);
    this._hh = new Float32Array(n);
    this._must = new Uint8Array(n);
    this._rank = new Int16Array(n);
    this._order = new Int16Array(n);
    this._onScreen = new Uint8Array(n);
    this._v = new THREE.Vector3();
    this._view = new THREE.Matrix4();

    this._lastDraw = -Infinity;
    this._fontReady = false;
    this._m = new THREE.Matrix4();
    this._disposed = false;
    this._drawAll();
    if (typeof document !== 'undefined' && document.fonts && document.fonts.ready) {
      const load = document.fonts.load ? document.fonts.load(`700 48px "Titillium Web"`).catch(() => {}) : null;
      Promise.all([document.fonts.ready, load]).then(() => {
        if (this._disposed) return;
        this._fontReady = true;
        this._shownPos.fill(-2);
        this._drawAll();
      }).catch(() => {});
    }
  }

  /**
   * Places label i at an anchor (table-content coords, the top of the car) or hides it.
   * The label is drawn just above the anchor at a constant apparent size.
   * @param {number} i
   * @param {boolean} visible
   * @param {number} x @param {number} y @param {number} z
   * @param {number} scale  1 normally (the selected car's label is a little larger)
   */
  setLabel(i, visible, x, y, z, scale = 1) {
    const s = visible ? scale : 0;
    const m = this._m;
    m.set(s, 0, 0, x, 0, s, 0, y, 0, 0, s, z, 0, 0, 0, 1);
    this.mesh.setMatrixAt(i, m);
    this._visible[i] = visible ? 1 : 0;
    this._scale[i] = s;
    const a = this._anchor;
    a[i * 3] = x; a[i * 3 + 1] = y; a[i * 3 + 2] = z;
  }

  /** Call once per frame after setLabel calls. */
  commit() { this.mesh.instanceMatrix.needsUpdate = true; }

  /**
   * Redraws only changed cells and re-runs the declutter, at most 4 Hz. Allocation-free.
   * @param {(driverNumber:number)=>number|null} getPosition
   * @param {number} nowMs  wall clock (performance.now())
   * @param {THREE.Camera} [camera] the viewing camera (skip the declutter without it)
   * @param {number} [selectedIndex] -1 = none
   */
  refresh(getPosition, nowMs, camera, selectedIndex = -1) {
    if (nowMs - this._lastDraw < REDRAW_INTERVAL_MS) return;
    this._lastDraw = nowMs;
    let dirty = false;
    for (let i = 0; i < this.drivers.length; i++) {
      const p = getPosition(this.drivers[i].number);
      const v = Number.isFinite(p) ? p : -1;
      if (v !== this._shownPos[i]) {
        this._shownPos[i] = v;
        this._drawCell(i);
        dirty = true;
      }
    }
    if (dirty) this.texture.needsUpdate = true;
    if (camera) this._declutter(camera, selectedIndex);
  }

  _declutter(camera, sel) {
    const n = this.drivers.length;
    const v = this._v;
    // matrixWorld from the last render: in XR three.js copies the head pose into this camera.
    this._view.copy(camera.matrixWorld).invert();
    this.mesh.updateWorldMatrix(true, false);
    const fullAspect = CELL_W / CELL_H;
    const selPos = sel >= 0 ? this._shownPos[sel] : -1;
    for (let i = 0; i < n; i++) {
      const pos = this._shownPos[i];
      this._rank[i] = pos > 0 ? pos : NO_RANK;
      this._must[i] = (i === sel || (pos > 0 && pos <= 3) || (selPos > 0 && pos > 0 && Math.abs(pos - selPos) <= 1)) ? 1 : 0;
      this._onScreen[i] = 0;
      if (!this._visible[i]) continue;
      v.fromArray(this._anchor, i * 3).applyMatrix4(this.mesh.matrixWorld).applyMatrix4(this._view);
      const depth = -v.z;
      if (depth <= 0.01) continue;
      // Label height in the tangent plane (same clamp as the shader).
      const h = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, ANGULAR_SIZE * depth)) * this._scale[i] / depth;
      this._onScreen[i] = 1;
      this._cx[i] = v.x / depth;
      this._cy[i] = v.y / depth + h * (0.5 + GAP);
      this._hh[i] = h / 2;
      this._hw[i] = (h * fullAspect) / 2;
    }
    declutterLabels(n, this._onScreen, this._cx, this._cy, this._hw, this._hh, this._must, this._rank, this._order, this._modes);
    let changed = false;
    const arr = this.cellAttr.array;
    for (let i = 0; i < n; i++) {
      const mode = this._modes[i];
      if (mode === this._shownModes[i]) continue;
      this._shownModes[i] = mode;
      const src = mode === MODE_FULL ? this._fullRect : this._shortRect;
      arr[i * 4] = src[i * 4]; arr[i * 4 + 1] = src[i * 4 + 1]; arr[i * 4 + 2] = src[i * 4 + 2]; arr[i * 4 + 3] = src[i * 4 + 3];
      changed = true;
    }
    if (changed) this.cellAttr.needsUpdate = true;
  }

  /** @returns {Uint8Array} current mode per label (1 full, 0 short); for tests / debugging */
  getModes() { return this._shownModes; }

  _drawAll() {
    for (let i = 0; i < this.drivers.length; i++) {
      this._drawCell(i);
    }
    this.texture.needsUpdate = true;
  }

  _drawCell(i) {
    const ctx = this.ctx;
    const d = this.drivers[i];
    const pos = this._shownPos[i];
    const family = this._fontReady ? FONT_FAMILY : 'Arial, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    // Full cell: team bar + "ACR 3"
    {
      const x0 = (i % COLS) * CELL_W, y0 = Math.floor(i / COLS) * CELL_H;
      ctx.clearRect(x0, y0, CELL_W, CELL_H);
      const pad = 6, r = 14;
      const w = CELL_W - pad * 2, h = CELL_H - pad * 2, x = x0 + pad, y = y0 + pad;
      ctx.fillStyle = 'rgba(12,14,18,1)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.fillStyle = d.teamColour || '#888888';
      ctx.fillRect(x, y + 8, 10, h - 16);
      const text = pos > 0 ? `${d.acronym || d.number} ${pos}` : `${d.acronym || d.number}`;
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 48px ${family}`;
      ctx.fillText(text, x + 5 + w / 2, y + h / 2 + 2, w - 24);
    }
    // Short cell: position number over a team-colour underline
    {
      const x0 = (i % this.shortCols) * SHORT, y0 = (this.rows + Math.floor(i / this.shortCols)) * CELL_H;
      ctx.clearRect(x0, y0, SHORT, CELL_H);
      const pad = 6, r = 14;
      const w = SHORT - pad * 2, h = CELL_H - pad * 2, x = x0 + pad, y = y0 + pad;
      ctx.fillStyle = 'rgba(12,14,18,1)';
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
      ctx.fill();
      ctx.fillStyle = d.teamColour || '#888888';
      ctx.fillRect(x + 8, y + h - 9, w - 16, 6);
      ctx.fillStyle = pos > 0 ? '#ffffff' : '#a0a8b8';
      ctx.font = `700 ${pos >= 10 || pos < 0 ? 40 : 48}px ${family}`;
      ctx.fillText(pos > 0 ? String(pos) : String(d.number), x + w / 2, y + h / 2 - 2, w - 8);
    }
  }

  dispose() {
    this._disposed = true;
    this.mesh.removeFromParent();
    this.mesh.dispose?.();
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
