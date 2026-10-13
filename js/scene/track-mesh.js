// Track meshes from cached track data (split out of track.js for 9.8).
// Draw calls: ribbon 1, edge lines 1, glow band 1, start/finish 1.
// Neon look (9.8): the edge lines and a soft additive glow band outside each edge take a
// colour per outline sample. setSampleColours() rewrites the colour buffers in place (no
// allocation); track-style.js decides the colours (sectors, mini-sectors or plain).
import * as THREE from 'three';
import { nearestSampleIndex } from './track-math.js';

const EDGE_LIFT = 0.0004;
const GLOW_LIFT = 0.0002;
const GLOW_WIDTH = 0.9;    // × track width, outward from each edge
const GLOW_ALPHA = 0.55;
const PLAIN = [0.36, 0.42, 0.55];

/** Horizontal unit normal (left of travel) at sample i of a closed flat xyz outline. */
export function normalAt(outline, n, i, out) {
  const a = ((i - 1 + n) % n) * 3, b = ((i + 1) % n) * 3;
  let tx = outline[b] - outline[a], tz = outline[b + 2] - outline[a + 2];
  const len = Math.hypot(tx, tz) || 1;
  tx /= len; tz /= len;
  out.x = tz; out.z = -tx; // perpendicular in XZ plane
  out.tx = tx; out.tz = tz;
  return out;
}

/**
 * Ribbon + coloured edges + glow band + start/finish quad.
 * @param {{outline: number[], width: number, start: {x:number, z:number}}} built
 * @returns {THREE.Group} with userData.setSampleColours(rgb: Float32Array(n * 3)) and userData.samples = n
 */
export function buildTrackMeshes(built) {
  const { outline, width } = built;
  const n = outline.length / 3;
  const half = width / 2;
  const glowW = width * GLOW_WIDTH;
  const group = new THREE.Group();
  group.name = 'track';

  // --- ribbon: two vertices per sample, indexed strip, closed ---
  const pos = new Float32Array(n * 2 * 3);
  const nrm = { x: 0, z: 0, tx: 0, tz: 0 };
  // glow band: per sample 4 vertices (outer left, left edge, right edge, outer right)
  const gPos = new Float32Array(n * 4 * 3);
  const gCol = new Float32Array(n * 4 * 4);
  for (let i = 0; i < n; i++) {
    normalAt(outline, n, i, nrm);
    const x = outline[i * 3], y = outline[i * 3 + 1], z = outline[i * 3 + 2];
    pos[i * 6] = x + nrm.x * half; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z + nrm.z * half;
    pos[i * 6 + 3] = x - nrm.x * half; pos[i * 6 + 4] = y; pos[i * 6 + 5] = z - nrm.z * half;
    const gy = y + GLOW_LIFT;
    const offs = [half + glowW, half, -half, -half - glowW];
    for (let k = 0; k < 4; k++) {
      const v = (i * 4 + k) * 3;
      gPos[v] = x + nrm.x * offs[k]; gPos[v + 1] = gy; gPos[v + 2] = z + nrm.z * offs[k];
      gCol[(i * 4 + k) * 4 + 3] = k === 1 || k === 2 ? GLOW_ALPHA : 0;
    }
  }
  const index = [];
  const gIndex = [];
  const edge = new Float32Array(n * 4 * 3); // per segment: left (2 verts) + right (2 verts)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const l0 = i * 2, r0 = i * 2 + 1, l1 = j * 2, r1 = j * 2 + 1;
    index.push(l0, r0, l1, r0, r1, l1);
    const e = i * 12;
    edge[e] = pos[l0 * 3]; edge[e + 1] = pos[l0 * 3 + 1] + EDGE_LIFT; edge[e + 2] = pos[l0 * 3 + 2];
    edge[e + 3] = pos[l1 * 3]; edge[e + 4] = pos[l1 * 3 + 1] + EDGE_LIFT; edge[e + 5] = pos[l1 * 3 + 2];
    edge[e + 6] = pos[r0 * 3]; edge[e + 7] = pos[r0 * 3 + 1] + EDGE_LIFT; edge[e + 8] = pos[r0 * 3 + 2];
    edge[e + 9] = pos[r1 * 3]; edge[e + 10] = pos[r1 * 3 + 1] + EDGE_LIFT; edge[e + 11] = pos[r1 * 3 + 2];
    // glow quads: outer-left band (0,1) and outer-right band (2,3)
    const a = i * 4, b = j * 4;
    gIndex.push(a, a + 1, b, a + 1, b + 1, b);
    gIndex.push(a + 2, a + 3, b + 2, a + 3, b + 3, b + 2);
  }
  const ribbonGeo = new THREE.BufferGeometry();
  ribbonGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  ribbonGeo.setIndex(index);
  ribbonGeo.computeVertexNormals();
  // Winding may face down depending on travel direction; render both sides.
  const ribbonMat = new THREE.MeshStandardMaterial({
    color: 0x262a33, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide, emissive: 0x0e1016,
  });
  const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
  ribbon.name = 'trackRibbon';
  group.add(ribbon);

  const eCol = new Float32Array(n * 4 * 3);
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(edge, 3));
  const eColAttr = new THREE.BufferAttribute(eCol, 3).setUsage(THREE.DynamicDrawUsage);
  edgeGeo.setAttribute('color', eColAttr);
  const edgeMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, toneMapped: false });
  const edges = new THREE.LineSegments(edgeGeo, edgeMat);
  edges.name = 'trackEdges';
  group.add(edges);

  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
  const gColAttr = new THREE.BufferAttribute(gCol, 4).setUsage(THREE.DynamicDrawUsage);
  glowGeo.setAttribute('color', gColAttr);
  glowGeo.setIndex(gIndex);
  const glowMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.name = 'trackGlow';
  glow.renderOrder = 1;
  group.add(glow);

  /** rgb: Float32Array(n * 3), 0..1 per outline sample. */
  function setSampleColours(rgb) {
    for (let i = 0; i < n; i++) {
      const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
      for (let k = 0; k < 4; k++) {
        const e = (i * 4 + k) * 3;
        eCol[e] = r; eCol[e + 1] = g; eCol[e + 2] = b;
        const c = (i * 4 + k) * 4;
        gCol[c] = r; gCol[c + 1] = g; gCol[c + 2] = b;
      }
    }
    eColAttr.needsUpdate = true;
    gColAttr.needsUpdate = true;
  }
  const plain = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { plain[i * 3] = PLAIN[0]; plain[i * 3 + 1] = PLAIN[1]; plain[i * 3 + 2] = PLAIN[2]; }
  setSampleColours(plain);
  group.userData.setSampleColours = setSampleColours;
  group.userData.samples = n;

  // --- start/finish: chequered quad across the ribbon ---
  const si = nearestSampleIndex(outline, built.start.x, built.start.z);
  normalAt(outline, n, si, nrm);
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 8;
  const ctx = canvas.getContext('2d');
  for (let cx = 0; cx < 16; cx++) {
    for (let cy = 0; cy < 2; cy++) {
      ctx.fillStyle = (cx + cy) % 2 ? '#111' : '#fff';
      ctx.fillRect(cx * 4, cy * 4, 4, 4);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const sfGeo = new THREE.PlaneGeometry(width * 1.15, width * 0.18);
  sfGeo.rotateX(-Math.PI / 2); // lie flat; plane's local X spans across the track
  const sfMat = new THREE.MeshBasicMaterial({
    map: tex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const sf = new THREE.Mesh(sfGeo, sfMat);
  sf.name = 'startFinish';
  sf.renderOrder = 2;
  sf.position.set(outline[si * 3], outline[si * 3 + 1] + 0.0006, outline[si * 3 + 2]);
  // rotate so local +X aligns with the across-track normal
  sf.rotation.y = Math.atan2(-nrm.z, nrm.x);
  group.add(sf);

  return group;
}
