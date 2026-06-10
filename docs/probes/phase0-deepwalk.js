// Phase 0 DEEP-WALK probe: is the Three.js scene reachable via the object graph,
// or is it closure-private (forcing the WebGL-interception fallback)?
//
// HOW TO RUN: open a model so it's VISIBLY rendering, then paste this in the
// DevTools Console (context = "top") and send back the JSON.
(() => {
  const t0 = performance.now();
  const isThree = (o) => { try { return !!o && (o.isScene || o.isObject3D || o.isMesh || o.isWebGLRenderer); } catch { return false; } };
  const VIEWER_HINT = /^(scene|renderer|camera|cameras|meshes?|model|controls|gl|context|_scene|_renderer|threeScene)$/i;
  const seen = new Set();
  const res = { sceneVia: null, rendererVia: null, meshVia: null, viewerCandidates: [], nodes: 0, maxDepthSeen: 0, bailed: false };
  const MAX_NODES = 300000, MAX_MS = 3500, MAX_DEPTH = 11;

  const canvas = document.querySelector('canvas');
  const roots = [];
  if (canvas) {
    for (const k of Object.keys(canvas)) if (k.startsWith('__react')) { try { roots.push([canvas[k], k, 0]); } catch {} }
    // also climb a few ancestors in case the holder is above the canvas
    let node = canvas.parentElement;
    for (let i = 0; i < 12 && node; i++, node = node.parentElement) {
      for (const k of Object.keys(node)) if (k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) { try { roots.push([node[k], 'ancestor[' + i + '].' + k, 0]); } catch {} }
    }
  }
  try { if (window.__meshyViewerGpuWorkaroundState) roots.push([window.__meshyViewerGpuWorkaroundState, 'window.__meshyViewerGpuWorkaroundState', 0]); } catch {}

  const stack = roots.slice();
  while (stack.length) {
    if (res.nodes > MAX_NODES || performance.now() - t0 > MAX_MS) { res.bailed = true; break; }
    const [v, path, depth] = stack.pop();
    if (v == null || depth > MAX_DEPTH) continue;
    const ty = typeof v;
    if (ty !== 'object' && ty !== 'function') continue;
    if (seen.has(v)) continue;
    seen.add(v);
    res.nodes++;
    if (depth > res.maxDepthSeen) res.maxDepthSeen = depth;
    try { if (v instanceof Node || v === window || v === document || v === document.documentElement) continue; } catch {}

    if (isThree(v)) {
      if (v.isScene && !res.sceneVia) res.sceneVia = path;
      if (v.isWebGLRenderer && !res.rendererVia) res.rendererVia = path;
      if (v.isMesh && !res.meshVia) res.meshVia = path;
      if (!res.sceneVia) { let n = v, g = new Set(); while (n && !g.has(n)) { g.add(n); if (n.isScene) { res.sceneVia = path + ' ⇧scene'; break; } try { n = n.parent; } catch { break; } } }
    }

    if (ty === 'object') {
      let keys = []; try { keys = Object.keys(v); } catch {}
      const hintKeys = keys.filter((k) => VIEWER_HINT.test(k));
      if (hintKeys.length >= 2 && res.viewerCandidates.length < 8) {
        let ctor = null; try { ctor = v.constructor && v.constructor.name; } catch {}
        res.viewerCandidates.push({ path, ctor, hintKeys, allKeys: keys.slice(0, 30) });
      }
      if (Array.isArray(v)) { const lim = Math.min(v.length, 4000); for (let i = 0; i < lim; i++) stack.push([v[i], path + '[' + i + ']', depth + 1]); }
      else for (const k of keys) {
        if (k === '_owner' || k === '_debugOwner' || k === 'stateNode' && false) continue;
        let cv; try { cv = v[k]; } catch { continue; }
        stack.push([cv, path + '.' + k, depth + 1]);
      }
    }
  }

  res.elapsedMs = Math.round(performance.now() - t0);
  return JSON.stringify(res, null, 2);
})();
