// Track table and track ribbon (spec §4, CONTRACTS.md `js/scene/track.js`).
// Draw calls: table = 2 (top + rim), track = 3 (ribbon, edge lines, start/finish line),
// + 1 pit lane line when one could be traced (pit-lane.js). A session without usable
// location data gets an empty table with a "no position data" note instead of failing.

import * as THREE from 'three';
import { cacheGet, cachePut } from '../cache.js';
import {
  dedupePoints, trimClosure, computeTransformParams, makeToScene, trackWidth,
  nearestSampleIndex, TARGET_SIZE,
} from './track-math.js';
import { pickPitStop, pitWindow, extractPitLane } from './pit-lane.js';

const TABLE_RADIUS = 0.8;
const TABLE_THICKNESS = 0.03;
const SAMPLES = 500;
const CACHE_VERSION = 1;

/**
 * Creates the track table: a group at (0, 0.9, -1.0) with a dark tabletop disc and a red rim.
 * Track and cars go in `table.userData.content` so moving/scaling the table moves everything.
 * `table.userData.hitMesh` is the tabletop (for raycasting); `table.userData.defaultTransform`
 * holds clones of the initial position/quaternion/scale for reset (re-centre rewrites it;
 * `baseTransform` keeps the original).
 * @param {THREE.Object3D} parent
 * @returns {THREE.Group}
 */
export function createTable(parent) {
  const table = new THREE.Group();
  table.name = 'trackTable';
  table.position.set(0, 0.9, -1.0);

  const topGeo = new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS * 0.97, TABLE_THICKNESS, 48, 1);
  const topMat = new THREE.MeshStandardMaterial({ color: 0x14161b, roughness: 0.85, metalness: 0.2 });
  const tabletop = new THREE.Mesh(topGeo, topMat);
  tabletop.name = 'tabletop';
  tabletop.position.y = -TABLE_THICKNESS / 2; // top surface at table-local y = 0
  table.add(tabletop);

  const rimGeo = new THREE.TorusGeometry(TABLE_RADIUS, 0.005, 6, 64);
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x7a0a0a, emissive: 0xe10600, emissiveIntensity: 0.35, roughness: 0.6,
  });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.name = 'tableRim';
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = -0.002;
  table.add(rim);

  const content = new THREE.Group();
  content.name = 'tableContent';
  table.add(content);

  table.userData.hitMesh = tabletop;
  table.userData.content = content;
  table.userData.baseTransform = {
    position: table.position.clone(),
    quaternion: table.quaternion.clone(),
    scale: table.scale.clone(),
  };
  table.userData.defaultTransform = {
    position: table.position.clone(),
    quaternion: table.quaternion.clone(),
    scale: table.scale.clone(),
  };
  table.userData.dispose = () => {
    topGeo.dispose(); topMat.dispose(); rimGeo.dispose(); rimMat.dispose();
  };

  if (parent) parent.add(table);
  return table;
}

const _UP = new THREE.Vector3(0, 1, 0);
const _yawQ = new THREE.Quaternion();

/**
 * Re-centre (4.10): move the table to its default spot relative to the user's floor pose
 * (same frame as the panel rig) and make that the double-grip reset target. Keeps the scale.
 * @param {THREE.Group} table from createTable
 * @param {{x: number, z: number, yaw: number}} pose
 */
export function applyRecenter(table, { x, z, yaw }) {
  const base = table.userData.baseTransform;
  const def = table.userData.defaultTransform;
  if (!base || !def) return;
  _yawQ.setFromAxisAngle(_UP, yaw);
  def.position.copy(base.position).applyQuaternion(_yawQ);
  def.position.x += x;
  def.position.z += z;
  def.quaternion.copy(_yawQ).multiply(base.quaternion);
  table.position.copy(def.position);
  table.quaternion.copy(def.quaternion);
}

/**
 * Builds the track (cache-first) inside `table.userData.content`.
 * @param {import('../session-data.js').SessionData} data
 * @param {THREE.Group} table  from createTable
 * @returns {Promise<{scale:number, center:{x:number,y:number,z:number},
 *   toScene:(x:number,y:number,z:number,out:THREE.Vector3)=>THREE.Vector3,
 *   width:number, mesh:THREE.Group, dispose:()=>void}>}
 */
export async function loadTrack(data, table) {
  const s = data.session || {};
  const key = `${s.circuit ?? 'unknown'}-${s.year ?? ''}`;
  let built = null;
  try {
    const cached = await cacheGet(key, 'tracks');
    if (cached && cached.v === CACHE_VERSION && cached.outline && cached.outline.length >= 12) built = cached;
  } catch { /* cache never throws, but be safe */ }

  if (!built) {
    try {
      built = await buildTrackData(data);
    } catch (err) {
      // 6.11: no location for any clean lap (or no laps). Replay the timing data anyway.
      console.warn('[f1vr] no track outline for this session:', err && err.message);
      return noTrack(table);
    }
    try { await cachePut(key, built, 'tracks'); } catch { /* ignore */ }
  }
  // 6.12: trace the pit lane once per circuit (null = tried, not traceable; cached either way).
  if (built.pitLane === undefined) {
    built.pitLane = await buildPitLane(data, built.params);
    try { await cachePut(key, built, 'tracks'); } catch { /* ignore */ }
  }

  const params = built.params;
  const toScene = makeToScene(params);
  const content = table.userData.content || table;
  const group = buildTrackMeshes(built);
  if (built.pitLane) group.add(buildPitLaneLine(built.pitLane));
  content.add(group);

  return {
    scale: params.scale,
    center: { x: params.center.x, y: params.center.y, z: params.center.z },
    toScene,
    width: built.width,
    mesh: group,
    dispose() {
      group.removeFromParent();
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    },
  };
}

/**
 * Pit lane polyline in scene coordinates (flat xyz array), or null. One location request.
 * @returns {Promise<number[]|null>}
 */
async function buildPitLane(data, params) {
  try {
    if (typeof data.getPitStops !== 'function') return null;
    const stop = pickPitStop(data.getPitStops());
    if (!stop) return null;
    const { start, end } = pitWindow(stop);
    const lane = extractPitLane(await data.fetchLocation(stop.driver, start, end), stop.lane);
    if (!lane) return null;
    const toScene = makeToScene(params);
    const v = new THREE.Vector3();
    const out = [];
    for (const p of lane) {
      toScene(p.x, p.y, p.z, v);
      out.push(v.x, v.y, v.z);
    }
    return out;
  } catch (err) {
    console.warn('[f1vr] pit lane not traced:', err && err.message);
    return undefined; // a fetch error: try again next time
  }
}

function buildPitLaneLine(flat) {
  const pos = new Float32Array(flat);
  for (let i = 1; i < pos.length; i += 3) pos[i] += 0.0005; // just above the table / ribbon
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x8fb3d9, transparent: true, opacity: 0.7 }));
  line.name = 'pitLane';
  return line;
}

/**
 * Track stand-in for a session without position data: a note on the table, and a
 * transform that maps everything to the table centre (cars stay hidden without location).
 */
function noTrack(table) {
  const params = { scale: 1e-4, center: { x: 0, y: 0, z: 0 }, zExaggeration: 1, yOffset: 0 };
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 256;
  const g = canvas.getContext('2d');
  g.fillStyle = '#8a94a6';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = "700 64px 'Titillium Web', system-ui, sans-serif";
  g.fillText('No car position data', 512, 96);
  g.font = "600 44px 'Titillium Web', system-ui, sans-serif";
  g.fillText('for this session', 512, 176);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(1.0, 0.25);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  const note = new THREE.Mesh(geo, mat);
  note.name = 'noTrackNote';
  note.position.set(0, 0.002, 0.15);
  (table.userData.content || table).add(note);
  return {
    scale: params.scale,
    center: { ...params.center },
    toScene: makeToScene(params),
    width: trackWidth(TARGET_SIZE),
    mesh: note,
    missing: true,
    dispose() {
      note.removeFromParent();
      geo.dispose(); mat.dispose(); tex.dispose();
    },
  };
}

/** Computes the cacheable track description from the reference lap. */
async function buildTrackData(data) {
  const lap = await data.getReferenceLap();
  if (!lap || !Array.isArray(lap.points) || lap.points.length < 4) {
    throw new Error('Track: reference lap has no usable location data');
  }
  const pts = trimClosure(dedupePoints(lap.points));
  if (pts.length < 4) throw new Error('Track: too few distinct reference lap points');

  const params = computeTransformParams(pts);
  const toScene = makeToScene(params);
  const scenePts = pts.map((p) => toScene(p.x, p.y, p.z, new THREE.Vector3()));

  const curve = new THREE.CatmullRomCurve3(scenePts, true, 'centripetal');
  const sampled = curve.getSpacedPoints(SAMPLES); // closed: last == first
  const outline = new Array(SAMPLES * 3);
  for (let i = 0; i < SAMPLES; i++) {
    outline[i * 3] = sampled[i].x;
    outline[i * 3 + 1] = sampled[i].y;
    outline[i * 3 + 2] = sampled[i].z;
  }
  const start = scenePts[0];
  return {
    v: CACHE_VERSION,
    params: {
      scale: params.scale, center: params.center,
      zExaggeration: params.zExaggeration, yOffset: params.yOffset,
    },
    width: trackWidth(TARGET_SIZE),
    outline,
    start: { x: start.x, y: start.y, z: start.z },
    reference: { driverNumber: lap.driverNumber, lapNumber: lap.lapNumber },
  };
}

/** Horizontal unit normal (left of travel) at sample i of a closed flat xyz outline. */
function normalAt(outline, n, i, out) {
  const a = ((i - 1 + n) % n) * 3, b = ((i + 1) % n) * 3;
  let tx = outline[b] - outline[a], tz = outline[b + 2] - outline[a + 2];
  const len = Math.hypot(tx, tz) || 1;
  tx /= len; tz /= len;
  out.x = tz; out.z = -tx; // perpendicular in XZ plane
  out.tx = tx; out.tz = tz;
  return out;
}

/** Ribbon + edge lines + start/finish quad from cached track data. */
function buildTrackMeshes(built) {
  const { outline, width } = built;
  const n = outline.length / 3;
  const half = width / 2;
  const group = new THREE.Group();
  group.name = 'track';

  // --- ribbon: two vertices per sample, indexed strip, closed ---
  const pos = new Float32Array(n * 2 * 3);
  const edge = new Float32Array(n * 2 * 2 * 3); // 2 edges x n segments x 2 verts
  const nrm = { x: 0, z: 0, tx: 0, tz: 0 };
  const EDGE_LIFT = 0.0004;
  for (let i = 0; i < n; i++) {
    normalAt(outline, n, i, nrm);
    const x = outline[i * 3], y = outline[i * 3 + 1], z = outline[i * 3 + 2];
    pos[i * 6] = x + nrm.x * half; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z + nrm.z * half;
    pos[i * 6 + 3] = x - nrm.x * half; pos[i * 6 + 4] = y; pos[i * 6 + 5] = z - nrm.z * half;
  }
  const index = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const l0 = i * 2, r0 = i * 2 + 1, l1 = j * 2, r1 = j * 2 + 1;
    index.push(l0, r0, l1, r0, r1, l1);
    // edge segments (left then right), lifted slightly
    const e = i * 12;
    edge[e] = pos[l0 * 3]; edge[e + 1] = pos[l0 * 3 + 1] + EDGE_LIFT; edge[e + 2] = pos[l0 * 3 + 2];
    edge[e + 3] = pos[l1 * 3]; edge[e + 4] = pos[l1 * 3 + 1] + EDGE_LIFT; edge[e + 5] = pos[l1 * 3 + 2];
    edge[e + 6] = pos[r0 * 3]; edge[e + 7] = pos[r0 * 3 + 1] + EDGE_LIFT; edge[e + 8] = pos[r0 * 3 + 2];
    edge[e + 9] = pos[r1 * 3]; edge[e + 10] = pos[r1 * 3 + 1] + EDGE_LIFT; edge[e + 11] = pos[r1 * 3 + 2];
  }
  const ribbonGeo = new THREE.BufferGeometry();
  ribbonGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  ribbonGeo.setIndex(index);
  ribbonGeo.computeVertexNormals();
  // Winding may face down depending on travel direction; render both sides.
  const ribbonMat = new THREE.MeshStandardMaterial({
    color: 0x3a3d44, roughness: 0.9, metalness: 0.0, side: THREE.DoubleSide,
    emissive: 0x15171b,
  });
  const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat);
  ribbon.name = 'trackRibbon';
  group.add(ribbon);

  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute('position', new THREE.BufferAttribute(edge, 3));
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xc8ccd4, transparent: true, opacity: 0.55 });
  const edges = new THREE.LineSegments(edgeGeo, edgeMat);
  edges.name = 'trackEdges';
  group.add(edges);

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
  sf.position.set(outline[si * 3], outline[si * 3 + 1] + 0.0006, outline[si * 3 + 2]);
  // rotate so local +X aligns with the across-track normal
  sf.rotation.y = Math.atan2(-nrm.z, nrm.x);
  group.add(sf);

  return group;
}
