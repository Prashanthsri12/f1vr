// Car effects (9.9): short fading trails behind every car except the selected one (which has
// its own 5 s trail in cars.js), and a pulsing halo ring on the table under the selected car.
// Draw calls: trails 1 (LineSegments, RGBA vertex colours), halo 1. All buffers are
// preallocated; update() writes into them (no per-frame allocation).
import * as THREE from 'three';

const POINTS = 8;           // trail samples per car
const STEP = 150;           // ms of session time between samples (~1.1 s of trail)
const LIFT = 0.0008;        // same as the cars
const ALPHA = 0.75;         // at the head
const HALO_PERIOD = 1400;   // ms per pulse (real time)
const HALO_GROW = 2.2;      // radius grows by this factor over a pulse
const HALO_ALPHA = 0.55;

export class CarFx {
  /**
   * @param {THREE.Object3D} parent table content
   * @param {number} count cars
   * @param {THREE.Color[]} teamColors
   */
  constructor(parent, count, teamColors) {
    this.count = count;
    this.teamColors = teamColors;
    const verts = count * POINTS * 2;
    this.pos = new Float32Array(verts * 3);
    this.col = new Float32Array(verts * 4);
    this.ring = new Float32Array(count * POINTS * 3); // sampled points (oldest first)
    this.valid = new Uint8Array(count * POINTS);
    this.geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('color', this.colAttr);
    this.mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false });
    this.trails = new THREE.LineSegments(this.geo, this.mat);
    this.trails.name = 'fieldTrails';
    this.trails.frustumCulled = false;
    parent.add(this.trails);

    this.haloGeo = new THREE.RingGeometry(0.84, 1, 40); // a thin ring, not a disc
    this.haloGeo.rotateX(-Math.PI / 2);
    this.haloMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.halo = new THREE.Mesh(this.haloGeo, this.haloMat);
    this.halo.name = 'selectedCarHalo';
    this.halo.frustumCulled = false;
    this.halo.visible = false;
    this.halo.renderOrder = 3;
    parent.add(this.halo);

    this._snap = NaN;
    this._o = { x: 0, y: 0, z: 0 };
    this._v = new THREE.Vector3();
    this._haloSel = -2;
  }

  /**
   * @param {import('./cars.js').Cars} cars
   * @param {object} data SessionData
   * @param {number} t session ms
   * @param {number} radius halo base radius (scene units)
   */
  update(cars, data, t, radius) {
    const toScene = cars.transform.toScene;
    const o = this._o, v = this._v;
    const sel = cars.selectedIndex;
    const snap = Math.floor(t / STEP) * STEP;
    // Re-sample the trail points when the step changes (a seek simply resamples).
    if (snap !== this._snap) {
      this._snap = snap;
      for (let i = 0; i < this.count; i++) {
        const num = cars.drivers[i].number;
        for (let j = 0; j < POINTS; j++) {
          const k = i * POINTS + j;
          const ok = i !== sel && data.getCarPositionAt(num, snap - (POINTS - 1 - j) * STEP, o);
          this.valid[k] = ok ? 1 : 0;
          if (ok) {
            toScene(o.x, o.y, o.z, v);
            this.ring[k * 3] = v.x; this.ring[k * 3 + 1] = v.y + LIFT; this.ring[k * 3 + 2] = v.z;
          }
        }
      }
    }
    // Segments: sample j -> j + 1, and the newest sample -> the car's current position.
    const pos = this.pos, col = this.col, ring = this.ring;
    for (let i = 0; i < this.count; i++) {
      const c = this.teamColors[i];
      const num = cars.drivers[i].number;
      const headOk = i !== sel && data.getCarPositionAt(num, t, o);
      if (headOk) toScene(o.x, o.y, o.z, v);
      for (let j = 0; j < POINTS; j++) {
        const k = i * POINTS + j;
        const a = k, b = j + 1 < POINTS ? k + 1 : -1;
        const okA = this.valid[a] === 1;
        const okB = b >= 0 ? this.valid[b] === 1 : headOk;
        const vi = k * 2;
        if (!okA || !okB) {
          col[vi * 4 + 3] = 0; col[vi * 4 + 7] = 0;
          continue;
        }
        pos[vi * 3] = ring[a * 3]; pos[vi * 3 + 1] = ring[a * 3 + 1]; pos[vi * 3 + 2] = ring[a * 3 + 2];
        if (b >= 0) { pos[vi * 3 + 3] = ring[b * 3]; pos[vi * 3 + 4] = ring[b * 3 + 1]; pos[vi * 3 + 5] = ring[b * 3 + 2]; }
        else { pos[vi * 3 + 3] = v.x; pos[vi * 3 + 4] = v.y + LIFT; pos[vi * 3 + 5] = v.z; }
        const fa = j / POINTS, fb = (j + 1) / POINTS;
        col[vi * 4] = c.r; col[vi * 4 + 1] = c.g; col[vi * 4 + 2] = c.b; col[vi * 4 + 3] = ALPHA * fa * fa;
        col[vi * 4 + 4] = c.r; col[vi * 4 + 5] = c.g; col[vi * 4 + 6] = c.b; col[vi * 4 + 7] = ALPHA * fb * fb;
      }
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;

    // Halo under the selected car: a ring that grows and fades, then restarts.
    const selP = cars._selP;
    if (sel >= 0 && cars._selVisible) {
      if (this._haloSel !== sel) { this._haloSel = sel; this.haloMat.color.copy(this.teamColors[sel]); }
      const ph = (performance.now() % HALO_PERIOD) / HALO_PERIOD;
      const r = radius * (1 + (HALO_GROW - 1) * ph);
      this.halo.position.set(selP.x, selP.y - LIFT * 0.5, selP.z);
      this.halo.scale.set(r, 1, r);
      this.haloMat.opacity = HALO_ALPHA * (1 - ph);
      this.halo.visible = true;
    } else {
      this.halo.visible = false;
    }
  }

  dispose() {
    this.geo.dispose(); this.mat.dispose();
    this.haloGeo.dispose(); this.haloMat.dispose();
    this.trails.removeFromParent(); this.halo.removeFromParent();
  }
}
