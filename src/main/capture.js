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

const isThree = (o) => {
  try { return !!o && (o.isScene || o.isObject3D || o.isMesh || o.isWebGLRenderer); }
  catch { return false; }
};

/** Climb from any Three.js object to its root scene. */
function rootSceneOf(obj) {
  let n = obj;
  const guard = new Set();
  while (n && !guard.has(n)) {
    guard.add(n);
    if (n.isScene) return n;
    if (n.parent) { n = n.parent; continue; }
    break;
  }
  return obj && obj.isScene ? obj : null;
}

/**
 * Locate the live Three.js Scene in the page. Strategy order:
 *  1) Walk the WebGL canvas's React fiber tree for a Scene/Mesh/Renderer.
 *  2) Scan window own-properties.
 * Returns the Scene object or null.
 */
export function findScene() {
  const canvas = document.querySelector('canvas');
  const seen = new Set();
  let found = null;

  function consider(v) {
    if (found || !isThree(v)) return;
    const scene = v.isScene ? v : (v.isWebGLRenderer ? null : rootSceneOf(v));
    if (scene && scene.isScene) found = scene;
  }

  if (canvas) {
    const key = Object.keys(canvas).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    if (key) {
      const stack = [canvas[key]];
      let depth = 0;
      while (stack.length && !found && depth < 5000) {
        depth++;
        const node = stack.pop();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        for (const prop of ['stateNode','memoizedState','memoizedProps','child','sibling','return']) {
          let v; try { v = node[prop]; } catch { continue; }
          if (!v || typeof v !== 'object') continue;
          consider(v);
          if (['child','sibling','return','stateNode','memoizedState'].includes(prop)) stack.push(v);
        }
      }
    }
  }

  if (!found) {
    for (const k of Object.keys(window)) {
      let v; try { v = window[k]; } catch { continue; }
      consider(v);
      if (found) break;
    }
  }
  return found;
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
