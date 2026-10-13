// Rain in the pit wall room (9.7): faint falling streaks while OpenF1 weather reports rainfall.
// One LineSegments draw call; the fall is computed in the vertex shader from a time uniform,
// so update() only writes two uniforms (no per-frame allocation). Streaks stay out of a
// 1.3 m column around the start position so nothing falls right in front of the user's face.
import * as THREE from 'three';

const COUNT = 700;
const AREA = 7.6;       // metres, inside the 8 m room
const TOP = 3.3;        // just under the ceiling
const CLEAR_R = 1.3;    // no streaks closer than this to the user's start position
const SPEED = 5.5;      // m/s
const LENGTH = 0.22;    // streak length, metres
const FADE_S = 2;       // fade in / out time
const WRAP_S = (TOP / SPEED) * 1000; // a whole number of fall cycles, so the wrap is seamless

const VERT = /* glsl */`
  uniform float uTime;
  attribute float aEnd;   // 0 = streak top, 1 = bottom
  attribute float aPhase; // 0..1 start offset
  varying float vEnd;
  void main() {
    vec3 p = position;
    float fall = mod(aPhase * ${TOP.toFixed(2)} + uTime * ${SPEED.toFixed(2)}, ${TOP.toFixed(2)});
    p.y = ${TOP.toFixed(2)} - fall - aEnd * ${LENGTH.toFixed(2)};
    vEnd = aEnd;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }`;

const FRAG = /* glsl */`
  uniform float uAlpha;
  varying float vEnd;
  void main() {
    gl_FragColor = vec4(0.72, 0.82, 1.0, uAlpha * (0.15 + 0.35 * vEnd));
  }`;

/** Deterministic pseudo-random in [0, 1) (no Math.random so the layout is stable). */
function hash(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export function createRain() {
  const pos = new Float32Array(COUNT * 2 * 3);
  const end = new Float32Array(COUNT * 2);
  const phase = new Float32Array(COUNT * 2);
  for (let i = 0, k = 0; i < COUNT; k++) {
    const x = (hash(k * 3 + 1) - 0.5) * AREA;
    const z = (hash(k * 3 + 2) - 0.5) * AREA;
    if (x * x + z * z < CLEAR_R * CLEAR_R) continue;
    const ph = hash(k * 3 + 3);
    for (let j = 0; j < 2; j++) {
      const v = i * 2 + j;
      pos[v * 3] = x; pos[v * 3 + 1] = 0; pos[v * 3 + 2] = z;
      end[v] = j;
      phase[v] = ph;
    }
    i++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  // Static bounds covering the whole fall (positions are rewritten in the shader).
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, TOP / 2, 0), AREA);
  const uniforms = { uTime: { value: 0 }, uAlpha: { value: 0 } };
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, uniforms,
    transparent: true, depthWrite: false, fog: false,
  });
  const object = new THREE.LineSegments(geo, material);
  object.name = 'rain';
  object.frustumCulled = false;
  object.visible = false;
  let alpha = 0;

  return {
    object,
    /**
     * @param {number} dt seconds
     * @param {boolean} raining weather says rainfall at the playhead
     * @param {boolean} allowed the room is shown (not passthrough)
     */
    update(dt, raining, allowed) {
      const target = raining && allowed ? 1 : 0;
      alpha += Math.sign(target - alpha) * Math.min(Math.abs(target - alpha), dt / FADE_S);
      object.visible = alpha > 0.001;
      if (!object.visible) return;
      uniforms.uAlpha.value = alpha;
      uniforms.uTime.value = (uniforms.uTime.value + dt) % WRAP_S;
    },
    dispose() {
      geo.dispose();
      material.dispose();
      if (object.parent) object.parent.remove(object);
    },
  };
}
