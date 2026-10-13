// In-scene fps counter (6.7), toggled by the `fps` setting (wrist menu "FPS ON/OFF").
// A small canvas Panel attached under the playback bar (it follows the bar when the user
// moves it), never head-locked and never moving the camera. Redraws at most 2 Hz.
// Not registered with the PanelManager: it isn't clickable.
import { Panel, THEME, font } from '../panels/panel-base.js';
import { getSettings } from '../settings.js';

const W = 0.5;
const H = 0.1;
const SAMPLE = 0.5;   // seconds per fps sample

export class FpsMeter extends Panel {
  /** @param {import('three').WebGLRenderer} renderer for draw-call / triangle counts */
  constructor(renderer) {
    super({ name: 'fps-meter', width: W, height: H, maxHz: 2 });
    this.renderer = renderer;
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    this.fps = 0;
    this.calls = 0;
    this.tris = 0;
    this._frames = 0;
    this._acc = 0;
    this._shown = '';
    this._state = {};  // tick() ctx; unused
  }

  /**
   * Attach under a panel mesh (the playback bar), `gap` metres below its bottom edge.
   * @param {import('three').Object3D} mesh
   * @param {number} height the panel's height in metres
   */
  attachBelow(mesh, height, gap = 0.02) {
    this.mesh.position.set(0, -(height / 2 + gap + H / 2), 0.002);
    mesh.add(this.mesh);
  }

  /** Per frame. Allocation-free apart from the ≤2 Hz label string. */
  update(dt) {
    const on = getSettings().fps;
    if (this.mesh.visible !== on) { this.mesh.visible = on; this.invalidate(); }
    this._frames++;
    this._acc += dt;
    if (this._acc >= SAMPLE) {
      this.fps = Math.round(this._frames / this._acc);
      const r = this.renderer.info.render;
      this.calls = r.calls;
      this.tris = r.triangles;
      this._frames = 0;
      this._acc = 0;
    }
    if (on) this.tick(dt, this._state);
  }

  refresh() {
    const key = `${this.fps}|${this.calls}|${Math.round(this.tris / 1000)}`;
    if (key === this._shown) return false;
    this._shown = key;
    return true;
  }

  draw(g, w, h) {
    this.clear(g, w, h, 14);
    g.textBaseline = 'middle';
    g.font = font(64, 700);
    g.fillStyle = this.fps >= 72 ? THEME.green : this.fps >= 60 ? THEME.yellow : THEME.red;
    g.fillText(`${this.fps} fps`, 24, h / 2 + 3);
    g.font = font(38, 600);
    g.fillStyle = THEME.muted;
    g.textAlign = 'right';
    g.fillText(`${this.calls} calls · ${Math.round(this.tris / 1000)}k tris`, w - 24, h / 2 + 3);
    g.textAlign = 'left';
  }
}
