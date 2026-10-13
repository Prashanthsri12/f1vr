// Onboard view (spec §6, tab 1): a second camera rides the selected car on the table at a
// driver's-eye height, looking along its heading, rendered to a 1024x576 render target at
// 30 fps while the Onboard tab is showing. Only the table subtree is drawn (render root =
// table), lit by two lights on layer 5 that the main and XR eye cameras never see.
// The selected car, its glow and all labels are hidden during the pass.
// Plus OnboardOverlay: the speed / gear / position card drawn over the screen corner.
import * as THREE from 'three';
import { Panel, THEME, font, roundRect } from '../panels/panel-base.js';

const RT_W = 1024;
const RT_H = 576;
const FPS = 30;
const LAYER = 5;               // onboard-only lights (XR eye cameras use layers 1 and 2)
const SKY = 0x1b2433;
const CAM_H = 0.009;           // table-local metres above the car's base (car is 0.025 m long)
const CAM_BACK = 0.004;        // a little behind the car's centre
const LOOK_AHEAD = 0.12;
const LOOK_H = 0.004;
const YAW_RATE = 8;            // 1/s, heading smoothing
const SNAP = 1.0;              // radians: a bigger heading jump (seek) snaps

export class Onboard {
  /**
   * @param {object} o
   * @param {THREE.WebGLRenderer} o.renderer
   * @param {THREE.Object3D} o.table createTable group (render root; content in userData.content)
   * @param {import('./cars.js').Cars} o.cars
   */
  constructor({ renderer, table, cars }) {
    this.renderer = renderer;
    this.table = table;
    this.content = table.userData.content || table;
    this.cars = cars;
    this.rt = new THREE.WebGLRenderTarget(RT_W, RT_H, { samples: 4 });
    this.texture = this.rt.texture;
    this.camera = new THREE.PerspectiveCamera(65, RT_W / RT_H, 0.001, 4);
    this.camera.layers.set(0);
    this.camera.layers.enable(LAYER);

    this.hemi = new THREE.HemisphereLight(0xc8d6ea, 0x202228, 1.3);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.4);
    this.sun.position.set(0.5, 2, 0.3);
    for (const l of [this.hemi, this.sun]) { l.layers.set(LAYER); table.add(l); }

    this.calls = 0;            // draw calls of the last onboard pass
    this.rendered = 0;         // passes so far
    this.noPose = 0;           // due passes skipped because the selected car was hidden
    this.hasPose = false;
    this._acc = 1;             // render on the first active frame
    this._since = 0;
    this._yaw = NaN;
    this._p = new THREE.Vector3();
    this._eye = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._clear = new THREE.Color();
    this._saved = new THREE.Matrix4();
  }

  /**
   * Per frame. Renders the onboard pass at ≤30 fps while `active`. Allocation-free.
   * @returns {boolean} true if a pass was rendered this frame
   */
  update(dt, active) {
    this._acc += dt;
    this._since += dt;
    if (!active || this._acc < 1 / FPS) return false;
    // Carry the remainder so 72 / 90 Hz displays average 30 passes/s (not every 3rd frame).
    this._acc = this._acc > 2 / FPS ? 0 : this._acc - 1 / FPS;
    const step = Math.min(this._since, 0.5);
    this._since = 0;
    const h = this.cars.getSelectedPose(this._p);
    this.hasPose = h === h;
    if (!this.hasPose) { this.noPose++; return false; } // car hidden (no data yet): keep the last image
    this._placeCamera(h, step);
    this._render();
    return true;
  }

  _placeCamera(h, dt) {
    let d = h - this._yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (this._yaw !== this._yaw || Math.abs(d) > SNAP) this._yaw = h;
    else this._yaw += d * (1 - Math.exp(-dt * YAW_RATE));
    const fx = Math.sin(this._yaw);
    const fz = Math.cos(this._yaw);
    const p = this._p;
    this._eye.set(p.x - fx * CAM_BACK, p.y + CAM_H, p.z - fz * CAM_BACK);
    this._look.set(p.x + fx * LOOK_AHEAD, p.y + LOOK_H, p.z + fz * LOOK_AHEAD);
    this.content.updateWorldMatrix(true, false);
    this._eye.applyMatrix4(this.content.matrixWorld);
    this._look.applyMatrix4(this.content.matrixWorld);
    this.camera.position.copy(this._eye);
    this.camera.lookAt(this._look);
    this.camera.updateMatrixWorld();
  }

  /** Off-screen pass with XR switched off (as three's Reflector does), state restored after. */
  _render() {
    const r = this.renderer;
    const cars = this.cars;
    const sel = cars.selectedIndex;
    const prevTarget = r.getRenderTarget();
    const prevXr = r.xr.enabled;
    const prevAlpha = r.getClearAlpha();
    r.getClearColor(this._clear);
    const labels = cars.labels && cars.labels.mesh;
    const labelsVis = labels ? labels.visible : false;
    const glowVis = cars.glow.visible;
    const trailVis = cars.trail.visible;
    if (labels) labels.visible = false;
    cars.glow.visible = false;
    cars.trail.visible = false;
    if (sel >= 0) {
      cars.mesh.getMatrixAt(sel, this._saved);
      cars.mesh.setMatrixAt(sel, cars._zero);
      cars.mesh.instanceMatrix.needsUpdate = true;
    }

    r.xr.enabled = false;
    r.setRenderTarget(this.rt);
    r.setClearColor(SKY, 1);
    r.render(this.table, this.camera);
    this.calls = r.info.render.calls;
    this.rendered++;

    r.setRenderTarget(prevTarget);
    r.xr.enabled = prevXr;
    r.setClearColor(this._clear, prevAlpha);
    if (sel >= 0) {
      cars.mesh.setMatrixAt(sel, this._saved);
      cars.mesh.instanceMatrix.needsUpdate = true;
    }
    if (labels) labels.visible = labelsVis;
    cars.glow.visible = glowVis;
    cars.trail.visible = trailVis;
  }

  dispose() {
    this.hemi.removeFromParent();
    this.sun.removeFromParent();
    this.hemi.dispose();
    this.sun.dispose();
    this.rt.dispose();
  }
}

/** Speed, gear and position card in the screen's lower-left corner (≤10 Hz, only when shown). */
export class OnboardOverlay extends Panel {
  /** @param {import('../session-data.js').SessionData} data */
  constructor(data) {
    super({ name: 'onboard-overlay', width: 0.62, height: 0.15 });
    this.data = data;
    this._tel = { speed: 0, rpm: 0, gear: 0, throttle: 0, brake: 0, drs: 0 };
    this._shown = { n: null, speed: -1, gear: -1, pos: -1, ok: null };
  }

  refresh(ctx) {
    if (!this.mesh.visible) return false;
    const n = ctx.selected;
    const ok = n != null && this.data.getTelemetryAt(n, ctx.time, this._tel);
    const speed = ok ? Math.round(this._tel.speed) : -1;
    const gear = ok ? this._tel.gear : -1;
    const pos = n != null ? this.data.getPositionAt(n, ctx.time) || -1 : -1;
    const s = this._shown;
    if (s.n === n && s.speed === speed && s.gear === gear && s.pos === pos && s.ok === ok) return false;
    s.n = n; s.speed = speed; s.gear = gear; s.pos = pos; s.ok = ok;
    return true;
  }

  draw(g, w, h) {
    const { n, speed, gear, pos } = this._shown;
    const d = n != null ? this.data.driverByNumber.get(n) : null;
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(13,16,22,0.78)';
    roundRect(g, 0, 0, w, h, 16);
    g.fill();
    g.fillStyle = (d && d.teamColour) || THEME.muted;
    g.fillRect(0, 14, 10, h - 28);
    g.textBaseline = 'middle';
    g.fillStyle = THEME.text;
    g.font = font(58, 700);
    g.fillText(`${pos > 0 ? `P${pos}` : 'P–'}  ${d ? d.acronym : ''}`, 30, h / 2 + 2);
    g.textAlign = 'right';
    g.font = font(58, 700);
    g.fillText(speed >= 0 ? String(speed) : '–', w - 210, h / 2 + 2);
    g.font = font(28, 600);
    g.fillStyle = THEME.muted;
    g.fillText('km/h', w - 140, h / 2 + 10);
    g.fillStyle = THEME.text;
    g.font = font(58, 700);
    g.fillText(gear > 0 ? `G${gear}` : gear === 0 ? 'N' : '–', w - 26, h / 2 + 2);
    g.textAlign = 'left';
  }
}
