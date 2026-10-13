// Optional glTF car model (4b.9). Loaded with three's own GLTFLoader (three/addons, same
// pinned version: no new library). The model is flattened into one geometry per material,
// normalised to the car length (nose along +Z, base at y = 0, centred), and the "body"
// material is marked for the per-car team colour (InstancedMesh instanceColor).
// MODEL_URL is the approved CC0 asset (4b.8: Kenney Racing Kit raceCarWhite.glb). If it
// fails to load, cars.js keeps its built-in wedge.
import * as THREE from 'three';

/** Same-origin path of the approved model (relative to index.html), or null for the wedge. */
export const MODEL_URL = 'js/assets/cars/raceCarWhite.glb';
/** Extra yaw (radians) if the approved model's nose doesn't point along +Z. */
export const MODEL_YAW = 0;

const BODY_NAME = /body|paint|livery|chassis|main|grey|white/i;

/**
 * The model to load: MODEL_URL, or a `?carModel=<relative path>` debug override that must
 * resolve to this site's origin and end in .glb / .gltf. null = use the wedge.
 * @returns {string|null}
 */
export function resolveModelUrl() {
  let url = MODEL_URL;
  try {
    const q = new URLSearchParams(location.search).get('carModel');
    if (q) {
      const u = new URL(q, location.href);
      if (u.origin === location.origin && /\.(glb|gltf)$/i.test(u.pathname)) url = u.href;
      else console.warn('[f1vr] ignoring ?carModel (must be a same-origin .glb/.gltf path)');
    }
  } catch { /* no location (tests) */ }
  return url;
}

/**
 * Load and prepare a car model.
 * @param {string} url
 * @param {number} length target length in metres (table scale 1)
 * @param {number} [yaw] extra rotation about Y
 * @returns {Promise<ReturnType<typeof buildCarParts>>}
 */
export async function loadCarModel(url, length, yaw = MODEL_YAW) {
  const [{ GLTFLoader }, { mergeGeometries }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/utils/BufferGeometryUtils.js'),
  ]);
  const gltf = await new GLTFLoader().loadAsync(url);
  return buildCarParts(gltf.scene, length, mergeGeometries, yaw);
}

function luminance(c) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/**
 * Flatten a loaded scene into per-material geometries.
 * @param {THREE.Object3D} root
 * @param {number} length
 * @param {(geos: THREE.BufferGeometry[]) => THREE.BufferGeometry} mergeGeometries
 * @param {number} [yaw]
 * @returns {{parts: {geometry: THREE.BufferGeometry, material: THREE.Material, tint: boolean}[],
 *   shell: THREE.BufferGeometry, triangles: number, height: number}}
 */
export function buildCarParts(root, length, mergeGeometries, yaw = 0) {
  root.updateMatrixWorld(true);
  /** material uuid -> { material, geos: [] } */
  const buckets = new Map();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const material = Array.isArray(o.material) ? o.material[0] : o.material;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    const keep = material && material.map ? ['position', 'normal', 'uv'] : ['position', 'normal'];
    for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
    g.morphAttributes = {};
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(o.matrixWorld);
    let b = buckets.get(material.uuid);
    if (!b) { b = { material, geos: [] }; buckets.set(material.uuid, b); }
    b.geos.push(g);
  });
  if (!buckets.size) throw new Error('car model has no meshes');

  const parts = [];
  for (const { material, geos } of buckets.values()) {
    const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!geometry) throw new Error('car model: could not merge geometries');
    parts.push({ geometry, material, tint: false });
  }

  // Orientation: the long horizontal axis becomes Z, then the optional yaw.
  const box = new THREE.Box3();
  for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
  const size = box.getSize(new THREE.Vector3());
  const rot = new THREE.Matrix4().makeRotationY((size.x > size.z ? Math.PI / 2 : 0) + yaw);
  box.makeEmpty();
  for (const p of parts) { p.geometry.applyMatrix4(rot); p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
  box.getSize(size);
  const centre = box.getCenter(new THREE.Vector3());
  const k = length / size.z;
  const fit = new THREE.Matrix4().makeScale(k, k, k)
    .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z));
  let triangles = 0;
  for (const p of parts) {
    p.geometry.applyMatrix4(fit);
    p.geometry.computeBoundingBox();
    p.geometry.computeBoundingSphere();
    triangles += p.geometry.attributes.position.count / 3;
  }

  // Body material: by name, else the largest light-coloured part.
  let body = parts.find((p) => BODY_NAME.test(p.material.name || ''));
  if (!body) {
    const light = parts.filter((p) => p.material.color && luminance(p.material.color) > 0.5);
    body = (light.length ? light : parts).reduce((a, b) => (b.geometry.attributes.position.count > a.geometry.attributes.position.count ? b : a));
  }
  body.tint = true;
  for (const p of parts) {
    p.material = p.material.clone();
    if (p.tint && p.material.color) p.material.color.set(0xffffff); // instanceColor = team colour
  }
  // Tinted part first, so it becomes the instanced mesh that owns the colours.
  parts.sort((a, b) => Number(b.tint) - Number(a.tint));

  const shellGeos = parts.map((p) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', p.geometry.attributes.position);
    g.setAttribute('normal', p.geometry.attributes.normal);
    return g;
  });
  const shell = shellGeos.length === 1 ? shellGeos[0] : mergeGeometries(shellGeos, false);
  return { parts, shell, triangles, height: size.y * k };
}
