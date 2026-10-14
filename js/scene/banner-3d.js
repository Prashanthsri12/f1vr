// Race moment banner in VR (9.11): a slanted slab drawn once per moment into a canvas
// texture. It appears 1.7 m ahead of where the user is looking when it fires (then stays
// put: it never follows the head), fades and grows in, holds, and fades out. No sliding
// across the view, for comfort. One draw call; update() only sets opacity and scale.
// 10.8: a slanted tag in the moment's colour with a white border and a soft halo.
import * as THREE from 'three';
import { bannerStyle, BANNER_MS } from '../banner-style.js';

const W = 1536, H = 300;
const WIDTH_M = 1.3;
const DIST = 1.7;
const RISE = 0.3;      // above eye height
const IN_MS = 260, OUT_MS = 420;
const FONT = "'Titillium Web', system-ui, sans-serif";

export function createBanner3d(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(WIDTH_M, WIDTH_M * H / W);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'raceBanner';
  mesh.renderOrder = 20;
  mesh.visible = false;
  scene.add(mesh);
  let start = -Infinity;
  const fwd = new THREE.Vector3();
  const target = new THREE.Vector3();

  function draw(ev) {
    const st = bannerStyle(ev.kind);
    g.clearRect(0, 0, W, H);
    g.save();
    g.translate(W / 2, H / 2);
    g.transform(1, 0, -0.2, 1, 0, 0); // slant (skewX)
    const sw = W * 0.86, sh = H * 0.66;
    const glow = st.bg === 'check' ? '#ffffff' : st.bg;
    g.fillStyle = glow;
    g.globalAlpha = 0.25;
    g.beginPath();
    g.roundRect(-sw / 2 - 18, -sh / 2 - 18, sw + 36, sh + 36, 30);
    g.fill();
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.roundRect(-sw / 2, -sh / 2, sw, sh, 14);
    g.fill();
    const b = 9; // white border
    g.beginPath();
    g.roundRect(-sw / 2 + b, -sh / 2 + b, sw - 2 * b, sh - 2 * b, 8);
    g.clip();
    if (st.bg === 'check') {
      const c = 30;
      for (let x = -sw / 2; x < sw / 2; x += c) {
        for (let y = -sh / 2; y < sh / 2; y += c) {
          g.fillStyle = (Math.round((x + sw) / c) + Math.round((y + sh) / c)) % 2 ? '#0b0b0b' : '#ffffff';
          g.fillRect(x, y, c, c);
        }
      }
      g.fillStyle = 'rgba(11,11,11,0.86)';
      g.fillRect(-sw * 0.36, -sh / 2 + 22, sw * 0.72, sh - 44);
    } else {
      g.fillStyle = st.bg;
      g.fillRect(-sw / 2, -sh / 2, sw, sh);
    }
    g.restore();
    g.fillStyle = st.fg;
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.font = `italic 900 92px ${FONT}`;
    g.fillText(String(ev.title).toUpperCase(), W / 2, H / 2 + 8);
    g.font = `700 36px ${FONT}`;
    g.globalAlpha = 0.92;
    g.fillText(String(ev.sub).toUpperCase(), W / 2, H / 2 + 60);
    g.globalAlpha = 1;
    tex.needsUpdate = true;
  }

  return {
    /**
     * @param {{kind: string, title: string, sub: string}} ev
     * @param {THREE.Camera} camera the viewing camera (XR camera when presenting)
     */
    show(ev, camera) {
      draw(ev);
      camera.getWorldPosition(target);
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      mesh.position.copy(target).addScaledVector(fwd, DIST);
      mesh.position.y = target.y + RISE;
      target.y = mesh.position.y;
      mesh.lookAt(target);
      start = performance.now();
      mesh.visible = true;
    },
    update() {
      if (!mesh.visible) return;
      const e = performance.now() - start;
      if (e >= BANNER_MS) { mesh.visible = false; return; }
      let a = 1;
      if (e < IN_MS) a = e / IN_MS;
      else if (e > BANNER_MS - OUT_MS) a = (BANNER_MS - e) / OUT_MS;
      mat.opacity = a;
      const k = 0.92 + 0.08 * Math.min(1, e / IN_MS);
      mesh.scale.set(k, k, 1);
    },
    dispose() {
      mesh.removeFromParent();
      geo.dispose(); mat.dispose(); tex.dispose();
    },
  };
}
