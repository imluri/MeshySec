/** @typedef {import('./types.js').CapturedMesh} CapturedMesh */

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

/** Apply the upper-left 3x3 to normals (adequate for rigid/uniform-scale) and renormalize. */
function bakeNormals(src, e) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    let nx = e[0] * x + e[4] * y + e[8]  * z;
    let ny = e[1] * x + e[5] * y + e[9]  * z;
    let nz = e[2] * x + e[6] * y + e[10] * z;
    const len = Math.hypot(nx, ny, nz) || 1;
    out[i] = nx / len; out[i + 1] = ny / len; out[i + 2] = nz / len;
  }
  return out;
}

function indicesToUint32(index) {
  if (!index || !index.array) return null;
  return index.array instanceof Uint32Array ? index.array : Uint32Array.from(index.array);
}

/**
 * Walk a Three.js-shaped scene and return world-space CapturedMesh[] for model meshes only.
 * @param {object} scene  object with `.children` (Three.js Scene/Object3D duck type)
 * @returns {CapturedMesh[]}
 */
export function extractMeshes(scene) {
  const out = [];
  const stack = [scene];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (Array.isArray(node.children)) for (const c of node.children) stack.push(c);

    if (!node.isMesh || !node.geometry || node.visible === false) continue;
    if (node.name && SKIP_NAME.test(node.name)) continue;

    const attrs = node.geometry.attributes || {};
    const pos = attrs.position;
    if (!pos || !pos.array || pos.array.length === 0) continue;

    const e = (node.matrixWorld && node.matrixWorld.elements) || [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
    out.push({
      positions: bakePositions(pos.array, e),
      normals: attrs.normal && attrs.normal.array ? bakeNormals(attrs.normal.array, e) : null,
      uvs: attrs.uv && attrs.uv.array ? Float32Array.from(attrs.uv.array) : null,
      indices: indicesToUint32(node.geometry.index),
      name: node.name || `mesh_${out.length}`,
    });
  }
  return out;
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
 * Find the scene and extract its model geometry.
 * @returns {CapturedMesh[]}
 * @throws {Error} if no scene or no model meshes are found.
 */
export function captureSceneGeometry() {
  const scene = findScene();
  if (!scene) throw new Error('Could not find the Meshy 3D scene. Open a model and try again.');
  const meshes = extractMeshes(scene);
  if (meshes.length === 0) throw new Error('No exportable geometry found — is a model open in the viewer?');
  return meshes;
}
