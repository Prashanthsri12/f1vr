// Grab the track table with one or two "grabbers" (controller grips or hand pinches).
//  - One grabber: the table follows its translation (it stays level and keeps its yaw).
//  - Two grabbers: scale (0.5x–3x) by hand distance and rotate around the vertical
//    axis by the angle between the hands, pivoting on the point between them
//    (horizontally; the table keeps its height relative to the hands).
//  - Adding or releasing a grabber re-anchors, so switching 1↔2 hands never jumps.
import * as THREE from 'three';

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const UP = new THREE.Vector3(0, 1, 0);

/**
 * @param {THREE.Object3D} table group whose position / rotation.y / uniform scale are driven
 * @returns {{begin: (id: string, source: THREE.Object3D) => void, end: (id: string) => void,
 *   update: () => void, reset: () => void, isGrabbing: () => boolean, has: (id: string) => boolean}}
 */
export function createTableGrab(table) {
  /** id -> pose source (a controller / hand target-ray space; its .position is in world space). */
  const grabbers = new Map();
  const ids = [];                 // insertion order; the first two drive a two-hand grab
  const start = {
    tablePos: new THREE.Vector3(),
    yaw: 0,
    scale: 1,
    anchor: new THREE.Vector3(),  // one hand: its position; two hands: the midpoint
    dist: 1,
    angle: 0,
  };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const offset = new THREE.Vector3();

  function pose(i, out) {
    return out.copy(grabbers.get(ids[i]).position);
  }

  /** Horizontal angle of the vector a→b. */
  function angleOf(p, q) {
    return Math.atan2(q.z - p.z, q.x - p.x);
  }

  function snapshot() {
    start.tablePos.copy(table.position);
    start.yaw = table.rotation.y;
    start.scale = table.scale.x;
    if (ids.length === 1) {
      pose(0, start.anchor);
    } else if (ids.length >= 2) {
      pose(0, a);
      pose(1, b);
      start.anchor.addVectors(a, b).multiplyScalar(0.5);
      start.dist = Math.max(0.02, a.distanceTo(b));
      start.angle = angleOf(a, b);
    }
  }

  function begin(id, source) {
    if (grabbers.has(id)) return;
    grabbers.set(id, source);
    ids.push(id);
    snapshot();
  }

  function end(id) {
    if (!grabbers.delete(id)) return;
    ids.splice(ids.indexOf(id), 1);
    snapshot();
  }

  /** Per frame. Allocation-free. */
  function update() {
    if (ids.length === 0) return;
    if (ids.length === 1) {
      pose(0, a);
      table.position.copy(start.tablePos).add(a).sub(start.anchor);
      return;
    }
    pose(0, a);
    pose(1, b);
    mid.addVectors(a, b).multiplyScalar(0.5);
    const scale = THREE.MathUtils.clamp(start.scale * (a.distanceTo(b) / start.dist), MIN_SCALE, MAX_SCALE);
    const ratio = scale / start.scale;
    // three.js rotation.y turns +X toward -Z, i.e. it *decreases* atan2(z, x).
    let dyaw = -(angleOf(a, b) - start.angle);
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    offset.subVectors(start.tablePos, start.anchor).applyAxisAngle(UP, dyaw);
    offset.x *= ratio;   // scale about the hands horizontally only:
    offset.z *= ratio;   // the table's height relative to the hands stays put
    table.position.copy(mid).add(offset);
    table.rotation.y = start.yaw + dyaw;
    table.scale.setScalar(scale);
  }

  /** Back to the default placement (table.userData.defaultTransform from createTable). */
  function reset() {
    const d = table.userData.defaultTransform;
    if (d) {
      table.position.copy(d.position);
      table.quaternion.copy(d.quaternion);
      table.scale.copy(d.scale);
    }
    snapshot();
  }

  return {
    begin,
    end,
    update,
    reset,
    isGrabbing: () => ids.length > 0,
    has: (id) => grabbers.has(id),
  };
}
