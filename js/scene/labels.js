// Car labels ("VER 1"): one canvas atlas texture + one InstancedMesh of camera-facing quads
// (custom billboard ShaderMaterial) => 1 draw call for all labels.

import * as THREE from 'three';

const COLS = 5;
const CELL_W = 256;
const CELL_H = 80;
const FONT_FAMILY = '"Titillium Web", "Segoe UI", Arial, sans-serif';
const LABEL_HEIGHT = 0.012; // metres at table scale 1
const REDRAW_INTERVAL_MS = 250; // <= 4 Hz

const vertexShader = /* glsl */`
attribute vec2 cell;
uniform vec2 cellSize;
uniform vec2 labelSize;
varying vec2 vUv;
void main() {
  vUv = cell + uv * cellSize;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  float s = length(modelMatrix[0].xyz) * length(instanceMatrix[0].xyz);
  mv.xy += position.xy * labelSize * s;
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
    this.rows = Math.ceil(n / COLS);
    this.canvas = document.createElement('canvas');
    this.canvas.width = COLS * CELL_W;
    this.canvas.height = this.rows * CELL_H;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.flipY = false; // canvas row 0 = v 0

    const geo = new THREE.PlaneGeometry(1, 1);
    const cells = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      cells[i * 2] = (i % COLS) / COLS;
      cells[i * 2 + 1] = Math.floor(i / COLS) / this.rows;
    }
    // PlaneGeometry uv v=1 at top; flip so top of quad samples top of cell (flipY = false)
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    geo.setAttribute('cell', new THREE.InstancedBufferAttribute(cells, 2));
    this.geometry = geo;

    const aspect = CELL_W / CELL_H;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.texture },
        cellSize: { value: new THREE.Vector2(1 / COLS, 1 / this.rows) },
        labelSize: { value: new THREE.Vector2(LABEL_HEIGHT * aspect, LABEL_HEIGHT) },
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
   * Places label i above a car (table-content coords) or hides it.
   * @param {number} i
   * @param {boolean} visible
   * @param {number} x @param {number} y @param {number} z  label anchor (already offset above the car)
   * @param {number} scale  1 normally
   */
  setLabel(i, visible, x, y, z, scale = 1) {
    const s = visible ? scale : 0;
    const m = this._m;
    m.set(s, 0, 0, x, 0, s, 0, y, 0, 0, s, z, 0, 0, 0, 1);
    this.mesh.setMatrixAt(i, m);
  }

  /** Call once per frame after setLabel calls. */
  commit() { this.mesh.instanceMatrix.needsUpdate = true; }

  /**
   * Redraws only changed cells, at most 4 Hz.
   * @param {(driverNumber:number)=>number|null} getPosition
   * @param {number} nowMs  wall clock (performance.now())
   */
  refresh(getPosition, nowMs) {
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
  }

  _drawAll() {
    for (let i = 0; i < this.drivers.length; i++) {
      this._drawCell(i);
    }
    this.texture.needsUpdate = true;
  }

  _drawCell(i) {
    const ctx = this.ctx;
    const d = this.drivers[i];
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
    const pos = this._shownPos[i];
    const text = pos > 0 ? `${d.acronym || d.number} ${pos}` : `${d.acronym || d.number}`;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.font = `700 48px ${this._fontReady ? FONT_FAMILY : 'Arial, sans-serif'}`;
    ctx.fillText(text, x + 5 + w / 2, y + h / 2 + 2, w - 24);
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
