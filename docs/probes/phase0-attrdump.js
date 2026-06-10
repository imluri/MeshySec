// Phase 1 (debugging) probe: dump geometry attribute layout to confirm whether
// the Meshy meshes use INTERLEAVED buffer attributes (the suspected cause of the
// "Invalid typed array length" load error).
//
// HOW TO RUN: open a model so it renders, paste in the DevTools Console (top), send JSON back.
// KEY SIGNAL: for `position`, compare `arrayLen` to `count * itemSize`.
//   - arrayLen === count*itemSize  -> plain/tight (not the bug)
//   - arrayLen  >  count*itemSize  OR isInterleaved=true -> INTERLEAVED (confirms the bug)
(() => {
  const climb = (v) => { let n = v, g = new Set(); while (n && typeof n === 'object' && !g.has(n)) { g.add(n); if (n.isScene) return n; try { n = n.parent; } catch { return null; } } return null; };
  const canvas = document.querySelector('canvas');
  const roots = [];
  if (canvas) {
    for (const k of Object.keys(canvas)) if (k.startsWith('__react')) roots.push(canvas[k]);
    let nd = canvas.parentElement;
    for (let i = 0; i < 12 && nd; i++, nd = nd.parentElement) for (const k of Object.keys(nd)) if (k.startsWith('__reactFiber$')) roots.push(nd[k]);
  }
  const seen = new Set(); let scene = null; const stack = roots.map((r) => [r, 0]); const t0 = performance.now();
  while (stack.length) {
    if (performance.now() - t0 > 3000) break;
    const [v, d] = stack.pop();
    if (v == null || d > 30) continue;
    const t = typeof v;
    if (t !== 'object' && t !== 'function') continue;
    if (seen.has(v)) continue; seen.add(v);
    try { if (v.isScene) { scene = v; break; } if (v.isObject3D || v.isMesh) { const s = climb(v); if (s) { scene = s; break; } } } catch {}
    try { if (v instanceof Node || v === window || v === document) continue; } catch {}
    if (t === 'object') {
      let keys; try { keys = Object.keys(v); } catch { continue; }
      if (Array.isArray(v)) { for (let i = 0; i < Math.min(v.length, 4000); i++) stack.push([v[i], d + 1]); }
      else for (const k of keys) { if (k === '_owner' || k === '_debugOwner') continue; let cv; try { cv = v[k]; } catch { continue; } stack.push([cv, d + 1]); }
    }
  }
  if (!scene) return JSON.stringify({ sceneFound: false });

  const attrInfo = (a) => a ? {
    count: a.count, itemSize: a.itemSize,
    arrayLen: a.array ? a.array.length : null,
    expectedIfTight: a.count != null && a.itemSize != null ? a.count * a.itemSize : null,
    isInterleaved: !!(a.isInterleavedBufferAttribute || a.data),
    stride: a.data ? a.data.stride : null,
    offset: a.offset != null ? a.offset : null,
    normalized: !!a.normalized,
    hasGetX: typeof a.getX === 'function',
    arrayType: a.array ? a.array.constructor.name : null,
  } : null;

  const meshes = []; const st = [scene], s2 = new Set();
  while (st.length) {
    const n = st.pop();
    if (!n || typeof n !== 'object' || s2.has(n)) continue; s2.add(n);
    try { if (Array.isArray(n.children)) for (const c of n.children) st.push(c); } catch {}
    if (n.isMesh && n.geometry) {
      const g = n.geometry, at = g.attributes || {};
      meshes.push({
        name: n.name || '(unnamed)', visible: n.visible !== false,
        position: attrInfo(at.position), normal: attrInfo(at.normal), uv: attrInfo(at.uv),
        index: g.index ? { count: g.index.count, type: g.index.array ? g.index.array.constructor.name : null } : null,
      });
    }
  }
  return JSON.stringify({ sceneFound: true, meshCount: meshes.length, meshes: meshes.slice(0, 30) }, null, 2);
})();
