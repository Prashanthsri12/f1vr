// Track camera framing shared by the desktop track view (track-view.js) and the track tile of
// Screen in VR (vr-screen.js). Table-local metres: the track (1.4 m) is centred on the origin.
import * as THREE from 'three';

/** 2D: a narrow lens straight down (reads as a flat map). 3D: a tilted wider lens. */
export const VIEWS = {
  '2d': { fov: 10, polar: 0, minPolar: 0, maxPolar: 0, carScale: 1.8 },
  '3d': { fov: 40, polar: 0.85, minPolar: 0, maxPolar: 1.35, carScale: 1.3 },
};
export const FIT_RADIUS = 0.78;  // metres: the track plus a margin

/**
 * Camera distance that fits the track at this field of view and aspect (width / height).
 * @param {number} fovDeg vertical field of view
 * @param {number} aspect
 */
export function fitDistance(fovDeg, aspect) {
  return FIT_RADIUS / Math.tan(THREE.MathUtils.degToRad(fovDeg / 2)) / Math.min(1, aspect);
}

/**
 * Frame the track: fov, position and orientation for `view` (looking at the origin; "up" on
 * screen is -Z). Updates the projection.
 * @param {THREE.PerspectiveCamera} camera
 * @param {'2d'|'3d'} view
 * @param {number} aspect
 * @returns {number} the camera distance
 */
export function frameTrack(camera, view, aspect) {
  const v = VIEWS[view] || VIEWS['2d'];
  camera.fov = v.fov;
  camera.aspect = aspect;
  camera.near = 0.01;
  camera.far = 100;
  camera.updateProjectionMatrix();
  const d = fitDistance(v.fov, aspect);
  const p = Math.max(1e-4, v.polar);
  camera.position.set(0, d * Math.cos(p), d * Math.sin(p));
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return d;
}

/**
 * Label size (CarLabels.setSize angularSize) for labels `px` tall in a view `viewPx` tall.
 * @param {number} px
 * @param {number} viewPx
 * @param {number} fovDeg
 */
export function labelAngularSize(px, viewPx, fovDeg) {
  return (px / Math.max(1, viewPx)) * 2 * Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
}
