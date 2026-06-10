# Meshy GLB Exporter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Manifest V3 Chromium extension that exports a Meshy workspace model (decoded in-browser from its proprietary `.meshy` container by Meshy's own Three.js viewer) to a valid geometry-only **GLB** file.

**Architecture:** A `world: "MAIN"` content script reaches into the page's live Three.js scene, extracts each mesh's world-space geometry (positions/normals/UVs/indices), and a pure GLB writer encodes it as binary glTF 2.0. An isolated-world content script renders a floating "Export GLB" button and turns the returned `ArrayBuffer` into a browser download. The two worlds talk via `window.postMessage`.

**Tech Stack:** Plain JavaScript (ES modules), esbuild (bundle modules → extension scripts), Vitest + `@gltf-transform/core` (unit tests / GLB validation). Node 18+. Chrome/Chromium 111+ (for manifest `world: "MAIN"`).

---

## Context for the implementer (read before starting)

You have **zero prior context**, so here is what matters:

- **The `.meshy` file is NOT parseable offline.** It is a bespoke binary container (`MESHY.AI` magic, custom quantized/varint encoding, no standard compression). Do **not** try to parse it directly. The whole strategy is to let Meshy's web app decode it and steal the result from the live Three.js scene.
- **Meshy bundles Three.js but does not expose `window.THREE`.** `window.__THREE__` (the revision number) IS set. Three.js objects are identifiable by **duck-typed boolean flags**: `obj.isScene`, `obj.isMesh`, `obj.isObject3D`, `obj.isBufferGeometry`, `renderer.isWebGLRenderer`. Use these flags, never `instanceof THREE.X`.
- **A Three.js `BufferGeometry`** exposes geometry as `geometry.attributes.position` (a `BufferAttribute` with `.array` Float32Array, `.itemSize`, `.count`), optional `geometry.attributes.normal`, `geometry.attributes.uv`, and optional `geometry.index` (a `BufferAttribute` whose `.array` is the index list). A `Mesh` has `mesh.matrixWorld` (a `Matrix4` whose `.elements` is a **column-major** length-16 array).
- **GLB = binary glTF 2.0.** 12-byte header (`glTF` magic `0x46546C67`, version `2`, total length) + a JSON chunk (type `0x4E4F534A`, padded to 4 bytes with **spaces** `0x20`) + a BIN chunk (type `0x004E4942`, padded to 4 bytes with **zeros**). All integers little-endian. The `POSITION` accessor **requires** `min`/`max` arrays.

The design spec is at `docs/superpowers/specs/2026-06-10-meshy-glb-exporter-design.md`.

---

## File structure

```
package.json                  # scripts: build, test; devDeps: esbuild, vitest, @gltf-transform/core
.gitignore                    # node_modules/, dist/
scripts/build.mjs             # esbuild bundle main+ui, copy manifest+css to dist/
src/manifest.json             # MV3 manifest
src/main/glb.js               # PURE: writeGlb(meshes) -> ArrayBuffer
src/main/capture.js           # extractMeshes(scene), findScene(), captureSceneGeometry()
src/main/types.js             # JSDoc typedef: CapturedMesh
src/main/index.js             # MAIN-world entry: postMessage listener -> capture + glb
src/ui/index.js               # ISOLATED-world entry: button, messaging, download
src/ui/button.css             # button styles
tests/glb.test.js             # GLB writer unit tests (validates with @gltf-transform/core)
tests/capture.test.js         # extractMeshes unit tests against a fake scene
docs/probes/phase0-probe.js   # live console snippet (Phase 0)
docs/probes/phase0-findings.md# recorded results of the probe
dist/                         # generated, gitignored
```

`CapturedMesh` (defined once, used everywhere) — **positions are already world-space**:

```js
/**
 * @typedef {Object} CapturedMesh
 * @property {Float32Array} positions  // world-space, length = vertexCount * 3
 * @property {Float32Array|null} normals  // world-space, length = vertexCount * 3, or null
 * @property {Float32Array|null} uvs      // length = vertexCount * 2, or null
 * @property {Uint32Array|null} indices   // triangle indices, or null for non-indexed
 * @property {string} name
 */
```

---

## Task 1: Phase 0 — live hook reachability probe (interactive)

**Why:** Confirms the Three.js scene is reachable from page JS (the primary capture path) and captures a real fixture before we build anything. This task requires the **human operator** to run a snippet in the live, logged-in Meshy workspace and paste the output back.

**Files:**
- Create: `docs/probes/phase0-probe.js`
- Create: `docs/probes/phase0-findings.md`

- [ ] **Step 1: Write the probe snippet**

Create `docs/probes/phase0-probe.js`:

```js
// Paste into the DevTools Console on https://www.meshy.ai/workspace with a model open.
(() => {
  const flag = (o, k) => { try { return !!o && !!o[k]; } catch { return false; } };
  const isThree = (o) => flag(o,'isScene') || flag(o,'isObject3D') || flag(o,'isWebGLRenderer') || flag(o,'isMesh');

  // 1) Try to find a scene/renderer via the canvas's React fiber tree.
  const canvas = document.querySelector('canvas');
  const fiberKey = canvas && Object.keys(canvas).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
  const hits = [];
  const seen = new Set();
  function visit(node, depth) {
    if (!node || depth > 40 || seen.has(node)) return;
    seen.add(node);
    for (const prop of ['stateNode','memoizedState','memoizedProps','child','sibling','return']) {
      let v; try { v = node[prop]; } catch { continue; }
      if (v && typeof v === 'object') {
        if (isThree(v)) hits.push({ via:'fiber.'+prop, kind: v.isScene?'Scene':v.isWebGLRenderer?'Renderer':v.isMesh?'Mesh':'Object3D' });
        if (['child','sibling','return','stateNode','memoizedState'].includes(prop)) visit(v, depth+1);
      }
    }
  }
  if (fiberKey) visit(canvas[fiberKey], 0);

  // 2) Scan window own-properties one level deep.
  for (const k of Object.keys(window)) {
    let v; try { v = window[k]; } catch { continue; }
    if (isThree(v)) hits.push({ via:'window.'+k, kind: v.isScene?'Scene':v.isWebGLRenderer?'Renderer':v.isMesh?'Mesh':'Object3D' });
  }

  // 3) If we found a Scene, summarise its meshes.
  const scene = hits.find(h => h.kind === 'Scene');
  let meshSummary = null;
  if (scene) {
    // Re-locate the actual object (hits only stored metadata); re-run a quick find:
    // For the probe we just report counts via a fresh traversal helper:
  }
  return JSON.stringify({
    fiberKeyFound: !!fiberKey,
    hitCount: hits.length,
    hits: hits.slice(0, 20),
    url: location.href.replace(/\?.*$/, '')
  }, null, 2);
})();
```

- [ ] **Step 2: Operator runs the probe**

Ask the operator to open a model in the workspace, paste the snippet into the DevTools Console, and paste the JSON output back. Also ask them to run this second snippet to dump one real geometry as a test fixture (only if a Scene/Mesh hit was found):

```js
// Dump the first model mesh's geometry sizes (adjust the path once a scene ref is known).
// If `hits` exposed a reachable object, log: name, position.count, has normal/uv/index.
```

- [ ] **Step 3: Record findings**

Write the pasted results into `docs/probes/phase0-findings.md`, and record the **decision**:
- If a reachable `Scene` (or `Mesh`/`Renderer` we can climb to a scene from) was found → **primary path (scene capture) confirmed**; Tasks 4–5 proceed as written.
- If nothing was reachable → **stop and escalate**: the WebGL-intercept fallback becomes primary (a separate plan/tasks, not covered here). Do not proceed to Task 4 in that case.
- Note the **URL pattern** that contains the task/model id (for filename derivation in Task 6).

- [ ] **Step 4: Commit**

```bash
git add docs/probes/phase0-probe.js docs/probes/phase0-findings.md
git commit -m "Phase 0: live hook reachability probe and findings"
```

**Gate:** Do not start Task 2 until findings confirm the scene-capture path is viable.

---

## Task 2: Project scaffold

**Files:**
- Create: `package.json`, `.gitignore`, `scripts/build.mjs`, `src/manifest.json`, `src/ui/button.css`

- [ ] **Step 1: Verify Node is available**

Run: `node --version`
Expected: `v18.x` or higher. If missing, install Node 18+ before continuing.

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "meshy-glb-exporter",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node scripts/build.mjs",
    "test": "vitest run"
  },
  "devDependencies": {
    "@gltf-transform/core": "^4.1.0",
    "esbuild": "^0.24.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
```

- [ ] **Step 4: Create `src/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Meshy GLB Exporter",
  "version": "0.1.0",
  "description": "Export your own Meshy models from the workspace viewer to GLB.",
  "permissions": [],
  "host_permissions": ["https://www.meshy.ai/*"],
  "content_scripts": [
    {
      "matches": ["https://www.meshy.ai/*"],
      "js": ["main.js"],
      "world": "MAIN",
      "run_at": "document_idle"
    },
    {
      "matches": ["https://www.meshy.ai/*"],
      "js": ["ui.js"],
      "css": ["button.css"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 5: Create `src/ui/button.css`**

```css
#meshy-glb-export-btn {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483647;
  padding: 10px 14px;
  font: 600 13px/1 system-ui, sans-serif;
  color: #fff;
  background: #6c4cff;
  border: none;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,.3);
  cursor: pointer;
}
#meshy-glb-export-btn[disabled] { opacity: .6; cursor: default; }
```

- [ ] **Step 6: Create `scripts/build.mjs`**

```js
import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: { main: 'src/main/index.js', ui: 'src/ui/index.js' },
  bundle: true,
  format: 'iife',
  target: 'chrome111',
  outdir: 'dist',
});
await copyFile('src/manifest.json', 'dist/manifest.json');
await copyFile('src/ui/button.css', 'dist/button.css');
console.log('Built extension to dist/');
```

- [ ] **Step 7: Install and verify the toolchain**

Run: `npm install`
Then run: `npm test`
Expected: Vitest runs and reports **"No test files found"** (exit non-zero is fine here; tests arrive in Task 3). The point is Vitest is installed and runnable.

- [ ] **Step 8: Commit**

```bash
git add package.json .gitignore scripts/build.mjs src/manifest.json src/ui/button.css
git commit -m "Scaffold MV3 extension project (esbuild + vitest)"
```

---

## Task 3: GLB writer (pure, TDD)

**Files:**
- Create: `src/main/types.js`, `src/main/glb.js`
- Test: `tests/glb.test.js`

- [ ] **Step 1: Define the shared type**

Create `src/main/types.js`:

```js
/**
 * @typedef {Object} CapturedMesh
 * @property {Float32Array} positions
 * @property {Float32Array|null} normals
 * @property {Float32Array|null} uvs
 * @property {Uint32Array|null} indices
 * @property {string} name
 */
export {};
```

- [ ] **Step 2: Write the failing test**

Create `tests/glb.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { WebIO } from '@gltf-transform/core';
import { writeGlb } from '../src/main/glb.js';

describe('writeGlb', () => {
  it('produces a valid GLB with correct header and a parseable triangle', async () => {
    const positions = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
    const indices = new Uint32Array([0,1,2]);
    const buf = writeGlb([{ positions, normals: null, uvs: null, indices, name: 'tri' }]);

    const dv = new DataView(buf);
    expect(dv.getUint32(0, true)).toBe(0x46546C67); // 'glTF'
    expect(dv.getUint32(4, true)).toBe(2);          // version
    expect(dv.getUint32(8, true)).toBe(buf.byteLength); // total length

    const doc = await new WebIO().readBinary(new Uint8Array(buf));
    const meshes = doc.getRoot().listMeshes();
    expect(meshes.length).toBe(1);
    const prim = meshes[0].listPrimitives()[0];
    expect(prim.getAttribute('POSITION').getCount()).toBe(3);
    expect(prim.getIndices().getCount()).toBe(3);
    const min = prim.getAttribute('POSITION').getMin([]);
    const max = prim.getAttribute('POSITION').getMax([]);
    expect(min).toEqual([0,0,0]);
    expect(max).toEqual([1,1,0]);
  });

  it('includes NORMAL and TEXCOORD_0 when provided', async () => {
    const positions = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
    const normals = new Float32Array([0,0,1, 0,0,1, 0,0,1]);
    const uvs = new Float32Array([0,0, 1,0, 0,1]);
    const buf = writeGlb([{ positions, normals, uvs, indices: new Uint32Array([0,1,2]), name: 'tri' }]);
    const doc = await new WebIO().readBinary(new Uint8Array(buf));
    const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
    expect(prim.getAttribute('NORMAL').getCount()).toBe(3);
    expect(prim.getAttribute('TEXCOORD_0').getCount()).toBe(3);
  });

  it('writes multiple meshes as separate nodes', async () => {
    const tri = () => ({ positions: new Float32Array([0,0,0,1,0,0,0,1,0]), normals:null, uvs:null, indices:new Uint32Array([0,1,2]), name:'t' });
    const buf = writeGlb([tri(), tri()]);
    const doc = await new WebIO().readBinary(new Uint8Array(buf));
    expect(doc.getRoot().listMeshes().length).toBe(2);
    expect(doc.getRoot().listNodes().length).toBe(2);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/glb.test.js`
Expected: FAIL — `writeGlb` is not exported / module not found.

- [ ] **Step 4: Implement `writeGlb`**

Create `src/main/glb.js`:

```js
const FLOAT = 5126, UINT = 5125;
const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;
const TRIANGLES = 4;
const align4 = (n) => (n + 3) & ~3;

/**
 * Encode captured meshes as a binary glTF 2.0 (GLB) ArrayBuffer.
 * @param {import('./types.js').CapturedMesh[]} meshes
 * @returns {ArrayBuffer}
 */
export function writeGlb(meshes) {
  const json = {
    asset: { version: '2.0', generator: 'meshy-glb-exporter' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  };
  const binChunks = [];
  let binLength = 0;

  function addBufferView(typed, target) {
    const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
    const byteOffset = binLength;
    json.bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.byteLength, target });
    binChunks.push(bytes);
    binLength += bytes.byteLength;
    const pad = align4(binLength) - binLength;
    if (pad) { binChunks.push(new Uint8Array(pad)); binLength += pad; }
    return json.bufferViews.length - 1;
  }

  meshes.forEach((m, i) => {
    const prim = { attributes: {}, mode: TRIANGLES };
    const vcount = m.positions.length / 3;

    const posBV = addBufferView(m.positions, ARRAY_BUFFER);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < vcount; v++) {
      for (let c = 0; c < 3; c++) {
        const val = m.positions[v * 3 + c];
        if (val < min[c]) min[c] = val;
        if (val > max[c]) max[c] = val;
      }
    }
    json.accessors.push({ bufferView: posBV, componentType: FLOAT, count: vcount, type: 'VEC3', min, max });
    prim.attributes.POSITION = json.accessors.length - 1;

    if (m.normals) {
      const bv = addBufferView(m.normals, ARRAY_BUFFER);
      json.accessors.push({ bufferView: bv, componentType: FLOAT, count: vcount, type: 'VEC3' });
      prim.attributes.NORMAL = json.accessors.length - 1;
    }
    if (m.uvs) {
      const bv = addBufferView(m.uvs, ARRAY_BUFFER);
      json.accessors.push({ bufferView: bv, componentType: FLOAT, count: m.uvs.length / 2, type: 'VEC2' });
      prim.attributes.TEXCOORD_0 = json.accessors.length - 1;
    }
    if (m.indices) {
      const bv = addBufferView(m.indices, ELEMENT_ARRAY_BUFFER);
      json.accessors.push({ bufferView: bv, componentType: UINT, count: m.indices.length, type: 'SCALAR' });
      prim.indices = json.accessors.length - 1;
    }

    const name = m.name || `mesh_${i}`;
    json.meshes.push({ primitives: [prim], name });
    json.nodes.push({ mesh: i, name });
    json.scenes[0].nodes.push(i);
  });

  json.buffers.push({ byteLength: binLength });

  // JSON chunk (pad with spaces to 4 bytes)
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = align4(jsonBytes.length) - jsonBytes.length;
  if (jsonPad) {
    const padded = new Uint8Array(jsonBytes.length + jsonPad);
    padded.set(jsonBytes);
    padded.fill(0x20, jsonBytes.length);
    jsonBytes = padded;
  }

  // BIN chunk
  const binBuf = new Uint8Array(binLength);
  let off = 0;
  for (const c of binChunks) { binBuf.set(c, off); off += c.byteLength; }

  const total = 12 + 8 + jsonBytes.length + 8 + binBuf.length;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  let p = 0;
  dv.setUint32(p, 0x46546C67, true); p += 4; // 'glTF'
  dv.setUint32(p, 2, true); p += 4;
  dv.setUint32(p, total, true); p += 4;
  dv.setUint32(p, jsonBytes.length, true); p += 4;
  dv.setUint32(p, 0x4E4F534A, true); p += 4; // 'JSON'
  new Uint8Array(out, p, jsonBytes.length).set(jsonBytes); p += jsonBytes.length;
  dv.setUint32(p, binBuf.length, true); p += 4;
  dv.setUint32(p, 0x004E4942, true); p += 4; // 'BIN\0'
  new Uint8Array(out, p, binBuf.length).set(binBuf);

  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/glb.test.js`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/types.js src/main/glb.js tests/glb.test.js
git commit -m "Add pure GLB writer with validation tests"
```

---

## Task 4: Geometry extraction logic (pure, TDD)

`extractMeshes` walks a Three.js-shaped scene, filters out non-model objects, and bakes each mesh's world matrix into its vertices. It uses **only duck-typed flags and public properties** — no THREE import — so it is unit-testable with a fake scene.

**Files:**
- Create: `src/main/capture.js` (the `extractMeshes` export and helpers for now)
- Test: `tests/capture.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/capture.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { extractMeshes } from '../src/main/capture.js';

// Minimal fake Three.js objects (duck-typed).
function fakeMesh(name, positions, opts = {}) {
  const attributes = { position: { array: Float32Array.from(positions), itemSize: 3, count: positions.length / 3 } };
  if (opts.normals) attributes.normal = { array: Float32Array.from(opts.normals), itemSize: 3, count: opts.normals.length / 3 };
  if (opts.uvs) attributes.uv = { array: Float32Array.from(opts.uvs), itemSize: 2, count: opts.uvs.length / 2 };
  return {
    isMesh: true, isObject3D: true, name, visible: opts.visible !== false, children: [],
    matrixWorld: { elements: opts.matrix || [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1] },
    geometry: { isBufferGeometry: true, attributes, index: opts.indices ? { array: Uint32Array.from(opts.indices) } : null },
  };
}
function fakeScene(children) { return { isScene: true, isObject3D: true, name: 'Scene', children }; }

describe('extractMeshes', () => {
  it('extracts a single mesh with positions, uvs and indices', () => {
    const scene = fakeScene([fakeMesh('Model', [0,0,0,1,0,0,0,1,0], { uvs:[0,0,1,0,0,1], indices:[0,1,2] })]);
    const out = extractMeshes(scene);
    expect(out.length).toBe(1);
    expect(Array.from(out[0].positions)).toEqual([0,0,0,1,0,0,0,1,0]);
    expect(Array.from(out[0].uvs)).toEqual([0,0,1,0,0,1]);
    expect(Array.from(out[0].indices)).toEqual([0,1,2]);
  });

  it('bakes the world matrix into positions (translation)', () => {
    const m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 10,20,30,1]; // column-major translate (10,20,30)
    const scene = fakeScene([fakeMesh('Model', [0,0,0, 1,0,0], { matrix: m })]);
    const out = extractMeshes(scene);
    expect(Array.from(out[0].positions)).toEqual([10,20,30, 11,20,30]);
  });

  it('filters out grid/helper/skybox and empty objects', () => {
    const scene = fakeScene([
      fakeMesh('Model', [0,0,0,1,0,0,0,1,0]),
      fakeMesh('GridHelper', [0,0,0,1,0,0,0,1,0]),
      fakeMesh('skybox', [0,0,0,1,0,0,0,1,0]),
      { isObject3D: true, name: 'Light', children: [] }, // not a mesh
    ]);
    const out = extractMeshes(scene);
    expect(out.map(o => o.name)).toEqual(['Model']);
  });

  it('recurses into nested children', () => {
    const child = fakeMesh('Model', [0,0,0,1,0,0,0,1,0]);
    const group = { isObject3D: true, name: 'Group', children: [child] };
    const out = extractMeshes(fakeScene([group]));
    expect(out.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/capture.test.js`
Expected: FAIL — `extractMeshes` not exported.

- [ ] **Step 3: Implement `extractMeshes` and matrix helpers**

Create `src/main/capture.js`:

```js
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/capture.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/capture.js tests/capture.test.js
git commit -m "Add scene geometry extraction with world-matrix baking and filtering"
```

---

## Task 5: Scene discovery + captureSceneGeometry (browser-coupled)

This adds the part that finds the live scene in the real page. It cannot be unit-tested (it depends on Meshy's runtime), so it is verified live in Task 7. Use the discovery method confirmed by Task 1's findings.

**Files:**
- Modify: `src/main/capture.js` (append `findScene` and `captureSceneGeometry`)

- [ ] **Step 1: Append discovery + entry function to `src/main/capture.js`**

```js
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
```

- [ ] **Step 2: Verify existing unit tests still pass**

Run: `npx vitest run`
Expected: PASS (all tests from Tasks 3–4 unaffected; new functions are not unit-tested here).

- [ ] **Step 3: Commit**

```bash
git add src/main/capture.js
git commit -m "Add live Three.js scene discovery and captureSceneGeometry entry point"
```

---

## Task 6: Main-world bridge + UI button + download

Wires everything: the MAIN-world script listens for an export request, captures + encodes, and posts the GLB back; the isolated UI script renders the button and saves the file.

**Files:**
- Create: `src/main/index.js`, `src/ui/index.js`

- [ ] **Step 1: Create the MAIN-world bridge `src/main/index.js`**

```js
import { captureSceneGeometry } from './capture.js';
import { writeGlb } from './glb.js';

const REQUEST = 'MESHY_GLB_EXPORT_REQUEST';
const RESULT = 'MESHY_GLB_EXPORT_RESULT';

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'meshy-glb-ui' || data.type !== REQUEST) return;

  try {
    const meshes = captureSceneGeometry();
    const glb = writeGlb(meshes);
    const filename = deriveFilename();
    window.postMessage({ source: 'meshy-glb-main', type: RESULT, ok: true, glb, filename }, '*', [glb]);
  } catch (err) {
    window.postMessage({ source: 'meshy-glb-main', type: RESULT, ok: false, error: String(err && err.message || err) }, '*');
  }
});

function deriveFilename() {
  // Task 1 findings record the id-bearing URL segment; fall back to a timestamp.
  const seg = location.pathname.split('/').filter(Boolean).pop();
  const base = seg && /[0-9a-f-]{8,}/i.test(seg) ? seg : `meshy-${Date.now()}`;
  return `${base}.glb`;
}
```

- [ ] **Step 2: Create the UI script `src/ui/index.js`**

```js
const REQUEST = 'MESHY_GLB_EXPORT_REQUEST';
const RESULT = 'MESHY_GLB_EXPORT_RESULT';

const btn = document.createElement('button');
btn.id = 'meshy-glb-export-btn';
btn.textContent = 'Export GLB';
document.documentElement.appendChild(btn);

btn.addEventListener('click', () => {
  btn.disabled = true;
  btn.textContent = 'Exporting…';
  window.postMessage({ source: 'meshy-glb-ui', type: REQUEST }, '*');
});

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'meshy-glb-main' || data.type !== RESULT) return;

  btn.disabled = false;
  btn.textContent = 'Export GLB';

  if (!data.ok) { alert(`Meshy GLB Exporter: ${data.error}`); return; }

  const blob = new Blob([data.glb], { type: 'model/gltf-binary' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = data.filename || 'model.glb';
  document.documentElement.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
```

- [ ] **Step 3: Build the extension**

Run: `npm run build`
Expected: `dist/main.js`, `dist/ui.js`, `dist/manifest.json`, `dist/button.css` are produced; console prints "Built extension to dist/".

- [ ] **Step 4: Commit**

```bash
git add src/main/index.js src/ui/index.js
git commit -m "Add main-world bridge, export button UI, and GLB download"
```

---

## Task 7: Live smoke test (manual verification)

**Why:** The capture path, scene discovery, and end-to-end download can only be confirmed against the real Meshy site. No automated test can substitute.

**Files:**
- Create: `docs/probes/smoke-test-result.md`

- [ ] **Step 1: Load the unpacked extension**

In Chrome/Chromium: `chrome://extensions` → enable Developer Mode → **Load unpacked** → select the `dist/` folder.

- [ ] **Step 2: Export a real model**

Open `https://www.meshy.ai/workspace`, log in, open a generated model so the 3D preview renders. Click the **Export GLB** button (bottom-right). Confirm a `.glb` file downloads without an error alert.

- [ ] **Step 3: Validate the output**

Open the downloaded `.glb` in an external viewer (Blender via *File → Import → glTF 2.0*, or https://gltf-viewer.donmccurdy.com). Confirm:
- the mesh shape matches the Meshy preview,
- UVs are present (if the model had them — check in Blender's UV editor),
- no errors on import.

- [ ] **Step 4: Record the result**

Write outcome to `docs/probes/smoke-test-result.md`: which discovery path fired, mesh/vertex counts, screenshot or notes comparing preview vs. exported mesh, and any defects.

- [ ] **Step 5: Triage defects (if any)**

If the mesh is wrong (e.g., wrong transform, missing meshes, extra skybox geometry), use the recorded data to adjust `SKIP_NAME`, the matrix baking, or `findScene`, then re-run from Step 1. Add a regression unit test in `tests/capture.test.js` reproducing the defect with a fake scene before fixing.

- [ ] **Step 6: Commit**

```bash
git add docs/probes/smoke-test-result.md
git commit -m "Record live smoke test result for geometry-only GLB export"
```

---

## Out of scope for this plan (future phases)

- **Phase 2 — Textures:** capture base-color (then normal, metallic-roughness) maps from viewer materials / GL textures and embed them as a PBR material in the GLB.
- **Phase 3 — Bulk export:** queue and export multiple models with auto-naming.
- **WebGL-intercept fallback:** only needed if Task 1 finds the scene unreachable; would be its own plan.
- **OBJ/FBX direct output:** GLB → other formats is a trivial offline step (Blender/assimp/gltf-transform), so not built into the extension unless later requested.

---

## Self-review notes

- **Spec coverage:** MV3 extension (Task 2/6), main-world injection (Task 2 manifest + Task 6), scene capture primary path (Tasks 4–5), GLB writer (Task 3), floating button + download (Task 6), single-model scope (whole plan), Phase 0 reachability check (Task 1), error handling for "scene not found" / "no geometry" (Task 5 + Task 6 bridge), live smoke test (Task 7). WebGL-intercept fallback is explicitly deferred and gated on Task 1 findings — consistent with the spec's "primary with fallback" where the fallback is a separate effort.
- **Type consistency:** `CapturedMesh` defined in `src/main/types.js`; `extractMeshes`/`captureSceneGeometry` produce it; `writeGlb` consumes it. Message constants `MESHY_GLB_EXPORT_REQUEST`/`_RESULT` and envelope `source` fields (`meshy-glb-ui` / `meshy-glb-main`) match between `src/ui/index.js` and `src/main/index.js`.
- **Placeholders:** none — all code steps contain complete implementations.
