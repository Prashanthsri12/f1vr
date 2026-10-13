// Pick up a pit wall panel (or the driver picker group) with a ray and carry it.
//  - The point where the ray hit stays on the ray at a fixed distance (0.5–4 m),
//    so the panel follows the pointer without jumping.
//  - The unit turns about the vertical axis so its front (+Z) faces the user.
//  - adjust() pushes it away / pulls it closer (thumbstick, mouse wheel).
//  - scaleBy() resizes it (0.5×–2.5×) about the grab point, so it stays on the ray.
//  - A second pointer that grabs the unit already held stretches it: the scale follows
//    the distance between the two pointers (like the two-hand table grab).
// One carrying grab per unit; a unit can have one extra stretching pointer.
import * as THREE from 'three';

export const MIN_DIST = 0.5;
export const MAX_DIST = 4;
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2.5;
const UP = new THREE.Vector3(0, 1, 0);

const clampScale = (s) => THREE.MathUtils.clamp(s, MIN_SCALE, MAX_SCALE);

/**
 * @param {object} o
 * @param {(panel: object) => (THREE.Object3D|null)} o.getMovable the unit a panel belongs to (null: not movable)
 * @param {() => void} [o.onRelease] a grab ended or a unit was rescaled (save the layout)
 * @returns {{begin: Function, update: Function, adjust: Function, scaleBy: Function, scaleUnit: Function,
 *   end: Function, has: (id: string) => boolean, isHeld: (panel: object) => boolean,
 *   isGrabbing: () => boolean}}
 */
export function createPanelGrab({ getMovable, onRelease }) {
  /** Carrying grabs: id -> { obj, dist, local (grab point, unit-local, unscaled), origin (last ray origin) } */
  const grabs = new Map();
  /** Stretching pointers: id -> { primary (id), origin, d0, s0 } */
  const stretches = new Map();
  const point = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const parentQuat = new THREE.Quaternion();

  function holderOf(obj) {
    for (const [id, g] of grabs) if (g.obj === obj) return id;
    return null;
  }

  /**
   * Start carrying the unit `panel` belongs to, or, if another pointer already carries it,
   * start stretching it with this pointer.
   * @param {string} id pointer id
   * @param {object} panel the hit panel
   * @param {THREE.Vector3} hitPoint world point the ray hit
   * @param {THREE.Vector3} origin world ray origin
   * @returns {boolean} true if a carry or a stretch started
   */
  function begin(id, panel, hitPoint, origin) {
    if (grabs.has(id) || stretches.has(id)) return false;
    const obj = panel ? getMovable(panel) : null;
    if (!obj) return false;
    const holder = holderOf(obj);
    if (holder !== null) {
      for (const s of stretches.values()) if (s.primary === holder) return false;
      const d0 = Math.max(0.02, origin.distanceTo(grabs.get(holder).origin));
      stretches.set(id, { primary: holder, origin: origin.clone(), d0, s0: obj.scale.x });
      return true;
    }
    obj.updateWorldMatrix(true, false);
    const local = obj.worldToLocal(hitPoint.clone());
    const dist = THREE.MathUtils.clamp(origin.distanceTo(hitPoint), MIN_DIST, MAX_DIST);
    grabs.set(id, { obj, dist, local, origin: origin.clone() });
    return true;
  }

  /**
   * Per frame while held (carrying or stretching). Allocation-free.
   * @param {string} id
   * @param {THREE.Vector3} origin world ray origin
   * @param {THREE.Vector3} dir world ray direction (unit)
   * @param {THREE.Vector3} facePos world point the unit should face (the head / camera)
   */
  function update(id, origin, dir, facePos) {
    const st = stretches.get(id);
    if (st) {
      st.origin.copy(origin);
      const g = grabs.get(st.primary);
      if (g) g.obj.scale.setScalar(clampScale(st.s0 * (origin.distanceTo(g.origin) / st.d0)));
      return;
    }
    const g = grabs.get(id);
    if (!g) return;
    g.origin.copy(origin);
    point.copy(origin).addScaledVector(dir, g.dist);
    const yaw = Math.atan2(facePos.x - point.x, facePos.z - point.z);
    quat.setFromAxisAngle(UP, yaw);
    pos.copy(g.local).multiply(g.obj.scale).applyQuaternion(quat);
    pos.subVectors(point, pos);
    const parent = g.obj.parent;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      parent.worldToLocal(pos);
      parent.getWorldQuaternion(parentQuat);
      quat.premultiply(parentQuat.invert());
    }
    g.obj.position.copy(pos);
    g.obj.quaternion.copy(quat);
  }

  /** Push (+) or pull (−) the held unit along the ray. */
  function adjust(id, metres) {
    const g = grabs.get(id);
    if (g) g.dist = THREE.MathUtils.clamp(g.dist + metres, MIN_DIST, MAX_DIST);
  }

  /** Multiply the carried unit's scale (clamped); it grows about the grab point on the next update. */
  function scaleBy(id, factor) {
    const g = grabs.get(id);
    if (g) g.obj.scale.setScalar(clampScale(g.obj.scale.x * factor));
  }

  /**
   * Rescale a unit that is not being carried (desktop Shift + wheel), about its centre.
   * @returns {boolean} true if `panel` belongs to a movable unit
   */
  function scaleUnit(panel, factor) {
    const obj = panel ? getMovable(panel) : null;
    if (!obj) return false;
    obj.scale.setScalar(clampScale(obj.scale.x * factor));
    if (onRelease) onRelease();
    return true;
  }

  function end(id) {
    if (stretches.delete(id)) {
      if (onRelease) onRelease();
      return;
    }
    if (!grabs.delete(id)) return;
    for (const [sid, s] of stretches) if (s.primary === id) stretches.delete(sid);
    if (onRelease) onRelease();
  }

  return {
    begin,
    update,
    adjust,
    scaleBy,
    scaleUnit,
    end,
    has: (id) => grabs.has(id) || stretches.has(id),
    /** True when `panel` belongs to a movable unit. */
    canMove: (panel) => !!(panel && getMovable(panel)),
    /** True when the unit `panel` belongs to is being carried. */
    isHeld: (panel) => {
      const obj = panel ? getMovable(panel) : null;
      return !!obj && holderOf(obj) !== null;
    },
    isGrabbing: () => grabs.size > 0,
  };
}
