// Overtake warnings in VR (13.6): the same stacked toasts as the desktop, drawn into one
// canvas texture (one draw call). When the first warning appears the stack is placed ahead of
// where the user looks, a little to the right and just below eye height, and then it stays put
// (never follows the head) until the stack is empty. render() is called at 10 Hz and redraws
// only when a countdown second, a toast or a done state changes.
import * as THREE from 'three';
import { LEAD_MS, LINGER_MS } from '../overtake-alerts.js';

const MAX = 4;
const W = 720, ROW = 128, H = ROW * MAX;
const WIDTH_M = 0.44;
const DIST = 1.4;
const YAW = 0.42;        // radians to the right of the gaze
const DROP = 0.08;
const FONT = "'Titillium Web', system-ui, sans-serif";

/**
 * @param {THREE.Scene} scene
 * @param {object} data SessionData
 */
export function createOvertakeToasts3d(scene, data) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(WIDTH_M, WIDTH_M * H / W);
  geo.translate(0, -WIDTH_M * H / W / 2, 0); // the stack hangs down from its top edge
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'overtakeToasts';
  mesh.renderOrder = 18;
  mesh.visible = false;
  scene.add(mesh);
  const fwd = new THREE.Vector3();
  const head = new THREE.Vector3();
  let sig = '';
  const drv = (n) => data.driverByNumber.get(n) || { acronym: `#${n}`, teamColour: '#888888' };

  function draw(alerts, time) {
    g.clearRect(0, 0, W, H);
    for (let i = 0; i < alerts.length && i < MAX; i++) {
      const e = alerts[i];
      const a = drv(e.a), b = drv(e.b);
      const y = i * ROW + 6;
      const left = e.t - time;
      const done = left <= 0;
      g.globalAlpha = done && left < -LINGER_MS + 800 ? 0.4 : 1;
      g.fillStyle = '#0f1016';
      g.beginPath(); g.roundRect(4, y, W - 8, ROW - 14, 22); g.fill();
      g.fillStyle = a.teamColour;
      g.beginPath(); g.roundRect(4, y, 14, ROW - 14, [22, 0, 0, 22]); g.fill();
      // Countdown ring
      const cx = 78, cy = y + (ROW - 14) / 2, r = 34;
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(255,255,255,0.14)';
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = done ? a.teamColour : '#2de2ff';
      g.lineCap = 'round';
      const frac = done ? 1 : 1 - Math.min(1, left / LEAD_MS);
      g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); g.stroke();
      g.fillStyle = '#f6f7fa';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `italic 900 30px ${FONT}`;
      g.fillText(done ? '✓' : `${Math.ceil(left / 1000)}s`, cx, cy + 1);
      // Text
      g.textAlign = 'left';
      g.fillStyle = done ? '#f6f7fa' : '#8a8fa0';
      g.font = `700 24px ${FONT}`;
      const headTxt = done ? (e.kind === 'repass' ? `${a.acronym} TAKES IT BACK` : `${a.acronym} TAKES P${e.pos}`)
        : (e.kind === 'repass' ? `RE-PASS · P${e.pos}` : `FIGHT FOR P${e.pos}`);
      g.fillText(headTxt, 136, y + 34);
      g.font = `italic 900 46px ${FONT}`;
      g.fillStyle = a.teamColour;
      g.fillText(a.acronym, 136, y + 78);
      const aw = g.measureText(a.acronym).width;
      g.fillStyle = '#8a8fa0';
      g.font = `700 26px ${FONT}`;
      g.fillText('▶', 136 + aw + 14, y + 78);
      g.font = `italic 900 46px ${FONT}`;
      g.fillStyle = b.teamColour;
      g.fillText(b.acronym, 136 + aw + 50, y + 78);
    }
    g.globalAlpha = 1;
    tex.needsUpdate = true;
  }

  return {
    /**
     * @param {object[]} alerts createOvertakeAlerts().at() result
     * @param {number} time playhead
     * @param {THREE.Camera} camera viewing camera (XR camera when presenting)
     */
    render(alerts, time, camera) {
      if (!alerts.length) { mesh.visible = false; sig = ''; return; }
      let s = '';
      for (let i = 0; i < alerts.length && i < MAX; i++) {
        const left = alerts[i].t - time;
        s += `${alerts[i].t}:${alerts[i].a}:${left > 0 ? Math.ceil(left / 1000) : left < -LINGER_MS + 800 ? 'f' : 'd'}|`;
      }
      if (!mesh.visible) {
        camera.getWorldPosition(head);
        camera.getWorldDirection(fwd);
        fwd.y = 0;
        if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
        fwd.normalize().applyAxisAngle(THREE.Object3D.DEFAULT_UP, -YAW);
        mesh.position.copy(head).addScaledVector(fwd, DIST);
        mesh.position.y = head.y - DROP;
        head.y = mesh.position.y;
        mesh.lookAt(head);
        mesh.visible = true;
      }
      if (s !== sig) { sig = s; draw(alerts, time); }
    },
    dispose() {
      mesh.removeFromParent();
      geo.dispose(); mat.dispose(); tex.dispose();
    },
  };
}
