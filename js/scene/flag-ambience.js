// Flag ambience in VR (9.12): the room's red light strips and the track table rim fade to the
// track status colour (yellow, SC / VSC orange, red flag, chequered white) and back to red
// when the track is green. A slow fade, never a flash, and the camera never moves.
import * as THREE from 'three';
import { ACCENT_RED } from './rooms.js';

const FADE_S = 0.8;

export function createFlagAmbience() {
  const normal = new THREE.Color(ACCENT_RED);
  const target = new THREE.Color(ACCENT_RED);
  const cur = new THREE.Color(ACCENT_RED);
  let targetHex = '';

  return {
    /**
     * @param {number} dt seconds
     * @param {string|null} statusColour '#rrggbb' while not green, else null
     * @param {THREE.MeshBasicMaterial|null} accent room accent material (world.getRoomAccent())
     * @param {THREE.MeshStandardMaterial|null} rim table rim material
     */
    update(dt, statusColour, accent, rim) {
      const hex = statusColour || '';
      if (hex !== targetHex) {
        targetHex = hex;
        if (hex) target.setStyle(hex); else target.copy(normal);
      }
      cur.lerp(target, Math.min(1, dt / FADE_S * 3));
      if (accent && !accent.color.equals(cur)) accent.color.copy(cur);
      if (rim && !rim.emissive.equals(cur)) rim.emissive.copy(cur);
    },
  };
}
