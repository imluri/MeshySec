# Meshy GLB Exporter — Design

**Date:** 2026-06-10
**Status:** Approved (design); ready for implementation planning

## Problem

Meshy (https://www.meshy.ai/workspace) generates 3D models. The workspace renders a
model's preview fine, but **exporting standard formats (GLB/FBX/OBJ) is gated behind a paid
plan**. The only free download is a `.meshy` file.

The `.meshy` file is a **proprietary binary container** — not standard encryption (overall
entropy ~6.42 bits/byte), but a bespoke, partly-compressed serialization:

- Magic `MESHY.AI`, version `01 00`, an early length field (`4965`).
- Distinct chunk regions (a ~5 KB high-entropy header chunk ~7.95; structured mesh ~6.5–7.3;
  a low-entropy ~4.2 region of quantized/varint data).
- **No standard codec** (zlib, raw-deflate, gzip, brotli, zstd) decompresses any region.
- The structured region is a custom quantized/varint encoding, not plain float32 vertices.

Reverse-engineering this container into an offline parser is a multi-day, fragile effort.

## Goal

Make it easy to export **your own** generated Meshy models to a usable 3D format, for
**personal use of your own content**. Phase 1 delivers a clean **geometry-only GLB**
(positions, normals, UVs, faces). Textures are a later phase.

Out of scope (explicitly): redistributing others' models, reselling, or any use beyond
personal export of content the user generated on their own account.

## Key reconnaissance findings (live site, logged in)

- The workspace is a **custom Three.js viewer**: `window.__THREE__` is set (Three.js core
  loaded) but `window.THREE` is **not** exposed (bundled/minified). A custom global
  `__meshyViewerGpuWorkaroundState` is present. Single WebGL `<canvas>`, **not**
  react-three-fiber (`canvas.__r3f` is false).
- The viewer **fetches the `.meshy` file itself** from
  `assets.meshy.ai/.../output/model.meshy` (signed CloudFront URL) and **decodes it
  in-browser** with Three.js. There is **no separate GLB/Draco** asset fetched.

**Consequence:** Network interception is useless (it only yields the `.meshy` we can't read).
The decoded geometry exists in a **live Three.js scene in the page**, which is what we capture.

## Architecture

A **Manifest V3 Chromium extension** that injects a script into the **main world** of the
Meshy workspace tab, captures the decoded geometry from the running Three.js viewer, writes a
**GLB** with a self-contained writer, and triggers a browser download.

```
meshy.ai/workspace tab (their JS decodes .meshy -> Three.js scene)
        │
   [content script, world: MAIN]  ← injected by the extension
        │  capture geometry (primary: scene object; fallback: WebGL intercept)
        ▼
   minimal GLB writer (POSITION / NORMAL / TEXCOORD_0 / indices)
        ▼
   browser download:  <task-id>.glb
```

### Components (each independently understandable/testable)

1. **Manifest + injection (`manifest.json`, content-script loader).**
   MV3. Registers a content script on `https://www.meshy.ai/*` (and the asset/app origins as
   needed). Because we need the page's real JS objects, the capture logic runs in
   `world: "MAIN"` (MV3 content-script `world` option), or is injected as a `<script>` whose
   `src` is a `web_accessible_resource`. The isolated-world part owns the UI button and
   messaging; the main-world part owns capture.
   - *Depends on:* nothing. *Interface:* posts/receives `window.postMessage` events between
     the isolated UI layer and the main-world capture layer.

2. **UI layer (isolated world).**
   Injects a small floating **"Export GLB"** button into the workspace when a model is open.
   On click, sends a `MESHY_EXPORT_REQUEST` message; on response, receives a GLB `ArrayBuffer`
   (or an error) and triggers the download (blob + `<a download>` or `chrome.downloads`).
   - *Depends on:* injection. *Interface:* DOM button + postMessage.

3. **Geometry capture (main world).** Two strategies behind one interface
   `captureSceneGeometry(): CapturedMesh[]` where
   `CapturedMesh = { positions: Float32Array, normals?: Float32Array, uvs?: Float32Array,
   indices?: Uint32Array, worldMatrix: number[16], name?: string }`.

   - **Primary — Three.js scene capture.** Locate the live renderer/scene by walking the
     canvas's React fiber (`canvas[__reactFiber$*]` / `__reactContainer$*`) and/or scanning
     reachable objects for Three.js duck-typed flags (`isScene`, `isWebGLRenderer`, `isMesh`,
     `isBufferGeometry`). Traverse the scene, read each mesh's `geometry.attributes`
     (`position`/`normal`/`uv`) and `geometry.index`, plus `mesh.matrixWorld`. Filter out
     non-model objects (grid, skybox, lights, gizmos, helpers) by heuristics
     (name, material, bounding-box size, no-geometry).
   - **Fallback — WebGL command interception.** Installed at `document_start`: wrap
     `HTMLCanvasElement.prototype.getContext` so each WebGL/WebGL2 context records
     `bufferData`/`bufferSubData` (buffer→bytes), `vertexAttribPointer` +
     `enableVertexAttribArray` (attribute layout), and `drawElements`/`drawArrays`
     (which buffers form a mesh). Reconstruct meshes from draw calls; infer attribute
     semantics by component count (vec3 float ⇒ position/normal, vec2 float ⇒ uv); capture a
     model matrix from `uniformMatrix4fv` when available. De-duplicate redundant per-frame
     redraws; filter skybox/grid.
   - *Depends on:* injection (and, for the fallback, being installed before the viewer creates
     its GL context — i.e. `document_start`). *Interface:* `captureSceneGeometry()`.

4. **GLB writer (pure, main world — no Three.js dependency).**
   `writeGlb(meshes: CapturedMesh[]): ArrayBuffer`. Emits a valid binary glTF 2.0: one JSON
   chunk + one BIN chunk; accessors/bufferViews for `POSITION`, `NORMAL` (if present),
   `TEXCOORD_0` (if present), and indices; one node per mesh with its world matrix (or
   pre-baked into vertices). No materials/textures in Phase 1 (default material).
   - *Depends on:* nothing (pure function over `CapturedMesh[]`). *Interface:* `writeGlb()`.

### Data flow

1. User opens a model in the workspace; the viewer decodes `.meshy` into a Three.js scene.
2. User clicks **Export GLB**. UI layer → main world: `MESHY_EXPORT_REQUEST`.
3. Main world calls `captureSceneGeometry()` (primary; fallback on failure) → `CapturedMesh[]`.
4. `writeGlb()` produces an `ArrayBuffer`.
5. Main world → UI layer: the GLB buffer (transferable) + a suggested filename (task id).
6. UI layer triggers the download.

### Error handling

- **Scene not found (primary fails):** automatically attempt the WebGL-intercept fallback;
  if the fallback wasn't installed in time (page already past `document_start`), surface a
  clear message asking the user to reload the model tab and retry.
- **No model meshes after filtering:** report "no exportable geometry found — is a model
  open?" rather than downloading an empty file.
- **Capture/encode exception:** caught at the boundary; the UI shows the error string instead
  of failing silently. Nothing is written to disk on error.
- **Multiple canvases / multiple scenes:** pick the canvas matching the visible viewer;
  document the heuristic and make it overridable later if needed.

### Testing strategy

- **GLB writer:** unit-testable in isolation with synthetic `CapturedMesh[]` (a triangle, a
  quad). Validate the GLB parses (e.g. against a glTF validator / `@gltf-transform/core`):
  correct magic/version/chunk lengths, accessor counts, min/max, byte alignment.
- **Capture (primary):** test the scene-traversal/filter logic against a constructed Three.js
  scene fixture (scene + mesh + grid + light) — assert only the model mesh is captured with
  correct attribute lengths and world matrix.
- **Capture (fallback):** test the GL-command reconstruction against a recorded/synthetic
  sequence of `bufferData`/`vertexAttribPointer`/`drawElements` calls.
- **Live smoke test:** load a real model in the workspace, export, open the GLB in
  Blender/three-gltf-viewer, confirm the mesh matches the preview (correct shape, UVs intact).

## Implementation phasing

- **Phase 0 — Live hook reachability check.** A throwaway main-world probe (run against the
  real workspace) that confirms whether the Three.js scene is reachable (primary) or whether
  we must rely on the WebGL-intercept fallback. Decides the primary path; de-risks everything
  after. *Acceptance:* we can log, from the live page, a list of model meshes with vertex
  counts (via at least one of the two strategies).
- **Phase 1 — Geometry-only GLB (MVP).** Manifest + injection, UI button, the chosen capture
  path, GLB writer, download. *Acceptance:* clicking Export on an open model downloads a valid
  GLB whose mesh matches the preview when opened in Blender; UVs/normals preserved.
- **Phase 2 — Textures.** Capture base-color (then normal, metallic-roughness) maps from the
  viewer materials / GL textures; embed in the GLB as a PBR material.
- **Phase 3 — Bulk export.** Iterate multiple models (queue), auto-named files.

## Open questions / risks

- **Scene reachability** (primary path) is unconfirmed until Phase 0. Mitigated by the
  WebGL-intercept fallback, which is API-guaranteed but needs `document_start` installation.
- **Format drift:** Meshy can change their bundle/viewer. The scene/duck-type approach is
  fairly resilient (Three.js public API is stable); the fiber-discovery and filtering
  heuristics are the fragile parts and may need maintenance.
- **Filtering correctness:** distinguishing the model from skybox/grid/gizmos is heuristic;
  the live smoke test is the real check.

## Non-goals

- Offline `.meshy` parsing / a standalone CLI (rejected: multi-day RE, fragile).
- Network interception of a GLB (none exists — the viewer fetches the `.meshy` itself).
- FBX/OBJ output in Phase 1 (GLB only; others can come later if wanted).
- Any automation of the user's Meshy login or headless browsing.
