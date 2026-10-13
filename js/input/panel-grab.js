// Pick up a pit wall panel (or the driver picker group) with a ray and carry it.
//  - The point where the ray hit stays on the ray at a fixed distance (0.5–4 m),
//    so the panel follows the pointer without jumping.
//  - The unit turns about the vertical axis so its front (+Z) faces the user.
//  - adjust() pushes it away / pulls it closer (thumbstick, mouse wheel).
// One grab per pointer id; a unit can only be held by one pointer at a time.
import * as THREE from 'three';

export const MIN_DIST = 0.5;
export const MAX_DIST = 4;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * @param {object} o
 * @param {(panel: object) => (THREE.Object3D|null)} o.getMovable the unit a panel belongs to (null: not movable)
 * @param {() => void} [o.onRelease] a grab ended (save the layout)
 * @returns {{begin: Function, update: Function, adjust: Function, end: Function,
 *   has: (id: string) => boolean, isGrabbing: () => boolean}}
 */
export function createPanelGrab({ getMovable, onRelease }) {
  /** id -> { obj, dist, local: Vector3 (grab point in the unit's local space, unscaled) } */
  const grabs = new Map();
  const point = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const parentQuat = new THREE.Quaternion();

  /**
   * Start carrying the unit `panel` belongs to.
   * @param {string} id pointer id
   * @param {object} panel the hit panel
   * @param {THREE.Vector3} hitPoint world point the ray hit
   * @param {THREE.Vector3} origin world ray origin
   * @returns {boolean} true if a grab started
   */
  function begin(id, panel, hitPoint, origin) {
    if (grabs.has(id)) return false;
    const obj = panel ? getMovable(panel) : null;
    if (!obj) return false;
    for (const g of grabs.values()) if (g.obj === obj) return false;
    obj.updateWorldMatrix(true, false);
    const local = obj.worldToLocal(hitPoint.clone()).multiply(obj.scale);
    const dist = THREE.MathUtils.clamp(origin.distanceTo(hitPoint), MIN_DIST, MAX_DIST);
    grabs.set(id, { obj, dist, local });
    return true;
  }

  /**
   * Per frame while held. Allocation-free.
   * @param {string} id
   * @param {THREE.Vector3} origin world ray origin
   * @param {THREE.Vector3} dir world ray direction (unit)
   * @param {THREE.Vector3} facePos world point the unit should face (the head / camera)
   */
  function update(id, origin, dir, facePos) {
    const g = grabs.get(id);
    if (!g) return;
    point.copy(origin).addScaledVector(dir, g.dist);
    const yaw = Math.atan2(facePos.x - point.x, facePos.z - point.z);
    quat.setFromAxisAngle(UP, yaw);
    pos.copy(g.local).applyQuaternion(quat);
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

  function end(id) {
    if (!grabs.delete(id)) return;
    if (onRelease) onRelease();
  }

  return {
    begin,
    update,
    adjust,
    end,
    has: (id) => grabs.has(id),
    isGrabbing: () => grabs.size > 0,
  };
}
