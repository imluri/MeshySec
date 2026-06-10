# Phase 0 Findings — live hook reachability

Date: 2026-06-10. Probed the live, logged-in `meshy.ai/workspace` with a model open.

## Confirmed facts

- **Three.js r170** is loaded in the **top frame** (`window.__THREE__ === "170"`). Single frame, no iframe.
- The viewer `<canvas>` exists only when a model is open, deep under `#viewport`, in the **main document** (no shadow DOM, no iframe). It carries `__reactFiber$…` / `__reactProps$…` — it is React-managed.
- The canvas has a **main-thread WebGL2 context** (`getContext('webgl2')` returns a context; does NOT throw `InvalidStateError`). So rendering is **NOT** in a Web Worker / OffscreenCanvas — a main-world hook can reach it.
- The viewer is **react-three-fiber** (a props object with `{frameloop, gl, camera, resize, shadows, onCreated, children}` sits in React context).
- The scene/renderer are **NOT** on `window`, and **NOT** in the canvas fiber's shallow fields (`stateNode`/`memoizedState`/`memoizedProps` + `.current`). A 13k-node shallow walk found zero Three objects.

## Root-cause conclusion

The scene **is reachable**, but only via a **generic deep recursion** through the object graph
(it lives behind a React **Context**: `…dependencies.firstContext.next.next.next.memoizedValue.modelRoots[0]`,
whose `.parent` chain reaches the `Scene`). A bounded generic walk from the canvas's React fiber
(+ a few ancestors) found it in **1106 nodes / 4 ms**.

The exact property path is brittle (minified, fiber internals, `.alternate`/`.return`, context ordering)
and must NOT be hardcoded. The robust approach is to **search the graph for an object with `isScene`
(or climb `.parent` from any `isObject3D`/`isMesh`)** — resilient to minification and re-renders.

## Action

Replace the narrow fiber walk in `findScene()` with a bounded generic graph search
(`findSceneInGraph`), seeded from the canvas's React-fiber roots and a few DOM ancestors,
with a visited set, node/depth/time caps, and DOM/window skipping.

## Open risk for the smoke test

Returning the whole `Scene` may include environment/ground/grid/helper meshes alongside the model.
`extractMeshes`' `SKIP_NAME` filter handles named helpers; if extraneous geometry still appears in the
export, refine the filter or target the model root (`modelRoots`) specifically.
