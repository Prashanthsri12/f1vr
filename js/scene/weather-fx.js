// 3D weather over the track table (13.10), from the weather model (13.7):
//   - clouds: soft blobs floating above the track (one InstancedMesh), as many as the cloud
//     estimate, darker when it rains, drifting with the wind and wrapping round
//   - rain: falling streaks (one LineSegments) over the track, density and speed by the rain
//     level (est.), slanted by the wind; a few more when the track is wet but it isn't raining
//     is not shown (spray is not modelled)
//   - light: the table's sun and sky light follow the time of day (warm and low at dusk, dim
//     and blue at night, flat under overcast); the clear colour too where the caller owns it
// Wind direction on the table assumes the map's +y is north: OpenF1 location data has no
// documented orientation, so this is approximate. Everything is a child of the table, so it
// shows wherever the table does (desktop 3D view, VR table, Screen in VR track tile).
// update() is allocation-free; two draw calls when visible.
import * as THREE from 'three';

const MAX_CLOUDS = 9;
const MAX_DROPS = 900;
const AREA = 0.75;        // half-size of the box over the track (table-local metres)
const TOP = 0.42, BOTTOM = 0.0;
const CLOUD_Y = 0.36;

function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  for (const [x, y, r] of [[64, 70, 40], [42, 62, 28], [88, 60, 30], [60, 50, 30], [80, 78, 26], [44, 80, 24]]) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * @param {THREE.Object3D} table the track table group
 * @returns {{group: THREE.Group, update: (dt: number, w: object|null, on: boolean) => void,
 *   light: (hemi: THREE.HemisphereLight|null, sun: THREE.DirectionalLight|null, w: object|null, base?: {hemi: number, sun: number}) => void,
 *   clearColour: (out: THREE.Color, w: object|null, base: THREE.Color) => THREE.Color, dispose: () => void}}
 */
export function createWeatherFx(table) {
  const group = new THREE.Group();
  group.name = 'weatherFx';
  table.add(group);

  // Clouds: horizontal soft quads, tilted a little toward the viewer side.
  const tex = cloudTexture();
  const cloudGeo = new THREE.PlaneGeometry(0.34, 0.24);
  cloudGeo.rotateX(-Math.PI / 2);
  const cloudMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.55, color: 0xffffff, toneMapped: false });
  const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, MAX_CLOUDS);
  clouds.name = 'weatherClouds';
  clouds.renderOrder = 5;
  clouds.frustumCulled = false;
  group.add(clouds);
  const cx = new Float32Array(MAX_CLOUDS), cz = new Float32Array(MAX_CLOUDS), cs = new Float32Array(MAX_CLOUDS), cyy = new Float32Array(MAX_CLOUDS);
  for (let i = 0; i < MAX_CLOUDS; i++) {
    cx[i] = -AREA + (2 * AREA * (i + 0.5)) / MAX_CLOUDS + (Math.random() - 0.5) * 0.1;
    cz[i] = (Math.random() - 0.5) * 2 * AREA * 0.85;
    cs[i] = 0.8 + Math.random() * 0.7;
    cyy[i] = CLOUD_Y + (Math.random() - 0.5) * 0.06;
  }
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();

  // Rain: line segments, positions rewritten in place.
  const pos = new Float32Array(MAX_DROPS * 6);
  const rx = new Float32Array(MAX_DROPS), ry = new Float32Array(MAX_DROPS), rz = new Float32Array(MAX_DROPS);
  for (let i = 0; i < MAX_DROPS; i++) {
    rx[i] = (Math.random() * 2 - 1) * AREA;
    ry[i] = BOTTOM + Math.random() * (TOP - BOTTOM);
    rz[i] = (Math.random() * 2 - 1) * AREA;
  }
  const rainGeo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(pos, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  rainGeo.setAttribute('position', attr);
  rainGeo.setDrawRange(0, 0);
  const rainMat = new THREE.LineBasicMaterial({ color: 0x9fd6ff, transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false });
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.name = 'weatherRain';
  rain.frustumCulled = false;
  group.add(rain);

  const tmpColour = new THREE.Color();
  const dusk = new THREE.Color(0xffb36b);
  const day = new THREE.Color(0xdfe8ff);
  const night = new THREE.Color(0x6f86c9);

  return {
    group,
    /**
     * @param {number} dt seconds
     * @param {object|null} w weather model output (newWeather / weatherAt)
     * @param {boolean} on weather effects wanted here (setting and view)
     */
    update(dt, w, on) {
      group.visible = !!(on && w && w.ok);
      if (!group.visible) return;
      if (dt > 0.1) dt = 0.1;
      // Wind: where it blows to, on the table (+x east, −z north).
      const to = ((w.windDir + 180) % 360) * Math.PI / 180;
      const wx = Math.sin(to), wz = -Math.cos(to);
      const breeze = 0.006 + Math.min(w.windSpeed, 10) * 0.004;

      // Clouds
      const n = Math.round(w.cloud * MAX_CLOUDS);
      clouds.count = n;
      const shade = w.rainfall ? 0.55 : 0.75 + 0.25 * w.daylight;
      cloudMat.color.setRGB(shade, shade, shade * 1.04);
      cloudMat.opacity = 0.35 + 0.3 * w.cloud;
      for (let i = 0; i < n; i++) {
        cx[i] += wx * breeze * dt;
        cz[i] += wz * breeze * dt;
        if (cx[i] > AREA + 0.2) cx[i] -= 2 * AREA + 0.4; else if (cx[i] < -AREA - 0.2) cx[i] += 2 * AREA + 0.4;
        if (cz[i] > AREA + 0.2) cz[i] -= 2 * AREA + 0.4; else if (cz[i] < -AREA - 0.2) cz[i] += 2 * AREA + 0.4;
        p.set(cx[i], cyy[i], cz[i]);
        s.set(cs[i] * (1 + w.cloud * 0.4), 1, cs[i]);
        m4.compose(p, q, s);
        clouds.setMatrixAt(i, m4);
      }
      clouds.instanceMatrix.needsUpdate = n > 0;

      // Rain
      const drops = w.rainfall ? Math.round(MAX_DROPS * (0.25 + 0.75 * w.rainLevel)) : 0;
      rainGeo.setDrawRange(0, drops * 2);
      if (drops) {
        const fall = (0.9 + 0.8 * w.rainLevel) * dt;
        const side = Math.min(w.windSpeed, 8) * 0.03;
        const len = 0.03 + 0.03 * w.rainLevel;
        for (let i = 0; i < drops; i++) {
          ry[i] -= fall;
          rx[i] += wx * side * dt;
          rz[i] += wz * side * dt;
          if (ry[i] < BOTTOM) { ry[i] += TOP - BOTTOM; rx[i] = (Math.random() * 2 - 1) * AREA; rz[i] = (Math.random() * 2 - 1) * AREA; }
          const k = i * 6;
          pos[k] = rx[i]; pos[k + 1] = ry[i]; pos[k + 2] = rz[i];
          pos[k + 3] = rx[i] - wx * side * len * 3; pos[k + 4] = ry[i] + len; pos[k + 5] = rz[i] - wz * side * len * 3;
        }
        attr.needsUpdate = true;
        rainMat.opacity = 0.35 + 0.3 * w.rainLevel;
      }
    },
    /**
     * Time of day on the table's lights: intensity by daylight and cloud, colour from night blue
     * through warm dusk to day white, the sun from its rough bearing and height.
     */
    light(hemi, sun, w, base = { hemi: 1.1, sun: 1.2 }) {
      if (!w || !w.ok) return;
      const d = w.daylight;
      const overcast = w.cloud;
      if (hemi) hemi.intensity = base.hemi * (0.45 + 0.55 * d) * (1 - 0.15 * overcast);
      if (sun) {
        sun.intensity = base.sun * (0.25 + 0.75 * d) * (1 - 0.6 * overcast);
        const low = d > 0 ? 1 - Math.min(1, Math.max(0, w.sunElevation) / 25) : 0;
        tmpColour.copy(night).lerp(day, d).lerp(dusk, d * low * 0.7);
        sun.color.copy(tmpColour);
        const el = Math.max(12, w.sunElevation) * Math.PI / 180; // keep shading readable at night (moonlight)
        const az = w.sunAzimuth * Math.PI / 180;
        sun.position.set(Math.sin(az) * Math.cos(el) * 4, Math.sin(el) * 4, -Math.cos(az) * Math.cos(el) * 4);
      }
    },
    /** A clear colour for an owned background: `base` dimmed toward night and greyed by cloud. */
    clearColour(out, w, base) {
      out.copy(base);
      if (!w || !w.ok) return out;
      const d = w.daylight;
      out.lerp(night, 0.08 * (1 - d));
      out.multiplyScalar(0.75 + 0.35 * d * (1 - 0.4 * w.cloud));
      return out;
    },
    dispose() {
      group.removeFromParent();
      cloudGeo.dispose(); cloudMat.dispose(); tex.dispose();
      rainGeo.dispose(); rainMat.dispose(); clouds.dispose();
    },
  };
}
