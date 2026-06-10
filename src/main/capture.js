/** @typedef {import('./types.js').CapturedMesh} CapturedMesh */
import { captureMaterial } from './textures.js';

const SKIP_NAME = /grid|helper|gizmo|skybox|sky_?box|background|ground|floor|axes|bounding|wireframe/i;

/** Apply a column-major 4x4 (Three.js Matrix4.elements) to a positions array (as points). */
function bakePositions(src, e) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    out[i]     = e[0] * x + e[4] * y + e[8]  * z + e[12];
    out[i + 1] = e[1] * x + e[5] * y + e[9]  * z + e[13];
    out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  return out;
}

/** Apply the upper-left 3x3 to normals (adequate for rigid/uniform-scale) and renormalize.
 *  Degenerate (zero-length) source normals are replaced with a unit normal so the
 *  output never contains non-unit vectors (which glTF validators reject). */
function bakeNormals(src, e) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    const nx = e[0] * x + e[4] * y + e[8]  * z;
    const ny = e[1] * x + e[5] * y + e[9]  * z;
    const nz = e[2] * x + e[6] * y + e[10] * z;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-8) { out[i] = 0; out[i + 1] = 0; out[i + 2] = 1; }
    else { out[i] = nx / len; out[i + 1] = ny / len; out[i + 2] = nz / len; }
  }
  return out;
}

/**
 * Detect non-model meshes (the environment dome, overlays, gizmos). A solid model
 * mesh writes and tests depth; backgrounds/overlays disable one or both so they
 * always draw behind/over everything. Materials may be an array (multi-material).
 * @param {object|object[]|undefined} material
 * @returns {boolean}
 */
function isBackdropMaterial(material) {
  if (!material) return false;
  const mats = Array.isArray(material) ? material : [material];
  if (mats.length === 0) return false;
  return mats.every((m) => m && (m.depthWrite === false || m.depthTest === false));
}

function indicesToUint32(index) {
  if (!index || !index.array) return null;
  const count = index.count != null ? index.count : index.array.length;
  if (index.array instanceof Uint32Array && count === index.array.length) return index.array;
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i++) out[i] = index.array[i];
  return out;
}

/**
 * Read a vertex attribute into a tightly-packed Float32Array of `count * comps`.
 *
 * Three.js stores geometry as plain OR interleaved attributes, and values may be
 * quantized (e.g. Uint16) — so `attribute.array` is NOT a clean per-vertex array.
 * The canonical reader is `getX/getY/getZ(i)`, which de-interleaves and
 * de-normalizes regardless of storage. We fall back to a strided read of `.array`
 * only when accessor methods are absent (e.g. test fakes / plain buffers).
 * @param {object} attr  a Three.js BufferAttribute / InterleavedBufferAttribute
 * @param {number} comps 3 for position/normal, 2 for uv
 * @returns {Float32Array}
 */
function readVec(attr, comps) {
  const count = attr.count != null ? attr.count : Math.floor((attr.array ? attr.array.length : 0) / comps);
  const out = new Float32Array(count * comps);
  if (typeof attr.getX === 'function') {
    for (let i = 0; i < count; i++) {
      out[i * comps] = attr.getX(i);
      if (comps > 1) out[i * comps + 1] = attr.getY(i);
      if (comps > 2) out[i * comps + 2] = attr.getZ(i);
    }
  } else if (attr.array) {
    const stride = attr.data && attr.data.stride ? attr.data.stride : comps;
    const offset = attr.offset || 0;
    for (let i = 0; i < count; i++) for (let c = 0; c < comps; c++) out[i * comps + c] = attr.array[offset + i * stride + c];
  }
  return out;
}

/**
 * Bake a Three.js texture transform (Matrix3) into a UV array, so the exported
 * UVs span the texture directly with no KHR_texture_transform extension needed.
 * Mirrors the viewer's `vUv = matrix * vec3(u, v, 1)`.
 * @param {Float32Array} uvs
 * @param {ArrayLike<number>} e  Three Matrix3.elements (column-major, length 9)
 * @returns {Float32Array}
 */
export function applyUvTransform(uvs, e) {
  const out = new Float32Array(uvs.length);
  for (let i = 0; i < uvs.length; i += 2) {
    const u = uvs[i], v = uvs[i + 1];
    out[i]     = e[0] * u + e[3] * v + e[6];
    out[i + 1] = e[1] * u + e[4] * v + e[7];
  }
  return out;
}

/** Read the (updated) UV transform matrix shared by a material's maps, or null. */
function uvMatrixOf(material) {
  const mat = Array.isArray(material) ? material[0] : material;
  const map = mat && (mat.map || mat.normalMap || mat.roughnessMap || mat.metalnessMap || mat.emissiveMap);
  if (!map) return null;
  try { if (map.matrixAutoUpdate && typeof map.updateMatrix === 'function') map.updateMatrix(); } catch { /* ignore */ }
  const e = map.matrix && map.matrix.elements;
  return e && e.length === 9 ? e : null;
}

/**
 * Walk a Three.js-shaped scene and return the live model mesh nodes only
 * (skips helpers/gizmos by name, and backdrop/overlay meshes by material).
 * @param {object} scene  object with `.children` (Three.js Scene/Object3D duck type)
 * @returns {object[]} Three.js Mesh nodes
 */
export function modelMeshNodes(scene) {
  const out = [];
  const stack = [scene];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node.children)) for (const c of node.children) stack.push(c);

    if (!node.isMesh || !node.geometry || node.visible === false) continue;
    if (node.name && SKIP_NAME.test(node.name)) continue;
    if (isBackdropMaterial(node.material)) continue;

    const pos = node.geometry.attributes && node.geometry.attributes.position;
    const vcount = pos ? (pos.count != null ? pos.count : (pos.array ? pos.array.length / 3 : 0)) : 0;
    if (!vcount) continue;
    out.push(node);
  }
  return out;
}

/** Build a world-space CapturedMesh (geometry only) from a Three.js mesh node. */
export function meshToCaptured(node) {
  const attrs = node.geometry.attributes || {};
  const pos = attrs.position;
  const e = (node.matrixWorld && node.matrixWorld.elements) || [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
  return {
    positions: bakePositions(readVec(pos, 3), e),
    normals: attrs.normal ? bakeNormals(readVec(attrs.normal, 3), e) : null,
    uvs: attrs.uv ? readVec(attrs.uv, 2) : null,
    indices: indicesToUint32(node.geometry.index),
    name: node.name || '',
    material: null,
  };
}

/**
 * Walk a Three.js-shaped scene and return world-space CapturedMesh[] for model
 * meshes only (geometry, no textures).
 * @param {object} scene
 * @returns {CapturedMesh[]}
 */
export function extractMeshes(scene) {
  return modelMeshNodes(scene).map((node, i) => {
    const c = meshToCaptured(node);
    if (!c.name) c.name = `mesh_${i}`;
    return c;
  });
}

/** Climb from any Three.js object to its root scene via `.parent`. */
function climbToScene(v) {
  let n = v;
  const guard = new Set();
  while (n && typeof n === 'object' && !guard.has(n)) {
    guard.add(n);
    if (n.isScene) return n;
    try { n = n.parent; } catch { return null; }
  }
  return null;
}

/**
 * Bounded generic search of an object graph for a Three.js Scene.
 *
 * The scene is not stored at any well-known location — in the Meshy viewer it
 * lives behind a react-three-fiber React Context, reached only by recursing
 * through arbitrary (minified) property names. So rather than hardcode a brittle
 * path, we walk every own-enumerable property from the given roots and identify
 * the Scene by its duck-typed `isScene` flag (or climb `.parent` from any
 * Object3D/Mesh). A visited set guards against cycles; node/depth/time caps keep
 * it bounded.
 *
 * @param {Array<any>} roots  starting objects (e.g. React fiber nodes)
 * @param {{maxNodes?:number, maxDepth?:number, maxMs?:number, now?:()=>number,
 *          skip?:(v:any)=>boolean}} [opts]
 * @returns {object|null} the Scene object, or null if none is reachable
 */
export function findSceneInGraph(roots, opts = {}) {
  const maxNodes = opts.maxNodes ?? 300000;
  const maxDepth = opts.maxDepth ?? 30;
  const maxMs = opts.maxMs ?? 0; // 0 = no time limit
  const now = opts.now ?? (() => 0);
  const skip = opts.skip;
  const t0 = now();
  const seen = new Set();
  const stack = [];
  for (const r of roots) stack.push([r, 0]);
  let nodes = 0;

  while (stack.length) {
    if (nodes > maxNodes) break;
    if (maxMs && now() - t0 > maxMs) break;
    const [v, depth] = stack.pop();
    if (v == null || depth > maxDepth) continue;
    const ty = typeof v;
    if (ty !== 'object' && ty !== 'function') continue;
    if (seen.has(v)) continue;
    seen.add(v);
    nodes++;

    try {
      if (v.isScene) return v;
      if (v.isObject3D || v.isMesh) { const s = climbToScene(v); if (s) return s; }
    } catch { /* exotic getter — ignore */ }

    if (skip && skip(v)) continue;
    if (ty !== 'object') continue;

    let keys;
    try { keys = Object.keys(v); } catch { continue; }
    if (Array.isArray(v)) {
      const lim = Math.min(v.length, 4000);
      for (let i = 0; i < lim; i++) stack.push([v[i], depth + 1]);
    } else {
      for (const k of keys) {
        if (k === '_owner' || k === '_debugOwner') continue; // React back-pointers: noise/cycles
        let cv; try { cv = v[k]; } catch { continue; }
        stack.push([cv, depth + 1]);
      }
    }
  }
  return null;
}

/**
 * Locate the live Three.js Scene in the page by searching the object graph
 * reachable from the WebGL canvas's React fiber (and a few DOM ancestors), with
 * a window-property fallback. Returns the Scene object or null.
 */
export function findScene() {
  const roots = [];
  const canvas = document.querySelector('canvas');
  if (canvas) {
    for (const k of Object.keys(canvas)) {
      if (k.startsWith('__react')) { try { roots.push(canvas[k]); } catch { /* ignore */ } }
    }
    let node = canvas.parentElement;
    for (let i = 0; i < 12 && node; i++, node = node.parentElement) {
      for (const k of Object.keys(node)) {
        if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) {
          try { roots.push(node[k]); } catch { /* ignore */ }
        }
      }
    }
  }

  const skip = (v) => {
    try { return v instanceof Node || v === window || v === document; }
    catch { return false; }
  };
  const scene = findSceneInGraph(roots, { maxMs: 3000, now: () => performance.now(), skip });
  if (scene) return scene;

  // Fallback: a Scene parked directly on a window property.
  for (const k of Object.keys(window)) {
    let v; try { v = window[k]; } catch { continue; }
    try { if (v && v.isScene) return v; } catch { /* ignore */ }
  }
  return null;
}

/**
 * Find the scene and extract its model geometry. With `opts.withTextures`, also
 * reads each material's maps into the CapturedMesh (only for meshes that have
 * UVs — a textured material is meaningless without TEXCOORD_0).
 * @param {{withTextures?: boolean}} [opts]
 * @returns {Promise<CapturedMesh[]>}
 * @throws {Error} if no scene or no model meshes are found.
 */
export async function captureSceneGeometry(opts = {}) {
  const scene = findScene();
  if (!scene) throw new Error('Could not find the Meshy 3D scene. Open a model and try again.');
  const nodes = modelMeshNodes(scene);
  if (nodes.length === 0) throw new Error('No exportable geometry found — is a model open in the viewer?');

  const meshes = nodes.map((node, i) => {
    const c = meshToCaptured(node);
    if (!c.name) c.name = `mesh_${i}`;
    return c;
  });

  if (opts.withTextures) {
    for (let i = 0; i < nodes.length; i++) {
      if (!meshes[i].uvs || !nodes[i].material) continue; // textures need UVs
      try {
        meshes[i].material = await captureMaterial(nodes[i].material);
        // Bake the material's UV transform (repeat/offset) into the UVs so the
        // embedded textures sample correctly without a glTF extension.
        const e = uvMatrixOf(nodes[i].material);
        if (e) meshes[i].uvs = applyUvTransform(meshes[i].uvs, e);
      } catch { /* keep geometry even if a texture fails to encode */ }
    }
  }
  return meshes;
}
