// Room themes (4b.4). Every theme is fully enclosed: the session is always immersive-ar,
// where three.js clears with alpha 0 and scene.background never draws, so only real
// geometry hides passthrough in pit wall mode. Procedural only (no image assets),
// static matrices, ≤15 draw calls per theme.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const THEMES = ['pitwall', 'studio', 'night'];

const ROOM = 8;              // metres, square room centred on the start position
const HALF = ROOM / 2;
const CEILING = 3.4;         // above the ticker (top ≈ 2.5 m)
const WALL_HEIGHT = 1.2;     // the low pit wall counters
const WALL_THICK = 0.08;
const ACCENT_RED = 0xff2d3d;
const STRIP_BLUE = 0x8fb3d9;

/**
 * @param {string} theme one of THEMES (unknown names fall back to 'pitwall')
 * @returns {{group: THREE.Group, dispose: () => void, theme: string, background: number,
 *   fog: {color: number, near: number, far: number}}}
 */
export function buildRoom(theme) {
  const name = THEMES.includes(theme) ? theme : 'pitwall';
  const group = new THREE.Group();
  group.name = `room:${name}`;
  const disposables = [];
  const kit = {
    track(o) { disposables.push(o); return o; },
    add(o) { o.updateMatrix(); o.matrixAutoUpdate = false; group.add(o); return o; },
  };
  const look = BUILDERS[name](kit);
  return {
    group,
    theme: name,
    ...look,
    dispose() { for (const d of disposables) d.dispose(); },
  };
}

/**
 * Inward-facing box (floor, four walls, ceiling) in one draw call. Vertex colours shade
 * the floor, walls (bottom → top gradient) and ceiling.
 */
function enclosure(kit, { floor, wallLow, wallHigh, ceiling, height = CEILING, size = ROOM }) {
  const geo = kit.track(new THREE.BoxGeometry(size, height, size));
  geo.translate(0, height / 2 - 0.005, 0); // floor just under the grid / floor plates
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const cF = new THREE.Color(floor);
  const cL = new THREE.Color(wallLow);
  const cH = new THREE.Color(wallHigh);
  const cC = new THREE.Color(ceiling);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const ny = nrm.getY(i);            // box normals point out: top face = ceiling, bottom = floor
    if (ny > 0.5) c.copy(cC);
    else if (ny < -0.5) c.copy(cF);
    else c.copy(cL).lerp(cH, pos.getY(i) / height);
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = kit.track(new THREE.MeshStandardMaterial({
    vertexColors: true, side: THREE.BackSide, roughness: 0.92, metalness: 0.05,
  }));
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'enclosure';
  return kit.add(mesh);
}

/** One mesh from several boxes ({w,h,d,x,y,z,ry}) sharing a material: 1 draw call. */
function boxes(kit, specs, material) {
  const parts = specs.map((s) => {
    const g = new THREE.BoxGeometry(s.w, s.h, s.d);
    if (s.ry) g.rotateY(s.ry);
    g.translate(s.x, s.y, s.z);
    return g;
  });
  const geo = kit.track(mergeGeometries(parts));
  for (const p of parts) p.dispose();
  return kit.add(new THREE.Mesh(geo, kit.track(material)));
}

/** The four low pit wall counters (the original room) as one mesh. */
function lowWalls(kit, material, inset = 0) {
  const r = HALF - inset;
  const specs = [];
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    specs.push({ w: 2 * r, h: WALL_HEIGHT, d: WALL_THICK, x: -Math.sin(a) * r, y: WALL_HEIGHT / 2, z: -Math.cos(a) * r, ry: a });
  }
  return boxes(kit, specs, material);
}

/** Thin strips along the top of each wall, at height y, `r` from the centre. */
function wallStrips(kit, y, r, thick, material, sides = [0, 1, 2, 3]) {
  const specs = sides.map((i) => {
    const a = (i * Math.PI) / 2;
    return { w: 2 * r - 0.2, h: thick, d: 0.03, x: -Math.sin(a) * r, y, z: -Math.cos(a) * r, ry: a };
  });
  return boxes(kit, specs, material);
}

const BUILDERS = {
  /** The original pit wall room, enclosed: dark garage walls up to a lit ceiling. ~8 draw calls. */
  pitwall(kit) {
    enclosure(kit, { floor: 0x0c0e12, wallLow: 0x1a1f28, wallHigh: 0x2a3140, ceiling: 0x161a22 });
    const grid = new THREE.GridHelper(ROOM, 16, 0x2a3442, 0x1a2029);
    grid.position.y = 0.002;
    grid.material.transparent = true;
    grid.material.opacity = 0.6;
    kit.track(grid.geometry); kit.track(grid.material);
    kit.add(grid);
    lowWalls(kit, new THREE.MeshStandardMaterial({ color: 0x161a21, roughness: 0.8, metalness: 0.1 }));
    const blue = new THREE.MeshBasicMaterial({ color: STRIP_BLUE });
    // Counter-top strips: red on the front wall only, blue elsewhere, plus a low front strip.
    wallStrips(kit, WALL_HEIGHT - 0.05, HALF - WALL_THICK, 0.025, new THREE.MeshBasicMaterial({ color: ACCENT_RED }), [0]);
    const r = HALF - WALL_THICK;
    boxes(kit, [
      ...[1, 2, 3].map((i) => {
        const a = (i * Math.PI) / 2;
        return { w: ROOM - 0.2, h: 0.025, d: 0.03, x: -Math.sin(a) * r, y: WALL_HEIGHT - 0.05, z: -Math.cos(a) * r, ry: a };
      }),
      { w: ROOM - 0.2, h: 0.025, d: 0.03, x: 0, y: 0.06, z: -r },
    ], blue);
    // Overhead light bars (garage ceiling).
    boxes(kit, [-1.6, 0, 1.6].map((x) => ({ w: 0.12, h: 0.03, d: ROOM - 1.2, x, y: CEILING - 0.02, z: 0 })),
      new THREE.MeshBasicMaterial({ color: 0xcfd8e6 }));
    return { background: 0x07090d, fog: { color: 0x07090d, near: 6, far: 16 } };
  },

  /** Dark broadcast studio: glossy floor, LED strips on every room edge. ~5 draw calls. */
  studio(kit) {
    enclosure(kit, { floor: 0x050608, wallLow: 0x0c0e14, wallHigh: 0x141824, ceiling: 0x08090d });
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ROOM - 0.02, ROOM - 0.02),
      new THREE.MeshStandardMaterial({ color: 0x0a0c11, roughness: 0.25, metalness: 0.6 }),
    );
    kit.track(floor.geometry); kit.track(floor.material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.001;
    kit.add(floor);
    const e = 0.025;     // LED thickness
    const r = HALF - e;
    const edge = [];
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      const x = -Math.sin(a) * r;
      const z = -Math.cos(a) * r;
      edge.push({ w: ROOM - 2 * e, h: e, d: e, x, y: e, z, ry: a });                 // floor edge
      edge.push({ w: ROOM - 2 * e, h: e, d: e, x, y: CEILING - e, z, ry: a });       // ceiling edge
      const cx = (i & 1 ? 1 : -1) * r;
      const cz = (i & 2 ? 1 : -1) * r;
      edge.push({ w: e, h: CEILING, d: e, x: cx, y: CEILING / 2, z: cz });           // corner
    }
    boxes(kit, edge, new THREE.MeshBasicMaterial({ color: 0x3fb8ff }));
    // Red accent: a horizontal band across the front wall at eye level and a floor arc line.
    boxes(kit, [
      { w: ROOM - 0.6, h: 0.012, d: e, x: 0, y: 0.75, z: -r },
      { w: ROOM - 0.6, h: 0.012, d: e, x: 0, y: CEILING - 0.35, z: -r },
    ], new THREE.MeshBasicMaterial({ color: ACCENT_RED }));
    return { background: 0x040507, fog: { color: 0x040507, near: 7, far: 18 } };
  },

  /** Night paddock: gradient sky dome with stars, a distant skyline glow, low walls. ~7 draw calls. */
  night(kit) {
    const R = 40;
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(R, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color(0x02030a) },
          mid: { value: new THREE.Color(0x0b1430) },
          glow: { value: new THREE.Color(0x3a2a3a) },
        },
        vertexShader: 'varying float vY; void main() { vY = normalize(position).y; '
          + 'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 glow; varying float vY; void main() { '
          + 'vec3 c = mix(mid, top, smoothstep(0.05, 0.6, vY)); c = mix(glow, c, smoothstep(-0.02, 0.12, vY)); '
          + 'gl_FragColor = vec4(c, 1.0); }',
      }),
    );
    kit.track(dome.geometry); kit.track(dome.material);
    dome.renderOrder = -1;
    kit.add(dome);
    // Stars: fixed pseudo-random points on the upper dome (deterministic, no per-frame work).
    const N = 400;
    const starPos = new Float32Array(N * 3);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < N; i++) {
      const az = rnd() * Math.PI * 2;
      const el = 0.15 + rnd() * 1.35;
      const rr = R * 0.95;
      starPos[i * 3] = rr * Math.cos(el) * Math.cos(az);
      starPos[i * 3 + 1] = rr * Math.sin(el);
      starPos[i * 3 + 2] = rr * Math.cos(el) * Math.sin(az);
    }
    const starGeo = kit.track(new THREE.BufferGeometry());
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    kit.add(new THREE.Points(starGeo, kit.track(new THREE.PointsMaterial({
      color: 0xc8d4ff, size: 0.12, sizeAttenuation: true, fog: false,
    }))));
    // Ground disc out to the dome: dark asphalt.
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(R * 0.98, 48),
      new THREE.MeshStandardMaterial({ color: 0x0a0b0e, roughness: 0.95 }),
    );
    kit.track(ground.geometry); kit.track(ground.material);
    ground.rotation.x = -Math.PI / 2;
    kit.add(ground);
    // Distant skyline silhouettes (one mesh) and their lit windows (one mesh).
    const towers = [];
    const lights = [];
    for (let i = 0; i < 48; i++) {
      const az = (i / 48) * Math.PI * 2 + rnd() * 0.05;
      const dist = 26 + rnd() * 8;
      const h = 1.5 + rnd() * rnd() * 9;
      const w = 1.2 + rnd() * 2.5;
      const x = Math.cos(az) * dist;
      const z = Math.sin(az) * dist;
      towers.push({ w, h, d: w, x, y: h / 2, z, ry: -az });
      if (rnd() > 0.35) lights.push({ w: w * 0.6, h: 0.08, d: w * 1.02, x, y: h * (0.4 + rnd() * 0.45), z, ry: -az });
    }
    boxes(kit, towers, new THREE.MeshBasicMaterial({ color: 0x05060a, fog: false }));
    boxes(kit, lights, new THREE.MeshBasicMaterial({ color: 0xffc77a, fog: false }));
    // Low pit wall counters with a red top strip at the front.
    lowWalls(kit, new THREE.MeshStandardMaterial({ color: 0x14171e, roughness: 0.8, metalness: 0.1 }));
    wallStrips(kit, WALL_HEIGHT - 0.05, HALF - WALL_THICK, 0.025, new THREE.MeshBasicMaterial({ color: ACCENT_RED }));
    return { background: 0x02030a, fog: { color: 0x05070f, near: 8, far: 45 } };
  },
};
