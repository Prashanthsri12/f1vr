// Cars on the track table (spec §4, CONTRACTS.md `js/scene/cars.js`).
// Draw calls: cars 1 InstancedMesh per material (wedge: 1; glTF model: one per material),
// selected-car glow 1, trail 1, labels 1 (see labels.js).
// No per-frame allocation: all temporaries are preallocated.

import * as THREE from 'three';
import { CarLabels } from './labels.js';
import { headingFromDelta } from './track-math.js';
import { resolveModelUrl, loadCarModel } from './car-model.js';

const CAR_LENGTH = 0.025;
const CAR_WIDTH = 0.011;
const CAR_LIFT = 0.0008;          // above the ribbon surface
const WEDGE_HEIGHT = 0.006;       // label anchor = top of the car (labels sit above it in view space)
const HEADING_DT = 250;           // ms either side of t
const SELECTED_SCALE = 1.5;
const TRAIL_POINTS = 60;
const TRAIL_STEP = 83;            // ms of session time between trail samples (~5 s total)
const HEADING_MIN = 1e-4;         // metres; shorter movement keeps the previous heading

/** Low-poly wedge, nose along +Z, base at y = 0. 12 triangles, flat normals. */
function createWedgeGeometry() {
  const l = CAR_LENGTH / 2, w = CAR_WIDTH / 2, hr = 0.006, hn = 0.0022;
  const RBL = [-w, 0, -l], RBR = [w, 0, -l], RTL = [-w * 0.8, hr, -l], RTR = [w * 0.8, hr, -l];
  const FBL = [-w * 0.45, 0, l], FBR = [w * 0.45, 0, l], FTL = [-w * 0.3, hn, l], FTR = [w * 0.3, hn, l];
  const quads = [
    [RBL, RBR, FBR, FBL], [RTL, RTR, FTR, FTL], [RBL, RBR, RTR, RTL],
    [FBL, FBR, FTR, FTL], [RBL, FBL, FTL, RTL], [RBR, FBR, FTR, RTR],
  ];
  const c = [0, 0.0025, 0];
  const pos = [];
  const tri = (a, b, d) => {
    // orient outward: normal must point away from the centroid
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (a[0] + b[0] + d[0]) / 3 - c[0], my = (a[1] + b[1] + d[1]) / 3 - c[1], mz = (a[2] + b[2] + d[2]) / 3 - c[2];
    if (nx * mx + ny * my + nz * mz < 0) pos.push(...a, ...d, ...b); else pos.push(...a, ...b, ...d);
  };
  for (const [a, b, cc, d] of quads) { tri(a, b, cc); tri(a, cc, d); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

export class Cars {
  /**
   * @param {{number:number, acronym:string, teamColour:string}[]} drivers
   * @param {{toScene:(x:number,y:number,z:number,out:THREE.Vector3)=>THREE.Vector3}} transform
   * @param {THREE.Group} table  from createTable (cars go in table.userData.content)
   */
  constructor(drivers, transform, table) {
    this.drivers = drivers;
    this.transform = transform;
    const parent = table.userData?.content || table;
    this.parent = parent;
    const n = Math.max(1, drivers.length);
    this.count = drivers.length;

    this.geometry = createWedgeGeometry();
    this.material = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.45, metalness: 0.15, emissive: 0x1a1a1a,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, n);
    this.mesh.name = 'cars';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.teamColors = [];
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const d = drivers[i];
      col.set(0x888888);
      if (d && d.teamColour) { try { col.setStyle(d.teamColour); } catch { /* keep grey */ } }
      this.teamColors.push(col.clone());
      this.mesh.setColorAt(i, col);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < n; i++) this.mesh.setMatrixAt(i, this._zero);
    parent.add(this.mesh);

    // Selected-car glow: back-face additive shell, own material so the instanced one stays shared.
    this.glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.BackSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.glow = new THREE.Mesh(this.geometry, this.glowMaterial);
    this.glow.name = 'selectedCarGlow';
    this.glow.matrixAutoUpdate = false;
    this.glow.frustumCulled = false;
    this.glow.visible = false;
    parent.add(this.glow);

    // Trail: preallocated positions + RGBA colours (alpha fades toward the tail).
    this.trailPos = new Float32Array(TRAIL_POINTS * 3);
    this.trailCol = new Float32Array(TRAIL_POINTS * 4);
    this.trailValid = new Uint8Array(TRAIL_POINTS);
    this.trailGeometry = new THREE.BufferGeometry();
    this.trailPosAttr = new THREE.BufferAttribute(this.trailPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.trailColAttr = new THREE.BufferAttribute(this.trailCol, 4).setUsage(THREE.DynamicDrawUsage);
    this.trailGeometry.setAttribute('position', this.trailPosAttr);
    this.trailGeometry.setAttribute('color', this.trailColAttr);
    this.trailMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    this.trail = new THREE.Line(this.trailGeometry, this.trailMaterial);
    this.trail.name = 'selectedCarTrail';
    this.trail.frustumCulled = false;
    this.trail.visible = false;
    parent.add(this.trail);

    this.labels = new CarLabels(drivers, parent);
    this.extraMeshes = [];          // glTF model: the untinted parts, sharing this.mesh's instanceMatrix
    this.carHeight = WEDGE_HEIGHT;
    this.carScale = 1;             // every car drawn this much bigger (the desktop map view enlarges them)
    this._disposed = false;
    const url = resolveModelUrl();
    if (url) {
      loadCarModel(url, CAR_LENGTH)
        .then((model) => { if (!this._disposed) this._useModel(model); })
        .catch((err) => console.warn('[f1vr] car model failed to load, keeping the wedge:', err));
    }

    // Preallocated temporaries
    this._out = { x: 0, y: 0, z: 0 };
    this._outA = { x: 0, y: 0, z: 0 };
    this._outB = { x: 0, y: 0, z: 0 };
    this._p = new THREE.Vector3();
    this._selP = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._yAxis = new THREE.Vector3(0, 1, 0);
    this.headings = new Float32Array(n);

    this.selectedIndex = -1;
    this._trailSnap = NaN;
    this._data = null;
    this._t = 0;
    this._getPos = (num) => this._data.getPositionAt(num, this._t);
    this._indexByNumber = new Map(drivers.map((d, i) => [d.number, i]));
  }

  /**
   * Highlights one car: bigger, pulsing glow, 5 s fading trail in team colour.
   * @param {number|null} driverNumber
   */
  setSelected(driverNumber) {
    const i = this._indexByNumber.get(driverNumber);
    this.selectedIndex = i === undefined ? -1 : i;
    this._trailSnap = NaN; // force trail rebuild
    if (this.selectedIndex >= 0) this.glowMaterial.color.copy(this.teamColors[this.selectedIndex]);
    else { this.glow.visible = false; this.trail.visible = false; }
  }

  /**
   * Positions every car at session time t (ms). Allocation-free.
   * @param {import('../session-data.js').SessionData} data
   * @param {number} t
   * @param {THREE.Camera} [camera]  viewing camera, for the 4 Hz label declutter
   */
  update(data, t, camera) {
    const toScene = this.transform.toScene;
    const out = this._out, p = this._p, q = this._q, s = this._s, m = this._m;
    const sel = this.selectedIndex;
    let selVisible = false;

    for (let i = 0; i < this.count; i++) {
      const num = this.drivers[i].number;
      if (!data.getCarPositionAt(num, t, out)) {
        this.mesh.setMatrixAt(i, this._zero);
        this.labels.setLabel(i, false, 0, 0, 0);
        continue;
      }
      toScene(out.x, out.y, out.z, p);
      p.y += CAR_LIFT;

      if (data.getCarPositionAt(num, t - HEADING_DT, this._outA) &&
          data.getCarPositionAt(num, t + HEADING_DT, this._outB)) {
        toScene(this._outA.x, this._outA.y, this._outA.z, this._a);
        toScene(this._outB.x, this._outB.y, this._outB.z, this._b);
        const h = headingFromDelta(this._b.x - this._a.x, this._b.z - this._a.z, HEADING_MIN);
        if (h === h) this.headings[i] = h; // not NaN
      }
      q.setFromAxisAngle(this._yAxis, this.headings[i]);
      const k = (i === sel ? SELECTED_SCALE : 1) * this.carScale;
      s.set(k, k, k);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(i, m);
      this.labels.setLabel(i, true, p.x, p.y + this.carHeight * k, p.z, i === sel ? 1.15 : 1);

      if (i === sel) {
        selVisible = true;
        this._selP.copy(p);
        const g = k * 1.22;
        s.set(g, g * 1.15, g);
        this.glow.matrix.compose(p, q, s);
        this.glow.matrixWorldNeedsUpdate = true;
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.labels.commit();

    this.glow.visible = selVisible;
    this._selVisible = selVisible;
    if (selVisible) {
      const now = performance.now();
      this.glowMaterial.opacity = 0.45 + 0.35 * Math.sin(now * 0.008);
      this._updateTrail(data, t);
    } else {
      this.trail.visible = false;
    }

    this._data = data;
    this._t = t;
    this.labels.refresh(this._getPos, performance.now(), camera, sel);
  }

  /**
   * Selected car pose from the last update(), in table-content space.
   * @param {THREE.Vector3} outPos
   * @returns {number} heading in radians (nose = (sin h, 0, cos h)), or NaN when hidden
   */
  getSelectedPose(outPos) {
    if (this.selectedIndex < 0 || !this._selVisible) return NaN;
    outPos.copy(this._selP);
    return this.headings[this.selectedIndex];
  }

  /** Rebuilds the trail from data on each 83 ms tick (so seeks reset it); head follows the car. */
  _updateTrail(data, t) {
    const i = this.selectedIndex;
    const num = this.drivers[i].number;
    const toScene = this.transform.toScene;
    const pos = this.trailPos, col = this.trailCol, valid = this.trailValid;
    const last = TRAIL_POINTS - 1;
    const snap = Math.floor(t / TRAIL_STEP) * TRAIL_STEP;
    const c = this.teamColors[i];

    if (snap !== this._trailSnap) {
      this._trailSnap = snap;
      let firstValid = -1;
      for (let j = 0; j < last; j++) {
        const tj = snap - (last - 1 - j) * TRAIL_STEP;
        const ok = data.getCarPositionAt(num, tj, this._outA);
        valid[j] = ok ? 1 : 0;
        if (ok) {
          toScene(this._outA.x, this._outA.y, this._outA.z, this._a);
          pos[j * 3] = this._a.x; pos[j * 3 + 1] = this._a.y + CAR_LIFT; pos[j * 3 + 2] = this._a.z;
          if (firstValid < 0) firstValid = j;
        } else if (j > 0) {
          // collapse onto the previous point so no stray segment is drawn
          pos[j * 3] = pos[j * 3 - 3]; pos[j * 3 + 1] = pos[j * 3 - 2]; pos[j * 3 + 2] = pos[j * 3 - 1];
        }
        col[j * 4] = c.r; col[j * 4 + 1] = c.g; col[j * 4 + 2] = c.b;
        const f = j / last;
        col[j * 4 + 3] = ok ? 0.9 * f * f : 0;
      }
      // leading invalid points: collapse onto the first valid one (or the car)
      for (let j = 0; j < (firstValid < 0 ? last : firstValid); j++) {
        const src = firstValid < 0 ? -1 : firstValid;
        if (src < 0) { pos[j * 3] = this._selP.x; pos[j * 3 + 1] = this._selP.y; pos[j * 3 + 2] = this._selP.z; }
        else { pos[j * 3] = pos[src * 3]; pos[j * 3 + 1] = pos[src * 3 + 1]; pos[j * 3 + 2] = pos[src * 3 + 2]; }
      }
      this.trailColAttr.needsUpdate = true;
    }
    // head = current car position
    pos[last * 3] = this._selP.x; pos[last * 3 + 1] = this._selP.y; pos[last * 3 + 2] = this._selP.z;
    col[last * 4] = c.r; col[last * 4 + 1] = c.g; col[last * 4 + 2] = c.b; col[last * 4 + 3] = 0.9;
    this.trailColAttr.needsUpdate = true;
    this.trailPosAttr.needsUpdate = true;
    this.trail.visible = true;
  }

  /**
   * Swap the wedge for a loaded model (car-model.js): one InstancedMesh per material, all
   * sharing the first mesh's instanceMatrix, so update() still writes one matrix per car.
   */
  _useModel(model) {
    const n = this.mesh.count;
    const old = this.mesh;
    const [first, ...rest] = model.parts;
    const main = new THREE.InstancedMesh(first.geometry, first.material, n);
    main.name = 'cars';
    main.frustumCulled = false;
    main.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    main.instanceMatrix.array.set(old.instanceMatrix.array);
    if (first.tint) {
      for (let i = 0; i < n; i++) main.setColorAt(i, this.teamColors[i]);
      main.instanceColor.needsUpdate = true;
    }
    this.parent.add(main);
    for (const p of rest) {
      const m = new THREE.InstancedMesh(p.geometry, p.material, n);
      m.name = 'cars-part';
      m.frustumCulled = false;
      m.instanceMatrix = main.instanceMatrix; // shared: uploaded once per frame
      this.parent.add(m);
      this.extraMeshes.push(m);
    }
    old.removeFromParent();
    old.dispose?.();
    this.geometry.dispose();
    this.material.dispose();
    this.mesh = main;
    this.geometry = model.shell;          // the glow shell follows the model's outline
    this.glow.geometry = model.shell;
    this.material = first.material;
    this._parts = model.parts;
    this.carHeight = model.height;
    this.modelTriangles = model.triangles;
  }

  dispose() {
    this._disposed = true;
    for (const m of this.extraMeshes) { m.removeFromParent(); m.dispose?.(); }
    if (this._parts) for (const p of this._parts) { p.geometry.dispose(); p.material.dispose(); }
    this.mesh.removeFromParent();
    this.glow.removeFromParent();
    this.trail.removeFromParent();
    this.mesh.dispose?.();
    this.geometry.dispose();
    this.material.dispose();
    this.glowMaterial.dispose();
    this.trailGeometry.dispose();
    this.trailMaterial.dispose();
    this.labels.dispose();
  }
}
