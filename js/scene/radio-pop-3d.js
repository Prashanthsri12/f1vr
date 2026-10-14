// Team radio pop-up in VR (11.2): a small card drawn once per clip into a canvas texture.
// Like the race banner it appears ahead of where the user is looking when the clip starts,
// below eye height (the banner sits above), then stays put: it never follows the head.
// It fades in, stays while the clip plays and fades out when it ends. One draw call;
// update() only reads the radio state and sets opacity (no per-frame allocation).
import * as THREE from 'three';
import { getRadioState } from '../audio.js';

const W = 1024, H = 300;
const WIDTH_M = 0.5;
const DIST = 1.5;
const DROP = 0.32;       // below eye height
const IN_MS = 250, OUT_MS = 400;
const MIN_MS = 2500, MAX_MS = 40000;
const FONT = "'Titillium Web', system-ui, sans-serif";

function isLight(hex) {
  const n = parseInt(hex.slice(1, 7), 16) || 0;
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 150;
}

/**
 * @param {THREE.Scene} scene
 * @returns {{show: (info: {colour: string, number: string, name: string, team: string, meta: string, url: string}, camera: THREE.Camera) => void,
 *   update: () => void, dispose: () => void}}
 */
export function createRadioPop3d(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(WIDTH_M, WIDTH_M * H / W);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'radioPop';
  mesh.renderOrder = 19;
  mesh.visible = false;
  scene.add(mesh);
  const fwd = new THREE.Vector3();
  const target = new THREE.Vector3();
  let url = null;
  let start = 0;
  let endAt = Infinity;   // performance.now() when the fade-out started

  function draw(info) {
    g.clearRect(0, 0, W, H);
    const c = info.colour;
    // Card with a team-colour edge and a soft halo.
    g.fillStyle = c; g.globalAlpha = 0.25;
    g.beginPath(); g.roundRect(4, 4, W - 8, H - 8, 40); g.fill();
    g.globalAlpha = 1;
    g.fillStyle = '#0f1016';
    g.beginPath(); g.roundRect(16, 16, W - 32, H - 32, 30); g.fill();
    g.fillStyle = c;
    g.beginPath(); g.roundRect(16, 16, 22, H - 32, [30, 0, 0, 30]); g.fill();
    // Header: red dot, TEAM RADIO, position and lap.
    g.fillStyle = '#e10600';
    g.beginPath(); g.arc(80, 66, 11, 0, Math.PI * 2); g.fill();
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillStyle = '#8a8fa0';
    g.font = `italic 900 34px ${FONT}`;
    g.fillText('TEAM RADIO', 104, 68);
    g.textAlign = 'right';
    g.fillStyle = '#f6f7fa';
    g.fillText(info.meta.toUpperCase(), W - 50, 68);
    // Car-number sticker and name.
    g.font = `italic 900 46px ${FONT}`;
    const nw = Math.max(80, g.measureText(info.number).width + 44);
    g.save();
    g.translate(68 + nw / 2, 146);
    g.rotate(-4 * Math.PI / 180);
    g.fillStyle = '#ffffff';
    g.beginPath(); g.roundRect(-nw / 2, -34, nw, 68, 12); g.fill();
    g.fillStyle = c;
    g.beginPath(); g.roundRect(-nw / 2 + 6, -28, nw - 12, 56, 8); g.fill();
    g.fillStyle = isLight(c) ? '#0a0b10' : '#ffffff';
    g.textAlign = 'center';
    g.fillText(info.number, 0, 2);
    g.restore();
    g.textAlign = 'left';
    g.fillStyle = '#f6f7fa';
    g.font = `italic 900 58px ${FONT}`;
    g.fillText(info.name.toUpperCase(), 68 + nw + 26, 146, W - 68 - nw - 26 - 50);
    g.fillStyle = '#8a8fa0';
    g.font = `700 30px ${FONT}`;
    g.fillText(info.team.toUpperCase(), 68 + nw + 26, 200, W - 68 - nw - 26 - 50);
    // Waveform (static: the card is drawn once).
    g.fillStyle = c;
    const bars = 34, bx = 68, bw = (W - 50 - bx) / bars;
    for (let i = 0; i < bars; i++) {
      const bh = 10 + Math.abs(Math.sin(i * 1.7)) * 34;
      g.beginPath(); g.roundRect(bx + i * bw, 252 - bh / 2, bw - 6, bh, 3); g.fill();
    }
    tex.needsUpdate = true;
  }

  return {
    show(info, camera) {
      draw(info);
      url = info.url;
      camera.getWorldPosition(target);
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      mesh.position.copy(target).addScaledVector(fwd, DIST);
      mesh.position.y = target.y - DROP;
      target.y = mesh.position.y;
      mesh.lookAt(target);
      start = performance.now();
      endAt = Infinity;
      mesh.visible = true;
    },
    update() {
      if (!mesh.visible) return;
      const now = performance.now();
      const e = now - start;
      // Start the fade-out once this clip is no longer the one loaded (ended, failed or replaced).
      if (endAt === Infinity && e > MIN_MS && (getRadioState().url !== url || e > MAX_MS)) endAt = now;
      let a = Math.min(1, e / IN_MS);
      if (endAt !== Infinity) {
        a = Math.min(a, 1 - (now - endAt) / OUT_MS);
        if (a <= 0) { mesh.visible = false; url = null; return; }
      }
      mat.opacity = a;
    },
    dispose() {
      mesh.removeFromParent();
      geo.dispose(); mat.dispose(); tex.dispose();
    },
  };
}
