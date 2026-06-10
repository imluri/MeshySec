# Live smoke test result — Task 7

Date: 2026-06-10. Model: a food-truck generated on a Meshy account, opened in the workspace.

## Outcome: PASS

- Loaded the unpacked extension from `dist/`, opened the model, clicked **Export GLB**.
- A `.glb` downloaded and opened cleanly in https://gltf-viewer.donmccurdy.com.
- The exported mesh matches the Meshy preview (full truck geometry: body, wheels, roof
  string-lights, serving window, ladder). Correct scale and orientation.
- glTF Validator: **no errors** after the fixes below.

## Discovery path that fired

`findScene` → `findSceneInGraph` reaches the react-three-fiber scene via the React
context graph from the canvas fiber. The model mesh's geometry is **interleaved,
Uint16-quantized** (stride 4), dequantized by the node `matrixWorld` (uniform scale
~0.0001158 + translation).

## Issues found during the smoke test and fixed

1. **Crash on load** — `extractMeshes` copied `attribute.array` directly; for interleaved
   attributes that is the whole packed buffer → fractional vertex count →
   `RangeError: Invalid typed array length: 2047048`. Fixed by reading via
   `getX/getY/getZ` (de-interleaves + de-quantizes via `matrixWorld`).
2. **"Looked like a sphere"** — the export also included Meshy's **background dome**
   (a 100-unit, 169-vertex back-side `ShaderMaterial` sphere with `depthWrite:false`,
   `depthTest:false`, `renderOrder:-1000`) which dwarfed the ~2-unit truck. Fixed by
   skipping meshes whose material disables depth write/test (`isBackdropMaterial`).
3. **39 `ACCESSOR_VECTOR3_NON_UNIT` warnings** — a few zero-length source normals.
   Fixed by substituting a unit normal for degenerate ones.

## Notes / future

- The capture-time `[MeshyGLB] captured meshes -> …` console log (bbox + index sanity) is
  retained as a lightweight diagnostic.
- Phase 2 (textures) and Phase 3 (bulk export) remain future work. The model uses a
  `MeshMatcapMaterial` (no base-color/PBR maps on this asset), so texture export will need
  to consider matcap vs. PBR sources.
