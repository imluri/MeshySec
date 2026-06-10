// Phase 0 reachability probe for the Meshy GLB Exporter.
// HOW TO RUN: open https://www.meshy.ai/workspace, open a generated model so the 3D
// preview is visible, open DevTools (F12) -> Console, paste this whole snippet, press
// Enter, and copy the JSON output back.
(() => {
  const flag = (o, k) => { try { return !!o && !!o[k]; } catch { return false; } };
  const isThree = (o) =>
    flag(o, 'isScene') || flag(o, 'isObject3D') || flag(o, 'isMesh') || flag(o, 'isWebGLRenderer');

  // Climb parents to the root Scene from any Object3D.
  const rootSceneOf = (obj) => {
    let n = obj, guard = new Set();
    while (n && !guard.has(n)) { guard.add(n); if (n.isScene) return n; n = n.parent; }
    return obj && obj.isScene ? obj : null;
  };

  const canvas = document.querySelector('canvas');
  const seen = new Set();
  const hits = [];
  let scene = null;

  const consider = (v, via) => {
    if (!isThree(v)) return;
    hits.push({ via, kind: v.isScene ? 'Scene' : v.isWebGLRenderer ? 'Renderer' : v.isMesh ? 'Mesh' : 'Object3D' });
    if (!scene) { const s = v.isScene ? v : rootSceneOf(v); if (s && s.isScene) scene = s; }
  };

  // 1) Walk the canvas's React fiber tree.
  let fiberKey = null;
  if (canvas) {
    fiberKey = Object.keys(canvas).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')) || null;
    if (fiberKey) {
      const stack = [canvas[fiberKey]]; let steps = 0;
      while (stack.length && steps < 8000) {
        steps++;
        const node = stack.pop();
        if (!node || typeof node !== 'object' || seen.has(node)) continue;
        seen.add(node);
        for (const prop of ['stateNode', 'memoizedState', 'memoizedProps', 'child', 'sibling', 'return']) {
          let v; try { v = node[prop]; } catch { continue; }
          if (!v || typeof v !== 'object') continue;
          consider(v, 'fiber.' + prop);
          if (['child', 'sibling', 'return', 'stateNode', 'memoizedState'].includes(prop)) stack.push(v);
        }
      }
    }
  }

  // 2) Scan window own-properties.
  for (const k of Object.keys(window)) {
    let v; try { v = window[k]; } catch { continue; }
    consider(v, 'window.' + k);
  }

  // 3) Summarise model meshes if a scene was reached.
  let meshSummary = null;
  if (scene) {
    meshSummary = [];
    const stack = [scene]; const s2 = new Set();
    while (stack.length) {
      const n = stack.pop();
      if (!n || typeof n !== 'object' || s2.has(n)) continue;
      s2.add(n);
      if (Array.isArray(n.children)) for (const c of n.children) stack.push(c);
      if (n.isMesh && n.geometry && n.geometry.attributes) {
        const a = n.geometry.attributes;
        meshSummary.push({
          name: n.name || '(unnamed)',
          visible: n.visible !== false,
          vertexCount: a.position ? a.position.count : 0,
          hasNormal: !!a.normal, hasUV: !!a.uv,
          indexed: !!(n.geometry.index && n.geometry.index.count),
          indexCount: n.geometry.index ? n.geometry.index.count : 0,
        });
      }
    }
  }

  return JSON.stringify({
    threeRevision: window.__THREE__ || null,
    fiberKeyFound: !!fiberKey,
    hitCount: hits.length,
    hits: hits.slice(0, 20),
    sceneFound: !!scene,
    meshCount: meshSummary ? meshSummary.length : 0,
    meshSummary: meshSummary ? meshSummary.slice(0, 40) : null,
    url: location.href.replace(/\?.*$/, ''),
    pathSegments: location.pathname.split('/').filter(Boolean),
  }, null, 2);
})();
